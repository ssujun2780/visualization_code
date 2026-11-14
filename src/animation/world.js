import {TOOL_DEVICES} from './tools.js';
import {cellId, referenceEdges,memoryPresentation} from './memory.js';
import {layoutMemory, containerId} from './object-view.js';
import {structuredMemory} from './structured-memory.js';
import {structureEdgePaths} from './structure-ink.js';

export const SYSTEM_MATS = [
  {id: 'tool:workbench', name: '도구 작업대', x: 590, y: 100, width: 440, height: 250},
  {id: 'tool:input', name: '입력', x: 50, y: 410, width: 440, height: 360},
  {id: 'tool:output', name: '출력', x: 514, y: 410, width: 440, height: 360},
];

export const rectangleCenter = rectangle => ({x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2});
export const containsPoint = (rectangle, point) => point.x >= rectangle.x && point.y >= rectangle.y &&
  point.x <= rectangle.x + rectangle.width && point.y <= rectangle.y + rectangle.height;
export function connectorPorts(from, to) {
  const a = rectangleCenter(from);
  const b = rectangleCenter(to);
  if (Math.abs(b.x - a.x) > Math.abs(b.y - a.y)) {
    const right = b.x >= a.x;
    return {from: {x: right ? from.x + from.width : from.x, y: a.y}, to: {x: right ? to.x : to.x + to.width, y: b.y}};
  }
  const below = b.y >= a.y;
  return {from: {x: a.x, y: below ? from.y + from.height : from.y}, to: {x: b.x, y: below ? to.y : to.y + to.height}};
}
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const ownerKey = object => object.frameId ? `frame:${object.frameId}` : `memory:${object.storage === 'heap' ? 'heap' : 'static'}`;
const MAT_GAP = 24;
export const memoryBoxSize = object => { const view = layoutMemory(object); return {width: view.width, height: view.height}; };
const sameRectangle = (a, b) => a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function nearestFreeCoordinate(origin, intervals) {
  const merged = [];
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && interval.start < previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({...interval});
  }
  const blocked = merged.find(interval => origin > interval.start && origin < interval.end);
  if (!blocked) return origin;
  return origin - blocked.start <= blocked.end - origin ? blocked.start : blocked.end;
}

// Project onto the closest free horizontal or vertical position. Merging all
// blocked intervals also handles chains of neighbors without repeated nudges.
export function avoidMatOverlap(rectangle, obstacles, gap = MAT_GAP) {
  const horizontal = [];
  const vertical = [];
  for (const obstacle of obstacles) {
    if (rectangle.y < obstacle.y + obstacle.height + gap && rectangle.y + rectangle.height + gap > obstacle.y) {
      horizontal.push({start: obstacle.x - rectangle.width - gap, end: obstacle.x + obstacle.width + gap});
    }
    if (rectangle.x < obstacle.x + obstacle.width + gap && rectangle.x + rectangle.width + gap > obstacle.x) {
      vertical.push({start: obstacle.y - rectangle.height - gap, end: obstacle.y + obstacle.height + gap});
    }
  }
  const x = nearestFreeCoordinate(rectangle.x, horizontal);
  const y = nearestFreeCoordinate(rectangle.y, vertical);
  return Math.abs(x - rectangle.x) <= Math.abs(y - rectangle.y) ? {...rectangle, x} : {...rectangle, y};
}

export function enclosingRectangle(rectangles, padding = 0) {
  if (!rectangles.length) return {x: 0, y: 0, width: 1, height: 1};
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rectangle of rectangles) {
    left = Math.min(left, rectangle.x);
    top = Math.min(top, rectangle.y);
    right = Math.max(right, rectangle.x + rectangle.width);
    bottom = Math.max(bottom, rectangle.y + rectangle.height);
  }
  return {x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2};
}

export class WorldCamera {
  constructor() { this.x = 0; this.y = 0; this.scale = 1; }

  toWorld(point) { return {x: (point.x - this.x) / this.scale, y: (point.y - this.y) / this.scale}; }
  toScreen(point) { return {x: point.x * this.scale + this.x, y: point.y * this.scale + this.y}; }
  pan(dx, dy) { this.x += dx; this.y += dy; }

  zoom(factor, point) {
    const world = this.toWorld(point);
    this.scale = Math.max(0.000001, Math.min(8, this.scale * factor));
    this.x = point.x - world.x * this.scale;
    this.y = point.y - world.y * this.scale;
  }

  fit(rectangle, width, height) {
    if (width <= 0 || height <= 0) return;
    this.scale = Math.max(0.000001, Math.min(1.6, width / rectangle.width, height / rectangle.height) * 0.9);
    const center = rectangleCenter(rectangle);
    this.x = width / 2 - center.x * this.scale;
    this.y = height / 2 - center.y * this.scale;
  }

  focus(rectangle, width, height) {
    const center = rectangleCenter(rectangle);
    this.x = width / 2 - center.x * this.scale;
    this.y = height / 2 - center.y * this.scale;
  }

  view(width, height) {
    const origin = this.toWorld({x: 0, y: 0});
    return {...origin, width: width / this.scale, height: height / this.scale};
  }

  visible(rectangle, width, height) { return intersects(this.view(width, height), rectangle); }
}

// Presentation coordinates belong to the viewer, independently of trace state.
// An object's offset is relative to its owner so moving a mat carries its boxes.
export class WorldLayout {
  constructor() { this.reset(); }

  reset() {
    this.positions = new Map(SYSTEM_MATS.map(mat => [mat.id, {x: mat.x, y: mat.y}]));
    this.pinned = new Set();
    this.revision = 0;
    this.cache = new WeakMap();
    this.previousMats = new Map();
    this.recentMove = null;
    this.draggingKey = null;
    this.collapsed = new Set(); this.foldRevision = 0; this.projections = new WeakMap();
    this.windows=new Map();
    this.followingTools=new Set();
    this.userRevision=0;this.userPositions=new Map();this.presentedGeometry=null;this.motionGeometry=null;this.structurePlacements=new Map();
  }

  projection(object) {
    const old = this.projections.get(object);
    const presentation=this.prepared?.at(object.id,this.boundary??-1);
    const sharedRanges=this.prepared?.rangesAt(object.id,this.boundary??-1);
    if (old?.revision === this.foldRevision&&old.presentation===presentation&&old.sharedRanges===sharedRanges) return old.view;
    const previewWindows=[...[...this.windows.values()].filter(window=>window.objectId===object.id),...(sharedRanges??[]),...(presentation?.layoutNodes??[]).flatMap(n=>n.ranges.filter(r=>r.objectId===object.id).map(r=>({...r,capacity:8})))];
    const memory=previewWindows.length?memoryPresentation({resolveType:this.resolveType??(type=>typeof type==='object'?type:null)},new Map([[object.id,object]]),{previewWindows}).get(object.id):object;
    const view = {...(presentation?structuredMemory(memory,presentation,this.collapsed,this.windows):layoutMemory(memory, this.collapsed,this.windows)),memory};
    this.projections.set(object, {revision: this.foldRevision, presentation,sharedRanges,view}); return view;
  }

  setPrepared(prepared){this.prepared=prepared;this.cache=new WeakMap();this.projections=new WeakMap();this.presentedGeometry=null;this.userRevision++;this.revision++;}

  sizeOf(object) { const {width, height} = this.projection(object); return {width, height}; }

  resizeContainer(target,width,height,{preview=false}={}){
    width=Math.max(210,Math.min(4096,width));height=Math.max(132,Math.min(4096,height));
    if(!Number.isFinite(width)||!Number.isFinite(height))return;
    this.windows.set(target.logicalId??target.id,{objectId:target.objectId,offset:target.offset,size:target.size,width,height,
      root:(target.logicalId??target.id)===containerId(target.objectId),
      capacity:Math.max(1,Math.floor((width-8)/112))*Math.max(1,Math.floor((height-46)/86))});
    const key=`object:${target.objectId}`;this.pinned.add(key);if(!this.userPositions.has(key))this.userPositions.set(key,{...this.positions.get(key)});this.recentMove=key;this.draggingKey=preview?key:null;
    this.userRevision++;this.presentedGeometry=null;
    this.foldRevision++;this.revision++;
  }

  toggleContainer(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.foldRevision++; this.revision++;this.userRevision++;this.presentedGeometry=null;
  }

  move(key, point, {preview = false} = {}) {
    this.positions.set(key, {...point});
    this.userPositions.set(key,{...point});this.userRevision++;this.presentedGeometry=null;
    this.pinned.add(key);
    this.recentMove = key;
    this.draggingKey = preview ? key : null;
    this.revision++;
  }

  finishMove() {
    if (!this.draggingKey) return;
    this.draggingKey = null;
    this.revision++;this.userRevision++;this.presentedGeometry=null;
  }

  placeTool(id,point){
    if(this.pinned.has(id))return false;
    const old=this.positions.get(id);
    if(old?.x===point.x&&old?.y===point.y)return false;
    this.positions.set(id,{x:point.x,y:point.y});this.recentMove=id;this.revision++;return true;
  }

  synchronize(state) {
    let changed = false;
    const groups = new Map([...state.frames.values()].map(frame => [`frame:${frame.id}`, {id: `frame:${frame.id}`, frameId: frame.id, name: frame.name, alive: frame.alive, objects: []}]));
    for (const object of state.objects.values()) {
      const positionKey=`object:${object.id}`,supplied=this.prepared?.placementsAt?.(state.boundaryIndex??-1)?.get(object.id);
      if(supplied&&supplied.size===object.size&&!this.pinned.has(positionKey)&&this.structurePlacements.get(object.id)!==supplied.boundary){
        this.positions.set(positionKey,{x:supplied.x,y:supplied.y});this.structurePlacements.set(object.id,supplied.boundary);changed=true;
      }
      const key = ownerKey(object);
      if (!groups.has(key)) groups.set(key, {id: key, name: key === 'memory:heap' ? 'HEAP' : '전역 · 정적', alive: false, objects: []});
      const group = groups.get(key);
      group.objects.push(object);
      if (!object.frameId && object.alive) group.alive = true;
      if (!this.positions.has(`object:${object.id}`)) {
        const parameters = group.objects.filter(object => object.parameter).length;
        const slot = object.parameter ? object.parameterIndex : parameters ? Math.ceil(parameters / 3) * 3 + group.objects.length - 1 - parameters : group.objects.length - 1;
        let position = this.prepared?.placements.get(object.id)??{x: 35 + slot % 3 * 170, y: 90 + Math.floor(slot / 3) * 130};
        const size = this.sizeOf(object);
        const others = group.objects.filter(other => other !== object && other.alive).map(other => ({...this.positions.get(`object:${other.id}`), ...this.sizeOf(other)}));
        position = avoidMatOverlap({...position, ...size}, others, 42);
        this.positions.set(`object:${object.id}`, {x: position.x, y: position.y});
        changed = true;
      }
    }
    // Growing an aggregate can require a little local space. Keep pinned boxes
    // fixed and move only objects whose reserved corridors became occupied.
    for (const group of groups.values()) {
      const placed = [];
      const sorted = [...group.objects].filter(object => object.alive).sort((a, b) => Number(this.pinned.has(`object:${b.id}`)) - Number(this.pinned.has(`object:${a.id}`)));
      for (const object of sorted) {
        const key = `object:${object.id}`, original = {...this.positions.get(key), ...this.sizeOf(object)};
        const next = this.pinned.has(key) ? original : avoidMatOverlap(original, placed, 42);
        if (next.x !== original.x || next.y !== original.y) { this.positions.set(key, {x: next.x, y: next.y}); changed = true; }
        placed.push(next);
      }
    }
    const placed = [];
    for (const group of groups.values()) group.portCount = 0;
    for (const edge of referenceEdges(state)) {
      const a = state.objects.get(edge.sourceObjectId), b = state.objects.get(edge.targetObjectId);
      if (!b?.alive || ownerKey(a) === ownerKey(b)) continue;
      for (const key of [ownerKey(a), ownerKey(b)]) if (groups.has(key)) groups.get(key).portCount++;
    }
    for (const group of groups.values()) {
      if (!this.positions.has(group.id)) {
        let y = 100;
        const local = this.groupRectangle(group, {x: 50, y});
        for (const obstacle of [...placed].sort((a, b) => a.y - b.y)) {
          const candidate = {...local, y: local.y + y - 100};
          if (intersects(candidate, {...obstacle, height: obstacle.height + 60})) y = obstacle.y + obstacle.height + 60;
        }
        this.positions.set(group.id, {x: 50, y});
        changed = true;
      }
      const rectangle = this.groupRectangle(group, this.positions.get(group.id));
      if(group.alive)placed.push(rectangle);
    }
    if (changed) this.revision++;
    return groups;
  }

  arrangeMats(mats, groups) {
    const containingMat = key => {
      if (!key?.startsWith('object:')) return key;
      const objectId = key.slice('object:'.length);
      return [...groups.values()].find(group => group.objects.some(object => object.id === objectId))?.id;
    };
    const movingMat = containingMat(this.recentMove);
    const previewMat = containingMat(this.draggingKey);
    const visible = [...mats.values()].filter(mat => mat.alive && mat.id !== previewMat);
    const priority = mat => {
      if(this.followingTools.has(mat.id)&&!this.pinned.has(mat.id))return 4;
      if (mat.id === movingMat) return 3;
      if (sameRectangle(this.previousMats.get(mat.id), mat.rectangle)) return 0;
      return this.pinned.has(mat.id)||this.previousMats.has(mat.id) ? 1 : 2;
    };
    visible.sort((a, b) => priority(a) - priority(b));
    const obstacles = [];
    for (const mat of visible) {
      const original = mat.rectangle;
      const rectangle = avoidMatOverlap(original, obstacles);
      if (rectangle.x !== original.x || rectangle.y !== original.y) {
        const anchor = this.positions.get(mat.id);
        this.positions.set(mat.id, {x: anchor.x + rectangle.x - original.x, y: anchor.y + rectangle.y - original.y});
        mat.rectangle = rectangle;
        this.revision++;
      }
      obstacles.push(rectangle);
    }
    this.previousMats = new Map([...mats.values()].filter(mat => mat.alive).map(mat => [mat.id, {...mat.rectangle}]));
    if (!this.draggingKey) this.recentMove = null;
  }

  groupRectangle(group, anchor) {
    const boxes = group.objects.map(object => ({...this.positions.get(`object:${object.id}`), ...this.sizeOf(object)}));
    // Container headers are real routing obstacles too. Reserve enough space
    // for both the field gateways and libavoid's obstacle buffer on each side.
    const local = enclosingRectangle([{x: 0, y: 0, width: 400, height: Math.max(240, Math.ceil((group.portCount ?? 0) / 32) * 160 + 165)}, ...boxes.map(box => ({x: box.x - 50, y: box.y - 90, width: box.width + 100, height: box.height + 150}))]);
    return {...local, x: anchor.x + local.x, y: anchor.y + local.y};
  }

  resolve(state) {
    this.boundary=state.boundaryIndex??-1;
    if(this.motionGeometry?.has(this.boundary))return this.motionGeometry.get(this.boundary);
    if(this.presentedGeometry?.has(this.boundary))return this.presentedGeometry.get(this.boundary);
    const existing = this.cache.get(state);
    if (existing?.revision === this.revision) return existing;
    const groups = this.synchronize(state);
    const mats = new Map();
    const objects = new Map();
    const cells = new Map();
    const containers = new Map(), ports = new Map(), anchors = new Map(),structureEdges=[],structureNodes=new Map(),structureAnnotations=[],pendingStructures=[];
    for (const group of groups.values()) {
      const anchor = this.positions.get(group.id);
      const rectangle = this.groupRectangle(group, anchor);
      mats.set(group.id, {...group, rectangle});
    }
    for (const mat of SYSTEM_MATS) mats.set(mat.id, {...mat, alive: true, rectangle: this.toolRectangle(mat.id)});
    this.arrangeMats(mats, groups);
    for (const group of groups.values()) {
      const anchor = this.positions.get(group.id);
      for (const object of group.objects) {
        const relative = this.positions.get(`object:${object.id}`);
        const rectangle = {x: anchor.x + relative.x, y: anchor.y + relative.y, ...this.sizeOf(object)};
        objects.set(object.id, rectangle);
        const view = this.projection(object), translate = box => ({...box, x: rectangle.x + box.x, y: rectangle.y + box.y});
        for (const [id, cell] of view.cells) cells.set(id, translate(cell));
        for (const [id, port] of view.ports) ports.set(id, {...translate(port), aggregate: port.kind === 'aggregate', root: port.id === containerId(object.id)});
        for (const [id, container] of view.groups) containers.set(id, {...translate(container), header: translate(container.header), toggle: translate(container.toggle),resizeHandle:translate(container.resizeHandle)});
        for (const [id, target] of view.anchors) anchors.set(id, target);
        if(object.alive&&view.structure){const s=view.structure;
          for(const [id,node]of s.nodeRects){const key=`${s.id}:${id}`;if(!structureNodes.has(key))structureNodes.set(key,{...translate(node),relationId:s.id,view:s.view,objectId:object.id});}
          structureAnnotations.push(...s.annotations.map(a=>({...a,x:a.x+rectangle.x,y:a.y+rectangle.y,objectId:object.id})));
          pendingStructures.push({s,objectId:object.id});
        }
      }
    }
    const rectangles = [...mats.values()].filter(mat => mat.alive).map(mat => mat.rectangle);
    const seen=new Set(),semanticWires=new Set();
    for(const {s,objectId}of pendingStructures){
      const supplied=[...s.edges];
      if(s.view==='disjoint-set')for(const n of s.nodeRects.values()){const original=this.prepared?.at(objectId,this.boundary)?.relation?.nodes?.find(p=>p.id===n.nodeId),parent=original?.parent;
        if(parent===undefined)continue;const p=[...structureNodes.values()].find(p=>p.relationId===s.id&&(p.nodeId===parent||String(p.nodeLabel)===String(parent)));
        if(p&&p.nodeId!==n.nodeId&&!supplied.some(e=>e.from===n.nodeId))supplied.push({id:`parent:${n.nodeId}`,from:n.nodeId,to:p.nodeId,directed:true});
      }
      for(const edge of supplied){const key=`${s.id}:${edge.id??`${edge.from}:${edge.to}:${edge.roleId}`}`;if(seen.has(key))continue;
        const a=structureNodes.get(`${s.id}:${edge.from}`),b=structureNodes.get(`${s.id}:${edge.to}`);if(!a||!b)continue;
        seen.add(key);structureEdges.push({...edge,objectId,fromNodeId:edge.from,toNodeId:edge.to,from:a,to:b,view:s.view,directed:s.directed??edge.directed??true});
        for(const id of edge.storedEdgeIds??[])semanticWires.add(id);
      }
    }
    const values=new Map([...cells.values()].map(c=>[`${c.objectId}:${c.offset}:${c.size}`,c.value?.decimal])),structurePorts=[];
    for(const p of structureEdgePaths(structureEdges,{readRange:r=>values.get(`${r.objectId}:${r.offset}:${r.size}`)}))for(const id of p.ids){const edge=structureEdges.find(e=>e.id===id);if(edge?.weightRange)structurePorts.push({range:edge.weightRange,ownerObjectId:edge.from.objectId,rectangle:{x:p.label.x-22,y:p.label.y-12,width:44,height:24}});}
    const result = {revision: this.revision, mats, objects, cells, containers, ports, anchors,structureEdges,structureNodes,structureAnnotations,semanticWires,structurePorts,bounds: enclosingRectangle(rectangles, 40)};
    this.cache.set(state, result);
    return result;
  }

  toolRectangle(id) {
    const mat = SYSTEM_MATS.find(mat => mat.id === id);
    return {...mat, ...this.positions.get(id)};
  }

  deviceRectangle(id) {
    const workbench = this.toolRectangle('tool:workbench');
    const device = TOOL_DEVICES.find(device => device.id === id);
    return {...device, x: workbench.x + device.x, y: workbench.y + device.y};
  }

  returnPoint(frameId, state) {
    const rectangle = this.resolve(state).mats.get(`frame:${frameId}`)?.rectangle;
    return rectangle ? {x: rectangle.x + rectangle.width - 45, y: rectangle.y + rectangle.height - 30} : null;
  }

  hitTest(state, point, resizeSize=20) {
    const geometry = this.resolve(state);
    for (const object of [...state.objects.values()].reverse()) {
      const rectangle = geometry.objects.get(object.id);
      if (!object.alive || !containsPoint(rectangle, point)) continue;
      for(const n of geometry.structureNodes?.values()??[])if(n.objectId===object.id&&n.diagramOnly&&containsPoint(n,point))return {key:`structure:${n.relationId}:${n.nodeId}`,logicalId:containerId(object.id),graphNodeId:n.nodeId,objectId:object.id,kind:'aggregate',dragKey:`object:${object.id}`,name:n.nodeLabel};
      const groups = [...geometry.containers.values()].filter(g => g.objectId === object.id && !g.hidden);
      for(const group of [...groups].reverse())if(!group.collapsed&&containsPoint({x:group.x+group.width-Math.max(20,resizeSize),y:group.y+group.height-Math.max(20,resizeSize),width:Math.max(20,resizeSize),height:Math.max(20,resizeSize)},point))
        return {...group,key:group.id,logicalId:group.id,kind:'resize',name:group.label};
      for (const group of [...groups].reverse()) if (containsPoint(group.toggle, point)) return {key: group.id, logicalId: group.id, kind: 'toggle', objectId: object.id, name: group.label};
      for (const cell of geometry.cells.values()) if (cell.objectId === object.id && !cell.hidden && containsPoint(cell, point)) {
        return {key: object.renderCells ? `cell:${cell.id}` : `object:${object.id}`, logicalId: cell.id, graphNodeId:cell.nodeId,objectId: object.id, kind: object.renderCells ? 'cell' : 'object',
          dragKey: `object:${object.id}`, name: cell.shape==='circle'&&cell.value?.decimal!==undefined?`${cell.label} · ${cell.value.decimal}`:cell.label};
      }
      for (const group of [...groups].reverse()) if (containsPoint(group, point)) return {key: group.id, logicalId: group.id, kind: 'aggregate',
        objectId: object.id, header: containsPoint(group.header, point), dragKey: `object:${object.id}`, name: group.label};
    }
    for (const mat of [...geometry.mats.values()].reverse()) {
      if (mat.alive && containsPoint({...mat.rectangle, height: 52}, point)) return {key: mat.id, dragKey: mat.id, kind: 'mat', name: mat.name};
    }
    return null;
  }

  openCorridor(state, objectIds, amount = 18) {
    // Bounded local relaxation requested by the wiring quality checker. It is
    // presentation-only, keeps ownership and never moves a user-pinned object.
    let moved = 0;
    for (const id of objectIds) {
      const object = state.objects.get(id), key = `object:${id}`;
      if (!object?.alive || this.pinned.has(key) || moved >= 4) continue;
      const position = this.positions.get(key);
      if (position) { this.positions.set(key, {x: position.x + amount, y: position.y + amount}); moved++; }
    }
    if (moved) this.revision++;
    return moved;
  }
}
