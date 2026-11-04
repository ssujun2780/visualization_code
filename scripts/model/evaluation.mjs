// AST expression identity + LLVM value/CFG links. No original-source evaluator.
export const expressionOperator=n=>n?.kind==='BinaryOperator'?/ '([^']+)'\s*$/.exec(n.details)?.[1]:null;
export const evaluationKind=n=>['&&','||'].includes(expressionOperator(n))?'logical':n?.kind==='ConditionalOperator'?'conditional':null;

export function evaluationBindings(observations,nearest){
  const result=new Map(),producers=new Map(),owners=new Map(),decisions=new Map(),ops=new Map(observations.instructions.map(o=>[o.id,o]));
  for(const o of observations.instructions)if(o.result)producers.set(`${o.functionId}:${o.result}`,o);
  const producer=(o,input=o.inputs?.[0])=>input&&producers.get(`${o.functionId}:${input.value}`);
  const evaluation=o=>nearest(o,n=>evaluationKind(n));
  const inside=(p,r)=>p&&r&&(p.line>r.start.line||p.line===r.start.line&&p.column>=r.start.column)&&
    (p.line<r.end.line||p.line===r.end.line&&p.column<=r.end.column);
  function mark(o,node,role){if(o&&node){result.set(o.id,{node,role});owners.set(o.id,node);}}
  // Result conversions identify logical PHIs even when the PHI has no !dbg.
  for(const o of observations.instructions){
    const n=evaluation(o);
    if(o.opcode==='zext'&&o.type==='i32'&&o.inputs?.[0]?.type==='i1'&&evaluationKind(n)==='logical'&&!n.children.some(c=>inside(o.source,c.source))){
      mark(o,n,'result');const p=producer(o);
      if(p&&['icmp','fcmp','phi'].includes(p.opcode))mark(p,n,'result');
    }
    if(['merge','select'].includes(o.action)&&evaluationKind(n)==='conditional')mark(o,n,'selection');
  }
  for(const o of observations.instructions.filter(o=>o.action==='branch'&&o.inputs.length)){
    const n=evaluation(o);if(!n)continue;
    // A branch consuming an already completed logical expression belongs to
    // its containing statement, not to that expression's left-operand test.
    let p=producer(o),seen=new Set(),completed=false;
    while(p&&!seen.has(p.id)){seen.add(p.id);if(owners.get(p.id)===n){completed=true;break;}
      if(!['icmp','fcmp','zext','trunc'].includes(p.opcode))break;p=producer(p);}
    if(completed)continue;
    mark(o,n,'decision');decisions.set(`${o.functionId}:${o.block}`,{op:o,node:n});
    const test=producer(o);
    if(test&&['icmp','fcmp'].includes(test.opcode)&&['ne','une'].includes(test.predicate)&&['0','null','0.000000e+00'].includes(test.inputs?.[1]?.value)&&!test.cType)
      mark(test,n,'truth-test');
  }
  // Nested logical PHIs need not have a zext or source location. Their constant
  // incoming edge identifies the observed short-circuit branch, not its name.
  for(const o of observations.instructions.filter(o=>o.opcode==='phi'&&o.type==='i1'&&!result.has(o.id))){
    const candidates=o.incoming.flatMap(i=>{
      const d=decisions.get(`${o.functionId}:${i.block}`);if(!d||evaluationKind(d.node)!=='logical')return [];
      const constant=expressionOperator(d.node)==='&&'?'false':'true';
      return i.value===constant&&d.op.destinations.includes(o.block)?[d.node]:[];
    });
    if(candidates.length===1)mark(o,candidates[0],'result');
  }
  // Macro expansion locations can collapse onto an operand. Once CFG evidence
  // identifies the logical PHI, its implicit C int materialization has the same
  // expression identity even if the initial source-location lookup missed it.
  for(const o of observations.instructions){
    const source=result.get(producer(o)?.id);
    if(o.opcode==='zext'&&o.type==='i32'&&o.inputs?.[0]?.type==='i1'&&!o.conversion&&!result.has(o.id)&&
      source?.role==='result'&&evaluationKind(source.node)==='logical')mark(o,source.node,'result');
  }
  for(const [id,entry]of result){
    const o=ops.get(id);
    if(entry.role==='result'&&o.opcode==='phi')for(const i of o.incoming){
      const p=producer(o,i);
      if(p&&!result.has(p.id)&&['icmp','fcmp'].includes(p.opcode)&&!p.cType)mark(p,entry.node,'truth-test');
    }
    if(entry.role==='selection'&&o.opcode==='select'){
      const test=producer(o);
      if(test&&!test.cType&&['icmp','fcmp'].includes(test.opcode))mark(test,entry.node,'truth-test');
    }
  }
  // Boolean ABI materialization for select (e.g. unused i64) is not C work.
  for(const o of observations.instructions)if(o.opcode==='zext'&&result.get(producer(o)?.id)?.role==='truth-test'&&!result.has(o.id))mark(o,result.get(producer(o).id).node,'truth-test');
  return result;
}

export function cResult(value,cType,boolean=false){
  if(!value||!cType||!value.bits)return value;
  const width=cType.sizeBits;if(!width)return value;
  const number=boolean?(BigInt(value.bits)!==0n?1n:0n):BigInt(value.bits),bits=BigInt.asUintN(width,number);
  return {...value,type:`i${width}`,bits:`0x${bits.toString(16).padStart(Math.ceil(width/4),'0')}`,
    unsigned:bits.toString(),signed:BigInt.asIntN(width,bits).toString(),cType,
    decimal:(cType.signedness==='unsigned'?bits:BigInt.asIntN(width,bits)).toString()};
}

const truth=value=>value?.bits?BigInt(value.bits)!==0n:null;
const conditionalEvaluation=(spec,state)=>{
  const selected=state?.truth==null?null:state.truth?'true':'false';
  return {nodeId:spec.nodeId,kind:'conditional',conditionTruth:state?.truth??null,selected,
    skipped:selected==='true'?'false':selected==='false'?'true':null,decisionObservationId:state?.decisionId??null};
};
export function createEvaluationTracker(plan,operandValue){
  const states=new Map(),specs=new Map((plan.evaluations??[]).map(s=>[s.nodeId,s]));
  function completeConditional(e,nodeId,conditionTruth=truth(e.condition)){
    const spec=specs.get(nodeId),state={truth:conditionTruth,decisionId:e.eventId};
    states.set(`${e.activationId}:${nodeId}`,state);
    return {...e,backendCondition:e.backendCondition??e.condition,
      condition:conditionTruth==null?e.condition:cResult({type:'i1',bits:conditionTruth?'0x1':'0x0'},spec.truthType,true),
      selectedOutcome:conditionTruth==null?null:conditionTruth?'true':'false',evaluation:conditionalEvaluation(spec,state)};
  }
  return {
    completeConditional,
    decorate(e,op,b){
      if(e.action==='frame.end'){for(const k of states.keys())if(k.startsWith(`${e.activationId}:`))states.delete(k);}
      if(!b?.evaluation)return e;
      const {nodeId,role}=b.evaluation,spec=specs.get(nodeId);if(!spec)return e;
      const key=`${e.activationId}:${nodeId}`;
      if(role==='decision'){
        const state={truth:truth(e.condition),decisionId:e.eventId};states.set(key,state);
        if(spec.kind==='conditional')return completeConditional(e,nodeId,state.truth);
        return {...e,evaluation:{...state,nodeId,kind:spec.kind}};
      }
      if(role==='truth-test')return e;
      let state=states.get(key),leftTruth=state?.truth??spec.leftTruth??null;
      if(role==='folded')leftTruth=e.left?.truth??leftTruth;
      const selectCondition=op.opcode==='select'?operandValue(op.inputs[0],e.activationId)?.value:null;
      if(op.opcode==='select')state={truth:truth(selectCondition),decisionId:e.eventId};
      const skip=spec.kind==='logical'&&leftTruth!==null?(spec.operator==='&&'?!leftTruth:leftTruth):null;
      const reason=skip?(spec.operator==='&&'?'and-left-false':'or-left-true'):null;
      const evaluation=spec.kind==='conditional'?conditionalEvaluation(spec,state):{nodeId,kind:spec.kind,
        leftTruth,right:skip===null?'unknown':skip?'skipped':'evaluated',reason,decisionObservationId:state?.decisionId??null};
      const helpMarker=skip?{kind:'logical-short-circuit',status:'stub',reason,evaluationNodeId:nodeId,
        highlight:spec.source,skippedSource:spec.right.source}:undefined;
      const value=role==='folded'?e.observedConsumerValue:e.value;
      return {...e,value:spec.kind==='logical'?cResult(value,spec.cType,true):value,evaluation,
        ...(op.opcode==='select'&&spec.kind==='conditional'?{backendCondition:selectCondition,
          condition:cResult(selectCondition,spec.truthType,true),selectedOutcome:evaluation.selected}:{}),
        ...(helpMarker?{helpMarker}:{}),controlInputs:[...new Set([...(e.controlInputs??[]),state?.decisionId].filter(id=>id&&id!==e.eventId))]};
    }
  };
}
