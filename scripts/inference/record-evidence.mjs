import {storageEvidence,key,num,unique} from './storage-semantics.mjs';
export const contains=(a,b)=>a?.objectId===b?.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
export const overlaps=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const contexts=new WeakMap();
// Representation adapter. Every record is anchored to an observed typed range;
// values, copies and pointer targets are never matched by numeric similarity.
export function recordEvidence(plan,trace){
 const cached=contexts.get(trace);if(cached?.plan===plan)return cached.evidence;
 const c=storageEvidence(plan,trace),graph=c.structures.find(s=>s.kind==='storage-reference-graph'),records=new Map(),slots=new Map();
 const add=(range,type,id)=>{if(type?.kind!=='record'||!range||range.size!==type.sizeBits/8)return;const k=key(range),old=records.get(k);
  if(!old||c.pos.get(id)<c.pos.get(old.discoveredAtExecutionId))records.set(k,{id:`record:${k}`,range,type,typeId:type.recordTypeId??type.id,discoveredAtExecutionId:id});};
 for(const n of graph?.nodes??[])if(n.kind==='record')add(n.range,n.cType,n.discoveredAtExecutionId);
 for(const o of c.objects)if(o.cType?.kind==='record')add({objectId:o.id,offset:0,size:o.size},o.cType,o.createdBy);
 for(const e of c.events){const a=c.arrayAt(e.target);if(a?.elementType?.kind==='record'){const i=c.cell(e.target).index;add({objectId:a.objectId,offset:a.range.offset+i*a.elementBytes,size:a.elementBytes},a.elementType,e.eventId);}}
 for(const change of graph?.changes??[])for(const edge of change.upsertEdges){const k=key(edge.source);if(!slots.has(k))slots.set(k,[]);slots.get(k).push({...edge,at:c.pos.get(change.afterExecutionId)});}
 const all=[...records.values()],atNode=(n,at)=>c.pos.get(n.discoveredAtExecutionId)<=at&&c.alive(n.range.objectId,at),
  recordAt=(r,at)=>all.filter(n=>atNode(n,at)&&contains(n.range,r)).sort((a,b)=>a.range.size-b.range.size)[0]??null,
  fieldAt=(r,at)=>{const n=recordAt(r,at);if(!n)return null;const offset=r.offset-n.range.offset,m=n.type.members?.find(m=>m.offsetBits===offset*8&&m.sizeBits===r.size*8);return m?{node:n,offset,size:r.size,typeId:m.typeId}:null;},
  pointerNode=(v,at)=>{const p=v?.reference;if(p?.status!=='in-bounds')return null;return all.find(n=>atNode(n,at)&&n.range.objectId===p.targetObjectId&&n.range.offset===p.targetOffset)??null;},
  edgesAt=at=>[...slots.values()].map(a=>a.findLast(e=>e.at<=at)).filter(e=>e&&c.alive(e.source.objectId,at)).map(e=>{
   const source=fieldAt(e.source,at),target=all.find(n=>atNode(n,at)&&n.range.objectId===e.target?.objectId&&n.range.offset===e.target?.offset);
   return {...e,recordFrom:source?.node.id??null,recordTo:target?.id??null,fieldOffset:source?.offset??null};});
 const writes=c.events.filter(e=>['WRITE','SPACE'].includes(e.kind));
 function origin(range,at,copyExecutionIds=[],seen=new Set()){
  if(!range||!c.alive(range.objectId,at))return null;
  const visit=`${key(range)}:${at}`;if(seen.has(visit))return null;
  const limit=trace.inferenceBudget?.limits.maxOriginDepth??64;
  if(seen.size>=limit){trace.inferenceBudget?.report('record-origin-depth',limit,c.events[at]?.eventId);return null;}seen.add(visit);
  const object=c.objects.find(o=>o.id===range.objectId);
  if(c.arrayAt(range)&&object?.cType?.kind!=='record')return {range,at,copyExecutionIds};
  const w=writes.findLast(e=>c.pos.get(e.eventId)<=at&&overlaps(e.target??(e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState?.byteLength??0}:null),range));
  if(w?.action==='copy'&&contains(w.target,range)&&w.sourceObjectId&&w.sourceSize>=w.target.size)return origin({objectId:w.sourceObjectId,offset:w.sourceOffset+range.offset-w.target.offset,size:range.size},c.pos.get(w.eventId)-1,[...copyExecutionIds,w.eventId],seen);
  if(w?.action==='argument'&&w.copiedFrom&&contains(w.target,range)&&w.copiedFrom.size>=w.target.size){const call=c.byId.get(w.callExecutionId);if(call?.action==='call')return origin({objectId:w.copiedFrom.objectId,offset:w.copiedFrom.offset+range.offset-w.target.offset,size:range.size},c.pos.get(call.eventId)-1,[...copyExecutionIds,w.eventId],seen);}
  return {range,at,copyExecutionIds};
 }
 const operand=(input,e,s)=>{const read=c.flow.sourceReadOperand(input,e,s);if(!read)return null;const o=origin(read.target,c.pos.get(read.eventId));if(!o)return null;return {...o,readExecutionId:read.eventId,field:fieldAt(o.range,o.at),cell:c.cell(o.range),value:num(read.value)};};
 const comparisons=[];for(const e of c.events)if(e.kind==='CALC')for(const s of e.steps??[])if(['<','<=','>','>=','==','!='].includes(s.operator)&&s.inputs?.length===2)
  comparisons.push({executionId:e.eventId,activationId:e.activationId,sourceNodeId:s.nodeId,operator:s.operator,truth:num(s.value),operands:s.inputs.map(i=>operand(i,e,s)),controlInputs:e.controlInputs??[]});
 const dependencies=ids=>{const result=[],seen=new Set(),pending=[...ids??[]],limit=trace.inferenceBudget?.limits.maxDependencyNodes??8192;while(pending.length){const id=pending.pop();if(seen.has(id))continue;if(seen.size>=limit){trace.inferenceBudget?.report('record-dependencies',limit,ids?.[0]);return [];}seen.add(id);const e=c.byId.get(id);if(!e)continue;result.push(e);if(e.kind==='READ'&&c.arrayAt(e.target))continue;if(e.kind==='FLOW'&&e.action!=='resume')continue;pending.push(...e.dataInputs??[]);}return result;};
 const evidence={...c,records:all,recordAt,fieldAt,pointerNode,edgesAt,origin,operand,comparisons,dependencies};contexts.set(trace,{plan,evidence});return evidence;
}
export const evidenceIds=p=>unique([p.executionId,p.writeExecutionId,p.readExecutionId,...p.evidenceExecutionIds??[]].filter(Boolean));
