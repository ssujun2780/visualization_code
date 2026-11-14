// One execution can support multiple directions, operands and property roles.
export const graphProofId=p=>JSON.stringify([p.kind??'index-domain',p.executionId,p.edgeIdentity,
  p.sourceAccessExecutionId??null,p.targetAccessExecutionId??null,p.indexSourceReadExecutionId??p.sourceReadExecutionId??null,
  (p.properties??[]).map(q=>[q.readExecutionId,q.role])]);

const slot=r=>r.objectId+':'+r.offset+':'+r.size;
export function graphEdgeIdentity(p,{matrix=p.kind?.startsWith('matrix-')}={}){
  // Distinct backing slots remain distinct, even for the same endpoints.
  const ranges=matrix?[...p.sourceSlots??[],...(p.properties??[]).map(q=>q.source)]:p.sourceSlots??[];
  return [matrix?'matrix-storage':p.kind,p.fromIndex,p.toIndex,[...new Set(ranges.map(slot))].sort().join('|')].join(':');
}
export function mergeGraphEvidence(previous,next){
  if(!previous||previous.edgeIdentity!==next.edgeIdentity)return next;
  const properties=new Map((previous.properties??[]).map(p=>[slot(p.source),p]));
  for(const p of next.properties??[])properties.set(slot(p.source),p);
  return {...next,properties:[...properties.values()],
    supportingProofIds:[...new Set([...(previous.supportingProofIds??[graphProofId(previous)]),graphProofId(next)])]};
}
