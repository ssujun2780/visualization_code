import {collectCompilerFacts} from './compiler-facts.mjs';
import {inferStructures} from '../inference/structure-inference.mjs';
import {inferExecutionRelations} from '../execution-relations/index.mjs';

// Optional sidecars only. Failure never changes or discards canonical playback.
export function analyzeRecordingWork(plan,trace,{nodes,ast,compilerFacts,structureInference,observations}={}){
  const diagnostics=[];
  try{compilerFacts??=collectCompilerFacts(plan,{nodes,ast});}catch(error){diagnostics.push({stage:'compiler-facts',message:error.message});}
  try{structureInference??=inferStructures(plan,trace,{observationPlan:observations?.plan,observedTrace:observations?.trace});}
  catch(error){diagnostics.push({stage:'structure-inference',message:error.message});}
  const options={outputSchemaVersion:2,compilerFacts,structureInference,limits:{timeMs:6000,maxRelations:100000,maxProvenanceEdges:300000}};
  const relations=inferExecutionRelations(plan,trace,options);
  return {schemaVersion:1,scope:{programId:plan.programId,runId:trace.runId},compilerFacts,structureInference,relations,diagnostics};
}
