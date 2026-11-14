import {structureStateAt} from '../../scripts/inference/state-history.mjs';

// Consume a selected candidate's existing relation snapshot when the generic
// inference query has no projector for that candidate yet. No classification,
// traversal, source parsing or reconstructed links are performed here.
export function snapshotRelation(candidate,trace,afterExecutionId){
  if(!candidate)return null;
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=positions.get(afterExecutionId);
  if(at===undefined)return null;
  const discovered=positions.get(candidate.discoveredAtExecutionId);if(discovered!==undefined&&discovered>at)return null;
  const state=structureStateAt(candidate,positions,at,trace.objects);
  if(!Array.isArray(state?.nodes)||!Array.isArray(state?.edges))return null;
  const ended=new Set(trace.objects.filter(o=>positions.get(o.endedBy)<=at).map(o=>o.id)),gap=!!(state.historyGap||state.lifetimeGap),
    nodes=gap?[]:state.nodes.filter(n=>typeof n?.id==='string'&&!ended.has((n.range??n.record??n).objectId)).map(n=>({...n,range:n.range??n.record??(n.objectId?{objectId:n.objectId,offset:n.offset,size:n.size}:undefined)})),ids=new Set(nodes.map(n=>n.id)),
    edges=gap?[]:state.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&(e.status==null||['observed','supported'].includes(e.status))).map(e=>({...e,storedEdgeIds:e.storedEdgeIds??[],isPointer:e.isPointer??false})),
    owner=candidate.objectId??candidate.range?.objectId??candidate.vertexDomain?.range?.objectId,
    alive=state.alive!==false&&state.active!==false&&!ended.has(owner),
    roots=state.rootNodeIds??state.topology?.roots??state.roots??[];
  return {id:`relation:${candidate.id}`,sourceStructureId:candidate.id,selectedCandidateId:candidate.id,sourceKind:candidate.kind,
    afterExecutionId:state.afterExecutionId??state.executionId,alive,complete:!gap&&!state.evidenceGap&&state.status==='observed'&&edges.length===state.edges.length,historyGap:gap,
    rootNodeIds:roots.map(id=>ids.has(id)?id:nodes.find(n=>n.index===id)?.id).filter(Boolean),nodes,edges,terminals:[],
    topology:state.topology,semantic:{kind:candidate.kind,state,directed:state.directed??candidate.directed,descriptor:candidate.descriptor},
    evidenceExecutionIds:state.evidenceExecutionIds??[],interpretation:'read-only supplied relation snapshot'};
}
