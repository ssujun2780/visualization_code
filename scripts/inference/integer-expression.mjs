// A bounded description of already recorded integer operations. This does not
// execute user code or append instructions; typed arithmetic is used for keys.
const indexes=new WeakMap(),ops=new Set(['+','-','*','/','%','&','|','^','<<','>>','cast']);
export const integerType=t=>t&&['signed','unsigned'].includes(t.signedness)&&Number.isInteger(t.sizeBits)&&t.sizeBits>0&&t.sizeBits<=128?{sizeBits:t.sizeBits,signedness:t.signedness}:null;
export function recordedIntegerExpression(c,input,event,step,leaf){
 let index=indexes.get(c);if(!index){index=new Map();for(const e of c.events)for(const s of e.steps??[])for(const id of s.observationIds??[s.observationId])if(id)index.set(id,{e,s});indexes.set(c,index);}
 const leaves=[],evidence=new Set(),visiting=new Set(),limit=Math.min(128,c.inferenceBudget?.limits.maxDependencyNodes??128);let count=0;
 function walk(i,e,s){
  if(++count>limit){c.inferenceBudget?.report('integer-expression',limit,event.eventId);return null;}
  const obs=index.get(i?.observationId);if(obs&&obs.s!==s)return calc(obs.e,obs.s);
  if(i?.executionId){
   for(const x of c.chain(i.executionId)){
    if(c.pos.get(x.eventId)>c.pos.get(e.eventId))return null;evidence.add(x.eventId);
    if(x.kind==='READ'){const data=leaf(x);if(data){const type=integerType(x.value?.cType);if(!type)return null;const slot=leaves.length;leaves.push({read:x,...data});return {kind:'input',slot,type};}}
    if(x.kind==='CALC')return calc(x,x.steps?.at(-1));
    if(x.action==='write'&&!x.dataInputs?.length)return literal(x.value);
   }
   return null;
  }
  return literal(i?.value);
 }
 function literal(v){try{const type=integerType(v?.cType),value=BigInt(v?.decimal??v?.signed??v?.unsigned??v?.literal).toString();return type?{kind:'literal',value,type}:null;}catch{return null;}}
 function calc(e,s){
  if(!s||visiting.has(s))return null;
  if(s.kind==='folded-expression'&&!s.inputs?.some(i=>i.executionId||i.observationId))return literal(s.value);
  if(!ops.has(s.operator))return null;const type=integerType(s.value?.cType);if(!type)return null;
  visiting.add(s);const args=(s.inputs??[]).map(i=>walk(i,e,s));visiting.delete(s);
  if(!args.length||!args.every(Boolean))return null;evidence.add(e.eventId);return {kind:'operation',operator:s.operator,args,type};
 }
 const tree=walk(input,event,step);return tree?{tree,leaves,evidenceExecutionIds:[...evidence]}:null;
}
export function evaluateIntegerExpression(tree,read){
 function fit(v,t){const bits=BigInt(t.sizeBits);if(t.signedness==='unsigned')return BigInt.asUintN(t.sizeBits,v);
  const high=(1n<<(bits-1n))-1n,low=-high-1n;return v>=low&&v<=high?v:null;}
 function run(n){
  if(n.kind==='literal')return BigInt(n.value);
  if(n.kind==='input'||n.kind==='field'){const v=read(n);try{return v===null||v===undefined?null:fit(BigInt(v),n.type);}catch{return null;}}
  const a=n.args.map(run);if(a.some(v=>v===null))return null;const [x,y]=a;let v;
  switch(n.operator){
   case 'cast':v=x;break;case '+':v=a.length===1?x:x+y;break;case '-':v=a.length===1?-x:x-y;break;case '*':v=x*y;break;
   case '/':case '%':if(y===0n||n.type.signedness==='signed'&&x===-(1n<<BigInt(n.type.sizeBits-1))&&y===-1n)return null;v=n.operator==='/'?x/y:x%y;break;
   case '&':v=x&y;break;case '|':v=x|y;break;case '^':v=x^y;break;
   case '<<':case '>>':if(y<0n||y>=BigInt(n.type.sizeBits)||x<0n)return null;v=n.operator==='<<'?x<<y:x>>y;break;
   default:return null;
  }return fit(v,n.type);
 }
 try{return run(tree)?.toString()??null;}catch{return null;}
}
export function mapIntegerInputs(tree,fn){return tree.kind==='input'?fn(tree):tree.kind==='operation'?{...tree,args:tree.args.map(n=>mapIntegerInputs(n,fn))}:tree;}
