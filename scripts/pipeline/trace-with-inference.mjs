import {traceModel} from '../model/index.mjs';
import {inferStructuresAsync} from '../inference/index.mjs';

// Optional orchestration belongs above both models. Public IR remains raw;
// consumers opt in to createInferenceView when they need a combined view.
export async function traceWithInference(source,{inferenceTimeoutMs=25000,inference,...options}={}){
  const result=await traceModel(source,{...options,includeObservations:true});
  const metadata=await inferStructuresAsync(result.plan,result.trace,{timeoutMs:inferenceTimeoutMs,
    observationPlan:result.observations?.plan,observedTrace:result.observations?.trace});
  if(!options.includeObservations&&!result.conversionFailure&&!result.conversionNotice)delete result.observations;
  return {...result,inference:metadata};
}
