// Abstract comparison signs, not execution of C code. Unknown paths stay unknown.
export function comparisonOperation(op,a,b,c){
  if(op==='?:')return a===null?(b===c?b:null):a!==0n?b:c;
  if(op==='&&'){if(a===0n||b===0n)return 0n;return a===null||b===null?null:1n;}
  if(op==='||'){if(a!==null&&a!==0n||b!==null&&b!==0n)return 1n;return a===null||b===null?null:0n;}
  if(a===null||b===null)return null;
  if(op==='<')return a<b?1n:0n;if(op==='<=')return a<=b?1n:0n;
  if(op==='>')return a>b?1n:0n;if(op==='>=')return a>=b?1n:0n;
  if(op==='==')return a===b?1n:0n;if(op==='!=')return a!==b?1n:0n;
  if(op==='-')return b===undefined?-a:a-b;if(op==='+')return a+b;
  if(op==='!')return a===0n?1n:0n;
  return null;
}

// Reduced ternary decision diagram. Size is bounded; component count is not
// hard-coded to pairs/triples and no 3^N sign table is materialized.
export function comparisonDiagram(maxNodes=8192){
  const intern=new Map(),cache=new Map();let serial=0;
  function make(index,children,value){
    if(children&&children.every(x=>x===children[0]))return children[0];
    const key=children?`${index}:${children.map(x=>x.id)}`:`v:${value}`;
    if(intern.has(key))return intern.get(key);
    if(intern.size>=maxNodes)throw new RangeError('comparison diagram limit');
    const node={id:serial++,index,children,value};intern.set(key,node);return node;
  }
  const constant=v=>make(Infinity,null,v),unknown=constant(null);
  function apply(name,args,fn){
    const key=`${name}:${args.map(a=>a.id)}`;if(cache.has(key))return cache.get(key);
    const index=Math.min(...args.map(a=>a.index));
    const out=index===Infinity?constant(fn(...args.map(a=>a.value))):
      make(index,[-1,0,1].map((_,i)=>apply(name,args.map(a=>a.index===index?a.children[i]:a),fn)));
    cache.set(key,out);return out;
  }
  function restrict(node,index,sign){
    if(node.index>index)return node;if(node.index===index)return node.children[sign+1];
    return make(node.index,node.children.map(n=>restrict(n,index,sign)));
  }
  const terminals=node=>{const out=new Set(),seen=new Set();function walk(n){if(seen.has(n.id))return;seen.add(n.id);
    if(n.children)n.children.forEach(walk);else out.add(n.value);}walk(node);return out;};
  return {constant,unknown,apply,restrict,terminals,
    variable:index=>make(index,[-1n,0n,1n].map(constant)),
    operation:(op,args)=>apply(op,args,(...values)=>comparisonOperation(op,...values)),
    size:()=>intern.size};
}

// Both role assignments are equivalent up to reversing every component. Keep
// the first component ascending, so role directions retain scalar semantics.
export function inferLexicographicOrder(diagram,routing,indices){
  const {restrict,terminals}=diagram;
  function visit(node,remaining){
    if(!remaining.length)return terminals(node).has(2n)?null:[];
    const options=[];
    for(const index of remaining)for(const direction of [1,-1]){
      const low=restrict(node,index,-1),high=restrict(node,index,1),l=terminals(low),h=terminals(high);
      const compatible=(set,expected)=>[...set].every(v=>v===null||v===expected);
      if(!compatible(l,BigInt(-direction))||!compatible(h,BigInt(direction)))continue;
      // At least one non-equal side must bypass ALL remaining components.
      // Equality-only samples cannot manufacture component precedence.
      if(!(l.size===1&&l.has(BigInt(-direction)))&&!(h.size===1&&h.has(BigInt(direction))))continue;
      const tail=visit(restrict(node,index,0),remaining.filter(i=>i!==index));
      if(tail)options.push([{index,direction},...tail]);
      if(options.length>1)return null;
    }
    return options[0]??null;
  }
  return visit(routing,indices);
}

export function compareKeyValues(a,b,order){
  for(const {index,direction}of order){
    if(a[index]===null||b[index]===null)return {sign:null,componentIndex:index,status:'unobserved'};
    const floating=typeof a[index]==='number'&&!Number.isSafeInteger(a[index])||typeof b[index]==='number'&&!Number.isSafeInteger(b[index])||['NaN','Infinity','-Infinity'].includes(a[index])||['NaN','Infinity','-Infinity'].includes(b[index]),
      x=floating?Number(a[index]):BigInt(a[index]),y=floating?Number(b[index]):BigInt(b[index]);
    if(floating&&(Number.isNaN(x)||Number.isNaN(y)))return {sign:null,componentIndex:index,status:'unordered'};
    if(x!==y)return {sign:(x<y?-1:1)*direction,componentIndex:index};}
  return {sign:0,componentIndex:null};
}
