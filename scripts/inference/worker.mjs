import {parentPort,workerData} from 'node:worker_threads';
import {inferStructures} from './structure-inference.mjs';
import {inferenceFailure} from './result.mjs';
import {encodeInference} from './shared-values.mjs';
try{parentPort.postMessage(encodeInference(inferStructures(workerData.plan,workerData.trace,workerData.options)));}
catch(error){parentPort.postMessage(inferenceFailure(error));}
