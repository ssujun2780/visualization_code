import {validateStructureOverlays} from './structure-overlay-contract.mjs';
import {validateRecordIndexStructures} from './record-index-contract.mjs';
import {validateLinkedProjections} from './linked-projection-contract.mjs';
import {validateValueIndexStructures} from './value-index-views.mjs';
import {validateParallelArrayStructures} from './parallel-array-views.mjs';
import {validateCoindexedRecords} from './coindexed-record-views.mjs';
import {arrayGeometry,arrayLocation} from './array-geometry.mjs';
import {validateArrayValueDependencies} from './array-value-dependencies.mjs';
import {validateArrayCursorPaths} from './array-cursor-paths.mjs';
import {validateAssociativeStructures} from './associative-contract.mjs';
import {validateSequenceLookups} from './sequence-contract.mjs';
import {validateStorageSemantics} from './semantic-contract.mjs';
import {validateExtendedSemantics} from './extension-contract.mjs';
import {validateStateHistory} from './state-history.mjs';
import {verificationStates,historyProofSize} from './history-evidence.mjs';
// Visualization metadata is validated independently of execution recording.
export function validateStructureTrace(plan,trace){
  validateStorageSemantics(plan,trace);
  validateExtendedSemantics(plan,trace);
  const ids=new Set(trace.events.map(e=>e.eventId));
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  const executions=new Map(trace.events.map(e=>[e.eventId,e]));
  const instructions=new Map(plan.instructions.map(d=>[d.id,d]));
  const objects=new Map((trace.objects??[]).map(o=>[o.id,o])),structureViews=new Map((trace.views??[]).map(v=>[v.id,v]));
  for(const s of trace.structures??[]){
    if(s.states)validateStateHistory(s,positions);
    if(s.proofStates){const count=s.proofStates.reduce((n,st)=>n+historyProofSize(s,st),0),proofIds=s.proofStates.map(st=>st.afterExecutionId);
      if(!['range-aggregate-candidate','linked-structure','rooted-index-structure','index-tree'].includes(s.kind)||
        new Set(proofIds).size!==proofIds.length||proofIds.some(id=>!positions.has(id)||s.states.some(st=>st.afterExecutionId===id))||
        !Number.isSafeInteger(s.coverage?.maxProofNodes)||count>s.coverage.maxProofNodes||count!==s.coverage.retainedProofNodes)
        throw new Error('추론 판정 근거의 보관 한도가 올바르지 않습니다.');}
    if(s.kind==='array-work'){
      const arrays=new Map(s.arrays.map(a=>[a.arrayId,a])),transfers=new Set(s.transfers.map(t=>t.id)),temps=new Set(s.temporaries.map(t=>t.id));
      const range=r=>{if(!r)return;const o=objects.get(r.objectId);if(!o||r.offset<0||r.size<0||r.offset+r.size>o.size)
        throw new Error('배열 작업의 실제 저장 범위가 올바르지 않습니다.');};
      const evidence=list=>{if(list.some(id=>!ids.has(id)))throw new Error('배열 작업의 실행 근거가 없습니다.');};
      const storage=new Map(trace.structures.filter(a=>a.kind==='array').map(a=>[a.id,a]));
      for(const a of s.arrays){range(a.range);if(a.range.size!==a.elementBytes*a.capacity)throw new Error('배열 작업의 원소 크기가 올바르지 않습니다.');
        if(JSON.stringify(a.geometry)!==JSON.stringify(arrayGeometry(storage.get(a.arrayId),objects.get(a.range.objectId))))
          throw new Error('배열 작업의 차원과 실제 저장 구조가 다릅니다.');}
      for(const a of s.accesses){range(a.target);evidence([a.executionId,...a.cursors.map(c=>c.executionId)]);
        const array=arrays.get(a.target.arrayId);if(!array||a.target.index!==Math.floor((a.target.offset-array.range.offset)/array.elementBytes))
          throw new Error('배열 작업과 물리 인덱스의 대응이 올바르지 않습니다.');
        const actual=arrayLocation(a.target,storage.get(a.target.arrayId),objects.get(a.target.objectId));
        if(JSON.stringify(a.target)!==JSON.stringify(actual))throw new Error('배열 작업의 좌표와 실제 바이트 범위가 다릅니다.');}
      for(const t of s.transfers){range(t.source);range(t.target);evidence([t.executionId,...(t.readExecutionId?[t.readExecutionId]:[])]);
        if(t.sourceTemporaryId&&!temps.has(t.sourceTemporaryId))throw new Error('복사 원본 임시값의 근거가 없습니다.');}
      for(const t of s.temporaries){range(t.target);range(t.source);range(t.origin);evidence([t.createdBy,...t.comparisonExecutionIds,...t.useExecutionIds]);
        if(!transfers.has(t.transferId)||t.isReference!==false)throw new Error('임시 복사값과 전달 사건이 연결되지 않았습니다.');}
      for(const c of s.comparisons){evidence([c.executionId]);for(const o of c.operands){range(o.storage);if(o.executionId)evidence([o.executionId]);
        if(o.temporaryId&&!temps.has(o.temporaryId))throw new Error('비교 피연산자의 임시값이 없습니다.');}}
      for(const a of s.activations)for(const r of a.ranges){const array=arrays.get(r.arrayId);
        evidence([...r.executionIds,...r.observedAccessExecutionIds,...r.contradictingExecutionIds]);
        const axisCapacity=Number.isSafeInteger(r.axis)?array?.geometry?.dimensions[r.axis]:null;
        if(!array||r.axisCapacity!==axisCapacity||r.status==='supported'&&(!Number.isSafeInteger(axisCapacity)||
          !Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<r.start||r.end>axisCapacity))
          throw new Error('작업 구간과 공유 배열 범위가 일치하지 않습니다.');}
    }
    if(s.kind==='index-tree'){
      const array=trace.structures.find(a=>a.kind==='array'&&a.id===s.arrayId),d=s.descriptor;
      if(!array||s.objectId!==array.objectId||s.range.objectId!==array.range.objectId||s.range.offset!==array.range.offset||s.range.size!==array.range.size||
        s.elementBytes!==array.elementBytes||s.capacity!==array.capacity||s.isPointerStructure!==false||
        !Number.isSafeInteger(d.degree)||d.degree<2||!Number.isSafeInteger(d.base)||d.base<0||d.base>=s.capacity)
        throw new Error('인덱스 트리 후보와 실제 배열 범위가 일치하지 않습니다.');
      if(s.orderingProperty){const p=s.orderingProperty;
        if(!array.elementType?.members?.some(m=>m.offsetBits===p.offset*8&&m.sizeBits===p.size*8)||!['signed','unsigned'].includes(p.type?.signedness))
          throw new Error('인덱스 트리의 비교 속성이 실제 구조체 필드와 다릅니다.');
      }
      for(const p of s.copyAccessEvidence??[]){const e=executions.get(p.executionId),r=executions.get(p.cursorReadExecutionId);
        if(p.arrayId!==array.id||e?.action!=='copy'||e.target?.objectId!==array.objectId||e.target.size!==array.elementBytes||
          e.target.offset!==array.range.offset+p.index*array.elementBytes||r?.kind!=='READ'||Number(r.value?.decimal)!==p.index||!e.addressInputs?.includes(r.eventId))
          throw new Error('인덱스 트리의 복사 목적지 근거가 다릅니다.');
      }
      for(const evidence of [...s.formulaEvidence,...s.comparisonEvidence])
        if(!ids.has(evidence.executionId)||[...evidence.inputExecutionIds??[],...evidence.readExecutionIds??[]].some(id=>!ids.has(id)))
          throw new Error('인덱스 관계의 실행 근거가 없습니다.');
      for(const p of s.formulaEvidence){
       if(JSON.stringify([...new Set((p.derivedAccesses??[]).map(a=>a.executionId))])!==JSON.stringify(p.derivedAccessExecutionIds??[]))
         throw new Error('인덱스 산식의 주소 접근 목록이 일치하지 않습니다.');
       for(const access of p.derivedAccesses??[]){
        const e=executions.get(access.executionId),calc=executions.get(p.executionId),step=calc?.steps?.find(x=>x.nodeId===p.sourceNodeId),seen=new Set(),pending=[...e?.addressInputs??[]],
          r=access.direction==='copy-source'&&e?.action==='copy'?{objectId:e.sourceObjectId,offset:e.sourceOffset??0,size:e.sourceSize??e.target?.size}:e?.target;
        while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);pending.push(...executions.get(id)?.dataInputs??[]);}
        if(!step||!seen.has(p.executionId)||r?.objectId!==s.objectId||
          ['objectId','offset','size'].some(k=>r[k]!==access.range?.[k])||access.index!==p.output||
          Math.floor((r.offset-s.range.offset)/s.elementBytes)!==p.output||Number(step.value?.decimal??step.value?.signed)!==p.output)
          throw new Error('인덱스 산식과 실제 원소 주소 출처가 다릅니다.');
       }
      }
      for(const state of verificationStates(s,positions)){
        if(!ids.has(state.afterExecutionId)||!['satisfied','violated','unknown'].includes(state.max.status)||!['satisfied','violated','unknown'].includes(state.min.status))
          throw new Error('인덱스 트리 상태의 사건 또는 순서 검사 상태가 올바르지 않습니다.');
      }
    }
    if(['array','array-structure'].includes(s.kind)&&(!objects.has(s.range?.objectId)||s.elementBytes<=0||s.range.offset<0||
      s.range.offset+s.range.size>objects.get(s.range.objectId).size||s.range.size!==s.elementBytes*s.capacity))
      throw new Error('배열 보기와 실제 저장 범위가 일치하지 않습니다.');
    if(s.kind==='array-structure'){
      const owner=objects.get(s.ownerObjectId),storage=objects.get(s.range.objectId),binding=executions.get(s.bindingExecutionId);
      if(!owner||!storage||s.ownerOffset<0||s.range.objectId!==owner.id&&!(s.storage==='pointer-backed'&&binding?.target?.objectId===owner.id&&binding.value?.reference?.targetObjectId===storage.id&&(binding.value.reference.targetOffset??0)===s.range.offset))throw new Error('배열 구조 후보의 저장 객체가 없습니다.');
      for(const field of Object.values(s.roles).filter(Boolean))if(field.offset<0||field.size<=0||
        (field.objectId?0:s.ownerOffset)+field.offset+field.size>(objects.get(field.objectId??owner.id)?.size??-1))throw new Error('배열 구조 역할의 필드 범위가 올바르지 않습니다.');
      for(const id of s.arrayViewIds){const v=structureViews.get(id);if(v?.kind!=='array'||v.objectId!==storage.id||
        v.offset!==s.range.offset||v.size!==s.range.size)throw new Error('배열 구조와 물리 배열 보기의 대응이 올바르지 않습니다.');}
      for(const a of s.accesses){const e=executions.get(a.executionId);if(!e||!['READ','WRITE'].includes(e.kind)||
        e.target?.objectId!==storage.id||a.physicalIndex!==(s.elementType?.kind==='record'?Math.floor((e.target.offset-s.range.offset)/s.elementBytes):(e.target.offset-s.range.offset)/s.elementBytes)||
        (a.elementOffset??0)!==(s.elementType?.kind==='record'?(e.target.offset-s.range.offset)%s.elementBytes:0))
        throw new Error('배열 접근과 관측 사건의 대응이 올바르지 않습니다.');}
      for(const op of s.operationEvidence)for(const id of [op.accessExecutionId,op.startExecutionId,op.completeExecutionId,...op.updateExecutionIds])
        if(!ids.has(id))throw new Error('배열 구조 작업의 관측 근거가 없습니다.');
      for(const state of s.states){
        if(!ids.has(state.afterExecutionId)||state.pendingOperations.some(id=>!ids.has(id)))throw new Error('배열 구조 상태의 실행 사건이 없습니다.');
        const order=state.logicalOrder;
        if(order&&(state.status!=='consistent'||!Number.isSafeInteger(order.start)||order.start<0||order.start>=s.capacity||
          !Number.isSafeInteger(order.count)||order.count<0||order.count>s.capacity||order.modulus!==s.capacity||![-1,1].includes(order.direction)))
          throw new Error('배열의 논리 순서와 물리 범위가 일치하지 않습니다.');
        for(const range of [...state.inactiveRanges??[],...state.scopeRanges??[]])if(range.objectId!==storage.id||range.offset<s.range.offset||range.size<0||
          range.offset+range.size>s.range.offset+s.range.size)throw new Error('비활성 배열 범위가 실제 저장 범위를 벗어납니다.');
        for(const a of state.roleAssessments??[])for(const id of [...a.supportingExecutionIds,...a.contradictingExecutionIds])
          if(!ids.has(id)||positions.get(id)>positions.get(state.afterExecutionId))throw new Error('배열 역할의 근거가 해당 시점 이후에 있습니다.');
      }
    }
    if(s.kind==='linked-structure'){
      if(!objects.has(s.root?.objectId)||s.root.offset<0||s.root.offset>=objects.get(s.root.objectId).size)
        throw new Error('연결 구조의 기준 저장 범위가 없습니다.');
      const nodes=new Set(s.logicalNodes.map(n=>n.id));
      for(const n of s.logicalNodes)if(!objects.has(n.objectId)||n.offset<0||n.size<=0||n.offset+n.size>objects.get(n.objectId).size)
        throw new Error('논리 노드가 실제 저장 범위를 벗어납니다.');
      for(const state of verificationStates(s,positions)){
        if(!ids.has(state.afterExecutionId))throw new Error('연결 구조 상태의 실행 사건이 없습니다.');
        for(const id of [...state.activeMembers,...state.detachedMembers,...state.endedMembers,...state.orders.flatMap(o=>o.nodeIds)])
          if(!nodes.has(id))throw new Error('연결 구조 상태의 논리 노드가 없습니다.');
        for(const edge of state.edges)if(!nodes.has(edge.from)||edge.to&&!nodes.has(edge.to)||!objects.has(edge.source?.objectId)||
          edge.source.offset<0||edge.source.offset+edge.source.size>objects.get(edge.source.objectId).size||edge.lastWrite&&!ids.has(edge.lastWrite))
          throw new Error('연결 구조 간선의 저장 위치 또는 쓰기 근거가 없습니다.');
      }
    }
    if(s.kind==='dynamic-array')for(const state of s.states){
      if(!ids.has(state.afterExecutionId)||state.backingObjectId&&!objects.has(state.backingObjectId))throw new Error('동적 배열 상태의 사건 또는 저장 객체가 없습니다.');
      if(state.status==='consistent'&&state.backingObjectId&&
        (state.length>state.capacity||state.byteOffset+state.capacity*state.elementBytes>objects.get(state.backingObjectId).size))throw new Error('동적 배열 후보가 실제 저장 범위를 벗어납니다.');
    }
  }
  validateStructureOverlays(trace,plan);
  validateRecordIndexStructures(trace);
  validateLinkedProjections(trace);
  validateValueIndexStructures(trace);
  validateParallelArrayStructures(trace);
  validateCoindexedRecords(trace);
  validateArrayValueDependencies(trace);
  validateArrayCursorPaths(plan,trace);
  validateAssociativeStructures(plan,trace);
  validateSequenceLookups(plan,trace);
  return trace;
}
