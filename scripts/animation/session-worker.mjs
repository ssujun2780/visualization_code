import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {prepareCModel} from '../model/compile.mjs';
import {ModelRecorder} from '../model/recorder.mjs';
import {recordObservedTrace} from '../model/recorded-result.mjs';
import {runLLVM} from '../instrumentation/toolchain.mjs';
import {executionFailure} from './failure.mjs';
import {loopNavigation} from './loop-navigation.mjs';
import {astNodes} from '../model/ast.mjs';
import {collectCompilerFacts} from './compiler-facts.mjs';

// Execution control only: the compiler, recorder and public IR conversion are
// shared with the batch API. No C interpretation, rerun or prefix comparison.
const control=new Int32Array(workerData.shared,0,3);
const payload=new Uint8Array(workerData.shared,12);
let queued=new TextEncoder().encode(workerData.initialInput??''),ended=workerData.inputEnded===true,requestId=0;
let source,stage='source';
try {
  source=workerData.source??await readFile(workerData.file,'utf8');
  stage='compile';
  const {analysis,generated}=await prepareCModel(source,{filename:workerData.file});
  const nodes=analysis.parsedNodes??astNodes(analysis.ast),navigation=loopNavigation(generated.plan,{nodes,source}),compilerFacts=collectCompilerFacts(generated.plan,{nodes});
  const recorder=new ModelRecorder(generated.observationPlan,generated.abi);
  const convert=raw=>{
    const result=recordObservedTrace(generated.plan,generated.observationPlan,raw,{inference:false});
    if(result.conversionFailure)throw Object.assign(new Error(result.conversionFailure.diagnostic.message),{stage:'ir-recording'});
    return {plan:generated.plan,trace:result.trace,navigation};
  };
  const stdin={read(capacity){
    while(!queued.length&&!ended){
      Atomics.store(control,0,0);
      const raw=structuredClone({schemaVersion:2,...recorder.checkpoint(),events:recorder.events,status:'running',exitCode:null});
      const result=convert(raw);
      // An unfinished expression is not a completed animation command. It is
      // retained in the recorder and becomes available after actual execution.
      const incomplete=result.trace.events.findIndex(e=>e.phase!=='complete');
      if(incomplete>=0)result.trace.events=result.trace.events.slice(0,incomplete);
      result.workInputs={compilerFacts,observations:{plan:generated.observationPlan,trace:raw}};
      const call=recorder.frame()?.activeCall;
      parentPort.postMessage({type:'input',...result,request:{id:++requestId,
        name:call?.event?.callee?.replace(/^@/,''),source:call?.operation?.source??null}});
      Atomics.wait(control,0,0);
      if(Atomics.load(control,0)!==1)throw new Error('실행 세션이 종료되었습니다.');
      const length=Atomics.load(control,1);
      queued=payload.slice(0,length);ended=Boolean(Atomics.load(control,2));
    }
    const bytes=queued.slice(0,capacity);queued=queued.slice(bytes.length);return bytes;
  }};
  stage='execution';
  const execution=await runLLVM(generated.llvm,recorder,{stdin});
  const raw=recorder.finish(execution),result=convert(raw);
  result.workInputs={compilerFacts,observations:{plan:generated.observationPlan,trace:raw}};
  parentPort.postMessage({type:'complete',...result});
} catch(error){parentPort.postMessage(executionFailure(error,{source,file:workerData.file,stage}));}
