// Match a call occurrence using its callee producer, not just overlapping
// source ranges. A function-returning-function-pointer contains two CallExprs.
import {llvmName} from './llvm.mjs';
export function callBindings(nodes){
  const byId=new Map(nodes.map(n=>[n.id,n])),producers=new Map();
  const unwrap=n=>{while(n){
    if(['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind)&&n.children.length===1||
      n.kind==='UnaryOperator'&&/prefix '\*'/.test(n.details)){n=n.children[0];continue;}
    if(n.kind==='BinaryOperator'&&/ '[,=]'\s*$/.test(n.details)){n=n.children[1];continue;}
    break;
  }return n;};
  const key=(fn,value)=>`${fn}:${value}`;
  return {
    resolve(op,fn,candidates,preferred){
      if(op.action!=='call')return null;
      const producer=producers.get(key(fn,op.callee)),target=unwrap(byId.get(producer?.semanticNodeId));
      const matches=candidates.filter(n=>{
        if(n.kind!=='CallExpr')return false;const callee=unwrap(n.children[0]);
        if(op.callee.startsWith('%'))return !!target&&callee===target;
        const name=/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(callee?.details??'')?.[1];
        return name&&llvmName(op.callee.slice(1))===name;
      });
      return matches.includes(preferred)?preferred:matches.length===1?matches[0]:null;
    },
    record(op,fn){if(op.result)producers.set(key(fn,op.result),op);}
  };
}
