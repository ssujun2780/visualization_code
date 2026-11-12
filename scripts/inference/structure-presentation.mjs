// Shared, UI-free presentation policy. Observed storage and IR are read-only.
import {structureTouches,structureRootRange} from './structure-storage.mjs';
import {topology} from '../shared/topology.mjs';
import {queryCoindexedRecords} from './coindexed-record-views.mjs';
import {queryBSTOrder} from './bst-views.mjs';
import {queryStructureConditions,validateConditionBindings} from './condition-query.mjs';
import {structureStateAt,stateHistoryGapAt} from './state-history.mjs';
export const STRUCTURE_RECOMMENDATION_LIMIT=5;
const unique=a=>[...new Set(a)];
const labels={array:'배열',grid:'격자',tree:'트리',trie:'트라이','binary-tree':'이진 트리',forest:'포레스트',graph:'그래프',dag:'방향 비순환 그래프',
  'linked-list':'연결 리스트',stack:'스택',queue:'큐',deque:'덱','dynamic-array':'동적 배열','nested-containers':'중첩 컨테이너',bst:'이진 탐색 트리','min-heap':'최소 힙','max-heap':'최대 힙','hash-table':'해시 테이블'};
Object.assign(labels,{'disjoint-set':'분리 집합','segment-tree':'구간 트리','fenwick-tree':'Fenwick 트리','range-aggregate':'구간 집계'});
const expectedFor=view=>['tree','forest','binary-tree','dag','avl','red-black','min-heap','max-heap','disjoint-set','segment-tree','fenwick-tree','range-aggregate','queue','stack','deque','hash-table','trie'].includes(view)?view:view==='linked-list'?'chain':view==='bst'?'bst-order':null;
const text=(value,name)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(`${name} 식별자가 필요합니다.`);return value;};
const compare=(a,b)=>a<b?-1:a>b?1:0;
function scope(trace){return {programId:text(trace.programId,'프로그램'),runId:text(trace.runId,'실행')};}
function targetOf(trace,target,strict=false){
  if(!target||typeof target!=='object')throw new TypeError('표현 대상이 필요합니다.');
  if(target.structureId){const structureId=text(target.structureId,'구조');if(strict&&!trace.structures?.some(s=>s.id===structureId))throw new RangeError('구조 후보를 찾을 수 없습니다.');return {structureId};}
  const objects=new Map((trace.objects??[]).map(o=>[o.id,o])),ranges=[...(target.ranges??[])];
  for(const id of unique([...(target.objectIds??[]),...(target.objectId?[target.objectId]:[])])){
    const o=objects.get(id);if(!o)throw new RangeError('관측된 객체를 찾을 수 없습니다.');ranges.push({objectId:id,offset:0,size:o.size});
  }
  if(!ranges.length)throw new TypeError('객체 또는 저장 범위를 지정해야 합니다.');
  const normalized=ranges.map(r=>{const o=objects.get(r.objectId);if(!o||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.size)||r.offset<0||r.size<0||r.offset+r.size>o.size)throw new RangeError('관측 저장 범위 밖의 지정입니다.');return {objectId:r.objectId,offset:r.offset,size:r.size};});
  const sorted=[...new Map(normalized.map(r=>[JSON.stringify(r),r])).values()].sort((a,b)=>compare(a.objectId,b.objectId)||a.offset-b.offset||b.size-a.size);
  return {ranges:sorted.filter((r,i)=>!sorted.some((p,j)=>j<i&&p.objectId===r.objectId&&p.offset<=r.offset&&p.offset+p.size>=r.offset+r.size))};
}
const sameScope=(a,b)=>a?.programId===b.programId&&a?.runId===b.runId;
const key=(target,slot)=>JSON.stringify([slot,target]);
function entries(preferences){if(preferences===undefined||preferences===null)return [];
  if(preferences.schemaVersion!==1||!Array.isArray(preferences.overrides))throw new TypeError('지원하지 않는 표현 설정입니다.');return preferences.overrides;}
export function setStructurePresentation(preferences,trace,{target,view,slot='primary',roleIds=null,expected=undefined,conditionBindings=null}){
  const binding=targetOf(trace,target,true),run=scope(trace);text(slot,'보기');text(view,'표현');
  if(view==='auto')return clearStructurePresentation(preferences,trace,{target:binding,slot});
  if(roleIds!==null&&(!Array.isArray(roleIds)||roleIds.some(id=>typeof id!=='string'||!id)))throw new TypeError('역할 식별자 배열이 필요합니다.');
  if(expected!==undefined&&expected!==null)text(expected,'기대 조건');
  const id=key(binding,slot),override={scope:run,key:id,target:binding,slot,view,roleIds:roleIds===null?null:unique(roleIds).sort(),
    expected:expected===undefined?expectedFor(view):expected,origin:'user',
    ...(conditionBindings?{conditionBindings:validateConditionBindings(conditionBindings)}:{})};
  return {schemaVersion:1,overrides:[...entries(preferences).filter(x=>!(sameScope(x.scope,run)&&x.key===id)),override]};
}
export function clearStructurePresentation(preferences,trace,{target,slot='primary'}){
  const run=scope(trace),id=key(targetOf(trace,target),slot);
  return {schemaVersion:1,overrides:entries(preferences).filter(x=>!(sameScope(x.scope,run)&&x.key===id))};
}
function context(trace,afterExecutionId){
  const positions=new Map((trace.events??[]).map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?(trace.events?.length??0)-1:positions.get(afterExecutionId);
  if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
  const occurred=id=>positions.has(id)&&positions.get(id)<=at;
  return {at,positions,occurred,state:s=>structureStateAt(s,positions,at,trace.objects)};
}
function graphSnapshot(s,ctx,roleIds,target,typeIds=null){
  const edges=new Map(),ended=new Set();for(const c of s.changes??[]){if(!ctx.occurred(c.afterExecutionId))continue;
    for(const e of c.upsertEdges)edges.set(e.id,e);for(const id of c.endedObjectIds)ended.add(id);}
  let nodes=(s.nodes??[]).filter(n=>ctx.occurred(n.discoveredAtExecutionId)&&!ended.has(n.range.objectId)&&(!typeIds||typeIds.includes(n.cType?.recordTypeId)));
  // Global storage metadata is scoped to the clicked storage and its outgoing
  // references; an unrelated tree elsewhere is not this object's suggestion.
  if(target.ranges){const wanted=new Set(nodes.filter(n=>target.ranges.some(r=>r.objectId===n.range.objectId&&r.offset<=n.range.offset&&r.offset+r.size>=n.range.offset+n.range.size)).map(n=>n.id));
    // Opening a pointer box selects its observed target before filtering the
    // record-field roles. The alias slot itself is not a structural node.
    if(typeIds)for(const e of edges.values())if(!e.sourceTypeId&&e.to&&nodes.some(n=>n.id===e.to)&&target.ranges.some(r=>r.objectId===e.source.objectId&&r.offset<=e.source.offset&&r.offset+r.size>=e.source.offset+e.source.size))wanted.add(e.to);
    for(const id of wanted)for(const e of edges.values())if(e.from===id&&e.to&&(!roleIds||roleIds.includes(e.roleId)))wanted.add(e.to);
    nodes=nodes.filter(n=>wanted.has(n.id));}
  const ids=new Set(nodes.map(n=>n.id)),selected=[...edges.values()].filter(e=>ids.has(e.from)&&(!roleIds||roleIds.includes(e.roleId))),
    links=selected.filter(e=>e.status==='in-bounds'&&ids.has(e.to)),shape=topology(nodes,links);
  const required=(roleIds??[]).map(id=>({id,types:new Set([...edges.values()].filter(e=>e.roleId===id).map(e=>e.sourceTypeId))})),
    missing=nodes.flatMap(n=>required.filter(r=>r.types.has(n.cType?.recordTypeId)&&
      // Only roles actually declared on this record are required. A
      // heterogeneous target record need not have the source record's field.
      !selected.some(e=>e.from===n.id&&e.roleId===r.id)).map(r=>({nodeId:n.id,roleId:r.id,status:'unobserved-slot'})));
  return {...shape,reachableNodeIds:nodes.map(n=>n.id),unknownRelations:missing,maxChildren:Math.max(0,...nodes.map(n=>links.filter(e=>e.from===n.id).length)),
    sharedChildren:nodes.filter(n=>links.filter(e=>e.to===n.id).length>1),
    status:missing.length||selected.some(e=>!['in-bounds','null'].includes(e.status)||e.to&&!ids.has(e.to))?'partial':'observed'};
}

// Compare overlapping logical-index views without merging their stored graphs.
// Only a shared, observed link role connects different relation candidates;
// sharing payload storage or equal index numbers is insufficient.
function indexedFamilies(trace,ctx){
  const structures=trace.structures??[],byId=new Map(structures.map(s=>[s.id,s])),groups=new Map(),result=new Map();
  for(const s of structures){
    if(s.kind!=='rooted-index-structure'||s.discoveredAtExecutionId&&!ctx.occurred(s.discoveredAtExecutionId))continue;
    const st=ctx.state(s),relation=byId.get(s.relationStructureId);
    if(!st?.rootAlive||!st.storageAlive||!relation||relation.discoveredAtExecutionId&&!ctx.occurred(relation.discoveredAtExecutionId))continue;
    let domains=[];
    if(relation.kind==='coindexed-record-candidate'){
      const proofs=(relation.evidence??[]).filter(p=>p.accessExecutionIds?.length&&p.accessExecutionIds.every(ctx.occurred));
      domains=unique(proofs.flatMap(p=>p.arrayIds));
    }else if(relation.kind==='value-index-graph-candidate')domains=[relation.arrayId];
    const root=structureRootRange(s,trace);if(!root)continue;
    const id=JSON.stringify([root.objectId,root.offset,root.size,st.rootIndex]);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push({s,st,links:s.roleIds.filter(id=>domains.includes(id))});
  }
  for(const group of groups.values()){
    const parent=group.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),owners=new Map();
    for(const [i,{s,links}]of group.entries())for(const key of [`relation:${s.relationStructureId}`,...links.map(id=>`link:${id}`)]){
      if(owners.has(key))parent[find(i)]=find(owners.get(key));else owners.set(key,i);
    }
    const components=new Map();for(const [i,row]of group.entries()){
      const id=find(i);if(!components.has(id))components.set(id,[]);components.get(id).push(row);
    }
    for(const rows of components.values()){
      const family={roles:unique(rows.flatMap(r=>r.s.roleIds)),count:unique(rows.flatMap(r=>r.st.memberIndices)).length};
      for(const {s}of rows)result.set(s.id,family);
    }
  }
  return result;
}

// Prefer the selected root, then coverage/evidence and stable identifiers.
// Rank is not a probability. Duplicate views keep their role alternatives.
export function recommendStructureViews(trace,{target,afterExecutionId,roleIds=null}={}){
  const selected=targetOf(trace,target),ctx=context(trace,afterExecutionId),candidates=[],indexFamilies=indexedFamilies(trace,ctx);
  // Select the semantic scope BEFORE filtering successful states. Otherwise a
  // valid descendant silently replaces a violated selected root's BST check.
  const orderedScope=new Set(queryBSTOrder(trace,{target:selected,afterExecutionId,roleIds}).candidates.map(c=>c.candidateId));
  let familyRoles=[],familyNodeCount=null;
  const offer=(s,view,strength,evidenceIds=[],roles=null,status='supported',expected=null)=>{
    const evidence=unique(evidenceIds.filter(ctx.occurred));if(!evidence.length||!['supported','partial'].includes(status)||typeof view!=='string'||!view.trim())return;
    if(roleIds&&roles&&JSON.stringify([...roleIds].sort())!==JSON.stringify([...roles].sort()))return;
    const root=structureRootRange(s,trace),exactRoot=!!root&&selected.ranges?.some(r=>r.objectId===root.objectId&&r.offset===root.offset&&r.size===root.size);
    const containedRoot=!!root&&!exactRoot&&selected.ranges?.some(r=>r.objectId===root.objectId&&r.offset<=root.offset&&r.offset+r.size>=root.offset+root.size&&r.size>root.size);
    candidates.push({view,label:labels[view]??view,status,strength,candidateId:s.id,exactRoot,containedRoot:!!containedRoot,roleIds:roles?[...roles]:null,evidenceExecutionIds:evidence,expected:typeof expected==='string'?expected:null,
      familyRoleIds:[...familyRoles],familyNodeCount});
    return candidates.at(-1);
  };
  function shape(s,t,evidence,roles=null){
    if(!t||!(t.nodeCount>0))return;const partial=t.status==='partial',status=partial?'partial':'supported';
    const begin=candidates.length;offer(s,'graph',partial?1:2,evidence,roles,status);
    const annotate=()=>{for(const c of candidates.slice(begin)){c.representedNodeCount=t.nodeCount;c.memberNodeIds=t.reachableNodeIds??null;}};
    if(!partial&&t.cyclic&&t.maxChildren===1&&!t.sharedChildren?.length&&t.edgeCount===t.nodeCount&&
      (t.rootNodeId||t.connected===true)&&roles?.length===1){offer(s,'linked-list',4,evidence,roles,status,null);
      candidates.at(-1).variant='circular';annotate();return;}
    if(partial&&t.scope!=='observed-edges'||t.cyclic||t.sharedChildren?.length||t.relationConflicts?.length){annotate();return;}
    const forest=(t.roots?.length??1)>1;
    offer(s,forest?'forest':'tree',3,evidence,roles,status,forest?'forest':'tree');
    if(!forest&&t.maxChildren<=2&&(!roles||roles.length<=2))offer(s,'binary-tree',3,evidence,roles,status);
    if(t.maxChildren<=1)offer(s,'linked-list',!forest&&t.nodeCount>1&&roles?.length===1?4:3,evidence,roles,status,'chain');
    annotate();
  }
  for(const s of trace.structures??[]){
    familyRoles=[];familyNodeCount=null;
    if(!structureTouches(s,selected,trace,ctx)||s.temporalScope==='historical-union')continue;
    const discovered=s.discoveredAtExecutionId??s.inferredAtExecutionId;
    if(discovered&&!ctx.occurred(discovered))continue;
    const state=ctx.state(s),proof=state?[state.afterExecutionId]:[];
    if(state?.historyGap||state?.lifetimeGap||state?.evidenceGap||stateHistoryGapAt(s,ctx.positions,ctx.at))continue;
    if(s.kind==='array'){
      const object=trace.objects?.find(o=>o.id===s.objectId),seen=s.runtimeShape&&ctx.occurred(s.discoveredAtExecutionId)?[s.discoveredAtExecutionId]:object&&ctx.occurred(object.createdBy)?(object.cType?.kind==='array'?[object.createdBy]:
        (trace.events??[]).filter(e=>ctx.occurred(e.eventId)&&e.value?.reference?.targetObjectId===object.id&&e.value?.cType?.pointee?.sizeBits===s.elementBytes*8).map(e=>e.eventId)):[];
      if(s.storageEvidence&&ctx.occurred(s.storageEvidence.executionId))seen.push(s.storageEvidence.executionId);
      offer(s,'array',2,seen);if(s.geometry?.rank>=2)offer(s,'grid',3,seen);
    }else if(s.kind==='associative-lookup-candidate'){
      const hashed=(s.lookupEvidence??[]).some(p=>ctx.occurred(p.executionId)&&p.bucketTransformExecutionIds?.some(ctx.occurred));
      if(hashed&&state?.alive&&state.entries.some(e=>e.alive))offer(s,'hash-table',5,[s.discoveredAtExecutionId,...proof],null,'partial');
    }else if(s.kind==='linked-structure'){
      if(!state?.rootAlive)continue;
      const observed=state.observedRoleIds??[],boundary=new Set(state.boundaries?.map(b=>b.nodeId)??[]),
        logical=t=>{if(!t||!boundary.size)return t;
          const ids=(t.reachableNodeIds??[]).filter(id=>!boundary.has(id)),set=new Set(ids),edges=(t.edges??[]).filter(e=>set.has(e.from)&&set.has(e.to)),g=topology(ids.map(id=>({id})),edges);
          return {...t,...g,physicalNodeCount:t.nodeCount,dataNodeIds:ids,reachableNodeIds:ids,
            maxChildren:Math.max(0,...ids.map(id=>edges.filter(e=>e.from===id).length)),
            sharedChildren:ids.filter(id=>edges.filter(e=>e.to===id).length>1),status:t.status==='partial'?'partial':ids.length?'observed':'empty'};},
        present=(t,ids)=>{if(!ids?.length||!ids.every(id=>observed.includes(id))){if(t?.nodeCount)offer(s,'graph',1,proof,ids);return;}
          const data=logical(t);if(data?.status==='empty'){offer(s,'linked-list',3,proof,ids,'supported',null);candidates.at(-1).representedNodeCount=0;return;}
          shape(s,data,proof,ids);};
      familyRoles=unique((state.roleTopologies??[]).flatMap(p=>p.fieldNodeIds));
      familyNodeCount=unique([state.storageTopology,state.topology,...(state.roleTopologies??[]).map(p=>p.topology)]
        .flatMap(t=>logical(t)?.reachableNodeIds??[])).length;
      if(!roleIds)present(state.topology,state.roleTopologies?.find(p=>p.roleGroupId===state.selectedRoleGroupId)?.fieldNodeIds??familyRoles);
      for(const p of state.roleTopologies??[])if(!roleIds||JSON.stringify([...p.fieldNodeIds].sort())===JSON.stringify([...roleIds].sort()))present(p.topology,p.fieldNodeIds);
      for(const p of state.endpointPolicies??[])if(p.roleIds.every(id=>observed.includes(id))){
        const g=state.roleTopologies?.find(g=>g.fieldNodeIds.length===p.roleIds.length&&p.roleIds.every(id=>g.fieldNodeIds.includes(id))),
          ids=g?logical(g.topology)?.reachableNodeIds: p.roleIds.length===1?state.orders?.find(o=>o.fieldNodeId===p.roleIds[0])?.nodeIds:null,
          c=offer(s,p.view,5,p.supportingExecutionIds,p.roleIds);
        if(c){c.memberNodeIds=ids??null;c.representedNodeCount=ids?.length??null;}
      }
    }else if(s.kind==='rooted-index-structure'){
      if(!state?.rootAlive||!state.storageAlive)continue;
      const family=indexFamilies.get(s.id);
      familyRoles=family?.roles??s.roleIds;
      familyNodeCount=family?.count??unique(state.memberIndices).length;
      if(state.topology.status==='empty'){offer(s,'linked-list',4,proof,s.roleIds,'supported',null);candidates.at(-1).representedNodeCount=0;}
      else shape(s,state.topology,proof,s.roleIds);
      for(const p of state.endpointPolicies??[]){const c=offer(s,p.view,5,p.supportingExecutionIds,p.roleIds);
        if(c){c.representedNodeCount=state.topology.nodeCount;c.memberNodeIds=state.orders.flatMap(o=>o.nodeIds);}}
    }else if(s.kind==='ordered-tree-candidate'){
      if(!orderedScope.has(s.id)||!state?.alive||state.status!=='satisfied-observed'||state.historyGap)continue;
      familyRoles=state.contracts.map(c=>c.roleId);familyNodeCount=state.nodes.length;
      const c=offer(s,'bst',5,state.evidenceExecutionIds,familyRoles,'supported','bst-order');
      if(c){c.representedNodeCount=state.nodes.length;c.memberNodeIds=state.nodes.map(n=>n.id);}
    }else if(['representative-partition-candidate','pointer-partition-candidate'].includes(s.kind)){
      if(state?.alive&&state.status==='supported-observed')offer(s,'disjoint-set',5,state.evidenceExecutionIds,null,'partial',null);
    }else if(s.kind==='range-aggregate-candidate'){
      if(state?.alive&&['supported-observed','transformed-aggregate'].includes(state.status)&&state.view)offer(s,state.view,5,state.evidenceExecutionIds,null,'partial',null);
    }else if(['pointer-priority-candidate','composite-priority-candidate'].includes(s.kind)){
      if(state?.alive&&state.nodes?.length>1)for(const direction of ['min','max'])if(state[direction]==='satisfied'&&state[direction==='min'?'max':'min']==='violated')offer(s,`${direction}-heap`,3,state.evidenceExecutionIds,null,'partial',null);
    }else if(s.kind==='sequence-lookup-candidate'){
      if(!state?.alive||state.conditions.trie!=='supported-observed')continue;
      familyRoles=s.roleIds;familyNodeCount=state.nodes.length;
      const c=offer(s,'trie',5,[...proof,...state.evidenceExecutionIds],s.roleIds,'partial',null);
      if(c){c.representedNodeCount=state.nodes.length;c.memberNodeIds=state.nodes.map(n=>n.id);c.variant=state.edges.some(e=>e.labels.some(l=>l.units.length>1))?'compressed':'symbol';}
    }else if(s.kind==='pointer-tree-projection'){
      if(!state?.alive)continue;
      familyRoles=s.roleIds;familyNodeCount=state.nodes.length;
      const begin=candidates.length;shape(s,state.topology,[...proof,...state.evidenceExecutionIds],s.roleIds);
      for(const c of candidates.slice(begin)){c.variant=s.mode;if(c.view==='tree'||c.view==='forest')c.strength=4;}
    }else if(s.kind==='storage-reference-graph'){
      // Allocation/alias topology alone does not prove a container relation.
      // Typed traversal projections below can supply the missing role evidence.
      const t=graphSnapshot(s,ctx,roleIds,selected);
      if(t.nodeCount>0)offer(s,'graph',1,(s.changes??[]).filter(c=>ctx.occurred(c.afterExecutionId)).slice(-1).map(c=>c.afterExecutionId),roleIds);
      for(const p of s.roleProjections??[]){
        if(!p.supportingExecutionIds.some(ctx.occurred))continue;
        familyRoles=unique((s.roleProjections??[]).filter(q=>q.typeIds.some(id=>p.typeIds.includes(id))&&q.supportingExecutionIds.some(ctx.occurred)).flatMap(q=>q.roleIds));
        familyNodeCount=graphSnapshot(s,ctx,null,selected,p.typeIds).nodeCount;
        const t=graphSnapshot(s,ctx,p.roleIds,selected,p.typeIds);
        // Projections show observed relations. Missing unvisited fields are
        // still unknown, so topology is a suggestion, never an invariant proof.
        if(t.nodeCount>0&&t.edgeCount>0)shape(s,t,p.supportingExecutionIds,p.roleIds);
      }
    }else if(['dynamic-array','separate-array-structure'].includes(s.kind)){
      if(state?.active)offer(s,'dynamic-array',state.status==='consistent'?4:1,proof,null,state.status==='consistent'?'supported':'partial');
    }else if(s.kind==='array-structure'){
      if(!state?.active)continue;
      if(state.roleAssessments){
        for(const a of state.roleAssessments)if(a.status==='supported'){
          const view={fifo:'queue',lifo:'stack',deque:'deque','active-prefix':'array'}[a.role];
          if(view)offer(s,view,a.role==='active-prefix'?3:4,a.supportingExecutionIds);
        }
      }else for(const r of s.roleAlternatives??[]){
        const good=(r.supportingExecutionIds??[]).filter(ctx.occurred),bad=(r.contradictingExecutionIds??[]).filter(ctx.occurred),
          ops=(s.operationEvidence??[]).filter(o=>good.includes(o.accessExecutionId)&&ctx.occurred(o.completeExecutionId));
        if(bad.length||!ops.some(o=>o.operation==='insert')||!ops.some(o=>o.operation==='remove'))continue;
        const view={fifo:'queue',lifo:'stack',deque:'deque','active-prefix':'array'}[r.role];if(view)offer(s,view,4,good);
      }
    }else if(s.kind==='queue-candidate'){
      const good=(s.operations??[]).filter(o=>ctx.occurred(o.completedAtExecutionId)&&o.status==='supported'),bad=(s.operations??[]).some(o=>ctx.occurred(o.completedAtExecutionId)&&o.status==='contradicted');
      if(!bad&&['enqueue','dequeue'].every(k=>good.some(o=>o.kind===k)))offer(s,'queue',4,good.map(o=>o.completedAtExecutionId));
    }else if(s.kind==='index-tree'){
      const formulas=(s.formulaEvidence??[]).filter(f=>ctx.occurred(f.executionId));
      if(formulas.length&&!formulas.some(f=>f.status==='contradicted')){
        offer(s,'tree',2,formulas.map(f=>f.executionId),null,'partial','tree');
        if(s.descriptor?.degree===2)offer(s,'binary-tree',2,formulas.map(f=>f.executionId),null,'partial');
        for(const direction of ['min','max'])if(state?.[direction]?.status==='satisfied'&&(s.comparisonEvidence??[]).some(c=>ctx.occurred(c.executionId)&&c.directionCandidate===direction))
          offer(s,`${direction}-heap`,3,[...proof,...formulas.map(f=>f.executionId)],null,'supported',`${direction}-heap`);
        // A record key can be compared to an insertion temporary, so there is
        // no current parent-child comparator direction. Expose a snapshot
        // condition candidate only with actual index relations and key reads.
        if(s.orderingProperty&&state?.totalEdges>0&&(s.comparisonEvidence??[]).some(c=>ctx.occurred(c.executionId)))
          for(const direction of ['min','max'])if(state[direction].status==='satisfied'&&state[direction==='min'?'max':'min'].status==='violated')
            offer(s,`${direction}-heap`,3,[...proof,...formulas.map(f=>f.executionId)],null,'partial',`${direction}-heap`);
      }
    }else if(s.kind==='composed-container-candidate'){
      if(state?.alive&&state.status==='supported')offer(s,s.view,4,state.evidenceExecutionIds);
    }else if(s.kind==='composed-reference-candidate'){
      if(state?.alive&&state.interpretation==='adjacency-records')offer(s,'graph',state.status==='supported'?4:1,state.evidenceExecutionIds,s.roleIds,state.status==='supported'?'supported':'partial');
      else if(state?.alive&&state.containers?.some(c=>c.memberNodeIds.length))offer(s,'nested-containers',state.status==='supported'?4:1,state.evidenceExecutionIds,s.roleIds,state.status==='supported'?'supported':'partial');
    }else if(s.kind==='table-row-graph-candidate'){
      if(state?.alive){shape(s,state.topology,proof,state.roleIds);if(state.parentTopology)shape(s,state.parentTopology,proof,state.roleIds);}
    }else if(s.kind==='coindexed-record-candidate'){
      const snapshot=queryCoindexedRecords(s,trace,{afterExecutionId});
      if(snapshot.discovered&&snapshot.alive){
        const good=s.evidence.flatMap(p=>p.accessExecutionIds).filter(ctx.occurred);
        offer(s,'array',2,good,null,'partial');
        const links=snapshot.edges.filter(e=>e.status==='observed');
        if(links.length)shape(s,snapshot.topology,snapshot.edges.filter(e=>['observed','observed-termination'].includes(e.status))
          .map(e=>e.terminationExecutionId??e.targetAccessExecutionId),snapshot.topology.roleIds);
      }
    }else if(s.kind==='observed-traversal-graph-candidate'){
      if(state?.alive&&state.edges.some(e=>e.status==='observed')){
        const associations=(s.relationRole?.associations??[]).filter(a=>a.evidenceExecutionIds.every(ctx.occurred));
        if(associations.length){
          const relationRole={kind:s.relationRole.kind,ofStructureIds:unique(associations.map(a=>a.structureId))};
          const a=offer(s,'array',3,proof);if(a)a.relationRole=relationRole;
          const g=offer(s,'graph',1,proof,null,'partial');if(g)g.relationRole=relationRole;
        }else {shape(s,state.topology,proof);offer(s,'graph',state.status==='observed'?4:2,proof,null,state.status==='observed'?'supported':'partial');}
      }
    }else if(s.kind==='index-domain-graph-candidate'){
      if(state?.alive)offer(s,'graph',state.status==='observed'?4:1,proof,null,state.status==='observed'?'supported':'partial');
    }else if(['indexed-graph-candidate','record-index-graph-candidate','value-index-graph-candidate'].includes(s.kind)){
      if(state&&(state.active??state.alive??true)){
        offer(s,'graph',2,proof,null,['partial','inconsistent'].includes(state.status)?'partial':'supported');
        if(s.kind==='record-index-graph-candidate'&&state.topology?.complete)shape(s,state.topology,proof);
        if(state.logicalTopology?.complete)shape(s,state.logicalTopology,[...proof,...state.logicalTopology.evidenceExecutionIds]);
        for(const p of state.parentRoleTopologies??[])shape(s,p.topology,proof,p.fieldNodeIds);
        if(state.topology?.complete&&(state.views??state.topology.views)?.includes('parent-forest-candidate')){
          const view=state.topology.roots?.length===1?'tree':'forest';offer(s,view,3,proof,null,'supported',view);
        }
      }
    }
    // Extension contract for later inference modules, including BST/custom
    // structures. A name alone, without time-scoped execution evidence, is not
    // a recommendation. Unknown expectation checkers remain not-checkable.
    for(const c of s.presentationCandidates??[]){
      const good=(c.supportingExecutionIds??[]).filter(ctx.occurred),bad=(c.contradictingExecutionIds??[]).filter(ctx.occurred);
      if(!bad.length&&good.length&&(!c.discoveredAtExecutionId||ctx.occurred(c.discoveredAtExecutionId)))offer(s,c.view,c.status==='partial'?1:4,good,c.roleIds??null,c.status??'supported',c.expected??null);
    }
  }
  // A narrower projection cannot silently hide edges from an observed relation
  // family. Keep it selectable and describe the omitted roles explicitly.
  for(const c of candidates){
    const broader=c.roleIds?.length?candidates.filter(p=>p.candidateId===c.candidateId&&p.roleIds?.length>c.roleIds.length&&c.roleIds.every(id=>p.roleIds.includes(id))):[];
    const family=broader.sort((a,b)=>b.roleIds.length-a.roleIds.length)[0];
    const canon=id=>id.replace(/^field:/,''),all=unique([...(family?.roleIds??[]),...c.familyRoleIds]),
      excluded=c.roleIds?all.filter(id=>!c.roleIds.some(r=>canon(r)===canon(id))):[],
      omitted=c.familyNodeCount===null||c.representedNodeCount==null?null:Math.max(0,c.familyNodeCount-c.representedNodeCount);
    c.coverage={scope:c.containedRoot?'contained-root':excluded.length||omitted?'role-projection':'candidate',selectedRoleIds:c.roleIds,
      excludedRoleIds:excluded,representedNodeCount:c.representedNodeCount??null,familyNodeCount:c.familyNodeCount,omittedNodeCount:omitted};
    delete c.familyRoleIds;delete c.familyNodeCount;
  }
  const sites=c=>Math.min(3,new Set(c.evidenceExecutionIds.map(id=>trace.events[ctx.positions.get(id)]?.instructionId??id)).size);
  const omission=c=>c.coverage.familyNodeCount>0&&c.coverage.omittedNodeCount!==null?c.coverage.omittedNodeCount/c.coverage.familyNodeCount:null;
  const order=(a,b)=>Number(b.exactRoot)-Number(a.exactRoot)||Number(a.containedRoot)-Number(b.containedRoot)||(a.coverage.omittedNodeCount>0)-(b.coverage.omittedNodeCount>0)||
    (omission(a)!==null&&omission(b)!==null?omission(a)-omission(b):0)||b.strength-a.strength||sites(b)-sites(a)||compare(a.view,b.view)||compare(a.candidateId,b.candidateId)||compare(JSON.stringify(a.roleIds),JSON.stringify(b.roleIds));
  candidates.sort(order);const views=new Map();for(const c of candidates){if(!views.has(c.view))views.set(c.view,{...c,alternatives:[]});views.get(c.view).alternatives.push(c);}
  return [...views.values()].slice(0,STRUCTURE_RECOMMENDATION_LIMIT).map((c,i)=>({...c,rank:i+1,origin:'inferred',intent:'unconfirmed',rankingPolicy:'exact-root-selection-scope-node-coverage-behavior-strength-stable-id-v7'}));
}

export function resolveStructurePresentation(trace,{target,afterExecutionId,preferences,slot='primary',roleIds=null}={}){
  const binding=targetOf(trace,target),id=key(binding,slot),run=scope(trace),
    chosen=entries(preferences).find(x=>sameScope(x.scope,run)&&x.key===id),
    recommendations=recommendStructureViews(trace,{target:binding,afterExecutionId,roleIds:chosen?chosen.roleIds:roleIds}),best=recommendations[0],
    expected=chosen?chosen.expected:best?.expected,
    check=expected?queryStructureConditions(trace,{target:binding,afterExecutionId,expected,
      candidateId:chosen?null:best?.candidateId,roleIds:chosen?chosen.roleIds:best?.roleIds??roleIds,bindings:chosen?.conditionBindings}):null;
  return {target:binding,slot,mode:chosen?'manual':'auto',source:chosen?'user':best?'candidate':'fallback',locked:!!chosen,
    view:chosen?.view??best?.view??'boxes',roleIds:chosen?(chosen.roleIds?[...chosen.roleIds]:null):best?.roleIds??null,
    expected:chosen?chosen.expected:best?.expected??null,recommendations,recommendationLimit:STRUCTURE_RECOMMENDATION_LIMIT,
    inferredCandidateId:chosen?null:best?.candidateId??null,
    contractPolicy:chosen?'selected-view-only; no inherited inferred subtype constraints':'selected-candidate-only',
    ...(check?{expectationCheck:check}:{})};
}
