import {transformedKeyValue} from './transformed-key.mjs';
import {isByteKey} from './key-memory.mjs';
import {recordEvidence,overlaps} from './record-evidence.mjs';
import {key,unique} from './storage-semantics.mjs';
import {comparisonPolicies} from './priority-policy.mjs';
import {priorityStringEvidence} from './priority-string-evidence.mjs';
import {priorityLinkLayouts,priorityEdgesAt} from './priority-relations.mjs';
import {compareKeyValues} from './bst-key-order.mjs';
import {appendCandidateState} from './state-history.mjs';
import {callContext} from './call-context.mjs';

// A comparator alone is not evidence of a linked heap. Require its recorded
// use in control flow and subsequent links touching the compared records.
export function pointerPolicyLinks(c,policy){
 const calls=callContext(c.events),typeId=[...policy.components.values()][0]?.recordTypeId,proofs=[];
 for(const p of policy.paths){
  const ret=c.byId.get(p.returnExecutionId),call=c.byId.get(ret.callExecutionId),caller=call?.activationId;if(!caller)continue;
  const operands=new Set(p.comparisons.flatMap(q=>q.operands).map(o=>c.recordAt(o.range,c.pos.get(o.atExecutionId??o.readExecutionId))?.id).filter(Boolean));
  const branch=c.events.find(e=>['branch','conditional'].includes(e.action)&&e.activationId===caller&&c.pos.get(e.eventId)>c.pos.get(ret.eventId)&&
   c.dependencies(e.dataInputs).some(x=>x.eventId===ret.eventId));if(!branch)continue;
  const writes=c.events.filter(e=>e.action==='write'&&e.value?.cType?.kind==='pointer'&&c.pos.get(e.eventId)>c.pos.get(branch.eventId)&&calls.lineage(e).includes(caller)).flatMap(e=>{
   const field=c.fieldAt(e.target,c.pos.get(e.eventId)),target=c.pointerNode(e.value,c.pos.get(e.eventId)),pointee=e.value.cType.pointee;
   if(field?.node.typeId!==typeId||!(target?.typeId===typeId||pointee?.kind==='record'&&(pointee.recordTypeId??pointee.id)===typeId)||
    !operands.has(field.node.id)&&!operands.has(target?.id))return [];
   return [{executionId:e.eventId,offset:field.offset}];
  });
  if(writes.length)proofs.push({returnExecutionId:ret.eventId,branchExecutionId:branch.eventId,consumerActivationId:caller,
   comparisonExecutionId:p.afterExecutionId,readExecutionIds:unique(p.comparisons.flatMap(q=>q.operands.map(o=>o.readExecutionId))),
   linkWrites:writes,afterExecutionId:writes[0].executionId});
 }
 return proofs;
}

export function pointerPolicyStructures(plan,trace,{maxStates=2048,maxNodes=2048}={}){
 const c=recordEvidence(plan,trace),strings=priorityStringEvidence(plan,trace,c),results=[];
 for(const policy of comparisonPolicies(plan,trace,{recordScope:true})){
  const proofs=pointerPolicyLinks(c,policy);if(!proofs.length)continue;
  const typeId=[...policy.components.values()][0].recordTypeId,linkLayouts=priorityLinkLayouts(c,typeId),
   consumers=new Set(proofs.map(p=>p.consumerActivationId)),functions=new Set(c.events.filter(e=>e.action==='return.value'&&consumers.has(e.activationId)).map(e=>c.byId.get(e.callExecutionId)?.resolvedFunctionId).filter(Boolean)),handles=new Map();
  for(const w of c.events.filter(e=>e.action==='write'&&e.value?.cType?.kind==='pointer')){
   const o=c.objects.find(o=>o.id===w.target?.objectId);if(o?.cType?.kind!=='pointer'||w.target.offset!==0||w.target.size!==o.size)continue;
   const ret=(w.dataInputs??[]).flatMap(c.chain).find(e=>e.action==='return.value'&&consumers.has(e.activationId));if(!ret)continue;
   const owner=trace.frames?.find(f=>f.id===o.frameId);if(functions.has(owner?.functionId))continue;
   const id=key(w.target);if(!handles.has(id))handles.set(id,{id:`pointer-policy:${policy.id}:${id}`,kind:'pointer-priority-candidate',intent:'unconfirmed',typeId,
    comparisonPolicy:{functionId:c.byId.get(c.byId.get(policy.paths[0].returnExecutionId).callExecutionId).resolvedFunctionId,recordTypeId:typeId,returnConvention:policy.returnConvention},
    returnConvention:policy.returnConvention,components:[...policy.components.values()],paths:policy.paths,proofs,root:{...w.target,kind:'pointer-slot'},rootEvidence:w.eventId,nodes:[],edges:[],states:[]});
  }
  const policyCheckpoints=new Set(policy.states.map(s=>s.afterExecutionId)),linkedCheckpoints=new Set(proofs.map(p=>p.afterExecutionId)),byteKeys=[...policy.components.values()].some(isByteKey);
  const recordObjects=new Set(c.records.filter(n=>n.typeId===typeId).map(n=>n.range.objectId));
  for(const g of handles.values())for(const e of c.events){
   const at=c.pos.get(e.eventId),known=proofs.filter(p=>c.pos.get(p.afterExecutionId)<=at),current=policy.states.findLast(s=>c.pos.get(s.afterExecutionId)<=at);
   if(!known.length||!current||c.pos.get(g.rootEvidence)>at||!['WRITE','SPACE'].includes(e.kind)&&!policy.states.some(s=>s.afterExecutionId===e.eventId))continue;
   // A local loop counter or unrelated parameter write cannot change this
   // heap. Retain every storage/lifetime/policy change, including transient
   // violations, rather than duplicating it for unrelated execution events.
   if(!byteKeys&&!policyCheckpoints.has(e.eventId)&&!linkedCheckpoints.has(e.eventId)&&!overlaps(e.target,g.root)&&
    !recordObjects.has(e.target?.objectId)&&!recordObjects.has(e.objectId)&&e.objectId!==g.root.objectId)continue;
   const roles=new Set(known.flatMap(p=>p.linkWrites.filter(w=>c.pos.get(w.executionId)<=at).map(w=>w.offset))),all=c.edgesAt(at),handle=all.find(x=>key(x.source)===key(g.root)),
    stored=all.filter(x=>roles.has(x.fieldOffset)&&x.recordFrom&&c.records.find(n=>n.id===x.recordFrom)?.typeId===typeId),ids=new Set(),pending=handle?.recordTo?[handle.recordTo]:[];
   while(pending.length&&ids.size<maxNodes){const id=pending.pop();if(ids.has(id))continue;ids.add(id);pending.push(...stored.filter(x=>x.recordFrom===id&&x.recordTo).map(x=>x.recordTo));}
   const truncated=pending.length>0;if(truncated)trace.inferenceBudget?.report('priority-nodes',maxNodes,e.eventId);
   const links=stored.filter(x=>ids.has(x.recordFrom)),edges=links.filter(x=>x.recordTo&&ids.has(x.recordTo)),valueEvidence=[],nodes=c.records.filter(n=>ids.has(n.id)).map(n=>({id:n.id,range:n.range,
    values:current.components.map(f=>{const r={...n.range,offset:n.range.offset+f.offset,size:f.size};if(f.transform)return transformedKeyValue(c,f,r,at);if(isByteKey(f)){const v=strings.value(f,r,at);valueEvidence.push(...v.evidence);return v.value;}return c.payloadScalar(r,at,{signed:f.signedness!=='unsigned',type:f.valueType});})})),
    projection=priorityEdgesAt(links,handle?.recordTo,linkLayouts.filter(p=>c.pos.get(p.afterExecutionId)<=at)),incoming=new Map();
   for(const edge of projection.edges)incoming.set(edge.to,(incoming.get(edge.to)??0)+1);
   const forest=!truncated&&!!handle&&(handle.status==='null'||!!handle.recordTo)&&!projection.invalid&&links.every(x=>x.status==='null'||x.recordTo)&&
    nodes.every(n=>(incoming.get(n.id)??0)<=(n.id===handle.recordTo?0:1))&&projection.edges.length===Math.max(0,nodes.length-1),
    order=current.keyOrder?.map(f=>({index:current.components.findIndex(c=>c.id===f.id),direction:f.direction})),values=new Map(nodes.map(n=>[n.id,n.values])),alive=c.alive(g.root.objectId,at),
    condition=sign=>{if(!alive||!forest||!order||nodes.some(n=>n.values.includes(null)))return 'unknown';const signs=projection.edges.map(x=>compareKeyValues(values.get(x.from),values.get(x.to),order).sign);return signs.includes(null)?'unknown':signs.every(n=>n*sign<=0)?'satisfied':'violated';};
   appendCandidateState(g,{...current,afterExecutionId:e.eventId,alive,nodes,edges,priorityEdges:projection.edges,priorityLayout:projection.layout,roots:handle?.recordTo?[handle.recordTo]:[],
    min:condition(1),max:condition(-1),status:!alive?'ended':forest?current.status:'unknown',evidenceGap:truncated,
    evidenceExecutionIds:unique([...current.evidenceExecutionIds,g.rootEvidence,...valueEvidence,...known.flatMap(p=>[p.comparisonExecutionId,p.branchExecutionId]),...links.map(x=>x.lastObservationExecutionId),...projection.evidenceExecutionIds??[],handle?.lastObservationExecutionId].filter(Boolean))},maxStates);
  }
  for(const g of handles.values())if(g.states.length)results.push({...g,discoveredAtExecutionId:g.coverage.firstStateExecutionId,limitations:['observed comparator policy and reachable links; intent unconfirmed']});
 }
 return results;
}
