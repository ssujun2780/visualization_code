import {Worker} from "node:worker_threads";
import {recordIR} from "./ir-record.mjs";
import {validateSource} from "./compile.mjs";

export function traceModel(source,options={}){return runWorker(source,options,"trace");}
export function compileCToIR(source,options={}){return runWorker(source,options,"compile");}

function runWorker(source,{timeoutMs=25000,...options}={},mode) {
  validateSource(source);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error("시간 제한은 100~120000ms여야 합니다.");
  if(options.maxEvents!==undefined&&(!Number.isInteger(options.maxEvents)||options.maxEvents<1||options.maxEvents>1000000))throw new Error("사건 제한은 1~1000000개여야 합니다.");
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./worker.mjs",import.meta.url),{workerData:{source,options,mode},execArgv:[]});
    let prepared={},events=[],done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();resolve(result);};
    const fail=error=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();reject(error);};
    const timer=setTimeout(()=>{
      try {
      const diagnostic={code:"time-limit",message:"컴파일·실행 시간 제한에 도달했습니다. 기록은 마지막 전달된 사건까지 보존됩니다."};
      const event={schemaVersion:2,eventId:`e${events.length+1}`,kind:"ERROR",phase:"fault",diagnostic,evidence:"observer"};
      const observedTrace={schemaVersion:2,status:"limited",exitCode:null,events:[...events,event],diagnostics:[diagnostic],objects:[],frames:[],coverage:{termination:"worker deadline",tail:"up to 255 observations may be unflushed"}};
      const trace=prepared.plan?recordIR(prepared.plan,prepared.observationPlan,observedTrace):
        {...observedTrace,schemaVersion:3,events:[{...event,schemaVersion:3,eventId:"x1",executionId:"x1",action:"fault",phase:"failed"}]};
      const {observationPlan,type,...info}=prepared;
      finish({...info,stdout:"",stderr:"",compilerDiagnostics:"",trace,...(options.includeObservations?{observations:{plan:observationPlan??null,trace:observedTrace}}:{})});
      }catch(error){fail(error);}
    },timeoutMs);
    worker.on("message",message=>{if(message.type==="prepared")prepared=message;if(message.type==="observations")events.push(...message.events);
      if(message.type==="result")finish(message.result);if(message.type==="failure")fail(new Error(message.message));});
    worker.on("error",fail);
    worker.on("exit",code=>{if(!done)fail(new Error(`계측 작업이 예기치 않게 종료됐습니다 (${code}).`));});
  });
}
