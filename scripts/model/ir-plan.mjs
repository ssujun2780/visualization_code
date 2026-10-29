// Public IR describes source work. LLVM observation points are private bindings.
import {validateIRPlan} from './ir-schema.mjs';
const position=(a,b)=>a.line-b.line||a.column-b.column;
const contains=(range,p)=>!!range&&!!p&&range.file===p.file&&position(range.start,p)<=0&&position(p,range.end)<=0;
const operator=n=>n?.kind==='UnaryOperator'?/\b(?:prefix|postfix) '([^']+)'/.exec(n.details)?.[1]??null:
  ['BinaryOperator','CompoundAssignOperator'].includes(n?.kind)?/ '([+*/%&|^<>=!,?:~-]+)'(?:\s|$)/.exec(n.details)?.[1]??null:null;
const name=n=>/\s([^\s']+)\s+'/.exec(n?.details??'')?.[1]??null;
const expressionKinds=new Set(['BinaryOperator','UnaryOperator','ImplicitCastExpr','CStyleCastExpr','ParenExpr','ConditionalOperator','BinaryConditionalOperator']);
const leafKinds=new Set(['DeclRefExpr','IntegerLiteral','FloatingLiteral','CharacterLiteral','StringLiteral','GNUNullExpr','MemberExpr','ArraySubscriptExpr']);
const mutation=n=>n.kind==='CompoundAssignOperator'||n.kind==='BinaryOperator'&&operator(n)==='='||n.kind==='UnaryOperator'&&['++','--'].includes(operator(n));
const groupable=new WeakMap();
function canGroup(node){
  if(!node)return false;
  const stack=[{node,children:false}];
  while(stack.length){const entry=stack.at(-1),n=entry.node;
    if(groupable.has(n)){stack.pop();continue;}
    if(!(leafKinds.has(n.kind)||expressionKinds.has(n.kind))||mutation(n)||['&&','||',','].includes(operator(n))||
      ['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)){groupable.set(n,false);stack.pop();continue;}
    if(entry.children){groupable.set(n,n.children.every(child=>groupable.get(child)));stack.pop();}
    else{entry.children=true;for(const child of n.children)if(!groupable.has(child))stack.push({node:child,children:false});}
  }
  return groupable.get(node);
}
const mutationExpression=n=>mutation(n)?{node:n,kind:'update'}:null;
const memoryAccess=n=>n&&(['MemberExpr','ArraySubscriptExpr'].includes(n.kind)||n.kind==='UnaryOperator'&&operator(n)==='*');

function sourceReader(source,filename) {
  const bytes=Buffer.from(source,'utf8'),lines=[0];for(let i=0;i<bytes.length;i++)if(bytes[i]===10)lines.push(i+1);
  return raw=>{
    if(!raw||raw.file!=='/main.c'||!lines[raw.start.line-1]&&raw.start.line!==1)return null;
    const start=lines[raw.start.line-1]+raw.start.column-1,last=lines[raw.end.line-1]+raw.end.column-1;
    if(!Number.isInteger(start)||!Number.isInteger(last)||start<0||last<start||last>=bytes.length)return null;
    const token=/^(?:(?:u8|u|U|L)?(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|[\p{ID_Start}_][\p{ID_Continue}_]*|\d[\w.]*|\+\+|--|&&|\|\||<<|>>|<=|>=|==|!=|.)/us.exec(bytes.subarray(last).toString('utf8'))?.[0];
    if(!token)return null;const end=last+Buffer.byteLength(token);
    return {file:filename,line:raw.start.line,column:raw.start.column,start:{line:raw.start.line,column:raw.start.column,byte:start},
      end:{line:raw.end.line,column:raw.end.column+end-last,byte:end},expression:bytes.subarray(start,end).toString('utf8')};
  };
}

export function buildIRPlan(observations,{nodes,types},source,filename) {
  const readSource=sourceReader(source,filename),localNodes=nodes.filter(n=>n.source?.file==='/main.c'),
    byAST=new Map(nodes.map(n=>[n.astId,n])),declarationByAST=new Map(),scopeByAST=new Map();
  const plan={schemaVersion:3,programId:observations.programId,source:observations.source,backend:observations.backend,
    instructions:[],functions:[],declarations:[],scopes:[],types:observations.types,llvmTypes:observations.llvmTypes,
    bindings:{},coverage:{...observations.coverage,ir:'source work with explicit LLVM observation bindings',
      unboundSourceWork:[],unmappedObservations:[],lifetime:observations.coverage.lifetime}};
  for(const n of localNodes.filter(n=>['FunctionDecl','CompoundStmt','ForStmt'].includes(n.kind))){
    let parent=n.parent;while(parent&&!scopeByAST.has(parent.astId))parent=parent.parent;
    const scope={id:`s${plan.scopes.length+1}`,parentId:parent?scopeByAST.get(parent.astId):null,kind:n.kind,
      functionName:n.functionName??null,source:readSource(n.source)};plan.scopes.push(scope);scopeByAST.set(n.astId,scope.id);
  }
  const scopeFor=n=>{for(let at=n;at;at=at.parent)if(scopeByAST.has(at.astId))return scopeByAST.get(at.astId);return null;};
  for(const n of localNodes.filter(n=>['VarDecl','ParmVarDecl'].includes(n.kind))){
    const declaration={id:`d${plan.declarations.length+1}`,name:name(n),kind:n.kind,functionName:n.functionName??null,
      scopeId:scopeFor(n.parent),source:readSource(n.source),point:n.declarationPoint&&{...n.declarationPoint,file:filename},
      type:n.type,cType:types.spelling(n.type,n.canonical),storage:/\bstatic\b/.test(n.details)?'static':n.functionName?'automatic':'static',
      hasInitializer:n.kind==='VarDecl'&&n.children.length>0};
    plan.declarations.push(declaration);declarationByAST.set(n.astId,declaration.id);
  }
  const treeCache=new Map();
  function tree(n,depth=0){
    if(!n)return null;if(depth>128)return {kind:n.kind,evidence:'expression-depth-limit'};
    if(treeCache.has(n.id))return treeCache.get(n.id);
    const referenced=/\b(?:Var|ParmVar|Function) (0x[0-9a-f]+)/.exec(n.details)?.[1];
    const literal=['IntegerLiteral','FloatingLiteral','CharacterLiteral'].includes(n.kind)?/ ([^\s]+)\s*$/.exec(n.details)?.[1]:undefined;
    const range=readSource(n.source),location=range&&(({expression,...location})=>location)(range),aggregate=n.kind==='InitListExpr';
    const result={nodeId:n.id,kind:n.kind,operator:operator(n),type:n.type,cType:types.spelling(n.type,n.canonical),
      ...(n.kind==='UnaryOperator'?{position:/\bpostfix\b/.test(n.details)?'postfix':'prefix'}:{}),
      ...(referenced?{declarationId:declarationByAST.get(referenced)??null,referencedName:name(byAST.get(referenced))}:{}),
      ...(literal!==undefined?{literal}:{}),...(n.kind==='StringLiteral'?{literal:range?.expression.slice(0,256),literalTruncated:(range?.expression.length??0)>256}:{}),
      ...(n.kind==='ImplicitCastExpr'||n.kind==='CStyleCastExpr'?{cast:/<([^<>]+)>\s*$/.exec(n.details)?.[1]??null}:{}),
      source:location,...(aggregate?{elementCount:n.children.length,childrenOmitted:true}:{}),children:aggregate?[]:n.children.map(c=>tree(c,depth+1))};
    treeCache.set(n.id,result);return result;
  }
  const functionNode=fn=>localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===fn&&n.children.some(c=>c.kind==='CompoundStmt'));
  const parametersFor=fn=>(functionNode(fn)?.children??[]).filter(n=>n.kind==='ParmVarDecl').map(n=>declarationByAST.get(n.astId)).filter(Boolean);
  const sourceIndex=new Map();for(const n of localNodes){const key=n.functionName??'';let list=sourceIndex.get(key);if(!list)sourceIndex.set(key,list=[]);list.push(n);}
  const points=new Map();
  const nearest=(op,predicate=()=>true)=>{
    if(!op.source)return null;const p={...op.source,file:op.source.file===filename?'/main.c':op.source.file},fn=observations.functions.find(f=>f.id===op.functionId)?.name;
    const key=`${fn}:${p.file}:${p.line}:${p.column}`;
    if(!points.has(key))points.set(key,(sourceIndex.get(fn)??[]).filter(n=>contains(n.source,p)).sort((a,b)=>b.depth-a.depth));
    return points.get(key).find(predicate)??null;
  };
  const declarationsFor=op=>{
    const fn=observations.functions.find(f=>f.id===op.functionId)?.name,local=op.local??op.global;
    if(!local)return null;const candidates=plan.declarations.filter(d=>d.name===local.name&&(!fn||d.functionName===fn||d.storage==='static'));
    const line=local.source?.line??op.source?.line;
    const exact=candidates.filter(d=>d.point?.line===line||d.source?.line===line);
    return exact.length===1?exact[0]:candidates.length===1?candidates[0]:null;
  };
  const registry=new Map(),boundNodes=new Set();
  const backEdges=new Set();
  for(const fn of observations.functions){
    const blocks=new Map();
    for(const op of observations.instructions.filter(o=>o.functionId===fn.id&&o.block)){
      if(!blocks.has(op.block))blocks.set(op.block,[]);
      if(op.action==='branch'||op.action==='switch')blocks.set(op.block,op.destinations);
    }
    const visited=new Map();
    for(const root of blocks.keys()){
      if(visited.has(root))continue;const stack=[{block:root,index:0}];visited.set(root,1);
      while(stack.length){const top=stack.at(-1),next=(blocks.get(top.block)??[])[top.index++];
        if(next===undefined){visited.set(top.block,2);stack.pop();}
        else if(visited.get(next)===1)backEdges.add(`${fn.id}:${top.block}:${next}`);
        else if(!visited.has(next)){visited.set(next,1);stack.push({block:next,index:0});}
      }
    }
  }
  function add(key,kind,action,op,node,fields={}){
    if(registry.has(key))return registry.get(key);
    if(node)boundNodes.add(node.id);
    const instruction={id:`i${plan.instructions.length+1}`,kind,action,functionId:op?.functionId??null,
      sourceNodeId:node?.id??null,source:readSource(node?.source)??op?.source??null,scopeId:node?scopeFor(node):null,...fields};
    plan.instructions.push(instruction);registry.set(key,instruction);return instruction;
  }
  const expressionRoots=new WeakMap();
  function expressionOwner(op){
    let n=nearest(op,n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator');if(!n)return null;
    const update=mutationExpression(n);if(update)return update;
    if(!canGroup(n))return {node:n,kind:'single'};
    const path=[];
    while(canGroup(n.parent)&&!memoryAccess(n.parent)){
      if(expressionRoots.has(n)){n=expressionRoots.get(n);break;}path.push(n);n=n.parent;
    }
    for(const child of path)expressionRoots.set(child,n);
    return {node:n,kind:'expression'};
  }
  const defaultRole=op=>op.action==='load'?'read':op.action==='store'?'write':op.kind==='CALC'?'calculate':op.action;
  for(const op of observations.instructions){
    const binding={roles:{},administrative:false},node=nearest(op),declaration=declarationsFor(op),role=defaultRole(op);
    const put=(selector,kind,action,owner=node,fields={})=>{
      const key=`${op.functionId??'program'}:${kind}:${action}:${owner?.id??op.id}`;
      const instruction=add(key,kind,action,op,owner,fields);binding.roles[selector]=instruction.id;return instruction;
    };
    if(op.action==='globals.ready'){binding.administrative=true;plan.bindings[op.id]=binding;continue;}
    if(op.action==='function.enter'){
      const fn=observations.functions.find(f=>f.id===op.functionId),owner=localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===fn?.name&&n.children.some(c=>c.kind==='CompoundStmt'));
      put('SPACE:frame.begin','SPACE','frame.begin',owner,{functionName:op.functionName,parameters:parametersFor(op.functionName)});
      put('FLOW:enter','FLOW','enter',owner,{functionName:op.functionName});
    }else if(op.action==='function.argument'){
      const fn=observations.functions.find(f=>f.id===op.functionId),sourceIndex=op.local?.sourceParameterIndex??null,
        parameter=sourceIndex===null?null:plan.declarations.find(d=>d.id===parametersFor(fn?.name)[sourceIndex]);
      binding.hiddenParameter=!!op.parameter.sret;
      if(binding.hiddenParameter){binding.administrative=true;plan.bindings[op.id]=binding;continue;}
      put('WRITE:argument','WRITE','argument',null,{parameterIndex:sourceIndex,abiParameterIndex:op.parameter.index,declarationId:parameter?.id??null,cType:op.cType,source:parameter?.source??null});
      put('SPACE:object.begin','SPACE','object.begin',null,{declarationId:parameter?.id??null,storage:'automatic',source:parameter?.source??null});
    }else if(op.action==='object.begin'||op.action==='global.begin'){
      put('SPACE:object.begin','SPACE','object.begin',declaration?byAST.get([...declarationByAST].find(([,id])=>id===declaration.id)?.[0]):null,
        {declarationId:declaration?.id??null,storage:op.action==='global.begin'?'static':'automatic',cType:op.cType??op.global?.cType??null,
          visibility:declaration?'source':'implementation',scopeId:declaration?.scopeId??null,source:declaration?.source??op.source??null});
    }else if(op.action==='function.return'){
      const owner=nearest(op,n=>n.kind==='ReturnStmt');
      if(op.type!=='void')put('WRITE:return.value','WRITE','return.value',owner,{returnType:op.cType??op.type});
      put('FLOW:return','FLOW','return',owner);
      put('SPACE:object.end','SPACE','object.end',owner,{reason:'function-return'});
      put('SPACE:frame.end','SPACE','frame.end',owner);
    }else if(op.action==='call'){
      const callee=op.callee.slice(1).replace(/^"|"$/g,'');
      const callNode=nearest(op,n=>n.kind==='CallExpr'),owner=callNode??nearest(op,n=>n.kind==='VarDecl'||mutation(n));
      binding.suppressCallBoundary=!callNode&&/^(?:llvm\.)?mem(?:cpy|move|set)/.test(callee);
      if(!binding.suppressCallBoundary){
        const call=put('FLOW:call.begin','FLOW','call',owner,{callee:op.callee,external:op.external,arguments:callNode?.children.slice(1).map(n=>tree(n))??[]});
        binding.callInstructionId=call.id;put('FLOW:call.end','FLOW','resume',owner,{callee:op.callee,external:op.external});
      }
      if(/^(?:llvm\.)?mem(?:cpy|move)/.test(callee)||['strcpy','strncpy','strcat'].includes(callee))put('WRITE:copy','WRITE','copy',owner,{callee:op.callee,evidence:'library API effect'});
      if(/^(?:llvm\.)?memset/.test(callee))put('WRITE:fill','WRITE','fill',owner,{callee:op.callee,evidence:'library API effect'});
      if(['scanf','__isoc99_scanf','sscanf','fscanf','fgets'].includes(callee))put('WRITE:input','WRITE','input',owner,{callee:op.callee,evidence:'library API effect'});
      if(['malloc','calloc','realloc'].includes(callee))put('SPACE:object.begin','SPACE','object.begin',owner,{storage:'heap',callee:op.callee});
      if(['free','realloc'].includes(callee))put('SPACE:object.end','SPACE','object.end',owner,{callee:op.callee});
    }else if(op.kind==='CALC'){
      const owner=expressionOwner(op);
      const point=op.source&&{...op.source,file:op.source.file===filename?'/main.c':op.source.file};
      const pointerOperation=nearest(op,n=>(n.kind==='BinaryOperator'&&['+','-'].includes(operator(n))&&/\*/.test(n.canonical??n.type??'')||n.kind==='UnaryOperator'&&operator(n)==='&')&&
        !n.children.some(c=>contains(c.source,point)));
      if(op.action==='address'&&!pointerOperation||
        ['bitcast','addrspacecast','ptrtoint','inttoptr'].includes(op.opcode)&&!nearest(op,n=>n.kind==='CStyleCastExpr')||
        op.action==='merge'&&!nearest(op,n=>['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)||['&&','||'].includes(operator(n)))){
        binding.administrative=true;
      }else{
        const grouped=owner?.kind==='expression'||owner?.kind==='update'&&owner.node.children.every(canGroup);
        const instruction=put('CALC','CALC',grouped?'expression':op.action,owner?.node??node,
          {expression:owner?tree(owner.node):null,cType:owner?types.spelling(owner.node.type,owner.node.canonical)??op.cType??null:op.cType??null,operator:owner?operator(owner.node):op.opcode,
            grouping:owner?.kind??'unmapped-observation',observationIds:[]});
        instruction.observationIds.push(op.id);binding.group=grouped?instruction.id:null;
        const expressionNode=nearest(op,n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator');
        binding.expressionNodeId=expressionNode?.id??null;binding.sourceOperator=operator(expressionNode);
        if(!owner)plan.coverage.unmappedObservations.push({observationId:op.id,reason:'no reliable source expression',source:op.source});
      }
    }else if(op.action==='load'||op.action==='store'){
      const owner=op.action==='store'?nearest(op,n=>n.kind==='VarDecl'||mutation(n)):nearest(op,n=>n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>'))??node;
      put(op.kind,op.kind,role,owner,{cType:op.cType??null,accessType:op.type,expression:owner?tree(owner):null});
    }else if(op.action==='branch'||op.action==='switch'){
      const owner=nearest(op,n=>['IfStmt','WhileStmt','ForStmt','DoStmt','SwitchStmt','BreakStmt','ContinueStmt','GotoStmt'].includes(n.kind));
      const jump={BreakStmt:'break',ContinueStmt:'continue',GotoStmt:'goto'}[owner?.kind],
        loopBack=['WhileStmt','ForStmt','DoStmt'].includes(owner?.kind)&&op.destinations.some(target=>backEdges.has(`${op.functionId}:${op.block}:${target}`));
      if(op.action==='branch'&&!op.inputs.length&&!jump&&!loopBack)binding.administrative=true;
      else put('FLOW','FLOW',jump??(!op.inputs.length&&loopBack?'loop.next':op.action),owner??node,{destinations:op.destinations,cases:op.cases??null,controlKind:owner?.kind??null});
    }else if(op.action==='short-circuit')put('FLOW:short-circuit','FLOW','short-circuit',null,{source:op.source,decision:op.shortCircuit});
    else put(op.kind,op.kind,op.action,node);
    binding.failedInstructionId=binding.roles[op.kind]??binding.roles.CALC??Object.values(binding.roles)[0]??null;
    plan.bindings[op.id]=binding;
  }
  // An ABI parameter spill is the storage effect of argument delivery, not a
  // second source assignment. Record the binding before runtime normalization.
  for(const argument of observations.instructions.filter(o=>o.action==='function.argument')){
    const spill=observations.instructions.find(o=>o.functionId===argument.functionId&&o.action==='store'&&o.inputs[0]?.value===argument.parameter.value);
    const b=plan.bindings[argument.id];if(!b)continue;
    if(b.hiddenParameter){if(spill)plan.bindings[spill.id].administrative=true;continue;}
    if(spill){b.parameterStoreObservationId=spill.id;plan.bindings[spill.id].parameterArgumentObservationId=argument.id;}
    if(argument.parameter.byval)b.byValueArgument=true;
  }
  for(const decision of observations.instructions.filter(o=>o.action==='short-circuit')){
    const id=plan.bindings[decision.id].roles['FLOW:short-circuit'],consumer=plan.bindings[decision.anchorInstructionId];
    const instruction=plan.instructions.find(i=>i.id===id);if(instruction)instruction.consumerInstructionId=consumer?.failedInstructionId??null;
  }
  // Process-level effects have their own instructions, not a borrowed return ID.
  for(const [kind,action]of [['WRITE','output'],['READ','input'],['SPACE','object.end'],['SPACE','frame.end'],['ERROR','fault']])
    add(`process:${kind}:${action}`,kind,action,null,null,{processEffect:true});
  plan.processInstructions=Object.fromEntries(plan.instructions.filter(i=>i.processEffect).map(i=>[`${i.kind}:${i.action}`,i.id]));
  plan.functions=observations.functions.map(f=>({...f,parameters:parametersFor(f.name),
    source:readSource(localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===f.name&&n.children.some(c=>c.kind==='CompoundStmt'))?.source)}));
  for(const n of localNodes.filter(n=>['CallExpr','ReturnStmt','VarDecl'].includes(n.kind)&&n.functionName))if(!boundNodes.has(n.id))
    plan.coverage.unboundSourceWork.push({nodeId:n.id,kind:n.kind,source:readSource(n.source),reason:'no reliable observed source-work binding'});
  // Retain source work eliminated by constant folding or an unreachable path.
  // Such definitions have no fabricated execution entry.
  for(const n of localNodes){
    const fn=observations.functions.find(f=>f.name===n.functionName),op=fn?{functionId:fn.id}:null;
    if(n.functionName&&!fn)continue;
    const declare=(kind,action,fields={})=>{
      if(['CALC','WRITE','READ'].includes(kind)){
        const existing=plan.instructions.find(i=>i.kind===kind&&i.sourceNodeId===n.id&&i.functionId===(fn?.id??null));
        if(existing)return existing;
      }
      return add(`${fn?.id??'program'}:${kind}:${action}:${n.id}`,kind,action,op,n,{bindingStatus:'source-only',...fields});
    };
    if(n.kind==='VarDecl'){
      declare('SPACE','object.begin',{declarationId:declarationByAST.get(n.astId),storage:plan.declarations.find(d=>d.id===declarationByAST.get(n.astId))?.storage});
      if(n.children.length&&n.functionName&&!/\b(static|extern)\b/.test(n.details))declare('WRITE','write',{expression:tree(n)});
    }else if(n.kind==='CallExpr'){
      declare('FLOW','call',{arguments:n.children.slice(1).map(c=>tree(c))});declare('FLOW','resume');
    }else if(n.kind==='ReturnStmt'){
      if(n.children.length)declare('WRITE','return.value');declare('FLOW','return');
    }else if(n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>'))declare('READ','read',{expression:tree(n)});
    else if(mutation(n)){
      declare('WRITE','write',{expression:tree(n)});if(operator(n)!=='=')declare('CALC','calculate',{expression:tree(n)});
    }else if(canGroup(n)&&(!canGroup(n.parent)||memoryAccess(n.parent))&&expressionKinds.has(n.kind)&&n.children.length&&
      (operator(n)||n.children.some(c=>expressionKinds.has(c.kind))))declare('CALC','expression',{expression:tree(n)});
  }
  return validateIRPlan(plan);
}
