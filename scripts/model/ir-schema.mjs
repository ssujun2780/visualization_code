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
  for(const instruction of plan.instructions)if(instruction.scopeId&&!plan.scopes.some(s=>s.id===instruction.scopeId))
    throw new Error(`중간언어 명령의 스코프가 없습니다: ${instruction.scopeId}`);
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
  if(plan.controlFlow){
    const labels=new Map(plan.controlFlow.labels.map(l=>[l.id,l]));
    for(const edge of plan.controlFlow.edges)if(!labels.has(edge.fromLabelId)||!labels.has(edge.toLabelId))
      throw new Error(`제어 흐름의 case 레이블이 없습니다: ${edge.id}`);
    for(const label of labels.values())if(!ids.has(label.switchInstructionId))
      throw new Error(`case 레이블의 switch 명령이 없습니다: ${label.id}`);
  }
  return plan;
}

export function validateIRTrace(plan,trace){
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ids=new Set(trace.events.map(e=>e.eventId));
  const evaluations=new Map((plan.evaluations??[]).map(e=>[e.nodeId,e]));
  if(ids.size!==trace.events.length)throw new Error('중간언어 실행 식별자가 중복됐습니다.');
  for(const execution of trace.events){
    const instruction=instructions.get(execution.instructionId);
    if(!instruction||instruction.kind!==execution.kind||instruction.action!==execution.action)
      throw new Error(`명령 정의와 실행 기록의 형식이 다릅니다: ${execution.instructionId}`);
    if(!['complete','incomplete','failed'].includes(execution.phase))throw new Error('중간언어 실행 상태가 올바르지 않습니다.');
    for(const key of ['dataInputs','addressInputs','controlInputs'])for(const id of execution[key]??[])
      if(!ids.has(id)||id===execution.eventId)throw new Error(`실행 기록의 출처 연결이 올바르지 않습니다: ${id}`);
    for(const e of [execution.evaluation,...execution.inputEvaluations??[]].filter(Boolean)){
      if(!evaluations.has(e.nodeId))throw new Error('실행 기록의 식 평가 정의가 없습니다.');
      for(const id of [...e.decisionExecutionIds??[],...e.resultExecutionIds??[]])if(!ids.has(id))throw new Error('식 평가의 실행 출처가 없습니다.');
    }
    if(execution.helpMarker&&(execution.helpMarker.status!=='stub'||execution.evaluation?.right!=='skipped'||!execution.evaluation.reason))
      throw new Error('논리식 도움말 표지의 생략 근거가 없습니다.');
  }
  const edges=new Set((plan.controlFlow?.edges??[]).map(e=>e.id)),transitions=new Map((trace.flowTransitions??[]).map(t=>[t.id,t]));
  for(const transition of transitions.values()){
    if(!edges.has(transition.edgeId)||transition.beforeExecutionId&&!ids.has(transition.beforeExecutionId))
      throw new Error(`실행된 제어 흐름의 연결이 올바르지 않습니다: ${transition.id}`);
    for(const id of transition.controlInputs)if(!ids.has(id))throw new Error(`제어 흐름의 원인 실행이 없습니다: ${id}`);
  }
  for(const execution of trace.events)for(const id of execution.incomingTransitions??[])
    if(transitions.get(id)?.beforeExecutionId!==execution.eventId)throw new Error(`명령의 진입 경로가 올바르지 않습니다: ${id}`);
  return trace;
}
