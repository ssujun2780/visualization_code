// Representation adapters only. No key, balance, colour or algorithm policy.
import {structureTouches,structureRootRange} from './structure-storage.mjs';
import {structureStateAt,stateHistoryGapAt} from './state-history.mjs';
import {semanticKinds,projectSemanticRelation} from './semantic-relations.mjs';
import {queryUserRelation} from './user-relations.mjs';
import {structureQueryContext} from './query-index.mjs';
const equal=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
const role=e=>e.fieldNodeId??e.roleId??e.relationId;
export function relationContext(trace,afterExecutionId){
  return structureQueryContext(trace,afterExecutionId);
}
export function projectStructureRelation(source,state,{roleIds=null}={}){
  if(!state)return null;
  if(semanticKinds.has(source.kind))return projectSemanticRelation(source,state);
  const pointer=source.kind==='linked-structure',indexed=source.kind==='rooted-index-structure',projection=['pointer-tree-projection','sequence-lookup-candidate'].includes(source.kind);
  if(!pointer&&!indexed&&!projection)return null;
  const selected=pointer&&roleIds?state.roleTopologies?.find(p=>equal(p.fieldNodeIds,roleIds)):null,
    top=selected?.topology??state.topology,
    roles=roleIds??(pointer?state.roleTopologies?.find(p=>p.roleGroupId===state.selectedRoleGroupId)?.fieldNodeIds:source.roleIds)??[],
    roleComplete=roleIds===null||(pointer?!!selected:equal(roleIds,source.roleIds??[])),
    ids=new Set(top?.reachableNodeIds??(projection?state.nodes?.map(n=>n.id):[])),
    pool=projection?state.nodes:source.logicalNodes,
    nodes=(pool??[]).filter(n=>ids.has(n.id)).map(n=>({id:n.id,index:n.index,
      recordTypeId:n.recordTypeId,range:n.range??(n.objectId?{objectId:n.objectId,offset:n.offset,size:n.size}:null),
      parts:n.parts??[],...(n.terminalMarkers?{terminalMarkers:n.terminalMarkers}:{} )})),
    edges=(source.kind==='sequence-lookup-candidate'?state.edges:(top?.edges??(projection?state.edges:[])??[])).filter(e=>ids.has(e.from)&&ids.has(e.to)&&e.termination!=='sentinel')
      .map(e=>({id:e.id,from:e.from,to:e.to,roleId:role(e),storedEdgeIds:e.storedEdgeIds??(e.id?[e.id]:[]),...(e.labels?{labels:e.labels}:{})})),
    terminals=(top?.edges??[]).filter(e=>e.termination==='sentinel'||e.status==='null'||e.termination==='boundary')
      .map(e=>({from:e.from,to:e.to,roleId:role(e),storedEdgeIds:e.storedEdgeIds??(e.id?[e.id]:[]),kind:e.termination??'null'})),
    alive=projection?state.alive:state.rootAlive&&(pointer||state.storageAlive),
    historyGap=!!state.historyGap,
    complete=!!top&&roleComplete&&!historyGap&&!state.lifetimeGap&&!['partial','unknown'].includes(top.status)&&
      !(top.unknownRelations?.length||top.endedTargetNodeIds?.length)&&nodes.length===ids.size;
  return {id:`relation:${source.id}:${[...roles].sort().join('|')}`,sourceStructureId:source.id,sourceKind:source.kind,
    afterExecutionId:state.afterExecutionId,roleIds:[...roles],alive:!!alive,complete,roleComplete,historyGap,
    ...(state.lifetimeStatus?{lifetimeStatus:state.lifetimeStatus}:{}),
    rootNodeIds:top?.status==='empty'?[]:top?.rootNodeId?[top.rootNodeId]:top?.roots??[],nodes,edges,terminals,
    terminalNodeIds:[...top?.terminalNodeIds??[]],topology:top??null,
    evidenceExecutionIds:[...state.evidenceExecutionIds??[]],scopeRanges:state.scopeRanges??[],
    ...(source.kind==='sequence-lookup-candidate'?{sequenceConditions:state.conditions}:{}),
    interpretation:'logical relation only; source storage and edge directions are unchanged'};
}
export function queryStructureRelations(trace,{target,candidateId,roleIds=null,afterExecutionId,relationBinding=null,relationLimits={}}={}){
  const ctx=relationContext(trace,afterExecutionId);
  if(relationBinding)return structuredClone({afterExecutionId:trace.events[ctx.at]?.eventId??null,
    relations:[queryUserRelation(trace,relationBinding,{...relationLimits,at:ctx.at,roleIds})]});
  const all=trace.structures??[],selected=all.find(s=>s.id===(candidateId??target?.structureId)),
    ordered=selected?.kind==='ordered-tree-candidate'?selected:null,orderState=ordered&&ctx.state(ordered),
    sourceId=ordered?.sourceStructureId??candidateId,
    wanted=roleIds??orderState?.contracts?.map(c=>c.roleId)??null,
    normalized=target?.objectId?{ranges:[{objectId:target.objectId,offset:0,size:trace.objects.find(o=>o.id===target.objectId)?.size}]}:target;
  let relations=[],historyGap=false;
  for(const source of all){
    if(!semanticKinds.has(source.kind)&&!['linked-structure','rooted-index-structure','pointer-tree-projection','sequence-lookup-candidate'].includes(source.kind))continue;
    if(sourceId&&source.id!==sourceId||ordered&&!orderState||source.discoveredAtExecutionId&&!ctx.occurred(source.discoveredAtExecutionId))continue;
    if(sourceId&&normalized?.ranges&&!structureTouches(source,normalized,trace,ctx))continue;
    if(sourceId&&normalized?.structureId&&![source.id,ordered?.id].includes(normalized.structureId))continue;
    if(!sourceId&&normalized&&!structureTouches(source,normalized,trace,ctx))continue;
    const state=ctx.state(source);if(!state){historyGap||=stateHistoryGapAt(source,ctx.positions,ctx.at);continue;}
    const choices=wanted?[wanted]:source.kind==='linked-structure'&&state.roleTopologies?.length?
      state.roleTopologies.map(p=>p.fieldNodeIds):[null];
    for(const roles of choices){const relation=projectStructureRelation(source,state,{roleIds:roles});if(!relation)continue;
      if(state.lifetimeStatus)relation.lifetimeStatus=state.lifetimeStatus;
      if(source.coverage?.omittedStates&&!Object.hasOwn(source.coverage,'historyGapFromExecutionId')&&ctx.positions.get(state.afterExecutionId)<ctx.at){relation.complete=false;relation.historyGap=true;}
      const root=structureRootRange(source,trace),object=trace.objects.find(o=>o.id===source.objectId);
      if(object&&ctx.occurred(object.endedBy))relation.alive=false;
      if(relation.semantic?.lookupEvidence)relation.semantic={...relation.semantic,lookupEvidence:relation.semantic.lookupEvidence.filter(p=>ctx.occurred(p.executionId))};
      relations.push({...relation,root,selectedCandidateId:ordered?.id??source.id,
        exactRoot:!!root&&normalized?.ranges?.some(r=>r.objectId===root.objectId&&r.offset===root.offset&&r.size===root.size)});
    }
  }
  if(relations.some(r=>r.exactRoot))relations=relations.filter(r=>r.exactRoot);
  return structuredClone({afterExecutionId:trace.events[ctx.at]?.eventId??null,relations,...historyGap?{historyGap:true}:{}});
}
