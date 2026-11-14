import {parentPort,workerData} from 'node:worker_threads';
import {partialResult} from './partial-result.mjs';
parentPort.postMessage(partialResult(workerData.prepared,workerData.raw,workerData.options));
