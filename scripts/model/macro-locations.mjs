// Expand spelling locations using Clang's token stream, never source semantics.
const order=(a,b)=>a.line-b.line||a.column-b.column;
const key=p=>p&&`${p.file}:${p.line}:${p.column}`;
function userFunction(n){for(let p=n;p;p=p.parent)if(p.kind==='FunctionDecl')return p.source?.file==='/main.c'&&p.children.some(c=>c.kind==='CompoundStmt')?p:null;return null;}
export function needsMacroLocations(nodes){return nodes.some(n=>{
  const fn=userFunction(n),r=n.spellingRange;
  return fn&&r&&(!n.source||n.source.file!=='/main.c'||order(r.start,fn.source.start)<0||order(r.end,fn.source.end)>0);
});}
export function applyMacroLocations(nodes,dump){
  if(!dump)return;
  const tokens=[],locations=new Map();
  for(const line of dump.split('\n')){
    const m=/Loc=<(.+?):(\d+):(\d+)(?: <Spelling=(.+):(\d+):(\d+)>)?>$/.exec(line.trim());if(!m||m[1]!=='/main.c')continue;
    const token={at:{file:m[1],line:+m[2],column:+m[3]},spelling:m[4]?{file:m[4],line:+m[5],column:+m[6]}:null,index:tokens.length};
    tokens.push(token);const k=key(token.spelling??token.at);if(!locations.has(k))locations.set(k,[]);locations.get(k).push(token.index);
  }
  const roots=nodes.filter(n=>n.kind==='FunctionDecl'&&userFunction(n)===n);
  for(const root of roots){const stack=[{node:root,lo:0,hi:tokens.length-1}],anchors=new WeakMap();
    const anchorPoints=n=>{if(anchors.has(n))return anchors.get(n);const p=n.spellingRange?.start;
      const points=n.children.length?n.children.flatMap(anchorPoints):p?.file==='/main.c'&&order(root.source.start,p)<=0&&order(p,root.source.end)<=0?[p]:[];
      anchors.set(n,points);return points;};
    while(stack.length){const frame=stack.at(-1),{node,lo,hi}=frame;
      if(frame.entered){const child=node.children[frame.next++];if(child){stack.push({node:child,lo:frame.ordered?frame.cursor:frame.low,hi:frame.high,orderedContext:frame.ordered});continue;}
        stack.pop();if(frame.best&&stack.length)stack.at(-1).cursor=Math.max(stack.at(-1).cursor,frame.best.b+1);continue;}
      const r=node.spellingRange;let best=null,ambiguous=false;
      if(r)for(const a of locations.get(key(r.start))??[])if(a>=lo&&a<=hi)for(const b of locations.get(key(r.end))??[])if(b>=a&&b<=hi){
        const point=['VarDecl','ParmVarDecl'].includes(node.kind)?node.declarationPoint:null;
        if(point?.file==='/main.c'&&(order(tokens[a].at,point)>0||order(point,tokens[b].at)>0))continue;
        if(!anchorPoints(node).every(p=>(locations.get(key(p))??[]).some(i=>i>=a&&i<=b)))continue;
        if(!best||b-a<best.b-best.a){best={a,b};ambiguous=false;}else if(b-a===best.b-best.a&&(a!==best.a||b!==best.b)&&!frame.orderedContext)ambiguous=true;
      }
      if(best&&!ambiguous){
        const a=tokens[best.a],b=tokens[best.b],expanded=!!(a.spelling||b.spelling);
        if(expanded){const mapped={file:'/main.c',start:a.at,end:b.at,macroInvocation:order(a.at,b.at)===0,
            evidence:'compiler token expansion locations'};node.expansionSource=mapped;
          // Distinct substitutions can share both spelling and expansion points.
          // Preserve their compiler token occurrences for SSA operand binding.
          node.macroTokenRange={start:best.a,end:best.b};
          const valid=node.source?.file==='/main.c'&&order(root.source.start,node.source.start)<=0&&order(node.source.end,root.source.end)<=0;
          if(!valid)node.source={...mapped};
        }
      }
      if(ambiguous){node.macroLocationGap='ambiguous compiler expansion';if(node.source?.file!=='/main.c'||order(node.source.start,root.source.start)<0)node.source=null;}
      Object.assign(frame,{entered:true,next:0,best:best&&!ambiguous?best:null,low:best&&!ambiguous?best.a:lo,high:best&&!ambiguous?best.b:hi,
        cursor:best&&!ambiguous?best.a:lo,ordered:['CallExpr','CompoundStmt','BinaryOperator','ConditionalOperator'].includes(node.kind)});
    }
  }
}
