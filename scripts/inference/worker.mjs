import {parentPort,workerData} from 'node:worker_threads';
import {inferStructures} from './structure-inference.mjs';
import {inferenceFailure} from './result.mjs';
try{parentPort.postMessage(inferStructures(workerData.plan,workerData.trace,workerData.options));}
catch(error){parentPort.postMessage(inferenceFailure(error));}
