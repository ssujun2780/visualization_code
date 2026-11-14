// Preserve an observed index layout across an actual realloc replacement only.
// Old accesses keep their identities; no read of the new allocation is invented.
export function indexLayoutEvidence(c,tree,at,seen=new Set()){
 const array=c.arrays.find(a=>a.id===tree.arrayId);if(!array||seen.has(tree.id))return null;
 const visible=id=>c.pos.has(id)&&c.pos.get(id)<=at;
 const direct=(tree.formulaEvidence??[]).filter(p=>p.status==='supported'&&visible(p.executionId)).map(p=>({...p,
  observedAccessExecutionIds:p.observedAccessExecutionIds.filter(visible),derivedAccessExecutionIds:(p.derivedAccessExecutionIds??[]).filter(visible)}))
  .find(p=>p.derivedAccessExecutionIds.length&&[p.parentIndex,p.childIndex].every(index=>p.observedAccessExecutionIds.some(id=>{
   const r=c.byId.get(id)?.target;return r?.objectId===array.objectId&&Math.floor((r.offset-array.range.offset)/array.elementBytes)===index;
  })));
 if(direct)return {...direct,sourceTreeId:tree.id,relocationExecutionIds:[],retainedBytes:array.range.offset+array.range.size};
 const next=c.objects.find(o=>o.id===array.objectId),begin=c.byId.get(next?.createdBy),old=c.objects.find(o=>o.id===begin?.copiedFrom?.objectId),end=c.byId.get(old?.endedBy),complete=e=>e&&(!e.phase||e.phase==='complete');
 if(!complete(begin)||!complete(end)||!visible(begin.eventId)||begin.action!=='object.begin'||begin.kind!=='SPACE'||
  old?.storage!=='heap'||next.storage!=='heap'||end.reason!=='realloc-replaced'||c.pos.get(end.eventId)>c.pos.get(begin.eventId)||
  begin.copiedFrom.offset!==0||begin.copiedFrom.size!==Math.min(old.size,next.size))return null;
 const sameCall=end.callExecutionId&&end.callExecutionId===begin.callExecutionId,
  a=c.defs.get(end.instructionId),b=c.defs.get(begin.instructionId),sameSite=a?.sourceNodeId&&a.sourceNodeId===b?.sourceNodeId&&end.activationId===begin.activationId;
 if(!sameCall&&!sameSite)return null;
 const compatible=c.structures.filter(t=>t.kind==='index-tree'&&t.objectId===old.id&&t.range.offset===array.range.offset&&t.elementBytes===array.elementBytes&&
  JSON.stringify(t.elementType)===JSON.stringify(array.elementType)&&JSON.stringify(t.descriptor)===JSON.stringify(tree.descriptor)&&t.candidateIds.some(id=>tree.candidateIds.includes(id))),
  proofs=compatible.map(t=>indexLayoutEvidence(c,t,c.pos.get(end.eventId)-1,new Set(seen).add(tree.id))).filter(Boolean);
 if(!proofs.length)return null;
 const proof=proofs[0];return {...proof,retainedBytes:Math.min(proof.retainedBytes,begin.copiedFrom.size),relocationExecutionIds:[...proof.relocationExecutionIds,end.eventId,begin.eventId]};
}
