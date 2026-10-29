// Restore source decisions that Clang can fold out of LLVM. A decision is
// observed only when a uniquely identified consuming store/call/return executes.
const operator=n=>n?.kind==="BinaryOperator"?/ '([^']+)'\s*$/.exec(n.details)?.[1]:null;
const logical=n=>["&&","||"].includes(operator(n));
const contains=(p,r)=>p&&r&&(p.line>r.start.line||p.line===r.start.line&&p.column>=r.start.column)&&
  (p.line<r.end.line||p.line===r.end.line&&p.column<=r.end.column);

function literalTruth(node,types) {
  if(!node)return null;
  if(["IntegerLiteral","CharacterLiteral"].includes(node.kind)) {
    const value=/ (-?\d+)\s*$/.exec(node.details)?.[1];return value===undefined?null:BigInt(value)!==0n;
  }
  if(node.kind==="FloatingLiteral") {
    const value=/ ([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$/.exec(node.details)?.[1];
    return value===undefined?null:/[1-9]/.test(value.split(/[eE]/)[0]);
  }
  if(node.kind==="ParenExpr")return literalTruth(node.children[0],types);
  if(node.kind==="UnaryOperator") {
    const op=/prefix '([!+-])'/.exec(node.details)?.[1],truth=literalTruth(node.children[0],types);
    return !op||truth===null?null:op==="!"?!truth:truth;
  }
  if(["ImplicitCastExpr","CStyleCastExpr"].includes(node.kind)) {
    if(node.details.includes("<IntegralToBoolean>"))return literalTruth(node.children[0],types);
    if(node.details.includes("<IntegralCast>")) {
      const from=types.spelling(node.children[0]?.type,node.children[0]?.canonical),to=types.spelling(node.type,node.canonical);
      if(from&&to&&to.sizeBits>=from.sizeBits)return literalTruth(node.children[0],types);
    }
  }
  // Do not invent a general constant evaluator. Non-literal compiler facts need
  // their own verified source mapping.
  return null;
}

function context(node) {
  let child=node,parent=node.parent;
  while(parent&&(parent.kind==="ParenExpr"||["ImplicitCastExpr","CStyleCastExpr"].includes(parent.kind))) {child=parent;parent=parent.parent;}
  if(parent?.kind==="VarDecl"&&parent.children[0]===child&&!/\b(static|extern)\b/.test(parent.details))return {kind:"initialize",node:parent};
  if(parent?.kind==="BinaryOperator"&&operator(parent)==="="&&parent.children[1]===child&&parent.children[0]?.kind==="DeclRefExpr")return {kind:"assign",node:parent};
  if(parent?.kind==="ReturnStmt"&&parent.children[0]===child)return {kind:"return",node:parent};
  if(parent?.kind==="CallExpr") {const index=parent.children.indexOf(child)-1;if(index>=0)return {kind:"argument",node:parent,index};}
  return null;
}

export function foldedShortCircuits(nodes,source,filename,types) {
  const bytes=Buffer.from(source,"utf8"),lines=[0];for(let i=0;i<bytes.length;i++)if(bytes[i]===10)lines.push(i+1);
  function range(raw) {
    if(!raw||raw.file!=="/main.c")return null;
    const start=lines[raw.start.line-1]+raw.start.column-1,last=lines[raw.end.line-1]+raw.end.column-1;
    if(!Number.isInteger(start)||!Number.isInteger(last)||start<0||last>=bytes.length)return null;
    const token=/^(?:[\p{ID_Start}_][\p{ID_Continue}_]*|(?:\d[\w.]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\+\+|--|&&|\|\||.))/us.exec(bytes.subarray(last).toString("utf8"))?.[0];
    if(!token)return null;const end=last+Buffer.byteLength(token);
    return {file:filename,line:raw.start.line,column:raw.start.column,start:{line:raw.start.line,column:raw.start.column,byte:start},
      end:{line:raw.end.line,column:raw.end.column+end-last,byte:end},expression:bytes.subarray(start,end).toString("utf8")};
  }
  const expressions=nodes.filter(logical).map((node,index)=>{
    const op=operator(node),truth=literalTruth(node.children[0],types),skip=truth===null?null:op==="&&"?!truth:truth;
    return {id:`logical${index+1}`,node,operator:op,leftTruth:truth,skipped:skip,source:range(node.source),
      left:range(node.children[0]?.source),right:range(node.children[1]?.source),context:context(node),bound:new Set()};
  });
  const decisions=expressions.filter(e=>e.skipped),candidates=decisions.filter(e=>e.source&&e.left&&e.right);
  function before(operation,functionName) {
    const result=[];
    for(const item of candidates) {
      if(item.node.functionName!==functionName||operation.source?.file!==filename)continue;
      const ctx=item.context;if(!ctx)continue;let input;
      const where=operation.source,owner=ctx.node;
      if(ctx.kind==="initialize"&&operation.action==="store"&&where.line===owner.declarationPoint?.line&&where.column===owner.declarationPoint?.column)input=operation.inputs[0];
      if(ctx.kind==="assign"&&operation.action==="store"&&contains(where,owner.source)&&!contains(where,item.node.source))input=operation.inputs[0];
      if(ctx.kind==="return"&&operation.action==="function.return"&&where.line===owner.source.start.line&&where.column===owner.source.start.column)input=operation.inputs[0];
      if(ctx.kind==="argument"&&operation.action==="call"&&where.line===owner.source.start.line&&where.column===owner.source.start.column)input=operation.args[ctx.index];
      // The observed consumer must carry the exact folded Boolean result.
      if(!input||!/^i\d+$/.test(input.type)||input.value!==(item.operator==="&&"?"0":"1"))continue;
      item.bound.add(operation.id);result.push({item,input});
    }
    return result;
  }
  const describe=e=>({id:e.id,operator:e.operator,source:e.source,left:{source:e.left,truth:e.leftTruth,evidence:"compiler AST literal"},
    right:{source:e.right,evaluation:e.skipped===null?"runtime-dependent":e.skipped?"skipped":"required"},
    reason:e.skipped?(e.operator==="&&"?"and-left-false":"or-left-true"):null,
    anchorInstructionIds:[...e.bound]});
  return {before,describe,
    report(){return {mode:"literal constant-left decisions at observed consumers",expressions:expressions.map(describe),
      foldedSkips:decisions.length,inserted:decisions.filter(e=>e.bound.size).length,
      unobserved:decisions.filter(e=>!e.bound.size).map(e=>({source:e.source,reason:e.source&&e.left&&e.right?"no reliable observed consuming store, call or return":"source range not mapped"}))};}};
}
