import {structureStateAt} from './state-history.mjs';
// Explicit, recording-scoped read-only query session. Ordinary public queries
// keep their uncached semantics; consumers create a new session on every load.
const indices=new WeakMap();
export function createStructureQueryTrace(trace){
  const source={...trace},positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),objects=new Map(trace.objects.map(o=>[o.id,o])),accesses=new Map();
  for(const e of trace.events)if(['READ','WRITE'].includes(e.kind)&&e.target){
    if(!accesses.has(e.target.objectId))accesses.set(e.target.objectId,[]);accesses.get(e.target.objectId).push(e);
  }
  indices.set(source,{positions,objects,accesses,roots:new WeakMap(),storageGraphs:new WeakMap()});return source;
}
export const structureQueryIndex=trace=>indices.get(trace);
export function structureQueryContext(trace,afterExecutionId){
  const index=indices.get(trace),positions=index?.positions??new Map(trace.events.map((e,i)=>[e.eventId,i])),
    at=afterExecutionId===undefined?trace.events.length-1:positions.get(afterExecutionId);
  if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
  if(index?.context?.at===at)return index.context;
  const states=new Map(),ctx={positions,at,occurred:id=>positions.has(id)&&positions.get(id)<=at,selectedRanges:new Map(),
    state:s=>{if(!states.has(s))states.set(s,structureStateAt(s,positions,at,trace.objects));return states.get(s);}};
  if(index)index.context=ctx;return ctx;
}
