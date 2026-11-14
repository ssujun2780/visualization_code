import {emptyScene, formatValue, displayScene} from './playback.js';
import {hiddenStorageEndpoint} from './source-storage.js';
import {ToolFollower} from './tool-placement.js';
import {WorldCamera, WorldLayout, rectangleCenter, enclosingRectangle} from './world.js';
import {toolAppearances, spaceEffect} from './tools.js';
import {valueEffectForEvent, transferPresentation, calculationForEvent,dataFlowForEvent} from './transfers.js';
import {conditionForEvent} from './conditions.js';
import {isAttempt} from './faults.js';
import {routeTransfers, pointAlong, transferBadges} from './transfer-routing.js';
import {pointerGraph} from './pointer-graph.js';
import {PointerClient} from './pointer-client.js';
import {restoreLayout} from './presentation-journal.js';
import {connectionFocus, containerId, visibleMemoryCells,focusForTargets} from './object-view.js';
import {cellId} from './memory.js';
import {pointerAppearance} from './pointer-appearance.js';
import {structureEdgePaths,strokeStructureEdge,structurePort} from './structure-ink.js';
import {motionProgress,interpolateStructureGeometry,attachMovingRoute,mixFill,semanticFill,geometryChanges,hasStructureMotion} from './structure-motion.js';
import {treePresentation} from './structure-layout.js';
import {effectForEvent,externalCallForEvent,streamText,ioDisplayState} from './effects.js';

export const colors = {SPACE: '#81d9c2', READ: '#83baff', CALC: '#c4a2ff', WRITE: '#ffce85', FLOW: '#adb7c9', ERROR: '#ff969e'};
export const transferColors = {base: '#ed9b43', active: '#ffe0a0'};
const ease = progress => progress * progress * (3 - 2 * progress);
const center = rectangleCenter;

export class SceneCanvas {
  constructor(canvas,{transferCanvas=null}={}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.transferCanvas = transferCanvas;
    this.transferContext = transferCanvas?.getContext('2d');
    this.camera = new WorldCamera();
    this.layout = new WorldLayout();
    this.toolFollower=new ToolFollower(this.layout);
    this.wiring = new PointerClient();
    this.wireGraphs = new WeakMap();
    this.sceneState = emptyScene();
    this.width = 0;
    this.height = 0;
    this.onCameraChange = () => {};
    this.onSelectionChange = () => {};
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      if (this.drag) return;
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? this.height : 1;
      if (event.ctrlKey || event.metaKey) {
        const point = this.canvasPoint(event);
        this.zoom(Math.exp(-event.deltaY * unit * 0.002), point.x, point.y);
      } else {
        this.camera.pan(-(event.deltaX + (event.shiftKey ? event.deltaY : 0)) * unit, event.shiftKey ? 0 : -event.deltaY * unit);
      }
    }, {passive: false});
    canvas.addEventListener('pointerdown', event => {
      if (![0, 1].includes(event.button) || this.drag) return;
      event.preventDefault();
      canvas.focus({preventScroll: true});
      const point = this.canvasPoint(event);
      const world = this.camera.toWorld(point);
      let target = event.button === 0 ? this.layout.hitTest(this.sceneState, world,12/this.camera.scale) : null;
      if (target?.kind === 'toggle') {
        this.layout.toggleContainer(target.logicalId); this.select({...target, kind: 'aggregate'}); return;
      }
      const wire = event.button === 0 ? this.hitWire(world) : null;
      if (wire && (!target || target.kind === 'aggregate' && !target.header)) target = {kind: 'wire', key: `wire:${wire.id}`, id: wire.id, name: wire.label};
      this.select(target?.kind==='resize'?{...target,kind:'aggregate'}:target);
      this.drag = {pointerId: event.pointerId, start: point, previous: point, target,
        mode: target?.kind==='resize'?'resize':target?.dragKey ? 'move' : target ? 'select' : 'pan', position: target?.dragKey ? {...this.layout.positions.get(target.dragKey)} : null};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      const point = this.canvasPoint(event);
      if (!this.drag) {
        const target = this.layout.hitTest(this.sceneState, this.camera.toWorld(point),12/this.camera.scale);
        this.hoveredTarget=target?.kind==='resize'?{...target,kind:'aggregate'}:target;
        this.hoveredWire = this.hitWire(this.camera.toWorld(point));
        canvas.title = target?.kind==='resize'?'드래그하여 서랍 표시 크기 조절':target?.kind === 'toggle' ? `${this.layout.collapsed.has(target.logicalId) ? '펼치기' : '접기'} · ${target.name}` : this.hoveredWire?.label ?? target?.name ?? '';
        canvas.style.cursor = target?.kind==='resize'?'nwse-resize':target?.kind === 'toggle' ? 'pointer' : target?.dragKey ? 'move' : target || this.hoveredWire ? 'pointer' : 'grab';
        return;
      }
      if (this.drag.pointerId !== event.pointerId) return;
      if(this.drag.mode==='resize'){
        this.layout.resizeContainer(this.drag.target,this.drag.target.width+(point.x-this.drag.start.x)/this.camera.scale,
          this.drag.target.height+(point.y-this.drag.start.y)/this.camera.scale,{preview:true});
      }else if (this.drag.mode === 'move' && Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) {
        this.layout.move(this.drag.target.dragKey, {
          x: this.drag.position.x + (point.x - this.drag.start.x) / this.camera.scale,
          y: this.drag.position.y + (point.y - this.drag.start.y) / this.camera.scale,
        }, {preview: true});
      } else if (this.drag.mode === 'pan') this.camera.pan(point.x - this.drag.previous.x, point.y - this.drag.previous.y);
      this.drag.previous = point;
    });
    const stopDrag = () => {
      this.layout.finishMove();
      this.drag = null;
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('lostpointercapture', stopDrag);
    canvas.addEventListener('pointerleave',()=>{this.hoveredTarget=null;this.hoveredWire=null;});
    canvas.addEventListener('dblclick', event => {
      const target = this.layout.hitTest(this.sceneState, this.camera.toWorld(this.canvasPoint(event)));
      if (target?.kind === 'aggregate' && target.header) { this.layout.toggleContainer(target.logicalId); this.select(target); }
    });
    canvas.addEventListener('keydown', event => {
      const directions = {ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60]};
      if(event.shiftKey&&directions[event.key]&&this.selection?.kind==='aggregate'){
        const group=this.layout.resolve(this.sceneState).containers.get(this.selection.logicalId);
        if(group&&!group.collapsed){const [dx,dy]=directions[event.key];this.layout.resizeContainer(group,group.width-dx,group.height-dy);}
        event.preventDefault();return;
      }
      if (directions[event.key]) { this.camera.pan(...directions[event.key]); event.preventDefault(); }
      if (['+', '='].includes(event.key)) { this.zoom(1.25); event.preventDefault(); }
      if (event.key === '-') { this.zoom(0.8); event.preventDefault(); }
      if (event.key === 'Escape') this.select(null);
      if (event.key === 'Enter' && this.selection?.kind === 'aggregate') { this.layout.toggleContainer(this.selection.logicalId); this.select(this.selection); event.preventDefault(); }
    });
  }

  select(target) { this.selection = target; this.onSelectionChange(target); }
  toggleSelected() {
    if (this.selection?.kind !== 'aggregate') return;
    this.layout.toggleContainer(this.selection.logicalId); this.select(this.selection); this.canvas.focus({preventScroll: true});
  }

  canvasPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
  }

  reset() {
    this.wiring.reset(); this.wiring = new PointerClient();
    this.wireGraphs = new WeakMap(); this.relaxations = new Map();
    this.routes = new WeakMap(); this.transferMissing = 0;
    this.presentationFrame=null;this.historyWaiting=false;this.pendingFit=false;this.pendingFocus=false;
    this.hoveredWire = null;this.hoveredTarget=null; this.visibleWires = []; this.wireBoundaries = null; this.boundaryGraphs = null;
    this.layout.reset();
    this.toolFollower=new ToolFollower(this.layout);
    this.selection = null;
    this.drag = null;
    this.onSelectionChange(null);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const firstSize = this.width === 0;
    this.camera.pan((bounds.width - this.width) / 2, (bounds.height - this.height) / 2);
    this.width = bounds.width;
    this.height = bounds.height;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(bounds.width * this.pixelRatio);
    this.canvas.height = Math.round(bounds.height * this.pixelRatio);
    if(this.transferCanvas){this.transferCanvas.width=this.canvas.width;this.transferCanvas.height=this.canvas.height;}
    if (firstSize) this.fit();
  }

  fit(state = this.sceneState) {
    if(this.historyWaiting){this.pendingFit=true;return;}
    // Leave the bottom camera toolbar clear of the input/output contents.
    this.camera.fit(this.layout.resolve(this.displayState(state)).bounds, this.width, Math.max(1,this.height-64));
    this.onCameraChange(this.camera.scale);
  }

  zoom(factor, x = this.width / 2, y = this.height / 2) {
    this.camera.zoom(factor, {x, y});
    this.onCameraChange(this.camera.scale);
  }

  frameRectangle(frame, state) {
    return this.layout.resolve(this.displayState(state)).mats.get(`frame:${frame.id}`).rectangle;
  }

  objectRectangle(object, state) {
    return this.layout.resolve(this.displayState(state)).objects.get(object.id);
  }

  displayState(state) {if(this.recording)this.layout.resolveType=this.recording.resolveType;return this.recording ? displayScene(this.recording, state) : state; }

  followWork(player){
    if(this.historyWaiting)return;
    const key=`${player.cursor}:${player.event?.eventId}:${this.layout.prepared?.revision??0}:${this.layout.revision}`;
    if(this.autoFocusKey!==key){
      this.autoFocusKey=key;
      const scene=this.displayState(player.state),geometry=this.layout.resolve(scene),boxes=[];
      for(const t of this.workTargets??[]){const object=scene.objects.get(t.objectId);if(!object?.alive)continue;
        const presented=structurePort(geometry,t);if(presented){boxes.push(presented.rectangle);continue;}
        const ref=object.value?.reference??object.cells?.get(0)?.value?.reference,backing=scene.objects.get(ref?.targetObjectId),id=backing?.alive&&this.layout.prepared?.tracks.has(backing.id)?backing.id:object.id,
          box=geometry.objects.get(id),projection=this.layout.projection(scene.objects.get(id));
        if(box&&projection.structure&&box.width<=1000&&box.height<=600)boxes.push(box);
        else {const cell=[...geometry.cells.values()].find(c=>c.objectId===object.id&&!c.hidden&&c.offset< (t.offset??0)+(t.size??1)&&c.offset+c.size>(t.offset??0));if(cell)boxes.push(cell);else if(box)boxes.push(box);}
      }
      if(player.event?.kind==='CALC'||dataFlowForEvent(player.recording,player.event).some(e=>e.from.kind==='device'||e.to.kind==='device'))boxes.push(this.layout.deviceRectangle('alu'));
      if(boxes.length){const left=Math.min(...boxes.map(b=>b.x))-55,top=Math.min(...boxes.map(b=>b.y))-45,right=Math.max(...boxes.map(b=>b.x+b.width))+55,bottom=Math.max(...boxes.map(b=>b.y+b.height))+45,
        scale=Math.max(.42,Math.min(1.15,this.width/(right-left)*.90,this.height/(bottom-top)*.90));
        this.autoCamera={scale,x:this.width/2-(left+right)/2*scale,y:this.height/2-(top+bottom)/2*scale};}
    }
    if(this.autoCamera&&!this.drag){for(const k of ['scale','x','y'])this.camera[k]+=(this.autoCamera[k]-this.camera[k])*.13;this.onCameraChange(this.camera.scale);}
  }

  focusEvent(player) {
    if(this.historyWaiting){this.pendingFocus=true;return;}
    const event = player.event;
    const geometry = this.layout.resolve(this.displayState(player.after));
    let rectangle = player.waitingForInput?geometry.mats.get('tool:input').rectangle:event?.target?.objectId
      ?this.flowRectangle({kind:'object',id:event.target.objectId,offset:event.target.offset??0,size:event.target.size},this.displayState(player.after))
      :geometry.objects.get(event?.objectId);
    const leaf=event?.target?.objectId?[...geometry.cells.values()].find(c=>c.objectId===event.target.objectId&&c.offset<=(event.target.offset??0)&&c.offset+c.size>(event.target.offset??0)):null;
    if(leaf?.hidden)rectangle=geometry.containers.get(geometry.anchors.get(leaf.id))??geometry.objects.get(event.target.objectId);
    const effect=valueEffectForEvent(event);
    if(!rectangle&&effect?.target.kind==='mat')rectangle=geometry.mats.get(effect.target.id)?.rectangle;
    rectangle ??= event?.kind === 'CALC' ? geometry.mats.get('tool:workbench').rectangle : geometry.mats.get(`frame:${event?.activationId}`)?.rectangle;
    rectangle ??= geometry.mats.get('tool:workbench').rectangle;
    this.camera.fit({...rectangle, x: rectangle.x - 80, y: rectangle.y - 80, width: rectangle.width + 160, height: rectangle.height + 160}, this.width, this.height);
    this.onCameraChange(this.camera.scale);
  }

  label(text, x, y, {size = 14, color = '#e4ecef', align = 'left', maxWidth, mono = false} = {}) {
    const context = this.context;
    context.fillStyle = color;
    context.font = `${size}px ${mono ? 'Consolas, ' : ''}"Malgun Gothic", sans-serif`;
    context.textAlign = align;
    let shown = String(text);
    if (maxWidth && context.measureText(shown).width > maxWidth) {
      while (shown.length && context.measureText(shown + '…').width > maxWidth) shown = shown.slice(0, -1);
      shown += '…';
    }
    context.fillText(shown, x, y);
  }

  box(rectangle, fill, stroke, radius = 12) {
    const context = this.context;
    context.beginPath();
    context.roundRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height, radius);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 1.5;
    context.stroke();
  }

  connection(from, to, color, dashed = false, width = 2) {
    const context = this.context;
    const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
    const middle = vertical ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
    const c1 = vertical ? {x: from.x, y: middle} : {x: middle, y: from.y};
    const c2 = vertical ? {x: to.x, y: middle} : {x: middle, y: to.y};
    context.strokeStyle = color;
    context.lineWidth = width;
    context.setLineDash(dashed ? [5, 5] : []);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    context.stroke();
    context.setLineDash([]);
    const angle = Math.atan2(to.y - c2.y, to.x - c2.x);
    const head = Math.max(8, 6 / this.camera.scale);
    context.beginPath();
    context.moveTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(to.x, to.y);
    context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }

  routedConnection(path, color, {emphasized = false, clearance = Infinity} = {}) {
    const context = this.context;
    context.strokeStyle = color;
    context.lineWidth = Math.min(Math.max(emphasized ? 4.5 : 1.8, (emphasized ? 3.4 : 1.4) / this.camera.scale),clearance*(emphasized?1.2:0.5));
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (const p of path.slice(1)) context.lineTo(p.x, p.y);
    context.stroke();
    const to = path.at(-1), previous = path.at(-2);
    const angle = Math.atan2(to.y - previous.y, to.x - previous.x);
    const head = Math.min(Math.max(8, 6 / this.camera.scale),clearance*0.65);
    context.beginPath();
    context.moveTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(to.x, to.y);
    context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }

  prepareWiring(player) {
    this.layout.motionGeometry=null;
    this.recording = player.recording;
    this.layout.viewport={width:this.width,height:this.height};
    const before = this.displayState(player.state), after = this.displayState(player.after);
    let results,graphs;
    const historical=!!this.wiring.requestFrame&&!['move','resize'].includes(this.drag?.mode);
    if(historical){
      const frame=this.wiring.requestFrame(player,this.layout);
      this.historyWaiting=!frame;
      if(!frame){this.wiringReady=false;return false;}
      if(this.presentationFrame!==frame){
        restoreLayout(this.layout,frame.before);
        const geometries=[this.layout.resolve(before)];
        restoreLayout(this.layout,frame.after);
        geometries.push(this.layout.resolve(after));
        restoreLayout(this.layout,frame.after);
        this.layout.presentedGeometry=new Map([[before.boundaryIndex??-1,{...geometries[0],revision:this.layout.revision}],[after.boundaryIndex??-1,{...geometries[1],revision:this.layout.revision}]]);
        this.presentationFrame=frame;
      }
      graphs=[pointerGraph(before,this.layout.resolve(before),this.layout.pinned),pointerGraph(after,this.layout.resolve(after),this.layout.pinned)];
      results=frame.routes;
    }else{
    this.historyWaiting=false;this.presentationFrame=null;
    this.toolFollower?.update(player.recording,player.event,before);
    this.layout.resolve(before); this.layout.resolve(after);
    graphs = [before, after].map(state => {
      const geometry = this.layout.resolve(state), cached = this.wireGraphs.get(state);
      if (cached?.revision === geometry.revision) return cached.graph;
      const graph = pointerGraph(state, geometry, this.layout.pinned);
      this.wireGraphs.set(state, {revision: geometry.revision, graph}); return graph;
    });
    results = graphs.map(graph => this.wiring.request(graph));
    }
    if (this.selection?.logicalId && !graphs.some(graph => graph.nodes.some(node => node.id === this.selection.logicalId) ||
      [...graph.edges, ...graph.hiddenEdges].some(edge => [edge.sourceLogicalId, edge.targetLogicalId].includes(this.selection.logicalId)))) {
      const known = [before, after].some(state => this.layout.resolve(state).anchors.has(this.selection.logicalId));
      if (!known) this.select(null);
    }
    if (this.selection?.kind === 'wire' && !graphs.some(graph => graph.edges.some(edge => edge.id === this.selection.id))&&!this.layout.resolve(after).structureEdges?.some(e=>e.id===this.selection.id)) this.select(null);
    const result = results[1], attempts = this.relaxations?.get(player.cursor) ?? 0;
    if (!historical&&!this.drag && result?.missing.length && attempts < 2) {
      const affected = graphs[1].edges.filter(e => result.missing.includes(e.id)).flatMap(e => [e.sourceObjectId, e.targetObjectId]);
      if (this.layout.openCorridor(after, affected, 18)) {
        this.wiringReady = false; this.wireBoundaries = null;
        this.relaxations ??= new Map(); this.relaxations.set(player.cursor, attempts + 1); return false;
      }
    }
    this.wireBoundaries = results; this.boundaryGraphs = graphs;
    this.wiringReady = results.every(Boolean) && !this.wiring.error;
    if(this.wiringReady){
      if(this.pendingFit){this.pendingFit=false;this.fit(player.after);}
      if(this.pendingFocus){this.pendingFocus=false;this.focusEvent(player);}
    }
    return this.wiringReady;
  }

  hitWire(point) {
    let nearest, distance = 8 / this.camera.scale;
    for (const wire of this.visibleWires ?? []) for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1], b = wire.points[i], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (d < distance) { nearest = wire; distance = d; }
    }
    return nearest;
  }

  drawWires(player, before, after) {
    const timing=transferPresentation(player.recording,player.event,player.progress);
    const delivered = player.event?.kind === 'WRITE' ? timing.valueReady : timing.effectReady;
    const index = delivered && player.progress > 0 ? 1 : 0;
    const result = this.wireBoundaries?.[index], graph = this.boundaryGraphs?.[index];
    this.visibleWires = [];
    if (!result || !graph) return;
    const geometry = this.layout.resolve(index ? after : before);
    const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
    const labels = id => { const cell = geometry.cells.get(id) ?? geometry.containers.get(id); return cell ? `${cell.label} (+${cell.offset} B)` : id; };
    const currentNodes=this.layout.motionGeometry?new Map(pointerGraph(index?after:before,geometry,this.layout.pinned).nodes.map(n=>[n.id,n])):null,
      originalNodes=currentNodes?new Map(graph.nodes.map(n=>[n.id,n])):null;
    for (const saved of result.paths) {
      const wire=currentNodes?attachMovingRoute(saved,originalNodes,currentNodes):saved;
      if(geometry.semanticWires?.has(wire.id))continue;
      const edge = edges.get(wire.id); if (!edge) continue;
      const label = `${labels(edge.sourceLogicalId)} → ${labels(edge.targetLogicalId)}`;
      this.visibleWires.push({...wire, label});
      const appearance=pointerAppearance(wire.id,this.wireFocus,{scale:this.camera.scale,source:geometry.cells.get(edge.sourceLogicalId)});
      const box = {x: Math.min(...wire.points.map(p => p.x)), y: Math.min(...wire.points.map(p => p.y)),
        width: Math.max(...wire.points.map(p => p.x)) - Math.min(...wire.points.map(p => p.x)) + 1,
        height: Math.max(...wire.points.map(p => p.y)) - Math.min(...wire.points.map(p => p.y)) + 1};
      if (!this.camera.visible(box, this.width, this.height)) continue;
      const context = this.context; context.save();
      context.globalAlpha = appearance.opacity;
      context.lineJoin = 'round'; context.beginPath(); context.moveTo(wire.points[0].x, wire.points[0].y);
      for (const point of wire.points.slice(1)) context.lineTo(point.x, point.y);
      if(appearance.haloWidth){context.strokeStyle='#101a20';context.lineWidth=appearance.haloWidth;context.stroke();}
      context.strokeStyle=appearance.color;context.lineWidth=appearance.width;context.stroke();
      const a = wire.points.at(-2), b = wire.points.at(-1), angle = Math.atan2(b.y - a.y, b.x - a.x), head = appearance.head;
      context.beginPath(); context.moveTo(b.x - head * Math.cos(angle - 0.5), b.y - head * Math.sin(angle - 0.5)); context.lineTo(b.x, b.y);
      context.lineTo(b.x - head * Math.cos(angle + 0.5), b.y - head * Math.sin(angle + 0.5)); context.stroke(); context.restore();
    }
    for (const edge of graph.inactive) {
      const box = geometry.ports.get(edge.source); if (box) this.label(edge.onePast ? '끝 다음 주소 ↗' : edge.status === 'dangling' ? '수명 종료 ↗' : '범위 밖 ↗', box.x + box.width, box.y - 5,
        {size: 11, color: edge.onePast ? '#adb7c9' : '#ff969e'});
    }
  }

  drawObject(object, state, alpha, emphasis) {
    if(this.presentationState?.objects.has(object.id))state=this.presentationState;
    const context = this.context;
    const rectangle = this.objectRectangle(object, state);
    context.save();
    context.globalAlpha *= alpha;
    const rootFocus = this.anchorFocus?.has(object.renderCells?.length ? containerId(object.id) : cellId(object.id));
    this.box(rectangle, '#18272e', rootFocus ? '#9ed9ff' : emphasis ?? '#43555f');
    if (object.renderCells?.length) {
      const guide=this.layout.projection(object).structure?.guide;
      if(guide){context.save();context.strokeStyle='#739aab';context.lineWidth=1.5;context.setLineDash([5,7]);context.beginPath();context.ellipse(rectangle.x+guide.x,rectangle.y+guide.y,guide.rx,guide.ry,0,0,Math.PI*2);context.stroke();context.restore();}
      const geometry = this.layout.resolve(state);
      const visibleGroups = this.layout.projection(object).groups;
      for (const group of geometry.containers.values()) {
        if (group.objectId !== object.id || group.hidden || !visibleGroups.has(group.id) || !this.camera.visible(group, this.width, this.height)) continue;
        const focused = this.anchorFocus?.has(group.id);
        if ((group.path||group.logicalNode)&&(!group.bare||group.collapsed)) this.box(group, '#14252d', focused ? '#9ed9ff' : '#43555f', group.logicalNode?15:8);
        this.label(group.collapsed ? '▸' : '▾', group.toggle.x + 8, group.toggle.y + 20, {size: 20, color: '#a9c7d8'});
        this.label(`${group.path || object.name}${group.structured?' · '+group.structureLabel:''} · ${group.size} B${!group.path&&object.stringPreview?' · '+object.stringPreview:''}`, group.x + 35, group.y + 23,
          {size: group.path ? 12 : 15, mono: true, color: focused ? '#bfe7ff' : '#d5e1e7', maxWidth: group.width - 45});
        if (group.collapsed) {
          const count = this.hiddenWireCounts?.get(group.id) ?? 0;
          this.label(count ? `접힘 · 내부 연결 ${count}개` : '접힘 · 클릭하여 선택 / ▸ 펼치기', group.x + 13, group.y + 59, {size: 11, color: '#8ea9b9', maxWidth: group.width - 26});
        }
      }
      for (const box of visibleMemoryCells(this.layout.projection(object).memory, geometry)) {
        if (!this.camera.visible(box, this.width, this.height)) continue;
        const cell = box;
        const target = this.activeTarget;
        const active = target?.objectId === object.id && (target.offset ?? 0) >= cell.offset && (target.offset ?? 0) < cell.offset + cell.size;
        context.save();if(cell.inactive&&!active)context.globalAlpha*=.32;
        const outline=this.anchorFocus?.has(cell.id)?'#9ed9ff':active?emphasis??'#43555f':'#557b89';
        if(cell.shape==='circle'){
          context.beginPath();context.arc(box.x+box.width/2,box.y+box.height/2,Math.min(box.width,box.height)/2,0,Math.PI*2);
          context.fillStyle=cell.colorMix===undefined?semanticFill(cell.color):mixFill(cell.previousColor,cell.color,cell.colorMix);context.fill();context.strokeStyle=outline;context.lineWidth=1.8;context.stroke();
          if(['red','black'].includes(cell.color))this.label(cell.color==='red'?'R':'B',box.x+box.width-8,box.y+10,{size:11,color:'#eff5f8',align:'right'});
          if(cell.terminal){context.beginPath();context.arc(box.x+box.width/2,box.y+box.height/2,Math.min(box.width,box.height)/2-5,0,Math.PI*2);context.strokeStyle='#a2dfba';context.stroke();}
        }else this.box(box, '#192b34', outline, 6);
        this.drawNodeState(cell);
        if(cell.compactPointer){this.label('↗',box.x+box.width/2,box.y+14,{size:13,align:'center',color:'#9dc6d9'});context.restore();continue;}
        if(cell.shape==='circle')this.label(cell.nodeLabel,box.x+box.width/2,box.y+25,{size:20,align:'center',color:'#afcedd',maxWidth:box.width-20,mono:true});
        else this.label(cell.path || `+${cell.offset}`, box.x + 6, box.y + 16, {size: 10, color: '#94b6c5', maxWidth: box.width - 12, mono: true});
        const byte=cell.value&&/char/.test(cell.cType?.encoding??'')?Number(BigInt(cell.value.decimal??0)&255n):null;
        const value=byte===null?formatValue(cell.value):byte===0?'\\0':JSON.stringify(String.fromCharCode(byte));
        this.label(cell.value ? `${cell.parent?'p: ':''}${value}` : '미초기화', box.x + box.width / 2, box.y + (cell.shape==='circle'?55:Math.min(42,box.height-6)), {size: cell.value ? cell.administrative?14:cell.structured?24:18 : 11, align: 'center', maxWidth: box.width - 12, mono: true});
        context.restore();
      }
      for(const group of this.layout.projection(object).groups.values())if(!group.hidden&&!group.collapsed&&!group.bare){
        const actual=geometry.containers.get(group.id);if(!actual)continue;
        const grip=actual.resizeHandle;
        context.strokeStyle='#89b7c4';context.lineWidth=1.5;context.beginPath();
        context.moveTo(grip.x+5,grip.y+17);context.lineTo(grip.x+17,grip.y+5);
        context.moveTo(grip.x+11,grip.y+17);context.lineTo(grip.x+17,grip.y+11);context.stroke();
        if(group.windowed)this.label(group.hiddenChildren||group.incomplete?'… · 표시 영역 밖 생략':'표시 영역',actual.x+12,actual.y+actual.height-7,{size:10,color:'#8ea9b9',maxWidth:actual.width-40});
      }
      for(const n of geometry.structureNodes?.values()??[])if(n.objectId===object.id&&n.diagramOnly){context.beginPath();context.arc(n.x+n.width/2,n.y+n.height/2,n.width/2,0,Math.PI*2);context.fillStyle=n.colorMix===undefined?semanticFill(n.color):mixFill(n.previousColor,n.color,n.colorMix);context.fill();context.strokeStyle='#729eb2';context.stroke();this.drawNodeState(n);this.label(n.nodeLabel,n.x+n.width/2,n.y+n.height/2+7,{size:22,align:'center',maxWidth:n.width-14});}
      context.restore(); return;
    }
    this.label(object.name, rectangle.x + 10, rectangle.y + 21, {size: 14, maxWidth: object.parameter?55:100, mono: true});
    this.label(object.cType?.display?.label ?? object.cType?.name ?? '?', rectangle.x + 13, rectangle.y - 12, {color: '#92a5ad', size: 12, maxWidth: 145});
    if (object.parameter) this.label('매개변수', rectangle.x + rectangle.width - 12, rectangle.y + 24, {size: 10, color: colors.READ, align: 'right'});
    if (object.cType?.signedness === 'unsigned') {
      this.label('u', rectangle.x + rectangle.width - 17, rectangle.y + (object.parameter ? 43 : 24), {size: 14, color: colors.WRITE});
    }
    if (object.parameter && !object.initialized) {
      this.label('인자 대기', rectangle.x + rectangle.width / 2, rectangle.y + 54, {color: '#92a5ad', size: 14, align: 'center'});
    } else if (!object.initialized) {
      const x = rectangle.x + 23;
      const y = rectangle.y + 33;
      context.strokeStyle = '#78909c';
      context.lineWidth = 1.5;
      context.strokeRect(x, y + 5, 16, 20);
      context.beginPath();
      context.moveTo(x - 3, y + 3);
      context.lineTo(x + 19, y + 3);
      context.moveTo(x + 5, y);
      context.lineTo(x + 11, y);
      context.moveTo(x + 5, y + 9);
      context.lineTo(x + 5, y + 20);
      context.moveTo(x + 11, y + 9);
      context.lineTo(x + 11, y + 20);
      context.stroke();
      this.label('미초기화', rectangle.x + 47, rectangle.y + 51, {color: '#92a5ad', size: 11});
    } else {
      const rawZero=!object.value&&!object.cType&&!object.viewType&&object.regions?.length&&object.regions.every(r=>r.data?.encoding==='fill'&&r.data.byte===0);
      this.label(rawZero?'바이트 모두 0':formatValue(object.value), rectangle.x + rectangle.width / 2, rectangle.y + 54, {size:rawZero?13:24, align: 'center', maxWidth: rectangle.width-16, mono: true});
    }
    this.label(object.size === null ? '크기 미확정' : `${object.size} B`, rectangle.x + rectangle.width - 10, rectangle.y + 77, {color: '#92a5ad', size: 10, align: 'right'});
    context.restore();
  }

  render(player) {
    if(this.historyWaiting)return;
    this.layout.motionGeometry=null;
    const context = this.context;
    this.recording = player.recording;
    const before = this.displayState(player.state);
    const event = player.event;
    this.activeTarget = event?.target;
    const after = this.displayState(player.after);
    this.sceneState = before;
    this.layout.resolve(before);
    const nextGeometry = this.layout.resolve(after);
    const previousGeometry = this.layout.resolve(before);
    const presentation=transferPresentation(player.recording,event,player.progress);
    const delivered = event?.kind === 'WRITE' ? presentation.valueReady : presentation.effectReady;
    const index = delivered && player.progress > 0 ? 1 : 0, graph = this.boundaryGraphs?.[index];
    let focusGeometry = index ? nextGeometry : previousGeometry;
    this.presentationState=index?after:before;
    const transition=motionProgress(presentation.timing,presentation.elapsed,index===1);
    this.structureChanges=geometryChanges(previousGeometry,nextGeometry);
    if(index&&transition<1&&hasStructureMotion(previousGeometry,nextGeometry)){
      focusGeometry=interpolateStructureGeometry(previousGeometry,nextGeometry,transition);
      this.layout.motionGeometry=new Map([[before.boundaryIndex??-1,interpolateStructureGeometry(nextGeometry,previousGeometry,1-transition)],[after.boundaryIndex??-1,focusGeometry]]);
    }
    const targets=[event?.target,...dataFlowForEvent(player.recording,event).flatMap(edge=>[edge.from,edge.to])
      .filter(endpoint=>endpoint.kind==='object').map(endpoint=>({objectId:endpoint.id,offset:endpoint.offset,size:endpoint.size}))];
    const manualFocus = this.selection??this.hoveredTarget??(this.hoveredWire ? {kind: 'wire', id: this.hoveredWire.id} : null);
    const directFocus=focusForTargets(this.workTargets??targets,focusGeometry);
    // Whole-component exploration is explicit. Automatic work focus is limited
    // to actual operands/ranges so a large pointer network is not all lit up.
    this.wireFocus = manualFocus||!this.workTargets ? connectionFocus(manualFocus??directFocus,[...(graph?.edges??[]),...(graph?.hiddenEdges??[])])
      : {edges:new Set(),logicalIds:new Set(directFocus?.logicalIds??[])};
    this.hiddenWireCounts = new Map();
    for (const edge of graph?.hiddenEdges ?? []) this.hiddenWireCounts.set(edge.source, (this.hiddenWireCounts.get(edge.source) ?? 0) + 1);
    this.anchorFocus = new Set([...this.wireFocus.logicalIds].map(id => focusGeometry.anchors.get(id)).filter(Boolean));
    const progress = ease(player.progress);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = '#101a20';
    context.fillRect(0, 0, this.width, this.height);
    context.translate(this.camera.x, this.camera.y);
    context.scale(this.camera.scale, this.camera.scale);
    const left = -this.camera.x / this.camera.scale;
    const top = -this.camera.y / this.camera.scale;
    context.fillStyle = '#293840';
    const spacing = 32 * Math.max(1, 2 ** Math.ceil(Math.log2(0.5 / this.camera.scale)));
    for (let x = Math.floor(left / spacing) * spacing; x < left + this.width / this.camera.scale; x += spacing) {
      for (let y = Math.floor(top / spacing) * spacing; y < top + this.height / this.camera.scale; y += spacing) context.fillRect(x, y, 1.3 / this.camera.scale, 1.3 / this.camera.scale);
    }
    const mats = new Map([...previousGeometry.mats, ...nextGeometry.mats]);
    for (const mat of mats.values()) {
      if (mat.id.startsWith('tool:')) continue;
      const old = previousGeometry.mats.get(mat.id);
      const next = nextGeometry.mats.get(mat.id);
      const departure = before.frames.get(mat.frameId)?.returnPending ? ease(presentation.cleanupProgress) : progress;
      const alpha = old?.alive ? next?.alive ? 1 : 1 - departure : next?.alive ? progress : 0;
      if (alpha <= 0) continue;
      context.save();
      context.globalAlpha = alpha;
      const rectangle = focusGeometry.mats.get(mat.id)?.rectangle??mat.rectangle;
      if (!this.camera.visible(rectangle, this.width, this.height)) { context.restore(); continue; }
      const active = mat.frameId === (event?.activationId ?? before.activeFrame);
      const selected = this.selection?.key === mat.id;
      this.box(rectangle, '#15252bc9', selected ? colors.WRITE : active ? '#538a83' : '#354a54', 18);
      this.label(mat.frameId ? `STACK · ${mat.name}` : mat.name, rectangle.x + 25, rectangle.y + 36, {size: 21, color: colors.SPACE, mono: true});
      this.label('⋮⋮  드래그', rectangle.x + rectangle.width - 22, rectangle.y + 33, {size: 11, color: '#78909b', align: 'right'});
      if (mat.frameId) {
        this.label('반환구', rectangle.x + rectangle.width - 128, rectangle.y + rectangle.height - 23, {size: 12, color: '#8da5ae'});
        const value = (event?.action === 'return.value' && player.progress > 0 && presentation.valueReady ? after : before).returned.get(mat.frameId);
        this.label(formatValue(value), rectangle.x + rectangle.width - 30, rectangle.y + rectangle.height - 23, {size: 18, align: 'right', mono: true, color: colors.WRITE});
      }
      context.restore();
    }
    const objects = new Map([...before.objects, ...after.objects]);
    for (const object of objects.values()) {
      const old = before.objects.get(object.id);
      const next = after.objects.get(object.id);
      const departure = old?.returnPending ? ease(presentation.cleanupProgress) : progress;
      const alpha = old?.alive ? next?.alive ? 1 : 1 - departure : next?.alive ? progress : 0;
      if (alpha <= 0) continue;
      const rectangle = focusGeometry.objects.get(object.id)??nextGeometry.objects.get(object.id) ?? previousGeometry.objects.get(object.id);
      const target = event?.target?.objectId === object.id;
      const writing = target && event.kind === 'WRITE' && player.progress > 0 && presentation.valueReady;
      let visible = writing ? next : old?.alive ? old : object;
      if(event?.copiedFrom&&event.objectId===object.id&&!presentation.valueReady) {
        visible={...visible,initialized:false,value:null,stringPreview:undefined,
          renderCells:visible.renderCells?.map(cell=>({...cell,value:null}))};
      }
      if (this.camera.visible(rectangle, this.width, this.height)) {
        this.drawObject(visible, after, alpha, this.selection?.key === `object:${object.id}` ? colors.WRITE : target ? colors[event.kind] : null);
      }
    }
    this.drawWires(player, before, after);
    this.drawStructures(focusGeometry,this.presentationState);
    this.drawStructureChanges(player,previousGeometry,nextGeometry,focusGeometry,index,presentation);
    for(const a of focusGeometry.structureAnnotations??[]){const width=Math.min(208,a.text.length*8+12);context.save();context.fillStyle='#18272e';context.fillRect(a.x-width/2,a.y-13,width,18);this.label(a.text,a.x,a.y,{size:12,color:a.color,align:'center',maxWidth:200});context.restore();}
    this.drawWorkTargets(focusGeometry);
    this.drawTools(player);
    this.drawSpaceEffect(player, previousGeometry, nextGeometry);
    this.drawValueEffect(player);
    this.drawFlow(player);
    this.drawTransferLayer(player, before, after);
    // Provenance of the pixels actually drawn, rather than the requested seek.
    this.canvas?.setAttribute?.('data-presentation-cursor',String(player.cursor));
  }

  drawStructures(geometry,state){
    const readRange=range=>{const cell=[...geometry.cells.values()].find(c=>c.objectId===range.objectId&&c.offset===range.offset&&c.size===range.size);return cell?.value?formatValue(cell.value):null;},
      paths=structureEdgePaths(geometry.structureEdges??[],{readRange}),targets=this.workTargets??[],selected=this.hoveredWire?.id??(this.selection?.kind==='wire'?this.selection.id:null),touch=r=>r&&targets.some(t=>t.objectId===r.objectId&&t.offset<r.offset+r.size&&r.offset<t.offset+t.size);
    this.visibleStructureWires=[];
    const node=this.hoveredTarget?.graphNodeId??this.selection?.graphNodeId;
    for(const p of paths){const active=p.ids.includes(selected)||node!==undefined&&[p.edge.fromNodeId,p.edge.toNodeId].includes(node)||touch(p.edge.weightRange)||[...p.edge.from.ranges??[],...p.edge.to.ranges??[]].some(touch);
      const hierarchical=treePresentation(p.edge.view);
      strokeStructureEdge(this.context,p,{scale:this.camera.scale,active,hierarchical,color:hierarchical?(active?'#e2fff1':'#9debd3'):(active?'#b6e6ff':'#80c7cc'),label:(...args)=>this.label(...args)});
      this.visibleStructureWires.push({id:p.edge.id,points:p.points,label:`${p.edge.from.nodeLabel} ${p.edge.directed===false?'—':'→'} ${p.edge.to.nodeLabel}${p.text?' · '+p.text:''}`});
    }
    this.visibleWires?.push(...this.visibleStructureWires);
  }

  drawNodeState(cell){
    const row={unvisited:['미방문','#738695'],discovered:['발견','#8abfff'],active:['처리 중','#ffe0a0'],visited:['방문','#81d9c2'],settled:['확정','#e6c66e'],queued:['대기','#b2b2f6'],rejected:['기각','#c99d9d']}[cell.nodeState];
    if(!row||cell.compactPointer||cell.hidden)return;const c=this.context;c.save();c.strokeStyle=row[1];c.lineWidth=2.5;
    if(cell.shape==='circle'||cell.diagramOnly){c.beginPath();c.arc(cell.x+cell.width/2,cell.y+cell.height/2,Math.min(cell.width,cell.height)/2+7,0,Math.PI*2);c.stroke();}
    else c.strokeRect(cell.x-5,cell.y-5,cell.width+10,cell.height+10);
    this.label(row[0],cell.x+cell.width/2,cell.y+cell.height+21,{size:12,color:row[1],align:'center'});c.restore();
  }

  drawStructureChanges(player,before,after,geometry,committed,presentation){
    if(!player.event||player.presentationMode==='inspect'||player.progress<=0)return;
    const names={red:'빨강',black:'검정',visited:'방문',settled:'확정',queued:'대기',active:'처리 중'},seen=new Set();let count=0;
    for(const change of this.structureChanges??[]){
      if(change.kind!=='property')continue;const box=geometry.cells.get(change.id);if(!box||box.hidden||box.compactPointer)continue;
      const key=`${box.objectId}:${box.nodeId??box.id}:${change.field}`;if(seen.has(key))continue;seen.add(key);if(count++>=5)break;
      const text=`${names[change.before]??change.before??'?'} → ${names[change.after]??change.after??'?'}`;
      this.label(text,box.x+box.width/2,box.y-19,{size:14,color:committed?'#e9dcb7':'#a4b1bc',align:'center',maxWidth:210});
    }
    const old=new Map((before.structureEdges??[]).map(e=>[e.id,e])),next=new Map((after.structureEdges??[]).map(e=>[e.id,e])),changed=[...old].filter(([id,e])=>{const n=next.get(id);return !n||n.fromNodeId!==e.fromNodeId||n.toNodeId!==e.toNodeId;});
    if(committed&&presentation.phase!=='fade'&&changed.length){
      const c=this.context;c.save();c.globalAlpha=.32;c.setLineDash([7,6]);
      for(const [,edge]of changed.slice(0,6))for(const path of structureEdgePaths([edge]))strokeStructureEdge(c,path,{scale:this.camera.scale,color:'#acb6c2'});
      c.restore();const box=changed[0][1].from;
      this.label('이전 연결 · 점선',box.x+box.width/2,box.y-36,{size:12,color:'#b5bfcb',align:'center',maxWidth:210});
    }
  }

  drawWorkTargets(geometry){
    const c=this.context;c.save();c.lineWidth=2.5/this.camera.scale;
    for(const target of this.workTargets??[]){const color={read:'#83baff',write:'#ffce85',address:'#91a7bd'}[target.role]??'#83baff';let found=false;
      c.strokeStyle=color;const hits=[];
      for(const cell of geometry.cells.values())if(cell.objectId===target.objectId&&cell.offset<target.offset+target.size&&target.offset<cell.offset+cell.size){
        if(!cell.hidden)hits.push(cell);
        if(cell.shape==='circle'){c.beginPath();c.arc(cell.x+cell.width/2,cell.y+cell.height/2,Math.min(cell.width,cell.height)/2+3,0,Math.PI*2);c.stroke();}else c.strokeRect(cell.x-2,cell.y-2,cell.width+4,cell.height+4);found=true;
      }
      if(hits.length>1){const x=Math.min(...hits.map(h=>h.x)),y=Math.min(...hits.map(h=>h.y))-10,right=Math.max(...hits.map(h=>h.x+h.width));
        c.beginPath();c.moveTo(x,y+6);c.lineTo(x,y);c.lineTo(right,y);c.lineTo(right,y+6);c.stroke();
        this.label(target.role==='write'?'쓰는 범위':'읽는 범위',(x+right)/2,y-7,{size:12,color,align:'center',maxWidth:200});}
      if(!found){const box=geometry.objects.get(target.objectId);if(box)c.strokeRect(box.x-2,box.y-2,box.width+4,box.height+4);}
    }c.restore();
  }

  drawTransferLayer(player,before,after) {
    if(!this.transferContext){this.drawDataFlow(player,before,after);return;}
    // Transient value transport sits above the editable HTML input too.
    // Persistent pointer routing stays in the original scene underneath.
    const base=this.context;
    this.context=this.transferContext;
    try {
      this.context.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);
      this.context.clearRect(0,0,this.width,this.height);
      this.context.translate(this.camera.x,this.camera.y);
      this.context.scale(this.camera.scale,this.camera.scale);
      this.drawDataFlow(player,before,after);
    } finally {this.context=base;}
  }

  drawFlow(player) {
    const event = player.event;
    if (event?.kind !== 'FLOW') return;
    const frame = player.after.frames.get(event.activationId);
    if (!frame?.alive) return;
    const rectangle = this.frameRectangle(frame, player.after);
    const call = player.recording.calls.get(event.callExecutionId ?? event.eventId);
    const name = call?.event.resolvedFunctionName ?? call?.event.callee?.replace(/^@/, '') ?? '';
    const messages = {
      call: `${name} 호출 · 인자 ${event.arguments?.length ?? event.inputs?.length ?? 0}개`,
      enter: '함수 진입',
      return: event.callExecutionId ? '호출 위치로 반환' : '프로그램 반환',
      resume: `${name} 호출에서 복귀`,
      break: '반복·분기에서 나가기', continue: '다음 반복으로 이동',
      goto: '지정된 위치로 이동', 'loop.next': '반복 조건으로 돌아가기',
    };
    const condition = conditionForEvent(player.recording, event);
    if (condition) messages[event.action] = condition.mode === 'selection' ? `${condition.selected} 선택` : condition.selected;
    if (messages[event.action]) this.label(messages[event.action], rectangle.x + 25, rectangle.y + 63,
      {size: 13, color: colors.FLOW, maxWidth: rectangle.width - 50});
  }

  drawTools(player) {
    const presentation=transferPresentation(player.recording,player.event,player.progress),io=ioDisplayState(player,presentation.valueReady,presentation.effectReady);
    for (const id of ['tool:workbench', 'tool:input', 'tool:output']) {
      const rectangle = this.layout.toolRectangle(id);
      if (!this.camera.visible(rectangle, this.width, this.height)) continue;
      const selected = this.selection?.key === id;
      const waiting=id==='tool:input'&&player.waitingForInput;
      this.box(rectangle, waiting?'#30281d':id === 'tool:workbench' ? '#1a2330' : '#17292e', selected||waiting ? colors.WRITE : id === 'tool:workbench' ? colors.CALC : '#4d7477', 18);
      this.label(rectangle.name+(waiting?' · 입력 대기':''), rectangle.x + 22, rectangle.y + 33, {size: 19, color: waiting?colors.WRITE:id === 'tool:workbench' ? colors.CALC : colors.SPACE});
      this.label(id==='tool:workbench'?this.layout.pinned.has(id)?'수동 고정 · 드래그':'자동 이동 · 드래그로 고정':'⋮⋮  드래그', rectangle.x + rectangle.width - 18, rectangle.y + 32, {size: 11, align: 'right', color: '#78909b'});
      if (id !== 'tool:workbench') {
        if(id==='tool:input'&&this.inputEditor)continue;
        if(id==='tool:output'&&this.outputViewer)continue;
        const text = id === 'tool:output' ? streamText(io,this.outputChannel) : io.input ?? '';
        const rows = text ? text.split('\n') : [id === 'tool:output' ? '아직 출력이 없습니다.' : '아직 도착한 입력이 없습니다.'];
        const available = Math.floor((rectangle.height - 80) / 24);
        rows.slice(-available).forEach((row, index) => this.label(row, rectangle.x + 20, rectangle.y + 75 + index * 24, {size: 14, color: text ? '#d4e7e0' : '#829ba6', maxWidth: rectangle.width - 40, mono: true}));
        continue;
      }
      const appearances = toolAppearances(player.recording.trace.events, player.cursor, player.progress, player.recording, {inspection: player.presentationMode === 'inspect'});
      for (const device of appearances) this.drawDevice(player, device.id, device.opacity);
      if (!appearances.some(device => device.opacity > 0.05)) {
        const effect=effectForEvent(player.recording,player.event),call=externalCallForEvent(player.recording,player.event);
        const message = effect ? `${effect.name?effect.name+' · ':''}${effect.detail}` : !player.event ? player.state.error ?? '실행이 종료되었습니다.' : '계산할 때 알루가 나타납니다.';
        this.label(message, rectangle.x + rectangle.width / 2, rectangle.y + 140, {size: 14, align: 'center', color: '#8b9caf', maxWidth: rectangle.width - 40});
        if(call&&player.event?.action==='resume'&&(player.presentationMode==='inspect'||presentation.effectReady))this.label(`반환값 · ${formatValue(player.event.value)}`,rectangle.x+rectangle.width/2,rectangle.y+180,{size:18,align:'center',color:colors.WRITE,maxWidth:rectangle.width-40,mono:true});
      }
    }
  }

  drawDevice(player, id, opacity) {
    if (opacity <= 0) return;
    const rectangle = this.layout.deviceRectangle(id);
    const context = this.context;
    const midpoint = center(rectangle);
    context.save();
    context.globalAlpha *= opacity;
    context.translate(midpoint.x, midpoint.y + (1 - opacity) * 14);
    context.scale(0.9 + opacity * 0.1, 0.9 + opacity * 0.1);
    context.translate(-midpoint.x, -midpoint.y);
    this.box(rectangle, '#253343', rectangle.color, 11);
    this.label(rectangle.name, rectangle.x + 13, rectangle.y + 25, {size: 13, color: rectangle.color});
    const event = calculationForEvent(player.recording, player.event);
    const condition = conditionForEvent(player.recording, player.event);
    const textOptions = {align: 'center', maxWidth: rectangle.width - 25, mono: true};
    const definition = player.recording.instructions.get(event.instructionId);
    const presentation = transferPresentation(player.recording, player.event, player.progress, {inspection: player.presentationMode === 'inspect'});
    this.label(condition?.expression ?? definition.source?.expression ?? event.operator ?? '계산', midpoint.x, rectangle.y + 61, {...textOptions, size: 17});
    this.label(presentation.inputs.map(input => presentation.inspection || input.arrived ? formatValue(input.value) : '…').join(', '), midpoint.x, rectangle.y + 88, {...textOptions, size: 13, color: '#bac9dc'});
    if (isAttempt(event)) this.label('완료되지 않음 · 결과 없음',midpoint.x,rectangle.y+126,{...textOptions,size:17,color:colors.ERROR});
    else if (presentation.resultReady) {
      if (condition?.mode === 'selection') this.label(condition.selected, midpoint.x, rectangle.y + 126, {...textOptions, size: 23, color: colors.READ});
      else if (typeof condition?.truth === 'boolean') {
        const color = condition.truth ? '#7ee4ae' : '#ff8f9a';
        context.fillStyle = color;
        context.beginPath();
        context.arc(rectangle.x + 30, rectangle.y + 118, 7, 0, Math.PI * 2);
        context.fill();
        this.label(condition.truth ? '참 · True' : '거짓 · False', midpoint.x, rectangle.y + 126, {...textOptions, size: 23, color});
      } else this.label(`= ${formatValue(event.value)}`, midpoint.x, rectangle.y + 126, {...textOptions, size: 26, color: rectangle.color});
    } else if(presentation.phase==='calculate')this.label('계산 중…',midpoint.x,rectangle.y+126,{...textOptions,size:19,color:rectangle.color});
    context.restore();
  }

  drawSpaceEffect(player, before, after) {
    const effect = spaceEffect(player.event);
    if (!effect || player.progress <= 0 && player.presentationMode!=='inspect') return;
    const event = player.event;
    if (event.action === 'object.begin' && player.recording.parameterObjects.has(event.objectId)) return;
    if (event.action === 'frame.end' && after.mats.get(`frame:${event.frameId}`)?.alive) return;
    const geometry = effect === 'assemble' ? after : before;
    const rectangle = event.objectId ? geometry.objects.get(event.objectId) : geometry.mats.get(`frame:${event.frameId}`)?.rectangle;
    if (!rectangle || !this.camera.visible(rectangle, this.width, this.height)) return;
    const context = this.context;
    const progress = effect === 'assemble' ? player.progress : 1 - player.progress;
    context.save();
    context.globalAlpha = player.presentationMode==='inspect'?0.65:Math.sin(Math.PI * player.progress) * 0.85;
    context.setLineDash([7, 5]);
    this.box({x: rectangle.x - 5, y: rectangle.y - 5, width: rectangle.width + 10, height: rectangle.height + 10}, '#81d9c20c', colors.SPACE, 12);
    context.setLineDash([]);
    if(player.presentationMode==='inspect') {
      this.label(effect==='assemble'?'생성 미리보기':'정리할 저장소',rectangle.x+12,rectangle.y+27,{size:13,color:colors.SPACE,maxWidth:rectangle.width-24});
      context.restore();return;
    }
    context.strokeStyle = colors.SPACE;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(rectangle.x, rectangle.y + rectangle.height * progress);
    context.lineTo(rectangle.x + rectangle.width, rectangle.y + rectangle.height * progress);
    context.stroke();
    context.restore();
  }

  drawValueEffect(player) {
    const effect = valueEffectForEvent(player.event);
    if (!effect || player.progress <= 0 && player.presentationMode!=='inspect') return;
    const geometry = this.layout.resolve(this.displayState(player.after));
    let rectangle;
    if (effect.target.kind === 'object') rectangle = this.flowRectangle(effect.target, this.displayState(player.after));
    else if (effect.target.kind === 'mat') rectangle = geometry.mats.get(effect.target.id)?.rectangle;
    else {
      const point = this.layout.returnPoint(effect.target.id, player.after);
      if (point) rectangle = {x: point.x - 70, y: point.y - 22, width: 105, height: 40};
    }
    if (!rectangle || !this.camera.visible(rectangle, this.width, this.height)) return;
    this.context.save();
    this.context.globalAlpha = player.presentationMode==='inspect'?0.7:Math.sin(Math.PI * player.progress) * 0.75;
    this.box({x: rectangle.x - 4, y: rectangle.y - 4, width: rectangle.width + 8, height: rectangle.height + 8}, '#ffffff08', colors[effect.kind]);
    this.context.restore();
  }

  flowRectangle(endpoint, state) {
    if (endpoint.kind === 'device') return this.layout.deviceRectangle(endpoint.id);
    if (endpoint.kind === 'object') {
      const geometry = this.layout.resolve(state);
      const presented=structurePort(geometry,{objectId:endpoint.id,offset:endpoint.offset,size:endpoint.size});if(presented)return presented.rectangle;
      if (endpoint.size) {
        const cells = [...geometry.cells.values()].filter(c => c.objectId === endpoint.id && c.offset < (endpoint.offset ?? 0) + endpoint.size && c.offset + c.size > (endpoint.offset ?? 0));
        if (cells.length) return enclosingRectangle(cells);
      }
      const cell = [...geometry.cells.values()].find(c => c.objectId === endpoint.id && (endpoint.offset ?? 0) >= c.offset && (endpoint.offset ?? 0) < c.offset + c.size);
      return cell ?? geometry.objects.get(endpoint.id);
    }
    if (endpoint.kind === 'mat') return this.layout.resolve(state).mats.get(endpoint.id)?.rectangle;
    const point = this.layout.returnPoint(endpoint.id, state);
    return point ? {x: point.x - 65, y: point.y - 20, width: 100, height: 40} : null;
  }

  drawDataFlow(player, before, after) {
    const view = transferPresentation(player.recording, player.event, player.progress, {inspection: player.presentationMode === 'inspect'});
    this.transferMissing = 0;
    if (!view.edges.length || view.groupOpacity <= 0) return;
    const geometry = this.layout.resolve(after);
    this.routes ??= new WeakMap();
    if (!this.routes.has(geometry)) this.routes.set(geometry, new Map());
    const cache = this.routes.get(geometry), key = player.event.eventId;
    if (!cache.has(key) || cache.get(key).scale !== this.camera.scale) {
      const connections = view.edges.map((edge,index)=>({edge,index})).filter(({edge})=>
        !hiddenStorageEndpoint(player.recording,after,edge.from)&&!hiddenStorageEndpoint(player.recording,after,edge.to))
        .map(({edge,index})=>({id:`${key}:${index}`,index,from:this.flowRectangle(edge.from,after),to:this.flowRectangle(edge.to,after)}));
      const contents = [...geometry.ports.values()].filter(port=>after.objects.get(port.objectId)?.alive)
        .map(r=>({x:r.x+4,y:r.y+4,width:r.width-8,height:r.height-8}));
      for (const [id,r] of geometry.objects) {
        const object=after.objects.get(id);
        if(object?.alive&&!object.renderCells?.length) contents.push({x:r.x+10,y:r.y-25,width:r.width-20,height:17});
      }
      for(const mat of geometry.mats.values())if(mat.alive) {
        const r=mat.rectangle;contents.push({x:r.x+12,y:r.y+12,width:r.width-24,height:30});
      }
      const plan = routeTransfers(connections.filter(c=>c.from&&c.to),{obstacles:contents,scale:this.camera.scale});
      plan.scale=this.camera.scale;
      plan.endpoints = connections.flatMap(c=>[c.from,c.to]).filter(Boolean);
      plan.missing.push(...connections.filter(c=>!c.from||!c.to).map(c=>c.index)); cache.set(key,plan);
    }
    const plan = cache.get(key); this.transferMissing = plan.missing.length;
    if(player.event?.copiedFrom?.objectId) {
      const source=geometry.objects.get(player.event.copiedFrom.objectId);
      if(source) {
        const previous=before.objects.get(player.event.copiedFrom.objectId);
        if(previous)this.drawObject(previous,after,view.groupOpacity*0.5,colors.SPACE);
        this.context.save();this.context.setLineDash([5,5]);this.context.globalAlpha=view.groupOpacity*0.65;
        this.box(source,'#14202718',colors.SPACE,8);this.context.setLineDash([]);
        this.label('이전 저장소 · 수명 종료',source.x+10,source.y-8,{size:12,color:colors.SPACE,maxWidth:source.width-20});this.context.restore();
      }
    }
    const badgeRadius=8/this.camera.scale;
    const badges = transferBadges(plan.paths,[...[...geometry.ports.values()].filter(port=>after.objects.get(port.objectId)?.alive),...plan.endpoints],badgeRadius);
    // Draw the active route last so its vivid stroke remains above the muted
    // reference context. All routes share one event-level disappearance.
    const paths = [...plan.paths].sort((a,b)=>Number(a.index===view.active?.index)-Number(b.index===view.active?.index));
    for (const route of paths) {
      const edge = view.edges[route.index], emphasized = route.index === view.active?.index;
      const color = emphasized ? transferColors.active : transferColors.base;
      this.context.save(); this.context.globalAlpha = view.groupOpacity * (emphasized ? 1 : 0.82);
      this.routedConnection(route.points,color,{emphasized,index:route.index,clearance:plan.minimumSeparation});
      const source=route.points[0];
      this.context.fillStyle=color;this.context.strokeStyle='#142027';this.context.lineWidth=2/this.camera.scale;
      this.context.beginPath();this.context.arc(source.x,source.y,3/this.camera.scale,0,Math.PI*2);this.context.fill();this.context.stroke();
      if (emphasized) {
        const point = pointAlong(route.points,view.active.progress);
        this.context.fillStyle=color;this.context.beginPath();this.context.arc(point.x,point.y,Math.min(Math.max(4,3/this.camera.scale),plan.minimumSeparation*0.5),0,Math.PI*2);this.context.fill();
        if(view.active.phase==='move'&&edge.value) {
          const text=formatValue(edge.value),width=Math.min(150,Math.max(32,text.length*7+16))/this.camera.scale;
          const rect={x:point.x-width/2,y:point.y-32/this.camera.scale,width,height:24/this.camera.scale};
          this.box(rect,'#192830',color,5/this.camera.scale);
          this.label(text,point.x,rect.y+16/this.camera.scale,{size:12/this.camera.scale,align:'center',color,maxWidth:width-8/this.camera.scale,mono:true});
        }
      }
      const badge = badges.get(route.index);
      if(badge){
        this.context.fillStyle='#18242a';this.context.beginPath();this.context.arc(badge.x,badge.y,badgeRadius,0,Math.PI*2);this.context.fill();
        this.label(route.index+1,badge.x,badge.y+3.5/this.camera.scale,{size:11/this.camera.scale,align:'center',color:emphasized?transferColors.active:'#ffc46b',mono:true});
      }
      if(edge.from.kind==='return-port'&&!before.frames.get(edge.from.id)?.alive){
        const source=this.flowRectangle(edge.from,after);this.box(source,'#17212a',color,6);
        this.label(`${player.recording.frameNames.get(edge.from.id)} 반환`,source.x+source.width/2,source.y+25,{size:13,align:'center',color,maxWidth:source.width-8});
      }
      this.context.restore();
    }
  }
}
