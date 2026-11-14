import {AvoidLib} from 'libavoid-js';
import {PointerWiring} from './pointer-wiring.js';
import {PresentationHistory} from './presentation-history.js';
import {createRecording} from './playback.js';
import {PreparedStructures} from './prepared-state.js';

let wiring;
let history,historyEpoch,frameRequest,pumping=false,recordingPayload,preparedPayload;
const setups=new Map();
const ready = AvoidLib.load(new URL('../../node_modules/libavoid-js/dist/libavoid.wasm', import.meta.url).href)
  .then(() => { wiring = new PointerWiring(AvoidLib.getInstance(), {measureQuality: false}); });
self.onmessage = async ({data}) => {
  if(data.type==='frame'){
    if(data.setup){
      recordingPayload=data.recording??recordingPayload;
      if(Object.hasOwn(data,'preparedData'))preparedPayload=data.preparedData;
      setups.set(data.epoch,{...data.setup,recording:recordingPayload,preparedData:preparedPayload});
    }
    frameRequest=data;void pumpFrames();return;
  }
  try {
    await ready;
    if (data.reset) { wiring.dispose(); wiring = new PointerWiring(AvoidLib.getInstance(), {measureQuality: false}); return; }
    self.postMessage({key: data.key, result: wiring.update(data.graph)});
  } catch (error) { self.postMessage({key: data.key, error: error.message}); }
};

async function pumpFrames(){
  if(pumping)return;pumping=true;
  try{
    await ready;
    while(frameRequest){
      const request=frameRequest;frameRequest=null;
      try{
        if(historyEpoch!==request.epoch){
          const setup=setups.get(request.epoch);if(!setup)throw new Error('표시 이력의 초기 설정이 없습니다.');
          history?.dispose();
          const prepared=setup.preparedData?new PreparedStructures(setup.preparedData):null;
          if(prepared){prepared.choices=new Map(setup.choices??[]);prepared.options=new Map(setup.options??[]);}
          history=new PresentationHistory(createRecording(setup.recording.plan,setup.recording.trace),{prepared,preferences:setup.preferences,viewport:setup.viewport},new PointerWiring(AvoidLib.getInstance(),{measureQuality:false}));
          historyEpoch=request.epoch;setups.clear();
        }
        while(!history.prepare(request.cursor)){
          self.postMessage({type:'frame-progress',epoch:request.epoch,edit:request.edit,cursor:request.cursor,done:history.next,total:request.cursor+1});
          await new Promise(resolve=>setTimeout(resolve,0));
          if(frameRequest)break;
        }
        if(frameRequest)continue;
        const overlay=request.preferences?history.revise(request.cursor,request.preferences,()=>new PointerWiring(AvoidLib.getInstance(),{measureQuality:false})):null;
        self.postMessage({type:'frame',epoch:request.epoch,edit:request.edit,overlay,...history.result(request.cursor,request.known)});
      }catch(error){self.postMessage({type:'frame',epoch:request.epoch,edit:request.edit,cursor:request.cursor,error:error.message});}
    }
  }catch(error){const request=frameRequest;frameRequest=null;self.postMessage({type:'frame',epoch:request?.epoch??historyEpoch,edit:request?.edit,cursor:request?.cursor,error:error.message});}
  finally{pumping=false;}
}
