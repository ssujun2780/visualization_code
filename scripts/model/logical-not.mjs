// Relate C ! to observed LLVM boolean producers, including branch inversion.
// No source expression is evaluated and no variable is read again.
const isNot=n=>n?.kind==='UnaryOperator'&&/\bprefix '!'/.test(n.details);
const transparent=n=>['ParenExpr','ImplicitCastExpr'].includes(n?.kind)&&n.children.length===1;
const unwrap=n=>{while(transparent(n))n=n.children[0];return n;};
export function logicalNotBindings(observations,{nodes,types,nearest}){
  const values=new Map(),branches=new Map(),hidden=new Set(),producers=new Map(),byNode=new Map(nodes.map(n=>[n.id,n]));
  for(const o of observations.instructions)if(o.result)producers.set(`${o.functionId}:${o.result}`,o);
  const producer=(o,input=o.inputs?.[0])=>input&&producers.get(`${o.functionId}:${input.value}`);
  const explicitComparison=o=>{const n=byNode.get(o?.semanticNodeId);return n?.kind==='BinaryOperator'&&/ '(?:==|!=|<=|>=|<|>)'\s*$/.test(n.details);};
  const zero=i=>i&&['null','false','0','0.000000e+00','-0.000000e+00'].includes(i.value);
  function truthTest(o){
    if(!['icmp','fcmp'].includes(o?.opcode))return null;
    const other=o.inputs.findIndex(zero);if(other<0)return null;
    const parity=['ne','une'].includes(o.predicate)?0:['eq','oeq'].includes(o.predicate)?1:null;
    return parity===null?null:{parity,input:o.inputs[1-other]};
  }
  const entry=(node,invert=false,inputs)=>({node,cType:types.spelling('int'),invert,inputs});
  for(const o of observations.instructions){
    if(o.opcode==='xor'&&o.type==='i1'){
      const input=o.inputs.find(i=>!['true','1'].includes(i.value)),p=producer(o,input),node=nearest(o,isNot);
      if(!input||!node||!o.inputs.some(i=>['true','1'].includes(i.value)))continue;
      const test=truthTest(p);
      if(test?.parity===0&&!explicitComparison(p)&&!values.has(p.id)){
        hidden.add(p.id);values.set(o.id,entry(node,false,[test.input]));
      }else values.set(o.id,entry(node,false,[input]));
    }else if(o.opcode==='zext'&&o.inputs?.[0]?.type==='i1'&&o.type==='i32'){
      const p=producer(o),original=values.get(p?.id);
      if(original)values.set(o.id,{...original,materializesObservationId:p.id,invert:false});
    }
  }
  for(const o of observations.instructions.filter(o=>o.action==='branch'&&o.inputs.length)){
    const p=producer(o),known=values.get(p?.id);
    if(known){branches.set(o.id,{...known,invert:false});continue;}
    const node=p&&nearest(p,isNot);if(!node)continue;
    let outer=node,up=node;
    while(up.parent){if(transparent(up.parent)){up=up.parent;continue;}
      if(isNot(up.parent)){outer=up.parent;up=outer;continue;}break;}
    let operand=outer,count=0;while(isNot(unwrap(operand))){operand=unwrap(operand);count++;operand=operand.children[0];}operand=unwrap(operand);
    // A test of just one arm of a logical/conditional child is not its result.
    if(operand?.kind==='ConditionalOperator'||operand?.kind==='BinaryOperator'&&/ '(?:&&|\|\|)'\s*$/.test(operand.details))continue;
    const test=truthTest(p),comparison=explicitComparison(p);if(!test&&!comparison)continue;
    const spec=entry(outer,!!((count%2)^(comparison?0:test.parity)),comparison?undefined:[test.input]);
    branches.set(o.id,spec);if(!hidden.has(p.id))values.set(p.id,spec);
  }
  return {values,branches,hidden};
}
