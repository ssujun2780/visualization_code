// Validate evidence and storage identities, not whether the inferred view is
// the author's intended data structure. Invalid program states remain data.
export function validateStructureOverlays(trace){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),objects=new Map(trace.objects.map(o=>[o.id,o])),
    structures=new Map(trace.structures.map(s=>[s.id,s]));
  const fail=message=>{throw new Error(`자료구조 후보: ${message}`);};
  function range(r){const o=objects.get(r?.objectId);if(!o||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.size)||
    r.offset<0||r.size<=0||r.offset+r.size>o.size)fail('관측 저장 범위가 올바르지 않습니다.');}
  function evidence(ids){for(const id of ids)if(id&&!events.has(id))fail('연결된 실행 근거가 없습니다.');}
  function base(s,r){const a=structures.get(s.arrayId);range(r);
    if(a?.kind!=='array'||a.objectId!==s.objectId||r.objectId!==a.range.objectId||r.offset!==a.range.offset||r.size!==a.range.size)
      fail('기반 배열과 저장 범위가 일치하지 않습니다.');return a;}
  for(const s of trace.structures){
    if(s.kind==='linked-root-collection'){
      const backing=id=>{const b=structures.get(id);if(b?.kind!=='linked-root-collection'||b.scope!=='backing-range')
        fail('연결 루트의 기반 컬렉션이 없습니다.');return b;};
      const members=(ids,roots)=>{const known=new Set(roots.flatMap(id=>structures.get(id)?.logicalNodes?.map(n=>n.id)??[]));
        if(ids.some(id=>!known.has(id)))fail('연결 루트의 구성원 저장 근거가 없습니다.');};
      if(s.scope==='backing-range'){
        range(s.range);evidence(s.evidenceExecutionIds);
        if(s.objectId!==s.range.objectId||!(s.elementBytes>0)||!Number.isSafeInteger(s.capacity)||s.capacity*s.elementBytes!==s.range.size)
          fail('연결 루트의 원소 범위가 올바르지 않습니다.');
        if(s.arrayId)base(s,s.range);
        const slots=new Map();
        for(const id of s.rootStructureIds){const r=structures.get(id)?.root;
          if(!r||structures.get(id).kind!=='linked-structure'||r.objectId!==s.objectId||r.recordTypeId!==s.recordTypeId||
            r.offset<s.range.offset||r.offset+s.elementBytes>s.range.offset+s.range.size||(r.offset-s.range.offset)%s.elementBytes)
            fail('연결 루트와 실제 포인터 슬롯이 일치하지 않습니다.');
          if(slots.has(r.offset))fail('같은 슬롯의 연결 루트가 중복됐습니다.');slots.set(r.offset,id);
        }
        for(const state of s.states){
          evidence([state.afterExecutionId]);members(state.reachableMembers,s.rootStructureIds);
          if(state.reachableNodeCount!==new Set(state.reachableMembers).size||state.observedSlotCount<0||state.observedSlotCount>s.capacity||
            state.unknownSlotCount<0||state.unknownSlotCount>s.capacity)fail('연결 루트의 관측 개수가 올바르지 않습니다.');
          for(const r of state.roots){if(slots.get(r.offset)!==r.structureId||r.index!==(r.offset-s.range.offset)/s.elementBytes)
            fail('연결 루트의 인덱스 대응이 올바르지 않습니다.');members([...r.reachableMembers,...r.endedMembers],[r.structureId]);}
          for(const shared of state.sharedMembers??[]){const b=backing(shared.collectionId);members(shared.nodeIds,b.rootStructureIds);
            if(shared.nodeIds.some(id=>!state.reachableMembers.includes(id)))fail('공유 노드의 현재 도달 근거가 없습니다.');}
        }
      }else if(s.scope==='owner-field'){
        if(!objects.has(s.ownerObjectId)||!Number.isSafeInteger(s.ownerOffset)||s.ownerOffset<0)fail('연결 루트의 소유 저장소가 없습니다.');
        for(const f of [s.role.data,...s.role.capacity?[s.role.capacity]:[],...s.role.cardinalityCandidates])
          range({objectId:s.ownerObjectId,offset:s.ownerOffset+f.offset,size:f.size});
        const roots=s.backingHistory.flatMap(id=>backing(id).rootStructureIds);
        for(const state of s.states){
          evidence([state.afterExecutionId]);members(state.reachableMembers,roots);
          if(state.pointerReference.targetObjectId&&!objects.has(state.pointerReference.targetObjectId))fail('소유 포인터의 대상 저장소가 없습니다.');
          if(state.backingCollectionId){const b=backing(state.backingCollectionId);
            if(!s.backingHistory.includes(b.id)||b.objectId!==state.backingObjectId||b.objectId!==state.pointerReference.targetObjectId)
              fail('소유 포인터와 기반 컬렉션의 대응이 올바르지 않습니다.');}
          for(const b of state.backings){const target=backing(b.collectionId);
            if(!s.backingHistory.includes(target.id)||target.objectId!==b.objectId)fail('소유 포인터 이력의 저장소가 다릅니다.');
            members(b.reachableMembers,target.rootStructureIds);}
          if(state.reachableNodeCount!==new Set(state.reachableMembers).size||state.cardinalityCandidates.some(c=>c.activePrefix!==false))
            fail('노드 개수 후보를 배열 활성 구간으로 해석할 수 없습니다.');
        }
      }else fail('연결 루트 컬렉션의 범위 종류가 없습니다.');
    }
    if(s.kind==='queue-candidate'){
      const a=base(s,s.range);range(s.roles.front);range(s.roles.back);
      if(s.capacity!==a.capacity||s.elementBytes!==a.elementBytes||!Number.isSafeInteger(s.roles.indexOffset))fail('큐의 배열 대응이 올바르지 않습니다.');
      evidence([s.inferredAtExecutionId]);
      for(const op of s.operations){
        evidence([op.accessExecutionId,op.cursorReadExecutionId,op.updateExecutionId,op.updateOriginExecutionId,op.startedAtExecutionId,op.completedAtExecutionId]);
        const e=events.get(op.accessExecutionId),read=events.get(op.cursorReadExecutionId),r=s.roles[op.role];
        if(!r||e?.kind!==(op.kind==='enqueue'?'WRITE':'READ')||e.target?.objectId!==s.objectId||
          e.target.offset!==s.range.offset+op.index*s.elementBytes||e.target.size!==s.elementBytes||
          read?.kind!=='READ'||read.target?.objectId!==r.objectId||read.target.offset!==r.offset||read.target.size!==r.size)
          fail('큐 작업과 실제 접근이 일치하지 않습니다.');
      }
      for(const c of s.comparisons){range(c.left);range(c.right);evidence([c.executionId,...c.readExecutionIds]);}
      for(const state of s.states){
        evidence([state.executionId,...state.pendingAccessExecutionIds,...state.contradictingExecutionIds]);
        if(!['supported','contradicted','intermediate','partial','ended'].includes(state.status))fail('큐 상태 분류가 올바르지 않습니다.');
        const r=state.activeRange,order=state.logicalOrder;
        if(r&&(r.interval!=='half-open'||r.start!==state.front+s.roles.indexOffset||r.end!==state.back+s.roles.indexOffset||
          r.valid!==(r.start>=0&&r.end>=r.start&&r.end<=s.capacity)))fail('큐 활성 구간이 실제 커서와 일치하지 않습니다.');
        if(order&&(state.status!=='supported'||!r?.valid||order.start!==r.start||order.length!==r.end-r.start||order.stride!==1))
          fail('큐의 논리 순서가 활성 구간과 일치하지 않습니다.');
      }
    }
    if(s.kind==='indexed-graph-candidate'){
      const d=s.vertexDomain,a=base(s,d.range),roots=s.rootStructureIds.map(id=>structures.get(id)),
        nodes=new Map(roots.flatMap(r=>r?.logicalNodes??[]).map(n=>[n.id,n]));
      if(d.start!==0||d.count!==a.capacity||d.elementBytes!==a.elementBytes||roots.some(r=>r?.kind!=='linked-structure'))
        fail('정점 영역 또는 목록 루트가 올바르지 않습니다.');
      evidence([s.discoveredAtExecutionId]);
      for(const e of s.evidence){evidence([e.fieldReadExecutionId,e.indexReadExecutionId]);
        if(e.sourceRootIds.some(id=>!s.rootStructureIds.includes(id))||e.sourceRecordNodeIds.some(id=>!nodes.has(id)))
          fail('정수 간선의 원본 목록 근거가 없습니다.');}
      for(const state of s.states){
        evidence([state.afterExecutionId]);
        for(const v of state.vertexStates)if(!Number.isSafeInteger(v.index)||v.index<0||v.index>=d.count||
          !s.rootStructureIds.includes(v.rootStructureId))fail('정점과 실제 목록 슬롯이 일치하지 않습니다.');
        for(const edge of state.edges){range(edge.source);evidence([edge.lastWriteExecutionId]);
          const n=nodes.get(edge.recordNodeId);
          if(!n||edge.source.objectId!==n.objectId||edge.source.offset!==n.offset+s.destinationRole.offset||edge.source.size!==s.destinationRole.size||
            !Number.isSafeInteger(edge.fromIndex)||edge.fromIndex<0||edge.fromIndex>=d.count||
            edge.toIndex!==null&&(!Number.isSafeInteger(edge.toIndex)||edge.toIndex<0||edge.toIndex>=d.count||edge.toIndex!==edge.destinationValue))
            fail('논리 간선과 실제 정수 필드가 일치하지 않습니다.');
        }
      }
    }
  }
}
