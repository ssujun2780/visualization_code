import {createValueFlow} from './observed-value-flow.mjs';
import {slotTimeline} from './array-membership.mjs';
import {validateStateHistory} from './state-history.mjs';
import {equalityEvidence,addressDependencyReads} from './comparison-evidence.mjs';
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const inside=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&b.offset+b.size<=a.offset+a.size;
export function validateAssociativeStructures(plan,trace){
  const candidates=trace.structures.filter(s=>s.kind==='associative-lookup-candidate');if(!candidates.length)return;
  const events=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    objects=new Map(trace.objects.map(o=>[o.id,o])),arrays=new Map(trace.structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),
    flow=createValueFlow(plan,trace),cache=new Map(),comparisons=equalityEvidence(plan,trace);
  const need=(ok,message)=>{if(!ok)throw new Error(`연관 조회 근거 불일치: ${message}`);};
  const event=id=>{need(events.has(id),'사건 식별자');return events.get(id);};
  const range=r=>need(r&&objects.has(r.objectId)&&Number.isSafeInteger(r.offset)&&Number.isSafeInteger(r.size)&&r.offset>=0&&r.size>0&&r.offset+r.size<=objects.get(r.objectId).size,'저장 범위');
  const at=(r,id,signed=true)=>{range(r);const k=JSON.stringify([r.objectId,r.offset,r.size,signed]);if(!cache.has(k))cache.set(k,slotTimeline(r,trace.events,{signed}));return cache.get(k).findLast(x=>x.sequence<=positions.get(id));};
  const source=(w,r)=>{
    if(w.action==='copy'){
      const src={objectId:w.sourceObjectId,offset:(w.sourceOffset??0)+r.offset-w.target.offset,size:r.size};
      w=trace.events.slice(0,positions.get(w.eventId)).findLast(e=>e.kind==='WRITE'&&inside(e.target,src));
    }
    return (w?.dataInputs??[]).flatMap(id=>flow.dependencyReads(id,undefined,undefined,new Set(),()=>false));
  };
  for(const s of candidates){
    validateStateHistory(s,positions);
    need(s.intent==='unconfirmed','후보와 확정 의미 분리');const bucket=arrays.get(s.bucketArrayId);need(bucket,'버킷 배열');event(s.discoveredAtExecutionId);
    for(const r of s.storageRanges)range(r);
    for(const p of s.lookupEvidence){
      const calc=event(p.executionId),stored=event(p.keyReadExecutionId),query=event(p.queryReadExecutionId),seed=event(p.seedExecutionId),
        step=calc.steps?.find(x=>x.nodeId===p.comparisonNodeId&&x.operator===p.operator);
      need(['==','!='].includes(p.operator)&&step?.inputs?.length===2,'키 비교 연산');
      const normalized=comparisons.find(p=>p.event.eventId===calc.eventId&&p.step.nodeId===step.nodeId),operands=normalized?.reads.map(r=>r.eventId)??[];
      if(p.comparisonDomain)need(p.comparisonDomain===normalized?.domain&&p.comparisonCallExecutionId===normalized?.comparisonCallExecutionId&&p.comparisonReturnExecutionId===normalized?.comparisonReturnExecutionId,'비교 의미와 호출 출처');
      need(operands.includes(stored.eventId)&&operands.includes(query.eventId)&&stored.eventId!==query.eventId,'비교 피연산자 출처');
      need(same(stored.target,p.keyRange),'키 저장 위치');range(p.keyRange);
      need(flow.chain(query.eventId).at(-1)?.eventId===p.queryOriginExecutionId,'검색 키 출처');
      need(inside(bucket.range,seed.target)&&positions.get(seed.eventId)<=positions.get(stored.eventId),'키 접근 이전 버킷');
      const dependency=addressDependencyReads(flow,events,seed.addressInputs??[]);need(dependency.complete&&dependency.reads.some(r=>flow.chain(r.eventId).at(-1)?.eventId===p.queryOriginExecutionId),'검색 키와 버킷 주소 의존');
      need(p.bucketIndex===Math.floor((seed.target.offset-bucket.range.offset)/bucket.elementBytes),'버킷 좌표');
      const result=Number(step.value?.decimal??step.value?.signed??step.value?.unsigned);
      need(p.matched===((result!==0)===(p.operator==='==')),'비교 결과');
    }
    need(s.lookupEvidence.some(p=>p.executionId===s.discoveredAtExecutionId),'최초 비교 발견');
    for(const p of s.insertionEvidence){const w=event(p.executionId);range(p.keyRange);
      need(w.kind==='WRITE'&&inside(w.target,p.keyRange),'키 삽입 쓰기');
      need(source(w,p.keyRange).some(r=>r.eventId===p.queryReadExecutionId),'키 삽입 출처');
      need(positions.get(p.availableAtExecutionId)>=Math.max(positions.get(p.executionId),positions.get(p.seedExecutionId)),'삽입 발견 시점');
    }
    for(const role of s.roles.states){need(arrays.has(role.arrayId),'상태 배열');
      for(const v of role.values)for(const p of v.evidence){const e=event(p.readExecutionId),a=arrays.get(role.arrayId);
        need(e.kind==='READ'&&inside(a.range,e.target)&&e.target.offset===a.range.offset+p.index*a.elementBytes+role.offset&&e.target.size===role.size,'상태 읽기 위치');
        need(Number(e.value?.decimal??e.value?.signed??e.value?.unsigned)===v.value,'상태 코드');
        for(const id of [p.comparisonExecutionId,p.reuseWriteExecutionId,p.nextAccessExecutionId,p.stopExecutionId].filter(Boolean))need(positions.get(event(id).eventId)>positions.get(e.eventId),'상태 동작 근거 순서');
      }
    }
    for(const state of s.states){event(state.afterExecutionId);const seq=positions.get(state.afterExecutionId);
      need(seq>=positions.get(s.discoveredAtExecutionId),'발견 이전 상태');
      for(const e of state.entries){range(e.record);range(e.keyRange);need(inside(e.record,e.keyRange),'항목 내부 키');
        need(positions.get(e.discovered)<=seq,'미래 항목');
        const observed=at(e.keyRange,state.afterExecutionId,e.keyType?.signedness!=='unsigned');need((observed?.value??observed?.integer)===e.key,'키 스냅샷');
        for(const v of e.values){need(positions.get(v.discovered)<=seq,'미래 값 역할');need(at(v.range,state.afterExecutionId)?.value===v.value,'값 스냅샷');}
        for(const v of e.slotStates){need(at(v.range,state.afterExecutionId)?.value===v.value,'슬롯 상태 스냅샷');for(const id of v.evidenceExecutionIds)need(positions.get(event(id).eventId)<=seq,'미래 상태 근거');}
      }
    }
    for(const p of s.transfers){const old=candidates.find(c=>c.id===p.sourceCandidateId),entry=s.states.flatMap(x=>x.entries).find(e=>e.id===p.targetEntryId),
        oldEntry=old?.states.flatMap(x=>x.entries).find(e=>e.id===p.sourceEntryId),read=event(p.keyReadExecutionId),write=event(p.keyWriteExecutionId);
      need(entry&&oldEntry&&same(read.target,oldEntry.keyRange)&&inside(write.target,entry.keyRange),'이전/새 키 저장 위치');
      need(source(write,entry.keyRange).some(r=>r.eventId===read.eventId),'재배치 키 전달');
      for(const v of p.values){range(v.sourceRange);range(v.targetRange);need(same(event(v.sourceReadExecutionId).target,v.sourceRange),'이전 값 읽기');
        need(source(event(v.targetWriteExecutionId),v.targetRange).some(r=>r.eventId===v.sourceReadExecutionId),'재배치 값 전달');}
      need(positions.get(p.discoveredAtExecutionId)>=Math.max(positions.get(old.discoveredAtExecutionId),positions.get(s.discoveredAtExecutionId),positions.get(p.afterExecutionId)),'재배치 발견 시점');
    }
  }
}
