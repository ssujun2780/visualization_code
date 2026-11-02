import {astNodes} from '../scripts/model/ast.mjs';
import {metadata} from '../scripts/model/llvm.mjs';

const compare=(a,b)=>a.line-b.line||a.column-b.column;
const contains=(range,p)=>range&&p&&range.file===p.file&&compare(range.start,p)<=0&&compare(p,range.end)<=0;
const nearestSwitch=node=>{for(let n=node.parent;n;n=n.parent)if(n.kind==='SwitchStmt')return n;return null;};

// Read the compiler's unoptimized CFG, never execute the user's program.
// Source labels/explicit jumps come from AST; comments have no diagnostic role.
export function fallthroughDiagnostics(ast,llvm,source){
  const nodes=astNodes(ast),switches=nodes.filter(n=>n.kind==='SwitchStmt'&&n.source?.file==='/main.c');
  if(!switches.length)return [];
  const meta=metadata(llvm),functions=[];let fn,block;
  const lines=llvm.split('\n');
  for(let i=0;i<lines.length;i++){
    let text=lines[i];
    if(text.startsWith('define ')){fn={blocks:new Map(),switches:[]};functions.push(fn);block={id:'entry',ops:[],edges:[]};fn.blocks.set(block.id,block);continue;}
    if(text==='}'){fn=null;block=null;continue;}if(!fn)continue;
    const label=/^([-\w.$]+):/.exec(text);
    if(label){block=fn.blocks.get(label[1])??{id:label[1],ops:[],edges:[]};fn.blocks.set(block.id,block);continue;}
    if(/^\s*switch\b/.test(text))while(!text.includes(']')&&i+1<lines.length)text+='\n'+lines[++i];
    if(!text.trim()||text.trim().startsWith(';'))continue;
    const debug=/!dbg !(\d+)/.exec(text),point=debug?meta.location(debug[1]):null;
    const op={text,point,block};block.ops.push(op);
    if(/^\s*(?:br|switch)\b/.test(text)){
      let edges=[...text.matchAll(/label %([-\w.$]+)/g)].map(m=>m[1]);
      const constant=/^\s*br i1 (true|false),/.exec(text);
      if(constant)edges=[edges[constant[1]==='true'?0:1]];
      block.edges=edges;block.terminator=op;
      if(/^\s*switch\b/.test(text))fn.switches.push(op);
    }
  }
  const result=[],seen=new Set(),sourceLines=source.split('\n');
  for(const f of functions){
    const reachable=new Set(),queue=[f.blocks.keys().next().value];
    while(queue.length){const id=queue.pop();if(reachable.has(id))continue;reachable.add(id);queue.push(...(f.blocks.get(id)?.edges??[]));}
    for(const dispatch of f.switches){
      const owner=switches.filter(n=>contains(n.source,dispatch.point)).sort((a,b)=>b.depth-a.depth)[0];
      if(!owner)continue;
      const labels=nodes.filter(n=>['CaseStmt','DefaultStmt'].includes(n.kind)&&nearestSwitch(n)===owner&&n.source?.file==='/main.c')
        .sort((a,b)=>compare(a.source.start,b.source.start));
      const labelAt=p=>contains(owner.source,p)?labels.filter(n=>compare(n.source.start,p)<=0).at(-1):null;
      const targetLabels=new Map();
      for(const id of dispatch.block.edges){
        const target=f.blocks.get(id),first=target?.ops.find(o=>o.point&&contains(owner.source,o.point));
        const label=first&&labelAt(first.point);if(label)targetLabels.set(id,label);
      }
      for(const from of f.blocks.values()){
        const term=from.terminator;
        if(!reachable.has(from.id)||!term||!/^\s*br\b/.test(term.text)||!contains(owner.source,term.point))continue;
        if(nodes.some(n=>['BreakStmt','ContinueStmt','GotoStmt','IndirectGotoStmt'].includes(n.kind)&&contains(n.source,term.point)))continue;
        const origin=labelAt(term.point);if(!origin)continue;
        for(const destination of from.edges){
          const target=targetLabels.get(destination);
          if(!target||target===origin||compare(origin.source.start,target.source.start)>=0)continue;
          // Shared/empty case labels have no statement between their labels.
          let body=origin;while(['CaseStmt','DefaultStmt'].includes(body.kind))body=body.children.at(-1);
          if(!body||compare(body.source?.start??target.source.start,target.source.start)>=0)continue;
          const {line,column}=target.source.start,key=`${line}:${column}`;if(seen.has(key))continue;seen.add(key);
          // Clang columns are UTF-8 byte offsets; Monaco columns are UTF-16.
          const prefix=new TextEncoder().encode(sourceLines[line-1]??'').subarray(0,column-1);
          result.push({line,column:new TextDecoder().decode(prefix).length+1,severity:'warning',source:'C 코드 검사',code:'implicit-fallthrough',
            message:'앞 case에서 break 없이 이 '+(target.kind==='DefaultStmt'?'default':'case')+'로 실행이 이어질 수 있습니다.',
            related:{from:{line:origin.source.start.line,column:origin.source.start.column},to:{line,column}}});
        }
      }
    }
  }
  return result.sort((a,b)=>a.line-b.line||a.column-b.column);
}
