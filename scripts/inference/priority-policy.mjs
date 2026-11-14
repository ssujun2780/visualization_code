import {recordEvidence} from './record-evidence.mjs';
import {comparisonDiagram,inferLexicographicOrder} from './bst-key-order.mjs';
import {num,key,unique} from './storage-semantics.mjs';
import {integerLiteral,comparisonBounds,fitsComparisonType,comparisonCast,comparatorUses} from './comparator-result.mjs';
import {preservesNumericOrder} from './scalar-domain.mjs';
import {priorityStringEvidence} from './priority-string-evidence.mjs';
import {transformedKeyOperand} from './transformed-key.mjs';
const cache=new WeakMap();
// Same policy analysis for array and linked records; no new execution.
export function comparisonPolicies(plan,trace,{recordScope=false}={}){
 const cached=cache.get(trace);if(cached?.plan===plan&&cached[recordScope?'records':'arrays'])return cached[recordScope?'records':'arrays'];
 const c=recordEvidence(plan,trace),groups=new Map(),params=new Map(),steps=new Map(),strings=priorityStringEvidence(plan,trace,c);
 for(const e of c.events)if(e.action==='argument'&&e.target)params.set(e.target.objectId,e);
 for(const e of c.events)for(const s of e.steps??[])for(const id of s.observationIds??[s.observationId])if(id)steps.set(id,{e,s});
 // Match parameter identity through actual address provenance, including pointer
 // arguments. Equal numeric addresses alone cannot identify operand roles.
 const parameter=(o,activation)=>{if(!o)return null;const read=o.access??c.byId.get(o.readExecutionId),pending=[read],seen=new Set(),origins=new Map(),limit=trace.inferenceBudget?.limits.maxDependencyNodes??8192;
  while(pending.length){const e=pending.pop();if(!e||seen.has(e))continue;if(seen.size>=limit){trace.inferenceBudget?.report('comparator-parameter-origin',limit,read.eventId);return null;}seen.add(e);
   const p=params.get(e.target?.objectId);if(p?.activationId===activation){origins.set(p.eventId,p);continue;}
   pending.push(...(e.addressInputs??[]).map(id=>c.byId.get(id)));
   if(e.value?.cType?.kind==='pointer'||e.action==='argument')pending.push(...(e.dataInputs??[]).map(id=>c.byId.get(id)));
  }return origins.size===1?[...origins.values()][0]:null;};
 for(const ret of c.events.filter(e=>e.action==='return.value')){
  const call=c.byId.get(ret.callExecutionId);if(!call?.resolvedFunctionId)continue;
  const components=new Map(),proof=[],used=new Set(),controls=new Set(ret.controlInputs??[]),activations=new Set([ret.activationId]);
  function input(i,e,s){if(i.observationId&&steps.has(i.observationId)){const p=steps.get(i.observationId);if(p.s!==s)return reduceStep(p.e,p.s);}
   const literal=integerLiteral(i.value);return i.executionId?expression(c.byId.get(i.executionId)):literal!==null?{literal}:null;}
  function stringResult(p){
   const ops=p.operands,par=ops.map(o=>parameter(o,ret.activationId)),[a,b]=ops;
   if(a.field.node.typeId!==b.field.node.typeId||a.field.offset!==b.field.offset||a.range.size!==b.range.size||a.storage!==b.storage||
    !recordScope&&a.cell?.arrayId!==b.cell?.arrayId||!par.every(Boolean)||par[0].parameterIndex===par[1].parameterIndex)return null;
   const component=`${a.field.offset}:${a.range.size}:string:${a.storage}:${p.domain}:${p.byteLimit??''}`,typeId=a.field.node.typeId;
   components.set(component,{id:component,offset:a.field.offset,size:a.range.size,typeId,recordTypeId:typeId,arrayId:recordScope?null:a.cell?.arrayId??null,
    domain:p.domain,byteLimit:p.byteLimit,storage:a.storage,valueType:a.access.value?.cType});
   proof.push({kind:'string-comparison',comparisonExecutionId:p.returnExecutionId,callExecutionId:p.callExecutionId,component,
    operands:ops.map(o=>({range:o.range,readExecutionId:o.readExecutionId,copyExecutionIds:o.copyExecutionIds,atExecutionId:c.events[o.at]?.eventId,storage:o.storage,byteRange:o.byteRange,payload:o.payload}))});
   // strcmp promises a sign, not -1/0/+1. Mark it so arithmetic on its
   // unspecified magnitude cannot be treated as arithmetic on this sign.
   return {component,signOnly:true,reversed:par[0].parameterIndex>par[1].parameterIndex};
  }
  function reduceStep(e,s){
   if(used.has(s)||used.size>=64)return null;used.add(s);for(const id of e.controlInputs??[])controls.add(id);let result=null;
   if(s.kind==='folded-expression'&&!s.inputs?.some(i=>i.executionId||i.observationId)){
    const literal=integerLiteral(s.value);used.delete(s);return literal!==null?{literal}:null;
   }
   if(['&&','||'].includes(s.operator)){
    const find=n=>n?.nodeId===s.nodeId?n:n?.children?.map(find).find(Boolean),node=find(c.defs.get(e.instructionId)?.expression);
    if(node){result=logical(node,e);used.delete(s);return result;}
   }
   if(['<','<=','>','>=','==','!='].includes(s.operator)&&s.inputs.length===2){
    const transformed=s.inputs.map(i=>transformedKeyOperand(c,i,e,s)),tp=transformed.map(o=>parameter(o,ret.activationId));
    if(transformed.every(Boolean)&&tp.every(Boolean)&&tp[0].parameterIndex!==tp[1].parameterIndex&&
     transformed[0].field.node.typeId===transformed[1].field.node.typeId&&JSON.stringify(transformed[0].transform)===JSON.stringify(transformed[1].transform)&&
     (recordScope||transformed[0].cell?.arrayId===transformed[1].cell?.arrayId)){
     const a=transformed[0],component=`transformed:${JSON.stringify(a.transform)}`;
     components.set(component,{id:component,offset:a.field.offset,size:a.range.size,recordTypeId:a.field.node.typeId,typeId:a.field.node.typeId,arrayId:recordScope?null:a.cell?.arrayId??null,domain:'transformed-integer',transform:a.transform,valueType:a.transform.type});
     result={op:s.operator,args:tp[0].parameterIndex<tp[1].parameterIndex?[{component},{literal:'0'}]:[{literal:'0'},{component}]};
     proof.push({kind:'transformed-comparison',comparisonExecutionId:e.eventId,sourceNodeId:s.nodeId,component,transform:a.transform,
      operands:transformed.map(o=>({range:o.range,readExecutionId:o.readExecutionId,copyExecutionIds:o.copyExecutionIds,atExecutionId:c.events[o.at]?.eventId,transformedReads:o.transformedReads,transformEvidenceExecutionIds:o.transformEvidenceExecutionIds}))});
    }
    const ops=s.inputs.map(i=>c.operand(i,e,s)),par=ops.map(o=>parameter(o,ret.activationId));
    if(!result&&ops.every((o,i)=>o?.field&&preservesNumericOrder(c.byId.get(o.readExecutionId)?.value?.cType,s.inputs[i].value?.cType))&&ops[0].field.node.typeId===ops[1].field.node.typeId&&(recordScope||!ops[0].cell&&!ops[1].cell||ops[0].cell?.arrayId===ops[1].cell?.arrayId)&&ops[0].field.offset===ops[1].field.offset&&ops[0].range.size===ops[1].range.size&&par.every(Boolean)&&par[0].parameterIndex!==par[1].parameterIndex){
     const component=`${ops[0].field.offset}:${ops[0].range.size}`,typeId=ops[0].field.node.typeId;
     components.set(component,{id:component,offset:ops[0].field.offset,size:ops[0].range.size,typeId,arrayId:recordScope?null:ops[0].cell?.arrayId??null,recordTypeId:ops[0].field.node.typeId,valueType:c.byId.get(ops[0].readExecutionId).value?.cType,signedness:c.byId.get(ops[0].readExecutionId).value?.cType?.signedness});
     const v={component},z={literal:'0'};result={op:s.operator,args:par[0].parameterIndex<par[1].parameterIndex?[v,z]:[z,v]};
     proof.push({comparisonExecutionId:e.eventId,sourceNodeId:s.nodeId,operands:ops.map(o=>({range:o.range,readExecutionId:o.readExecutionId,copyExecutionIds:o.copyExecutionIds,atExecutionId:c.events[o.at]?.eventId})),component});
    }
   }
   if(!result&&['<','<=','>','>=','==','!=','&&','||','!','cast','-','+'].includes(s.operator)){
    const args=s.inputs.map(i=>input(i,e,s));if(args.length&&args.every(Boolean)){
     result=s.operator==='cast'?comparisonCast(args[0],s):{op:s.operator,args};
     if(args.some(a=>a.signOnly)&&!['cast','!','&&','||'].includes(s.operator)&&
       !(['<','<=','>','>=','==','!='].includes(s.operator)&&args.some(a=>a.literal==='0')))result=null;
     if(['-','+'].includes(s.operator)&&!fitsComparisonType(result,s.value?.cType))result=null;
    }
   }
   used.delete(s);return result;
  }
  function logical(n,e,depth=0){
   if(!n||depth>32)return {unknown:true};
   if(['ParenExpr','ImplicitCastExpr'].includes(n.kind)&&n.children?.length===1)return logical(n.children[0],e,depth+1);
   if(['&&','||'].includes(n.operator))return {op:n.operator,args:n.children.map(x=>logical(x,e,depth+1))};
   const step=e.steps?.find(s=>s.nodeId===n.nodeId);if(step)return reduceStep(e,step)??{unknown:true};
   if(n.kind==='IntegerLiteral')return {literal:String(n.literal)};return {unknown:true};
  }
  function expression(e){if(!e)return null;const chain=c.chain(e.eventId);
   for(const x of chain){if(x.action==='return.value')activations.add(x.activationId);for(const id of x.controlInputs??[])controls.add(id);}
   const producer=chain.find(x=>x.kind==='CALC'||strings.comparisons.has(x.eventId));
   if(strings.comparisons.has(producer?.eventId))return stringResult(strings.comparisons.get(producer.eventId));
   if(producer?.steps?.length)return reduceStep(producer,producer.steps.at(-1));
   const tail=chain.at(-1),literal=tail?.kind==='WRITE'&&!tail.dataInputs?.length?integerLiteral(tail.value):null;
   return literal!==null?{literal}:null;}
  const returned=expression(ret);if(!returned)continue;let guard={literal:'1'},valid=true;
  for(const id of controls){const b=c.byId.get(id);if(!activations.has(b?.activationId)||!['branch','conditional'].includes(b.action))continue;
   const expr=expression(c.byId.get(b.dataInputs?.[0]));if(!expr){valid=false;break;}
   guard={op:'&&',args:[guard,{op:num(b.condition??b.value)?'!=':'==',args:[expr,{literal:'0'}]}]};
  }
  if(!valid||!components.size||new Set([...components.values()].map(x=>x.recordTypeId)).size!==1||new Set([...components.values()].map(x=>x.arrayId)).size!==1)continue;
  const arrayId=[...components.values()][0].arrayId;
  const uses=comparatorUses(c,ret),bounds=comparisonBounds(returned),boolean=bounds&&bounds[0]>=0n&&bounds[1]<=1n;
  // Explicit zero comparisons outrank an assumed truth convention. Partial
  // constant-return paths of a three-way comparator must share that convention.
  const interpretations=uses.length?uses:boolean?[{operator:'truth',executionId:ret.eventId}]:[];
  for(const interpretation of interpretations){
  const result=interpretation.operator==='truth'?returned:{op:interpretation.operator,args:[returned,{literal:'0'}]},afterExecutionId=interpretation.executionId;
  const id=`composite-priority:${arrayId??[...components.values()][0].recordTypeId}:${call.resolvedFunctionId}:${interpretation.operator}`;
  if(!groups.has(id))groups.set(id,{id,arrayId,returnConvention:interpretation.operator,components:new Map(),paths:[],states:[],storageRanges:[]});const g=groups.get(id);
  for(const o of proof.flatMap(p=>p.operands)){const r=c.recordAt(o.range,c.pos.get(o.readExecutionId))?.range;if(r&&!g.storageRanges.some(x=>key(x)===key(r)))g.storageRanges.push(r);}g.paths.push({afterExecutionId,returnExecutionId:ret.eventId,components:[...components.values()],returned,result,interpretation,guard,comparisons:proof,controlExecutionIds:[...controls]});
  }
 }
 for(const g of groups.values()){
  const paths=g.paths.sort((a,b)=>c.pos.get(a.afterExecutionId)-c.pos.get(b.afterExecutionId));g.paths=[];
  for(const path of paths){
  g.paths.push(path);for(const f of path.components)g.components.set(f.id,f);
  const afterExecutionId=path.afterExecutionId,ret=c.byId.get(path.returnExecutionId);
  const fields=[...g.components.values()].sort((a,b)=>a.offset-b.offset),d=comparisonDiagram();let routing=d.unknown;
  const build=n=>n.unknown?d.unknown:n.literal!==undefined?d.constant(BigInt(n.literal)):n.component?(n.reversed?d.operation('-',[d.variable(fields.findIndex(f=>f.id===n.component))]):d.variable(fields.findIndex(f=>f.id===n.component))):d.operation(n.op,n.args.map(build));
  try{for(const p of g.paths){const route=d.apply('predicate-route',[build(p.guard),build(p.result)],(guard,result)=>guard===1n&&result!==null?(result===0n?1n:-1n):null);
    routing=d.apply('route-union',[routing,route],(a,b)=>a===null?b:b===null?a:a===b?a:2n);}
   const order=inferLexicographicOrder(d,routing,fields.map((_,i)=>i)),complete=![...d.terminals(routing)].some(v=>v===null||v===2n),
     observedKeyOrder=order?.map(o=>({...fields[o.index],direction:o.direction}))??null;
   // An observed primary-key path does not settle the unexecuted tie branch.
   // Keep its prefix separately; never promote it to a complete heap policy.
   g.states.push({afterExecutionId,status:order?(complete?'supported-observed':'incomplete'):'ambiguous',components:fields,
     keyOrder:complete?observedKeyOrder:null,observedKeyOrder,policyCoverage:complete?'complete-observed':'partial-observed',
     evidenceExecutionIds:unique(g.paths.flatMap(p=>[p.returnExecutionId,p.interpretation.executionId,...p.controlExecutionIds,...p.comparisons.flatMap(p=>[p.comparisonExecutionId,...p.operands.flatMap(o=>[o.readExecutionId,...o.copyExecutionIds])])]))});
  }catch(error){if(!(error instanceof RangeError))throw error;trace.inferenceBudget?.report('comparator-diagram',8192,ret.eventId);g.states.push({afterExecutionId,status:'incomplete',components:fields,keyOrder:null,evidenceExecutionIds:[ret.eventId],reason:error.message});}
  }
 }
 const result=[...groups.values()];cache.set(trace,{...cache.get(trace),plan,[recordScope?'records':'arrays']:result});return result;
}
