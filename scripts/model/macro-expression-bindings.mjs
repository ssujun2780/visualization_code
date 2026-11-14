// Macro debug locations collapse many AST occurrences to one invocation point.
// Recover operations from compiler tokens and SSA inputs, never source text.
import {compilerInteger} from './source-map.mjs';

const operator=n=>n?.kind==='UnaryOperator'?/\b(?:prefix|postfix) '([^']+)'/.exec(n.details)?.[1]:
  / '([^']+)'(?:\s+ComputeLHSTy=|\s*$)/.exec(n?.details??'')?.[1];
const codes={'+':['add','fadd'],'-':['sub','fsub'],'*':['mul','fmul'],'/':['sdiv','udiv','fdiv'],
  '%':['srem','urem','frem'],'&':['and'],'|':['or'],'^':['xor'],'<<':['shl'],'>>':['ashr','lshr']};
const predicates={'<':['slt','ult','olt'],'>':['sgt','ugt','ogt'],'<=':['sle','ule','ole'],
  '>=':['sge','uge','oge'],'==':['eq','oeq'],'!=':['ne','une']};
const contains=(root,node)=>{for(let n=node;n;n=n.parent)if(n===root)return true;return false;};
const strip=n=>{while(n?.children.length===1&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind))n=n.children[0];return n;};
const literal=n=>compilerInteger(strip(n));
const llvmType=t=>t?.kind==='pointer'?`${llvmType(t.pointee)??'?'}*`:
  t?.encoding==='DW_ATE_float'?(t.sizeBits===32?'float':t.sizeBits===64?'double':null):t?.signedness||t?.encoding==='DW_ATE_boolean'?`i${t.sizeBits}`:null;

export function macroExpressionBindings({types,matchesCast}){
  const producers=new Map(),claimed=new Set();
  const key=(op,value)=>`${op.functionId}:${value}`;
  function compatibleType(node,type){
    const cType=types.spelling(node?.type,node?.canonical),expected=llvmType(cType);
    if(cType?.encoding==='DW_ATE_boolean'&&type==='i1')return true;
    return !expected||expected.includes('?')||expected===type;
  }
  function inputScore(op,expected,input){
    if(!expected||!input)return -1;
    if(!compatibleType(expected,input.type))return -1;
    const n=producers.get(key(op,input.value))?.node;
    if(n)return contains(expected,n)||contains(n,expected)?4:-1;
    const value=literal(expected);
    if(value!==null&&/^-?\d+$/.test(input.value)){
      // LLVM integers are bit patterns and may print an unsigned C literal
      // using signed notation (UINT_MAX as i32 -1). Compare at the proven
      // operand width, retaining the AST's C signedness for presentation.
      const type=types.spelling(expected.type,expected.canonical),width=/^i(\d+)$/.exec(input.type);
      const same=width&&type?.signedness&&type.sizeBits===Number(width[1])?
        BigInt.asUintN(type.sizeBits,BigInt(value))===BigInt.asUintN(type.sizeBits,BigInt(input.value)):
        BigInt(value)===BigInt(input.value);
      return same?2:-1;
    }
    return 0;
  }
  function resolve(op,candidates,{storageMatched=false}={}){
    // A short-circuit merge has no debug point. Its observed RHS producer and
    // bypass literal identify the AST evaluation before the following zext.
    if(op.opcode==='phi'&&op.type==='i1'&&op.inputs?.length===2){
      const bypass=op.inputs.find(i=>['true','false','0','1'].includes(i.value)),
        rhs=op.inputs.find(i=>i!==bypass),origin=rhs&&producers.get(key(op,rhs.value))?.node;
      if(bypass&&origin)for(let n=origin.parent;n;n=n.parent){
        if(['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind))break;
        const symbol=operator(n);if(!['&&','||'].includes(symbol))continue;
        if(n.macroTokenRange&&contains(n.children[1],origin)&&
          (symbol==='&&'?['false','0']:['true','1']).includes(bypass.value))return n;
        break;
      }
    }
    const macro=candidates.filter(n=>n.macroTokenRange&&!n.executionState);
    if(!macro.length)return null;
    // C int materialization reuses the exact comparison producer occurrence.
    if(op.opcode==='zext'&&op.inputs?.[0]?.type==='i1'){
      const previous=producers.get(key(op,op.inputs[0].value));
      if(previous?.node?.macroTokenRange&&(predicates[operator(previous.node)]&&
        ['icmp','fcmp'].includes(previous.op.opcode)||previous.op.opcode==='phi'&&['&&','||'].includes(operator(previous.node))))return previous.node;
      // A real _Bool promotion is a C cast, unlike comparison materialization.
    }
    const choices=[];
    for(const node of macro){
      if(claimed.has(`${node.id}:${op.opcode}`))continue;
      const symbol=operator(node);let score=0;
      if(matchesCast(node,op)){
        if(!compatibleType(node,op.type))continue;
        const input=inputScore(op,node.children[0],op.inputs?.[0]);
        if(input<=0)continue;
        score+=input;
      }else if(op.opcode==='call'){
        if(node.kind!=='CallExpr'||!op.callee?.startsWith('@'))continue;
        const target=strip(node.children[0]),symbol=/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target?.details??'')?.[1];
        if(!symbol||symbol!==op.callee.slice(1).replace(/^"|"$/g,''))continue;
        score+=4;
      }else if(op.opcode==='load'){
        if(node.kind!=='ImplicitCastExpr'||!node.details.includes('<LValueToRValue>')||!compatibleType(node,op.type))continue;
        const address=producers.get(key(op,op.pointer?.value))?.node;
        // A declaration owns storage, not the later expression referring to
        // it. A proven compiler storage path supersedes subtree containment.
        if(storageMatched)score+=4;
        else if(address){if(!contains(node,address)&&!contains(address,node))continue;score+=4;}
      }else if(node.kind==='BinaryOperator'||node.kind==='CompoundAssignOperator'){
        const binary=node.kind==='CompoundAssignOperator'?symbol?.slice(0,-1):symbol;
        if(['icmp','fcmp'].includes(op.opcode)){
          if(!predicates[binary]?.includes(op.predicate))continue;
        }else if(!codes[binary]?.includes(op.opcode))continue;
        const scores=node.children.map((child,index)=>inputScore(op,child,op.inputs?.[index]));
        if(scores.some(s=>s<0))continue;score+=scores.reduce((a,b)=>a+b,0);
      }else if(node.kind==='UnaryOperator'&&['++','--'].includes(symbol)){
        if(!(symbol==='++'?['add','fadd']:['sub','fsub']).includes(op.opcode))continue;
        const input=inputScore(op,node.children[0],op.inputs?.[0]);
        if(input<0||!['1','1.000000e+00'].includes(op.inputs?.[1]?.value))continue;score+=input;
      }else continue;
      choices.push({node,score});
    }
    // SSA compatibility wins. Equal repeated substitutions use their distinct
    // Clang token occurrence order, advancing only for the matching operation.
    choices.sort((a,b)=>b.score-a.score||a.node.macroTokenRange.start-b.node.macroTokenRange.start||b.node.depth-a.node.depth);
    const node=choices[0]?.node;if(node)claimed.add(`${node.id}:${op.opcode}`);return node??null;
  }
  return {resolve,record(op,node){if(op.result)producers.set(key(op,op.result),{op,node});}};
}
