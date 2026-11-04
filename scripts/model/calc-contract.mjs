// Validate source calculations against separately recorded data/step evidence.
// This checks provenance and operand presence; it never re-evaluates C.
const fail=(id,reason)=>{throw new Error(`CALC 계약 위반 (${id}): ${reason}`);};
const operandKey=i=>i?.executionId?`execution:${i.executionId}`:i?.nodeId?`node:${i.nodeId}`:
  `literal:${JSON.stringify(i?.value??null)}`;
const valueBoundary=e=>e?.kind==='READ'||e?.kind==='CALC'||e?.kind==='FLOW'&&e.action==='resume';

export function validateCalcPlan(plan){
  for(const d of plan.instructions)if(d.kind==='CALC'&&!(typeof d.operator==='string'&&d.operator.length))
    fail(d.id,`소스 연산자가 없습니다: ${d.expression?.kind??d.action} ${d.source?.expression??''}`);
  return plan;
}

function boundaryNodes(root){
  const result=new Set(),stack=[root];
  while(stack.length){const n=stack.pop();if(!n)continue;
    if(n.cast==='LValueToRValue'||n.kind==='CallExpr'||['ArraySubscriptExpr','MemberExpr'].includes(n.kind)||
      n.kind==='UnaryOperator'&&n.operator==='*'){result.add(n.nodeId);continue;}
    // Conditional selection is its own FLOW boundary. Its condition's reads
    // are control evidence; the chosen value is checked through data edges.
    if(['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind))continue;
    if(n.sizeof||n.alignof)continue;
    stack.push(...n.children??[]);
  }
  return result;
}

export function validateCalcTrace(plan,trace){
  const definitions=new Map(plan.instructions.map(d=>[d.id,d])),executions=new Map(trace.events.map(e=>[e.eventId,e])),
    positions=new Map(trace.events.map((e,index)=>[e.eventId,index])),last=new Map(),boundaries=new Map(),folded=new Map(),obtained=new Map();
  const remember=e=>{if(!valueBoundary(e)||!e.value)return;
    const nodeId=definitions.get(e.instructionId)?.sourceNodeId;if(!nodeId)return;
    const key=`${e.activationId}:${nodeId}`,list=obtained.get(key)??[];list.push(e);obtained.set(key,list);};
  for(const b of Object.values(plan.bindings??{}))for(const spec of b.foldedCalculations??[])folded.set(spec.instructionId,spec.inputs);
  for(const [index,e]of trace.events.entries()){
    if(e.kind!=='CALC'){remember(e);continue;}
    const d=definitions.get(e.instructionId);
    if(!e.operator||e.operator!==d?.operator)fail(e.eventId,'정의와 실행의 소스 연산자가 다릅니다.');
    if(!Array.isArray(e.inputs))fail(e.eventId,'평가 입력 목록이 없습니다.');
    const keys=new Set(e.inputs.map(operandKey)),external=new Set(e.dataInputs??[]);
    const consumed=new Set(),pending=e.inputs.map(i=>i.executionId).filter(Boolean);
    while(pending.length){const id=pending.pop();if(consumed.has(id))continue;consumed.add(id);
      const producer=executions.get(id);
      // A completed child calculation is a real value boundary. Its own
      // checked operands cover the underlying READs without duplicating them.
      if(producer?.kind==='CALC')pending.push(...producer.inputs.map(i=>i.executionId).filter(Boolean));
    }
    for(const input of e.inputs){
      if(!input?.value)fail(e.eventId,'평가 입력의 값이 없습니다.');
      if(input.executionId&&(!executions.has(input.executionId)||positions.get(input.executionId)>=index))
        fail(e.eventId,'아직 얻지 않은 값을 입력으로 사용했습니다.');
      const producer=executions.get(input.executionId);
      if(producer?.kind==='READ'&&producer.value?.bits&&input.value.bits!==producer.value.bits)
        fail(e.eventId,'READ에서 얻은 값과 입력 값이 다릅니다.');
    }
    // An observed data edge remains an independent witness even if inputs is
    // empty, or a caller deletes one of its elements.
    for(const id of external)if(valueBoundary(executions.get(id))&&executions.get(id).value&&!keys.has(`execution:${id}`))
      fail(e.eventId,`평가한 데이터 입력 ${id}가 누락됐습니다.`);
    for(const s of e.steps??[])for(const input of s.inputs??[]){
      if(input.executionId===e.eventId||s.builtin&&!s.builtin.hasLiteralArguments&&input.observationId===null)continue;
      if(!keys.has(operandKey(input)))fail(e.eventId,'관찰한 계산 단계의 입력이 누락됐습니다.');
    }
    for(const input of folded.get(e.instructionId)??[])if(!keys.has(operandKey(input)))
      fail(e.eventId,'컴파일러가 접은 소스 피연산자가 누락됐습니다.');
    // AST value boundaries exclude indexing/address work and call arguments.
    // Only actual events since this expression's previous execution qualify;
    // skipped branches and previous loop iterations cannot supply operands.
    let nodes=boundaries.get(d.id);if(!nodes)boundaries.set(d.id,nodes=boundaryNodes(d.expression));
    const key=`${e.activationId}:${e.instructionId}`,start=last.get(key)??-1;
    for(const nodeId of nodes){const values=obtained.get(`${e.activationId}:${nodeId}`)??[];
      for(let at=values.length-1;at>=0&&positions.get(values[at].eventId)>start;at--)
        if(!consumed.has(values[at].eventId))fail(e.eventId,`현재 식 ${d.source?.expression??''}에서 얻은 입력 ${values[at].eventId}가 누락됐습니다.`);
    }
    if(e.phase==='complete'&&!e.inputs.length&&(d.expression?.children?.length||external.size)&&!d.expression?.builtin)
      fail(e.eventId,'평가한 식의 입력이 비어 있습니다.');
    last.set(key,index);
    remember(e);
  }
  return trace;
}
