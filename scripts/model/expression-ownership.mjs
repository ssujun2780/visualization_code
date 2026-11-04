// Compiler AST identities take precedence over overlapping debug locations.
// SSA inputs and CFG predecessors distinguish selections from their conditions.
export function createExpressionOwnership(observations,nearest,nodes=[]){
  const byNode=new Map(nodes.map(n=>[n.id,n])),
    producers=new Map(observations.instructions.filter(o=>o.result).map(o=>[`${o.functionId}:${o.result}`,o])),
    terminators=new Map(observations.instructions.filter(o=>o.action==='branch').map(o=>[`${o.functionId}:${o.block}`,o]));
  const contains=(root,node)=>{for(let n=node;n;n=n.parent)if(n===root)return true;return false;};
  const producer=(op,input=op.inputs?.[0])=>input&&producers.get(`${op.functionId}:${input.value}`);
  const within=(op,root)=>{
    if(!op||!root)return false;
    const semantic=byNode.get(op.semanticNodeId);
    return semantic?contains(root,semantic):!!nearest(op,n=>n===root);
  };
  function decisionOwner(op){
    let subject=producer(op),seen=new Set();
    // Trace compiler truth conversions to the source value they test. A
    // branch's own location can name the surrounding logical operator.
    while(subject&&!subject.semanticNodeId&&!subject.cType&&!seen.has(subject.id)){
      seen.add(subject.id);
      const truthTest=['icmp','fcmp'].includes(subject.opcode)&&['ne','une'].includes(subject.predicate)&&
        ['0','null','0.000000e+00'].includes(subject.inputs?.[1]?.value);
      if(!truthTest&&!['zext','sext','trunc'].includes(subject.opcode))break;
      const next=producer(subject);if(!next)break;subject=next;
    }
    if(!subject)return undefined;
    const candidate=n=>n.kind==='ConditionalOperator'?within(subject,n.children[0]):
      n.kind==='BinaryOperator'&&/ '(?:&&|\|\|)'\s*$/.test(n.details);
    const semantic=byNode.get(subject.semanticNodeId);
    if(semantic){for(let n=semantic;n;n=n.parent)if(candidate(n))return n;return null;}
    if(!nearest(subject))return undefined;
    return nearest(subject,candidate);
  }
  function selectionOwner(op,owners=new Map()){
    if(!['merge','select'].includes(op.action))return null;
    const inputs=op.opcode==='select'?op.inputs.slice(1):op.incoming;
    if(inputs?.length!==2)return null;
    return nearest(op,n=>{
      if(n.kind!=='ConditionalOperator')return false;
      const arms=n.children.slice(1),values=inputs.map(input=>producer(op,input));
      const valueWithin=(value,root)=>owners.has(value?.id)?contains(root,owners.get(value.id)):within(value,root);
      const fits=(input,arm)=>!values[input]||valueWithin(values[input],arms[arm]);
      if(!(fits(0,0)&&fits(1,1)||op.opcode==='phi'&&fits(0,1)&&fits(1,0)))return false;
      if(op.opcode==='select')return valueWithin(producer(op),n.children[0]);
      // A logical short-circuit PHI has a conditional incoming edge; ?: values
      // arrive after completing an arm. Check edges, never LLVM block names.
      return inputs.every(input=>{
        const edge=terminators.get(`${op.functionId}:${input.block}`);
        return edge?.inputs.length===0&&edge.destinations.length===1&&edge.destinations[0]===op.block;
      });
    });
  }
  function conditionRegion(root,bindings){
    const belongs=op=>{
      const owner=byNode.get(bindings[op.id]?.evaluation?.nodeId);
      return owner?contains(root,owner):within(op,root);
    };
    const regionBranches=observations.instructions.filter(op=>op.action==='branch'&&op.inputs.length&&op.destinations.length===2&&
      within(producer(op)??op,root));
    // A ?: inside an operand selects that operand's value; it must keep its
    // own FLOW rather than masquerading as a leaf of the surrounding &&/||.
    const branches=regionBranches.filter(op=>byNode.get(bindings[op.id]?.evaluation?.nodeId)?.kind!=='ConditionalOperator');
    const ops=new Map(regionBranches.map(op=>[op.id,op])),pending=regionBranches.slice();
    while(pending.length){
      const op=pending.pop();
      for(const input of op.inputs??[]){
        const p=producer(op,input);
        if(p&&!ops.has(p.id)&&belongs(p)){ops.set(p.id,p);pending.push(p);}
      }
    }
    const blocks=new Set([...ops.values()].map(op=>op.block));
    // Constant PHI arms have no SSA producer. Their predecessor is still part
    // of a selection inside the condition, not a completed outer condition.
    for(const op of ops.values())if(op.opcode==='phi')for(const input of op.incoming??[])blocks.add(input.block);
    return {ops:[...ops.values()],branches,blocks};
  }
  return {within,producer,decisionOwner,selectionOwner,conditionRegion};
}
