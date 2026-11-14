import {astNodes} from '../model/ast.mjs';
import {createSourceMap} from '../model/source-map.mjs';

// Presentation-only AST ranges. Never changes the plan or execution events.
export function loopNavigation(plan,{nodes,ast,source=plan.sourceMap?.snapshot?.text}={}){
  const kinds=new Set(['ForStmt','WhileStmt','DoStmt']);
  if(!nodes&&typeof ast==='string')nodes=astNodes(ast);
  if(!nodes||typeof source!=='string')return undefined;
  const ranges=createSourceMap({source,filename:plan.source.file,nodes:[],llvm:''});
  const functions=new Map(plan.functions.map(f=>[f.name,f.id]));
  const loops=nodes.filter(n=>kinds.has(n.kind)&&n.functionName).map(n=>{
    const condition={ForStmt:n.childSlots[2],WhileStmt:n.children[0],DoStmt:n.children.at(-1)}[n.kind];
    return {id:`loop:${n.id}`,nodeId:n.id,kind:n.kind,functionId:functions.get(n.functionName),functionName:n.functionName,
      source:ranges.range(n.expansionSource??n.source),conditionSource:ranges.range(condition?.expansionSource??condition?.source)};
  }).filter(loop=>loop.functionId&&loop.source);
  return {version:1,programId:plan.programId,loops};
}
