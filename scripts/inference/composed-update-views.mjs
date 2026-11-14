import {appendCandidateState,structureStateAt} from './state-history.mjs';
import {recordEvidence} from './record-evidence.mjs';
import {affineUpdateStructures} from './affine-updates.mjs';
import {num,key,unique} from './storage-semantics.mjs';
import {callContext} from './call-context.mjs';
export function deferredUpdateStructures(plan,trace,{maxStates=2048}={}){
 const c=recordEvidence(plan,trace),calls=callContext(c.events),aggregates=c.structures.filter(s=>s.kind==='range-aggregate-candidate'),groups=new Map(),updates=[],neutral={'+':0,'*':1,'^':0,'|':0},pairedLayouts=new Map();
 const layout=(aggregate,index,at)=>{const st=structureStateAt(aggregate,c.pos,at,c.objects);if(st?.historyGap||st?.lifetimeGap)return null;const node=st?.nodes.find(n=>n.index===index);
   if(node?.coverage&&node.complete)return {node,afterExecutionId:st.afterExecutionId};
   const prior=pairedLayouts.get(`${aggregate.id}:${index}:${node?.writeExecutionId}`);
   // Assignment invalidates the aggregate VALUE proof. Its previously observed
   // interval is retained only across a witnessed paired tag application, and
   // only while that exact write is current. An unrelated overwrite breaks it.
   return prior&&node?.writeExecutionId===prior.writeExecutionId&&c.pos.get(prior.writeExecutionId)<=at?prior.shape:null;},
  sameIndex=(a,b)=>a.cell.index===b.cell.index&&c.dependencies(a.w.addressInputs).some(x=>x.kind==='READ'&&c.dependencies(b.w.addressInputs).some(y=>y.kind==='READ'&&c.identity(x.eventId,y.eventId)));
 for(const w of c.events){if(w.action!=='write')continue;const cell=c.cell(w.target);if(!cell)continue;
  const producer=c.byId.get(w.dataInputs?.[0]),calc=producer?.kind==='CALC'?producer:null,step=calc?.steps?.at(-1),operands=step?.inputs.map(i=>c.flow.sourceReadOperand(i,calc,step))??[],op=step?.operator?.replace(/=$/,'');
  let delta=null,operator=step?.operator??'assign';
  if(op in neutral&&operands[0]&&key(operands[0].target)===key(w.target)){delta=operands[1];operator=op;}
  else if(!calc&&producer?.kind==='READ')delta=producer;
  updates.push({w,cell,calc,delta,operator,dependencies:c.dependencies(w.dataInputs)});
 }
 for(const tag of updates){if(!tag.delta)continue;for(const update of updates){if(update===tag||!calls.common(update.w,tag.w)||!sameIndex(update,tag)||update.cell.arrayId===tag.cell.arrayId)continue;
   const aggregate=aggregates.find(s=>s.arrayId===update.cell.arrayId),shape=aggregate&&layout(aggregate,update.cell.index,c.pos.get(update.w.eventId)-1),node=shape?.node;
   if(!node?.coverage||!update.dependencies.some(e=>e.kind==='READ'&&c.identity(e.eventId,tag.delta.eventId)))continue;
   const id=`deferred-update:${aggregate.arrayId}:${tag.cell.arrayId}`;if(!groups.has(id))groups.set(id,{id,aggregateId:aggregate.id,arrayId:aggregate.arrayId,tagArrayId:tag.cell.arrayId,applications:[],propagations:[],states:[]});
   const after=[update.w.eventId,tag.w.eventId].sort((a,b)=>c.pos.get(a)-c.pos.get(b)).at(-1);
   const presenceWrites=updates.filter(p=>p.w.activationId===tag.w.activationId&&sameIndex(p,tag)&&p.cell.arrayId!==tag.cell.arrayId&&p.cell.arrayId!==update.cell.arrayId&&num(p.w.value)!==null&&num(p.w.value)!==0&&!p.w.dataInputs?.length).map(p=>p.w.eventId);
   groups.get(id).applications.push({index:update.cell.index,coverage:node.coverage,coverageEvidenceExecutionId:shape.afterExecutionId,aggregateOperator:update.operator,tagOperator:tag.operator,neutralValue:neutral[tag.operator]??null,presenceWriteExecutionIds:presenceWrites,aggregateWriteExecutionId:update.w.eventId,tagWriteExecutionId:tag.w.eventId,deltaReadExecutionId:tag.delta.eventId,afterExecutionId:after,evidenceExecutionIds:unique([update.w.eventId,tag.w.eventId,tag.delta.eventId,update.calc?.eventId,tag.calc?.eventId,shape.afterExecutionId].filter(Boolean))});
   pairedLayouts.set(`${aggregate.id}:${update.cell.index}:${update.w.eventId}`,{writeExecutionId:update.w.eventId,shape});
  }
 }
 // After a paired site establishes the array/index relationship, retain calls
 // at the SAME site which wrote the tag only. Availability is no earlier than
 // that proof; absent aggregate writes never become synthetic IR events.
 for(const g of groups.values()){
  const established=[...g.applications],aggregate=aggregates.find(s=>s.id===g.aggregateId);
  for(const tag of updates){if(!tag.delta||tag.cell.arrayId!==g.tagArrayId||g.applications.some(p=>p.tagWriteExecutionId===tag.w.eventId))continue;
   const proof=established.find(p=>c.byId.get(p.tagWriteExecutionId)?.instructionId===tag.w.instructionId&&p.tagOperator===tag.operator);if(!proof)continue;
   const at=c.pos.get(tag.w.eventId),shape=layout(aggregate,tag.cell.index,at);if(!shape)continue;
   const frame=c.events.filter(e=>e.activationId===tag.w.activationId),writes=frame.filter(e=>e.action==='write'&&c.cell(e.target)?.arrayId===g.arrayId&&c.cell(e.target)?.index===tag.cell.index);
   if(writes.length)continue;
   const end=frame.find(e=>e.action==='return')??frame.at(-1),after=[tag.w.eventId,end.eventId,proof.afterExecutionId].sort((a,b)=>c.pos.get(a)-c.pos.get(b)).at(-1);
   g.applications.push({index:tag.cell.index,coverage:shape.node.coverage,coverageEvidenceExecutionId:shape.afterExecutionId,aggregateOperator:null,aggregateEffect:'not-written',aggregateWriteExecutionId:null,
    tagOperator:tag.operator,neutralValue:neutral[tag.operator]??null,presenceWriteExecutionIds:[],tagWriteExecutionId:tag.w.eventId,deltaReadExecutionId:tag.delta.eventId,siteProofExecutionId:proof.afterExecutionId,
    frameEndExecutionId:end.eventId,completedAtExecutionId:end.eventId,afterExecutionId:after,evidenceExecutionIds:unique([tag.w.eventId,tag.delta.eventId,shape.afterExecutionId,end.eventId,...proof.evidenceExecutionIds])});
  }
  g.applications.sort((a,b)=>c.pos.get(a.tagWriteExecutionId)-c.pos.get(b.tagWriteExecutionId));
 }
 for(const g of groups.values()){
  const aggregate=aggregates.find(s=>s.id===g.aggregateId),tags=c.arrays.find(a=>a.id===g.tagArrayId);
  for(const clear of c.events.filter(e=>e.action==='write'&&num(e.value)!==null&&c.cell(e.target))){
   const parent=c.cell(clear.target).index,at=c.pos.get(clear.eventId),parentApp=g.applications.findLast(p=>p.index===parent&&c.pos.get(p.completedAtExecutionId??p.afterExecutionId)<at);if(!parentApp)continue;
   const tagRange={objectId:tags.objectId,offset:tags.range.offset+parent*tags.elementBytes,size:tags.elementBytes},sameTag=c.cell(clear.target).arrayId===g.tagArrayId;
   const presence=(parentApp.presenceWriteExecutionIds??[]).map(id=>c.byId.get(id)).find(w=>key(w.target)===key(clear.target)&&c.pos.get(w.eventId)<at);
   const guardRead=(clear.controlInputs??[]).flatMap(id=>c.dependencies(c.byId.get(id)?.dataInputs)).find(r=>r.kind==='READ'&&key(r.target)===key(clear.target)&&num(r.value)!==0);
   if(sameTag?parentApp.neutralValue===null||num(clear.value)!==parentApp.neutralValue:!presence||num(clear.value)!==0||!guardRead)continue;
   const shape=layout(aggregate,parent,at),node=shape?.node,childIndices=node?.topologyChildren?.map(ch=>ch.index)??[];
   // A later clear must not borrow applications from an earlier push or tag version.
   const floor=Math.max(c.pos.get(parentApp.tagWriteExecutionId),...g.propagations.filter(p=>p.index===parent).map(p=>c.pos.get(p.clearExecutionId)));
   const applications=g.applications.filter(p=>c.pos.get(p.tagWriteExecutionId)>floor&&c.pos.get(p.completedAtExecutionId??p.afterExecutionId)<at&&childIndices.includes(p.index)&&c.flow.reads(p.deltaReadExecutionId).some(r=>key(r.target)===key(tagRange)&&r.activationId===clear.activationId&&c.pos.get(r.eventId)>floor&&c.pos.get(r.eventId)<c.pos.get(p.tagWriteExecutionId)));
   const latest=childIndices.map(i=>applications.findLast(p=>p.index===i));if(childIndices.length<2||latest.some(p=>!p))continue;
   const parentReads=latest.map(p=>c.flow.reads(p.deltaReadExecutionId).find(r=>key(r.target)===key(tagRange)&&r.activationId===clear.activationId&&c.pos.get(r.eventId)>floor));
   if(parentReads.some(r=>!c.identity(r.eventId,parentReads[0].eventId)))continue;
   g.propagations.push({index:parent,childIndices,layoutEvidenceExecutionId:shape.afterExecutionId,applicationExecutionIds:latest.map(p=>p.afterExecutionId),sourceReadExecutionId:parentReads[0].eventId,clearKind:sameTag?'neutral-tag':'presence-flag',neutralValue:sameTag?parentApp.neutralValue:0,presenceWriteExecutionId:presence?.eventId??null,guardReadExecutionId:guardRead?.eventId??null,clearExecutionId:clear.eventId,occurredAtExecutionId:clear.eventId,afterExecutionId:[clear.eventId,parentApp.afterExecutionId,...latest.map(p=>p.afterExecutionId)].sort((a,b)=>c.pos.get(a)-c.pos.get(b)).at(-1),evidenceExecutionIds:unique([clear.eventId,parentReads[0].eventId,presence?.eventId,guardRead?.eventId,...parentApp.evidenceExecutionIds,...latest.flatMap(p=>p.evidenceExecutionIds)].filter(Boolean))});
  }
  for(const e of c.events){const at=c.pos.get(e.eventId),apps=g.applications.filter(p=>c.pos.get(p.afterExecutionId)<=at);if(!apps.length||!['WRITE','SPACE'].includes(e.kind))continue;
   const prop=g.propagations.filter(p=>c.pos.get(p.afterExecutionId)<=at),presenceIds=unique(prop.filter(p=>p.clearKind==='presence-flag').map(p=>c.cell(c.byId.get(p.clearExecutionId).target).arrayId)),presenceArray=presenceIds.length===1?c.arrays.find(a=>a.id===presenceIds[0]):null;
   const indices=unique(apps.map(p=>p.index)),nodes=indices.map(index=>{const presenceRange=presenceArray?{objectId:presenceArray.objectId,offset:presenceArray.range.offset+index*presenceArray.elementBytes,size:presenceArray.elementBytes}:null,value=presenceRange?c.scalar(presenceRange,at):null;return {index,range:{objectId:tags.objectId,offset:tags.range.offset+index*tags.elementBytes,size:tags.elementBytes},pending:c.scalar({objectId:tags.objectId,offset:tags.range.offset+index*tags.elementBytes,size:tags.elementBytes},at),presenceRange,present:value===null?null:value!==0};});
   appendCandidateState(g,{afterExecutionId:e.eventId,alive:c.alive(tags.objectId,at),status:prop.length?'observed-propagation':'coupled-update-candidate',nodes,evidenceExecutionIds:unique([...apps,...prop].flatMap(p=>p.evidenceExecutionIds))},maxStates);

  }
 }
 return [...[...groups.values()].filter(g=>g.states.length).map(g=>({...g,kind:'deferred-update-candidate',nodes:[],edges:[],intent:'unconfirmed',discoveredAtExecutionId:g.coverage.firstStateExecutionId,coverage:g.coverage,limitations:['actual aggregate and tag values only; deferred child updates are not fabricated','coupled updates alone do not prove lazy propagation; observed push and clear are separate evidence']})),...affineUpdateStructures(plan,trace,{maxStates})];
}

// A conditional record selection can be related to component merging without
// naming the algorithm or asserting that the selected records form an MST.
export function partitionSelectionStructures(plan,trace){
 const c=recordEvidence(plan,trace),groups=new Map(),partitions=c.structures.filter(s=>['representative-partition-candidate','pointer-partition-candidate'].includes(s.kind));
 for(const copy of c.events.filter(e=>e.action==='copy')){
  const source=c.cell({objectId:copy.sourceObjectId,offset:copy.sourceOffset,size:copy.sourceSize}),dest=c.cell(copy.target);if(!source||!dest||source.arrayId===dest.arrayId)continue;
  const array=c.arrays.find(a=>a.id===source.arrayId);if(array.elementType?.kind!=='record'||copy.sourceSize!==array.elementBytes)continue;
  for(const p of partitions)for(const merge of p.operations.filter(m=>m.kind==='merge'&&c.pos.get(m.writeExecutionId)<c.pos.get(copy.eventId))){
   const w=c.byId.get(merge.writeExecutionId),shared=(w.controlInputs??[]).filter(id=>copy.controlInputs?.includes(id));if(!shared.length)continue;
   const returns=[merge.valueReturnExecutionId,merge.addressReturnExecutionId];if(returns.some(id=>!id))continue;
   const condition=shared.map(id=>c.byId.get(id)).find(b=>(b.dataInputs??[]).flatMap(c.chain).some(e=>e.kind==='CALC'&&e.steps?.some(s=>['!=','=='].includes(s.operator)&&s.inputs.every(i=>{const r=c.flow.sourceReadOperand(i,e,s);return r&&c.chain(r.eventId).some(x=>returns.includes(x.eventId));}))));
   if(!condition)continue;
   const inputProof=returns.map(id=>{const ret=c.byId.get(id),call=c.byId.get(ret?.callExecutionId);return (call?.dataInputs??[]).flatMap(c.chain).find(r=>r.kind==='READ'&&c.cell(r.target)?.arrayId===source.arrayId&&c.cell(r.target).index===source.index);});
   if(inputProof.some(x=>!x)||key(inputProof[0].target)===key(inputProof[1].target))continue;
   const id=`partition-selection:${p.id}:${source.arrayId}:${dest.arrayId}`;if(!groups.has(id))groups.set(id,{id,partitionId:p.id,sourceArrayId:source.arrayId,targetArrayId:dest.arrayId,selections:[],states:[]});
   groups.get(id).selections.push({sourceIndex:source.index,targetIndex:dest.index,sourceRange:{objectId:copy.sourceObjectId,offset:copy.sourceOffset,size:copy.sourceSize},targetRange:copy.target,copyExecutionId:copy.eventId,mergeExecutionId:merge.writeExecutionId,endpointReadExecutionIds:inputProof.map(r=>r.eventId),conditionExecutionId:condition.eventId,afterExecutionId:copy.eventId,evidenceExecutionIds:[copy.eventId,merge.writeExecutionId,...returns,...inputProof.map(r=>r.eventId),condition.eventId]});break;
  }
 }
 return [...groups.values()].map(g=>({...g,kind:'partition-selection-candidate',nodes:[],edges:[],intent:'unconfirmed',states:g.selections.map((s,i)=>({afterExecutionId:s.afterExecutionId,selections:g.selections.slice(0,i+1),status:'observed-controlled-selection',evidenceExecutionIds:unique(g.selections.slice(0,i+1).flatMap(s=>s.evidenceExecutionIds))})),discoveredAtExecutionId:g.selections[0].afterExecutionId,limitations:['copy identity and representative-controlled selection only','no algorithm name, minimum-cost guarantee or inferred completion colouring']}));
}
