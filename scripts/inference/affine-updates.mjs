import {recordEvidence,overlaps} from './record-evidence.mjs';
import {recordedIntegerExpression,evaluateIntegerExpression} from './integer-expression.mjs';
import {key,num,unique} from './storage-semantics.mjs';
import {appendCandidateState} from './state-history.mjs';
import {callContext} from './call-context.mjs';
import {verificationStates} from './history-evidence.mjs';

// Record composition of (multiply, add) tags. The aggregate's real expression
// is retained; deferred child values are never computed into the trace.
export function affineUpdateStructures(plan,trace,{maxStates=2048}={}){
 const c=recordEvidence(plan,trace),calls=callContext(c.events),arrays=new Map(c.arrays.map(a=>[a.id,a])),groups=new Map(),updates=[];
 const roots=c.structures.filter(s=>s.kind==='range-aggregate-candidate');
 const histories=new Map(roots.map(g=>[g.id,verificationStates(g,c.pos)]));
 const layout=(g,index,at)=>histories.get(g.id).findLast(s=>c.pos.get(s.afterExecutionId)<=at)?.nodes.find(n=>n.index===index);
 const stamp=(expr,n)=>n.kind==='input'?`read:${c.chain(expr.leaves[n.slot].read.eventId).at(-1)?.eventId}`:n.kind==='literal'?JSON.stringify(n):`${n.operator}(${n.args.map(x=>stamp(expr,x)).join(',')})`;
 const isSelf=(expr,n,target)=>n.kind==='input'&&key(expr.leaves[n.slot].read.target)===key(target);
 function split(expr,target){let n=expr.tree;while(n.operator==='cast')n=n.args[0];let product=n,delta=null;
  if(n.operator==='+'){product=n.args.find(x=>x.operator==='*'&&x.args.some(a=>isSelf(expr,a,target)));delta=n.args.find(x=>x!==product);}
  if(product?.operator!=='*')return null;const self=product.args.find(x=>isSelf(expr,x,target)),factor=product.args.find(x=>x!==self);
  if(!self||!factor)return null;return {factor,delta,factorId:stamp(expr,factor),deltaId:delta&&stamp(expr,delta)};
 }
 for(const w of c.events){const cell=w.action==='write'&&c.cell(w.target);if(!cell||!w.dataInputs?.length)continue;
  const expr=recordedIntegerExpression(c,{executionId:w.dataInputs[0]},w,null,r=>!c.cell(r.target)&&c.chain(r.eventId).slice(1).some(x=>x.kind==='READ'&&c.cell(x.target))?null:{});if(!expr)continue;const form=split(expr,w.target);if(form)updates.push({w,cell,expr,...form});
 }
 const evalPart=(u,n)=>evaluateIntegerExpression(n,x=>num(u.expr.leaves[x.slot].read.value));
 const inputIds=(u,n)=>n.kind==='input'?[u.expr.leaves[n.slot].read.eventId]:n.kind==='operation'?unique(n.args.flatMap(x=>inputIds(u,x))):[];
 const writesBySlot=new Map();for(const e of c.events)if(e.action==='write'){const k=key(e.target);if(!writesBySlot.has(k))writesBySlot.set(k,[]);writesBySlot.get(k).push(e);}
 // One composition uses one version of each destination. Repeated helper
 // calls sharing parameter origins must not cross-pair different updates.
 const cohesive=parts=>{const ids=new Set(parts.map(p=>p.w.eventId)),positions=parts.map(p=>c.pos.get(p.w.eventId)),lo=Math.min(...positions),hi=Math.max(...positions);
  return parts.every(p=>writesBySlot.get(key(p.w.target)).every(w=>c.pos.get(w.eventId)<lo||c.pos.get(w.eventId)>hi||ids.has(w.eventId)));};
 for(const m of updates.filter(u=>!u.delta))for(const a of updates.filter(u=>u.delta)){
  if(m.cell.arrayId===a.cell.arrayId||m.cell.index!==a.cell.index||!calls.common(m.w,a.w)||m.factorId!==a.factorId)continue;
  const scope=calls.common(m.w,a.w);if(m.w.activationId!==a.w.activationId&&!calls.parents.has(scope))continue;
  const aggregateUpdate=updates.find(u=>calls.lineage(u.w).includes(scope)&&u.cell.index===m.cell.index&&u.cell.arrayId!==m.cell.arrayId&&u.cell.arrayId!==a.cell.arrayId&&u.factorId===m.factorId&&u.delta&&
   (u.deltaId===a.deltaId||u.delta.operator==='*'&&u.delta.args.some(x=>stamp(u.expr,x)===a.deltaId))&&roots.some(g=>g.arrayId===u.cell.arrayId)&&cohesive([m,a,u]));
  if(!aggregateUpdate)continue;const aggregate=roots.find(g=>g.arrayId===aggregateUpdate.cell.arrayId),at=c.pos.get(aggregateUpdate.w.eventId),node=layout(aggregate,m.cell.index,at);
  const shape=histories.get(aggregate.id).findLast(st=>c.pos.get(st.afterExecutionId)<=at&&st.nodes.some(n=>n.index===m.cell.index&&n.coverage));if(!node?.coverage||!shape)continue;
  const mul=evalPart(m,m.factor),add=evalPart(a,a.delta);if(mul===null||add===null)continue;
  const id=`affine-update:${aggregate.id}:${m.cell.arrayId}:${a.cell.arrayId}`;
  if(!groups.has(id))groups.set(id,{id,kind:'deferred-update-candidate',tagSchema:'affine-pair',intent:'unconfirmed',aggregateId:aggregate.id,arrayId:aggregate.arrayId,tagArrayId:m.cell.arrayId,tagAddArrayId:a.cell.arrayId,applications:[],propagations:[],states:[],nodes:[],edges:[]});
  const after=[m.w.eventId,a.w.eventId,aggregateUpdate.w.eventId].sort((x,y)=>c.pos.get(x)-c.pos.get(y)).at(-1);
  groups.get(id).applications.push({index:m.cell.index,coverage:node.coverage,coverageEvidenceExecutionId:shape.afterExecutionId,afterExecutionId:after,
   tagWriteExecutionId:m.w.eventId,addWriteExecutionId:a.w.eventId,aggregateWriteExecutionId:aggregateUpdate.w.eventId,
   composition:'new-after-old',scopeActivationId:scope,multiplier:mul,addition:add,tagExpressions:[m.expr.tree,a.expr.tree],aggregateExpression:aggregateUpdate.expr.tree,
   factorReadExecutionIds:inputIds(m,m.factor),additionReadExecutionIds:inputIds(a,a.delta),
   evidenceExecutionIds:unique([after,m.w.eventId,a.w.eventId,aggregateUpdate.w.eventId,shape.afterExecutionId,...m.expr.evidenceExecutionIds,...a.expr.evidenceExecutionIds,...aggregateUpdate.expr.evidenceExecutionIds])});
 }
 for(const g of groups.values()){
  const writeIds=p=>[p.tagWriteExecutionId,p.addWriteExecutionId,p.aggregateWriteExecutionId],shares=(a,b)=>writeIds(a).some(id=>writeIds(b).includes(id));
  // Prefer an actual nested update call over a broader caller that also
  // encloses another update. Ambiguous competing versions remain unclaimed.
  const scoped=g.applications.filter(p=>!g.applications.some(q=>q!==p&&shares(p,q)&&q.scopeActivationId!==p.scopeActivationId&&calls.lineage({activationId:q.scopeActivationId}).includes(p.scopeActivationId)));
  g.applications=scoped.filter(p=>!scoped.some(q=>q!==p&&shares(p,q)));
  if(!g.applications.length)continue;
  const mul=arrays.get(g.tagArrayId),add=arrays.get(g.tagAddArrayId),aggregate=roots.find(s=>s.id===g.aggregateId),range=(a,i)=>({objectId:a.objectId,offset:a.range.offset+i*a.elementBytes,size:a.elementBytes});
  const clears=c.events.filter(e=>e.action==='write'&&c.cell(e.target)?.arrayId===g.tagArrayId&&num(e.value)===1);
  for(const clear of clears){const i=c.cell(clear.target).index,ca=c.events.filter(e=>e.action==='write'&&e.activationId===clear.activationId&&key(e.target)===key(range(add,i))&&num(e.value)===0)
   .sort((a,b)=>Math.abs(c.pos.get(a.eventId)-c.pos.get(clear.eventId))-Math.abs(c.pos.get(b.eventId)-c.pos.get(clear.eventId)))[0];if(!ca)continue;
   const first=Math.min(c.pos.get(ca.eventId),c.pos.get(clear.eventId)),at=Math.max(c.pos.get(ca.eventId),c.pos.get(clear.eventId)),after=c.events[at].eventId,
    parent=g.applications.findLast(p=>p.index===i&&c.pos.get(p.afterExecutionId)<first);if(!parent)continue;
   const shape=histories.get(aggregate.id).findLast(st=>c.pos.get(st.afterExecutionId)<=at),children=shape?.nodes.find(n=>n.index===i)?.topologyChildren?.map(n=>n.index)??[];
   const floor=Math.max(c.pos.get(parent.afterExecutionId),...g.propagations.filter(p=>p.index===i).map(p=>c.pos.get(p.afterExecutionId)));
   const from=(ids,r,writerId)=>ids.some(id=>c.flow.reads(id).some(read=>{
    if(key(read.target)!==key(r)||c.pos.get(read.eventId)<=floor)return false;
    const writer=c.events.findLast(e=>e.kind==='WRITE'&&c.pos.get(e.eventId)<c.pos.get(read.eventId)&&overlaps(e.target,r));
    return writer?.eventId===writerId;
   }));
   const apps=children.map(index=>g.applications.findLast(p=>p.index===index&&c.pos.get(p.afterExecutionId)>floor&&c.pos.get(p.afterExecutionId)<first&&from(p.factorReadExecutionIds,range(mul,i),parent.tagWriteExecutionId)&&from(p.additionReadExecutionIds,range(add,i),parent.addWriteExecutionId)));
   if(children.length<2||apps.some(p=>!p))continue;
   g.propagations.push({index:i,childIndices:children,layoutEvidenceExecutionId:shape.afterExecutionId,applicationExecutionIds:apps.map(p=>p.afterExecutionId),clearExecutionId:clear.eventId,addClearExecutionId:ca.eventId,afterExecutionId:after,
    evidenceExecutionIds:unique([clear.eventId,ca.eventId,shape.afterExecutionId,...apps.flatMap(p=>p.evidenceExecutionIds)])});
  }
  for(const e of c.events){const at=c.pos.get(e.eventId),apps=g.applications.filter(p=>c.pos.get(p.afterExecutionId)<=at);if(!apps.length||!['WRITE','SPACE'].includes(e.kind))continue;
   const nodes=unique(apps.map(p=>p.index)).map(index=>({index,range:range(mul,index),addRange:range(add,index),pending:{multiply:c.scalar(range(mul,index),at),add:c.scalar(range(add,index),at)}}));
   appendCandidateState(g,{afterExecutionId:e.eventId,alive:c.alive(mul.objectId,at)&&c.alive(add.objectId,at),nodes,status:g.propagations.some(p=>c.pos.get(p.afterExecutionId)<=at)?'observed-propagation':'coupled-update-candidate',evidenceExecutionIds:unique(apps.flatMap(p=>p.evidenceExecutionIds))},maxStates);
  }
 }
 return [...groups.values()].filter(g=>g.states.length).map(g=>({...g,discoveredAtExecutionId:g.coverage.firstStateExecutionId,limitations:['observed composition and push; unrecorded child updates are not evaluated']}));
}
