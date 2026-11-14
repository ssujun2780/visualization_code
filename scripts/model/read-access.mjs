import {operand,llvmFunction,llvmName} from './llvm.mjs';
import {aggregateSources} from './aggregate-bindings.mjs';
import {compilerInteger} from './source-map.mjs';

// A debug location can cover both an index update and the enclosing member
// read. Resolve the storage being loaded before choosing its source expression.
// These paths describe compiler address producers, never runtime values or C
// expression evaluation. Index values remain the original observed SSA values.
export function readAccessBindings({ir,meta,nodes,types,sourceMap,abi}){
  const byAST=new Map(nodes.map(n=>[n.astId,n])),source=aggregateSources(types,nodes),
    allocations=new Map(),paths=new Map(),producers=new Map(),byNode=new Map(nodes.map(n=>[n.id,n]));
  const key=(fn,value)=>`${fn}:${value}`;
  const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind)&&n.children.length===1)n=n.children[0];return n;};
  const typeOf=n=>n&&types.spelling(n.type,n.canonical);
  const fieldPart=p=>({kind:'member',index:p.index,offsetBits:p.offsetBits,typeId:p.typeId});
  const append=(base,part,cType)=>base?.rootNodeId&&Array.isArray(base.path)?({...base,path:[...base.path,part],cType}):null;
  const dereference=(base,cType)=>append(base,{kind:'indirect'},cType);
  const update=n=>n?.kind==='UnaryOperator'&&/(?:prefix|postfix) '(?:\+\+|--)'/.test(n.details);
  function access(raw){
    const n=unwrap(raw);if(!n)return null;
    if(n.kind==='DeclRefExpr'){
      const id=/\b(?:Var|ParmVar) (0x[0-9a-f]+)/.exec(n.details)?.[1],declaration=byAST.get(id);
      return declaration?{rootNodeId:declaration.id,path:[],cType:typeOf(n)}:null;
    }
    if(n.kind==='MemberExpr'){
      const base=n.memberAccess==='->'?pointerValue(n.children[0]):access(n.children[0]),
        record=n.memberAccess==='->'?typeOf(n.children[0])?.pointee:typeOf(n.children[0]),part=source.field(n.fieldASTId,record);
      return part?append(base,fieldPart(part),typeOf(n)):null;
    }
    if(n.kind==='ArraySubscriptExpr'){
      // The compiler may commute i[p]. The pointer/array operand's type tells
      // us which child produces the address, independently of operand order.
      const child=n.children.find(c=>['pointer','array'].includes(typeOf(c)?.kind));
      const base=child&&pointerValue(child);return base?{...base,cType:typeOf(n)}:null;
    }
    if(n.kind==='UnaryOperator'&&/prefix '\*'/.test(n.details))return pointerValue(n.children[0]);
    return null;
  }
  function pointerValue(raw){
    const n=unwrap(raw);if(!n)return null;
    // The call occurrence is a symbolic address origin, not a guessed object
    // or a re-evaluation of the function. Runtime references remain observed.
    if(n.kind==='CallExpr'&&typeOf(n)?.kind==='pointer')return {rootNodeId:n.id,path:[],cType:typeOf(n).pointee};
    if(n.kind==='UnaryOperator'&&/prefix '&'/.test(n.details))return access(n.children[0]);
    if(n.kind==='BinaryOperator'&&/ '[+-]'\s*$/.test(n.details))return pointerValue(n.children.find(c=>typeOf(c)?.kind==='pointer'));
    if(update(n))return pointerValue(n.children[0]);
    const base=access(n),type=typeOf(n);
    return type?.kind==='array'?append(base,{kind:'index'},type.elementType):type?.kind==='pointer'?dereference(base,type.pointee):null;
  }
  const equal=(a,b)=>!!a&&!!b&&a.rootNodeId===b.rootNodeId&&JSON.stringify(a.path)===JSON.stringify(b.path);
  const contains=(root,node)=>{for(let n=node;n;n=n.parent)if(n===root)return true;return false;};
  const symbol=n=>/\b(?:prefix|postfix) '([^']+)'/.exec(n?.details??'')?.[1]??/ '([^']+)'\s*$/.exec(n?.details??'')?.[1];
  function addressPath(op,functionName){
    const base=paths.get(key(functionName,op.pointer?.value));if(!base||base.backendType!==op.baseType)return null;
    let next={...base},backend=op.baseType;
    for(const [index,input]of op.inputs.slice(1).entries()){
      if(index===0)continue;
      if(next.cType?.kind==='array'){
        next=append(next,{kind:'index'},next.cType.elementType);backend=abi.layout(backend).elementType;
      }else if(next.cType?.recordKind==='struct'){
        const position=Number(input.value),member=next.cType.members[position],field=abi.layout(backend).fields?.[position];
        if(!Number.isInteger(position)||!member||!field||member.offsetBits!==field.offset*8||member.sizeBits!==abi.layout(field.type).size*8)return null;
        next=append(next,fieldPart({...member,index:position}),types.debug(member.typeId));backend=field.type;
      }else return null;
    }
    return {...next,backendType:backend};
  }
  function resolveAddress(op,functionName,candidates){
    if(op.action!=='address')return null;
    const path=addressPath(op,functionName);if(!path)return null;
    const origin=byNode.get(producers.get(key(functionName,op.pointer.value))?.semanticNodeId),choices=[];
    const indexMatches=(expression,input,negated=false)=>{
      const producer=producers.get(key(functionName,input?.value)),previous=byNode.get(producer?.semanticNodeId);
      if(negated&&producer?.opcode==='sub'&&producer.inputs?.[0]?.value==='0')return indexMatches(expression,producer.inputs[1]);
      if(previous&&!negated)return contains(expression,previous);
      const constant=compilerInteger(unwrap(expression));
      return constant!==null&&/^-?\d+$/.test(input?.value??'')&&(negated?-BigInt(constant):BigInt(constant))===BigInt(input.value);
    };
    for(const node of candidates){
      let target=null;
      if(node.kind==='UnaryOperator'&&symbol(node)==='&')target=unwrap(node.children[0]);
      else if(['MemberExpr','ArraySubscriptExpr'].includes(node.kind))target=node;
      if(target&&equal(access(target),path)){
        // The storage path identifies fields; the actual SSA producer identifies
        // the occurrence when macro arguments repeat that same storage.
        if(origin&&!contains(target,origin)&&!['VarDecl','ParmVarDecl'].includes(origin.kind))continue;
        if(target.kind==='ArraySubscriptExpr'){
          const index=target.children.find(c=>!['pointer','array'].includes(typeOf(c)?.kind));
          if(!indexMatches(index,op.inputs.at(-1)))continue;
        }
        choices.push({node,target,explicit:node!==target});
      }else if((node.kind==='BinaryOperator'&&['+','-'].includes(symbol(node))||update(node))&&typeOf(node)?.kind==='pointer'){
        const pointer=node.children.find(c=>typeOf(c)?.kind==='pointer');
        if(!equal(pointerValue(pointer),path)||origin&&!contains(pointer,origin))continue;
        const input=op.inputs[1],index=node.children.find(c=>c!==pointer);
        if(update(node)?input?.value!==(symbol(node)==='++'?'1':'-1'):!indexMatches(index,input,symbol(node)==='-'))continue;
        choices.push({node,target:node,explicit:true});
      }
    }
    const explicit=choices.filter(c=>c.explicit),matching=explicit.length?explicit:choices;
    if(matching.length!==1)return null;
    const {node,target,explicit:visible}=matching[0];
    return {node,cType:visible?typeOf(node):null,binding:{status:'resolved',nodeId:node.id,accessNodeId:target.id,
      operatorNodeId:visible?node.id:null,rootNodeId:path.rootNodeId,path:path.path,evidence:'compiler storage path, field layout and SSA address producer'}};
  }
  // dbg.declare is the compiler bridge from an LLVM allocation to the AST
  // declaration. Its precise declaration location or parameter ordinal binds
  // that identity; user names and LLVM temporary spellings are not classifiers.
  let fn=null;
  for(const line of ir.split('\n')){
    if(line.startsWith('define '))fn=llvmName(llvmFunction.exec(line)?.[1])??null;
    const declaration=/@llvm\.dbg\.declare\(metadata (.*?), metadata !(\d+),/.exec(line);
    if(fn&&declaration){
      const pointer=operand(declaration[1]),argument=Number(meta.field(declaration[2],'arg')??0),
        location=meta.location(/!dbg !(\d+)/.exec(line)?.[1]);
      const functionNode=nodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===fn&&n.children.some(c=>c.kind==='CompoundStmt'));
      const candidates=argument?functionNode?.children.filter(n=>n.kind==='ParmVarDecl').slice(argument-1,argument)??[]:
        sourceMap.candidates(location,fn).filter(n=>n.kind==='VarDecl'&&n.declarationPoint?.line===location?.line&&n.declarationPoint?.column===location?.column);
      if(candidates.length===1)allocations.set(key(fn,pointer.value),candidates[0]);
    }
    if(line==='}')fn=null;
  }
  function record(op,functionName){
    const valueKey=value=>key(functionName,value);
    if(op.result)producers.set(valueKey(op.result),op);
    if(op.action==='call'&&op.type?.endsWith('*')){
      const node=byNode.get(op.semanticNodeId),base=node?.kind==='CallExpr'?pointerValue(node):null;
      if(base)paths.set(valueKey(op.result),{...base,backendType:op.type.slice(0,-1)});
    }
    if(op.action==='object.begin'){
      const declaration=allocations.get(valueKey(op.result));
      if(declaration)paths.set(valueKey(op.result),{rootNodeId:declaration.id,path:[],cType:op.cType??typeOf(declaration),backendType:op.type});
    }
    if(op.action==='load'&&op.type.endsWith('*')){
      const base=paths.get(valueKey(op.pointer.value));
      if(base?.cType?.kind==='pointer')paths.set(valueKey(op.result),{...dereference(base,base.cType.pointee),backendType:op.type.slice(0,-1)});
    }
    if(op.action==='convert'&&op.opcode==='bitcast'){
      const base=paths.get(valueKey(op.inputs[0]?.value));
      // A representation-changing cast cannot prove a typed access path.
      if(base&&op.type===`${base.backendType}*`)paths.set(valueKey(op.result),base);
    }
    if(op.action==='address'){
      const path=addressPath(op,functionName);if(path)paths.set(valueKey(op.result),path);
    }
  }
  function resolve(op,functionName,candidates,preferred){
    if(op.action!=='load')return null;
    // va_arg's cursor load and payload load share one debug location. Follow
    // the payload address back through ABI alignment to the cursor load.
    const vaCandidates=candidates.filter(n=>n.kind==='VAArgExpr');
    const origins=new Set(),pending=vaCandidates.length?[op.pointer.value]:[],seen=new Set();
    while(pending.length){const value=pending.pop();if(seen.has(value))continue;seen.add(value);
      const producer=producers.get(key(functionName,value));if(!producer)continue;
      if(producer.action==='load'){const base=paths.get(key(functionName,producer.pointer.value));if(base)origins.add(base);
        const node=byNode.get(producer.semanticNodeId);if(node)origins.add(access(node));}
      else if(['address','convert','calculate'].includes(producer.action))pending.push(...producer.inputs.map(i=>i.value));
    }
    const variadic=vaCandidates.filter(n=>[...origins].some(o=>equal(o,access(n.children[0]))));
    if(variadic.length===1){const node=variadic[0],type=typeOf(node),layout=type?.kind==='pointer'?op.type.endsWith('*'):
      type?.encoding==='DW_ATE_float'?op.type===(type.sizeBits===32?'float':'double'):op.type===`i${type?.sizeBits}`;
      if(layout)return {node,candidates:variadic,cType:type,rootNodeId:node.id};}
    const pointer=paths.get(key(functionName,op.pointer.value));if(!pointer||pointer.backendType!==op.type)return null;
    const matches=candidates.filter(n=>{
      const target=n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>')?n.children[0]:
        update(n)||n.kind==='CompoundAssignOperator'?n.children[0]:null;
      return target&&equal(access(target),pointer);
    });
    // Candidates are ordered by AST depth. Prefer the actual scalar load over
    // a containing update; ambiguous locations still require storage identity.
    const node=matches.includes(preferred)?preferred:matches[0];
    return node?{node,candidates:matches,cType:pointer.cType,rootNodeId:pointer.rootNodeId}:null;
  }
  return {record,resolve,resolveAddress};
}
