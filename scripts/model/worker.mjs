import {parentPort,workerData} from "node:worker_threads";
import {runModelCore} from "./core.mjs";
import {compileCToIR} from "./compile.mjs";
try {parentPort.postMessage({type:"result",result:workerData.mode==="compile"?
  await compileCToIR(workerData.source,workerData.options):await runModelCore(workerData.source,workerData.options,message=>parentPort.postMessage(message))});}
catch(error){parentPort.postMessage({type:"failure",message:error.message??String(error),name:error.name,stack:error.stack,
  stage:error.stage,source:error.source??error.context?.source,code:error.code,context:error.context,
  ...(error.analysis?{analysis:{ast:error.analysis.ast,llvm:error.analysis.llvm,diagnostics:error.analysis.diagnostics}}:{})});}
