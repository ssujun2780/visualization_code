// A returned value goes to its next observed operand slot. These annotations do
// not allocate storage, add work, or move call/return/cleanup events.
const unique=values=>[...new Set(values.filter(v=>v!==null&&v!==undefined))];
const operator=node=>node?.kind==='BinaryOperator'?/ '([^']+)'\s*$/.exec(node.details)?.[1]:null;
const transparent=node=>node?.kind==='ParenExpr'||node?.kind==='ImplicitCastExpr'&&
  /<(?:NoOp|LValueToRValue|FunctionToPointerDecay|ArrayToPointerDecay)>/.test(node.details);

export function bindResultDeliveries(plan,{nodes}){
  const byNode=new Map(nodes.map(n=>[n.id,n])),bySource=new Map(),resumeByCall=new Map();
  for(const d of plan.instructions){const list=bySource.get(d.sourceNodeId)??[];list.push(d);bySource.set(d.sourceNodeId,list);}
  for(const b of Object.values(plan.bindings??{}))if(b.roles?.['FLOW:call.begin']&&b.roles?.['FLOW:call.end'])
    resumeByCall.set(b.roles['FLOW:call.begin'],b.roles['FLOW:call.end']);
  const observedCalls=new Set(plan.instructions.filter(d=>d.kind==='FLOW'&&d.action==='call'&&d.bindingStatus!=='source-only').map(d=>d.sourceNodeId));
  plan.resultDeliveries=plan.instructions.filter(d=>d.kind==='FLOW'&&d.action==='call'&&
    (d.bindingStatus!=='source-only'||!observedCalls.has(d.sourceNodeId))).map(call=>{
    const projection=call.callProjection,disposition=projection?.returnDisposition??'unknown',node=byNode.get(call.sourceNodeId),
      resumeId=resumeByCall.get(call.id)??null;
    const result={callInstructionId:call.id,resumeInstructionId:resumeId,callNodeId:node?.id??null,
      returnDisposition:disposition,status:projection?.returnType?.kind==='void'?'void':disposition==='discarded'?'discarded':'unresolved',
      consumer:null,evidence:'compiler AST ancestry and existing source-work definitions'};
    if(result.status!=='unresolved'||!node)return result;
    const candidate=(owner,allowed,role,extra={})=>{
      let definitions=(bySource.get(owner.id)??[]).filter(d=>d.id!==call.id&&d.id!==resumeId&&allowed(d));
      if(definitions.some(d=>d.bindingStatus!=='source-only'))definitions=definitions.filter(d=>d.bindingStatus!=='source-only');
      if(!definitions.length)return false;
      result.status='candidate';result.consumer={sourceNodeId:owner.id,instructionIds:definitions.map(d=>d.id),role,...extra};return true;
    };
    if(candidate(node,d=>d.kind==='CALC'&&d.conditionTest,'condition'))return result;
    let child=node;
    while(child.parent){
      const parent=child.parent,index=parent.children.indexOf(child);
      if(transparent(parent)||operator(parent)===','&&index===1){child=parent;continue;}
      if(parent.kind==='ConditionalOperator'&&index>0){child=parent;continue;}
      if(parent.kind==='CallExpr'){
        candidate(parent,d=>d.kind==='FLOW'&&d.action==='call',index===0?'callee':'argument',index>0?{parameterIndex:index-1}:{});break;
      }
      if(parent.kind==='ReturnStmt'){candidate(parent,d=>d.action==='return.value','return-value');break;}
      if(candidate(parent,d=>d.kind==='CALC','value'))break;
      if(candidate(parent,d=>d.kind==='WRITE'&&d.action==='write','value'))break;
      if(candidate(parent,d=>d.kind==='FLOW'&&['branch','conditional','switch','assert.check'].includes(d.action),'condition'))break;
      // A dereference/index/member destination consumes an address. Continue
      // to a source boundary for a static hint without claiming a value slot.
      if(parent.kind==='UnaryOperator'&&/prefix '\*'/.test(parent.details)||['ArraySubscriptExpr','MemberExpr'].includes(parent.kind)){
        candidate(parent,d=>['READ','WRITE'].includes(d.kind),'address');break;
      }
      child=parent;
    }
    return result;
  });
  return plan;
}

const operandConsumer=e=>e.phase==='complete'&&(e.kind==='CALC'||e.kind==='WRITE'&&['write','return.value'].includes(e.action)||
  e.kind==='FLOW'&&['call','branch','conditional','switch','assert.check'].includes(e.action));
const consumerRole=e=>e.action==='call'?'argument':e.action==='return.value'?'return-value':e.kind==='FLOW'?'condition':'value';
const location=e=>({executionId:e.eventId,instructionId:e.instructionId,activationId:e.activationId,kind:e.kind,action:e.action,
  availableAtExecutionId:e.eventId,...(e.target?{target:structuredClone(e.target)}:{})});

export function buildResultDeliveries(plan,trace){
  const events=new Map(trace.events.map((event,index)=>[event.eventId,{event,index}])),resumes=new Map(),returns=new Map(),boundaries=new Map(),
    uses=new Map(),addresses=new Map(),callees=new Map(),sites=new Map((plan.resultDeliveries??[]).map(s=>[s.callInstructionId,s])),
    definitions=new Map(plan.instructions.map(d=>[d.id,d]));
  const add=(map,key,value)=>{const list=map.get(key)??[];list.push(value);map.set(key,list);};
  for(const event of trace.events){
    if(event.action==='resume'&&event.callExecutionId)resumes.set(event.callExecutionId,event);
    if(event.action==='return'&&event.callExecutionId)boundaries.set(event.callExecutionId,event);
    if(event.action==='return.value'&&event.callExecutionId)add(returns,event.callExecutionId,event);
    if(operandConsumer(event))for(const [inputIndex,input]of (event.inputs??[]).entries())
      if(input.executionId)add(uses,input.executionId,{event,inputIndex,input});
    if(event.phase==='complete'){
      for(const id of event.addressInputs??[])add(addresses,id,event);
      for(const id of event.calleeInputs??[])add(callees,id,event);
    }
  }
  function storedResult(call,returned){
    if(returned?.value?.kind!=='aggregate')return {delivery:null,reason:null};
    const hidden=definitions.get(call.instructionId)?.callProjection?.hiddenArguments?.filter(a=>a.role==='return-storage')??[];
    if(hidden.length!==1)return {delivery:null,reason:'aggregate return has no unique compiler return-storage slot'};
    const slot=hidden[0],argument=call.backendArguments?.[slot.abiIndex],address=argument?.address,
      size=returned.sourceSize,offset=returned.sourceOffset;
    if(!/^0x[0-9a-f]+$/i.test(address??'')||!/^0x[0-9a-f]+$/i.test(returned.sourceAddress??''))
      return {delivery:null,reason:'aggregate return storage address was not observed'};
    if(BigInt(address)!==BigInt(returned.sourceAddress))return {delivery:null,reason:'observed aggregate return range does not match the compiler return-storage argument'};
    if(!returned.sourceObjectId||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(size)||size<0||
      returned.memoryState?.byteLength!==size)return {delivery:null,reason:'aggregate return storage range or snapshot was not observed'};
    const writes=unique((returned.dataInputs??[]).filter(id=>{
      const record=events.get(id),e=record?.event,target=e?.target;
      return e?.kind==='WRITE'&&e.phase==='complete'&&target?.objectId===returned.sourceObjectId&&
        target.offset<offset+size&&target.offset+target.size>offset&&record.index>events.get(call.eventId).index&&record.index<events.get(returned.eventId).index;
    }));
    if(size&&!writes.length)return {delivery:null,reason:'aggregate return snapshot has no matching observed destination writes'};
    return {delivery:{kind:'abi-return-storage',abiParameterIndex:slot.abiIndex,
      target:{objectId:returned.sourceObjectId,address:returned.sourceAddress,offset,size},
      snapshotExecutionId:returned.eventId,availableAtExecutionId:returned.eventId,writtenByExecutionIds:writes,
      evidence:'compiler return-storage slot, observed destination address, return snapshot and existing writes'},reason:null};
  }
  return trace.events.filter(e=>e.kind==='FLOW'&&e.action==='call').map((call,index)=>{
    const resume=resumes.get(call.eventId),boundary=events.get(resume?.returnExecutionId)?.event??boundaries.get(call.eventId),
      returned=(returns.get(call.eventId)??[]).find(e=>e.activationId===boundary?.activationId&&(!resume||resume.dataInputs?.includes(e.eventId))),
      disposition=resume?.returnDisposition??call.returnDisposition??'unknown',isVoid=(resume?.returnType??call.returnType)?.kind==='void',
      after=e=>resume&&e.activationId===resume.activationId&&events.get(e.eventId).index>events.get(resume.eventId).index,
      inputs=resume?(uses.get(resume.eventId)??[]).filter(use=>after(use.event)):[],first=inputs[0]?.event,
      selected=first?inputs.filter(use=>use.event===first):[],site=sites.get(call.instructionId),storage=storedResult(call,returned);
    const status=!resume?'not-returned':isVoid?'void':disposition==='discarded'?'discarded':first?'delivered':storage.delivery?'storage-delivered':'unresolved';
    const consumer=status==='delivered'?{...location(first),role:consumerRole(first),
      inputIndices:unique(selected.map(use=>use.inputIndex)),parameterIndices:unique(selected.map(use=>use.input.parameterIndex))}:null;
    return {id:`delivery${index+1}`,callExecutionId:call.eventId,callInstructionId:call.instructionId,
      staticConsumerStatus:site?.status??'unavailable',callerActivationId:call.activationId,
      returnValueExecutionId:returned?.eventId??null,returnExecutionId:boundary?.eventId??null,resumeExecutionId:resume?.eventId??null,
      sourceExecutionId:returned?.eventId??resume?.eventId??null,
      sourceExpressionExecutionIds:unique((returned?.inputs??[]).map(input=>input.executionId)),
      returnDisposition:disposition,status,consumer,storageDelivery:storage.delivery,
      addressUses:unique((resume?addresses.get(resume.eventId)??[]:[]).filter(after)).map(e=>({...location(e),role:'address'})),
      calleeUses:unique((resume?callees.get(resume.eventId)??[]:[]).filter(after)).map(e=>({...location(e),role:'callee'})),
      ...(status==='unresolved'?{reason:storage.reason??'no direct completed value operand observed'}:status==='not-returned'?{reason:'no observed call resume'}:{}),
      evidence:'observed call/return identities and direct operand slots',destinationTiming:'each destination is available only at its recorded availableAtExecutionId'};
  });
}

export function validateResultDeliveryPlan(plan){
  if(!plan.resultDeliveries)return plan;
  const instructions=new Map(plan.instructions.map(d=>[d.id,d])),seen=new Set();
  for(const delivery of plan.resultDeliveries){
    const call=instructions.get(delivery.callInstructionId),resume=instructions.get(delivery.resumeInstructionId);
    if(call?.action!=='call'||call.kind!=='FLOW'||seen.has(call.id)||delivery.resumeInstructionId&&!resume||resume&&
      (resume.action!=='resume'||resume.sourceNodeId!==call.sourceNodeId||resume.functionId!==call.functionId))
      throw new Error('반환 전달의 정적 호출·복귀 연결이 올바르지 않습니다.');
    seen.add(call.id);
    if(!['candidate','discarded','void','unresolved'].includes(delivery.status)||delivery.status==='candidate'&&!delivery.consumer?.instructionIds?.length)
      throw new Error('반환 전달의 정적 소비 상태가 올바르지 않습니다.');
    for(const id of delivery.consumer?.instructionIds??[])if(!instructions.has(id))throw new Error('반환 전달의 정적 소비 명령이 없습니다.');
  }
  return plan;
}

export function validateResultDeliveries(plan,trace){
  if(!trace.resultDeliveries){
    if(plan.resultDeliveries)throw new Error('반환 전달의 실행 연결 목록이 없습니다.');
    return trace;
  }
  // Re-derive only links between existing execution facts; this neither runs
  // expressions nor infers a destination from an alias/address dependency.
  const expected=buildResultDeliveries(plan,trace);
  if(JSON.stringify(expected)!==JSON.stringify(trace.resultDeliveries))
    throw new Error('반환 전달의 실행 출처·직접 소비·확정 시점이 관측 기록과 일치하지 않습니다.');
  return trace;
}
