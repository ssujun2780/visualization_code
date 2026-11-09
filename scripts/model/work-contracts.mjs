// Shared observed-work invariants. These validate recorded facts, not C semantics.
const memoryActions=new Set(['read','write','copy','fill','write.range']);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const hex=s=>typeof s==='string'&&/^(?:[0-9a-f]{2})*$/i.test(s);
const incompleteExecution=trace=>trace.coverage?.execution==='not started'||['limited','engine-error'].includes(trace.status);

export function inspectWorkTrace(plan,trace){
  const issues=[],events=new Map(trace.events.map((e,i)=>[e.eventId,{event:e,index:i}])),
    objects=new Map((trace.objects??[]).map(o=>[o.id,o])),frames=new Map((trace.frames??[]).map(f=>[f.id,f]));
  const ledgerAvailable=objects.size>0||!incompleteExecution(trace);
  const issue=(code,event,detail)=>issues.push({code,eventId:event?.eventId??null,detail});
  function snapshot(s,event,expectedSize){
    if(!s||s.format!=='memory-ranges-v1'||!safe(s.byteLength)||!Array.isArray(s.ranges)||s.byteLength!==expectedSize){
      issue('memory-snapshot-shape',event,'range snapshot does not match recorded storage extent');return;
    }
    let cursor=0,complete=true;
    for(const r of s.ranges){
      if(r.offset!==cursor||!safe(r.length)||r.offset+r.length>s.byteLength||!['initialized','uninitialized','unobserved'].includes(r.initialization))
        issue('memory-snapshot-range',event,'noncontiguous or invalid initialization range');
      cursor=r.offset+r.length;
      if(r.data){
        if(r.initialization!=='initialized'||(r.data.encoding==='hex'?(!hex(r.data.bytesHex)||r.data.bytesHex.length!==2*r.length):
          r.data.encoding!=='fill'||!Number.isInteger(r.data.byte)||r.data.byte<0||r.data.byte>255))
          issue('memory-snapshot-value',event,'bytes do not match initialized range');
      }else if(r.initialization==='initialized'&&!r.reason)issue('memory-snapshot-omission',event,'missing initialized bytes without an omission reason');
      complete&&=r.initialization!=='unobserved'&&(r.initialization!=='initialized'||!!r.data);
    }
    if(cursor!==s.byteLength||s.complete!==complete)issue('memory-snapshot-completeness',event,'snapshot completeness disagrees with recorded ranges');
  }
  function range(target,event,index){
    if(!ledgerAvailable)return;
    const object=objects.get(target?.objectId);
    if(!object){issue('memory-target',event,`memory operation has no recorded storage object: ${JSON.stringify(target??null)}`);return;}
    if(!safe(target.offset)||!safe(target.size)||target.offset+target.size>object.size)
      issue('memory-range',event,'memory operation exceeds its storage object');
    const begin=events.get(object.createdBy),end=events.get(object.endedBy);
    if(!begin||begin.index>index||end&&end.index<=index)issue('memory-lifetime',event,'memory operation is outside the recorded object lifetime');
    if(Number.isInteger(event.recordedOrder)&&end&&Number.isInteger(end.event.recordedOrder)&&end.event.recordedOrder<=event.recordedOrder)
      issue('runtime-memory-lifetime',event,'deferred field cleanup cannot extend the observed runtime memory lifetime');
    if(target.address&&safe(object.address)&&/^0x[0-9a-f]+$/i.test(target.address)&&Number(BigInt(target.address))!==object.address+target.offset)
      issue('memory-address',event,'address does not match object and offset');
  }
  for(const [index,event]of trace.events.entries()){
    for(const key of ['dataInputs','addressInputs','controlInputs','calleeInputs'])for(const id of event[key]??[]){
      const producer=events.get(id);
      if(!producer||producer.index>=index)issue('work-dependency-order',event,`${key} references missing or future work: ${id}`);
    }
    if(event.phase!=='complete')continue;
    if(['READ','WRITE'].includes(event.kind)&&memoryActions.has(event.action)){
      range(event.storageTarget??event.target,event,index);
      if(['read','write'].includes(event.action)&&!event.value)issue('memory-value',event,'scalar access has no captured value');
      if(['copy','fill','write.range'].includes(event.action))snapshot(event.memoryState,event,event.target?.size);
    }
    if(event.kind==='WRITE'&&event.action==='output'){
      if(typeof event.channel!=='string'||!safe(event.byteLength)||!hex(event.bytesHex)||event.bytesHex.length!==2*event.byteLength)
        issue('output-bytes',event,'output channel or exact observed byte payload is missing');
    }
    if(event.kind==='SPACE'&&event.action==='object.begin'){
      const object=objects.get(event.objectId);
      if(ledgerAvailable&&(!object||object.createdBy!==event.eventId||!safe(event.size)||event.size!==object.size))
        issue('object-begin',event,'object creation and storage ledger disagree');
      if(event.memoryState)snapshot(event.memoryState,event,event.size);
    }
    if(event.kind==='SPACE'&&event.action==='object.end'){
      if(ledgerAvailable&&objects.get(event.objectId)?.endedBy!==event.eventId)issue('object-end',event,'object end is missing from storage ledger');
    }
    if(event.kind==='SPACE'&&['frame.begin','frame.end'].includes(event.action)){
      if(ledgerAvailable&&(!frames.has(event.frameId)||event.frameId!==event.activationId))issue('frame-identity',event,'call frame identity is missing or inconsistent');
      for(const id of ledgerAvailable?event.endedObjects??[]:[])if(objects.get(id)?.endedBy!==event.eventId||objects.get(id)?.frameId!==event.frameId)
        issue('frame-cleanup',event,'frame cleanup and object lifetime disagree');
    }
    if(event.kind==='FLOW'&&event.action==='call'&&(typeof event.callee!=='string'||!Array.isArray(event.arguments)))
      issue('call-operands',event,'call target or source arguments are missing');
    if(event.kind==='FLOW'&&event.action==='conditional'){
      const e=event.evaluation,truth=e?.conditionTruth,selected=truth?'true':'false';
      if(e?.kind!=='conditional'||typeof truth!=='boolean'||e.selected!==selected||e.skipped===(e.selected)||
        e.skipped!==(truth?'false':'true')||event.selectedOutcome!==selected||
        event.condition?.decimal!==(truth?'1':'0')||!/^0x[0-9a-f]+$/i.test(event.condition?.bits??'')||
        BigInt(event.condition.bits)!==(truth?1n:0n)||!event.condition.cType||
        !e.decisionExecutionIds?.includes(event.eventId))issue('conditional-selection',event,'selected branch and observed C truth are incomplete or inconsistent');
    }
  }
  // Truncated worker transport can intentionally have no object/frame summary.
  // Such a result remains limited/engine-error; it cannot establish lifetime correctness.
  if(!incompleteExecution(trace))for(const object of objects.values()){
    const begin=events.get(object.createdBy),end=events.get(object.endedBy);
    if(!begin||object.endedBy&&(!end||end.index<begin.index))issue('object-ledger-order',begin?.event,'storage creation/end history is incomplete');
  }
  for(const object of objects.values())if(object.storageAlias){
    const alias=object.storageAlias,backing=objects.get(alias.objectId),root=objects.get(alias.rootObjectId),begin=events.get(object.createdBy);
    if(!backing||!root||!safe(alias.offset)||alias.offset+object.size>backing.size||
      object.address!==backing.address+alias.offset||alias.size!==object.size||
      events.get(backing.createdBy)?.index>=begin?.index||alias.rootObjectId!==(backing.storageAlias?.rootObjectId??backing.id))
      issue('source-storage-alias',begin?.event,'source lifetime and shared physical storage binding disagree');
  }
  for(const frame of frames.values())if(frame.callbackOfCallExecutionId){
    const call=events.get(frame.callbackOfCallExecutionId)?.event;
    if(call?.action!=='call'||call.kind!=='FLOW'||call.activationId!==frame.parent)
      issue('callback-owner',call,'callback frame has no matching public caller');
  }
  return issues;
}

export function validateWorkTrace(plan,trace){
  const issues=inspectWorkTrace(plan,trace);
  if(issues.length){const first=issues[0],error=new Error(`중간언어 작업 계약 위반: ${first.code} (${first.eventId??'ledger'}): ${first.detail}`);
    error.code='ir-work-contract';error.eventId=first.eventId;error.context={contract:first.code,detail:first.detail};throw error;}
  trace.coverage??={};trace.coverage.workContracts={scope:'observed payload, storage range/lifetime, dependency order, output bytes and conditional decision',
    storageLedger:(trace.objects?.length||!incompleteExecution(trace))?'checked':'unavailable',
    semanticCompleteness:'not established by structural validation'};
  return trace;
}
