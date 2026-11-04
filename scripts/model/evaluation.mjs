// AST expression identity + LLVM value/CFG links. No original-source evaluator.
import {createExpressionOwnership} from './expression-ownership.mjs';
export const expressionOperator=n=>n?.kind==='BinaryOperator'?/ '([^']+)'\s*$/.exec(n.details)?.[1]:null;
export const evaluationKind=n=>['&&','||'].includes(expressionOperator(n))?'logical':n?.kind==='ConditionalOperator'?'conditional':null;

export function evaluationBindings(observations,nearest,nodes=[]){
  const ownership=createExpressionOwnership(observations,nearest,nodes);
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
    const selection=ownership.selectionOwner(o,owners);
    if(selection)mark(o,selection,'selection');
  }
  for(const o of observations.instructions.filter(o=>o.action==='branch'&&o.inputs.length)){
    const subjectOwner=ownership.decisionOwner(o),n=subjectOwner===undefined?evaluation(o):subjectOwner;if(!n)continue;
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
  // A flattened logical PHI can combine several short-circuit predecessors.
  // Include every incoming SSA value before choosing its common AST owner;
  // the constant predecessors alone may all belong to an inner && or ||.
  const byNode=new Map(nodes.map(n=>[n.id,n])),contains=(root,node)=>{for(let n=node;n;n=n.parent)if(n===root)return true;return false;};
  const valueNode=o=>{
    const seen=new Set();
    while(o&&!o.semanticNodeId&&!o.cType&&!seen.has(o.id)&&
      (result.get(o.id)?.role==='truth-test'||['icmp','fcmp','zext','sext','trunc'].includes(o.opcode))){
      seen.add(o.id);const p=producer(o);if(!p)break;o=p;
    }
    return byNode.get(o?.semanticNodeId)??owners.get(o?.id)??(o&&nearest(o));
  };
  for(const o of observations.instructions.filter(o=>o.opcode==='phi'&&o.type==='i1'&&!result.has(o.id))){
    if(o.incoming.length===2){
      const candidates=[...new Set(o.incoming.flatMap(i=>{
        const d=decisions.get(`${o.functionId}:${i.block}`);if(!d||evaluationKind(d.node)!=='logical')return [];
        const constant=expressionOperator(d.node)==='&&'?'false':'true';
        return i.value===constant&&d.op.destinations.includes(o.block)?[d.node]:[];
      }))];
      if(candidates.length===1&&o.incoming.every(i=>['false','true'].includes(i.value)||contains(candidates[0],valueNode(producer(o,i))))){
        mark(o,candidates[0],'result');continue;
      }
    }
    const incoming=o.incoming.map(input=>{
      const p=producer(o,input),decision=decisions.get(`${o.functionId}:${input.block}`),
        constant=['false','true'].includes(input.value);
      if(constant&&(!decision||!decision.op.destinations.includes(o.block)))return null;
      const subject=constant?producer(decision.op):p,node=valueNode(subject)??decision?.node;
      return node?{input,node,constant,decision}:null;
    });
    if(incoming.some(i=>!i)||!incoming.some(i=>i.constant))continue;
    let root=incoming[0].node;
    while(root&&!(evaluationKind(root)==='logical'&&incoming.every(i=>contains(root,i.node))))root=root.parent;
    if(!root)continue;
    const sourceDecisions=[...decisions.values()].filter(d=>d.op.functionId===o.functionId&&evaluationKind(d.node)==='logical'&&
      contains(root,valueNode(producer(d.op)))).map(d=>d.op.id);
    const shortTruth=expressionOperator(root)==='||',edges=incoming.map(({input,node,constant,decision})=>{
      const evidence={sourceDecisions,decisionTarget:constant?o.block:input.block,decisionObservationIds:constant?[decision.op.id]:
        [...decisions.values()].filter(d=>d.op.functionId===o.functionId&&d.op.destinations.includes(input.block)&&
          contains(root.children[0],valueNode(producer(d.op)))).map(d=>d.op.id)};
      if(contains(root.children[1],node))return {block:input.block,value:input.value,leftTruth:!shortTruth,...evidence};
      if(constant&&contains(root.children[0],node)&&(input.value==='true')===shortTruth)
        return {block:input.block,value:input.value,leftTruth:shortTruth,...evidence};
      return null;
    });
    if(edges.some(e=>!e))continue;
    mark(o,root,'result');result.get(o.id).phiIncoming=edges;
  }
  // Macro expansion locations can collapse onto an operand. Once CFG evidence
  // identifies the logical PHI, its implicit C int materialization has the same
  // expression identity even if the initial source-location lookup missed it.
  for(const o of observations.instructions){
    const source=result.get(producer(o)?.id);
    if(o.opcode==='zext'&&o.type==='i32'&&o.inputs?.[0]?.type==='i1'&&!o.conversion&&!result.has(o.id)&&
      source?.role==='result'&&evaluationKind(source.node)==='logical')mark(o,source.node,'result');
  }
  // A select may consume a location-less logical PHI discovered from CFG
  // above. Reuse that proven AST owner instead of falling back to its !dbg.
  for(const o of observations.instructions)if(!result.has(o.id)){
    const selection=ownership.selectionOwner(o,owners);if(selection)mark(o,selection,'selection');
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
  const states=new Map(),decisions=new Map(),completedPhis=new Map(),specs=new Map((plan.evaluations??[]).map(s=>[s.nodeId,s]));let decisionOrder=0;
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
      if(e.action==='frame.end')for(const table of [states,decisions,completedPhis])for(const k of table.keys())if(k.startsWith(`${e.activationId}:`))table.delete(k);
      if(!b?.evaluation)return e;
      const {nodeId,role}=b.evaluation,spec=specs.get(nodeId);if(!spec)return e;
      const key=`${e.activationId}:${nodeId}`;
      if(role==='decision'){
        const state={truth:truth(e.condition),decisionId:e.eventId};states.set(key,state);
        decisions.set(`${e.activationId}:${op.id}`,{...state,selected:e.selected,order:++decisionOrder});
        if(spec.kind==='conditional')return completeConditional(e,nodeId,state.truth);
        return {...e,evaluation:{...state,nodeId,kind:spec.kind}};
      }
      if(role==='truth-test')return e;
      let state=states.get(key),leftTruth=state?.truth??spec.leftTruth??null;
      const edge=role==='result'&&op.opcode==='phi'&&b.evaluation.phiIncoming?.find(i=>
        i.block===e.selectedInput?.block&&i.value===e.selectedInput?.value);
      let edgeDecisions=[];
      if(edge){leftTruth=edge.leftTruth;state=edge.decisionObservationIds.map(id=>decisions.get(`${e.activationId}:${id}`))
        .filter(d=>d?.selected===edge.decisionTarget).sort((a,b)=>b.order-a.order)[0]??null;
        const phiKey=`${e.activationId}:${op.id}`,after=completedPhis.get(phiKey)??0;
        edgeDecisions=edge.sourceDecisions.map(id=>decisions.get(`${e.activationId}:${id}`))
          .filter(d=>d&&d.order>after).sort((a,b)=>a.order-b.order).map(d=>d.decisionId);
        completedPhis.set(phiKey,decisionOrder);
      }
      if(role==='folded')leftTruth=e.left?.truth??leftTruth;
      const selectCondition=op.opcode==='select'?operandValue(op.inputs[0],e.activationId)?.value:null;
      if(op.opcode==='select')state={truth:truth(selectCondition),decisionId:e.eventId};
      const skip=spec.kind==='logical'&&leftTruth!==null?(spec.operator==='&&'?!leftTruth:leftTruth):null;
      const reason=skip?(spec.operator==='&&'?'and-left-false':'or-left-true'):null;
      const evaluation=spec.kind==='conditional'?conditionalEvaluation(spec,state):{nodeId,kind:spec.kind,
        leftTruth,right:skip===null?'unknown':skip?'skipped':'evaluated',reason,decisionObservationId:state?.decisionId??null,
        ...(edge?{decisionObservationIds:edgeDecisions,selectedPredecessor:edge.block,
          evidence:'observed PHI incoming edge and compiler logical operand ownership'}:{})};
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
