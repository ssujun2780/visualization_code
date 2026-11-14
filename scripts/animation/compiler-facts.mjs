import {astNodes} from '../model/ast.mjs';
import {digest} from '../execution-relations/v2/common.mjs';

const op=n=>n?.kind==='UnaryOperator'?/\b(?:prefix|postfix) '([^']+)'/.exec(n.details)?.[1]:/ '([+*/%&|^<>=!,?:~-]+)'(?:\s|$)/.exec(n?.details??'')?.[1];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const descendants=n=>{const list=[],todo=[n];while(todo.length){const at=todo.pop();if(at){list.push(at);todo.push(...at.children??[]);}}return list;};
const ref=n=>/\b(?:Var|ParmVar) (0x[0-9a-f]+)\b/.exec(unwrap(n)?.details??'')?.[1];

// Orchestration adapter over the compiler output ALREADY used for this run.
// No C text scan, compiler invocation, execution or name-based classification.
export function collectCompilerFacts(plan,{nodes,ast}={}){
  nodes??=typeof ast==='string'?astNodes(ast):[];
  const byNode=new Map(),nodesById=new Map(nodes.map(n=>[n.id,n])),known=new Set(),expressionOwners=[],accesses=new Map();
  for(const i of plan.instructions){if(i.sourceNodeId){known.add(i.sourceNodeId);const list=byNode.get(i.sourceNodeId)??[];list.push(i);byNode.set(i.sourceNodeId,list);}
    const todo=[i.expression];while(todo.length){const n=todo.pop();if(!n)continue;if(n.nodeId)known.add(n.nodeId);todo.push(...n.children??[]);}
    if(i.expression?.nodeId)expressionOwners.push({instructionId:i.id,nodeId:i.expression.nodeId});
    const root=nodesById.get(i.sourceNodeId),access=i.kind==='READ'?unwrap(root):i.kind==='WRITE'&&op(root)==='='?unwrap(root.children[0]):null;
    if(access?.kind==='ArraySubscriptExpr'){const list=accesses.get(access.id)??[];list.push(i);accesses.set(access.id,list);}
  }
  const functionIds=new Map(plan.functions.map(f=>[f.name,f.id])),regions=[],domains=[],gaps=[];
  const definitions=n=>descendants(n).flatMap(c=>byNode.get(c.id)??[]);
  const order=new Map(plan.instructions.map((i,p)=>[i.id,p]));
  const declaration=n=>{const id=ref(n),node=nodes.find(x=>x.astId===id);return node&&plan.declarations.find(d=>d.kind===node.kind&&d.functionName===node.functionName&&
    d.point?.line===node.declarationPoint?.line&&d.point?.column===node.declarationPoint?.column);};
  const binding=n=>{const at=unwrap(n);if(!at)return null;
    if(descendants(n).some(c=>c.kind==='CStyleCastExpr'||c.kind==='ImplicitCastExpr'&&!['<LValueToRValue>','<ArrayToPointerDecay>','<NoOp>'].some(k=>c.details.includes(k))))return null;
    if(['IntegerLiteral','CharacterLiteral'].includes(at.kind)&&known.has(at.id)){const value=/ (-?\d+)\s*$/.exec(at.details)?.[1];if(value!==undefined)return {literal:value,nodeId:at.id};}
    // A read inside n+1 or a[row] is NOT the value/base of that expression.
    if(at.kind!=='DeclRefExpr')return null;
    const d=declaration(at),fn=plan.functions.find(f=>f.id===functionIds.get(at.functionName)),index=fn?.parameters.indexOf(d?.id);
    if(index>=0)return {parameterIndex:index};
    const i=definitions(n).filter(i=>i.kind==='READ').sort((a,b)=>order.get(a.id)-order.get(b.id))[0];return i?{instructionId:i.id}:null;
  };
  for(const loop of nodes.filter(n=>['ForStmt','WhileStmt','DoStmt'].includes(n.kind)&&n.functionName)){
    const body=loop.children.at(-1),condition=loop.kind==='ForStmt'?loop.childSlots[2]:loop.kind==='WhileStmt'?loop.children[0]:loop.children.at(-1),
      actualBody=loop.kind==='DoStmt'?loop.children[0]:body,bodyInstructions=definitions(actualBody),all=definitions(loop),functionId=functionIds.get(loop.functionName);
    if(!functionId)continue;
    // The first straight-line statement must execute on every body entry.
    // Nested condition arms are not entry points; unsupported entries stay gaps.
    let first=actualBody?.kind==='CompoundStmt'?actualBody.children[0]:actualBody;
    if(first?.kind==='DeclStmt')first=first.children[0];
    const entry=definitions(first).sort((a,b)=>order.get(a.id)-order.get(b.id))[0];
    const safeFirst=first&&!['IfStmt','ForStmt','WhileStmt','DoStmt','SwitchStmt','ConditionalOperator','LabelStmt','GotoStmt'].includes(first.kind);
    const guards=all.filter(i=>i.action==='branch'&&i.controlKind===loop.kind&&[loop.id,condition?.id].includes(i.sourceNodeId)&&i.destinations?.length===2),guard=loop.kind!=='DoStmt'&&guards.length===1?guards[0]:null;
    const breakOwner=n=>{for(let at=n?.parent;at;at=at.parent)if(['ForStmt','WhileStmt','DoStmt','SwitchStmt'].includes(at.kind))return at;};
    if(guard||entry&&safeFirst)regions.push({id:`region:${loop.id}`,kind:'loop',functionId,entryInstructionIds:guard?[]:[entry.id],
      ...(guard?{entryEdges:[{instructionId:guard.id,selected:guard.destinations[0]}],exitEdges:[{instructionId:guard.id,selected:guard.destinations[1]}]}:{}),
      exitInstructionIds:all.filter(i=>i.action==='return'||i.action==='break'&&breakOwner(nodesById.get(i.sourceNodeId))===loop).map(i=>i.id),memberInstructionIds:bodyInstructions.map(i=>i.id)});
    else gaps.push({nodeId:loop.id,reason:'no-unconditional-body-entry'});
    if(loop.kind!=='ForStmt')continue;
    const init=loop.childSlots[0],increment=unwrap(loop.childSlots[3]),comparison=unwrap(condition),index=unwrap(comparison?.children[0]),upper=comparison?.children[1],
      variable=init?.kind==='DeclStmt'?init.children[0]:null,lower=variable?.children.at(-1),delta=op(increment)==='++'?'1':op(increment)==='--'?'-1':null;
    if(!variable||ref(index)!==variable.astId||ref(increment?.children[0])!==variable.astId||!delta||!['<','<=','>','>='].includes(op(comparison)))continue;
    if(descendants(comparison.children[0]).some(n=>n.kind==='CStyleCastExpr'||n.kind==='ImplicitCastExpr'&&!n.details.includes('<LValueToRValue>')))continue;
    const bodyNodes=descendants(actualBody),mutatesIndex=bodyNodes.some(n=>(n.kind==='BinaryOperator'&&op(n)==='='||n.kind==='CompoundAssignOperator'||n.kind==='UnaryOperator'&&['++','--'].includes(op(n)))&&ref(n.children[0])===variable.astId);
    // Aliased/unknown calls and explicit index conversions need stronger proofs.
    const indexEscapes=bodyNodes.some(n=>n.kind==='UnaryOperator'&&op(n)==='&'&&ref(n.children[0])===variable.astId);
    if(mutatesIndex||indexEscapes||bodyNodes.some(n=>n.kind==='CallExpr')){gaps.push({nodeId:loop.id,reason:'unproved-index-or-call-effects'});continue;}
    const indexDecl=plan.declarations.find(d=>d.functionName===variable.functionName&&d.point?.line===variable.declarationPoint?.line&&d.point?.column===variable.declarationPoint?.column);
    const lo=binding(lower),hi=binding(upper),indexType=indexDecl?.cType;
    if(!lo||!hi||!indexType?.signedness)continue;
    for(const access of descendants(actualBody).filter(n=>n.kind==='ArraySubscriptExpr'&&ref(n.children[1])===variable.astId)){
      if(descendants(access.children[1]).some(n=>n.kind==='CStyleCastExpr'||n.kind==='ImplicitCastExpr'&&!n.details.includes('<LValueToRValue>')))continue;
      const base=binding(access.children[0]),ids=accesses.get(access.id)??[],width=ids[0]?.cType?.sizeBits/8;
      if(!base||!ids.length||!Number.isSafeInteger(width)||width<1)continue;
      domains.push({id:`domain:${access.id}`,proofKind:'affine-loop',functionId,entryInstructionIds:[...new Set([...definitions(access.children[0]).map(i=>i.id),...ids.map(i=>i.id)])],
        accessInstructionIds:ids.map(i=>i.id),sourceNodeIds:[access.id],base,lower:lo,upper:hi,step:delta,comparison:op(comparison),elementSizeBytes:width,
        indexType:{sizeBits:indexType.sizeBits,signedness:indexType.signedness}});
    }
  }
  return {schemaVersion:1,scope:{programId:plan.programId},sourceDigest:digest(plan.sourceMap?.snapshot??plan.source),expressionOwners,regions,domains,
    coverage:{basis:'existing AST and IR LLVM/source mappings',sourceSemanticScans:0,linkedInstructions:byNode.size,astNodes:nodes.length,gaps}};
}
