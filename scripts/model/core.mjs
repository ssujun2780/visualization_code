import {runLLVM} from "../instrumentation/toolchain.mjs";
import {prepareCModel} from "./compile.mjs";
import {ModelRecorder} from "./recorder.mjs";
import {recordIR} from "./ir-record.mjs";

export async function runModelCore(source,options={},notify=()=>{}) {
  let analysis,generated;
  try {
    ({analysis,generated}=await prepareCModel(source,options));
  } catch(error) {
    const status=error.stage!=="ir-conversion"?"compile-error":error.name==="UnsupportedC"||/지원하지 않는/.test(error.message)?"unsupported":"engine-error";
    const diagnostic={code:status,message:error.message,source:error.source??null};
    return {plan:null,llvm:analysis?.llvm??null,instrumentedLLVM:null,stdout:"",stderr:"",compilerDiagnostics:error.message,
      trace:{schemaVersion:3,status,exitCode:null,events:[{schemaVersion:3,eventId:"x1",executionId:"x1",instructionId:null,kind:"ERROR",action:"fault",phase:"failed",evidence:"compiler",diagnostic}],diagnostics:[diagnostic],objects:[],frames:[],coverage:{execution:"not started"}}};
  }
  notify({type:"prepared",plan:generated.plan,observationPlan:generated.observationPlan,ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm});
  const recorder=new ModelRecorder(generated.observationPlan,generated.abi,{...options,onEvents:events=>notify({type:"observations",events})});
  let execution;
  try {execution=await runLLVM(generated.llvm,recorder,{stdin:options.stdin??""});}
  catch(error) {return {plan:generated.plan,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,stdout:"",stderr:"",compilerDiagnostics:error.message,
    trace:recordIR(generated.plan,generated.observationPlan,{status:"engine-error",exitCode:null,events:recorder.events,objects:[],frames:[],diagnostics:[{code:"engine-error",message:error.message}]}),
    ...(options.includeObservations?{observations:{plan:generated.observationPlan,trace:{events:recorder.events}}}:{})};}
  const observedTrace=recorder.finish(execution),trace=recordIR(generated.plan,generated.observationPlan,observedTrace);
  return {plan:generated.plan,trace,...(options.includeObservations?{observations:{plan:generated.observationPlan,trace:observedTrace}}:{}),ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,stdout:execution.stdout,stderr:execution.stderr,
    compilerDiagnostics:analysis.diagnostics+(execution.compilerDiagnostics??"")};
}
