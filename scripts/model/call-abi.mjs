// AST child roles decide whether a returned value is consumed. In particular,
// a statement used as an unbraced control-flow body still discards its result.
export function returnDisposition(node,types){
  if(types.spelling(node.type,node.canonical)?.kind==='void')return 'discarded';
  let at=node;
  while(at.parent){
    const parent=at.parent,index=parent.children.indexOf(at);
    if(['ParenExpr','ImplicitCastExpr','AttributedStmt','GenericAssociation','GenericSelectionExpr'].includes(parent.kind)){at=parent;continue;}
    if(parent.kind==='CStyleCastExpr')return types.spelling(parent.type,parent.canonical)?.kind==='void'?'discarded':'used';
    if(parent.kind==='BinaryOperator'&&/ ','\s*$/.test(parent.details)){
      if(index===0)return 'discarded';at=parent;continue;
    }
    if(['ConditionalOperator','BinaryConditionalOperator'].includes(parent.kind)){
      if(index===0)return 'used';at=parent;continue;
    }
    if(parent.kind==='CompoundStmt'){
      if(parent.parent?.kind==='StmtExpr'&&at===parent.children.at(-1)){at=parent.parent;continue;}
      return 'discarded';
    }
    if(['IfStmt','WhileStmt','SwitchStmt'].includes(parent.kind))return index===0?'used':'discarded';
    if(parent.kind==='DoStmt')return at===parent.children.at(-1)?'used':'discarded';
    if(parent.kind==='ForStmt')return at===parent.childSlots[2]?'used':'discarded';
    if(['LabelStmt','CaseStmt','DefaultStmt'].includes(parent.kind)&&at===parent.children.at(-1))return 'discarded';
    return 'used';
  }
  return 'used';
}

// Source argument identities and compiler lowering slots are distinct.
export function callProjection(op,node,{types,sourceName}){
  if(!node)return null;
  const count=node.children.length-1,visible=op.args.flatMap((a,index)=>a.sret?[]:[index]),
    hidden=op.args.flatMap((a,abiIndex)=>a.sret?[{abiIndex,role:'return-storage'}]:[]),
    returnType=types.spelling(node.type,node.canonical);
  const disposition=returnDisposition(node,types);
  const intrinsic=/^@llvm\.(memcpy|memmove|memset)\./.exec(op.callee),
    memory=intrinsic&&sourceName?.replace(/^__builtin_/,'')===intrinsic[1]&&count===3&&op.args.length===4&&
      op.args[0].type.endsWith('*')&&op.args[3].type==='i1';
  if(memory)hidden.push({abiIndex:3,role:'volatile-flag'});
  const indices=memory?[0,1,2]:visible,status=indices.length===count?'mapped':'unresolved';
  return {status,arguments:status==='mapped'?indices.map((abiIndex,sourceIndex)=>({abiIndex,sourceIndex,nodeId:node.children[sourceIndex+1].id})):[],
    hiddenArguments:hidden,sourceArgumentCount:count,returnType,returnDisposition:disposition,
    ...(memory&&returnType?.kind==='pointer'?{returnFromArgument:0,returnEvidence:'compiler memory intrinsic contract'}:{}),
    ...(status==='unresolved'?{reason:'source arguments do not match known compiler ABI slots'}:{}),
    evidence:'compiler AST call + LLVM argument roles'};
}
