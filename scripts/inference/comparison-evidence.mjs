import {createValueFlow} from './observed-value-flow.mjs';
const integer=v=>{try{return BigInt(v?.decimal??v?.signed??v?.unsigned);}catch{return null;}};
// Normalize observed equality, including the documented external strcmp
// contract. User functions with the same spelling are not library contracts.
export function equalityEvidence(plan,trace){
 const flow=trace.valueFlow??createValueFlow(plan,trace),byId=new Map(trace.events.map(e=>[e.eventId,e])),rows=[];
 for(const e of trace.events)if(e.kind==='CALC')for(const step of e.steps??[]){
  if(!['==','!='].includes(step.operator)||step.inputs?.length!==2)continue;
  const direct=step.inputs.map(i=>flow.sourceReadOperand(i,e,step));
  if(direct.every(Boolean)){rows.push({event:e,step,reads:direct,domain:'scalar'});continue;}
  for(let side=0;side<2;side++){
   if(integer(step.inputs[1-side].value)!==0n)continue;
   const producer=byId.get(step.inputs[side].executionId),resume=producer?.action==='resume'?producer:null,call=byId.get(resume?.callExecutionId);
   if(!call||call.callee!=='@strcmp'||call.resolvedFunctionId||call.activationId!==e.activationId||!(resume.readRegions?.length))continue;
   const inputs=[0,1].map(index=>call.inputs?.find(i=>i.parameterIndex===index)),reads=inputs.map(i=>flow.sourceRead(i?.executionId));
   if(reads.every(Boolean))rows.push({event:e,step,reads,domain:'nul-terminated-bytes',comparisonCallExecutionId:call.eventId,comparisonReturnExecutionId:resume.eventId,readRegions:resume.readRegions});
  }
 }
 return rows;
}
// Explicit memory/address dependencies for hashing through bytes. This is a
// dependency query, never a declaration that transformed values are identical.
export function addressDependencyReads(flow,byId,ids,maxNodes=8192){
 maxNodes=Math.min(maxNodes,flow.dependencyLimit??maxNodes);
 const pending=[...ids],seen=new Set(),out=new Map();
 while(pending.length){const id=pending.pop();if(seen.has(id))continue;if(seen.size>=maxNodes){flow.reportLimit?.('address-dependencies',maxNodes,ids[0]);return {reads:[],complete:false,reason:'evidence-limit',limit:maxNodes};}seen.add(id);
  const e=byId.get(id);if(!e)continue;
  for(const r of flow.dependencyReads(id)){out.set(r.eventId,r);pending.push(...r.addressInputs??[]);}
  if(e.kind==='CALC'||e.kind==='WRITE'||e.action==='resume')pending.push(...e.dataInputs??[]);
 }
 return {reads:[...out.values()],complete:true};
}
