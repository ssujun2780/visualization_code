import {createValueFlow} from './observed-value-flow.mjs';
import {scalarNumber,sameSlot,slotTimeline,complementRanges} from './array-membership.mjs';
const inside=(r,t)=>r&&t&&r.objectId===t.objectId&&t.offset>=r.offset&&t.offset+t.size<=r.offset+r.size;
const key=r=>`${r.objectId}:${r.offset}:${r.size}`;
const numberPredicate=(op,value,constant)=>op==='=='?value===constant:op==='!='?value!==constant:op==='!'?value===0:value!==0;

// A flag is membership only with witnessed gated data reads AND both
// occupancy transitions coupled to one cardinality slot. 0/1 values alone,
// a common index, or a one-way visited marker are insufficient.
export function arrayOccupancyStructures(plan,context){
  const {events,structures,objects}=context,byEvent=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    byObject=new Map(objects.map(o=>[o.id,o])),
    flow=context.valueFlow??createValueFlow(plan,context),arrays=structures.filter(s=>s.kind==='array-structure'),
    physical=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),candidates=[];
  const index=(s,e)=>inside(s.range,e?.target)&&e.target.size===s.elementBytes?(e.target.offset-s.range.offset)/s.elementBytes:null;
  function predicate(branch){
    const calc=(branch.dataInputs??[]).map(id=>byEvent.get(id)).find(e=>e?.kind==='CALC'),step=calc?.steps?.at(-1);
    if(!step||!['truth','!','==','!='].includes(step.operator))return null;
    const operands=(step.inputs??[]).map(i=>flow.sourceReadOperand(i,calc,step));
    if(operands.filter(Boolean).length!==1)return null;
    const side=operands.findIndex(Boolean),read=operands[side],constant=scalarNumber(step.inputs[1-side]?.value)??0;
    if(['==','!='].includes(step.operator)&&step.inputs[1-side]?.executionId)return null;
    const selected=scalarNumber(branch.condition)!==0;
    return {read,operator:step.operator,constant,selected,
      accept:value=>numberPredicate(step.operator,value,constant)===selected};
  }
  for(const group of structures.filter(s=>s.kind==='coindexed-record-candidate')){
    const members=group.arrays.map(a=>physical.get(a.arrayId)).filter(Boolean).map(a=>arrays.find(s=>sameSlot(s.range,a.range))).filter(Boolean);
    for(const data of members)for(const mask of members){
      if(data===mask||data.capacity!==mask.capacity||mask.capacity>4096||mask.elementBytes>8)continue;
      const gates=new Map();
      for(const e of events)if(e.kind==='READ'&&Number.isInteger(index(data,e)))for(const id of e.controlInputs??[]){
        const branch=byEvent.get(id),p=branch?.action==='branch'&&predicate(branch);
        if(!p||index(mask,p.read)!==index(data,e))continue;
        const idp=JSON.stringify([p.operator,p.constant,p.selected]);
        if(!gates.has(idp))gates.set(idp,{...p,evidence:[]});gates.get(idp).evidence.push(branch.eventId,p.read.eventId,e.eventId);
      }
      for(const p of gates.values()){
        const histories=Array.from({length:mask.capacity},(_,i)=>slotTimeline({objectId:mask.range.objectId,offset:mask.range.offset+i*mask.elementBytes,size:mask.elementBytes},events,
          {signed:mask.elementType?.signedness==='signed'})),counts=new Map();
        for(const e of events){
          const at=pos.get(e.eventId),n=index(mask,e);if(e.kind!=='WRITE'||!Number.isInteger(n))continue;
          const before=histories[n].findLast(x=>x.sequence<at)?.value,after=histories[n].findLast(x=>x.sequence<=at)?.value;
          if(before==null||after==null)continue;const delta=Number(p.accept(after))-Number(p.accept(before));if(!delta)continue;
          // A changing flag must be guarded by its own previous observation.
          const guards=(e.controlInputs??[]).filter(id=>{
            const b=byEvent.get(id);return b?.action==='branch'&&(b.dataInputs??[]).flatMap(x=>flow.dependencyReads(x)).some(r=>sameSlot(r.target,e.target));
          });if(!guards.length)continue;
          if(delta>0&&!events.some(w=>w.kind==='WRITE'&&w.activationId===e.activationId&&index(data,w)===n&&guards.some(id=>w.controlInputs?.includes(id))))continue;
          for(const w of events)if(w.kind==='WRITE'&&w.activationId===e.activationId&&w.target?.size<=8&&!inside(data.range,w.target)&&!inside(mask.range,w.target)&&
            guards.some(id=>w.controlInputs?.includes(id))){
            const old=(w.dataInputs??[]).flatMap(id=>flow.dependencyReads(id)).find(r=>sameSlot(r.target,w.target)),a=scalarNumber(old?.value),b=scalarNumber(w.value);
            if(a===null||b===null||b-a!==delta)continue;
            const id=key(w.target);if(!counts.has(id))counts.set(id,{slot:{...w.target,cType:w.value.cType},changes:[]});
            counts.get(id).changes.push({delta,index:n,at:Math.max(at,pos.get(w.eventId)),evidence:[e.eventId,old.eventId,w.eventId,...guards]});
          }
        }
        const valid=[...counts.values()].filter(c=>c.changes.some(x=>x.delta>0)&&c.changes.some(x=>x.delta<0));
        if(valid.length!==1)continue;
        const counter=valid[0],discovered=Math.max(Math.min(...p.evidence.map(id=>pos.get(id))),
          Math.min(...counter.changes.filter(x=>x.delta>0).map(x=>x.at)),Math.min(...counter.changes.filter(x=>x.delta<0).map(x=>x.at)));
        candidates.push({data,mask,p,counter,histories,discovered});
      }
    }
  }
  for(const data of arrays){
    const choices=[...new Map(candidates.filter(c=>c.data===data).map(c=>[`${c.mask.id}:${key(c.counter.slot)}:${c.p.operator}:${c.p.constant}:${c.p.selected}`,c])).values()];
    if(choices.length!==1||data.states.some(s=>s.logicalOrder))continue;
    const {mask,p,counter,histories,discovered}=choices[0],counts=slotTimeline(counter.slot,events,{signed:counter.slot.cType?.signedness==='signed'}),
      counterObject=byObject.get(counter.slot.objectId),counterEnd=pos.get(counterObject?.endedBy),
      all=new Set([...data.states.map(s=>pos.get(s.afterExecutionId)),...mask.states.map(s=>pos.get(s.afterExecutionId)),
        ...histories.flatMap(h=>h.map(x=>x.sequence)),...counts.map(x=>x.sequence),discovered,...counterEnd===undefined?[]:[counterEnd]]);
    const evidence=[...new Set([...p.evidence,...counter.changes.flatMap(x=>x.evidence)])];
    data.roles={...data.roles,length:counter.slot,membership:{...mask.range,cType:mask.elementType}};
    const old=data.states;data.states=[...all].sort((a,b)=>a-b).flatMap(i=>{
      const state=old.findLast(s=>pos.get(s.afterExecutionId)<=i);if(!state)return [];
      if(i<discovered)return [{...state,afterExecutionId:events[i].eventId}];
      const values=histories.map(h=>h.findLast(x=>x.sequence<=i)?.value??null),activeIndices=[],unknownIndices=[];
      values.forEach((v,n)=>{if(v===null)unknownIndices.push(n);else if(p.accept(v))activeIndices.push(n);});
      const counterAlive=!!counterObject&&(counterEnd===undefined||i<counterEnd),
        length=counterAlive?counts.findLast(x=>x.sequence<=i)?.value??null:null,
        maskState=mask.states.findLast(s=>pos.get(s.afterExecutionId)<=i),active=state.active,readable=active&&maskState?.active,
        known=counterAlive&&unknownIndices.length===0&&length===activeIndices.length;
      return [{...state,afterExecutionId:events[i].eventId,active,rolesAlive:!!maskState?.active&&counterAlive,length,logicalOrder:null,
        status:!readable?'unresolved':known?'consistent':!counterAlive||unknownIndices.length?'partial':'intermediate',
        activeIndices:readable?activeIndices:null,unknownIndices:readable?unknownIndices:null,
        inactiveRanges:readable?complementRanges(data.range,data.elementBytes,data.capacity,[...activeIndices,...unknownIndices]):null,
        membership:readable?{kind:'sparse',status:known?'supported':'partial',maskRange:{...mask.range},
          predicate:{operator:p.operator,constant:p.constant,selected:p.selected},
          evidenceExecutionIds:evidence.filter(id=>pos.get(id)<=i)}:null}];
    });
    data.latestValidState=data.states.findLast(s=>s.active&&s.status==='consistent')??null;
    data.membershipPolicy='observed conditional access and bidirectional flag/cardinality transitions; occupied set does not establish logical order';
  }
  return [];
}
