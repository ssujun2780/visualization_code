import {recordEvidence} from './record-evidence.mjs';
import {structureStateAt} from './state-history.mjs';
import {selectionEvidence} from './selection-evidence.mjs';
import {num,key,unique} from './storage-semantics.mjs';
const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
export function queryManagementRoles(trace,{recordTypeId,afterExecutionId}={}){
 const positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?trace.events.length-1:positions.get(afterExecutionId);if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
 return structuredClone(trace.structures.filter(s=>s.kind==='management-role-candidate'&&(!recordTypeId||s.recordTypeId===recordTypeId)&&positions.get(s.discoveredAtExecutionId)<=at).flatMap(s=>{const state=structureStateAt(s,positions,at,trace.objects);return !state||state.historyGap||state.lifetimeGap?[]:[{candidateId:s.id,role:s.role,binding:s.binding,leafHeight:s.leafHeight??null,mapping:s.mapping??null,origin:'inferred',evidenceExecutionIds:state.evidenceExecutionIds??[]}];}));
}
export function managementRoleStructures(plan,trace){
 const c=recordEvidence(plan,trace),groups=new Map(),writes=c.events.filter(e=>e.kind==='WRITE'&&e.action==='write'),partitions=c.structures.filter(s=>s.kind==='pointer-partition-candidate');
 function add(role,f,proof,extra={}){const id=`management:${f.node.typeId}:${f.offset}:${role}`;if(!groups.has(id))groups.set(id,{id,role,recordTypeId:f.node.typeId,binding:{kind:'record',recordTypeId:f.node.typeId,offset:f.offset,size:f.size},proofs:[],...extra});groups.get(id).proofs.push(proof);}
 for(const w of writes){const at=c.pos.get(w.eventId),f=c.fieldAt(w.target,at);if(!f||num(w.value)===null)continue;
  const deps=c.dependencies(w.dataInputs),calcs=deps.filter(e=>e.kind==='CALC'),selectors=selectionEvidence(c,w.dataInputs);
  for(const s of selectors.filter(s=>s.kind==='max')){
   const operands=s.sourceReadExecutionIds.map(id=>c.byId.get(id)).map(r=>({r,f:c.fieldAt(r.target,c.pos.get(r.eventId))})).filter(x=>x.f?.node.typeId===f.node.typeId&&x.f.offset===f.offset),
    links=c.edgesAt(at).filter(e=>e.recordFrom===f.node.id&&operands.some(x=>x.f.node.id===e.recordTo)),children=unique(links.map(e=>e.recordTo));
   const plus=calcs.find(e=>{const n=unwrap(c.defs.get(e.instructionId)?.expression);return n?.operator==='+'&&n.children?.some(x=>unwrap(x)?.kind==='IntegerLiteral'&&unwrap(x).literal==='1');});
   if(plus&&children.length>=2&&num(w.value)===Math.max(...operands.map(x=>num(x.r.value)))+1)add('height',f,{afterExecutionId:w.eventId,writeExecutionId:w.eventId,selector:s,childNodeIds:children,evidenceExecutionIds:unique([w.eventId,plus.eventId,s.comparisonExecutionId,...operands.map(x=>x.r.eventId),...links.map(e=>e.lastObservationExecutionId)])},{leafHeight:1});
  }
  const merge=partitions.flatMap(p=>p.operations).findLast(p=>p.kind==='merge'&&c.pos.get(p.writeExecutionId)<at&&c.byId.get(p.writeExecutionId).activationId===w.activationId&&p.toNodeId===f.node.id);
  if(merge){const related=c.comparisons.filter(p=>p.activationId===w.activationId&&c.pos.get(p.executionId)<at&&p.operands.every(o=>o?.field?.node.typeId===f.node.typeId&&o.field.offset===f.offset)&&new Set(p.operands.map(o=>o.field.node.id)).size===2&&p.operands.every(o=>[merge.fromNodeId,merge.toNodeId].includes(o.field.node.id))),
    equality=related.findLast(p=>p.operator==='=='&&p.truth===1&&w.controlInputs?.some(id=>c.byId.get(id)?.dataInputs?.includes(p.executionId))),
    increment=calcs.some(e=>(e.steps??[]).some(s=>s.operator==='++'||['+','+='].includes(s.operator)&&s.inputs.some(i=>!i.executionId&&num(i.value)===1))),
    reads=deps.filter(e=>e.kind==='READ').map(r=>({r,f:c.fieldAt(r.target,c.pos.get(r.eventId))})).filter(x=>x.f?.node.typeId===f.node.typeId&&x.f.offset===f.offset),
    from=reads.find(x=>x.f.node.id===merge.fromNodeId),to=reads.find(x=>x.f.node.id===merge.toNodeId);
   if(equality&&increment&&num(w.value)===c.scalar(w.target,at-1)+1)add('rank',f,{afterExecutionId:w.eventId,writeExecutionId:w.eventId,mergeExecutionId:merge.writeExecutionId,evidenceExecutionIds:[merge.writeExecutionId,equality.executionId,w.eventId,...equality.operands.map(o=>o.readExecutionId)]});
   if(from&&to&&calcs.some(e=>(e.steps??[]).some(s=>['+','+='].includes(s.operator)))&&num(w.value)===num(from.r.value)+num(to.r.value))add('component-size',f,{afterExecutionId:w.eventId,writeExecutionId:w.eventId,mergeExecutionId:merge.writeExecutionId,evidenceExecutionIds:[merge.writeExecutionId,from.r.eventId,to.r.eventId,w.eventId]});
  }
 }
 // Coupled state changes on siblings and their common parent are a colour-role
 // candidate. No red/black mapping or RB invariant follows from two constants.
 const byGuard=new Map();for(const w of writes)if(num(w.value)!==null)for(const guard of w.controlInputs??[]){const f=c.fieldAt(w.target,c.pos.get(w.eventId));if(!f)continue;const id=`${guard}:${f.node.typeId}:${f.offset}`;if(!byGuard.has(id))byGuard.set(id,[]);byGuard.get(id).push({w,f,guard});}
 for(const list of byGuard.values()){
  const at=c.pos.get(list.at(-1).w.eventId),guard=c.byId.get(list[0].guard),deps=c.dependencies(guard?.dataInputs),comparisons=deps.filter(e=>e.kind==='CALC').flatMap(e=>(e.steps??[]).filter(s=>s.operator==='==').map(s=>({e,s}))),reads=[];
  for(const {e,s}of comparisons)for(let i=0;i<2;i++){const r=c.flow.sourceReadOperand(s.inputs[i],e,s),constant=s.inputs[1-i];if(r&&!constant.executionId&&num(constant.value)!==null){const f=c.fieldAt(r.target,c.pos.get(r.eventId));if(f?.node.typeId===list[0].f.node.typeId&&f.offset===list[0].f.offset)reads.push({r,f,constant:num(constant.value),comparison:e.eventId});}}
  if(unique(reads.map(x=>x.f.node.id)).length<2)continue;const old=reads[0].constant;if(!reads.every(x=>x.constant===old))continue;
  const peers=list.filter(x=>reads.some(r=>r.f.node.id===x.f.node.id)&&num(x.w.value)!==old),newValues=unique(peers.map(x=>num(x.w.value)));if(peers.length<2||newValues.length!==1)continue;
  const edges=c.edgesAt(at),parent=list.find(x=>num(x.w.value)===old&&peers.every(p=>edges.some(e=>e.recordFrom===x.f.node.id&&e.recordTo===p.f.node.id)));if(!parent)continue;
  add('color',parent.f,{afterExecutionId:list.at(-1).w.eventId,writeExecutionId:parent.w.eventId,codes:[old,newValues[0]],peerNodeIds:unique(peers.map(x=>x.f.node.id)),parentNodeId:parent.f.node.id,evidenceExecutionIds:unique([guard.eventId,...reads.flatMap(x=>[x.r.eventId,x.comparison]),...list.map(x=>x.w.eventId)])},{mapping:null,classification:'coupled-state-role; colour interpretation unconfirmed'});
 }
 // A separate rank/size array must be indexed by the SAME returned
 // representatives. Equal indices or similarly sized arrays are insufficient.
 for(const partition of c.structures.filter(s=>s.kind==='representative-partition-candidate'))for(const merge of partition.operations.filter(p=>p.kind==='merge'&&p.addressReturnExecutionId&&p.valueReturnExecutionId)){
  const m=c.byId.get(merge.writeExecutionId),addressHas=(r,id)=>(r.addressInputs??[]).flatMap(c.chain).some(e=>e.eventId===id);
  for(const w of writes){const at=c.pos.get(w.eventId),slot=c.cell(w.target);if(w.activationId!==m.activationId||at<c.pos.get(m.eventId)||!slot||slot.arrayId===partition.arrayId||slot.index!==merge.toIndex)continue;
   const deps=c.dependencies(w.dataInputs),reads=deps.filter(e=>e.kind==='READ'&&c.cell(e.target)?.arrayId===slot.arrayId),
    a=reads.find(r=>c.cell(r.target).index===merge.fromIndex&&addressHas(r,merge.addressReturnExecutionId)),b=reads.find(r=>c.cell(r.target).index===merge.toIndex&&addressHas(r,merge.valueReturnExecutionId)),
    calcs=deps.filter(e=>e.kind==='CALC'),
    equality=c.comparisons.findLast(p=>p.activationId===w.activationId&&c.pos.get(p.executionId)<at&&p.operator==='=='&&p.truth===1&&w.controlInputs?.some(id=>c.byId.get(id)?.dataInputs?.includes(p.executionId))&&p.operands.every(o=>o?.cell?.arrayId===slot.arrayId)&&p.operands.some(o=>o.cell.index===merge.fromIndex&&addressHas(c.byId.get(o.readExecutionId),merge.addressReturnExecutionId))&&p.operands.some(o=>o.cell.index===merge.toIndex&&addressHas(c.byId.get(o.readExecutionId),merge.valueReturnExecutionId))),
    sum=a&&b&&calcs.some(e=>(e.steps??[]).some(s=>['+','+='].includes(s.operator)))&&num(w.value)===num(a.value)+num(b.value),
    increment=b&&equality&&calcs.some(e=>(e.steps??[]).some(s=>s.operator==='++'||['+','+='].includes(s.operator)&&s.inputs.some(i=>!i.executionId&&num(i.value)===1)))&&num(w.value)===num(b.value)+1;
   const role=sum?'component-size':increment?'rank':null;if(!role)continue;const id=`management:${slot.arrayId}:${slot.fieldOffset}:${role}`;
   if(!groups.has(id))groups.set(id,{id,role,arrayId:slot.arrayId,recordTypeId:null,binding:{kind:'array',arrayId:slot.arrayId},proofs:[]});
   groups.get(id).proofs.push({afterExecutionId:w.eventId,writeExecutionId:w.eventId,mergeExecutionId:m.eventId,evidenceExecutionIds:unique([m.eventId,w.eventId,...[a,b].filter(Boolean).map(r=>r.eventId),...(equality?[equality.executionId]:[])])});
  }
 }
 return [...groups.values()].map(g=>({...g,kind:'management-role-candidate',nodes:[],edges:[],intent:'unconfirmed',discoveredAtExecutionId:g.proofs[0].afterExecutionId,states:g.proofs.map((p,i)=>({afterExecutionId:p.afterExecutionId,status:'supported-observed-role',evidenceExecutionIds:unique(g.proofs.slice(0,i+1).flatMap(x=>x.evidenceExecutionIds))})),limitations:['role evidence is independent from structural correctness','unobserved policies and colour meanings require explicit binding']}));
}
