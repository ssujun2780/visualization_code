import {runLLVM} from "../instrumentation/toolchain.mjs";
import {prepareCModel} from "./compile.mjs";
import {ModelRecorder} from "./recorder.mjs";
import {recordObservedTrace} from "./recorded-result.mjs";

export async function runModelCore(source,options={},notify=()=>{}) {
  let analysis,generated;
  try {
    ({analysis,generated}=await prepareCModel(source,options));
  } catch(error) {
    analysis=error.analysis??analysis;
    const status=error.stage!=="ir-conversion"?"compile-error":error.name==="UnsupportedC"||/지원하지 않는/.test(error.message)?"unsupported":"engine-error";
    const diagnostic={code:status,message:error.message,stage:error.stage??'compilation',source:error.source??error.context?.source??null,
      ...(error.code?{causeCode:error.code}:{})};
    return {plan:null,ast:analysis?.ast??null,llvm:analysis?.llvm??null,instrumentedLLVM:null,stdout:"",stderr:"",compilerDiagnostics:error.message,
      ...(error.stage==='ir-conversion'?{conversionFailure:{stage:'ir-planning',diagnostic,stack:error.stack}}:{}),
      trace:{schemaVersion:3,status,exitCode:null,events:[{schemaVersion:3,eventId:"x1",executionId:"x1",instructionId:null,kind:"ERROR",action:"fault",phase:"failed",evidence:"compiler",diagnostic}],diagnostics:[diagnostic],objects:[],frames:[],coverage:{execution:"not started"}}};
  }
  notify({type:"prepared",plan:generated.plan,observationPlan:generated.observationPlan,ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm});
  const recorder=new ModelRecorder(generated.observationPlan,generated.abi,{...options,onEvents:(events,state)=>notify({type:"observations",events,state})});
  let execution;
  try {execution=await runLLVM(generated.llvm,recorder,{stdin:options.stdin??""});}
  catch(error) {
    const status=error.stage==='link'?'link-error':'engine-error';
    const unresolvedImports=(error.unresolvedImports??[]).map(i=>{
      const f=i.module==='env'?generated.plan.functions.find(f=>f.name===i.name):null;
      const declaration=i.module==='env'?generated.plan.functionDeclarations.find(d=>d.name===i.name):null;
      return {...i,functionId:f?.id??null,source:f?.source??declaration?.source??null,
        ...(f?.specifiers?.inline&&f.llvmLinkage==='available_externally'?{reason:'inline-definition-without-external-definition',
          help:'외부 연결 inline 본문만으로는 외부 정의가 제공되지 않습니다. 단일 파일 내부 함수라면 static inline을 사용할 수 있습니다.'}:{})};
    });
    const eventId=`e${recorder.events.length+1}`;
    const diagnostic={code:status,message:error.message,stage:error.stage??null,eventId,...(unresolvedImports.length?{unresolvedImports}:{})};
    const raw={status,exitCode:null,events:[...recorder.events,{schemaVersion:2,eventId,
      kind:'ERROR',phase:'fault',diagnostic,evidence:status==='link-error'?'linker':'engine'}],objects:[],frames:[],diagnostics:[diagnostic],
      ...(status==='link-error'?{coverage:{execution:'not started'}}:{})};
    const recorded=recordObservedTrace(generated.plan,generated.observationPlan,raw,options);
    return {plan:generated.plan,ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,stdout:"",stderr:"",
      compilerDiagnostics:analysis.diagnostics+error.message,...recorded,
      ...(options.includeObservations||recorded.conversionFailure?{observations:{plan:generated.observationPlan,trace:raw}}:{})};
  }
  const observedTrace=recorder.finish(execution),recorded=recordObservedTrace(generated.plan,generated.observationPlan,observedTrace,
    {...options,onExecution:trace=>notify({type:'execution',trace,stdout:execution.stdout,stderr:execution.stderr,
      compilerDiagnostics:analysis.diagnostics+(execution.compilerDiagnostics??'')})});
  return {plan:generated.plan,...recorded,...(options.includeObservations||recorded.conversionFailure?{observations:{plan:generated.observationPlan,trace:observedTrace}}:{}),ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,stdout:execution.stdout,stderr:execution.stderr,
    compilerDiagnostics:analysis.diagnostics+(execution.compilerDiagnostics??"")};
}
