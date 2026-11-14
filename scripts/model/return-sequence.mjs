// Source/animation IR closes a function field after its returned value reaches
// the recorded receiver. C execution and raw lifetime observations stay intact.
import {inputSourceIds} from '../shared/address-origin.mjs';
const unique=a=>[...new Set(a)];
const referenceKeys=new Set(['eventId','executionId','dataInputs','addressInputs','controlInputs','calleeInputs','storageDataInputs']);
const location=e=>({executionId:e.eventId,instructionId:e.instructionId,activationId:e.activationId,
  kind:e.kind,action:e.action,...(e.target?{target:structuredClone(e.target)}:{})});
const overlaps=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;

export function returnTransfers(events,deliveries,plan){
  const byId=new Map(events.map(e=>[e.eventId,e])),positions=new Map(events.map((e,i)=>[e.eventId,i])),
    uses=new Map(),argumentsByCall=new Map(),ends=new Map(events.filter(e=>e.action==='frame.end').map(e=>[e.frameId,e])),
    definitions=new Map((plan?.instructions??[]).map(d=>[d.id,d]));
  for(const e of events){
    if(e.phase!=='complete'||e.kind==='SPACE')continue;
    for(const id of unique([...(e.inputs??[]).flatMap(inputSourceIds),...e.addressInputs??[],...e.calleeInputs??[]].filter(Boolean))){
      if(!uses.has(id))uses.set(id,[]);uses.get(id).push(e);
    }
    if(e.action==='argument'&&e.callExecutionId){if(!argumentsByCall.has(e.callExecutionId))argumentsByCall.set(e.callExecutionId,[]);argumentsByCall.get(e.callExecutionId).push(e);}
  }
  const result=[];
  for(const delivery of deliveries){
    const returned=byId.get(delivery.returnExecutionId),end=ends.get(returned?.activationId);
    if(!returned||!end)continue;
    const receivers=new Map(),visited=new Set();
    function consume(first,source){
      const queue=[{event:first,producer:source}];
      for(let i=0;i<queue.length;i++){
      const {event,producer}=queue[i];
      if(!event||visited.has(event.eventId)||event.phase!=='complete'||event.action==='resume'||event.action==='return')continue;
      visited.add(event.eventId);
      if(event.kind==='CALC'){
        const next=(uses.get(event.eventId)??[]).filter(e=>positions.get(e.eventId)>positions.get(event.eventId));
        if(next.length){for(const e of next)queue.push({event:e,producer:event.eventId});continue;}
      }
      if(event.action==='call'){
        const parameters=(argumentsByCall.get(event.eventId)??[]).filter(e=>(e.inputs??[]).some(i=>inputSourceIds(i).includes(producer)));
        if(parameters.length){for(const e of parameters)queue.push({event:e,producer});continue;}
      }
      receivers.set(event.eventId,location(event));
      }
    }
    if(!['void','discarded','not-returned'].includes(delivery.status)){
      for(const use of [delivery.consumer,...delivery.addressUses??[],...delivery.calleeUses??[]])if(use)consume(byId.get(use.executionId),delivery.resumeExecutionId);
      if(delivery.storageDelivery){
        const value=byId.get(delivery.returnValueExecutionId),source={objectId:value?.sourceObjectId,offset:value?.sourceOffset,size:value?.sourceSize},
          call=definitions.get(delivery.callInstructionId),
          copy=events.find(e=>e.kind==='WRITE'&&e.action==='copy'&&e.activationId===delivery.callerActivationId&&
            positions.get(e.eventId)>positions.get(delivery.resumeExecutionId)&&(()=>{
              const d=definitions.get(e.instructionId),from=e.copiedFrom??{objectId:e.sourceObjectId,offset:e.sourceOffset,size:e.sourceSize};
              return d?.functionId===call?.functionId&&d?.source?.file===call?.source?.file&&
                d?.source?.start?.byte<=call?.source?.start?.byte&&d?.source?.end?.byte>=call?.source?.end?.byte&&
                [source,delivery.storageDelivery.target].some(s=>overlaps(from,s))&&
                delivery.storageDelivery.writtenByExecutionIds.some(id=>e.dataInputs?.includes(id));
            })());
        if(copy)consume(copy,delivery.resumeExecutionId);
        else receivers.set(value.eventId,{...location(value),target:delivery.storageDelivery.target,role:'return-storage'});
      }
    }
    const destinations=[...receivers.values()].sort((a,b)=>positions.get(a.executionId)-positions.get(b.executionId)),
      last=destinations.at(-1)?.executionId??null;
    result.push({callExecutionId:delivery.callExecutionId,returnExecutionId:returned.eventId,
      returnValueExecutionId:delivery.returnValueExecutionId,resumeExecutionId:delivery.resumeExecutionId,
      frameEndExecutionId:end.eventId,status:delivery.status,receivers:destinations,completionExecutionId:last,
      evidence:'observed result operands, calculation consumers, parameter writes and return-storage copies'});
  }
  return result;
}

// Remap execution references only. Source text, literals, AST/LLVM IDs and raw
// observation IDs are not execution references even if their text is "x22".
export function remapExecutionReferences(value,mapping,seen=new WeakSet()){
  if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
  for(const [key,child]of Object.entries(value)){
    if(referenceKeys.has(key)||/ExecutionIds?$/.test(key)){
      if(typeof child==='string')value[key]=mapping.get(child)??child;
      else if(Array.isArray(child))value[key]=child.map(id=>typeof id==='string'?mapping.get(id)??id:id);
    }
    remapExecutionReferences(value[key],mapping,seen);
  }
}

export function orderReturnCleanup(events,deliveries,plan,{running=false}={}){
  const positions=new Map(events.map((e,i)=>[e.eventId,i])),byId=new Map(events.map(e=>[e.eventId,e])),
    transfers=returnTransfers(events,deliveries,plan),pending=new Map(),moved=new Set();
  for(const [i,e]of events.entries())e.recordedOrder=i;
  for(const transfer of transfers){
    const returned=byId.get(transfer.returnExecutionId),end=byId.get(transfer.frameEndExecutionId),after=transfer.completionExecutionId;
    // A suspended execution has not necessarily reached the return consumer.
    // Keep cleanup pending rather than publishing an end that must later move
    // backwards in the already displayed prefix. Raw lifetimes stay intact.
    if(running&&!after&&!['void','discarded','not-returned'].includes(transfer.status)){
      returned.cleanupPending=true;moved.add(end.eventId);continue;
    }
    returned.delivery=structuredClone(transfer);
    if(after&&positions.get(after)>positions.get(end.eventId)){
      end.cleanupAfterExecutionId=after;end.returnExecutionId=returned.eventId;end.callExecutionId=transfer.callExecutionId;
      if(!pending.has(after))pending.set(after,[]);pending.get(after).push(end);moved.add(end.eventId);
    }
  }
  const ordered=[];
  for(const e of events){if(!moved.has(e.eventId))ordered.push(e);for(const end of pending.get(e.eventId)??[])ordered.push(end);}
  events.length=0;for(const e of ordered)events.push(e);
  const mapping=new Map(events.map((e,i)=>[e.eventId,`x${i+1}`]));
  remapExecutionReferences(events,mapping);
  return mapping;
}

export function validateReturnSequence(trace,plan){
  // Old imported recordings remain readable; freshly generated IR declares
  // this contract through recordedOrder, not a UI-specific feature switch.
  if(!trace.events.some(e=>Number.isInteger(e.recordedOrder)))return;
  const byId=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  for(const transfer of returnTransfers(trace.events,trace.resultDeliveries??[],plan)){
    const returned=byId.get(transfer.returnExecutionId),end=byId.get(transfer.frameEndExecutionId),at=positions.get(end.eventId);
    if(JSON.stringify(returned.delivery)!==JSON.stringify(transfer))throw new Error('반환 전달의 수신 위치 또는 정리 연결이 올바르지 않습니다.');
    if(transfer.completionExecutionId&&positions.get(transfer.completionExecutionId)>=at)
      throw new Error('반환값 전달보다 함수 공간 정리가 앞서 있습니다.');
    if(end.cleanupAfterExecutionId&&end.cleanupAfterExecutionId!==transfer.completionExecutionId)
      throw new Error('함수 공간 정리의 선행 전달 사건이 다릅니다.');
  }
}
