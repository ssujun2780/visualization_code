import {structureEdgePaths} from './structure-ink.js';

const lerp=(a,b,t)=>a+(b-a)*t;
const rect=(old,next,t)=>!old?{...next}:({...next,x:lerp(old.x,next.x,t),y:lerp(old.y,next.y,t),
  ...(Number.isFinite(next.width)?{width:lerp(old.width,next.width,t)}:{}),...(Number.isFinite(next.height)?{height:lerp(old.height,next.height,t)}:{})});
const mapRects=(old,next,t,colour=false)=>new Map([...next].map(([id,r])=>{const a=old.get(id),box=rect(a,r,t);
  for(const key of ['header','toggle','resizeHandle'])if(r[key])box[key]=rect(a?.[key],r[key],t);
  if(colour&&a?.color!==r.color)Object.assign(box,{previousColor:a?.color,colorMix:t});return [id,box];}));
export const semanticFill=color=>color==='red'?'#a94255':color==='black'?'#111820':'#183c50';
export function mixFill(old,next,t){const a=semanticFill(old).match(/\w\w/g).map(x=>parseInt(x,16)),b=semanticFill(next).match(/\w\w/g).map(x=>parseInt(x,16));
  return '#'+a.map((v,i)=>Math.round(lerp(v,b[i],t)).toString(16).padStart(2,'0')).join('');}

// Pure interpolation over already prepared boundary geometry. Memory, graph
// membership and labels switch at the existing instruction's apply boundary.
export function motionProgress(timing,elapsed,committed){
  if(!committed)return 0;const start=timing.valueAt||timing.effectAt,end=Math.min(timing.fade.start,start+900);
  const t=Math.max(0,Math.min(1,(elapsed-start)/(end-start||1)));return t*t*(3-2*t);
}
export function hasStructureMotion(before,after){
  for(const key of ['cells','objects','structureNodes'])for(const [id,r]of after[key]??[]){const old=before[key]?.get(id);
    if(old&&(old.x!==r.x||old.y!==r.y||old.width!==r.width||old.height!==r.height||old.color!==r.color))return true;}
  return false;
}
export function interpolateStructureGeometry(before,after,t){
  const geometry={...after,mats:new Map([...after.mats].map(([id,m])=>[id,{...m,rectangle:rect(before.mats.get(id)?.rectangle,m.rectangle,t)}])),
    objects:mapRects(before.objects,after.objects,t),cells:mapRects(before.cells,after.cells,t,true),containers:mapRects(before.containers,after.containers,t),
    ports:mapRects(before.ports,after.ports,t),structureNodes:mapRects(before.structureNodes??new Map(),after.structureNodes??new Map(),t,true)};
  geometry.structureEdges=(after.structureEdges??[]).map(e=>({...e,from:geometry.structureNodes.get(`${e.from.relationId}:${e.fromNodeId}`)??rect(before.structureNodes?.get(`${e.from.relationId}:${e.fromNodeId}`),e.from,t),
    to:geometry.structureNodes.get(`${e.to.relationId}:${e.toNodeId}`)??rect(before.structureNodes?.get(`${e.to.relationId}:${e.toNodeId}`),e.to,t)}));
  geometry.structureAnnotations=(after.structureAnnotations??[]).map((a,i)=>rect(before.structureAnnotations?.[i],a,t));
  geometry.structurePorts=[];
  for(const path of structureEdgePaths(geometry.structureEdges))for(const id of path.ids){const e=geometry.structureEdges.find(e=>e.id===id);if(e?.weightRange)geometry.structurePorts.push({range:e.weightRange,ownerObjectId:e.from.objectId,rectangle:{x:path.label.x-22,y:path.label.y-12,width:44,height:24}});}
  return geometry;
}

// Retained backbone and bends are preserved. Only short endpoint leads move
// with their actual ports; no native router is run on animation frames.
export function attachMovingRoute(route,original,current){
  const from=original.get(route.source),to=original.get(route.target),a=current.get(route.source),b=current.get(route.target);
  if(!from||!to||!a||!b)return route;
  const project=(p,old,next)=>({x:next.x+(p.x-old.x)*next.width/old.width,y:next.y+(p.y-old.y)*next.height/old.height}),
    start=project(route.points[0],from,a),end=project(route.points.at(-1),to,b),points=route.points.slice();
  const lead=(p,q)=>[p,...(p.x!==q.x&&p.y!==q.y?[{x:q.x,y:p.y}]:[]),q];
  if(start.x!==points[0].x||start.y!==points[0].y)points.unshift(...lead(start,points[0]).slice(0,-1));
  if(end.x!==points.at(-1).x||end.y!==points.at(-1).y)points.push(...lead(points.at(-1),end).slice(1));
  return {...route,points};
}

// Current event effects use exact byte ranges and producer identities. Values
// are shown only from supplied memory; equal values never imply a copy.
export function geometryChanges(before,after){
  const changes=[];
  for(const [id,next]of after.cells){const old=before.cells.get(id);if(!old)continue;
    const base={id,range:{objectId:next.objectId,offset:next.offset,size:next.size},rectangle:next};
    for(const field of ['color','nodeState'])if(old[field]!==next[field])changes.push({...base,kind:'property',field,before:old[field],after:next[field]});
    if(JSON.stringify(old.value)!==JSON.stringify(next.value))changes.push({...base,kind:'value',before:old.value,after:next.value});
  }
  return changes;
}
