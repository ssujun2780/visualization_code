// C _Bool is stored as a byte but LLVM computes and passes it as i1.
// These SSA adapters forward an observed value; they are not C casts.
export function booleanRepresentationBindings(observations,{nodes,types,nearest}){
  const result=new Map(),byNode=new Map(nodes.map(n=>[n.id,n])),producers=new Map(),users=new Map();
  const boolean=t=>t?.encoding==='DW_ATE_boolean',nodeType=n=>n&&types.spelling(n.type,n.canonical);
  const key=(o,value)=>`${o.functionId}:${value}`;
  for(const o of observations.instructions){
    const value=o.result??(o.action==='function.argument'?o.parameter?.value:null);
    if(value)producers.set(key(o,value),o);
    for(const input of o.inputs??[]){const k=key(o,input.value);if(!users.has(k))users.set(k,[]);users.get(k).push(o);}
  }
  const node=o=>byNode.get(o?.semanticNodeId);
  const cType=o=>o?.cType??nodeType(node(o));
  for(const o of observations.instructions){
    const input=o.inputs?.[0],p=input&&producers.get(key(o,input.value));
    if(o.conversion||!p)continue;
    let type,kind;
    if(o.opcode==='trunc'&&input.type==='i8'&&o.type==='i1'&&p.action==='load'&&boolean(cType(p))){
      const read=node(p)??nearest(p,n=>n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>'));
      if(!boolean(nodeType(read)))continue;
      type=cType(p);kind='storage-to-value';
    }else if(o.opcode==='zext'&&input.type==='i1'&&o.type==='i8'){
      // Require a typed _Bool producer or an actual _Bool storage consumer.
      // Integer-to-boolean comparisons remain separate source calculations.
      const stores=(users.get(key(o,o.result))??[]).filter(u=>u.action==='store'&&u.inputs?.[0]?.value===o.result);
      const target=stores.find(u=>boolean(cType(u)));
      type=result.get(p.id)?.cType??(boolean(cType(p))?cType(p):target&&cType(target));
      if(!boolean(type))continue;
      kind='value-to-storage';
    }else continue;
    result.set(o.id,{kind,cType:type,sourceObservationId:p.id,evidence:'compiler _Bool type and LLVM SSA representation adapter'});
  }
  return result;
}
