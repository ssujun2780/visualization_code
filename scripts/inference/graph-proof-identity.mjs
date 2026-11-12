// One execution can support multiple directions, operands and property roles.
export const graphProofId=p=>JSON.stringify([p.kind??'index-domain',p.executionId,p.edgeIdentity,
  p.sourceAccessExecutionId??null,p.targetAccessExecutionId??null,p.indexSourceReadExecutionId??p.sourceReadExecutionId??null,
  (p.properties??[]).map(q=>[q.readExecutionId,q.role])]);
