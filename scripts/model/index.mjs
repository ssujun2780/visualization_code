import {Worker} from "node:worker_threads";
import {partialResult} from "./partial-result.mjs";
import {validateSource} from "./compile.mjs";
export {describeLogicalWork} from './presentation-contract.mjs';
export {queryStorageReferences} from './storage-relations.mjs';
export {queryCoindexedRecords} from './coindexed-record-views.mjs';
export {recommendStructureViews,resolveStructurePresentation,setStructurePresentation,clearStructurePresentation,STRUCTURE_RECOMMENDATION_LIMIT} from './structure-presentation.mjs';

export function traceModel(source,options={}){return runWorker(source,options,"trace");}
export function compileCToIR(source,options={}){return runWorker(source,options,"compile");}

function runWorker(source,{timeoutMs=25000,...options}={},mode) {
  validateSource(source);
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error("시간 제한은 100~120000ms여야 합니다.");
  if(options.maxEvents!==undefined&&(!Number.isInteger(options.maxEvents)||options.maxEvents<1||options.maxEvents>1000000))throw new Error("사건 제한은 1~1000000개여야 합니다.");
  if(options.maxObservationBytes!==undefined&&(!Number.isInteger(options.maxObservationBytes)||options.maxObservationBytes<65536||options.maxObservationBytes>67108864))throw new Error('관찰 기록 바이트 제한은 65536~67108864여야 합니다.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./worker.mjs",import.meta.url),{workerData:{source,options,mode},execArgv:[]});
    let prepared={},events=[],state={},replayCheckpoint=null,done=false,interrupted=false;
    const finish=(result,interrupt=false)=>{if(done)return;done=true;clearTimeout(timer);if(interrupt)void worker.terminate();resolve(result);};
    const fail=error=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();reject(error);};
    const timer=setTimeout(()=>{
      try {
      interrupted=true;void worker.terminate();
      const diagnostic={code:"time-limit",message:"컴파일·실행·중간언어 변환 시간 제한에 도달했습니다. 기록은 마지막 전달된 사건까지 보존됩니다."};
      const event={schemaVersion:2,eventId:`e${events.length+1}`,kind:"ERROR",phase:"fault",diagnostic,evidence:"observer"};
      const observedTrace={schemaVersion:2,objects:[],frames:[],...state,status:"limited",exitCode:null,events:[...events,event],
        diagnostics:[...state.diagnostics??[],{...diagnostic,eventId:event.eventId}],coverage:{...state.coverage,termination:"worker deadline",tail:"last complete observer checkpoint",finalizationBudgetMs:2000}};
      if(!prepared.plan){finish(partialResult(prepared,observedTrace,options));return;}
      // Partial IR conversion also runs off the main thread, with its own
      // bounded finalization budget. A timeout must not start an unbounded sync
      // conversion in the caller or discard already delivered stream bytes.
      const prefix=replayCheckpoint&&events.length>replayCheckpoint.count?replayCheckpoint:null;
      const replay=prefix?{...observedTrace,...prefix.state,events:[...events.slice(0,prefix.count),{...event,eventId:`e${prefix.count+1}`}],
        diagnostics:[{...diagnostic,eventId:`e${prefix.count+1}`}],coverage:{...observedTrace.coverage,irPrefixObservations:prefix.count,retainedObservations:events.length,
          irTail:'retained in observations; bounded deadline finalization'}}:observedTrace;
      const recovery=new Worker(new URL('./recovery-worker.mjs',import.meta.url),{workerData:{prepared,raw:replay,
        options:{...options,...(prefix?{retainedRaw:observedTrace}:{})}},execArgv:[]});
      const fallback=()=>{void recovery.terminate();finish(partialResult(prepared,observedTrace,{...options,skipConversion:true}));};
      const recoveryTimer=setTimeout(fallback,2000);
      recovery.once('message',result=>{clearTimeout(recoveryTimer);finish(result);});
      recovery.once('error',()=>{clearTimeout(recoveryTimer);fallback();});
      }catch(error){fail(error);}
    },timeoutMs);
    worker.on("message",message=>{if(interrupted||done)return;if(message.type==="prepared"){
      prepared=message;replayCheckpoint={count:0,state:{objects:[],frames:[],views:[],references:[]}};
    }if(message.type==="observations"){
      events.push(...message.events);state=message.state??state;
      if(events.length<=8192&&(state.coverage?.observationBytes??0)<=4194304)replayCheckpoint={count:events.length,state};
    }
      if(message.type==="result")finish(message.result);if(message.type==="failure"){
        const {type,...details}=message;fail(Object.assign(new Error(message.message),details));
      }});
    worker.on("error",error=>{if(!interrupted)fail(error);});
    worker.on("exit",code=>{if(!done&&!interrupted)fail(new Error(`계측 작업이 예기치 않게 종료됐습니다 (${code}).`));});
  });
}
