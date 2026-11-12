import {parentPort,workerData} from 'node:worker_threads';
import {inferExecutionRelations} from './index.mjs';
parentPort.postMessage(inferExecutionRelations(workerData.plan,workerData.trace,workerData.options));
