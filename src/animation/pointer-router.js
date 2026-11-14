import {SpatialIndex, segmentBox} from './spatial-index.js';
import {segmentBlocked} from './routing.js';
import {packPointerPath} from './pointer-lanes.js';

const sameRect = (a, b) => a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const samePath = (a, b) => a?.length === b?.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
const simplify = path => path.filter((p, i) => !i || i === path.length - 1 || !((path[i - 1].x === p.x && p.x === path[i + 1].x) || (path[i - 1].y === p.y && p.y === path[i + 1].y)));

// One durable libavoid router per region/backbone. Topology is updated by delta,
// not reconstructed per pointer, frame, value change or camera movement.
export class PointerRouter {
  constructor(Avoid) {
    this.A = Avoid;
    this.router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
    // Crossing penalties trigger libavoid's global crossing-repair pass.
    // Keep interaction incremental; ordering/nudging still separates tracks.
    for (const [name, value] of [['segmentPenalty', 24], ['shapeBufferDistance', 7], ['idealNudgingDistance', 5], ['crossingPenalty', 0]]) this.router.setRoutingParameter(Avoid.RoutingParameter[name], value);
    for (const name of ['nudgeOrthogonalSegmentsConnectedToShapes', 'performUnifyingNudgingPreprocessingStep', 'improveHyperedgeRoutesMovingJunctions', 'improveHyperedgeRoutesMovingAddingAndDeletingJunctions']) this.router.setRoutingOption(Avoid.RoutingOption[name], false);
    for (const name of ['nudgeSharedPathsWithCommonEndPoint', 'nudgeOrthogonalTouchingColinearSegments']) this.router.setRoutingOption(Avoid.RoutingOption[name], true);
    this.nodes = new Map(); this.edges = new Map(); this.paths = new Map();
    this.obstacles = new SpatialIndex(); this.segments = new SpatialIndex(); this.segmentKeys = new Map();
    this.transactions = 0;
    this.terminalSlots = new Map();
  }
  polygon(node) {
    const A = this.A, a = new A.Point(node.x, node.y), b = new A.Point(node.x + node.width, node.y + node.height);
    const rectangle = new A.Rectangle(a, b); a.delete(); b.delete(); return rectangle;
  }
  endpoint(nodeId, port = 'right') {
    const node = this.nodes.get(nodeId), A = this.A;
    const spec = typeof port === 'string' ? {key: port, x: port === 'left' ? 0 : port === 'right' ? 1 : 0.5, y: port === 'top' ? 0 : port === 'bottom' ? 1 : 0.5,
      direction: {left: 4, right: 8, top: 1, bottom: 2}[port]} : {...port, direction: {left: 4, right: 8, top: 1, bottom: 2}[port.side]};
    const pinKey = JSON.stringify([spec.key, spec.x, spec.y, spec.direction]);
    let pin = node.pins.get(pinKey);
    if (!pin) {
      const id = node.pins.size + 1;
      const native = new A.ShapeConnectionPin(node.native, id, spec.x, spec.y, true, 0, spec.direction);
      native.setExclusive(false); pin = {id, native}; node.pins.set(pinKey, pin);
    }
    return new A.ConnEnd(node.native, pin.id);
  }
  setPath(id, path) {
    for (const key of this.segmentKeys.get(id) ?? []) this.segments.delete(key);
    const keys = [];
    for (let i = 1; i < path.length; i++) {
      const key = `${id}#${i}`; keys.push(key);
      this.segments.set(key, segmentBox(path[i - 1], path[i], 0.1), {id, a: path[i - 1], b: path[i]});
    }
    this.segmentKeys.set(id, keys); this.paths.set(id, path);
  }
  valid(path, edge) {
    if (!(path?.length >= 2) || path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (a.x !== b.x && a.y !== b.y) return false;
      const obstacles = this.obstacles.query(segmentBox(a, b)).filter(n => n.id !== edge.source && n.id !== edge.target);
      if (segmentBlocked(a, b, obstacles)) return false;
    }
    return true;
  }
  removeEdge(id) {
    const edge = this.edges.get(id);
    if (edge?.native) this.router.deleteConnector(edge.native);
    this.edges.delete(id);
    for (const key of this.segmentKeys.get(id) ?? []) this.segments.delete(key);
    this.segmentKeys.delete(id); this.paths.delete(id);
  }
  // Reconstitute saved reservations without solving any old connectors.
  // Only the subsequent geometry delta participates in native routing.
  prime(graph, paths, terminals = new Map()) {
    this.terminalSlots = new Map([...terminals].map(([id, slots]) => [id, new Map(slots)]));
    for (const node of graph.nodes) {
      const rectangle = this.polygon(node), native = new this.A.ShapeRef(this.router, rectangle, 0);
      rectangle.delete(); this.nodes.set(node.id, {...node, native, pins: new Map()}); this.obstacles.set(node.id, node, node);
    }
    // libavoid must commit ShapeAdd before a subsequent delta can delete or
    // resize that shape. There are no native connectors in this transaction.
    this.router.processTransaction(); this.transactions++;
    for (const edge of graph.edges) if (paths.get(edge.id)?.length) {
      this.edges.set(edge.id, {...edge, sourcePort: edge.sourcePort ?? this.terminal(edge.source, edge.id, 'right'),
        targetPort: edge.targetPort ?? this.terminal(edge.target, edge.id, 'left'), native: null});
      this.setPath(edge.id, paths.get(edge.id));
    }
  }
  update(graph, repairing = false) {
    graph = {...graph, edges: graph.edges.map(edge => ({...edge,
      sourcePort: edge.sourcePort ?? this.terminal(edge.source, edge.id, 'right'),
      targetPort: edge.targetPort ?? this.terminal(edge.target, edge.id, 'left')}))};
    const start = performance.now(), desiredNodes = new Map(graph.nodes.map(n => [n.id, n])), desiredEdges = new Map(graph.edges.map(e => [e.id, e]));
    const dirty = new Set(), geometryChanged = new Set(), recreated = new Set();
    let removed = 0, nodeChanges = 0;
    for (const [id, node] of this.nodes) {
      const next = desiredNodes.get(id);
      if (!next || !sameRect(node, next)) {
        geometryChanged.add(id); nodeChanges++;
        if (!next || node.width !== next.width || node.height !== next.height) recreated.add(id);
      }
    }
    for (const [id, edge] of this.edges) {
      const next = desiredEdges.get(id);
      if (!next || next.source !== edge.source || next.target !== edge.target || JSON.stringify(next.sourcePort) !== JSON.stringify(edge.sourcePort) || JSON.stringify(next.targetPort) !== JSON.stringify(edge.targetPort) || recreated.has(edge.source) || recreated.has(edge.target)) {
        this.removeEdge(id); removed++;
        if (next) dirty.add(id);
      } else if (geometryChanged.has(edge.source) || geometryChanged.has(edge.target)) dirty.add(id);
    }
    for (const id of recreated) {
      this.router.deleteShape(this.nodes.get(id).native); this.nodes.delete(id); this.obstacles.delete(id);
    }
    for (const node of graph.nodes) {
      const old = this.nodes.get(node.id);
      if (!old || !sameRect(old, node)) {
        const rectangle = this.polygon(node);
        if (!old) {
          const native = new this.A.ShapeRef(this.router, rectangle, 0);
          this.nodes.set(node.id, {...node, native, pins: new Map()});
          if (!geometryChanged.has(node.id)) nodeChanges++;
        } else { this.router.moveShape_poly(old.native, rectangle, true); Object.assign(old, node); }
        rectangle.delete(); this.obstacles.set(node.id, node, node);
        for (const segment of this.segments.query(node)) if (segmentBlocked(segment.a, segment.b, [node])) dirty.add(segment.id);
      }
    }
    for (const edge of graph.edges) if (!this.edges.has(edge.id)) {
      this.edges.set(edge.id, {...edge, native: null}); dirty.add(edge.id);
    }
    if (!nodeChanges && !dirty.size && !removed) return {paths: this.paths, changed: [], stats: {milliseconds: performance.now() - start, transaction: false, requested: 0, changed: 0, retained: this.paths.size, invalid: 0}};
    // libavoid maintains the obstacle visibility graph, but only affected
    // connectors participate in this transaction's global nudging solver.
    // Frozen routes remain in our segment index and lane allocator.
    for (const edge of this.edges.values()) if (edge.native) { this.router.deleteConnector(edge.native); edge.native = null; }
    const changed = [], invalidIds = [], ids = [...dirty].filter(id => this.edges.has(id)), unpacked = new Set(ids);
    let invalid = 0, nativeTransactions = 0;
    // Bound the size of the native lane solver even on a cold 1000-wire seek.
    // Each completed batch joins the frozen bundle before the next batch.
    for (let at = 0; at < Math.max(1, ids.length); at += 32) {
      const batch = ids.slice(at, at + 32);
      for (const id of batch) {
        const edge = this.edges.get(id), from = this.endpoint(edge.source, edge.sourcePort), to = this.endpoint(edge.target, edge.targetPort);
        edge.native = new this.A.ConnRef(this.router, from, to); edge.native.setRoutingType(this.A.ConnType.ConnType_Orthogonal);
        from.delete(); to.delete();
      }
      this.router.processTransaction(); this.transactions++; nativeTransactions++;
      for (const id of batch) {
        const edge = this.edges.get(id), route = edge.native.displayRoute();
        const points = simplify(Array.from({length: route.size()}, (_, i) => { const p = route.at(i); return {x: p.x, y: p.y}; }));
        const path = packPointerPath(points, id, this.segments, p => this.valid(p, edge), unpacked);
        unpacked.delete(id);
        if (!this.valid(path, edge)) { this.setPath(id, []); invalid++; invalidIds.push(id); }
        else if (!samePath(this.paths.get(id), path)) { this.setPath(id, path); changed.push(id); }
        if (at + 32 < ids.length) { this.router.deleteConnector(edge.native); edge.native = null; }
      }
    }
    let repairedRoutes = 0;
    if (invalid && !repairing) {
      // A changed hierarchy can leave native shape-pin state without a path.
      // Rebuild ONLY this region's native index and retry only failed routes;
      // all valid display routes and their lane reservations remain fixed.
      const fresh = new PointerRouter(this.A); fresh.terminalSlots = this.terminalSlots;
      for (const [id, path] of this.paths) if (path.length) fresh.setPath(id, path);
      const retry = fresh.update({...graph, edges: graph.edges.filter(e => invalidIds.includes(e.id))}, true);
      for (const [id, edge] of this.edges) if (!fresh.edges.has(id)) fresh.edges.set(id, {...edge, native: null});
      for (const id of invalidIds) if (fresh.paths.get(id)?.length) { repairedRoutes++; changed.push(id); }
      invalid -= repairedRoutes; nativeTransactions += retry.stats.nativeTransactions ?? 0;
      const total = this.transactions + fresh.transactions;
      this.dispose(); Object.assign(this, fresh); this.transactions = total;
    }
    return {paths: this.paths, changed, stats: {milliseconds: performance.now() - start, transaction: true, requested: dirty.size,
      changed: changed.length, retained: this.paths.size - changed.length - invalid, invalid, repairedRoutes, nativeTransactions, transactions: this.transactions}};
  }
  terminal(nodeId, edgeId, side) {
    const key = `${nodeId}:${side}`;
    if (!this.terminalSlots.has(key)) this.terminalSlots.set(key, new Map());
    const slots = this.terminalSlots.get(key);
    if (!slots.has(edgeId)) {
      // Low-discrepancy insertion leaves existing terminal ports fixed.
      let index = slots.size + 1, fraction = 0, power = 0.5;
      while (index) { fraction += (index % 2) * power; index = Math.floor(index / 2); power /= 2; }
      slots.set(edgeId, fraction);
    }
    return {key: `${side}:${edgeId}`, x: side === 'right' ? 1 : 0, y: 0.12 + slots.get(edgeId) * 0.76, side};
  }
  dispose() { this.router.delete(); this.nodes.clear(); this.edges.clear(); this.paths.clear(); }
}
