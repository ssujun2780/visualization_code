import {Worker} from 'node:worker_threads';

// A stalled optional analysis must not consume the compiler/session deadline or
// discard an already recorded prefix. No analysis code runs on the API thread.
export function analyzeRecordingWorkAsync(plan,trace,{timeoutMs=8000,...options}={}){
  return new Promise(resolve=>{
    let worker,done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);void worker?.terminate();resolve(result);},
      failed=message=>finish({schemaVersion:1,scope:{programId:plan.programId,runId:trace.runId},relations:null,diagnostics:[{stage:'work-analysis',message}]});
    const timer=setTimeout(()=>failed('작업 관계 분석 시간 제한 · 원본 실행 기록은 유지됩니다.'),timeoutMs);
    try{worker=new Worker(new URL('./work-analysis-worker.mjs',import.meta.url),{workerData:{plan,trace,options},execArgv:[]});
      worker.once('message',finish);worker.once('error',error=>failed(error.message));worker.once('exit',()=>{if(!done)failed('작업 관계 분석이 결과 없이 종료되었습니다.');});
    }catch(error){failed(error.message);}
  });
}
