import {Worker} from 'node:worker_threads';
import {inferenceFailure,skippedInference} from './result.mjs';
import {inferenceLimits} from './inference-limits.mjs';
import {decodeInference} from './shared-values.mjs';
export {encodeInference,decodeInference} from './shared-values.mjs';
export {inferStructures} from './structure-inference.mjs';
export {validateStructureTrace} from './structure-schema.mjs';
export {createInferenceView} from './result.mjs';
export {queryStorageReferences} from './storage-relations.mjs';
export {queryCoindexedRecords} from './coindexed-record-views.mjs';
export {queryBSTOrder} from './bst-views.mjs';
export {queryAssociativeLookup} from './associative-views.mjs';
export {querySequenceLookup} from './sequence-lookup-views.mjs';
export {queryDisjointSet} from './partition-views.mjs';
export {queryRangeAggregate} from './range-aggregate-views.mjs';
export {querySemanticStructure as queryInferredSemantics} from './storage-semantics.mjs';
export {queryManagementRoles} from './management-roles.mjs';
export {queryStructureRelations} from './structure-relations.mjs';
export {defineStructureRelation} from './relation-binding.mjs';
export {createStructureRelationInput} from './user-relation-history.mjs';
export {defineStructureConditionRules} from './user-conditions.mjs';
export {captureStructurePresentationAnchor,reconnectStructureSetting,reconnectStructurePresentation} from './presentation-reconnect.mjs';
export {buildStructureStorageBindings} from './storage-bindings.mjs';
export {queryStructureConditions} from './condition-query.mjs';
export {evaluateStructureConditions,STRUCTURE_CONDITIONS} from './structure-conditions.mjs';
export {recommendStructureViews,resolveStructurePresentation,setStructurePresentation,clearStructurePresentation,STRUCTURE_RECOMMENDATION_LIMIT} from './structure-presentation.mjs';

// Independent worker, deadline and failure domain. Only derived metadata is
// returned; this module has no dependency on compilation or IR generation.
export function inferStructuresAsync(plan,trace,{timeoutMs=25000,observationPlan,observedTrace,limits}={}){
  inferenceLimits(limits);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new RangeError('추론 시간 제한은 1~120000ms여야 합니다.');
  if(!plan||!trace)return Promise.resolve(skippedInference());
  return new Promise(resolve=>{
    let worker,done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);void worker?.terminate();
      resolve({...result,scope:{programId:plan.programId??null,runId:trace.runId??null}});};
    const timer=setTimeout(()=>finish(inferenceFailure(new Error('자료구조 추론 시간 제한에 도달했습니다.'),'structure-inference-time-limit')),timeoutMs);
    try{
      worker=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{plan,trace,options:{observationPlan,observedTrace,limits}},execArgv:[]});
      worker.once('message',result=>{try{finish(decodeInference(result));}catch(error){finish(inferenceFailure(error));}});
      worker.once('error',error=>finish(inferenceFailure(error)));
      worker.once('exit',code=>{if(!done)finish(inferenceFailure(new Error(`자료구조 추론 작업이 결과 없이 종료됐습니다 (${code}).`)));});
    }catch(error){finish(inferenceFailure(error));}
  });
}
