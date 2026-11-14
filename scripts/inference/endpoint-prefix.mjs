import {slotTimeline,sameSlot,scalarNumber} from './array-membership.mjs';
// An end cursor can start after reserved slots. Establish [base,end) through
// actual endpoint writes and count provenance, not a maximum accessed index.
export function endpointPrefix(trace,array,owner,base){
 const {events,objects,valueFlow:flow}=trace,r=owner?.roles?.length,proofs=[],states=[];
 if(!r||!flow)return {proofs,at:()=>null};
 const slot={objectId:r.objectId??owner.ownerObjectId,offset:r.offset+(r.objectId?0:owner.ownerOffset??0),size:r.size},
  pos=new Map(events.map((e,i)=>[e.eventId,i])),timeline=slotTimeline(slot,events,{signed:r.cType?.signedness!=='unsigned'}),
  changes=timeline.filter(t=>t.event.kind!=='READ'),ops=[];
 for(let k=0;k<changes.length;k++){
  const {event:e,sequence:at,value:after}=changes[k],lower=changes[k-1]?.sequence??-1,next=changes[k+1]?.sequence??events.length,
    old=(e.dataInputs??[]).flatMap(id=>flow.dependencyReads(id)).find(x=>sameSlot(x.target,slot)),before=scalarNumber(old?.value);
  if(before===null||after===null||after<base||after>array.capacity||before<base||before===after)continue;
  if(after<before){ops.push({start:at,end:at,before,after,evidence:[old.eventId,e.eventId]});continue;}
  // Cover every new element with a complete recorded WRITE/COPY whose address
  // comes from the previous end cursor. Unrelated equal numbers are excluded.
  const first=array.range.offset+before*array.elementBytes,last=array.range.offset+after*array.elementBytes,
   writes=events.slice(lower+1,next).filter(w=>w.kind==='WRITE'&&w.target?.objectId===array.objectId&&
    w.target.offset>=first&&w.target.offset+w.target.size<=last&&w.target.size>0&&w.target.size%array.elementBytes===0&&
    (w.target.offset-first)%array.elementBytes===0&&(w.addressInputs??[]).flatMap(id=>flow.dependencyReads(id)).some(x=>
      sameSlot(x.target,slot)&&scalarNumber(x.value)===before&&pos.get(x.eventId)>lower));
  let covered=first;for(const w of writes.toSorted((a,b)=>a.target.offset-b.target.offset)){if(w.target.offset>covered)break;covered=Math.max(covered,w.target.offset+w.target.size);}
  if(covered===last)ops.push({start:Math.min(at,...writes.map(w=>pos.get(w.eventId))),end:Math.max(at,...writes.map(w=>pos.get(w.eventId))),before,after,
    evidence:[old.eventId,e.eventId,...writes.map(w=>w.eventId)]});
 }
 let trusted=null,witnessed=false;const evidence=[];
 for(let i=0;i<events.length;i++){
  const current=timeline.findLast(t=>t.sequence<=i),value=current?.value;
  if(value===base&&!ops.some(o=>o.start<=i&&i<o.end))trusted=base;
  for(const op of ops.filter(o=>o.end===i)){
   if(trusted===op.before){trusted=op.after;witnessed||=op.after>op.before;evidence.push(...op.evidence);
    proofs.push({afterExecutionId:events[i].eventId,count:trusted,start:base,countSources:[{range:slot,executionId:current.eventId}],evidenceExecutionIds:[...new Set(evidence)]});
   }else trusted=null;
  }
  const pending=ops.some(o=>o.start<=i&&i<o.end);if(!pending&&value!==trusted)trusted=null;
  const alive=[array.objectId,slot.objectId].every(id=>{const o=objects.find(o=>o.id===id);return o&&pos.get(o.createdBy)<=i&&i<(pos.get(o.endedBy)??Infinity);});
  states.push(witnessed&&alive&&!pending&&value===trusted?{count:trusted,afterExecutionId:events[i].eventId,evidenceExecutionIds:[...new Set(evidence)]}:null);
 }
 return {proofs,at:id=>states[pos.get(id)]??null};
}
