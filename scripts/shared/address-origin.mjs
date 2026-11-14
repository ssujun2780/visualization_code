// An observed address may be folded into its consumer. It is not a public
// execution event, and its base/index inputs are not the address's producer.
export const addressOriginKeys=['dataInputs','addressInputs','controlInputs','calleeInputs'];
export const addressOriginOf=input=>input?.addressOrigin?.kind==='observed-address'?input.addressOrigin:null;
export function inputSourceIds(input){const a=addressOriginOf(input);return [...new Set([input?.executionId,...a?addressOriginKeys.flatMap(key=>a[key]??[]):[]].filter(Boolean))];}

export function assertAddressOrigin(input,{event,object,position,at,bindings}={}){
  if(!input?.addressOrigin)return;
  const a=input.addressOrigin,fail=()=>{throw new Error('생략된 주소 계산의 관측 출처 연결이 올바르지 않습니다.');};
  if(a.schemaVersion!==1||a.kind!=='observed-address'||typeof a.observationId!=='string'||
    typeof a.instructionId!=='string'||input.executionId!=null||!input.value)fail();
  if(a.observationKind==='elided-calculation'){
    if(a.observationId!==input.observationId||bindings&&!bindings[a.instructionId]?.administrative)fail();
  }else if(a.observationKind==='call-argument'){
    const call=event(a.observedAt?.executionId),source=call?.inputs?.find(i=>i.parameterIndex===a.parameterIndex),ref=source?.value?.reference,target=input.value.reference;
    if(!call||call.action!=='call'||!call.observationIds?.includes(a.observationId)||position(call.eventId)>at||input.observationId||
      !Number.isInteger(a.parameterIndex)||a.parameterIndex!==input.parameterIndex||!ref?.targetObjectId||
      ref.targetObjectId!==target?.targetObjectId||ref.targetOffset!==target?.targetOffset||
      bindings&&bindings[a.instructionId]?.roles?.['FLOW:call.begin']!==call.instructionId)fail();
  }else fail();
  for(const key of addressOriginKeys){if(!Array.isArray(a[key]))fail();
    for(const id of a[key])if(!event(id)||position(id)===undefined||position(id)>=at)fail();}
  const ref=input.value.reference;
  if(ref?.targetObjectId){const o=object(ref.targetObjectId);
    if(!o||!Number.isSafeInteger(ref.targetOffset)||position(o.createdBy)===undefined||position(o.createdBy)>at)fail();}
}
