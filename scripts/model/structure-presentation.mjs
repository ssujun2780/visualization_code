// Shared, UI-free presentation policy. Observed storage and IR are read-only.
import {topology} from './structure.mjs';
import {queryCoindexedRecords} from './coindexed-record-views.mjs';
export const STRUCTURE_RECOMMENDATION_LIMIT=5;
const unique=a=>[...new Set(a)];
const labels={array:'배열',grid:'격자',tree:'트리','binary-tree':'이진 트리',forest:'포레스트',graph:'그래프',dag:'방향 비순환 그래프',
  'linked-list':'연결 리스트',stack:'스택',queue:'큐',deque:'덱','dynamic-array':'동적 배열',bst:'이진 탐색 트리','min-heap':'최소 힙','max-heap':'최대 힙'};
const expectedFor=view=>['tree','forest'].includes(view)?view:view==='linked-list'?'chain':null;
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
export function setStructurePresentation(preferences,trace,{target,view,slot='primary',roleIds=null,expected=undefined}){
  const binding=targetOf(trace,target,true),run=scope(trace);text(slot,'보기');text(view,'표현');
  if(view==='auto')return clearStructurePresentation(preferences,trace,{target:binding,slot});
  if(roleIds!==null&&(!Array.isArray(roleIds)||roleIds.some(id=>typeof id!=='string'||!id)))throw new TypeError('역할 식별자 배열이 필요합니다.');
  if(expected!==undefined&&expected!==null)text(expected,'기대 조건');
  const id=key(binding,slot),override={scope:run,key:id,target:binding,slot,view,roleIds:roleIds===null?null:unique(roleIds).sort(),
    expected:expected===undefined?expectedFor(view):expected,origin:'user'};
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
  return {at,positions,occurred,state:s=>(s.states??[]).findLast(s=>occurred(s.afterExecutionId))};
}
function touches(s,target,trace){
  if(target.structureId)return s.id===target.structureId;
  const ranges=[s.range,s.vertexDomain?.range,...(s.arrays??[]).map(a=>a.range),...(s.logicalNodes??[]).map(n=>({objectId:n.objectId,offset:n.offset,size:n.size})),
    ...(s.nodes??[]).filter(n=>typeof n==='object').map(n=>n.range)].filter(Boolean);
  if(s.root){const o=trace.objects?.find(o=>o.id===s.root.objectId),known=(s.logicalNodes??[]).find(n=>n.objectId===s.root.objectId&&n.offset===s.root.offset),
    size=s.root.kind==='pointer-slot'?o?.cType?.sizeBits/8||s.roles?.[0]?.cType?.sizeBits/8:known?.size;
    if(size>0)ranges.push({objectId:s.root.objectId,offset:s.root.offset,size});}
  for(const r of Object.values(s.roles??{})){
    if(r?.objectId&&Number.isSafeInteger(r.offset)&&r.size>0)ranges.push(r);
    else if(s.ownerObjectId&&Number.isSafeInteger(r?.offset)&&r.size>0)ranges.push({objectId:s.ownerObjectId,offset:(s.ownerOffset??0)+r.offset,size:r.size});
  }
  for(const id of [s.objectId,s.ownerObjectId,s.root?.objectId].filter(Boolean)){
    const o=trace.objects?.find(o=>o.id===id);if(o&&!ranges.some(r=>r.objectId===id))ranges.push({objectId:id,offset:0,size:o.size});
  }
  return target.ranges.some(t=>ranges.some(r=>t.objectId===r.objectId&&t.offset<r.offset+r.size&&r.offset<t.offset+t.size));
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
  return {...shape,maxChildren:Math.max(0,...nodes.map(n=>links.filter(e=>e.from===n.id).length)),
    sharedChildren:nodes.filter(n=>links.filter(e=>e.to===n.id).length>1),
    status:selected.some(e=>!['in-bounds','null'].includes(e.status)||e.to&&!ids.has(e.to))?'partial':'observed'};
}

// Sort by evidence strength, then evidence coverage, then stable identifiers.
// Rank is not a probability. Duplicate views keep their role alternatives.
export function recommendStructureViews(trace,{target,afterExecutionId,roleIds=null}={}){
  const selected=targetOf(trace,target),ctx=context(trace,afterExecutionId),candidates=[];
  const offer=(s,view,strength,evidenceIds=[],roles=null,status='supported',expected=null)=>{
    const evidence=unique(evidenceIds.filter(ctx.occurred));if(!evidence.length||!['supported','partial'].includes(status)||typeof view!=='string'||!view.trim())return;
    if(roleIds&&roles&&JSON.stringify([...roleIds].sort())!==JSON.stringify([...roles].sort()))return;
    candidates.push({view,label:labels[view]??view,status,strength,candidateId:s.id,roleIds:roles?[...roles]:null,evidenceExecutionIds:evidence,expected:typeof expected==='string'?expected:null});
  };
  function shape(s,t,evidence,roles=null){
    if(!t||!(t.nodeCount>0))return;const partial=t.status==='partial',status=partial?'partial':'supported';
    offer(s,'graph',partial?1:2,evidence,roles,status);
    if(partial||t.cyclic||t.sharedChildren?.length)return;
    const forest=(t.roots?.length??1)>1;
    offer(s,forest?'forest':'tree',3,evidence,roles,'supported',forest?'forest':'tree');
    if(!forest&&t.maxChildren<=2)offer(s,'binary-tree',3,evidence,roles);
    if(t.maxChildren<=1)offer(s,'linked-list',3,evidence,roles,'supported','chain');
  }
  for(const s of trace.structures??[]){
    if(!touches(s,selected,trace)||s.temporalScope==='historical-union')continue;
    const discovered=s.discoveredAtExecutionId??s.inferredAtExecutionId;
    if(discovered&&!ctx.occurred(discovered))continue;
    const state=ctx.state(s),proof=state?[state.afterExecutionId]:[];
    if(s.kind==='array'){
      const object=trace.objects?.find(o=>o.id===s.objectId),seen=s.runtimeShape&&ctx.occurred(s.discoveredAtExecutionId)?[s.discoveredAtExecutionId]:object&&ctx.occurred(object.createdBy)?(object.cType?.kind==='array'?[object.createdBy]:
        (trace.events??[]).filter(e=>ctx.occurred(e.eventId)&&e.value?.reference?.targetObjectId===object.id&&e.value?.cType?.pointee?.sizeBits===s.elementBytes*8).map(e=>e.eventId)):[];
      offer(s,'array',2,seen);if(s.geometry?.rank>=2)offer(s,'grid',3,seen);
    }else if(s.kind==='linked-structure'){
      if(!state?.rootAlive)continue;
      if(!roleIds)shape(s,state.topology,proof);
      for(const p of state.roleTopologies??[])if(!roleIds||JSON.stringify([...p.fieldNodeIds].sort())===JSON.stringify([...roleIds].sort()))shape(s,p.topology,proof,p.fieldNodeIds);
    }else if(s.kind==='storage-reference-graph'){
      // Allocation/alias topology alone does not prove a container relation.
      // Typed traversal projections below can supply the missing role evidence.
      const t=graphSnapshot(s,ctx,roleIds,selected);
      if(t.nodeCount>0)offer(s,'graph',1,(s.changes??[]).filter(c=>ctx.occurred(c.afterExecutionId)).slice(-1).map(c=>c.afterExecutionId),roleIds);
      for(const p of s.roleProjections??[]){
        if(!p.supportingExecutionIds.some(ctx.occurred))continue;
        const t=graphSnapshot(s,ctx,p.roleIds,selected,p.typeIds);
        // Projections show observed relations. Missing unvisited fields are
        // still unknown, so topology is a suggestion, never an invariant proof.
        if(t.nodeCount>0&&t.edgeCount>0)shape(s,t,p.supportingExecutionIds,p.roleIds);
      }
    }else if(['dynamic-array','separate-array-structure'].includes(s.kind)){
      if(state?.active)offer(s,'dynamic-array',state.status==='consistent'?4:1,proof,null,state.status==='consistent'?'supported':'partial');
    }else if(s.kind==='array-structure'){
      if(!state?.active)continue;
      for(const r of s.roleAlternatives??[]){
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
      }
    }else if(s.kind==='coindexed-record-candidate'){
      const snapshot=queryCoindexedRecords(s,trace,{afterExecutionId});
      if(snapshot.discovered&&snapshot.alive){
        const good=s.evidence.flatMap(p=>p.accessExecutionIds).filter(ctx.occurred);
        offer(s,'array',2,good,null,'partial');
        const links=snapshot.edges.filter(e=>e.status==='observed');
        if(links.length)shape(s,snapshot.topology,snapshot.edges.filter(e=>['observed','observed-termination'].includes(e.status))
          .map(e=>e.terminationExecutionId??e.targetAccessExecutionId),snapshot.topology.roleIds);
      }
    }else if(['indexed-graph-candidate','record-index-graph-candidate','value-index-graph-candidate'].includes(s.kind)){
      if(state&&(state.active??state.alive??true)){
        offer(s,'graph',2,proof,null,['partial','inconsistent'].includes(state.status)?'partial':'supported');
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
  const order=(a,b)=>b.strength-a.strength||Math.min(3,b.evidenceExecutionIds.length)-Math.min(3,a.evidenceExecutionIds.length)||compare(a.view,b.view)||compare(a.candidateId,b.candidateId)||compare(JSON.stringify(a.roleIds),JSON.stringify(b.roleIds));
  candidates.sort(order);const views=new Map();for(const c of candidates){if(!views.has(c.view))views.set(c.view,{...c,alternatives:[]});views.get(c.view).alternatives.push(c);}
  return [...views.values()].slice(0,STRUCTURE_RECOMMENDATION_LIMIT).map((c,i)=>({...c,rank:i+1,origin:'inferred',intent:'unconfirmed',rankingPolicy:'evidence-strength-coverage-stable-id-v1'}));
}

export function resolveStructurePresentation(trace,{target,afterExecutionId,preferences,slot='primary',roleIds=null}={}){
  const binding=targetOf(trace,target),id=key(binding,slot),run=scope(trace),
    chosen=entries(preferences).find(x=>sameScope(x.scope,run)&&x.key===id),
    recommendations=recommendStructureViews(trace,{target:binding,afterExecutionId,roleIds:chosen?chosen.roleIds:roleIds}),best=recommendations[0];
  return {target:binding,slot,mode:chosen?'manual':'auto',source:chosen?'user':best?'candidate':'fallback',locked:!!chosen,
    view:chosen?.view??best?.view??'boxes',roleIds:chosen?(chosen.roleIds?[...chosen.roleIds]:null):best?.roleIds??null,
    expected:chosen?chosen.expected:best?.expected??null,recommendations,recommendationLimit:STRUCTURE_RECOMMENDATION_LIMIT,
    inferredCandidateId:chosen?null:best?.candidateId??null,
    contractPolicy:chosen?'selected-view-only; no inherited inferred subtype constraints':'selected-candidate-only'};
}
