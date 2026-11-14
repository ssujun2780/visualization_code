import {PointerRouter} from './pointer-router.js';
import {SpatialIndex, segmentBox} from './spatial-index.js';
import {segmentBlocked} from './routing.js';
import {graphKey} from './pointer-graph.js';

const partKey = part => JSON.stringify([part.nodes.map(n => [n.id,n.x,n.y,n.width,n.height]),
  part.edges.map(e => [e.id,e.source,e.target,e.sourcePort,e.targetPort])]);

// Route inside each owning field, then through a separate shared backbone.
// Foreign fields are solid obstacles only in the backbone, so nested storage
// never has to be flattened into overlapping obstacles.
export class PointerWiring {
  constructor(Avoid, {measureQuality = true} = {}) { this.A = Avoid; this.measureQuality = measureQuality; this.routers = new Map(); this.gates = new Map(); }
  router(id) {
    if (!this.routers.has(id)) this.routers.set(id, new PointerRouter(this.A));
    return this.routers.get(id);
  }
  update(graph) {
    const started = performance.now();
    const key = graphKey(graph);
    if (key === this.key) return {...this.result, stats: {...this.result.stats, milliseconds: performance.now() - started, transactions: 0, requested: 0, changed: 0, retained: this.result.paths.length}};
    const {parts, pieces, regions} = this.partition(graph);
    const results = new Map();
    for (const [id, part] of parts) {
      if (!part.edges.length && !this.routers.has(id)) continue;
      results.set(id, this.router(id).update(part));
    }
    for (const [id, router] of this.routers) if (id !== 'backbone' && !regions.has(id)) { router.dispose(); this.routers.delete(id); }
    this.key = key;
    return this.result = this.assemble(graph, pieces, results, started, this.result?.paths);
  }
  partition(graph) {
    const regions = new Map(graph.regions.map(r => [r.id, r])), nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const parts = new Map([...regions.keys()].map(id => [id, {nodes: [], edges: []}]));
    const backbone = {nodes: [...graph.regions, ...(graph.barriers ?? [])], edges: []}, pieces = new Map(), liveGates = new Map();
    for (const node of graph.nodes) parts.get(node.region)?.nodes.push(node);
    const gate = (region, edge, side, role) => {
      const key = `${region.id}:${side}`;
      if (!this.gates.has(key)) this.gates.set(key, new Map());
      if (!liveGates.has(key)) liveGates.set(key, new Set());
      const entries = this.gates.get(key), id = `${edge.id}:${role}`;
      liveGates.get(key).add(id);
      if (!entries.has(id)) {
        const used = new Set(entries.values()); let slot = 0; while (used.has(slot)) slot++;
        entries.set(id, slot);
      }
      const slot = entries.get(id), available = Math.max(30, region.height - 165);
      const y = Math.min(available - 1, 5 + slot * 5);
      const portalId = `portal:${key}`;
      const portal = {id: portalId, x: side === 'right' ? region.x + region.width - 15 : region.x + 13, y: region.y + 80, width: 2, height: available};
      const inside = side === 'right' ? 'left' : 'right';
      const localPort = {key: id, x: side === 'right' ? 0 : 1, y: y / available, side: inside};
      const outerPort = {key: id, x: side === 'right' ? 1 : 0, y: (80 + y) / region.height, side};
      if (!parts.get(region.id).nodes.some(n => n.id === portalId)) parts.get(region.id).nodes.push(portal);
      return {portalId, localPort, outerPort};
    };
    for (const edge of graph.edges) {
      const source = nodes.get(edge.source), target = nodes.get(edge.target);
      if (!source || !target || !regions.has(source.region) || !regions.has(target.region)) continue;
      if (source.region === target.region) {
        parts.get(source.region).edges.push(edge); pieces.set(edge.id, [{region: source.region, id: edge.id}]); continue;
      }
      const sr = regions.get(source.region), tr = regions.get(target.region);
      const side = tr.x + tr.width / 2 >= sr.x + sr.width / 2 ? 'right' : 'left';
      const from = gate(sr, edge, side, 'out'), to = gate(tr, edge, side === 'right' ? 'left' : 'right', 'in');
      const a = `${edge.id}:out`, b = `${edge.id}:backbone`, c = `${edge.id}:in`;
      parts.get(source.region).edges.push({id: a, source: source.id, target: from.portalId, targetPort: from.localPort});
      backbone.edges.push({id: b, source: sr.id, target: tr.id, sourcePort: from.outerPort, targetPort: to.outerPort});
      parts.get(target.region).edges.push({id: c, source: to.portalId, target: target.id, sourcePort: to.localPort});
      pieces.set(edge.id, [{region: sr.id, id: a}, {region: 'backbone', id: b}, {region: tr.id, id: c}]);
    }
    for (const [key, slots] of this.gates) for (const id of slots.keys()) if (!liveGates.get(key)?.has(id)) slots.delete(id);
    for (const region of graph.regions) {
      const {x, y, width, height} = region;
      parts.get(region.id).nodes.push(...[
        {id: `wall:${region.id}:top`, x: x - 40, y: y - 40, width: width + 80, height: 100},
        {id: `wall:${region.id}:bottom`, x: x - 40, y: y + height - 45, width: width + 80, height: 85},
        {id: `wall:${region.id}:left`, x: x - 40, y, width: 40, height},
        {id: `wall:${region.id}:right`, x: x + width, y, width: 40, height},
      ]);
    }
    parts.set('backbone', backbone);
    return {parts, pieces, regions};
  }
  snapshot() {
    const seed = new Map();
    for (const [key, slots] of this.gates) seed.set('wire:g:' + key, [...slots]);
    for (const [region, router] of this.routers) {
      for (const [id, path] of router.paths) seed.set('wire:s:' + JSON.stringify([region, id]), path);
      for (const [id, slots] of router.terminalSlots) seed.set('wire:t:' + JSON.stringify([region, id]), [...slots]);
    }
    return seed;
  }
  revise(previous, graph, seed, oldPaths = []) {
    const started = performance.now(), paths = new Map(), terminals = new Map();
    for (const [key, value] of seed) {
      if (key.startsWith('wire:g:')) this.gates.set(key.slice(7), new Map(value));
      if (key.startsWith('wire:s:') || key.startsWith('wire:t:')) {
        const [region, id] = JSON.parse(key.slice(7)), target = key.startsWith('wire:s:') ? paths : terminals;
        if (!target.has(region)) target.set(region, new Map()); target.get(region).set(id, value);
      }
    }
    const base = this.partition(previous), next = this.partition(graph), results = new Map();
    for (const [id, part] of next.parts) {
      const old = base.parts.get(id) ?? {nodes: [], edges: []}, saved = paths.get(id) ?? new Map();
      if (partKey(old) === partKey(part)) {
        results.set(id, {paths: saved, stats: {retained: saved.size}}); continue;
      }
      const router = this.router(id); router.prime(old, saved, terminals.get(id));
      const result = router.update(part); result.stats.seedTransactions = 1; results.set(id, result);
    }
    return this.assemble(graph, next.pieces, results, started, oldPaths);
  }
  assemble(graph, pieces, results, started, previousPaths = []) {
    const totals = {transactions: 0, seedTransactions: 0, requested: 0, changed: 0, retained: 0, invalid: 0, repairedRoutes: 0};
    for (const result of results.values()) for (const key of Object.keys(totals)) totals[key] += key === 'transactions' ? result.stats.nativeTransactions ?? 0 : result.stats[key] ?? 0;
    const paths = [], missing = [];
    for (const edge of graph.edges) {
      const sections = (pieces.get(edge.id) ?? []).map(part => results.get(part.region)?.paths.get(part.id));
      if (!sections.length || sections.some(path => !path?.length)) { missing.push(edge.id); continue; }
      const path = [];
      for (const section of sections) {
        // Adjacent parts share the same gate y-coordinate; the short bridge is
        // entirely in the owning field's reserved side margin.
        if (path.length && path.at(-1).x !== section[0].x && path.at(-1).y !== section[0].y) path.push({x: section[0].x, y: path.at(-1).y});
        path.push(...section);
      }
      paths.push({id: edge.id, source: edge.source, target: edge.target, points: path});
    }
    // Full all-pairs crossing statistics belong to audits, not animation ticks.
    // Updated paths are always checked against obstacles in PointerRouter.
    const quality = this.measureQuality ? {...wiringQuality(graph, paths), measured: true} : {measured: false, nodeCrossings: null, overlaps: null};
    const oldPaths = new Map(previousPaths.map(p => [p.id, JSON.stringify(p.points)]));
    const changed = paths.filter(p => oldPaths.get(p.id) !== JSON.stringify(p.points)).length;
    return {paths, missing, quality, stats: {...totals, changedSections: totals.changed, retainedSections: totals.retained,
      changed, retained: paths.length - changed, milliseconds: performance.now() - started, nodes: graph.nodes.length, edges: graph.edges.length}};
  }
  dispose() { for (const router of this.routers.values()) router.dispose(); this.routers.clear(); this.gates.clear(); }
}

export function wiringQuality(graph, paths) {
  const obstacles = new SpatialIndex(), segments = new SpatialIndex();
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  for (const node of [...graph.nodes, ...(graph.barriers ?? [])]) obstacles.set(node.id, node, node);
  let nodeCrossings = 0, overlaps = 0, crossings = 0, bends = 0, length = 0;
  const crowded = new Set();
  for (const route of paths) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    if (a.x === b.x && a.y === b.y) continue;
    const box = segmentBox(a, b, 0.05);
    const blockers = obstacles.query(box).filter(n => n.id !== route.source && n.id !== route.target);
    if (segmentBlocked(a, b, blockers)) { nodeCrossings++; for (const node of blockers) if (segmentBlocked(a, b, [node])) crowded.add(node.objectId); }
    for (const other of segments.query(box)) {
      if (other.id === route.id) continue;
      const horizontal = a.y === b.y, oh = other.a.y === other.b.y;
      if (horizontal === oh) {
        const same = horizontal ? Math.abs(a.y - other.a.y) < 0.001 : Math.abs(a.x - other.a.x) < 0.001;
        const shared = horizontal ? Math.min(Math.max(a.x, b.x), Math.max(other.a.x, other.b.x)) - Math.max(Math.min(a.x, b.x), Math.min(other.a.x, other.b.x))
          : Math.min(Math.max(a.y, b.y), Math.max(other.a.y, other.b.y)) - Math.max(Math.min(a.y, b.y), Math.min(other.a.y, other.b.y));
        // A tiny common terminal stub is allowed at the actual shared target.
        if (same && shared > 8) { overlaps++; crowded.add(nodes.get(route.target)?.objectId); }
      } else if (segmentBlocked(a, b, [{...segmentBox(other.a, other.b, 0.01)}])) crossings++;
    }
    segments.set(`${route.id}:${i}`, box, {id: route.id, a, b});
    length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (i > 1) { const previous = route.points[i - 2]; if ((previous.x === a.x) !== (a.x === b.x)) bends++; }
  }
  return {nodeCrossings, overlaps, crossings, bends, length, crowdedObjects: [...crowded].filter(Boolean)};
}
