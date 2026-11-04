import {parentPort,workerData} from "node:worker_threads";
import {runModelCore} from "./core.mjs";
import {compileCToIR} from "./compile.mjs";
try {parentPort.postMessage({type:"result",result:workerData.mode==="compile"?
  await compileCToIR(workerData.source,workerData.options):await runModelCore(workerData.source,workerData.options,message=>parentPort.postMessage(message))});}
catch(error){parentPort.postMessage({type:"failure",message:error.stack??String(error)});}
