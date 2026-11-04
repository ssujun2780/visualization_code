// Only one worker job at a time; edits replace pending work, never queue it.
export function createLiveDiagnostics({createWorker,publish,status,delay=500,timeout=30000,
  setTimer=setTimeout,clearTimer=clearTimeout}){
  let worker,current=0,pending,ready=false,busy=null,debounce,deadline,disposed=false;
  const stop=()=>{worker?.terminate();worker=null;busy=null;clearTimer(deadline);};
  function pump(){
    if(disposed||busy||!ready||!pending)return;
    const job=pending;ready=false;busy=job.id;status('checking');
    try{
      if(!worker){
        worker=createWorker();
        const instance=worker;
        worker.onmessage=({data})=>{
          if(worker!==instance)return;
          if(data.id!==busy||!['result','failed'].includes(data.type))return;
          clearTimer(deadline);busy=null;
          if(data.id===current){
            if(data.type==='result'){publish(data.items);status('done',data.items);}
            else status('failed',data.message);
          }
          pump();
        };
        worker.onerror=event=>{if(worker!==instance)return;const id=busy;stop();if(id===current)status('failed',event.message||'자동 검사 중 오류가 발생했습니다.');pump();};
      }
      deadline=setTimer(()=>{const id=busy;stop();if(id===current)status('failed','자동 검사 시간이 초과되었습니다.');pump();},timeout);
      worker.postMessage(job);
    }catch(error){stop();status('failed',error.message);}
  }
  return {
    update(code){
      if(disposed)return;
      pending={id:++current,code};ready=false;clearTimer(debounce);publish([]);
      if(!code.trim()){status('idle');return;}
      status('waiting');debounce=setTimer(()=>{ready=true;pump();},delay);
    },
    dispose(){disposed=true;clearTimer(debounce);stop();}
  };
}
