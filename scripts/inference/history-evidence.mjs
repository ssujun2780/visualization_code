// Retained display snapshots and immutable proof checkpoints have different
// purposes. Proofs are never consulted by a query for the current state.
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
 return [...out.values()].filter(s=>!rejected.has(s.id)&&!rejected.has(s.aggregateId));
}
