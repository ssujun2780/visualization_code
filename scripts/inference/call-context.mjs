// Dynamic activation identities, not source function names or numeric values.
export function callContext(events){
 const byId=new Map(events.map(e=>[e.eventId,e])),parents=new Map();
 for(const e of events)if(['argument','return','return.value'].includes(e.action)&&e.callExecutionId){
  const call=byId.get(e.callExecutionId);if(call?.action==='call'&&call.activationId!==e.activationId)parents.set(e.activationId,call);
 }
 function lineage(e){const result=[],seen=new Set();let activation=e?.activationId;
  while(activation&&!seen.has(activation)){seen.add(activation);result.push(activation);activation=parents.get(activation)?.activationId;}return result;
 }
 const nested=(a,b)=>lineage(a).includes(b.activationId)||lineage(b).includes(a.activationId);
 const common=(a,b)=>lineage(a).find(id=>lineage(b).includes(id))??null;
 const controls=e=>[...new Set(lineage(e).flatMap((id,i)=>i===0?e.controlInputs??[]:parents.get(lineage(e)[i-1])?.controlInputs??[]))];
 return {lineage,nested,common,controls,parents};
}
