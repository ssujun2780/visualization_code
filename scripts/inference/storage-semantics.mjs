import {createValueFlow} from './observed-value-flow.mjs';
import {slotTimeline} from './array-membership.mjs';
import {structureStateAt} from './state-history.mjs';
export const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
export const num=v=>{const x=Number(v?.decimal??v?.signed??v?.unsigned??NaN);return Number.isSafeInteger(x)?x:null;};
export const unique=a=>[...new Set(a)];
export const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
export function storageEvidence(plan,trace){
 const {events,objects,structures=[]}=trace,byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
  defs=new Map(plan.instructions.map(d=>[d.id,d])),flow=trace.valueFlow??createValueFlow(plan,trace),arrays=structures.filter(s=>s.kind==='array'),timelines=new Map();
 const arrayAt=r=>arrays.filter(a=>r&&a.objectId===r.objectId&&r.offset>=a.range.offset&&r.offset+r.size<=a.range.offset+a.range.size&&r.size<=a.elementBytes)
  .sort((a,b)=>a.range.size-b.range.size)[0];
 const cell=r=>{const a=arrayAt(r);if(!a)return null;const index=Math.floor((r.offset-a.range.offset)/a.elementBytes);
  return {arrayId:a.id,index,range:{objectId:r.objectId,offset:r.offset,size:r.size},fieldOffset:(r.offset-a.range.offset)%a.elementBytes};};
 const alive=(id,at)=>{const o=objects.find(o=>o.id===id);return !!o&&pos.get(o.createdBy)<=at&&!(pos.get(o.endedBy)<=at);};
 const scalar=(r,at,{signed=true}={})=>{const k=`${key(r)}:${signed}`;if(!alive(r.objectId,at))return null;if(!timelines.has(k))timelines.set(k,slotTimeline(r,events,{signed}));return timelines.get(k).findLast(x=>x.sequence<=at)?.value??null;};
 const exactScalar=(r,at,{signed=true}={})=>{scalar(r,at,{signed});return alive(r.objectId,at)?timelines.get(`${key(r)}:${signed}`)?.findLast(x=>x.sequence<=at)?.integer??null:null;};
 const payloadScalar=(r,at,{signed=true,type=null}={})=>{
  const exact=exactScalar(r,at,{signed});if(exact===null)return null;
  if(!/float/.test(type?.encoding??'')&&!['float','double'].includes(type?.name))return Number.isSafeInteger(Number(exact))?Number(exact):exact;
  const bytes=timelines.get(`${key(r)}:${signed}`)?.findLast(x=>x.sequence<=at)?.bytes;
  if(!bytes||![4,8].includes(r.size))return null;
  const view=new DataView(Uint8Array.from(bytes).buffer),v=r.size===4?view.getFloat32(0,true):view.getFloat64(0,true);
  return Number.isFinite(v)?v:String(v);
 };
 const chain=id=>flow.chain(id),identity=(a,b)=>{const ids=new Set(chain(a).map(e=>e.eventId));return chain(b).some(e=>ids.has(e.eventId));};
 const reads=ids=>unique((ids??[]).flatMap(id=>flow.dependencyReads(id,null,null,new Set(),r=>!!arrayAt(r.target))).map(r=>r.eventId)).map(id=>byId.get(id));
 return {events,objects,structures,byId,pos,defs,flow,arrays,arrayAt,cell,alive,scalar,exactScalar,payloadScalar,chain,identity,reads};
}
export function querySemanticStructure(candidate,trace,{afterExecutionId}={}){
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?trace.events.length-1:pos.get(afterExecutionId);
 if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
 return structuredClone(structureStateAt(candidate,pos,at,trace.objects));
}
