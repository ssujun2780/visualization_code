import {validateCalcPlan,validateCalcTrace} from './calc-contract.mjs';
import {validateWorkTrace} from './work-contracts.mjs';
import {validatePresentationContract} from './presentation-contract.mjs';
import {validateResultDeliveryPlan,validateResultDeliveries} from './result-delivery.mjs';
import {validateReturnSequence} from './return-sequence.mjs';
import {validateConversionConsumers} from './conversion-consumers.mjs';
import {validateFunctionDeclarations} from './function-declarations.mjs';
export const IR_VERSION=3;
export const IR_KINDS=Object.freeze(['READ','WRITE','CALC','FLOW','SPACE','ERROR']);

export function validateIRPlan(plan){
  if(plan.schemaVersion!==IR_VERSION)throw new Error('중간언어 버전이 일치하지 않습니다.');
  const ids=new Set();
  for(const instruction of plan.instructions){
    if(!instruction.id||ids.has(instruction.id)||!IR_KINDS.includes(instruction.kind)||!instruction.action)
      throw new Error('중간언어 명령의 식별자 또는 형식이 올바르지 않습니다.');
    ids.add(instruction.id);
  }
  for(const binding of Object.values(plan.bindings))for(const id of Object.values(binding.roles))
    if(!ids.has(id))throw new Error(`관찰 지점에 연결된 중간언어 명령이 없습니다: ${id}`);
  for(const binding of Object.values(plan.bindings)){
    for(const folded of binding.foldedCalculations??[])if(!ids.has(folded.instructionId))throw new Error('상수 계산의 중간언어 명령이 없습니다.');
    for(const site of Object.values(binding.returnSites??{}))for(const id of Object.values(site))if(!ids.has(id))throw new Error('반환문의 중간언어 명령이 없습니다.');
  }
  for(const instruction of plan.instructions)if(instruction.scopeId&&!plan.scopes.some(s=>s.id===instruction.scopeId))
    throw new Error(`중간언어 명령의 스코프가 없습니다: ${instruction.scopeId}`);
  for(const i of plan.instructions)if(i.callProjection?.status==='mapped'){
    const p=i.callProjection,slots=new Set(p.arguments.map(a=>a.abiIndex));
    if(slots.size!==p.sourceArgumentCount||p.arguments.some((a,index)=>a.sourceIndex!==index)||p.hiddenArguments.some(a=>slots.has(a.abiIndex)))
      throw new Error('C 호출 인자와 내부 ABI 슬롯의 대응이 올바르지 않습니다.');
  }
  for(const i of plan.instructions)if(i.bitfield){
    const b=i.bitfield,storageBits=Number(/^i(\d+)$/.exec(i.storageAccessType)?.[1]);
    if(!['READ','WRITE'].includes(i.kind)||!(b.cType?.signedness||b.cType?.encoding==='DW_ATE_boolean')||!(b.width>0&&b.shift>=0&&b.shift+b.width<=storageBits)||
      i.accessType!==`i${b.cType.sizeBits}`)throw new Error('비트필드의 논리 자료형과 저장 범위가 일치하지 않습니다.');
  }
  if(plan.evaluations){
    const evaluationIds=new Set(plan.evaluations.map(e=>e.nodeId));
    if(evaluationIds.size!==plan.evaluations.length)throw new Error('식 평가의 식별자가 중복됐습니다.');
    for(const b of Object.values(plan.bindings))if(b.evaluation&&(!evaluationIds.has(b.evaluation.nodeId)||!['result','selection','decision','truth-test','folded'].includes(b.evaluation.role)))
      throw new Error('식 평가 관찰의 연결이 올바르지 않습니다.');
    for(const e of plan.evaluations)if(e.kind==='logical'&&(!e.left.nodeId||!e.right.nodeId||e.helpMarker?.status!=='stub'))
      throw new Error('논리식의 피연산자 또는 도움말 표지가 없습니다.');
  }
  if(plan.sourceMap){
    const {snapshot}=plan.sourceMap;
    for(const instruction of plan.instructions){
      if(!['mapped','unmapped','implementation'].includes(instruction.sourceStatus))throw new Error('명령의 소스 연결 상태가 없습니다.');
      if(instruction.sourceStatus!=='mapped')continue;
      const s=instruction.source;
      if(!s||s.file!==snapshot.file||!s.endExclusive||!s.editorRange||
        !Number.isInteger(s.start?.byte)||!Number.isInteger(s.end?.byte)||s.start.byte<0||s.start.byte>=s.end.byte||s.end.byte>snapshot.byteLength)
        throw new Error(`명령의 소스 범위가 올바르지 않습니다: ${instruction.id}`);
    }
  }
  const selections=new Map((plan.compileTimeSelections??[]).map(s=>[s.nodeId,s]));
  for(const g of plan.conditionGuards??[])if(!ids.has(g.calcInstructionId)||!ids.has(g.flowInstructionId)||!plan.evaluations.some(e=>e.nodeId===g.nodeId))
    throw new Error('조건 논리식의 계산·분기 연결이 없습니다.');
  for(const s of selections.values())if(s.kind!=='generic'||s.stage!=='compile-time'||s.controlEvaluation!=='unevaluated'||
    s.associations.filter(a=>a.selected).length!==1||!s.associations[s.selectedAssociationIndex]?.selected||
    s.associations[s.selectedAssociationIndex].expressionNodeId!==s.selectedExpressionNodeId)
    throw new Error('컴파일 시 타입 선택의 연결이 올바르지 않습니다.');
  for(const i of plan.instructions)for(const id of i.selectionIds??[])if(!selections.has(id))throw new Error('컴파일 시 타입 선택의 정의가 없습니다.');
  if(plan.controlFlow){
    const labels=new Map(plan.controlFlow.labels.map(l=>[l.id,l]));
    for(const edge of plan.controlFlow.edges)if(!labels.has(edge.fromLabelId)||!labels.has(edge.toLabelId))
      throw new Error(`제어 흐름의 case 레이블이 없습니다: ${edge.id}`);
    for(const label of labels.values())if(!ids.has(label.switchInstructionId))
      throw new Error(`case 레이블의 switch 명령이 없습니다: ${label.id}`);
  }
  validateCalcPlan(plan);
  validateFunctionDeclarations(plan);
  validatePresentationContract(plan);
  validateResultDeliveryPlan(plan);
  validateConversionConsumers(plan);
  return plan;
}

export function validateIRTrace(plan,trace){
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ids=new Set(trace.events.map(e=>e.eventId));
  const functions=new Map((plan.functions??[]).map(f=>[f.id,f]));
  function functionReference(ref){
    if(ref?.kind!=='function')return;
    if(!Number.isSafeInteger(ref.tableIndex)||ref.tableIndex<0||'targetObjectId'in ref||'address'in ref||
      !['resolved','null','unresolved'].includes(ref.status)||ref.status==='null'&&ref.tableIndex!==0||
      ref.status==='resolved'&&(!functions.has(ref.functionId)||functions.get(ref.functionId).name!==ref.functionName))
      throw new Error('함수 참조와 컴파일된 함수 정의의 연결이 올바르지 않습니다.');
  }
  const executions=new Map(trace.events.map(e=>[e.eventId,e]));
  const evaluations=new Map((plan.evaluations??[]).map(e=>[e.nodeId,e]));
  if(ids.size!==trace.events.length)throw new Error('중간언어 실행 식별자가 중복됐습니다.');
  for(const execution of trace.events){
    const instruction=instructions.get(execution.instructionId);
    if(!instruction||instruction.kind!==execution.kind||instruction.action!==execution.action)
      throw new Error(`명령 정의와 실행 기록의 형식이 다릅니다: ${execution.instructionId}`);
    if(!['complete','incomplete','failed'].includes(execution.phase))throw new Error('중간언어 실행 상태가 올바르지 않습니다.');
    if(instruction.accessType&&execution.value?.type&&instruction.accessType!==execution.value.type)
      throw new Error(`접근 명령과 실행 값의 자료형이 다릅니다: ${instruction.accessType} / ${execution.value.type}`);
    if(execution.action==='call'&&instruction.callProjection?.status==='mapped'&&execution.arguments?.length!==instruction.callProjection.sourceArgumentCount)
      throw new Error('공개 호출에 소스 인자 수와 다른 ABI 인자가 노출됐습니다.');
    if(instruction.bitfield&&execution.phase==='complete'){
      const b=instruction.bitfield;
      if(!execution.storageValue||!execution.storageTarget||execution.target?.bitSize!==b.width||
        execution.value?.type!==`i${b.cType.sizeBits}`)throw new Error('비트필드의 실행 값 또는 저장 근거가 없습니다.');
    }
    for(const key of ['dataInputs','addressInputs','controlInputs','calleeInputs'])for(const id of execution[key]??[])
      if(!ids.has(id)||id===execution.eventId)throw new Error(`실행 기록의 출처 연결이 올바르지 않습니다: ${id}`);
    for(const partial of execution.partialCalculationInputs??[]){
      const producer=executions.get(partial.executionId);
      if(producer?.kind!=='CALC'||!producer.steps?.some(s=>s.observationIds.includes(partial.observationId))||
        partial.inputExecutionIds.some(id=>!ids.has(id)||id===execution.eventId))
        throw new Error('보류된 식의 중간 계산 근거가 올바르지 않습니다.');
    }
    for(const v of [execution.value,...execution.arguments??[],...(execution.inputs??[]).map(i=>i.value)])functionReference(v?.reference);
    functionReference(execution.functionTarget);
    if(execution.resolvedFunctionId&&(!functions.has(execution.resolvedFunctionId)||functions.get(execution.resolvedFunctionId).name!==execution.resolvedFunctionName))
      throw new Error('호출된 함수 정의의 식별자가 올바르지 않습니다.');
    if(execution.action==='call'&&execution.returnType?.kind==='void'&&execution.returnDisposition==='used')
      throw new Error('void 호출에는 소비할 반환값이 없습니다.');
    if(execution.action==='argument')for(const input of execution.inputs??[])if(input.executionId&&
      (!ids.has(input.executionId)||input.executionId===execution.eventId))throw new Error(`인자 입력의 출처 연결이 올바르지 않습니다: ${execution.eventId}`);
    for(const [key,actions]of [['callExecutionId',['call']],['returnExecutionId',['return','resume']]])if(execution[key]){
      const target=executions.get(execution[key]);
      if(target?.kind!=='FLOW'||!actions.includes(target.action))throw new Error(`호출 경계의 실행 연결이 올바르지 않습니다: ${key}=${execution[key]}`);
    }
    for(const e of [execution.evaluation,...execution.inputEvaluations??[],...execution.nestedEvaluations??[]].filter(Boolean)){
      if(!evaluations.has(e.nodeId))throw new Error('실행 기록의 식 평가 정의가 없습니다.');
      for(const id of [...e.decisionExecutionIds??[],...e.resultExecutionIds??[]])if(!ids.has(id))throw new Error('식 평가의 실행 출처가 없습니다.');
    }
    for(const marker of [execution.helpMarker,...execution.helpMarkers??[]].filter(Boolean)){
      const evaluation=[execution.evaluation,...execution.nestedEvaluations??[]].find(e=>e?.nodeId===marker.evaluationNodeId);
      if(marker.status!=='stub'||evaluation?.right!=='skipped'||!evaluation.reason)
        throw new Error('논리식 도움말 표지의 생략 근거가 없습니다.');
    }
  }
  for(const ref of trace.references??[])functionReference(ref);
  const edges=new Set((plan.controlFlow?.edges??[]).map(e=>e.id)),transitions=new Map((trace.flowTransitions??[]).map(t=>[t.id,t]));
  for(const transition of transitions.values()){
    if(!edges.has(transition.edgeId)||transition.beforeExecutionId&&!ids.has(transition.beforeExecutionId))
      throw new Error(`실행된 제어 흐름의 연결이 올바르지 않습니다: ${transition.id}`);
    for(const id of transition.controlInputs)if(!ids.has(id))throw new Error(`제어 흐름의 원인 실행이 없습니다: ${id}`);
  }
  for(const execution of trace.events)for(const id of execution.incomingTransitions??[])
    if(transitions.get(id)?.beforeExecutionId!==execution.eventId)throw new Error(`명령의 진입 경로가 올바르지 않습니다: ${id}`);
  validateConversionConsumers(plan,trace.events);
  validateCalcTrace(plan,trace);
  validateWorkTrace(plan,trace);
  validateResultDeliveries(plan,trace);
  validateReturnSequence(trace,plan);
  return trace;
}
