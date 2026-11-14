import {PreparedStructures} from './prepared-state.js';
export function preparePlayback(plan,trace,inference,{signal,onProgress=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./prepared-worker.js',import.meta.url),{type:'module'});let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(new PreparedStructures(value));},
      abort=()=>finish(Object.assign(new Error('시각화 준비가 취소되었습니다.'),{name:'AbortError'})),timer=setTimeout(()=>finish(new Error('자료구조 재생 준비 시간이 초과되었습니다.')),180000);
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.type==='progress')onProgress(data);if(data.type==='ready')finish(null,data.prepared);if(data.type==='failure')finish(new Error(data.message));};
    worker.onerror=e=>finish(new Error(e.message||'자료구조 재생 준비 실패'));
    worker.postMessage({plan,trace,inference});
  });
}
