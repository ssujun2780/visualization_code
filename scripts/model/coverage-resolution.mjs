// Reconcile earlier diagnostics with the final bindings. A source-only
// definition is not evidence of a recovered observation or executed value.
import {conversionConsumerEvidence} from './conversion-consumers.mjs';
export function resolvedCoverage(plan,{events}={}) {
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),executions=new Map();
  for(const e of events??[]){const list=executions.get(e.instructionId)??[];list.push(e);executions.set(e.instructionId,list);}
  const history=plan.coverage.observationMappingHistory??plan.coverage.unmappedObservations??[],resolvedObservations=[],unmappedObservations=[];
  for(const issue of history){
    const b=plan.bindings[issue.observationId],ids=[...new Set([b?.group,...Object.values(b?.roles??{})].filter(Boolean))],
      mapped=ids.filter(id=>{const i=instructions.get(id);return i?.sourceNodeId&&i.source&&
        (b.expressionNodeId===i.sourceNodeId||b.evaluation?.nodeId===i.sourceNodeId);});
    if(mapped.length)resolvedObservations.push({...issue,instructionIds:mapped,resolution:'final-source-binding',
      ...(events?{executionIds:mapped.flatMap(id=>(executions.get(id)??[]).map(e=>e.eventId))}:{})});
    else unmappedObservations.push(issue);
  }
  const result={observationMappingHistory:history,unmappedObservations,resolvedObservations};
  const conversions=plan.coverage.cConversions;if(!conversions)return result;
  const original=conversions.initiallyUnobserved??conversions.unobserved??[],nodes=new Map();
  function visit(n){if(!n||nodes.has(n.nodeId))return;if(n.nodeId)nodes.set(n.nodeId,n);for(const c of n.children??[])visit(c);}
  for(const i of instructions.values()){visit(i.expression);for(const a of i.arguments??[])visit(a);}
  const bindingsByNode=new Map();
  function bind(nodeId,binding){if(!nodeId)return;const list=bindingsByNode.get(nodeId)??[];list.push(binding);bindingsByNode.set(nodeId,list);}
  const literalTree=n=>!!n&&(['IntegerLiteral','CharacterLiteral'].includes(n.kind)||
    ['ParenExpr','ImplicitCastExpr','CStyleCastExpr','UnaryOperator','BinaryOperator'].includes(n.kind)&&
    !['++','--','=',',','&&','||'].includes(n.operator)&&(n.children?.length??0)>0&&n.children.every(literalTree));
  for(const [observationId,b]of Object.entries(plan.bindings)){
    for(const f of b.foldedCalculations??[])bind(f.nodeId,{instructionId:f.instructionId,observationId,kind:'folded-source-result'});
    for(const [index,input]of (b.inputTypes??[]).entries())if(input?.nodeId&&literalTree(nodes.get(input.nodeId))){
      const instructionId=b.group??b.roles?.CALC;
      if(instructionId)bind(input.nodeId,{instructionId,observationId,inputIndex:index,kind:'typed-literal-operand'});
    }
  }
  const consumersByNode=new Map(),consumerExecutions=new Map();
  for(const i of instructions.values())for(const spec of i.conversionConsumers??[]){
    const list=consumersByNode.get(spec.nodeId)??[];list.push({instruction:i,spec});consumersByNode.set(spec.nodeId,list);
  }
  const unobserved=[],resolved=[],notExecuted=[];
  for(const issue of original){
    const n=nodes.get(issue.nodeId),sameType=(a,b)=>a?.sizeBits===b?.sizeBits&&a?.signedness===b?.signedness,
      compatible=n&&['ImplicitCastExpr','CStyleCastExpr'].includes(n.kind)&&sameType(n.cType,issue.toType)&&sameType(n.children?.[0]?.cType,issue.fromType);
    const candidates=compatible?bindingsByNode.get(issue.nodeId)??[]:[],evidence=[],consumerStates=[];
    for(const c of candidates){
      if(!events){evidence.push(c);continue;}
      for(const e of executions.get(c.instructionId)??[]){
        const value=c.kind==='typed-literal-operand'?(e.inputs??[]).find(input=>input.nodeId===issue.nodeId)?.value:e.value;
        if(value?.bits&&sameType(value.cType,issue.toType))evidence.push({...c,executionId:e.eventId});
      }
    }
    for(const {instruction,spec}of consumersByNode.get(issue.nodeId)??[]){
      if(!events){evidence.push({instructionId:instruction.id,nodeId:spec.nodeId,kind:spec.consumer.kind,
        compilerEvidence:spec.compilerEvidence,consumer:spec.consumer});continue;}
      for(const e of executions.get(instruction.id)??[]){
        if(!consumerExecutions.has(e.eventId))consumerExecutions.set(e.eventId,conversionConsumerEvidence(instruction,e));
        const found=consumerExecutions.get(e.eventId)[instruction.conversionConsumers.indexOf(spec)];
        consumerStates.push(found);if(found.status==='observed-consumer')evidence.push(found);
      }
    }
    if(evidence.length)resolved.push({...issue,resolution:events?'observed-source-consumer':'bound-source-consumer',bindings:evidence});
    else if(consumerStates.length&&consumerStates.every(e=>e.status==='not-executed'))
      notExecuted.push({...issue,resolution:'not-executed',bindings:consumerStates});
    else unobserved.push({...issue,...(candidates.length&&events?{reason:'source consumer is bound but conversion was not observed in this trace'}:{})});
  }
  result.cConversions={...conversions,initiallyUnobserved:original,unobserved,resolved,notExecuted};
  return result;
}
