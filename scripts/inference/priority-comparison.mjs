import {transformedKeyValue} from './transformed-key.mjs';
import {isByteKey} from './key-memory.mjs';
import {appendCandidateState,structureStateAt} from './state-history.mjs';
import {recordEvidence} from './record-evidence.mjs';
import {compareKeyValues} from './bst-key-order.mjs';
import {num,key,unique} from './storage-semantics.mjs';
import {priorityLinkLayouts,priorityEdgesAt} from './priority-relations.mjs';
import {priorityStringEvidence} from './priority-string-evidence.mjs';
import {indexLayoutEvidence} from './index-layout-evidence.mjs';
import {comparisonPolicies} from './priority-policy.mjs';
import {pointerPolicyStructures} from './pointer-policy-views.mjs';
// Comparator policy comes from symbolic operators and observed control paths,
// not from sorting the sampled values or from field/declaration order.
export function compositePriorityStructures(plan,trace){
 const c=recordEvidence(plan,trace),groups=comparisonPolicies(plan,trace),strings=priorityStringEvidence(plan,trace,c),trees=c.structures.filter(s=>s.kind==='index-tree');
 return groups.map(g=>{
  const shapes=trees.filter(t=>t.arrayId===g.arrayId),array=c.arrays.find(a=>a.id===g.arrayId),policies=g.states;
 const objectIds=unique(array?[array.objectId]:g.storageRanges.map(r=>r.objectId)),ended=objectIds.map(id=>c.objects.find(o=>o.id===id)?.endedBy).filter(Boolean),
  stringChanges=[...g.components.values()].some(f=>isByteKey(f))?c.events.filter(e=>['WRITE','SPACE'].includes(e.kind)).map(e=>e.eventId):[];
 const checkpoints=unique([...policies,...shapes.flatMap(t=>t.states??[])].map(s=>s.afterExecutionId).concat(ended,stringChanges)).sort((a,b)=>c.pos.get(a)-c.pos.get(b));
  const states=checkpoints.flatMap(id=>{const at=c.pos.get(id),policy=policies.findLast(s=>c.pos.get(s.afterExecutionId)<=at);if(!policy)return [];
   const eligible=shapes.flatMap(tree=>{
     const proof=indexLayoutEvidence(c,tree,at),shape=structureStateAt(tree,c.pos,at,c.objects),active=shape?.activeRange;
     return proof&&(!proof.relocationExecutionIds.length||active?.status==='observed'&&array.range.offset+(active.start+active.count)*array.elementBytes<=proof.retainedBytes)?[{tree,proof,shape}]:[];
   }),layouts=new Set(eligible.map(x=>JSON.stringify([x.tree.descriptor.degree,x.tree.descriptor.base,x.tree.descriptor.firstChildOffset]))),
    selected=layouts.size===1?eligible[0]:null,tree=selected?.tree,shape=selected?.shape,
    active=shape?.activeRange,alive=objectIds.some(id=>c.alive(id,at)),valid=alive&&!shape?.historyGap&&!shape?.lifetimeGap&&active?.status==='observed'&&active.count<=2048,indices=valid?Array.from({length:active.count},(_,i)=>active.start+i):[],
    valueEvidence=[],nodes=indices.map(index=>({id:`priority:${g.arrayId}:${index}`,index,range:{objectId:array.objectId,offset:array.range.offset+index*array.elementBytes,size:array.elementBytes},values:policy.components.map(f=>{
     const range={objectId:array.objectId,offset:array.range.offset+index*array.elementBytes+f.offset,size:f.size};
     if(f.transform)return transformedKeyValue(c,f,range,at);
     if(isByteKey(f)){const v=strings.value(f,range,at);valueEvidence.push(...v.evidence);return v.value;}
     return c.payloadScalar(range,at,{signed:f.signedness!=='unsigned',type:f.valueType});
    })})),members=new Map(nodes.map(n=>[n.index,n])),
    edges=nodes.filter(n=>n.index!==tree.descriptor.base).map(n=>({parent:Math.floor((n.index-tree.descriptor.firstChildOffset)/tree.descriptor.degree),child:n.index})),
    order=policy.keyOrder?.map(f=>({index:policy.components.findIndex(c=>c.id===f.id),direction:f.direction})),
    condition=direction=>{if(!valid||!order||nodes.some(n=>n.values.includes(null))||edges.some(e=>!members.has(e.parent)))return 'unknown';const signs=edges.map(e=>compareKeyValues(members.get(e.parent).values,members.get(e.child).values,order).sign);return signs.includes(null)?'unknown':signs.every(n=>n*direction<=0)?'satisfied':'violated';};
   return [{...policy,...(!alive?{status:'ended'}:{}),afterExecutionId:id,alive,nodes,edges,min:condition(1),max:condition(-1),activeRange:active??null,
     indexStructureId:tree?.id??null,indexRelation:shape?{sourceStructureId:tree.id,afterExecutionId:shape.afterExecutionId}:null,
     layoutEvidence:selected?.proof??null,layoutStatus:layouts.size>1?'ambiguous':tree?'observed':'unobserved',
     evidenceExecutionIds:unique([...policy.evidenceExecutionIds,...valueEvidence,...(shape?[shape.afterExecutionId]:[]),
       ...(selected?[selected.proof.executionId,...selected.proof.observedAccessExecutionIds,...selected.proof.derivedAccessExecutionIds,...selected.proof.relocationExecutionIds]:[])])}];});
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
   const owner=trace.frames?.find(f=>f.id===o.frameId);if(functions.has(owner?.functionId))continue;
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
 return [...results.map(g=>({...g,kind:'pointer-priority-candidate',intent:'unconfirmed',nodes:[],edges:[],discoveredAtExecutionId:g.coverage.firstStateExecutionId,coverage:{...g.coverage,maxStates,maxNodes,truncated:!!g.truncated},limitations:['parent priority candidate; comparisons and link writes do not prove author intent','only nodes reachable from the current root handle; detached nodes stay in raw storage']})),...pointerPolicyStructures(plan,trace,{maxStates,maxNodes})];
}
