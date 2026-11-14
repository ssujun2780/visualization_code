import {preservesNumericOrder} from './scalar-domain.mjs';
const relations=new Set(['<','<=','>','>=','==','!=']);
export const integerLiteral=v=>{try{const n=v?.decimal??v?.signed??v?.literal;return n===undefined?null:BigInt(n).toString();}catch{return null;}};
// Bounds belong to the symbolic comparison expression, never to sampled keys.
export function comparisonBounds(n){
 if(!n||n.signOnly)return null;if(n.literal!==undefined){const v=BigInt(n.literal);return [v,v];}
 if(n.component)return [-1n,1n];
 if(relations.has(n.op)||['!','&&','||'].includes(n.op))return [0n,1n];
 const a=n.args?.map(comparisonBounds);if(!a?.every(Boolean))return null;
 if(n.op==='-')return a.length===1?[-a[0][1],-a[0][0]]:[a[0][0]-a[1][1],a[0][1]-a[1][0]];
 if(n.op==='+')return [a[0][0]+a[1][0],a[0][1]+a[1][1]];return null;
}
export function fitsComparisonType(n,type){
 const b=comparisonBounds(n),bits=type?.sizeBits;
 if(!b||!Number.isInteger(bits)||bits<1||bits>128||!['signed','unsigned'].includes(type?.signedness))return false;
 const signed=type.signedness==='signed',max=(1n<<BigInt(bits-(signed?1:0)))-1n,min=signed?-max-1n:0n;
 return b[0]>=min&&b[1]<=max;
}
export function comparisonCast(n,step){
 const from=step.conversion?.fromType??step.inputs?.[0]?.value?.cType,to=step.conversion?.toType??step.value?.cType;
 return n&&(preservesNumericOrder(from,to)||fitsComparisonType(n,to))?n:null;
}
// A three-way result obtains a direction only from its exact recorded use.
// An equal-valued return from another call is not a substitute.
const useIndexes=new WeakMap();
function comparisonSite(c,e,s){
 if(relations.has(s.operator))return {operator:s.operator,nodeId:s.nodeId};
 // LLVM can fold !(compare(...) < 0) into a single test. The CALC retains
 // both consumed operands while its public root operator is '!'. Recover only
 // a directly wrapped comparison from the compiler AST, not an arbitrary leaf.
 const find=n=>n?.nodeId===s.nodeId?n:n?.children?.map(find).find(Boolean);
 let n=find(c.defs?.get(e.instructionId)?.expression);
 while(n&&(['ParenExpr','ImplicitCastExpr'].includes(n.kind)||n.kind==='UnaryOperator'&&n.operator==='!'))n=n.children?.[0];
 return relations.has(n?.operator)&&s.inputs?.length===2?{operator:n.operator,nodeId:n.nodeId}:null;
}
export function comparatorUses(c,ret){
 if(useIndexes.has(c))return useIndexes.get(c).get(ret.eventId)??[];
 const index=new Map();
 for(const e of c.events){
  for(const s of e.steps??[]){const site=comparisonSite(c,e,s);if(!site||s.inputs?.length!==2)continue;
   for(let side=0;side<2;side++){
    const i=s.inputs[side],other=s.inputs[1-side];
    if(other.executionId||integerLiteral(other.value)!=='0')continue;
    // A same-CALC observation may name an arithmetic result rather than the
    // original return. Identity chains deliberately do not cross arithmetic.
    const observed=(e.steps??[]).find(p=>(p.observationIds??[p.observationId]).includes(i.observationId));
    if(observed&&observed!==s)continue;
    const chain=i.executionId?c.chain(i.executionId):[];
    const op=side?({'<':'>','<=':'>=','>':'<','>=':'<=','==':'==','!=':'!='}[site.operator]):site.operator;
    for(let stop=0;stop<chain.length;stop++){
     const r=chain[stop];if(r.action!=='return.value'||e.activationId===r.activationId||c.pos.get(r.eventId)>=c.pos.get(e.eventId))continue;
     if(chain.slice(0,stop).some(e=>e.kind==='CALC'&&(e.steps??[]).some(s=>s.conversion&&!preservesNumericOrder(s.conversion.fromType,s.conversion.toType))))continue;
     if(!index.has(r.eventId))index.set(r.eventId,[]);const found=index.get(r.eventId);
     if(!found.some(p=>p.operator===op))found.push({operator:op,executionId:e.eventId,sourceNodeId:site.nodeId,operandIndex:side});
    }
   }
  }
 }
 // Repeated uses with the same contract do not duplicate a path. Opposite
 // contracts remain distinct candidate policies on the same storage.
 useIndexes.set(c,index);return index.get(ret.eventId)??[];
}
