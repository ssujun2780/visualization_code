// Count-controlled circular storage. Slot identity and writer provenance prove
// observed FIFO order; matching payload numbers are never sufficient.
import {slotTimeline} from './array-membership.mjs';
const num=v=>Number(v?.decimal??v?.signed??v?.unsigned);
const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const slot=r=>({objectId:r.objectId,offset:r.offset,size:r.size});
export const wrapsAt=(step,capacity)=>step?.operator==='%'&&num(step.inputs?.[1]?.value)===capacity||
 step?.operator==='&'&&Number.isSafeInteger(capacity)&&capacity>0&&(BigInt(capacity)&BigInt(capacity-1))===0n&&num(step.inputs?.[1]?.value)===capacity-1;
export function countedQueueStructures(plan,trace){
  const {events,structures}=trace,byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    work=structures.find(s=>s.kind==='array-work'),out=[];
  const ancestors=(id,seen=new Set())=>{if(seen.has(id))return [];seen.add(id);const e=byId.get(id);return e?[e,...(e.dataInputs??[]).flatMap(id=>ancestors(id,seen))]:[];};
  const inputReads=(id,seen=new Set())=>{if(seen.has(id))return [];seen.add(id);const e=byId.get(id);return !e?[]:e.kind==='READ'?[e]:(e.dataInputs??[]).flatMap(id=>inputReads(id,seen));};
  const calls=new Map(events.filter(e=>e.action==='return'&&e.callExecutionId).map(e=>[e.activationId,byId.get(e.callExecutionId)]));
  const controlsOf=(e,seen=new Set())=>{if(!e||seen.has(e.activationId))return [];seen.add(e.activationId);return [...e.controlInputs??[],...controlsOf(calls.get(e.activationId),seen)];};
  for(const a of structures.filter(s=>s.kind==='array')){
    const own=(work?.accesses??[]).filter(x=>x.target.arrayId===a.id&&x.target.elementOffset===0&&x.target.size===a.elementBytes&&['READ','WRITE'].includes(x.kind)),accesses=[];
    for(const x of own){const axis=x.axes?.[0],c=x.cursors.filter(c=>axis?.indexDeclarationIds.includes(c.declarationId)),read=c.length===1&&byId.get(c[0].executionId);
      if(!read||num(read.value)!==x.target.index||!axis?.index||axis.index.offset!==0)continue;
      accesses.push({x,read,cursor:key(read.target)});
    }
    const grouped={READ:new Map(),WRITE:new Map()};
    for(const x of accesses){const map=grouped[x.x.kind],list=map.get(x.cursor)??[];list.push(x);map.set(x.cursor,list);}
    const fronts=[...grouped.READ.keys()],backs=[...grouped.WRITE.keys()];
    for(const front of fronts)for(const back of backs){if(front===back)continue;
      const frontAccesses=grouped.READ.get(front),backAccesses=grouped.WRITE.get(back);
      if(frontAccesses.length+backAccesses.length!==own.length)continue;
      const selected=[...frontAccesses,...backAccesses].sort((a,b)=>pos.get(a.x.executionId)-pos.get(b.x.executionId));
      const timelines=new Map([[front,slotTimeline(frontAccesses[0].read.target,events)],[back,slotTimeline(backAccesses[0].read.target,events)]]);
      const ops=[];let broken=false;
      for(let i=0;i<selected.length;i++){
        const {x,read,cursor}=selected[i],at=pos.get(x.executionId),until=i+1<selected.length?pos.get(selected[i+1].read.eventId):events.length,
          updates=events.slice(pos.get(read.eventId)+1,until).filter(e=>e.kind==='WRITE'&&key(e.target)===cursor),update=updates[0];
        if(!update){broken=true;break;}
        const producers=(update.dataInputs??[]).flatMap(id=>ancestors(id)),mod=producers.find(e=>e.kind==='CALC'&&e.steps?.some(s=>wrapsAt(s,a.capacity))),
          updateRead=producers.find(e=>e.kind==='READ'&&key(e.target)===cursor&&num(e.value)===num(read.value));
        if(!mod||!updateRead||num(update.value)!==(num(read.value)+1)%a.capacity){broken=true;break;}
        const delta=x.kind==='WRITE'?1:-1,counts=[];
        for(const e of events.slice(at+1,until))if(e.kind==='WRITE'&&e.target?.size<=8&&key(e.target)!==front&&key(e.target)!==back&&!(e.target.objectId===a.objectId&&e.target.offset<a.range.offset+a.range.size&&e.target.offset+e.target.size>a.range.offset)){
          const reads=(e.dataInputs??[]).flatMap(id=>inputReads(id)).filter(r=>key(r.target)===key(e.target));
          if(reads.length===1&&num(e.value)-num(reads[0].value)===delta)counts.push({read:reads[0],write:e});
        }
        ops.push({kind:delta===1?'enqueue':'dequeue',role:delta===1?'back':'front',index:x.target.index,accessExecutionId:x.executionId,
          cursorReadExecutionId:read.eventId,updateExecutionId:update.eventId,updateOriginExecutionId:updateRead.eventId,modulusExecutionId:mod.eventId,
          startedAtExecutionId:read.eventId,completedAtExecutionId:update.eventId,cursorBefore:num(read.value),cursorAfter:num(update.value),counts,status:'supported'});
      }
      if(broken||!ops.some(o=>o.kind==='enqueue')||!ops.some(o=>o.kind==='dequeue'))continue;
      // A full flag resolves equal cursors without inventing a count slot.
      // Observe every completed endpoint operation and replay writer identities.
      const flagSets=ops.map((op,i)=>{const start=pos.get(op.accessExecutionId),end=i+1<ops.length?pos.get(ops[i+1].startedAtExecutionId):events.length;
        return events.slice(start+1,end).filter(e=>e.kind==='WRITE'&&e.target?.size<=8&&![front,back].includes(key(e.target))&&!(e.target.objectId===a.objectId&&e.target.offset<a.range.offset+a.range.size&&e.target.offset+e.target.size>a.range.offset)&&[0,1].includes(num(e.value)));});
      const flags=[...new Set(flagSets[0]?.map(e=>key(e.target))??[])].filter(k=>flagSets.every(set=>set.some(e=>key(e.target)===k)));
      for(const flag of flags){const pending=[],states=[],operations=[];let invalid=false,sawFull=false,sawEmpty=false;
        const guards=ops.flatMap(op=>controlsOf(byId.get(op.accessExecutionId))).map(id=>byId.get(id)).filter(e=>(e?.dataInputs??[]).some(id=>inputReads(id).some(r=>key(r.target)===flag)));
        if(!guards.length)continue;
        const firstFlag=slotTimeline(flagSets[0].find(e=>key(e.target)===flag).target,events).findLast(r=>r.sequence<pos.get(ops[0].accessExecutionId));
        const initial=k=>timelines.get(k).findLast(r=>r.sequence<pos.get(ops[0].accessExecutionId))?.value;
        if(firstFlag?.value!==0||initial(front)!==initial(back))continue;
        for(const [i,op]of ops.entries()){
          const flagWrite=flagSets[i].findLast(e=>key(e.target)===flag),e=byId.get(op.accessExecutionId);let matched=null;
          if(op.kind==='enqueue')pending.push({index:op.index,write:op.accessExecutionId});else{matched=pending.shift();if(!matched||matched.index!==op.index||!e.dataInputs?.includes(matched.write))invalid=true;}
          const done=[op.completedAtExecutionId,flagWrite.eventId].sort((a,b)=>pos.get(a)-pos.get(b)).at(-1),cursorAt=k=>timelines.get(k).findLast(r=>r.sequence<=pos.get(done))?.value,f=cursorAt(front),b=cursorAt(back);
          if(pending.length>a.capacity||new Set(pending.map(p=>p.index)).size!==pending.length||num(flagWrite.value)!==Number(pending.length===a.capacity)||b!==(f+pending.length)%a.capacity||pending.some((p,i)=>p.index!==(f+i)%a.capacity))invalid=true;
          sawFull||=pending.length===a.capacity;sawEmpty||=pending.length===0;
          const {counts,...clean}=op;operations.push({...clean,completedAtExecutionId:done,fullWriteExecutionId:flagWrite.eventId,consumedWriteExecutionId:matched?.write??null,status:invalid?'contradicted':'supported'});
          states.push({executionId:done,status:invalid?'contradicted':'supported',count:pending.length,front:f,back:b,full:num(flagWrite.value)===1,capacity:a.capacity,activeRange:null,logicalOrder:null,
            ringOrder:invalid?null:{indices:pending.map(p=>p.index),writeExecutionIds:pending.map(p=>p.write)},pendingAccessExecutionIds:[],contradictingExecutionIds:invalid?[done]:[]});
        }
        if(invalid||!sawFull||!sawEmpty)continue;
        const known=states.find(s=>s.full)?.executionId,inferred=[known,operations.find(o=>o.kind==='dequeue').completedAtExecutionId].sort((a,b)=>pos.get(a)-pos.get(b)).at(-1);
        out.push({id:`flag-queue:${a.id}:${front}:${back}:${flag}`,kind:'queue-candidate',layout:'flag-ring',arrayId:a.id,objectId:a.objectId,range:a.range,elementBytes:a.elementBytes,capacity:a.capacity,nodes:[],edges:[],
          roles:{front:slot(accesses.find(x=>x.cursor===front).read.target),back:slot(accesses.find(x=>x.cursor===back).read.target),full:slot(flagSets[0].find(e=>key(e.target)===flag).target),indexOffset:0},
          comparisons:[],guardExecutionIds:[...new Set(guards.map(e=>e.eventId))],operations,states,inferredAtExecutionId:inferred,origin:'inferred',intent:'unconfirmed',limitations:['observed full/empty distinction and FIFO identities; count is derived, not a stored C variable']});
      }
      const countKeys=[...new Set(ops[0].counts.map(c=>key(c.write.target)))].filter(k=>ops.every(o=>o.counts.filter(c=>key(c.write.target)===k).length===1));
      for(const countKey of countKeys){const count=ops[0].counts.find(c=>key(c.write.target)===countKey),pending=[],states=[],operations=[];let invalid=false;
        if(num(count.read.value)!==0)continue;
        for(const op of ops){const c=op.counts.find(c=>key(c.write.target)===countKey),e=byId.get(op.accessExecutionId),before=pending.length;
          let matched=null;if(op.kind==='enqueue')pending.push({index:op.index,write:op.accessExecutionId});else{
            matched=pending.shift();if(!matched||matched.index!==op.index||!e.dataInputs?.includes(matched.write))invalid=true;
          }
          if(num(c.read.value)!==before||num(c.write.value)!==pending.length||pending.length>a.capacity||new Set(pending.map(x=>x.index)).size!==pending.length)invalid=true;
          const {counts,...clean}=op,done=pos.get(c.write.eventId)>pos.get(op.completedAtExecutionId)?c.write.eventId:op.completedAtExecutionId;
          operations.push({...clean,completedAtExecutionId:done,countReadExecutionId:c.read.eventId,countWriteExecutionId:c.write.eventId,
            consumedWriteExecutionId:matched?.write??null,status:invalid?'contradicted':'supported'});
          const cursorAt=k=>timelines.get(k).findLast(e=>e.sequence<=pos.get(done))?.value,frontValue=cursorAt(front),backValue=cursorAt(back);
          if(!Number.isSafeInteger(frontValue)||!Number.isSafeInteger(backValue)||backValue!==(frontValue+pending.length)%a.capacity||pending.some((p,i)=>p.index!==(frontValue+i)%a.capacity))invalid=true;
          states.push({executionId:done,status:invalid?'contradicted':'supported',count:pending.length,front:frontValue,
            back:backValue,capacity:a.capacity,activeRange:null,logicalOrder:null,
            ringOrder:invalid?null:{indices:pending.map(x=>x.index),writeExecutionIds:pending.map(x=>x.write)},pendingAccessExecutionIds:[],contradictingExecutionIds:invalid?[done]:[]});
        }
        // Require an observed occupancy read guarding a consumption. A pair of
        // copy loops with counters is insufficient evidence for a live queue.
        const controls=ops.filter(o=>o.kind==='dequeue').flatMap(o=>controlsOf(byId.get(o.accessExecutionId))),guards=controls.map(id=>byId.get(id)).filter(e=>(e?.dataInputs??[]).some(id=>inputReads(id).some(r=>key(r.target)===countKey)));
        if(!guards.length||invalid)continue;
        out.push({id:`counted-queue:${a.id}:${front}:${back}:${countKey}`,kind:'queue-candidate',layout:'ring',arrayId:a.id,objectId:a.objectId,range:a.range,elementBytes:a.elementBytes,capacity:a.capacity,
          nodes:[],edges:[],roles:{front:slot(accesses.find(x=>x.cursor===front).read.target),back:slot(accesses.find(x=>x.cursor===back).read.target),count:slot(count.write.target),indexOffset:0},
          comparisons:[],guardExecutionIds:[...new Set(guards.map(e=>e.eventId))],operations,states,inferredAtExecutionId:[operations.find(o=>o.kind==='dequeue').completedAtExecutionId,guards.sort((a,b)=>pos.get(a.eventId)-pos.get(b.eventId))[0].eventId].sort((a,b)=>pos.get(a)-pos.get(b)).at(-1),
          origin:'inferred',intent:'unconfirmed',limitations:['observed occupancy and FIFO provenance; no algorithm intent assertion']});
      }
    }
  }
  return out;
}
