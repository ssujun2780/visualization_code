import {appendCandidateState,structureStateAt} from './state-history.mjs';
import {recordEvidence} from './record-evidence.mjs';
import {comparisonDiagram,inferLexicographicOrder,compareKeyValues} from './bst-key-order.mjs';
import {num,key,unique} from './storage-semantics.mjs';
import {priorityLinkLayouts,priorityEdgesAt} from './priority-relations.mjs';
// Comparator policy comes from symbolic operators and observed control paths,
// not from sorting the sampled values or from field/declaration order.
export function compositePriorityStructures(plan,trace){
 const c=recordEvidence(plan,trace),groups=new Map(),params=new Map();
 for(const e of c.events)if(e.action==='argument'&&e.target)params.set(e.target.objectId,e);
 // Match parameter identity through actual address provenance, including pointer
 // arguments. Equal numeric addresses alone cannot identify operand roles.
 const parameter=o=>{if(!o)return null;const read=c.byId.get(o.readExecutionId),direct=params.get(read?.target?.objectId);if(direct)return direct;
  const origins=(read?.addressInputs??[]).flatMap(c.chain).map(e=>params.get(e.target?.objectId)).filter(Boolean),uniqueOrigins=[...new Map(origins.map(e=>[e.eventId,e])).values()];return uniqueOrigins.length===1?uniqueOrigins[0]:null;};
 const trees=c.structures.filter(s=>s.kind==='index-tree');
 for(const ret of c.events.filter(e=>e.action==='return.value')){
  const call=c.byId.get(ret.callExecutionId);if(!call?.resolvedFunctionId)continue;
  const components=new Map(),proof=[],used=new Set(),local=c.events.filter(e=>e.activationId===ret.activationId),steps=new Map();
  for(const e of local)for(const s of e.steps??[])for(const id of s.observationIds??[s.observationId])if(id)steps.set(id,{e,s});
  function input(i,e,s){if(i.observationId&&steps.has(i.observationId)){const p=steps.get(i.observationId);if(p.s!==s)return reduceStep(p.e,p.s);}
   return i.executionId?expression(c.byId.get(i.executionId)):num(i.value)!==null?{literal:String(num(i.value))}:null;}
  function reduceStep(e,s){
   if(used.has(s))return null;used.add(s);let result=null;
   if(['<','<=','>','>=','==','!='].includes(s.operator)&&s.inputs.length===2){
    const ops=s.inputs.map(i=>c.operand(i,e,s)),par=ops.map(parameter);
    if(ops.every(o=>o?.field)&&ops[0].field.node.typeId===ops[1].field.node.typeId&&(!ops[0].cell&&!ops[1].cell||ops[0].cell?.arrayId===ops[1].cell?.arrayId)&&ops[0].field.offset===ops[1].field.offset&&ops[0].range.size===ops[1].range.size&&par.every(Boolean)&&par[0].parameterIndex!==par[1].parameterIndex){
     const component=`${ops[0].field.offset}:${ops[0].range.size}`,typeId=ops[0].field.node.typeId;
     components.set(component,{id:component,offset:ops[0].field.offset,size:ops[0].range.size,typeId,arrayId:ops[0].cell?.arrayId??null,recordTypeId:ops[0].field.node.typeId,valueType:c.byId.get(ops[0].readExecutionId).value?.cType,signedness:c.byId.get(ops[0].readExecutionId).value?.cType?.signedness});
     const v={component},z={literal:'0'};result={op:s.operator,args:par[0].parameterIndex<par[1].parameterIndex?[v,z]:[z,v]};
     proof.push({comparisonExecutionId:e.eventId,sourceNodeId:s.nodeId,operands:ops.map(o=>({range:o.range,readExecutionId:o.readExecutionId,copyExecutionIds:o.copyExecutionIds,atExecutionId:c.events[o.at]?.eventId})),component});
    }
   }
   if(!result&&['&&','||','!','cast'].includes(s.operator)){const args=s.inputs.map(i=>input(i,e,s));if(args.every(Boolean))result=s.operator==='cast'?args[0]:{op:s.operator,args};}
   used.delete(s);return result;
  }
  function expression(e){if(!e)return null;if(e.kind==='CALC'&&e.steps?.length)return reduceStep(e,e.steps.at(-1));
   const previous=c.chain(e.eventId).slice(1).find(x=>x.kind==='CALC');if(previous)return expression(previous);
   if(e.kind==='WRITE'&&e.dataInputs?.length===1)return expression(c.byId.get(e.dataInputs[0]));return null;}
  const result=expression(ret);if(!result||!components.size)continue;let guard={literal:'1'},valid=true;
  for(const id of ret.controlInputs??[]){const b=c.byId.get(id);if(b?.activationId!==ret.activationId||!['branch','conditional'].includes(b.action))continue;
   const expr=expression(c.byId.get(b.dataInputs?.[0]));if(!expr){valid=false;break;}
   guard={op:'&&',args:[guard,{op:num(b.condition??b.value)?'!=':'==',args:[expr,{literal:'0'}]}]};
  }
  if(!valid||new Set([...components.values()].map(x=>x.arrayId)).size!==1)continue;
  const arrayId=[...components.values()][0].arrayId;
  const id=`composite-priority:${arrayId??[...components.values()][0].recordTypeId}:${call.resolvedFunctionId}`;
  if(!groups.has(id))groups.set(id,{id,arrayId,components:new Map(),paths:[],states:[],storageRanges:[]});const g=groups.get(id);
  for(const [id,p]of components)g.components.set(id,p);for(const o of proof.flatMap(p=>p.operands)){const r=c.recordAt(o.range,c.pos.get(o.readExecutionId))?.range;if(r&&!g.storageRanges.some(x=>key(x)===key(r)))g.storageRanges.push(r);}g.paths.push({afterExecutionId:ret.eventId,returnExecutionId:ret.eventId,result,guard,comparisons:proof,controlExecutionIds:ret.controlInputs??[]});
  const fields=[...g.components.values()].sort((a,b)=>a.offset-b.offset),d=comparisonDiagram();let routing=d.unknown;
  const build=n=>n.literal!==undefined?d.constant(BigInt(n.literal)):n.component?d.variable(fields.findIndex(f=>f.id===n.component)):d.operation(n.op,n.args.map(build));
  try{for(const p of g.paths){const route=d.apply('predicate-route',[build(p.guard),build(p.result)],(guard,result)=>guard===1n&&result!==null?(result===0n?1n:-1n):null);
    routing=d.apply('route-union',[routing,route],(a,b)=>a===null?b:b===null?a:a===b?a:2n);}
   const order=inferLexicographicOrder(d,routing,fields.map((_,i)=>i));g.states.push({afterExecutionId:ret.eventId,status:order?'supported-observed':'ambiguous',components:fields,keyOrder:order?.map(o=>({...fields[o.index],direction:o.direction}))??null,evidenceExecutionIds:unique(g.paths.flatMap(p=>[p.returnExecutionId,...p.controlExecutionIds,...p.comparisons.flatMap(p=>[p.comparisonExecutionId,...p.operands.flatMap(o=>[o.readExecutionId,...o.copyExecutionIds])])]))});
  }catch(error){if(!(error instanceof RangeError))throw error;trace.inferenceBudget?.report('comparator-diagram',8192,ret.eventId);g.states.push({afterExecutionId:ret.eventId,status:'incomplete',components:fields,keyOrder:null,evidenceExecutionIds:[ret.eventId],reason:error.message});}
 }
 return [...groups.values()].map(g=>{
  const tree=trees.find(t=>t.arrayId===g.arrayId),array=c.arrays.find(a=>a.id===g.arrayId),policies=g.states;
  const objectIds=unique(array?[array.objectId]:g.storageRanges.map(r=>r.objectId)),ended=objectIds.map(id=>c.objects.find(o=>o.id===id)?.endedBy).filter(Boolean);
  const checkpoints=unique([...policies,...(tree?.states??[])].map(s=>s.afterExecutionId).concat(ended)).sort((a,b)=>c.pos.get(a)-c.pos.get(b));
  const states=checkpoints.flatMap(id=>{const at=c.pos.get(id),policy=policies.findLast(s=>c.pos.get(s.afterExecutionId)<=at),shape=tree&&structureStateAt(tree,c.pos,at,c.objects);if(!policy)return [];
   const active=shape?.activeRange,valid=!shape?.historyGap&&!shape?.lifetimeGap&&active?.status==='observed'&&active.count<=2048,indices=valid?Array.from({length:active.count},(_,i)=>active.start+i):[],
    nodes=indices.map(index=>({id:`priority:${g.arrayId}:${index}`,index,range:{objectId:array.objectId,offset:array.range.offset+index*array.elementBytes,size:array.elementBytes},values:policy.components.map(f=>c.payloadScalar({objectId:array.objectId,offset:array.range.offset+index*array.elementBytes+f.offset,size:f.size},at,{signed:f.signedness!=='unsigned',type:f.valueType}))})),members=new Map(nodes.map(n=>[n.index,n])),
    edges=nodes.filter(n=>n.index!==tree.descriptor.base).map(n=>({parent:Math.floor((n.index-tree.descriptor.firstChildOffset)/tree.descriptor.degree),child:n.index})),
    order=policy.keyOrder?.map(f=>({index:policy.components.findIndex(c=>c.id===f.id),direction:f.direction})),
    condition=direction=>{if(!valid||!order||nodes.some(n=>n.values.includes(null))||edges.some(e=>!members.has(e.parent)))return 'unknown';const signs=edges.map(e=>compareKeyValues(members.get(e.parent).values,members.get(e.child).values,order).sign);return signs.includes(null)?'unknown':signs.every(n=>n*direction<=0)?'satisfied':'violated';};
   return [{...policy,...(!objectIds.some(id=>c.alive(id,at))?{status:'ended'}:{}),afterExecutionId:id,alive:objectIds.some(id=>c.alive(id,at)),nodes,edges,min:condition(1),max:condition(-1),activeRange:active??null,evidenceExecutionIds:unique([...policy.evidenceExecutionIds,...(shape?[shape.afterExecutionId]:[])])}];});
  return {...g,components:[...g.components.values()],states,kind:'composite-priority-candidate',nodes:[],edges:[],intent:'unconfirmed',discoveredAtExecutionId:states[0].afterExecutionId,limitations:['observed comparator paths only; unknown policies are not executed','ordering policy is separate from current heap invariant']};
 });
}

export function pointerPriorityStructures(plan,trace,{maxStates=2048,maxNodes=2048}={}){
 const c=recordEvidence(plan,trace),groups=new Map();
 for(const p of c.comparisons){const [a,b]=p.operands;if(!['<','<=','>','>='].includes(p.operator)||!a?.field||!b?.field||a.field.node.id===b.field.node.id||a.field.node.typeId!==b.field.node.typeId||a.field.offset!==b.field.offset||a.range.size!==b.range.size)continue;
  const writes=c.events.filter(e=>e.activationId===p.activationId&&e.action==='write'&&c.pos.get(e.eventId)>c.pos.get(p.executionId)).map(e=>({e,f:c.fieldAt(e.target,c.pos.get(e.eventId))})).filter(x=>x.f?.node.typeId===a.field.node.typeId&&x.e.value?.cType?.kind==='pointer');
  if(!writes.length)continue;const id=`pointer-priority:${a.field.node.typeId}:${a.field.offset}`;
  if(!groups.has(id))groups.set(id,{id,typeId:a.field.node.typeId,key:{offset:a.field.offset,size:a.range.size,valueType:c.byId.get(a.readExecutionId).value?.cType,signedness:c.byId.get(a.readExecutionId).value?.cType?.signedness},proofs:[],states:[]});
  groups.get(id).proofs.push({comparisonExecutionId:p.executionId,sourceNodeId:p.sourceNodeId,readExecutionIds:[a.readExecutionId,b.readExecutionId],linkWrites:writes.map(x=>({executionId:x.e.eventId,offset:x.f.offset})),afterExecutionId:writes[0].e.eventId});
 }
 const results=[];
 for(const policy of groups.values()){
  const linkLayouts=priorityLinkLayouts(c,policy.typeId);
  const handles=new Map(),functions=new Set(policy.proofs.map(p=>{const ret=c.events.find(e=>e.action==='return.value'&&e.activationId===c.byId.get(p.comparisonExecutionId).activationId);return c.byId.get(ret?.callExecutionId)?.resolvedFunctionId;}).filter(Boolean));
  for(const w of c.events.filter(e=>e.action==='write'&&e.value?.cType?.kind==='pointer')){
   const o=c.objects.find(o=>o.id===w.target?.objectId);if(o?.cType?.kind!=='pointer'||w.target.offset!==0||w.target.size!==o.size)continue;
   const ret=(w.dataInputs??[]).flatMap(c.chain).find(e=>e.action==='return.value'&&functions.has(c.byId.get(e.callExecutionId)?.resolvedFunctionId));if(!ret)continue;
   const caller=c.events.find(e=>e.action==='enter'&&e.activationId===o.frameId);if(functions.has(caller?.functionId))continue;
   const k=key(w.target);if(!handles.has(k))handles.set(k,{...policy,id:`${policy.id}:${k}`,root:{...w.target,kind:'pointer-slot'},rootEvidence:w.eventId,states:[]});
  }
  for(const g of handles.values())for(const e of c.events){const at=c.pos.get(e.eventId),proofs=g.proofs.filter(p=>c.pos.get(p.afterExecutionId)<=at);if(!proofs.length||c.pos.get(g.rootEvidence)>at||!['SPACE','WRITE'].includes(e.kind))continue;
   const roles=new Set(proofs.flatMap(p=>p.linkWrites.filter(w=>c.pos.get(w.executionId)<=at).map(w=>w.offset))),all=c.edgesAt(at),handle=all.find(x=>key(x.source)===key(g.root)),eligible=all.filter(x=>roles.has(x.fieldOffset)&&x.recordFrom),ids=new Set(),pending=handle?.recordTo?[handle.recordTo]:[];
   while(pending.length&&ids.size<maxNodes){const id=pending.pop();if(ids.has(id))continue;ids.add(id);pending.push(...eligible.filter(x=>x.recordFrom===id&&x.recordTo).map(x=>x.recordTo));}
   const nodeLimit=pending.length>0;if(nodeLimit){g.truncated=true;trace.inferenceBudget?.report('priority-nodes',maxNodes,e.eventId);}
   const links=eligible.filter(x=>ids.has(x.recordFrom)),edges=links.filter(x=>x.recordTo&&ids.has(x.recordTo)),nodes=c.records.filter(n=>ids.has(n.id)).map(n=>({id:n.id,range:n.range,value:c.payloadScalar({objectId:n.range.objectId,offset:n.range.offset+g.key.offset,size:g.key.size},at,{signed:g.key.signedness!=='unsigned',type:g.key.valueType})})),values=new Map(nodes.map(n=>[n.id,n.value])),incoming=new Map();
   const projection=priorityEdgesAt(links,handle?.recordTo,linkLayouts.filter(p=>c.pos.get(p.afterExecutionId)<=at));
   for(const x of projection.edges)incoming.set(x.to,(incoming.get(x.to)??0)+1);
   const forest=!nodeLimit&&!!handle&&(handle.status==='null'||!!handle.recordTo)&&!projection.invalid&&links.every(x=>x.status==='null'||x.recordTo)&&nodes.every(n=>(incoming.get(n.id)??0)<=(n.id===handle.recordTo?0:1))&&projection.edges.length===Math.max(0,nodes.length-1),alive=c.alive(g.root.objectId,at),
    condition=sign=>{if(!forest||nodes.some(n=>n.value===null))return 'unknown';const signs=projection.edges.map(x=>compareKeyValues([values.get(x.from)],[values.get(x.to)],[{index:0,direction:1}]).sign);return signs.includes(null)?'unknown':signs.every(n=>n*sign<=0)?'satisfied':'violated';};
   appendCandidateState(g,{afterExecutionId:e.eventId,alive,nodes,edges,priorityEdges:projection.edges,priorityLayout:projection.layout,roots:handle?.recordTo?[handle.recordTo]:[],min:condition(1),max:condition(-1),status:!alive?'ended':forest?'observed-parent-order':'unknown',evidenceExecutionIds:unique([g.rootEvidence,...proofs.map(p=>p.comparisonExecutionId),...links.map(x=>x.lastObservationExecutionId),...projection.evidenceExecutionIds??[],handle?.lastObservationExecutionId].filter(Boolean))},maxStates);
  }
  results.push(...[...handles.values()].filter(g=>g.states.length));
 }
 return results.map(g=>({...g,kind:'pointer-priority-candidate',intent:'unconfirmed',nodes:[],edges:[],discoveredAtExecutionId:g.coverage.firstStateExecutionId,coverage:{...g.coverage,maxStates,maxNodes,truncated:!!g.truncated},limitations:['parent priority candidate; comparisons and link writes do not prove author intent','only nodes reachable from the current root handle; detached nodes stay in raw storage']}));
}
