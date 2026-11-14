import {wrapsAt} from './counted-queue-views.mjs';
import {stateHistoryGapAt} from './state-history.mjs';
// Validate evidence and storage identities, not whether the inferred view is
// the author's intended data structure. Invalid program states remain data.
import {validateBSTOverlays} from './bst-contract.mjs';
import {validateGraphStorage} from './graph-storage-contract.mjs';
import {validateNeighborhoodProof} from './neighborhood-proofs.mjs';
import {validateIndexedNeighborhoodProof} from './indexed-neighborhood-proofs.mjs';
import {validateEdgeListProof} from './edge-list-proofs.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {verificationStates} from './history-evidence.mjs';
export function validateStructureOverlays(trace,plan){
  validateBSTOverlays(trace,plan);
  const events=new Map(trace.events.map(e=>[e.eventId,e])),objects=new Map(trace.objects.map(o=>[o.id,o])),
    structures=new Map(trace.structures.map(s=>[s.id,s])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  const fail=message=>{throw new Error(`자료구조 후보: ${message}`);};
  function range(r){const o=objects.get(r?.objectId);if(!o||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.size)||
    r.offset<0||r.size<=0||r.offset+r.size>o.size)fail('관측 저장 범위가 올바르지 않습니다.');}
  function evidence(ids){for(const id of ids)if(id&&!events.has(id))fail('연결된 실행 근거가 없습니다.');}
  function base(s,r){const a=structures.get(s.arrayId);range(r);
    if(a?.kind!=='array'||a.objectId!==s.objectId||r.objectId!==a.range.objectId||r.offset!==a.range.offset||r.size!==a.range.size)
      fail('기반 배열과 저장 범위가 일치하지 않습니다.');return a;}
  for(const s of trace.structures){
    if(['observed-traversal-graph-candidate','index-domain-graph-candidate'].includes(s.kind))validateGraphStorage(trace,s);
    if(s.kind==='pointer-tree-projection'){
      const source=structures.get(s.sourceStructureId),positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
      if(source?.kind!=='storage-reference-graph'||s.nodes.length||s.edges.length)fail('포인터 논리 보기의 원본 저장 관계가 없습니다.');
      range(s.root);evidence([s.discoveredAtExecutionId]);let before=-1;
      const stored=new Map();let cursor=0;
      for(const state of s.states){const at=positions.get(state.afterExecutionId);evidence([state.afterExecutionId,...state.evidenceExecutionIds]);
        if(at<=before||state.evidenceExecutionIds.some(id=>positions.get(id)>at))fail('포인터 논리 보기의 시점 또는 근거가 잘못되었습니다.');before=at;
        while(cursor<source.changes.length&&positions.get(source.changes[cursor].afterExecutionId)<=at){
          for(const e of source.changes[cursor++].upsertEdges)stored.set(e.id,e);
        }
        const ids=new Set(state.nodes.map(n=>n.id));for(const n of state.nodes)range(n.range);
        if(state.alive&&state.topology.nodeCount!==ids.size)fail('포인터 논리 보기의 구성원 수가 다릅니다.');
        for(const edge of state.edges){const path=edge.storedEdgeIds?.map(id=>stored.get(id));
          if(!ids.has(edge.from)||!ids.has(edge.to)||!path?.length||path.some(e=>!e||e.status!=='in-bounds'))fail('논리 간선의 실제 포인터 경로가 없습니다.');
          if(s.mode==='inverse-parent'){
            if(path.length!==1||path[0].from!==edge.to||path[0].to!==edge.from)fail('부모 보기의 방향 변환이 실제 연결과 다릅니다.');
          }else if(s.mode==='owned-edge-records'){
            const owner=state.nodes.find(n=>n.id===edge.from),storedOwner=source.nodes.find(n=>n.id===path[0].from);
            if(path.length!==1||path[0].to!==edge.to||!owner||!storedOwner||owner.range.objectId!==storedOwner.range.objectId||
              owner.range.offset>storedOwner.range.offset||storedOwner.range.offset+storedOwner.range.size>owner.range.offset+owner.range.size)
              fail('간선 레코드가 실제 부모 안에 포함되지 않습니다.');
          }else if(path[0].from!==edge.from||path.at(-1).to!==edge.to||path.some((e,i)=>i&&path[i-1].to!==e.from))
            fail('논리 간선과 실제 포인터 경로의 끝점이 다릅니다.');
        }
      }
    }
    if(s.kind==='rooted-index-structure'){
      range(s.root);const source=structures.get(s.relationStructureId),positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
      if(s.root.kind!=='index-slot'||!source||s.nodes.length||s.edges.length)fail('인덱스 시작점의 기반 관계가 없습니다.');
      evidence([s.discoveredAtExecutionId]);for(const r of s.storageRanges)range(r);
      evidence(s.roleCombinationEvidence??[]);
      for(const p of s.rootEvidence){
        if(p.kind==='stored-index-seed'){
          evidence([p.rootWriteExecutionId,p.indexExecutionId,p.originExecutionId,p.targetAccessExecutionId,p.learnedRootReadExecutionId,p.learnedTargetAccessExecutionId]);
          const w=events.get(p.rootWriteExecutionId),a=events.get(p.targetAccessExecutionId),r=events.get(p.learnedRootReadExecutionId),flow=createValueFlow({instructions:[]},trace);
          if(w?.kind!=='WRITE'||w.target?.objectId!==s.root.objectId||w.target.offset!==s.root.offset||w.target.size!==s.root.size||a?.kind!=='WRITE'||
            r?.kind!=='READ'||r.target.objectId!==w.target.objectId||!a.addressInputs?.includes(p.indexExecutionId)||
            !(w.dataInputs??[]).some(id=>flow.chain(id).some(e=>e.eventId===p.originExecutionId))||!flow.chain(p.indexExecutionId).some(e=>e.eventId===p.originExecutionId)||
            !s.storageRanges.some(range=>range.objectId===a.target?.objectId&&range.offset<=a.target.offset&&a.target.offset+a.target.size<=range.offset+range.size))fail('저장된 루트 인덱스의 실제 전달 근거가 다릅니다.');
          continue;
        }
        evidence([p.rootReadExecutionId,p.indexExecutionId,p.targetAccessExecutionId]);
        const read=events.get(p.rootReadExecutionId),access=events.get(p.targetAccessExecutionId);
        if(read?.kind!=='READ'||read.target?.objectId!==s.root.objectId||read.target.offset!==s.root.offset||read.target.size!==s.root.size||
          positions.get(read.eventId)>=positions.get(access?.eventId))fail('시작 변수의 실제 읽기 근거가 다릅니다.');
        if(!s.storageRanges.some(r=>r.objectId===access.target?.objectId&&r.offset<=access.target.offset&&
          access.target.offset+access.target.size<=r.offset+r.size))fail('시작값의 실제 인덱스 대상이 다릅니다.');
      }
      const nodes=new Map(s.logicalNodes.map(n=>[n.id,n]));for(const n of nodes.values())range(n);
      let before=-1;
      for(const state of verificationStates(s,positions)){evidence([state.afterExecutionId,state.rootValueExecutionId]);const at=positions.get(state.afterExecutionId);
        if(at<=before||state.rootValueExecutionId&&positions.get(state.rootValueExecutionId)>at)fail('인덱스 시작점의 시점이 다릅니다.');before=at;
        if((s.roleCombinationEvidence??[]).some(id=>positions.get(id)>at))fail('여러 역할의 결합 근거가 상태보다 뒤에 있습니다.');
        for(const order of state.orders){
          if(order.nodeIds.length!==order.indices.length||new Set(order.nodeIds).size!==order.nodeIds.length||
            order.nodeIds.some((id,i)=>nodes.get(id)?.index!==order.indices[i]))fail('인덱스 목록의 구성원과 순서가 다릅니다.');
        }
        if(state.topology.nodeCount!==state.memberIndices.length)fail('현재 인덱스 목록의 크기가 다릅니다.');
        for(const p of state.endpointPolicies??[])evidence(p.supportingExecutionIds);
      }
    }
    if(s.kind==='observed-traversal-graph-candidate'){
      const a=structures.get(s.arrayId),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
        relations=new Map((trace.structures.find(s=>s.kind==='storage-dependencies')?.relations??[]).map(r=>[r.id,r]));
      if(a?.kind!=='array'||s.vertexDomain?.arrayId!==a.id)fail('순회 후보의 기반 배열이 없습니다.');
      for(const p of s.evidence){
        evidence(p.evidenceExecutionIds);
        const at=positions.get(p.executionId),target=events.get(p.targetAccessExecutionId);
        if(!['computed-index-transfer','bounded-index-walk','matrix-operand-pair','matrix-gated-access','counted-row-access','indexed-list-access','edge-list-gated-access'].includes(p.kind)||
          !p.evidenceExecutionIds.includes(p.executionId)||p.evidenceExecutionIds.some(id=>positions.get(id)>at)||
          ![p.fromIndex,p.toIndex].every(i=>Number.isInteger(i)&&i>=0&&i<a.capacity)||
          target?.target?.objectId!==a.objectId||Math.floor((target.target.offset-a.range.offset)/a.elementBytes)!==p.toIndex)
          fail('순회 후보의 대상 좌표 또는 실행 근거가 다릅니다.');
        for(const r of [...p.sourceSlots,...p.properties.map(p=>p.source)])range(r);
        if(p.kind==='edge-list-gated-access')validateEdgeListProof(p,{plan,trace,fail});
        else if(p.kind==='indexed-list-access')validateIndexedNeighborhoodProof(p,{events,relations,fail,trace,
          accesses:new Map((trace.structures.find(s=>s.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a]))});
        else if(['matrix-gated-access','counted-row-access'].includes(p.kind))validateNeighborhoodProof(p,{events,relations,fail,trace,
          accesses:new Map((trace.structures.find(s=>s.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a]))});
        else if(p.kind!=='matrix-operand-pair'){
          const r=relations.get(p.relationId);
          if(!r||r.sourceReadExecutionId!==p.sourceReadExecutionId||r.targetAccessExecutionId!==p.targetAccessExecutionId)
            fail('순회 후보의 주소 전달 근거가 없습니다.');
        }else if(events.get(p.executionId)?.kind!=='CALC'||events.get(p.sourceAccessExecutionId)?.kind!=='READ')fail('행렬 피연산자의 연산 근거가 없습니다.');
      }
      let previous=-1;
      for(const state of s.states){
        evidence([state.afterExecutionId]);const at=positions.get(state.afterExecutionId);
        if(at<=previous)fail('순회 상태 순서가 잘못되었습니다.');previous=at;
        const nodes=new Set(state.nodes.map(n=>n.id));for(const n of state.nodes)range(n.range);
        for(const e of state.edges)if(!nodes.has(e.from)||!nodes.has(e.to)||positions.get(e.executionId)>at||
          ![...s.evidence,...s.storageEvidence??[]].some(p=>p.edgeIdentity===e.edgeIdentity&&p.executionId===e.executionId))fail('순회 간선의 관측 근거가 없습니다.');
      }
    }
    if(s.kind==='index-domain-graph-candidate'){
      const a=structures.get(s.arrayId),positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
      if(a?.kind!=='array'||s.vertexDomain?.arrayId!==a.id)fail('인덱스 도메인의 기반 배열이 없습니다.');
      for(const r of s.storageRanges)range(r);
      for(const p of s.evidence){
        evidence([p.executionId,p.sourceAccessExecutionId,p.targetAccessExecutionId,p.indexSourceReadExecutionId,
          ...p.properties.map(x=>x.readExecutionId),...p.rangeInputs.map(x=>x.sourceReadExecutionId),...(p.rootBindings??[]).map(x=>x.executionId)]);
        const from=events.get(p.sourceAccessExecutionId),to=events.get(p.targetAccessExecutionId),at=positions.get(p.executionId);
        if(events.get(p.executionId)?.kind!=='CALC'||from?.kind!=='READ'||to?.kind!=='READ'||
          [from,to].some(e=>positions.get(e.eventId)>at||e.target.objectId!==a.objectId||e.target.size!==a.elementBytes)||
          from.target.offset!==a.range.offset+p.fromIndex*a.elementBytes||to.target.offset!==a.range.offset+p.toIndex*a.elementBytes)
          fail('도메인 간선의 실제 원소 접근과 실행 순서가 다릅니다.');
      }
      let previous=-1;
      for(const state of s.states){
        evidence([state.afterExecutionId]);const at=positions.get(state.afterExecutionId);
        if(at<=previous)fail('도메인 상태 순서가 잘못되었습니다.');previous=at;
        const nodes=new Set(state.nodes.map(n=>n.id));for(const n of state.nodes)range(n.range);
        for(const edge of state.edges){
          if(!nodes.has(edge.from)||!nodes.has(edge.to)||positions.get(edge.executionId)>at||
            ![...s.evidence,...s.storageEvidence??[]].some(p=>p.executionId===edge.executionId&&p.edgeIdentity===edge.edgeIdentity))fail('도메인 간선의 관측 근거가 없습니다.');
        }
      }
    }
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
      if(s.fifoProofs){
        const pending=[],matched=[];
        for(const op of s.operations.filter(o=>o.status==='supported')){
          if(op.kind==='enqueue'){pending.push(op);continue;}
          if(op.kind!=='dequeue')continue;
          const oldest=pending.shift(),write=events.get(oldest?.accessExecutionId),read=events.get(op.accessExecutionId);
          if(oldest&&oldest.index===op.index&&write.target.objectId===read.target.objectId&&write.target.offset===read.target.offset&&
            write.target.size===read.target.size&&read.dataInputs?.includes(write.eventId))
            matched.push({enqueueExecutionId:write.eventId,dequeueExecutionId:read.eventId,index:op.index,completedAtExecutionId:op.completedAtExecutionId});
        }
        if(JSON.stringify(matched)!==JSON.stringify(s.fifoProofs)||!s.comparisons.length&&!matched.length)
          fail('FIFO 소비 순서와 실제 삽입 WRITE의 출처가 다릅니다.');
      }
      for(const state of s.states){
        evidence([state.executionId,...state.pendingAccessExecutionIds,...state.contradictingExecutionIds]);
        if(!['supported','contradicted','intermediate','partial','ended'].includes(state.status))fail('큐 상태 분류가 올바르지 않습니다.');
        const r=state.activeRange,order=state.logicalOrder;
        if(r&&(r.interval!=='half-open'||r.start!==state.front+s.roles.indexOffset||r.end!==state.back+s.roles.indexOffset||
          r.valid!==(r.start>=0&&r.end>=r.start&&r.end<=s.capacity)))fail('큐 활성 구간이 실제 커서와 일치하지 않습니다.');
        if(order&&(state.status!=='supported'||!r?.valid||order.start!==r.start||order.length!==r.end-r.start||order.stride!==1))
          fail('큐의 논리 순서가 활성 구간과 일치하지 않습니다.');
      }
      if(s.layout==='flag-ring'){
        range(s.roles.full);evidence(s.guardExecutionIds);
        const k=r=>r&&`${r.objectId}:${r.offset}:${r.size}`,n=e=>Number(e?.value?.decimal??e?.value?.signed??e?.value?.unsigned),ledger=[];
        for(const [i,op]of s.operations.entries()){
          evidence([op.modulusExecutionId,op.fullWriteExecutionId]);const e=events.get(op.accessExecutionId),f=events.get(op.fullWriteExecutionId),u=events.get(op.updateExecutionId),r=events.get(op.cursorReadExecutionId),mod=events.get(op.modulusExecutionId);
          if(k(f.target)!==k(s.roles.full)||f.kind!=='WRITE'||k(u.target)!==k(s.roles[op.role])||n(u)!==(n(r)+1)%s.capacity||!mod.steps?.some(t=>wrapsAt(t,s.capacity)))fail('full 플래그 또는 순환 커서 근거가 다릅니다.');
          if(op.kind==='enqueue')ledger.push({index:op.index,writer:op.accessExecutionId});else{const first=ledger.shift();if(!first||first.index!==op.index||first.writer!==op.consumedWriteExecutionId||!e.dataInputs?.includes(first.writer))fail('full 플래그 큐의 FIFO 식별자가 다릅니다.');}
          const st=s.states.find(st=>st.executionId===op.completedAtExecutionId);
          if(!st&&!stateHistoryGapAt(s,positions,positions.get(op.completedAtExecutionId)))fail('큐 상태가 근거 없이 누락되었습니다.');
          if(ledger.length>s.capacity||n(f)!==Number(ledger.length===s.capacity)||st&&(st.count!==ledger.length||st.full!==(n(f)===1)||JSON.stringify(st.ringOrder?.indices)!==JSON.stringify(ledger.map(x=>x.index))||JSON.stringify(st.ringOrder?.writeExecutionIds)!==JSON.stringify(ledger.map(x=>x.writer))||ledger.some((x,i)=>x.index!==(st.front+i)%s.capacity)||st.back!==(st.front+st.count)%s.capacity))fail('full/empty 상태와 논리 순서가 다릅니다.');
        }
      }
      if(s.layout==='ring'){
        range(s.roles.count);evidence(s.guardExecutionIds);
        const k=t=>t&&`${t.objectId}:${t.offset}:${t.size}`,n=e=>Number(e?.value?.decimal??e?.value?.signed??e?.value?.unsigned),ledger=[];
        const depends=(id,source,seen=new Set())=>id===source||(!seen.has(id)&&(seen.add(id),(events.get(id)?.dataInputs??[]).some(id=>depends(id,source,seen))));
        for(const [i,op]of s.operations.entries()){
          evidence([op.modulusExecutionId,op.countReadExecutionId,op.countWriteExecutionId,...op.consumedWriteExecutionId?[op.consumedWriteExecutionId]:[]]);
          const r=events.get(op.cursorReadExecutionId),u=events.get(op.updateExecutionId),mod=events.get(op.modulusExecutionId),cr=events.get(op.countReadExecutionId),cw=events.get(op.countWriteExecutionId),e=events.get(op.accessExecutionId);
          if(k(cr?.target)!==k(s.roles.count)||k(cw?.target)!==k(s.roles.count)||cr.kind!=='READ'||cw.kind!=='WRITE'||n(cr)!==ledger.length||
            !depends(cw.eventId,cr.eventId)||!depends(u?.eventId,mod?.eventId)||!mod?.steps?.some(t=>wrapsAt(t,s.capacity))||
            k(u?.target)!==k(s.roles[op.role])||n(u)!==(n(r)+1)%s.capacity)fail('원형 큐의 개수 또는 모듈러 갱신 근거가 다릅니다.');
          if(op.kind==='enqueue')ledger.push({index:op.index,writer:op.accessExecutionId});else{
            const first=ledger.shift();if(!first||first.index!==op.index||first.writer!==op.consumedWriteExecutionId||!e.dataInputs?.includes(first.writer))fail('원형 큐의 FIFO 원소 식별자가 다릅니다.');
          }
          const st=s.states.find(st=>st.executionId===op.completedAtExecutionId);
          if(n(cw)!==ledger.length||!st&&!stateHistoryGapAt(s,positions,positions.get(op.completedAtExecutionId))||st&&st.count!==ledger.length)fail('원형 큐의 점유 개수가 다릅니다.');
          if(st?.status==='supported'&&(!st.ringOrder||JSON.stringify(st.ringOrder.indices)!==JSON.stringify(ledger.map(x=>x.index))||
            JSON.stringify(st.ringOrder.writeExecutionIds)!==JSON.stringify(ledger.map(x=>x.writer))||
            ledger.some((x,i)=>x.index!==(st.front+i)%s.capacity)||st.back!==(st.front+st.count)%s.capacity))fail('원형 큐의 논리 순서가 실제 원소와 다릅니다.');
        }
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
