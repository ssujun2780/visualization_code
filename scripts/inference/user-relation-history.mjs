import {createUserRelationQuery} from './user-relations.mjs';
import {stateHistoryCoverage,appendStateSnapshot} from './state-history.mjs';
import {buildStructureStorageBindings} from './storage-bindings.mjs';

// Consumer input, not a replacement inference result. User roles remain marked
// as such and never enter the automatic candidate/recommendation pipeline.
export function createStructureRelationInput(trace,{structureInference=null,relations=[],maxStates=2048,maxQueries=20000,relationLimits={}}={}){
  const scope={programId:trace.programId,runId:trace.runId};
  if(structureInference&&(structureInference.scope?.programId!==scope.programId||structureInference.scope?.runId!==scope.runId))throw new RangeError('다른 실행의 구조 결과입니다.');
  if(!Array.isArray(relations)||!Number.isSafeInteger(maxQueries)||maxQueries<1)throw new TypeError('관계 목록과 양수 조회 한도가 필요합니다.');
  stateHistoryCoverage(maxStates);
  const userRelations=[],diagnostics=[],identities=new Set();
  for(const item of relations){
    const query=createUserRelationQuery(trace,item.relationBinding??item,{...relationLimits,roleIds:item.roleIds??null}),
      candidate={id:null,kind:'user-relation',origin:'user',definition:query.binding,states:[],coverage:stateHistoryCoverage(maxStates)};
    let previous=null,queries=0;
    for(let i=0;i<trace.events.length;i++){
      const e=trace.events[i];if(e.phase&&e.phase!=='complete'||!['SPACE','READ','WRITE'].includes(e.kind)&&!e.value?.reference)continue;
      if(queries++>=maxQueries){
        candidate.coverage.historyGaps=[{fromExecutionId:e.eventId,toExecutionId:null}];
        diagnostics.push({code:'user-relation-query-limit',relationId:candidate.id,afterExecutionId:e.eventId,limit:maxQueries});break;
      }
      const r=query.at(i);candidate.id??=r.id;
      // Membership and its backing storage control access mappings. Key values
      // and repeated READ provenance do not create another membership version.
      const signature=JSON.stringify({alive:r.alive,nodes:r.nodes,edges:r.edges.map(e=>[e.from,e.to,e.roleId]),
        roots:r.rootNodeIds,complete:r.complete,limited:r.coverage.limited,lifetime:r.lifetimeStatus,
        missing:r.missing.map(m=>m.code),violations:r.violations.map(v=>v.code)});
      if(signature===previous)continue;previous=signature;
      appendStateSnapshot(candidate.states,r,candidate.coverage);
    }
    if(!candidate.id)candidate.id=query.at(-1).id;
    if(identities.has(candidate.id))continue;identities.add(candidate.id);
    if(candidate.coverage.omittedStates)diagnostics.push({code:'user-relation-state-limit',relationId:candidate.id,...candidate.coverage});
    if(candidate.states.some(s=>s.coverage.limited))diagnostics.push({code:'user-relation-storage-limit',relationId:candidate.id});
    userRelations.push(candidate);
  }
  const existing=structureInference??{},storageBindings=buildStructureStorageBindings(trace,userRelations);
  return structuredClone({kind:'structure-relation-input',schemaVersion:1,scope,
    status:diagnostics.length||existing.status==='partial'?'partial':'completed',
    structures:[...existing.structures??[],...userRelations],storageBindings:[...existing.storageBindings??[],...storageBindings],
    userRelations,diagnostics:[...existing.diagnostics??[],...diagnostics]});
}
