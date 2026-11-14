// Presentation summaries of existing IR effects. Never execute a library
// function again, identify an operation by variable names, or add IR events.
export function externalCallForEvent(recording,event) {
  if(!event)return null;
  const ids=[event.action==='call'?event.eventId:event.callExecutionId,
    ...(event.inputs??[]).map(i=>recording.events.get(i.executionId)?.callExecutionId)];
  for(const id of ids){const call=recording.calls.get(id);if(call&&!call.frameId)return call.event;}
  return null;
}

export function inputForEffect(recording,event) {
  if(!event?.callExecutionId)return null;
  return (event.dataInputs??[]).map(id=>recording.events.get(id)).find(e=>
    e?.kind==='READ'&&e.action==='input'&&e.callExecutionId===event.callExecutionId)??null;
}

export function effectForEvent(recording,event) {
  if(!event)return null;
  const call=externalCallForEvent(recording,event),name=call?.resolvedFunctionName??call?.callee?.replace(/^@/,'')??'';
  const object=recording.objects.get(event.objectId??event.target?.objectId);
  let kind,detail;
  if(event.kind==='SPACE'&&object?.storage==='heap') {
    if(event.action==='object.begin') {
      kind=event.copiedFrom?'reallocate':'allocate';
      const old=recording.objects.get(event.copiedFrom?.objectId);
      const sameAddress=old?.address!=null&&event.address!=null&&BigInt(old.address)===BigInt(event.address);
      detail=old?`${old.size} → ${event.size} B · ${event.copiedFrom.size} B 보존 · ${sameAddress?'주소 유지':'주소 변경'}`
        :`${event.size} B · ${event.initialized?'0으로 초기화':'미초기화'}`;
    } else if(event.action==='object.end'){kind='release';detail=`${object.size} B · ${event.reason==='realloc-replaced'?'재할당으로 기존 저장소 종료':'저장소 해제'}`;}
  } else if(event.action==='copy') {
    kind='copy';
    const a=event.sourceOffset??0,b=event.target?.offset??0,n=event.target?.size??0;
    const overlap=event.sourceObjectId===event.target?.objectId&&a<b+n&&b<a+n;
    detail=`${n} B ${overlap?'겹치는 범위 복사':'복사'}${event.includesNullTerminator?' · 끝 문자 포함':''}`;
  } else if(event.action==='fill'){kind='fill';detail=`${event.target?.size??0} B · 바이트 ${event.byte}로 채우기`;}
  else if(event.kind==='WRITE'&&event.target&&['write.range','input'].includes(event.action)) {
    kind=inputForEffect(recording,event)||event.action==='input'?'input-store':'buffer-store';
    detail=`${event.target.size} B · ${kind==='input-store'?'입력값 저장':'호출 결과를 버퍼에 저장'}`;
  } else if(event.action==='output'){kind='output';detail=`${event.channel??'stdout'} · ${event.byteLength??0} B 출력`;}
  else if(event.kind==='READ'&&event.action==='input'){kind='input';detail=event.inputStage==='buffer-read'?'입력 버퍼에서 읽기':`${event.byteLength??0} B 입력 도착`;}
  else if(call&&event.action==='resume'){kind='result';detail='호출 결과';}
  else if(call&&event.action==='call'){kind='call';detail='호출';}
  if(!kind)return null;
  return {kind,name,detail,target:event.target,sourceObjectId:event.sourceObjectId,callExecutionId:call?.eventId};
}

export function streamText(state,channel='all') {
  return channel==='all'?state.output:state.outputByChannel?.get(channel)??'';
}

export function ioDisplayState(player,valueReady,effectReady) {
  const e=player.event;
  return player.progress>0&&(e?.action==='output'&&valueReady||e?.kind==='READ'&&e.action==='input'&&effectReady)?player.after:player.state;
}
