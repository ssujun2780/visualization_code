// Validate inferred index overlays independently of their construction. A
// program's invalid/unresolved relation remains data, not an engine failure.
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
export function validateRecordIndexStructures(trace){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    objects=new Map(trace.objects.map(o=>[o.id,o])),structures=new Map(trace.structures.map(s=>[s.id,s]));
  const fail=message=>{throw new Error(`레코드 인덱스 후보: ${message}`);};
  const index=n=>Number.isSafeInteger(n)&&n>=0;
  const range=r=>{const o=objects.get(r?.objectId);if(!o||!index(r.offset)||!Number.isSafeInteger(r.size)||r.size<=0||r.offset+r.size>o.size)
    fail('실제 저장 범위를 벗어났습니다.');};
  const evidence=(id,until=Infinity)=>{if(id&&(!events.has(id)||positions.get(id)>until))fail('실행 근거가 없거나 상태보다 뒤에 있습니다.');};
  const covers=(outer,inner)=>outer&&outer.objectId===inner.objectId&&outer.offset<=inner.offset&&outer.offset+outer.size>=inner.offset+inner.size;
  const scalar=(id,slot,signed=false)=>{const e=events.get(id);if(!e?.target||!covers(e.target,slot))return null;
    const exact=e.target.offset===slot.offset&&e.target.size===slot.size;
    return observeScalarBytes(null,{size:slot.size,signed,...(e.memoryState?{snapshot:e.memoryState,start:e.target.offset,offset:slot.offset}:
      exact?{value:e.value?.bits}:{})})?.value??null;};
  for(const s of trace.structures.filter(s=>s.kind==='record-index-graph-candidate')){
    const container=structures.get(s.containerId);
    if(!['array','dynamic-array'].includes(container?.kind)||!s.recordTypeId||!Number.isSafeInteger(s.recordSize)||s.recordSize<=0||
      !['record-array','pointer-record-array'].includes(s.storageKind)||s.isPointerStructure!==false||s.temporalScope!=='observed-states')
      fail('컨테이너·레코드 정체성이 없습니다.');
    evidence(s.discoveredAtExecutionId);
    const relations=new Map(s.relations.map(r=>[r.id,r]));if(relations.size!==s.relations.length)fail('관계 식별자가 중복됐습니다.');
    if(s.displayPolicy?.mergeRelations!==false)fail('서로 다른 인덱스 역할을 하나의 그래프로 합쳤습니다.');
    for(const r of s.relations){
      if(!['record-field','record-owned-index-array'].includes(r.kind)||r.field.recordTypeId!==s.recordTypeId||!index(r.field.offset)||
        !(r.field.size>0)||r.field.offset+r.field.size>s.recordSize||!r.evidence.length)fail('필드 관계의 근거가 없습니다.');
      for(const proof of r.evidence){
        const target=events.get(proof.targetAccessExecutionId),source=events.get(proof.sourceExecutionId),at=positions.get(proof.targetAccessExecutionId);
        if(target?.kind!=='READ'||!['READ','WRITE'].includes(source?.kind)||!index(proof.sourceIndex)||!index(proof.targetIndex))fail('인덱스 소비 근거가 올바르지 않습니다.');
        range(proof.source);if(!covers(source.target,proof.source))fail('필드 근거와 실제 접근 범위가 다릅니다.');
        for(const id of [proof.sourceExecutionId,proof.indexExecutionId,proof.sharedOriginReadExecutionId,proof.pointerReadExecutionId])evidence(id,at);
      }
    }
    let previous=-1;
    for(const state of s.states){
      evidence(state.afterExecutionId);const at=positions.get(state.afterExecutionId);
      if(at<previous)fail('상태 순서가 뒤바뀌었습니다.');previous=at;evidence(state.lengthEvidenceExecutionId,at);
      const nodes=new Map(state.nodes.map(n=>[n.id,n]));if(nodes.size!==state.nodes.length||new Set(state.nodes.map(n=>n.index)).size!==state.nodes.length)
        fail('같은 활성 슬롯을 중복 노드로 표시했습니다.');
      if(state.nodes.length&&(!index(state.capacity)||!(state.elementBytes>0)||!index(state.byteOffset)))fail('배열 저장 배치가 없습니다.');
      const sameBacking=container.kind==='array'?{objectId:container.objectId,offset:container.range.offset,stride:container.elementBytes,capacity:container.capacity}:
        (()=>{let lo=0,hi=container.states.length-1,found=null;while(lo<=hi){const mid=(lo+hi)>>1,v=container.states[mid];
          if(positions.get(v.afterExecutionId)<=at){found=v;lo=mid+1;}else hi=mid-1;}return found&&{objectId:found.backingObjectId,
          offset:found.byteOffset,stride:found.elementBytes,capacity:found.capacity,length:found.length};})();
      if(state.nodes.length&&(!sameBacking||state.backingObjectId!==sameBacking.objectId||state.byteOffset!==sameBacking.offset||
        state.elementBytes!==sameBacking.stride||state.capacity!==sameBacking.capacity||container.kind==='dynamic-array'&&state.length!==sameBacking.length))
        fail('다른 컨테이너 또는 다른 시점의 저장소를 사용했습니다.');
      for(const n of state.nodes){
        if(!index(n.index)||n.index>=state.capacity||state.length!==null&&n.index>=state.length)fail('비활성 용량을 논리 노드로 표시했습니다.');
        range(n.storage);if(n.storage.objectId!==state.backingObjectId||n.storage.offset!==state.byteOffset+n.index*state.elementBytes||n.storage.size!==state.elementBytes)
          fail('노드와 실제 배열 슬롯이 다릅니다.');
        if(n.record){range(n.record);if(n.record.size!==s.recordSize)fail('레코드 크기가 다릅니다.');
          if(s.storageKind==='record-array'&&!covers(n.storage,n.record))fail('임시 복사 레코드를 컨테이너 원소로 합쳤습니다.');}
        if(n.status==='observed'&&!n.record)fail('관측된 노드에 실제 레코드가 없습니다.');
        for(const id of [n.membershipExecutionId,n.lastObservationExecutionId,n.lastWriteExecutionId])evidence(id,at);
        if(n.record&&s.storageKind==='pointer-record-array'){
          const pointer=scalar(n.lastObservationExecutionId,n.storage);
          if(pointer!==null&&pointer!==Number(objects.get(n.record.objectId).address)+n.record.offset)fail('포인터 슬롯과 레코드 대상이 다릅니다.');
        }
      }
      for(const edge of state.edges){
        const from=nodes.get(edge.from),to=nodes.get(edge.to),r=relations.get(edge.relationId);
        if(!from?.record||from.index!==edge.fromIndex||!r)fail('간선의 원본 노드 또는 역할이 없습니다.');range(edge.source);
        if(r.kind==='record-field'&&(edge.source.objectId!==from.record.objectId||edge.source.offset!==from.record.offset+r.field.offset||edge.source.size!==r.field.size))
          fail('간선 값의 필드 범위가 다릅니다.');
        if(r.kind==='record-owned-index-array'&&(!index(edge.slotIndex)||edge.source.size!==r.field.cType?.pointee?.sizeBits/8))fail('소유 인덱스 배열의 원소 배치가 다릅니다.');
        if(r.kind==='record-owned-index-array'){
          range(edge.pointerSource);
          if(edge.pointerSource.objectId!==from.record.objectId||edge.pointerSource.offset!==from.record.offset+r.field.offset||edge.pointerSource.size!==r.field.size)
            fail('다른 레코드의 소유 배열을 연결했습니다.');
          for(const id of [edge.pointerObservationExecutionId,edge.pointerWriteExecutionId])evidence(id,at);
          const pointer=scalar(edge.pointerObservationExecutionId,edge.pointerSource);
          if(pointer!==null&&pointer+edge.slotIndex*edge.source.size!==Number(objects.get(edge.source.objectId).address)+edge.source.offset)
            fail('소유 포인터와 간선 값의 실제 저장 위치가 다릅니다.');
        }
        if(edge.to!==null&&(!to||to.index!==edge.toIndex||edge.value!==edge.toIndex)||edge.to===null&&edge.toIndex!==null)
          fail('목적 인덱스와 활성 노드가 다릅니다.');
        for(const id of [edge.lastWriteExecutionId,edge.lastObservationExecutionId,...edge.evidenceExecutionIds??[]])evidence(id,at);
        const observed=events.get(edge.lastObservationExecutionId);
        if(observed?.target&&covers(observed.target,edge.source)){
          const scalar=observed.target.offset===edge.source.offset&&observed.target.size===edge.source.size;
          const value=observeScalarBytes(null,{size:edge.source.size,signed:(r.kind==='record-field'?r.field.cType:r.field.cType.pointee)?.signedness==='signed',
            ...(observed.memoryState?{snapshot:observed.memoryState,start:observed.target.offset,offset:edge.source.offset}:scalar?{value:observed.value?.bits}: {})});
          if(value?.value!==null&&value?.value!==undefined&&value.value!==edge.value)fail('간선 값이 관측된 저장값과 다릅니다.');
        }
      }
    }
  }
}
