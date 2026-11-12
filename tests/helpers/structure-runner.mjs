import {traceModel} from '../../scripts/model/index.mjs';
import {traceWithInference} from '../../scripts/pipeline/trace-with-inference.mjs';
import {createInferenceView} from '../../scripts/inference/index.mjs';

// Existing structure assertions intentionally inspect a combined consumer
// view. Keep that opt-in here, never in the IR generator's public API.
export async function traceWithStructureView(source,options={}){
  if(options.inference===false)return traceModel(source,options);
  const result=await traceWithInference(source,options);
  return {...result,...createInferenceView(result,result.inference)};
}
