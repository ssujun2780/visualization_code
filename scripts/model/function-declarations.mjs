// Function specifiers come from Clang declarations, never from source text.
// Declaration chains preserve an inline prototype followed by a plain definition.
export function bindFunctionDeclarations(plan,{nodes,sourceMap}){
  const functions=nodes.filter(n=>n.kind==='FunctionDecl'),byAST=new Map(functions.map(n=>[n.astId,n])),roots=new Map();
  function root(n){
    if(roots.has(n.astId))return roots.get(n.astId);
    const previous=byAST.get(n.previousDeclarationASTId),id=previous?root(previous):n.id;
    roots.set(n.astId,id);return id;
  }
  const groups=new Map();
  for(const n of functions){const id=root(n);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(n);}
  const emitted=new Map(plan.functions.map(f=>[f.name,f]));
  plan.functionDeclarations=functions.filter(n=>n.source?.file==='/main.c').map(n=>({
    nodeId:n.id,canonicalDeclarationId:root(n),previousDeclarationNodeId:byAST.get(n.previousDeclarationASTId)?.id??null,
    name:n.functionName,type:n.type,source:sourceMap.range(n.source),specifiers:n.functionSpecifiers,
    isDefinition:n.children.some(c=>c.kind==='CompoundStmt'),functionId:emitted.get(n.functionName)?.id??null,
    allocatesFrame:false,evidence:'compiler AST function declaration'}));
  const declarations=new Map(plan.functionDeclarations.map(d=>[d.nodeId,d]));
  for(const f of plan.functions){
    const definition=functions.find(n=>n.functionName===f.name&&n.children.some(c=>c.kind==='CompoundStmt'));
    if(!definition||!declarations.has(definition.id))continue;
    const chain=groups.get(root(definition));
    f.sourceNodeId=definition.id;
    f.declarationNodeIds=chain.filter(n=>declarations.has(n.id)).map(n=>n.id);
    f.specifiers={inline:chain.some(n=>n.functionSpecifiers.inline)};
  }
}

export function validateFunctionDeclarations(plan){
  if(!plan.functionDeclarations)return;
  const functions=new Map(plan.functions.map(f=>[f.id,f])),declarations=new Map(plan.functionDeclarations.map(d=>[d.nodeId,d]));
  for(const d of declarations.values())if(d.allocatesFrame!==false||typeof d.specifiers?.inline!=='boolean'||
    d.functionId&&!functions.has(d.functionId))throw new Error('함수 선언의 속성 또는 정의 연결이 올바르지 않습니다.');
  for(const f of functions.values())if(f.declarationNodeIds){
    const chain=f.declarationNodeIds.map(id=>declarations.get(id));
    if(chain.some(d=>!d||d.functionId!==f.id)||!chain.some(d=>d.nodeId===f.sourceNodeId&&d.isDefinition)||
      typeof f.specifiers?.inline!=='boolean'||!f.llvmLinkage)
      throw new Error('함수 정의와 AST 선언·LLVM 연결이 올바르지 않습니다.');
  }
}
