// Source aggregate identity is recovered from compiler types and LLVM address
// producers. This does not parse or evaluate the user's C text.
export function aggregateSources(types,nodes){
  const byAST=new Map(nodes.map(n=>[n.astId,n])),cache=new WeakMap(),initializers=new WeakMap();
  const declaredName=n=>/\s([^\s']+)\s+'/.exec(n?.details??'')?.[1]??null;
  function field(id,record){
    const declaration=byAST.get(id);if(declaration?.kind!=='FieldDecl'||record?.kind!=='record')return null;
    const name=declaredName(declaration),fields=declaration.parent.children.filter(n=>n.kind==='FieldDecl'),index=fields.indexOf(declaration),
      candidates=record.members.filter(m=>m.name===name),member=candidates.length===1?candidates[0]:record.members[index];
    if(!member||member.name!==name)return null;
    const cType=types.debug(member.typeId);if(!cType)return null;
    return {kind:'member',name,index:record.members.indexOf(member),fieldNodeId:declaration.id,
      offsetBits:member.offsetBits,sizeBits:member.sizeBits,typeId:member.typeId,cType,
      ...(member.bitField?{bitField:true,storageOffsetBits:member.storageOffsetBits}:{})};
  }
  const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr'].includes(n.kind)&&n.children.length===1)n=n.children[0];return n;};
  function access(n){
    n=unwrap(n);if(!n)return null;if(cache.has(n))return cache.get(n);
    let result=null;
    if(n.kind==='DeclRefExpr'){
      const id=/\b(?:Var|ParmVar) (0x[0-9a-f]+)/.exec(n.details)?.[1];
      if(id)result={rootNodeId:byAST.get(id)?.id??null,path:[],cType:types.spelling(n.type,n.canonical)};
    }else if(n.kind==='MemberExpr'){
      const base=access(n.children[0]),raw=types.spelling(n.children[0]?.type,n.children[0]?.canonical),
        record=n.memberAccess==='->'?raw?.pointee:raw,part=field(n.fieldASTId,record);
      if(part)result={rootNodeId:base?.rootNodeId??null,path:[...(base?.path??[]),part],cType:types.spelling(n.type,n.canonical)};
    }else if(n.kind==='ArraySubscriptExpr'){
      const base=access(n.children[0]),index=unwrap(n.children[1]);
      if(base)result={...base,path:[...base.path,{kind:'index',index:index?.kind==='IntegerLiteral'?/ (\d+)\s*$/.exec(index.details)?.[1]??null:null,
        nodeId:index?.id??null}],cType:types.spelling(n.type,n.canonical)};
    }else if(n.kind==='UnaryOperator'&&/prefix '[*&]'/.test(n.details))result=access(n.children[0]);
    cache.set(n,result);return result;
  }
  function initialization(n){
    if(!n)return null;if(initializers.has(n))return initializers.get(n);
    const root=n.kind==='VarDecl'?n.children.at(-1):n,selections=[];
    function visit(at,path,offsetBits,depth=0){
      if(!at||depth>128)return;
      if(at.kind!=='InitListExpr'){if(at.kind==='CompoundLiteralExpr'||at.kind==='ParenExpr')visit(at.children.at(-1),path,offsetBits,depth+1);return;}
      const type=types.spelling(at.type,at.canonical);
      if(type?.recordKind==='union'){
        const part=field(at.selectedFieldASTId,type);if(!part)return;
        const next=[...path,part];selections.push({nodeId:at.id,fieldNodeId:part.fieldNodeId,memberName:part.name,
          memberPath:next.filter(p=>p.kind==='member').map(p=>p.name),targetPath:next,offsetBits:offsetBits+part.offsetBits,
          sizeBits:part.sizeBits,typeId:part.typeId,source:at.source,evidence:'compiler InitListExpr selected FieldDecl'});
        visit(at.children[0],next,offsetBits+part.offsetBits,depth+1);
      }else if(type?.recordKind==='struct'){
        for(const [index,child]of at.children.entries()){
          const m=type.members[index];if(!m)continue;
          const part={kind:'member',name:m.name,index,typeId:m.typeId,offsetBits:m.offsetBits,sizeBits:m.sizeBits};
          visit(child,[...path,part],offsetBits+m.offsetBits,depth+1);
        }
      }else if(type?.kind==='array'){
        // Walk only compiler AST initializer entries, never materialize the
        // declared capacity or infer a member by reading storage bytes.
        for(const [index,child]of at.children.entries())visit(child,[...path,{kind:'index',index:String(index)}],
          offsetBits+index*(type.elementType?.sizeBits??0),depth+1);
      }
    }
    visit(root,[],0);
    const result=selections.length?{nodeId:root.id,kind:'aggregate',unionSelections:selections,evidence:'compiler aggregate initializer'}:null;
    initializers.set(n,result);return result;
  }
  return {field,access,initialization};
}

export function aggregateBindings(observations,{types,nearest,abi,nodes,source=aggregateSources(types,nodes)}){
  const paths=new Map(),accesses=new Map(),argumentsByCall=new Map(),returns=new Map(),returnWrites=new Map(),memoryCalls=new Map();
  const key=(op,value)=>`${op.functionId}:${value}`;
  const byNodeId=new Map(nodes.map(n=>[n.id,n]));
  for(const op of observations.instructions){
    const intrinsic=op.action==='call'&&/^@llvm\.(memcpy|memmove|memset)\./.exec(op.callee);
    if(!intrinsic)continue;
    // A record assignment/return can share its debug location with the call
    // that produced its value. Only a matching source memory call exposes a
    // call boundary; a compiler-inserted copy still exposes its memory effect.
    const matches=n=>{
      if(n?.kind!=='CallExpr')return false;
      let target=n.children[0];while(target?.children.length===1)target=target.children[0];
      const name=/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target?.details??'')?.[1];
      return name?.replace(/^__builtin_/,'')===intrinsic[1];
    };
    const resolved=byNodeId.get(op.semanticNodeId);
    memoryCalls.set(op.id,matches(resolved)?resolved:nearest(op,matches)??null);
  }
  // Anonymous C objects have no dbg.declare variable. Bind their actual
  // allocation through address-producing SSA uses at CompoundLiteralExpr
  // locations; LLVM temporary names and user identifiers are not classifiers.
  const origins=new Map(),temporaryCandidates=new Map(),temporaries=new Map(),temporaryGaps=[];
  for(const op of observations.instructions){
    if(op.action==='object.begin'&&op.result)origins.set(key(op,op.result),op);
    if(op.action==='address'||op.action==='convert'&&op.opcode==='bitcast'){
      const root=origins.get(key(op,op.pointer?.value??op.inputs[0]?.value));
      if(root)origins.set(key(op,op.result),root);
    }
    if(op.action==='call'){
      const pointer=op.args.find(a=>a.sret),allocation=pointer&&origins.get(key(op,pointer.value)),
        call=byNodeId.get(op.semanticNodeId),cType=call?.kind==='CallExpr'?types.spelling(call.type,call.canonical):null;
      if(allocation&&!allocation.local&&!allocation.cType&&cType?.kind==='record'&&abi.layout(allocation.type).size*8===cType.sizeBits){
        if(!temporaryCandidates.has(allocation.id))temporaryCandidates.set(allocation.id,{allocation,nodes:new Map()});
        temporaryCandidates.get(allocation.id).nodes.set(call.id,{node:call,cType,role:'abi-return-storage',visibility:'implementation'});
      }
    }
    const node=nearest(op,n=>n.kind==='CompoundLiteralExpr');if(!node)continue;
    const cType=types.spelling(node.type,node.canonical);if(!(cType?.sizeBits>0))continue;
    const pointers=op.action==='address'||['load','store'].includes(op.action)?[op.pointer]:
      op.action==='convert'&&op.opcode==='bitcast'?op.inputs:op.action==='call'?op.args:[];
    for(const pointer of pointers??[]){
      const allocation=origins.get(key(op,pointer?.value));
      if(!allocation||allocation.local||allocation.cType||abi.layout(allocation.type).size*8!==cType.sizeBits)continue;
      if(!temporaryCandidates.has(allocation.id))temporaryCandidates.set(allocation.id,{allocation,nodes:new Map()});
      temporaryCandidates.get(allocation.id).nodes.set(node.id,{node,cType});
    }
  }
  const candidateOwners=new Map();
  for(const candidate of temporaryCandidates.values())for(const id of candidate.nodes.keys()){
    if(!candidateOwners.has(id))candidateOwners.set(id,new Set());candidateOwners.get(id).add(candidate.allocation.id);
  }
  for(const {allocation,nodes:candidates}of temporaryCandidates.values()){
    const candidate=candidates.size===1?[...candidates.values()][0]:null;
    if(!candidate||candidateOwners.get(candidate.node.id).size!==1){temporaryGaps.push({observationId:allocation.id,reason:'ambiguous source temporary allocation'});continue;}
    const evidence=candidate.role==='abi-return-storage'?'compiler sret argument and exact CallExpr return type':
      'compiler CompoundLiteralExpr location and observed allocation address uses';
    allocation.cType=candidate.cType;
    allocation.sourceTemporary={sourceNodeId:candidate.node.id,source:candidate.node.source,evidence};
    temporaries.set(allocation.id,{...candidate,evidence});
  }
  const functionNames=new Map(observations.functions.map(f=>[f.id,f.name])),returnTypes=new Map();
  for(const n of nodes.filter(n=>n.kind==='ReturnStmt'&&n.children[0])){
    const value=n.children[0],type=types.spelling(value.type,value.canonical);if(type?.kind==='record')returnTypes.set(n.functionName,type);
  }
  const sret=new Map(observations.instructions.filter(o=>o.action==='function.argument'&&o.parameter.sret).map(o=>[o.functionId,o]));
  for(const op of observations.instructions){
    if(op.action==='object.begin'&&op.result&&op.cType)paths.set(key(op,op.result),{root:op.result,cType:op.cType,backendType:op.type,path:[],
      initializer:temporaries.get(op.id)?.node.kind==='CompoundLiteralExpr'?temporaries.get(op.id).node.children.at(-1):undefined});
    if(op.action==='function.argument'){
      const p=op.parameter,cType=p.sret?returnTypes.get(functionNames.get(op.functionId)):p.byval?op.cType:op.cType?.pointee;
      if(cType||p.sret)paths.set(key(op,p.value),{root:p.value,cType,backendType:p.type.slice(0,-1),path:[]});
    }
    if(op.action==='convert'&&op.opcode==='bitcast'){
      const base=paths.get(key(op,op.inputs[0]?.value));
      if(base){
        let next=base;
        if(base.cType?.recordKind==='union'){
          const member=nearest(op,n=>n.kind==='MemberExpr'&&source.field(n.fieldASTId,base.cType)),
            init=nearest(op,n=>n.kind==='InitListExpr'&&types.spelling(n.type,n.canonical)?.recordTypeId===base.cType.recordTypeId),
            part=source.field(member?.fieldASTId??base.initializer?.selectedFieldASTId??init?.selectedFieldASTId,base.cType),
            backendType=op.type.slice(0,-1);
          if(part&&abi.layout(backendType).size*8===part.sizeBits)next={...base,cType:part.cType,backendType,path:[...base.path,part]};
        }
        paths.set(key(op,op.result),next);
      }
    }
    if(op.action==='address'){
      const base=paths.get(key(op,op.pointer.value));let type=base?.cType,backend=op.baseType,path=[...(base?.path??[])],valid=!!base&&base.backendType===op.baseType;
      const indices=op.inputs.slice(1);
      for(const [i,index]of indices.entries()){
        if(i===0){if(index.value!=='0'){
          const last=path.at(-1);
          if(last?.kind==='index')path[path.length-1]={...last,index:/^-?\d+$/.test(last.index??'')&&/^-?\d+$/.test(index.value)?String(BigInt(last.index)+BigInt(index.value)):null};
          else path.push({kind:'index',index:index.value});
        }continue;}
        if(type?.kind==='record'&&type.recordKind==='struct'){
          const position=Number(index.value),field=Number.isInteger(position)&&abi.layout(backend).fields?.[position],member=type.members[position];
          // LLVM field numbering is not C member numbering for packed
          // bit-fields. Only attach a member after confirming its layout.
          if(!field||!member||member.offsetBits!==field.offset*8||member.sizeBits!==abi.layout(field.type).size*8){valid=false;break;}
          const declaration=types.recordDeclaration(type)?.children.filter(n=>n.kind==='FieldDecl')[position];
          path.push({kind:'member',name:member.name,index:position,offsetBits:member.offsetBits,typeId:member.typeId,
            ...(declaration?{fieldNodeId:declaration.id}:{})});
          type=types.debug(member.typeId);backend=field.type;
        }else if(type?.kind==='array'){
          path.push({kind:'index',index:index.value});type=type.elementType;backend=abi.layout(backend).elementType;
        }else {valid=false;break;}
      }
      if(valid)paths.set(key(op,op.result),{...base,cType:type,backendType:backend,path});
    }
    if(op.opcode==='phi'&&op.type?.endsWith('*')){
      const incoming=(op.inputs??[]).map(v=>paths.get(key(op,v.value))).filter(Boolean),base=incoming[0];
      if(base?.path.at(-1)?.kind==='index'&&incoming.every(p=>p.root===base.root&&p.backendType===base.backendType&&
        JSON.stringify(p.path.slice(0,-1))===JSON.stringify(base.path.slice(0,-1))))
        paths.set(key(op,op.result),{...base,path:[...base.path.slice(0,-1),{kind:'index',index:null,runtime:true}]});
    }
    if(['load','store'].includes(op.action)){
      const pointer=paths.get(key(op,op.pointer.value));
      if(pointer&&(pointer.path.length||pointer.initializer)&&pointer.backendType===op.type){
        let initializer=pointer.initializer??nearest(op,n=>n.kind==='VarDecl')?.children[0];
        for(const part of pointer.path){
          if(initializer?.kind!=='InitListExpr'){initializer=null;break;}
          const union=types.spelling(initializer.type,initializer.canonical)?.recordKind==='union';
          const index=union?(source.field(initializer.selectedFieldASTId,types.spelling(initializer.type,initializer.canonical))?.name===part.name?0:null):
            part.kind==='member'?part.index:/^\d+$/.test(part.index??'')?Number(part.index):null;
          initializer=index===null?null:initializer.children[index];
        }
        accesses.set(op.id,{cType:pointer.cType,memberPath:pointer.path.filter(p=>p.kind==='member').map(p=>p.name),
          targetPath:pointer.path,initializer:op.action==='store'&&initializer?.source?initializer:null});
        op.cType??=pointer.cType;
      }
      if(op.action==='load'&&op.type.endsWith('*')&&op.cType?.pointee)paths.set(key(op,op.result),{
        root:op.result,cType:op.cType.pointee,backendType:op.type.slice(0,-1),path:[]});
    }
    if(op.action==='call'){
      const args=op.args.flatMap((arg,abiParameterIndex)=>{
        const pointer=paths.get(key(op,arg.value));if(!pointer?.path.some(p=>p.kind==='member'))return [];
        return [{abiParameterIndex,cType:pointer.cType,memberPath:pointer.path.filter(p=>p.kind==='member').map(p=>p.name),targetPath:pointer.path}];
      });
      if(args.length)argumentsByCall.set(op.id,args);
    }
    const hidden=sret.get(op.functionId);
    if(hidden){
      const destination=op.action==='store'?op.pointer:op.action==='call'?op.args.find(a=>a.sret)??
        (/^@llvm\.mem(?:cpy|move|set)\./.test(op.callee)?op.args[0]:null):null;
      if(destination&&paths.get(key(op,destination.value))?.root===hidden.parameter.value){
        const node=nearest(op,n=>n.kind==='ReturnStmt');if(node){
          if(!returnWrites.has(op.functionId))returnWrites.set(op.functionId,[]);
          returnWrites.get(op.functionId).push({store:op,node});
        }
      }
      if(op.action==='function.return'){
        const node=nearest(op,n=>n.kind==='ReturnStmt'),expression=node?.children[0];
        // In a shared epilogue the actual return site is selected by the
        // observed sret writes/call completion, not by a guessed source line.
        const cType=expression?types.spelling(expression.type,expression.canonical):returnTypes.get(functionNames.get(op.functionId))??null;
        returns.set(op.id,{pointer:hidden.parameter.value,backendType:hidden.parameter.type.slice(0,-1),cType});
      }
    }
  }
  for(const [id,info]of returns){
    const op=observations.instructions.find(o=>o.id===id);
    info.sites=returnWrites.get(op.functionId)??[];
    info.cType??=info.sites.map(s=>s.node.children[0]).map(n=>n&&types.spelling(n.type,n.canonical)).find(Boolean)??null;
    op.aggregateReturn={pointer:info.pointer,type:info.backendType,cType:info.cType};
  }
  return {accesses,returns,argumentsByCall,source,temporaries,temporaryGaps,memoryCalls,paths};
}
