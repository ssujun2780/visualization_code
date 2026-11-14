const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
// Equivalent address forms retain their compiler expression ID. No source scan,
// numeric address matching, or additional execution is involved.
export function indexedAddress(n){
  n=unwrap(n);if(!n)return null;
  if(n.kind==='UnaryOperator'&&n.operator==='&'){
    const operand=unwrap(n.children?.[0]);if(operand?.kind==='ArraySubscriptExpr')return {base:operand.children[0],index:operand.children[1],nodeId:n.nodeId};
  }
  if(n.kind==='ArraySubscriptExpr')return {base:n.children[0],index:n.children[1],nodeId:n.nodeId};
  if(n.kind==='BinaryOperator'&&n.cType?.kind==='pointer'&&n.operator==='+'){
    const [a,b]=n.children;if(a?.cType?.kind==='pointer'||a?.cType?.kind==='array')return {base:a,index:b,nodeId:n.nodeId};
    if(b?.cType?.kind==='pointer'||b?.cType?.kind==='array')return {base:b,index:a,nodeId:n.nodeId};
  }
  return null;
}
export function addressIndexAccesses(plan,trace,accesses){
  const nodes=new Map();for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk)){
    const a=indexedAddress(n);if(a)nodes.set(a.nodeId,a);
  }
  const byId=new Map(trace.events.map(e=>[e.eventId,e])),defs=new Map(plan.instructions.map(d=>[d.id,d])),objects=new Map(trace.objects.map(o=>[o.id,o])),
    arrays=new Map(trace.structures.filter(s=>s.kind==='array').map(a=>[a.id,a])),cache=new Map();
  function chain(ids){
    const key=ids.join('|');if(cache.has(key))return cache.get(key);
    const seen=new Set(),out=[],pending=[...ids],limit=trace.inferenceBudget?.limits.maxDependencyNodes??8192;
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;
      if(seen.size>=limit){trace.inferenceBudget?.report('address-index-origin',limit,ids[0]);return [];}
      seen.add(id);const e=byId.get(id);if(!e)continue;out.push(e);pending.push(...e.dataInputs??[]);
    }cache.set(key,out);return out;
  }
  return accesses.map(access=>{
    const e=byId.get(access.executionId),a=arrays.get(access.target.arrayId);if(!e||!a)return access;
    const start=a.range.offset+access.target.index*a.elementBytes,proof=[];
    for(const origin of chain(e.addressInputs??[])){
     const call=origin.action==='argument'?byId.get(origin.callExecutionId):null,
       arg=call?indexedAddress(defs.get(call.instructionId)?.arguments?.[origin.parameterIndex]):null,
       steps=[...origin.steps??[],...(arg?[{nodeId:arg.nodeId,value:origin.value,operator:'argument-address'}]:[])];
     for(const step of steps){
      const syntax=nodes.get(step.nodeId),ref=step.value?.reference??origin.value?.reference;
      if(!syntax||ref?.status!=='in-bounds'||ref.targetObjectId!==a.objectId||ref.targetOffset!==start)continue;
      // Pointer addition must use the array's actual base, not an interior
      // pointer with a coincidentally tree-shaped relative offset.
      const base=(step.inputs??[]).find(i=>i.value?.cType?.kind==='pointer')?.value?.reference;
      const baseNode=unwrap(syntax.base),declaredBase=baseNode?.kind==='DeclRefExpr'&&baseNode.cType?.kind==='array'&&a.range.offset===0&&
        defs.get(byId.get(objects.get(a.objectId)?.createdBy)?.instructionId)?.declarationId===baseNode.declarationId;
      if(syntax.base&&indexedAddress(unwrap(syntax.base)))continue;
      if(step.operator==='argument-address'){
        if(baseNode?.cType?.kind==='array'){
          // The declared array has one extent. An alias beginning at an
          // interior element must not inherit its absolute index domain.
          if(baseNode.cType.sizeBits/8!==a.range.size)continue;
        }else{
          const bases=chain(origin.dataInputs??[]).filter(x=>x.kind==='READ'&&
            (unwrap(defs.get(x.instructionId)?.expression)?.nodeId===baseNode?.nodeId||baseNode?.declarationId&&
             defs.get(byId.get(objects.get(x.target?.objectId)?.createdBy)?.instructionId)?.declarationId===baseNode.declarationId));
          if(!bases.some(x=>x.value?.reference?.targetObjectId===a.objectId&&x.value.reference.targetOffset===a.range.offset))continue;
        }
      }
      if(origin.value?.cType?.kind==='pointer'&&step.operator==='+'&&!declaredBase&&(!base||base.targetObjectId!==a.objectId||base.targetOffset!==a.range.offset))continue;
      proof.push({sourceNodeId:step.nodeId,executionId:origin.eventId,activationId:call?.activationId??origin.activationId});
     }
    }
    return proof.length?{...access,sourceNodeIds:[...new Set([...access.sourceNodeIds,...proof.map(p=>p.sourceNodeId)])],
      indexActivationIds:[...new Set([access.activationId,...proof.map(p=>p.activationId)])],addressIndexEvidence:proof}:access;
  });
}
