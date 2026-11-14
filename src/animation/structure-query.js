import {createInferenceView} from '../../scripts/inference/result.mjs';
import {resolveStructurePresentation,setStructurePresentation,clearStructurePresentation} from '../../scripts/inference/structure-presentation.mjs';
import {queryStructureRelations} from '../../scripts/inference/structure-relations.mjs';
import {structureLabels} from './structure-kinds.js';
import {queryStructureConditions} from '../../scripts/inference/condition-query.mjs';
import {queryIndexRelations} from '../../scripts/inference/index-relations.mjs';
import {createStorageReferenceView} from './structure-storage-view.js';
import {decodeInference} from '../../scripts/inference/shared-values.mjs';
import {snapshotRelation} from './snapshot-relation.js';
import {createStructureQueryTrace} from '../../scripts/inference/query-index.mjs';
const rec=r=>({view:r.view,label:r.label??structureLabels[r.view]??r.view,candidateId:r.candidateId,roleIds:r.roleIds,status:r.status,rank:r.rank,coverage:r.coverage,variant:r.variant,alternativeCount:r.alternatives?.length??0});
const intersects=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const range=r=>r?.objectId&&Number.isFinite(r.offset)&&Number.isFinite(r.size)&&r.size>0?{objectId:r.objectId,offset:r.offset,size:r.size}:null;
function displayMetadata(relation){
  if(!relation)return null;
  const {state,lookupEvidence,operationEvidence,...shared}=relation.semantic??{},
    {nodes,edges,entries,priorityEdges,...metadata}=state??{};
  return {...shared,...metadata,topology:relation.topology??metadata.topology,directed:relation.directed??metadata.directed};
}
function nodeRanges(n){return [range(n.range??n.record),...(n.parts??[]).map(p=>range(p.range??p)),...(n.values??[]).map(p=>range(p.range??p))].filter(Boolean);}

// A read-only consumer of public inference APIs, shared by Worker and tests.
// No C execution, classifier, final-node substitution or value inference here.
export function createStructureViewQuery(plan,trace,inference){
  inference=decodeInference(inference);
  const storageReferenceView=createStorageReferenceView();
  const recommendationLists=new WeakMap();
  const recommendations=rows=>{let result=recommendationLists.get(rows);if(!result){result=rows.map(rec);recommendationLists.set(rows,result);}return result.map(r=>({...r}));};
  const view=createInferenceView({plan,trace},inference),source=createStructureQueryTrace(view.trace),structures=new Map((inference.structures??[]).filter(s=>s.id).map(s=>[s.id,s]));
  let preferences={schemaVersion:1,overrides:[]};
  function set(target,choice,afterExecutionId){
    preferences=choice.view==='auto'?clearStructurePresentation(preferences,source,{target}):
      setStructurePresentation(preferences,source,{target,view:choice.view,roleIds:choice.roleIds??null,plan,afterExecutionId});
  }
  function project(target,afterExecutionId,{focus=[],limit=64,selection=null}={}){
    // The public inference query requires an observed event. Before the first
    // event there are no current members or recommendations to project.
    if(afterExecutionId===null)return {target,afterExecutionId,view:'boxes',label:structureLabels.boxes,mode:'auto',locked:false,source:'fallback',recommendations:[],warnings:[],relation:null,descriptor:{},displayLimit:limit};
    const p=selection??resolveStructurePresentation(source,{target,afterExecutionId,preferences,plan,relationLimits:{maxNodes:512,maxEdges:2048}}),best=p.recommendations[0],candidateId=p.inferredCandidateId;
    // Manual layout does not inherit a recommendation's role filter or subtype
    // conditions. Ask for the same backing relation with the user's roles only.
    // Generic condition queries also contain empty semantic descriptors; those
    // are not the visible topology when an observed relation is available.
    const preferred=p.mode==='manual'?p.recommendations.find(r=>r.view===p.view):null;
    const wholeStored=p.mode==='manual'&&!p.roleIds&&['tree','binary-tree','forest','graph','dag','linked-list'].includes(p.view),
      storage=wholeStored?[...structures.values()].find(s=>s.kind==='storage-reference-graph'):structures.get(candidateId??preferred?.candidateId);
    // This graph replaces generic candidate relations. Resolve it first so a
    // fixed graph view never builds and clones unrelated relations to discard.
    const stored=storage?.kind==='storage-reference-graph'?storageReferenceView(storage,source,target,afterExecutionId,p.roleIds):null;
    let actual;
    if(stored)actual=[stored];
    else{
      const query=()=>queryStructureRelations(source,{target,candidateId,roleIds:p.roleIds,afterExecutionId}).relations;
      const supplied=p.relationView?.relations??p.expectationCheck?.candidates?.map(c=>c.relation).filter(Boolean);
      actual=supplied?.length?supplied:query();
      if(preferred){const selected=queryStructureRelations(source,{target,candidateId:preferred.candidateId,roleIds:p.roleIds,afterExecutionId}).relations;if(selected.length)actual=selected;}
    }
    if(!actual.length&&!p.roleIds?.length){const selected=structures.get(candidateId??preferred?.candidateId??p.recommendations.find(r=>r.view===p.view)?.candidateId),relation=snapshotRelation(selected,source,afterExecutionId);if(relation)actual=[relation];}
    const relation=actual.find(r=>r.sourceStructureId===candidateId||r.selectedCandidateId===candidateId)??actual.find(r=>r.nodes?.length)??actual[0],
      displayId=candidateId??p.recommendations.find(r=>r.view===p.view)?.candidateId,
      s=structures.get(relation?.sourceStructureId??displayId)??structures.get(displayId?.replace(/^array:/,'')),
      array=structures.get(s?.arrayId)??(s?.kind==='array'?s:null),descriptor={...s?.descriptor,layout:s?.layout??s?.descriptor?.layout,objectId:s?.objectId??array?.objectId??s?.range?.objectId??array?.range?.objectId,range:s?.range??array?.range,elementBytes:s?.elementBytes??array?.elementBytes,capacity:s?.capacity??array?.capacity,dimensions:array?.dimensions??s?.dimensions},
      state=relation?.semantic?.state,historyGap=!!relation?.historyGap;
    let nodes=historyGap?[]:relation?.nodes??[],edges=historyGap?[]:relation?.edges??[];
    // Materialise the existing lazy index relation through its public API.
    // Capacity alone is never treated as observed heap membership.
    const activeIndexRange=state?.activeRange;
    if(!historyGap&&s?.kind==='index-tree'&&activeIndexRange?.status==='observed'&&Number.isInteger(activeIndexRange.count)){
      const start=activeIndexRange.start,count=Math.min(256,activeIndexRange.count),pool=new Map(),node=(index,r)=>{const id=`${s.id}:index:${index}`;if(!pool.has(id))pool.set(id,{id,index,range:{objectId:r.objectId,offset:r.offset,size:r.size}});return id;};
      if(count>0)node(start,{objectId:s.objectId,offset:s.range.offset+start*s.elementBytes,size:s.elementBytes});
      edges=queryIndexRelations(s,source,{afterExecutionId,start:start+1,limit:Math.max(0,count-1)}).filter(e=>e.parentIndex>=start&&e.childIndex<start+count).map(e=>({id:`${s.id}:${e.parentIndex}:${e.childIndex}`,from:node(e.parentIndex,e.parent),to:node(e.childIndex,e.child),storedEdgeIds:[],isPointer:false}));
      nodes=[...pool.values()];
    }
    // The API's observed occupancy/order is display metadata, not a license to
    // turn capacity into membership. Empty and unobserved remain distinct.
    if(!nodes.length&&!historyGap&&state&&descriptor.objectId&&descriptor.elementBytes>0){
      const order=state.logicalOrder,active=state.activeRange;
      let indices=[];
      if(order&&Number.isSafeInteger(order.start)&&Number.isSafeInteger(order.length??order.count)&&(order.length??order.count)>=0&&(order.length??order.count)<=descriptor.capacity)
        indices=Array.from({length:order.length??order.count},(_,i)=>((order.start+i*(order.stride??order.direction??1))%descriptor.capacity+descriptor.capacity)%descriptor.capacity);
      else if((active?.valid||active?.status==='observed')&&Number.isSafeInteger(active.start)&&Number.isSafeInteger(active.end??active.start+active.count)&&active.start>=0&&(active.end??active.start+active.count)>=active.start&&(active.end??active.start+active.count)<=descriptor.capacity)
        indices=Array.from({length:(active.end??active.start+active.count)-active.start},(_,i)=>active.start+i);
      nodes=indices.map(index=>({id:`${s.id}:slot:${index}`,index,range:{objectId:descriptor.objectId,offset:(descriptor.range?.offset??0)+index*descriptor.elementBytes,size:descriptor.elementBytes}}));
    }
    const properties=['avl','red-black'].includes(p.view)?queryStructureConditions(source,{target,candidateId,roleIds:p.roleIds,afterExecutionId,expected:p.view}).candidates.find(c=>c.relation?.id===relation?.id)?.properties:null;
    const property=(name,id)=>properties?.[name]?.values.find(v=>v.nodeId===id),colour=n=>{const value=property('color',n.id)?.value;return value==null?n.color:String(value)===properties.color.redValue?'red':String(value)===properties.color.blackValue?'black':undefined;};
    const total=nodes.length,cap=Math.max(1,Math.min(256,limit)),focused=nodes.filter(n=>nodeRanges(n).some(r=>focus.some(f=>intersects(r,f)))),
      selected=new Set([...new Set([...focused,...nodes].map(n=>n.id))].slice(0,cap));
    const visible=nodes.filter(n=>selected.has(n.id)),visibleIds=new Set(visible.map(n=>n.id)),warnings=[];
    if(historyGap)warnings.push('이 시점의 구조 이력이 생략되어 이전 관계를 현재 구조로 표시하지 않습니다.');
    if(relation?.alive===false)warnings.push('구조의 수명이 종료되었습니다.');
    if(relation&&!relation.complete&&!historyGap)warnings.push('일부 연결·범위가 미확정입니다. 관측된 부분만 표시합니다.');
    if(nodes.some(n=>n.stale))warnings.push('이전 입력 버전에 기반한 집계가 관측되었습니다. 저장값을 보정하지 않습니다.');
    if(p.expectationCheck?.assessment==='violated')warnings.push('선택한 표현의 구조 조건 위반이 관측되었습니다. 실제 연결을 유지합니다.');
    if(p.expectationCheck?.assessment==='not-checkable')warnings.push('선택한 표현의 조건을 확인할 근거가 부족합니다.');
    if(actual.length>1)warnings.push(`관계 해석 ${actual.length}개 중 현재 선택에 대응하는 관계를 표시합니다.`);
    if(p.mode==='auto'&&best?.coverage?.excludedRoleIds?.length)warnings.push(`연결 역할 ${best.coverage.excludedRoleIds.length}개가 제외된 부분 보기입니다. 다른 실제 연결은 원본에서 확인할 수 있습니다.`);
    if(p.view!=='boxes'&&!['array','grid','dynamic-array'].includes(p.view)&&!relation)warnings.push('현재 시점에 이 표현과 연결할 논리 관계가 없습니다. 원본 상자를 유지합니다.');
    return {target,afterExecutionId,view:p.view,variant:p.variant??best?.variant,label:structureLabels[p.view]??p.view,mode:p.mode,locked:p.locked,source:p.source,
      recommendations:recommendations(p.recommendations),roleIds:p.roleIds,candidateId:relation?.sourceStructureId??candidateId,status:inference.status,
      coverage:best?.coverage,assessment:p.expectationCheck?.assessment,warnings,displayLimit:cap,
      selection:{view:p.view,mode:p.mode,source:p.source,locked:p.locked,roleIds:p.roleIds,inferredCandidateId:p.inferredCandidateId,recommendations:p.recommendations},
      relation:relation?{id:relation.id,sourceKind:relation.sourceKind,alive:relation.alive,complete:relation.complete,historyGap,
        rootNodeIds:relation.rootNodeIds??[],terminals:(relation.terminals??[]).filter(t=>visibleIds.has(t.from)).map(t=>({from:t.from,to:t.to,kind:t.kind,roleId:t.roleId})),nodes:visible.map(n=>({...n,id:n.id,index:n.index,ranges:nodeRanges(n),coverage:n.coverage,
          bucket:n.bucket??n.bucketIndex,root:n.root,parent:n.parent??n.parentIndex??(p.view==='disjoint-set'?n.path?.[1]:undefined),keyRange:range(n.keyRange),terminal:(n.terminalMarkers??[]).map(t=>({range:range(t.range),accepted:t.accepted})),
          label:n.label??n.symbol,stale:n.stale,color:colour(n),colorRange:range(property('color',n.id)?.range),height:property('height',n.id)?.value??n.height,heightRange:range(property('height',n.id)?.range)})),edges:edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)).slice(0,512).map(e=>({...e,id:e.id,from:e.from,to:e.to,roleId:e.roleId,labels:e.labels,storedEdgeIds:e.storedEdgeIds??[],weightRange:range(e.weightRange)})),
        totalNodes:total,omittedNodes:total-visible.length,omittedEdges:Math.max(0,edges.length-edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)).slice(0,512).length),
        semantic:displayMetadata(relation)}:null,
      descriptor};
  }
  return {project,set};
}
