export const RELATION_SCHEMA_VERSION=1;
const states=new Set(['not-implemented','skipped','completed','partial','failed']);
const relationStates=new Set(['supported','ambiguous','insufficient','contradicted']);
const resultKeys=new Set(['schemaVersion','scope','status','relations','coverage','diagnostics']);
const requireResult=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'invalid-execution-relations'});};

export function relationResult(scope,status,{relations=[],diagnostics=[],coverage={}}={}){
  return {schemaVersion:RELATION_SCHEMA_VERSION,scope:{...scope},status,relations,coverage,diagnostics};
}
export function relationFailure(scope,error,code=error.code??'execution-relations-failed'){
  return relationResult(scope,'failed',{diagnostics:[{code,stage:'execution-relations',message:error.message??String(error)}]});
}

// Validate metadata references only; this is not a second C/IR validator or a
// claim that any proposed relation is semantically correct.
export function validateRelationResult(context,result){
  requireResult(result?.schemaVersion===RELATION_SCHEMA_VERSION&&states.has(result.status),'알 수 없는 실행 관계 결과 형식입니다.');
  requireResult(Object.keys(result).every(key=>resultKeys.has(key)),'관계 결과에 실행 기록이나 정의되지 않은 필드를 추가할 수 없습니다.');
  requireResult(result.scope?.programId===context.scope.programId&&result.scope?.runId===context.scope.runId,'다른 실행의 관계 결과입니다.');
  requireResult(Array.isArray(result.relations)&&Array.isArray(result.diagnostics),'관계·진단 목록이 필요합니다.');
  requireResult(!['not-implemented','skipped','failed'].includes(result.status)||result.relations.length===0,'미구현·미실행·실패 결과에 판정된 관계를 넣을 수 없습니다.');
  const ids=new Set();
  for(const r of result.relations){
    requireResult(typeof r.id==='string'&&r.id&&!ids.has(r.id),'관계 식별자가 없거나 중복되었습니다.');ids.add(r.id);
    requireResult(typeof r.kind==='string'&&r.kind&&relationStates.has(r.status),'관계 종류·상태가 필요합니다.');
    const available=context.position(r.availableAtExecutionId);
    requireResult(available!==undefined,'관계 성립 시점이 실제 사건에 연결되지 않았습니다.');
    for(const key of ['supportingExecutionIds','contradictingExecutionIds']){
      requireResult(Array.isArray(r[key]),`${key} 목록이 필요합니다.`);
      for(const id of r[key])requireResult(context.position(id)!==undefined&&context.position(id)<=available,'성립 시점 이후이거나 존재하지 않는 근거를 사용할 수 없습니다.');
    }
    requireResult(r.status==='insufficient'||r.supportingExecutionIds.length>0,'판정에는 관찰 근거가 필요합니다.');
    requireResult(r.status!=='contradicted'||r.contradictingExecutionIds.length>0,'반례 판정에는 반례 사건이 필요합니다.');
    requireResult(Array.isArray(r.activationIds)&&r.activationIds.every(id=>context.frame(id)),'관계의 호출 프레임이 존재하지 않습니다.');
    requireResult(Array.isArray(r.participants)&&(r.participants.length>0||r.kind==='activation-call'&&r.activationIds.length===2),'참여 저장 범위가 필요합니다. 호출 관계는 두 프레임만으로 성립할 수 있습니다.');
    for(const p of r.participants){
      const object=context.object(p.objectId);
      requireResult(typeof p.role==='string'&&p.role&&object&&Number.isSafeInteger(p.offset)&&p.offset>=0&&Number.isSafeInteger(p.size)&&p.size>0&&Number.isSafeInteger(p.offset+p.size)&&p.offset+p.size<=object.size,'참여 대상이 실제 객체 범위를 벗어났습니다.');
    }
  }
  const byId=new Map(result.relations.map(r=>[r.id,r]));
  const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
  for(const r of result.relations){
    const evidence=id=>context.event(id)&&context.position(id)<=context.position(r.availableAtExecutionId)&&r.supportingExecutionIds.includes(id);
    const reference=id=>{
      const other=byId.get(id);
      requireResult(other&&context.position(other.availableAtExecutionId)<=context.position(r.availableAtExecutionId),'하위 관계가 없거나 아직 성립하지 않았습니다.');return other;
    };
    if(r.kind==='activation-call'){
      const call=context.event(r.callExecutionId),entry=context.event(r.entryExecutionId),child=context.frame(r.calleeActivationId);
      requireResult(evidence(call?.eventId)&&evidence(entry?.eventId)&&call.kind==='FLOW'&&call.action==='call'&&entry.action==='frame.begin'&&
        call.activationId===r.callerActivationId&&entry.activationId===child?.id&&child.parent===r.callerActivationId&&
        call.resolvedFunctionId===child.functionId&&context.position(call.eventId)<context.position(entry.eventId),'호출 관계의 실제 진입 연결이 없습니다.');
    }
    if(r.kind==='pointer-argument'){
      const event=context.event(r.availableAtExecutionId),ref=event?.value?.reference,object=context.object(r.reference?.objectId);
      requireResult(evidence(event?.eventId)&&event.action==='argument'&&event.callExecutionId===r.callExecutionId&&event.parameterIndex===r.parameterIndex&&
        same(event.target,r.participants[0])&&object&&ref?.targetObjectId===object.id&&ref.targetOffset===r.reference.offset&&
        r.reference.offset>=0&&r.reference.offset<=object.size,'포인터 인자 관계가 실제 참조와 다릅니다.');
    }
    if(r.kind==='storage-access'){
      const event=context.event(r.accessExecutionId),target=r.mode==='read'&&event?.action==='copy'?
        {objectId:event.sourceObjectId,offset:event.sourceOffset,size:event.sourceSize}:event?.target;
      requireResult(evidence(event?.eventId)&&['read','write'].includes(r.mode)&&same(target,r.participants[0]),'접근 관계가 관찰된 저장 범위와 다릅니다.');
    }
    if(r.kind==='storage-copy'){
      const write=context.event(r.writeExecutionId),read=context.event(r.readExecutionId);
      const source=read?.target??{objectId:write?.sourceObjectId,offset:write?.sourceOffset,size:write?.sourceSize};
      requireResult(evidence(write?.eventId)&&write.kind==='WRITE'&&same(write.target,r.participants[1])&&same(source,r.participants[0])&&
        r.participants[0].size===r.participants[1].size&&
        (r.mechanism==='read-write-provenance'?evidence(read?.eventId)&&read.kind==='READ'&&context.position(read.eventId)<context.position(write.eventId):
          r.mechanism==='recorded-memory-copy'&&write.action==='copy'),'복사 관계의 실제 읽기·쓰기 연결이 없습니다.');
    }
    if(r.kind==='copy-sequence'){
      requireResult(Array.isArray(r.transferIds)&&r.transferIds.length>1&&new Set(r.transferIds).size===r.transferIds.length,'복사 순서의 고유 전달 목록이 필요합니다.');
      let position=-1;
      for(const id of r.transferIds){const copy=reference(id),next=context.position(copy.writeExecutionId);
        requireResult(copy.kind==='storage-copy'&&next>position&&copy.participants[0].objectId===r.sourceObjectId&&copy.participants[1].objectId===r.destinationObjectId,'복사 순서·저장소 연결이 다릅니다.');position=next;}
    }
    if(r.kind==='range-relation'){
      const left=reference(r.leftRelationId),right=reference(r.rightRelationId);
      requireResult(left.kind==='activation-range'&&right.kind==='activation-range'&&left.objectId===r.objectId&&right.objectId===r.objectId&&
        ['equal','contains','within','overlap','disjoint'].includes(r.relationship),'구간 관계의 실제 범위 연결이 없습니다.');
    }
  }
  return result;
}
