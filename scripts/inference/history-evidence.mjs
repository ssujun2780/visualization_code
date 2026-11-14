// Retained display snapshots and immutable proof checkpoints have different
// purposes. Proofs are never consulted by a query for the current state.
export function verificationStates(candidate,positions){
 return [...candidate.states??[],...candidate.proofStates??[]].sort((a,b)=>positions.get(a.afterExecutionId??a.executionId)-positions.get(b.afterExecutionId??b.executionId));
}
export function historyProofSize(candidate,state){
 if(candidate.kind==='range-aggregate-candidate')return state.nodes.length;
 return 1+[state.topology,...(state.roleTopologies??[]).map(p=>p.topology)].filter(Boolean)
   .reduce((n,t)=>n+(t.reachableNodeIds?.length??0)+(t.edges?.length??0),0);
}
export function retainHistoryEvidence(original,bounded,trace,budget){
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),full=new Map(original.map(s=>[s.id,s])),out=new Map(bounded.map(s=>[s.id,s])),rejected=new Set();
 const requested=new Map();
 function request(sourceId,eventId){if(!eventId)return;if(!requested.has(sourceId))requested.set(sourceId,new Set());requested.get(sourceId).add(eventId);}
 for(const s of bounded)if(s.kind==='deferred-update-candidate'){
  for(const p of s.applications)request(s.aggregateId,p.coverageEvidenceExecutionId);
  for(const p of s.propagations)request(s.aggregateId,p.layoutEvidenceExecutionId);
 }
 for(const s of bounded)if(s.kind==='range-aggregate-candidate'){
  const source=full.get(s.id),proofs=new Map(),pending=[...s.states],wanted=requested.get(s.id)??new Set();
  for(const id of wanted){const state=source.states.find(st=>st.afterExecutionId===id);if(state)pending.push(state);}
  const visited=new Set();let used=0;
  while(pending.length){const st=pending.pop();if(visited.has(st.afterExecutionId))continue;visited.add(st.afterExecutionId);
   if(!s.states.some(x=>x.afterExecutionId===st.afterExecutionId)){
    used+=st.nodes.length;if(used>budget.limits.maxDependencyNodes){budget.report('history-proof-nodes',budget.limits.maxDependencyNodes,st.afterExecutionId);rejected.add(s.id);break;}
    proofs.set(st.afterExecutionId,st);
   }
   for(const n of st.nodes)if(n.valueTransform){const proof=source.states.find(x=>x.nodes.some(old=>old.index===n.index&&old.writeExecutionId===n.topologySourceWriteExecutionId&&!old.valueTransform));if(proof)pending.push(proof);}
  }
  if(proofs.size)out.set(s.id,{...s,proofStates:[...proofs.values()].sort((a,b)=>pos.get(a.afterExecutionId)-pos.get(b.afterExecutionId)),coverage:{...s.coverage,maxProofNodes:budget.limits.maxDependencyNodes,retainedProofNodes:used}});
 }
 // Any retained condition state may refer to a source relation snapshot that
 // was discarded independently. Keep that exact checkpoint, never a nearby one.
 const relationProofs=new Map();
 for(const dependent of bounded)for(const state of dependent.states??[]){
  const reference=state.relation??state.indexRelation;if(!reference?.sourceStructureId)continue;
  const source=full.get(reference.sourceStructureId),retained=out.get(reference.sourceStructureId);
  if(!['linked-structure','rooted-index-structure','index-tree'].includes(source?.kind)||!retained)continue;
  const id=reference.afterExecutionId;if(retained.states.some(s=>s.afterExecutionId===id))continue;
  if(!relationProofs.has(source.id))relationProofs.set(source.id,{states:new Map(),used:0});
  const proofs=relationProofs.get(source.id);if(proofs.states.has(id))continue;
  const proof=source.states.find(s=>s.afterExecutionId===id),size=proof?historyProofSize(source,proof):Infinity;
  if(proofs.used+size>budget.limits.maxDependencyNodes){
   budget.report('history-relation-proof',budget.limits.maxDependencyNodes,id);rejected.add(dependent.id);continue;
  }
  proofs.used+=size;proofs.states.set(id,proof);
 }
 for(const [id,p]of relationProofs)if(p.states.size){const s=out.get(id);out.set(id,{...s,
  proofStates:[...p.states.values()].sort((a,b)=>pos.get(a.afterExecutionId)-pos.get(b.afterExecutionId)),
  coverage:{...s.coverage,maxProofNodes:budget.limits.maxDependencyNodes,retainedProofNodes:p.used}});}
 return [...out.values()].filter(s=>!rejected.has(s.id)&&!rejected.has(s.aggregateId));
}
