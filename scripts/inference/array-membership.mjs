// Optional inference over finalized observations. No program events are added.
import {createValueFlow} from './observed-value-flow.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
export const scalarNumber=v=>{const n=Number(v?.decimal??v?.signed??v?.unsigned??NaN);return Number.isSafeInteger(n)?n:null;};
export const sameSlot=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
export function slotTimeline(slot,events,{signed=false}={}){
  const rows=[];let bytes;
  for(const [sequence,e]of events.entries()){
    if(!['READ','WRITE','SPACE'].includes(e.kind))continue;
    const exact=sameSlot(e.target,slot),snapshot=e.memoryState&&(e.target?.objectId??e.objectId)===slot.objectId;
    const next=observeScalarBytes(bytes,{size:slot.size,signed,
      ...(exact?{value:e.value?.bits??e.value?.decimal??e.value?.address}:{}),
      ...(snapshot?{snapshot:e.memoryState,start:e.target?.offset??0,offset:slot.offset}:{})});
    if(next){bytes=next;rows.push({sequence,eventId:e.eventId,value:next.value,integer:next.integer,bytes:next.bytes,event:e});}
  }
  return rows;
}
export function complementRanges(range,bytes,capacity,indices){
  const occupied=new Set(indices),ranges=[];let start=null;
  for(let i=0;i<=capacity;i++){
    if(i<capacity&&!occupied.has(i)){if(start===null)start=i;}
    else if(start!==null){ranges.push({objectId:range.objectId,offset:range.offset+start*bytes,size:(i-start)*bytes});start=null;}
  }
  return ranges;
}
const roleSlot=(m,r)=>r&&({...r,objectId:r.objectId??m.ownerObjectId,offset:r.offset+(r.objectId?0:m.ownerOffset??0)});
const stateAt=(m,index,pos)=>m.states.findLast(s=>pos.get(s.afterExecutionId)<=index);

export function arrayMembershipStructures(plan,context){
  const {events,objects,structures}=context,pos=new Map(events.map((e,i)=>[e.eventId,i])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    byObject=new Map(objects.map(o=>[o.id,o])),flow=context.valueFlow??createValueFlow(plan,context),
    managers=structures.filter(s=>['dynamic-array','separate-array-structure'].includes(s.kind));
  const addressed=(w,slot,before,lower)=> (w.addressInputs??[]).flatMap(id=>flow.dependencyReads(id)).some(r=>
    sameSlot(r.target,slot)&&scalarNumber(r.value)===before&&pos.get(r.eventId)>lower);
  for(const array of structures.filter(s=>s.kind==='array-structure'&&!s.roles.length&&!s.roleCandidates.length)){
    const matched=managers.filter(m=>m.elementBytes===array.elementBytes||m.states.some(s=>s.elementBytes===array.elementBytes))
      .filter(m=>m.states.some(s=>s.backingObjectId===array.range.objectId&&(s.byteOffset??0)===array.range.offset));
    const unique=new Map(matched.map(m=>{
      const r=m.roles??m.role,l=roleSlot(m,r.length??r.index),c=roleSlot(m,r.capacity);
      return [JSON.stringify([l?.objectId,l?.offset,c?.objectId,c?.offset]),{m,length:l,capacity:c}];
    }));
    if(unique.size!==1)continue;
    const {m,length,capacity}=unique.values().next().value;if(!length)continue;
    const mutations=events.map((e,i)=>({e,i})).filter(({e})=>e.kind==='WRITE'&&sameSlot(e.target,length));
    const operations=[];
    for(let k=0;k<mutations.length;k++){
      const {e,i}=mutations[k],next=mutations[k+1]?.i??events.length,lower=mutations[k-1]?.i??-1,
        old=(e.dataInputs??[]).flatMap(id=>flow.dependencyReads(id)).find(r=>sameSlot(r.target,length)),
        before=scalarNumber(old?.value),after=scalarNumber(e.value);
      if(before===null||after===null||after<0||before===after)continue;
      const state=stateAt(m,i,pos);if(!state?.backingObjectId)continue;
      const bytes=state.elementBytes??array.elementBytes,offset=state.byteOffset??0,delta=after-before;
      if(delta<0){operations.push({start:i,end:i,before,after,kind:'shrink',evidence:[old.eventId,e.eventId]});continue;}
      if(!(after<=state.capacity))continue;
      const first=offset+before*bytes,last=offset+after*bytes;
      const writes=events.slice(lower+1,next).filter(w=>w.kind==='WRITE'&&w.target?.objectId===state.backingObjectId&&
        w.target.offset>=first&&w.target.offset+w.target.size<=last&&w.target.size>0&&
        w.target.offset%bytes===offset%bytes&&w.target.size%bytes===0&&addressed(w,length,before,lower));
      const sorted=writes.slice().sort((a,b)=>a.target.offset-b.target.offset);let covered=first;
      for(const w of sorted){if(w.target.offset>covered)break;covered=Math.max(covered,w.target.offset+w.target.size);}
      if(covered!==last)continue;
      const indices=writes.map(w=>pos.get(w.eventId));operations.push({start:Math.min(i,...indices),end:Math.max(i,...indices),before,after,kind:'append',
        evidence:[old.eventId,e.eventId,...writes.map(w=>w.eventId)],backingObjectId:state.backingObjectId});
    }
    if(!operations.some(o=>o.kind==='append'))continue;
    let trusted=null,witnessed=false,lastBacking=null,lastOffset=0;const proof=[],timeline=[];
    for(let i=0;i<events.length;i++){
      const current=stateAt(m,i,pos);if(!current)continue;
      if(current.backingObjectId&&lastBacking&&current.backingObjectId!==lastBacking){
        const created=byEvent.get(byObject.get(current.backingObjectId)?.createdBy),copy=created?.copiedFrom;
        if(!copy||copy.objectId!==lastBacking||copy.offset!==lastOffset||copy.size<(trusted??Infinity)*array.elementBytes||current.byteOffset!==0)trusted=null;
      }
      if(current.backingObjectId){lastBacking=current.backingObjectId;lastOffset=current.byteOffset??0;}
      const completed=operations.filter(o=>o.end===i);
      for(const o of completed){
        if(o.before===trusted||o.before===0){trusted=o.after;if(o.kind==='append')witnessed=true;proof.push(...o.evidence);}
        else trusted=null;
      }
      const pending=operations.filter(o=>o.start<=i&&i<o.end);
      if(!pending.length&&current.length!==trusted){if(current.length===0)trusted=0;else trusted=null;}
      const rolesValid=current.active&&current.status==='consistent',consistent=witnessed&&rolesValid&&!pending.length&&trusted===current.length,
        bounded=consistent&&trusted>=0&&trusted<=array.capacity,
        bound=current.backingObjectId===array.range.objectId&&(current.byteOffset??0)===array.range.offset;
      timeline.push({i,current,bound,known:bounded,pending:pending.flatMap(o=>o.evidence),evidence:[...new Set(proof)]});
    }
    if(!timeline.some(t=>t.bound&&t.known))continue;
    array.roles={...array.roles,length,capacity};
    const indices=new Set([...array.states.map(s=>pos.get(s.afterExecutionId)),...m.states.map(s=>pos.get(s.afterExecutionId)),...operations.flatMap(o=>[o.start,o.end])]);
    array.states=[...indices].sort((a,b)=>a-b).flatMap(i=>{
      const prior=stateAt(array,i,pos),t=timeline.findLast(t=>t.i<=i);if(!prior||!t)return [];
      const active=prior.active&&t.bound&&t.current.active,known=active&&t.known,len=known?t.current.length:null;
      return [{...prior,afterExecutionId:events[i].eventId,active,rolesAlive:t.current.active,length:len,
        logicalCapacity:t.current.capacity,status:known?'consistent':active&&t.pending.length?'intermediate':'unresolved',
        logicalOrder:known?{start:0,count:len,modulus:array.capacity,direction:1,mapping:'physicalIndex=logicalIndex'}:null,
        inactiveRanges:known?(len<array.capacity?[{objectId:array.range.objectId,offset:array.range.offset+len*array.elementBytes,size:(array.capacity-len)*array.elementBytes}]:[]):null,
        membership:known?{kind:'prefix',start:0,count:len,evidenceExecutionIds:t.evidence}:null,
        pendingOperations:t.pending}];
    });
    array.membershipEvidence=operations.map(o=>({kind:o.kind,before:o.before,after:o.after,completeExecutionId:events[o.end].eventId,evidenceExecutionIds:o.evidence}));
    array.latestValidState=array.states.findLast(s=>s.active&&s.status==='consistent')??null;
    array.membershipPolicy='observed endpoint writes establish occupied prefix; shrink need not read discarded elements; order is storage order, not removal policy';
  }
  return [];
}
