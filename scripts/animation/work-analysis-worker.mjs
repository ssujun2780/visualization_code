import {parentPort,workerData} from 'node:worker_threads';
import {analyzeRecordingWork} from './work-analysis.mjs';
try{parentPort.postMessage(analyzeRecordingWork(workerData.plan,workerData.trace,workerData.options));}
catch(error){parentPort.postMessage({schemaVersion:1,scope:{programId:workerData.plan.programId,runId:workerData.trace.runId},
  relations:null,diagnostics:[{stage:'work-analysis',message:error.message}]});}
