// Public IR describes source work. LLVM observation points are private bindings.
import {validateIRPlan} from './ir-schema.mjs';
import {buildControlFlow} from './control-flow.mjs';
import {compoundTypes} from './c-semantics.mjs';
import {evaluationBindings,evaluationKind,expressionOperator} from './evaluation.mjs';
const position=(a,b)=>a.line-b.line||a.column-b.column;
const contains=(range,p)=>!!range&&!!p&&range.file===p.file&&position(range.start,p)<=0&&position(p,range.end)<=0;
const operator=n=>n?.kind==='UnaryOperator'?/\b(?:prefix|postfix) '([^']+)'/.exec(n.details)?.[1]??null:
  ['BinaryOperator','CompoundAssignOperator'].includes(n?.kind)?/ '([+*/%&|^<>=!,?:~-]+)'(?:\s|$)/.exec(n.details)?.[1]??null:null;
const name=n=>/\s([^\s']+)\s+'/.exec(n?.details??'')?.[1]??null;
const visibleOperator=n=>{while(n&&['ImplicitCastExpr','ParenExpr'].includes(n.kind)&&n.children.length===1)n=n.children[0];return operator(n);};
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

export function buildIRPlan(observations,{nodes,types,sourceMap},source,filename,abi) {
  const readSource=raw=>sourceMap.range(raw,{text:true}),localNodes=nodes.filter(n=>n.source?.file==='/main.c'),
    byAST=new Map(nodes.map(n=>[n.astId,n])),declarationByAST=new Map(),scopeByAST=new Map();
  const plan={schemaVersion:3,programId:observations.programId,source:observations.source,backend:observations.backend,
    instructions:[],functions:[],declarations:[],scopes:[],types:observations.types,llvmTypes:observations.llvmTypes,
    bindings:{},coverage:{...observations.coverage,ir:'source work with explicit LLVM observation bindings',
      unboundSourceWork:[],unmappedObservations:[],lifetime:observations.coverage.lifetime,
      automaticLifetimes:observations.coverage.automaticLifetimes}};
  for(const n of localNodes.filter(n=>['FunctionDecl','CompoundStmt','ForStmt'].includes(n.kind))){
    let parent=n.parent;while(parent&&!scopeByAST.has(parent.astId))parent=parent.parent;
    const scope={id:`s${plan.scopes.length+1}`,parentId:parent?scopeByAST.get(parent.astId):null,kind:n.kind,
      functionName:n.functionName??null,source:sourceMap.range(n.source)};plan.scopes.push(scope);scopeByAST.set(n.astId,scope.id);
  }
  const scopeFor=n=>{for(let at=n;at;at=at.parent)if(scopeByAST.has(at.astId))return scopeByAST.get(at.astId);return null;};
  for(const n of localNodes.filter(n=>['VarDecl','ParmVarDecl'].includes(n.kind))){
    const declaration={id:`d${plan.declarations.length+1}`,name:name(n),kind:n.kind,functionName:n.functionName??null,
      scopeId:scopeFor(n.parent),source:sourceMap.range(n.source),point:n.declarationPoint&&{...n.declarationPoint,file:filename},
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
    const location=sourceMap.range(n.source),aggregate=n.kind==='InitListExpr';
    const stringLiteral=n.kind==='StringLiteral'?/((?:u8|u|U|L)?"(?:\\.|[^"\\])*")\s*$/.exec(n.details)?.[1]:null;
    const result={nodeId:n.id,kind:n.kind,operator:operator(n),type:n.type,cType:types.spelling(n.type,n.canonical),
      ...(n.kind==='UnaryOperator'?{position:/\bpostfix\b/.test(n.details)?'postfix':'prefix'}:{}),
      ...(referenced?{declarationId:declarationByAST.get(referenced)??null,referencedName:name(byAST.get(referenced))}:{}),
      ...(literal!==undefined?{literal}:{}),...(n.kind==='StringLiteral'?{literal:stringLiteral?.slice(0,256),literalTruncated:(stringLiteral?.length??0)>256,literalEvidence:'compiler AST'}:{}),
      ...(n.kind==='ImplicitCastExpr'||n.kind==='CStyleCastExpr'?{cast:/<([^<>]+)>\s*$/.exec(n.details)?.[1]??null}:{}),
      source:location,...(aggregate?{elementCount:n.children.length,childrenOmitted:true}:{}),children:aggregate?[]:n.children.map(c=>tree(c,depth+1))};
    treeCache.set(n.id,result);return result;
  }
  const functionNode=fn=>localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===fn&&n.children.some(c=>c.kind==='CompoundStmt'));
  const parametersFor=fn=>(functionNode(fn)?.children??[]).filter(n=>n.kind==='ParmVarDecl').map(n=>declarationByAST.get(n.astId)).filter(Boolean);
  const functionNames=new Map(observations.functions.map(f=>[f.id,f.name]));
  const nearest=(op,predicate=()=>true)=>{
    return sourceMap.candidates(op.source,functionNames.get(op.functionId)).find(predicate)??null;
  };
  const evaluations=evaluationBindings(observations,nearest),evaluationByNode=new Map();
  plan.evaluations=localNodes.filter(n=>evaluationKind(n)).map(n=>{
    const part=child=>({nodeId:child.id,source:sourceMap.range(child.source)}),kind=evaluationKind(n);
    const literal=observations.coverage.shortCircuits?.expressions?.find(e=>e.nodeId===n.id);
    const spec={nodeId:n.id,kind,operator:kind==='logical'?expressionOperator(n):'?:',source:sourceMap.range(n.source),
      cType:types.spelling(n.type,n.canonical),...(kind==='logical'?{left:part(n.children[0]),right:part(n.children[1]),
        leftTruth:literal?.left.truth??null,helpMarker:{kind:'logical-short-circuit',status:'stub',when:'right-skipped'}}:
        {condition:part(n.children[0]),true:part(n.children[1]),false:part(n.children[2])})};
    evaluationByNode.set(n.id,spec);return spec;
  });
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
      sourceNodeId:node?.id??null,source:sourceMap.range(node?.source,{text:node&&!['FunctionDecl','CompoundStmt','IfStmt','ForStmt','WhileStmt','DoStmt','SwitchStmt'].includes(node.kind)})??sourceMap.locate(op?.source),scopeId:node?scopeFor(node):null,...fields};
    plan.instructions.push(instruction);registry.set(key,instruction);return instruction;
  }
  // Decide all supported expression owners from AST before binding observations.
  const expressionOwners=new WeakMap();
  for(const original of localNodes.filter(n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator')){
    let n=original,owner=mutationExpression(n);
    if(!owner&&!canGroup(n))owner={node:n,kind:'single'};
    if(!owner){
      while(canGroup(n.parent)&&!memoryAccess(n.parent))n=n.parent;
      if(n.parent?.kind==='CompoundAssignOperator'&&n.parent.children.every(canGroup))owner={node:n.parent,kind:'update'};
      else owner={node:n,kind:'expression'};
    }
    expressionOwners.set(original,owner);
  }
  const semanticNodes=new Map(localNodes.map(n=>[n.id,n]));
  // The text DWARF adapter may not describe a record pointee yet; the AST's
  // canonical pointer spelling still identifies its arithmetic semantics.
  const isPointer=n=>types.spelling(n.type,n.canonical)?.kind==='pointer'||/\*/.test(n.canonical??n.type??'');
  const semanticExpression=op=>semanticNodes.get(op.semanticNodeId)??nearest(op,n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator');
  const expressionOwner=op=>expressionOwners.get(semanticExpression(op))??null;
  const defaultRole=op=>op.action==='load'?'read':op.action==='store'?'write':op.kind==='CALC'?'calculate':op.action;
  // Only hide private, non-escaping compiler slots. Source locals and storage
  // exposed through a pointer/call retain their observable memory operations.
  const compilerSlots=new Set(),compilerSlotUses=new Set();
  for(const allocation of observations.instructions.filter(o=>o.action==='object.begin'&&!o.local&&!o.source)){
    const uses=observations.instructions.filter(o=>o.functionId===allocation.functionId&&o.id!==allocation.id&&
      (o.pointer?.value===allocation.result||(o.inputs??[]).some(input=>input.value===allocation.result)));
    if(uses.length&&uses.every(o=>['load','store'].includes(o.action)&&o.pointer?.value===allocation.result&&
      !(o.inputs??[]).some(input=>input.value===allocation.result))){
      compilerSlots.add(allocation.id);for(const use of uses)compilerSlotUses.add(use.id);
    }
  }
  const compilerValues=new Set(observations.instructions.filter(o=>o.result&&compilerSlotUses.has(o.id)).map(o=>`${o.functionId}:${o.result}`));
  const usedValues=new Set(observations.instructions.flatMap(o=>
    [...(o.inputs??[]),...(o.args??[]),...(o.incoming??[]),o.pointer].filter(Boolean).map(v=>`${o.functionId}:${v.value}`)));
  for(const op of observations.instructions){
    const binding={roles:{},administrative:false},node=nearest(op),declaration=declarationsFor(op),role=defaultRole(op);
    const put=(selector,kind,action,owner=node,fields={})=>{
      const key=`${op.functionId??'program'}:${kind}:${action}:${owner?.id??op.id}`;
      const instruction=add(key,kind,action,op,owner,fields);binding.roles[selector]=instruction.id;return instruction;
    };
    const evaluation=evaluations.get(op.id);
    if(evaluation){
      const {node:owner,role:evaluationRole}=evaluation,spec=evaluationByNode.get(owner.id);
      binding.evaluation={nodeId:owner.id,role:evaluationRole};
      if(['decision','truth-test','selection'].includes(evaluationRole)){
        binding.administrative=true;
      }else{
        const instruction=put('CALC','CALC','expression',owner,{expression:tree(owner),cType:spec.cType,
          operator:spec.operator,grouping:'logical',evaluationNodeId:owner.id,helpMarker:spec.helpMarker,observationIds:[]});
        instruction.observationIds.push(op.id);binding.group=instruction.id;
        binding.expressionNodeId=owner.id;binding.sourceOperator=spec.operator;binding.failedInstructionId=instruction.id;
      }
      plan.bindings[op.id]=binding;continue;
    }
    // Clang may emit a dead i1 extension beside a select. It has no source
    // conversion or SSA consumer; retain it only in the observation trace.
    const unusedBooleanExtension=op.opcode==='zext'&&op.inputs?.[0]?.type==='i1'&&!op.conversion&&
      !usedValues.has(`${op.functionId}:${op.result}`);
    if(op.action==='globals.ready'||compilerSlots.has(op.id)||compilerSlotUses.has(op.id)||unusedBooleanExtension){
      binding.administrative=true;binding.hiddenStorage=compilerSlots.has(op.id);plan.bindings[op.id]=binding;continue;
    }
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
    }else if(op.action==='object.begin'||op.action==='global.begin'||op.action==='lifetime.start'){
      const allocation=op.action==='lifetime.start'?observations.instructions.find(o=>o.id===op.allocationObservationId):op;
      if(op.action==='object.begin'&&op.lifetimeManaged)binding.administrative=true;
      binding.declarationObservationId=allocation?.declarationObservationId??null;
      put('SPACE:object.begin','SPACE','object.begin',declaration?byAST.get([...declarationByAST].find(([,id])=>id===declaration.id)?.[0]):null,
        {declarationId:declaration?.id??null,storage:op.action==='global.begin'?'static':'automatic',cType:op.cType??op.global?.cType??null,
          visibility:declaration?'source':'implementation',scopeId:declaration?.scopeId??null,source:declaration?.source??op.source??null});
    }else if(op.action==='source.declaration'){
      binding.sourceDeclaration=true;binding.allocationObservationId=op.allocationObservationId;
      put('SPACE:declaration','SPACE','object.begin',declaration?byAST.get([...declarationByAST].find(([,id])=>id===declaration.id)?.[0]):null,
        {declarationId:declaration?.id??null,storage:'automatic',cType:op.cType,visibility:'source',
          scopeId:declaration?.scopeId??null,source:declaration?.source??op.source??null});
    }else if(op.action==='lifetime.end'){
      const scope=plan.scopes.find(s=>s.id===declaration?.scopeId),parent=plan.scopes.find(s=>s.id===scope?.parentId);
      const returning=nearest(op,n=>n.kind==='ReturnStmt');
      op.endReason=returning||parent?.kind==='FunctionDecl'?'function-return':'scope-exit';
      // End locations come from compiler markers (closing brace or jump), not
      // from the declaration's source range or a comparison of line numbers.
      put('SPACE:object.end','SPACE','object.end',null,{declarationId:declaration?.id??null,
        scopeId:declaration?.scopeId??null,source:sourceMap.locate(op.source),reason:op.endReason});
    }else if(op.action==='function.return'){
      const owner=nearest(op,n=>n.kind==='ReturnStmt');
      if(op.type!=='void')put('WRITE:return.value','WRITE','return.value',owner,{returnType:op.cType??op.type});
      put('FLOW:return','FLOW','return',owner);
      put('SPACE:object.end','SPACE','object.end',owner,{reason:'function-return'});
      put('SPACE:frame.end','SPACE','frame.end',owner);
    }else if(op.action==='call'){
      const callee=op.callee.slice(1).replace(/^"|"$/g,'');
      const callNode=nearest(op,n=>n.kind==='CallExpr'),owner=callNode??nearest(op,n=>n.kind==='VarDecl'||mutation(n));
      let target=callNode?.children[0];while(target&&target.children.length===1)target=target.children[0];
      const sourceName=/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target?.details??'')?.[1];
      const callInfo={callee:sourceName?`@${sourceName}`:op.callee,backendCallee:op.callee};
      binding.suppressCallBoundary=!callNode&&/^(?:llvm\.)?mem(?:cpy|move|set)/.test(callee);
      if(!binding.suppressCallBoundary){
        const call=put('FLOW:call.begin','FLOW','call',owner,{...callInfo,external:op.external,arguments:callNode?.children.slice(1).map(n=>tree(n))??[]});
        binding.callInstructionId=call.id;put('FLOW:call.end','FLOW','resume',owner,{...callInfo,external:op.external});
      }
      // Effects depend on observations, not on a list of function names.
      put('WRITE:output','WRITE','output',owner,{callee:op.callee,evidence:'observed stream output'});
      put('READ:input','READ','input',owner,{callee:op.callee,evidence:'observed stream input'});
      put('WRITE:write.range','WRITE','write.range',owner,{callee:op.callee,evidence:'observed linked memory stores'});
      if(/^(?:llvm\.)?mem(?:cpy|move)/.test(callee)||['strcpy','strncpy','strcat'].includes(callee))put('WRITE:copy','WRITE','copy',owner,{callee:op.callee,evidence:'library API effect'});
      if(/^(?:llvm\.)?memset/.test(callee))put('WRITE:fill','WRITE','fill',owner,{callee:op.callee,evidence:'library API effect'});
      if(['scanf','__isoc99_scanf','sscanf','fscanf','fgets'].includes(callee))put('WRITE:input','WRITE','input',owner,{callee:op.callee,evidence:'library API effect'});
      if(['malloc','calloc','realloc'].includes(callee))put('SPACE:object.begin','SPACE','object.begin',owner,{storage:'heap',callee:op.callee});
      if(['free','realloc'].includes(callee))put('SPACE:object.end','SPACE','object.end',owner,{callee:op.callee});
    }else if(op.kind==='CALC'){
      const owner=expressionOwner(op);
      const point=op.source&&{...op.source,file:op.source.file===filename?'/main.c':op.source.file};
      const pointerOperation=nearest(op,n=>(n.kind==='BinaryOperator'&&['+','-'].includes(operator(n))&&isPointer(n)||n.kind==='UnaryOperator'&&(operator(n)==='&'||['++','--'].includes(operator(n))&&isPointer(n)))&&
        !n.children.some(c=>contains(c.source,point)));
      if(op.action==='address'&&!pointerOperation||
        ['bitcast','addrspacecast','ptrtoint','inttoptr'].includes(op.opcode)&&!nearest(op,n=>n.kind==='CStyleCastExpr')||
        op.action==='merge'&&!nearest(op,n=>['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)||['&&','||'].includes(operator(n)))){
        binding.administrative=true;
      }else{
        const grouped=owner?.kind==='expression'||owner?.kind==='update'&&owner.node.children.every(canGroup);
        const instruction=put('CALC','CALC',grouped?'expression':op.action,owner?.node??node,
          {expression:owner?tree(owner.node):null,cType:owner?types.spelling(owner.node.type,owner.node.canonical)??op.cType??null:op.cType??null,operator:owner?visibleOperator(owner.node):op.opcode,
            grouping:owner?.kind??'unmapped-observation',observationIds:[],
            ...(owner?.node.kind==='CompoundAssignOperator'?compoundTypes(owner.node,types):{})});
        instruction.observationIds.push(op.id);binding.group=grouped?instruction.id:null;
        const expressionNode=semanticExpression(op);
        binding.expressionNodeId=expressionNode?.id??null;binding.sourceOperator=op.conversion?null:operator(expressionNode);
        if(!owner)plan.coverage.unmappedObservations.push({observationId:op.id,reason:'no reliable source expression',source:op.source});
      }
    }else if(op.action==='load'||op.action==='store'){
      const owner=op.action==='store'?nearest(op,n=>n.kind==='VarDecl'||mutation(n)):nearest(op,n=>n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>'))??node;
      put(op.kind,op.kind,role,owner,{cType:op.cType??null,accessType:op.type,expression:owner?tree(owner):null});
    }else if(op.action==='branch'||op.action==='switch'){
      if(!op.source&&op.inputs.length&&op.inputs.every(input=>compilerValues.has(`${op.functionId}:${input.value}`))){
        binding.administrative=true;plan.bindings[op.id]=binding;continue;
      }
      const owner=nearest(op,n=>['IfStmt','WhileStmt','ForStmt','DoStmt','SwitchStmt','BreakStmt','ContinueStmt','GotoStmt'].includes(n.kind));
      const jump={BreakStmt:'break',ContinueStmt:'continue',GotoStmt:'goto'}[owner?.kind],
        loopBack=['WhileStmt','ForStmt','DoStmt'].includes(owner?.kind)&&op.destinations.some(target=>backEdges.has(`${op.functionId}:${op.block}:${target}`));
      if(op.action==='branch'&&!op.inputs.length&&!jump&&!loopBack)binding.administrative=true;
      else{
        // The condition child, not the beginning of a multi-line do statement,
        // is the point the editor must highlight for the decision.
        const condition=op.inputs.length?({DoStmt:owner?.children.at(-1),WhileStmt:owner?.children[0],
          ForStmt:owner?.childSlots[2],IfStmt:owner?.children[0],SwitchStmt:owner?.children[0]}[owner?.kind]):null;
        const conditionRoot=condition&&(expressionOwners.get(condition)?.node??condition);
        const conditionSource=conditionRoot?readSource(conditionRoot.source):null;
        put('FLOW','FLOW',jump??(!op.inputs.length&&loopBack?'loop.next':op.action),owner??node,
          {destinations:op.destinations,cases:op.cases??null,controlKind:owner?.kind??null,
            ...(conditionSource?{statementSource:sourceMap.range(owner?.source),conditionSource,source:conditionSource}: {})});
      }
    }else if(op.action==='short-circuit'){
      const owner=localNodes.find(n=>n.id===op.shortCircuit.nodeId)??nearest(op,n=>evaluationKind(n)==='logical'),spec=evaluationByNode.get(owner?.id);
      put('FLOW:short-circuit','CALC','expression',owner,{source:op.source,expression:tree(owner),cType:spec?.cType,
        operator:op.shortCircuit.operator,evaluationNodeId:owner?.id,helpMarker:spec?.helpMarker});
      binding.evaluation={nodeId:owner?.id,role:'folded'};
    }
    else put(op.kind,op.kind,op.action,node);
    binding.failedInstructionId=binding.roles[op.kind]??binding.roles.CALC??Object.values(binding.roles)[0]??null;
    plan.bindings[op.id]=binding;
  }
  // Clang commonly follows a comparison's i1 result with zext to C int.
  // Keep its observed value, but do not present a second source comparison.
  const producers=new Map();
  for(const op of observations.instructions){
    const input=op.inputs?.[0],producer=input&&producers.get(`${op.functionId}:${input.value}`);
    const b=plan.bindings[op.id],node=semanticNodes.get(b?.expressionNodeId);
    // A C pointer difference is one source operation. Its byte subtraction and
    // division by the ABI element size are implementation observations of it.
    const pointerDifference=node?.kind==='BinaryOperator'&&operator(node)==='-'&&node.children.length===2&&
      node.children.every(isPointer);
    if(pointerDifference&&b.group){
      if(op.opcode==='sub'){
        const operands=op.inputs.map(i=>producers.get(`${op.functionId}:${i.value}`));
        if(operands.length===2&&operands.every(o=>o?.opcode==='ptrtoint')&&operands[0].inputs[0].type===operands[1].inputs[0].type){
          const elementSizeBytes=abi?.layout(operands[0].inputs[0].type.slice(0,-1)).size;
          if(elementSizeBytes>0){b.numeric={operation:'pointer-difference',elementSizeBytes,defaultUnit:'elements',units:['elements','bytes']};
            b.numericRole='result';b.resultType=types.spelling(node.type,node.canonical);}
        }
      }else if(['sdiv','ashr'].includes(op.opcode)){
        const original=plan.bindings[producer?.id],size=original?.numeric?.elementSizeBytes,literal=op.inputs[1]?.value;
        const divisor=/^\d+$/.test(literal??'')?(op.opcode==='ashr'?2**Number(literal):Number(literal)):null;
        if(size&&size===divisor&&b.group===original.group&&b.expressionNodeId===original.expressionNodeId){
          b.materializesObservationId=producer.id;b.numeric=original.numeric;b.numericRole='result';b.resultType=original.resultType;
          original.numericRole='byte-distance';
        }
      }
    }
    if(op.opcode==='zext'&&input?.type==='i1'&&op.type==='i32'&&!op.conversion&&(producer?.cBoolean||evaluations.get(producer?.id)?.role==='result')){
      const original=plan.bindings[producer.id];
      if(b?.group&&b.group===original?.group&&b.expressionNodeId===original.expressionNodeId)
        b.materializesObservationId=producer.id;
    }
    if(op.result)producers.set(`${op.functionId}:${op.result}`,op);
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
    if(consumer)(consumer.foldedResults??=[]).push(decision.id);
  }
  // Process-level effects have their own instructions, not a borrowed return ID.
  for(const [kind,action]of [['WRITE','output'],['READ','input'],['SPACE','object.end'],['SPACE','frame.end'],['ERROR','fault']])
    add(`process:${kind}:${action}`,kind,action,null,null,{processEffect:true});
  plan.processInstructions=Object.fromEntries(plan.instructions.filter(i=>i.processEffect).map(i=>[`${i.kind}:${i.action}`,i.id]));
  plan.functions=observations.functions.map(f=>({...f,parameters:parametersFor(f.name),
    source:sourceMap.range(localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===f.name&&n.children.some(c=>c.kind==='CompoundStmt'))?.source)}));
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
    }else if(canGroup(n)&&expressionOwners.get(n)?.node===n&&expressionKinds.has(n.kind)&&n.children.length&&
      (operator(n)||n.children.some(c=>expressionKinds.has(c.kind))))declare('CALC','expression',{expression:tree(n)});
  }
  buildControlFlow(plan,observations,{nodes,nearest,readSource:raw=>sourceMap.range(raw),filename});
  const evaluationResults=new Set(Object.values(plan.bindings).filter(b=>['result','selection','folded'].includes(b.evaluation?.role)).map(b=>b.evaluation.nodeId));
  plan.coverage.expressionEvaluations={source:'AST expression identity + observed LLVM values and edges',
    help:'stub',unbound:plan.evaluations.filter(e=>!evaluationResults.has(e.nodeId)).map(e=>({nodeId:e.nodeId,source:e.source,reason:'no reliable observed expression result'}))};
  for(const op of observations.instructions){
    const binding=plan.bindings[op.id];if(!binding)continue;
    binding.sourceMapping={compilerLocation:op.source??null,
      astNodeIds:sourceMap.candidates(op.source,functionNames.get(op.functionId)).map(n=>n.id)};
  }
  for(const instruction of plan.instructions){
    if(instruction.source&&!instruction.source.start)instruction.source=sourceMap.locate(instruction.source,{text:true});
    instruction.sourceStatus=instruction.source?'mapped':instruction.processEffect||instruction.visibility==='implementation'?'implementation':'unmapped';
  }
  plan.sourceMap=sourceMap.report();
  plan.sourceMap.unmappedInstructions=plan.instructions.filter(i=>i.sourceStatus==='unmapped')
    .map(i=>({instructionId:i.id,sourceNodeId:i.sourceNodeId,reason:'compiler source range unavailable'}));
  return validateIRPlan(plan);
}
