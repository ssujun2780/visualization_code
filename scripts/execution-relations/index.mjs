import {Worker} from 'node:worker_threads';
import {createRelationContext,executionScope} from './context.mjs';
import {runRelationPasses} from './engine.mjs';
import {relationPasses} from './registry.mjs';
import {relationFailure,validateRelationResult} from './result.mjs';
export {RELATION_SCHEMA_VERSION} from './result.mjs';
import {createExecutionWorkQuery as createV1WorkQuery} from './work-context.mjs';
import {analyzeV2} from './v2/engine.mjs';
import {createV2Query} from './v2/query.mjs';
import {inputContext} from './v2/common.mjs';
import {validateV2,failure as v2Failure} from './v2/result.mjs';
export const EXTENDED_RELATION_SCHEMA_VERSION=2;
export function createExecutionWorkQuery(plan,trace,result,options={}){
  if(options.schemaVersion===2)return createV2Query(plan,trace,result,options);
  return createV1WorkQuery(plan,trace,result);
}

export function inferExecutionRelations(plan,trace,options={}){
  if(options.outputSchemaVersion===2)return analyzeV2(plan,trace,options);
  if(options.outputSchemaVersion!==undefined&&options.outputSchemaVersion!==1)throw new RangeError('지원하지 않는 관계 출력 버전입니다.');
  return runRelationPasses(plan,trace,options,relationPasses);
}

export function inferExecutionRelationsAsync(plan,trace,{timeoutMs=25000,...options}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new RangeError('실행 관계 분석 시간 제한은 1~120000ms여야 합니다.');
  if(!plan||!trace)return Promise.resolve(inferExecutionRelations(plan,trace,options));
  const scope=executionScope(plan,trace);
  return new Promise(resolve=>{
    let worker,done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);void worker?.terminate();resolve(result);};
    const failed=error=>options.outputSchemaVersion===2?v2Failure(scope,error):relationFailure(scope,error);
    const timer=setTimeout(()=>finish(failed(Object.assign(new Error('실행 관계 분석 시간 제한에 도달했습니다.'),{code:'execution-relations-time-limit'}))),timeoutMs);
    try{
      worker=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{plan,trace,options},execArgv:[]});
      worker.once('message',finish);
      worker.once('error',error=>finish(failed(error)));
      worker.once('exit',code=>{if(!done)finish(failed(new Error(`실행 관계 분석이 결과 없이 종료됐습니다 (${code}).`)));});
    }catch(error){finish(failed(error));}
  });
}

export function validateExecutionRelations(plan,trace,result,options={}){
  if(result?.schemaVersion===2)return validateV2(inputContext(plan,trace,options),result,{verifyOptional:['compilerFacts','structureInference','observationEvidence'].some(k=>options[k]!==undefined)});
  return validateRelationResult(createRelationContext(plan,trace),result);
}

// Build once for playback. Queries do not clone/re-index the entire trace on
// every animation frame. This exposes metadata, never a replacement scene.
export function createExecutionRelationQuery(plan,trace,result){
  if(result?.schemaVersion===2){const query=createV2Query(plan,trace,result);return Object.freeze({status:query.status,scope:query.scope,at:query.history});}
  const context=createRelationContext(plan,trace),snapshot=structuredClone(result);
  validateRelationResult(context,snapshot);
  return Object.freeze({status:snapshot.status,scope:Object.freeze({...snapshot.scope}),at(executionId){
    if(executionId===null)return [];
    const position=context.position(executionId);
    if(position===undefined)throw new RangeError('조회 시점이 실행 기록에 없습니다.');
    return structuredClone(snapshot.relations.filter(r=>context.position(r.availableAtExecutionId)<=position));
  }});
}
