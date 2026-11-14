const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
const number=v=>{const x=v?.decimal??v?.signed??v?.unsigned;return x!==undefined&&Number.isSafeInteger(Number(x))?Number(x):null;};
const contains=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
const overlap=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;

// A field is a length only after a loop actually scans [0,count) and exits at
// count. A cache with the same numeric value or an early break is insufficient.
export function recordPrefixMembership(plan,{events,valueFlow},relations,nodes){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),profiles=new Map(),proofs=[];
  function bound(branch){
    const calc=(branch.dataInputs??[]).map(id=>byId.get(id)).find(e=>e?.kind==='CALC'),ast=unwrap(defs.get(calc?.instructionId)?.expression),step=calc?.steps?.find(s=>s.nodeId===ast?.nodeId);
    if(!step||!['<','<=','>','>='].includes(step.operator))return null;
    const side=step.operator.startsWith('<')?1:0,read=valueFlow.sourceReadOperand(step.inputs[side],calc,step),field=unwrap(defs.get(read?.instructionId)?.expression),indexNode=unwrap(ast.children[1-side]);
    if(field?.kind!=='MemberExpr'||indexNode?.kind!=='DeclRefExpr'||!read?.target||number(step.inputs[side].value)===null)return null;
    return {read,field,indexDeclarationId:indexNode.declarationId,index:number(step.inputs[1-side].value),
      count:number(step.inputs[side].value)+(step.operator.endsWith('=')?1:0),comparisonExecutionId:calc.eventId};
  }
  for(const r of relations)if(r.kind==='record-embedded-index-array')for(const p of r.evidence){const source=byId.get(p.sourceExecutionId),expr=unwrap(defs.get(source?.instructionId)?.expression),index=unwrap(expr?.children?.[1]);
    if(expr?.kind!=='ArraySubscriptExpr'||index?.kind!=='DeclRefExpr')continue;
    for(const id of source.controlInputs??[]){const branch=byId.get(id),b=branch?.action==='branch'&&bound(branch);
      if(!b||b.indexDeclarationId!==index.declarationId||b.index!==p.slotIndex||!nodes.some(n=>contains(n.record,p.source)&&contains(n.record,b.read.target)))continue;
      const key=`${r.id}:${branch.instructionId}`;
      if(!profiles.has(key))profiles.set(key,{relation:r,branchId:branch.instructionId,fieldNodeId:b.field.fieldNodeId,establishedAtExecutionId:p.targetAccessExecutionId});
    }
  }
  for(const profile of profiles.values()){
    const rounds=new Map();
    for(const branch of events)if(branch.action==='branch'&&branch.instructionId===profile.branchId){const b=bound(branch),node=b&&nodes.find(n=>contains(n.record,b.read.target));
      if(!node||b.field.fieldNodeId!==profile.fieldNodeId||b.count<0||b.count>profile.relation.field.cType.count)continue;
      const key=`${branch.activationId}:${node.id}`,truth=number(branch.condition)!==0;
      if(b.index===0)rounds.set(key,{count:b.count,branches:[],start:branch.eventId,read:b.read});
      const round=rounds.get(key);if(!round||round.count!==b.count)continue;
      if(truth){round.branches.push({id:branch.eventId,index:b.index});continue;}
      rounds.delete(key);if(b.index!==b.count||round.branches.length!==b.count||round.branches.some((x,i)=>x.index!==i))continue;
      const reads=round.branches.map(({id,index})=>events.find(e=>e.kind==='READ'&&e.controlInputs?.includes(id)&&contains(node.record,e.target)&&
        unwrap(defs.get(e.instructionId)?.expression)?.kind==='ArraySubscriptExpr'&&walk(defs.get(e.instructionId)?.expression).some(n=>n.fieldNodeId===profile.relation.field.fieldNodeId)&&
        e.target.offset===node.record.offset+profile.relation.field.offset+index*profile.relation.field.cType.elementType.sizeBits/8));
      if(reads.some(r=>!r))continue;
      const proofAt=pos.get(branch.eventId)>pos.get(profile.establishedAtExecutionId)?branch.eventId:profile.establishedAtExecutionId;
      proofs.push({relationId:profile.relation.id,nodeId:node.id,count:b.count,capacity:profile.relation.field.cType.count,
        countSource:{...b.read.target},countReadExecutionId:b.read.eventId,afterExecutionId:proofAt,
        evidenceExecutionIds:[profile.establishedAtExecutionId,branch.eventId,b.comparisonExecutionId,b.read.eventId,...reads.map(r=>r.eventId)],
        interpretation:'observed active prefix; capacity slots remain physical storage'});
    }
  }
  const writes=events.filter(e=>e.kind==='WRITE'||e.kind==='SPACE'&&e.memoryState);
  return {proofs,at(executionId){const at=pos.get(executionId),latest=new Map();
    for(const p of proofs)if(pos.get(p.afterExecutionId)<=at&&!writes.some(e=>pos.get(e.eventId)>pos.get(p.countReadExecutionId)&&pos.get(e.eventId)<=at&&
      overlap(p.countSource,e.target??(e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState?.byteLength??0}:null))))latest.set(`${p.relationId}:${p.nodeId}`,p);
    return [...latest.values()];
  }};
}
