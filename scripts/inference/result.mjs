import {decodeInference} from './shared-values.mjs';

export function inferenceFailure(error,code='structure-inference-failed'){
  return {schemaVersion:1,status:code==='structure-inference-time-limit'?'limited':'partial',structures:[],bindings:{},
    diagnostics:[{code,scope:'visualization-only',message:error.message??String(error)}]};
}
export function skippedInference(){
  return {schemaVersion:1,status:'skipped',structures:[],bindings:{},diagnostics:[]};
}

// Explicit consumer adapter. Never assign derived metadata to the supplied IR.
export function createInferenceView({plan,trace},inference){
  inference=decodeInference(inference);
  if(inference?.scope&&(inference.scope.programId!==(plan?.programId??null)||inference.scope.runId!==(trace?.runId??null)))
    throw new RangeError('다른 프로그램 또는 실행의 추론 결과를 결합할 수 없습니다.');
  return {plan:plan?{...plan,structureBindings:inference?.bindings??{}}:plan,
    trace:trace?{...trace,structures:inference?.structures??[]}:trace};
}
