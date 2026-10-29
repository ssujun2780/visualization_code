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
  return plan;
}

export function validateIRTrace(plan,trace){
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ids=new Set(trace.events.map(e=>e.eventId));
  if(ids.size!==trace.events.length)throw new Error('중간언어 실행 식별자가 중복됐습니다.');
  for(const execution of trace.events){
    const instruction=instructions.get(execution.instructionId);
    if(!instruction||instruction.kind!==execution.kind||instruction.action!==execution.action)
      throw new Error(`명령 정의와 실행 기록의 형식이 다릅니다: ${execution.instructionId}`);
    if(!['complete','incomplete','failed'].includes(execution.phase))throw new Error('중간언어 실행 상태가 올바르지 않습니다.');
    for(const key of ['dataInputs','addressInputs','controlInputs'])for(const id of execution[key]??[])
      if(!ids.has(id)||id===execution.eventId)throw new Error(`실행 기록의 출처 연결이 올바르지 않습니다: ${id}`);
  }
  return trace;
}
