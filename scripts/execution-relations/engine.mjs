import {createRelationContext,executionScope} from './context.mjs';
import {relationResult,relationFailure,validateRelationResult} from './result.mjs';

export function runRelationPasses(plan,trace,options,passes){
  const scope=executionScope(plan,trace);
  if(!plan||!trace)return relationResult(scope,'skipped',{diagnostics:[{code:'execution-records-unavailable',message:'실행 기록이 없어 분석하지 않았습니다.'}]});
  let context;
  try{context=createRelationContext(plan,trace,options);}catch(error){return relationFailure(scope,error);}
  const relations=[],diagnostics=[],completed=[],failed=[];
  const coverage={eventCount:context.trace.events.length,registeredPasses:passes.length,completedPasses:completed,failedPasses:failed};
  if(!passes.length)return relationResult(scope,'not-implemented',{coverage,diagnostics:[{code:'relation-passes-not-implemented',message:'실행 관계 판정기는 아직 구현하지 않았습니다.'}]});
  const passIds=new Set();
  for(const pass of passes){
    if(!pass||typeof pass.id!=='string'||!pass.id||passIds.has(pass.id)||typeof pass.analyze!=='function')return relationFailure(scope,new Error('판정기 식별자가 없거나 중복됐거나 분석 함수가 없습니다.'),'invalid-relation-registry');
    passIds.add(pass.id);
  }
  for(const pass of passes){
    try{
      const proposed=pass.analyze(context);
      if(!Array.isArray(proposed))throw new Error('판정기는 관계 목록을 반환해야 합니다.');
      const candidate=structuredClone(proposed);
      validateRelationResult(context,relationResult(scope,'partial',{relations:[...relations,...candidate]}));
      relations.push(...candidate);completed.push(pass.id);
    }catch(error){failed.push(pass.id);diagnostics.push({code:error.code??'relation-pass-failed',stage:'execution-relations',passId:pass.id,message:error.message??String(error)});}
  }
  return relationResult(scope,failed.length?completed.length?'partial':'failed':'completed',{relations,diagnostics,coverage});
}
