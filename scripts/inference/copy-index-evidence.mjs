// COPY destinations may have no public subscript AST. Reuse the recorded GEP
// and its exact public READ instead of parsing source text or inventing events.
export function copyIndexEvidence(plan,{events,structures,observationPlan,observedTrace}){
  if(!observationPlan||!observedTrace)return [];
  const observed=new Map(observedTrace.events.map(e=>[e.eventId,e])),defs=new Map(observationPlan.instructions.map(d=>[d.id,d])),
    publicDefs=new Map(plan.instructions.map(d=>[d.id,d])),publicByObservation=new Map(events.flatMap(e=>(e.observationIds??[]).map(id=>[id,e]))),out=[];
  const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
  for(const e of events.filter(e=>e.kind==='WRITE'&&e.action==='copy')){
    const raw=(e.observationIds??[]).map(id=>observed.get(id)).find(x=>x?.action==='copy');if(!raw)continue;
    let address=observed.get(raw.addressInputs?.[0]);const chain=[];
    while(address?.operator==='bitcast'&&address.dataInputs?.length===1){chain.push(address.eventId);address=observed.get(address.dataInputs[0]);}
    const d=defs.get(address?.instructionId),r=observed.get(address?.dataInputs?.[0]),read=publicByObservation.get(r?.eventId),node=unwrap(publicDefs.get(read?.instructionId)?.expression),
      a=structures.find(a=>a.kind==='array'&&a.objectId===e.target?.objectId&&e.target.offset>=a.range.offset&&e.target.offset+e.target.size<=a.range.offset+a.range.size);
    if(!a||e.target.size!==a.elementBytes||d?.opcode!=='getelementptr'||address.dataInputs?.length!==1||r?.kind!=='READ'||read?.kind!=='READ'||node?.kind!=='DeclRefExpr')continue;
    // A whole declared-array GEP [0,index] has no hidden stride or interior base.
    if(d.inputs?.length!==3||d.inputs[1].value!=='0'||d.inputs[2].value!==defs.get(r.instructionId)?.result||!d.baseType?.startsWith('['))continue;
    const index=Number(read.value?.decimal),reference=address.value?.reference;
    if(!Number.isSafeInteger(index)||index<0||index>=a.capacity||e.target.offset!==a.range.offset+index*a.elementBytes||reference?.targetObjectId!==a.objectId||reference.targetOffset!==e.target.offset)continue;
    out.push({arrayId:a.id,executionId:e.eventId,activationId:e.activationId,cursorReadExecutionId:read.eventId,declarationId:node.declarationId,index,
      addressObservationId:address.eventId,copyObservationId:raw.eventId,castObservationIds:chain,evidence:'observed whole-element COPY destination GEP and exact index READ'});
  }
  return out;
}
