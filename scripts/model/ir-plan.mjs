// Public IR describes source work. LLVM observation points are private bindings.
import {validateIRPlan} from './ir-schema.mjs';
import {buildControlFlow} from './control-flow.mjs';
import {compoundTypes} from './c-semantics.mjs';
import {evaluationBindings,evaluationKind,expressionOperator} from './evaluation.mjs';
import {logicalNotBindings} from './logical-not.mjs';
import {aggregateBindings,aggregateSources} from './aggregate-bindings.mjs';
import {bitfieldBindings} from './bitfields.mjs';
import {callProjection} from './call-abi.mjs';
import {bindGuardConditions} from './guard-conditions.mjs';
import {bindAssertions} from './assertions.mjs';
import {bindPresentationContract} from './presentation-contract.mjs';
import {bindResultDeliveries} from './result-delivery.mjs';
import {resolvedCoverage} from './coverage-resolution.mjs';
import {bindConversionConsumers} from './conversion-consumers.mjs';
import {booleanRepresentationBindings} from './boolean-representation.mjs';
import {bindFunctionDeclarations} from './function-declarations.mjs';
const position=(a,b)=>a.line-b.line||a.column-b.column;
const contains=(range,p)=>!!range&&!!p&&range.file===p.file&&position(range.start,p)<=0&&position(p,range.end)<=0;
const operator=n=>n?.kind==='UnaryOperator'?/\b(?:prefix|postfix) '([^']+)'/.exec(n.details)?.[1]??null:
  ['BinaryOperator','CompoundAssignOperator'].includes(n?.kind)?/ '([+*/%&|^<>=!,?:~-]+)'(?:\s|$)/.exec(n.details)?.[1]??null:null;
const name=n=>/\s([^\s']+)\s+'/.exec(n?.details??'')?.[1]??null;
const visibleOperator=n=>{
  if(!n)return null;
  const selected=selectedExpression(n);if(selected)return visibleOperator(selected);
  if(n.kind==='ParenExpr')return visibleOperator(n.children[0]);
  if(n.kind==='ImplicitCastExpr')return visibleOperator(n.children[0])??
    (/<(?:LValueToRValue|NoOp|ArrayToPointerDecay|FunctionToPointerDecay)>/.test(n.details)?null:'cast');
  if(n.kind==='CStyleCastExpr')return 'cast';
  if(['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind))return '?:';
  return n.builtin?.pure?n.builtin.name:n.pureCall?.name??operator(n);
};
const visibleEvaluation=n=>{while(n){const selected=selectedExpression(n);if(selected){n=selected;continue;}
  if(['ImplicitCastExpr','ParenExpr'].includes(n.kind)&&n.children.length===1){n=n.children[0];continue;}break;}
  return evaluationKind(n)?n:null;};
const expressionKinds=new Set(['BinaryOperator','UnaryOperator','ImplicitCastExpr','CStyleCastExpr','ParenExpr','ConditionalOperator','BinaryConditionalOperator']);
const leafKinds=new Set(['DeclRefExpr','IntegerLiteral','FloatingLiteral','CharacterLiteral','StringLiteral','GNUNullExpr','MemberExpr','ArraySubscriptExpr','OffsetOfExpr']);
const mutation=n=>n.kind==='CompoundAssignOperator'||n.kind==='BinaryOperator'&&operator(n)==='='||n.kind==='UnaryOperator'&&['++','--'].includes(operator(n));
const selectedExpression=n=>n.kind==='GenericSelectionExpr'?n.selectedAssociation?.children.at(-1):n.kind==='GenericAssociation'&&n.selected?n.children.at(-1):null;
const expressionChildren=n=>['GenericSelectionExpr','GenericAssociation'].includes(n.kind)?[selectedExpression(n)].filter(Boolean):n.children;
const groupable=new WeakMap(),composable=new WeakMap();
const canGroup=node=>groupExpression(node,false);
const canCompose=node=>groupExpression(node,true);
function groupExpression(node,callResults){
  if(!node)return false;
  const cache=callResults?composable:groupable;
  const stack=[{node,children:false}];
  while(stack.length){const entry=stack.at(-1),n=entry.node;
    if(cache.has(n)){stack.pop();continue;}
    if(n.sizeofInfo||n.alignofInfo?.byteAlignment){cache.set(n,true);stack.pop();continue;}
    const selected=selectedExpression(n),children=expressionChildren(n);
    if(!(leafKinds.has(n.kind)||expressionKinds.has(n.kind)||n.builtin?.pure||selected)||mutation(n)||operator(n)===','||
      ['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)){cache.set(n,false);stack.pop();continue;}
    // The call remains a FLOW boundary; its observed return is a fixed input
    // to the surrounding calculation. Never group the call's argument work
    // into its consumer, or treat the call itself as a pure expression.
    const returnedValue=child=>(callResults||n.builtin?.pure)&&child.kind==='CallExpr'&&!child.builtin;
    if(entry.children){cache.set(n,children.every(child=>returnedValue(child)||cache.get(child)));stack.pop();}
    else{entry.children=true;for(const child of children)if(!returnedValue(child)&&!cache.has(child))stack.push({node:child,children:false});}
  }
  return cache.get(node);
}
const mutationExpression=n=>mutation(n)?{node:n,kind:'update'}:null;
const memoryAccess=n=>n&&(['MemberExpr','ArraySubscriptExpr'].includes(n.kind)||n.kind==='UnaryOperator'&&operator(n)==='*');

export function buildIRPlan(observations,{nodes,types,sourceMap,typeQueries},source,filename,abi) {
  const readSource=raw=>sourceMap.range(raw,{text:true}),localNodes=nodes.filter(n=>n.source?.file==='/main.c'),
    byAST=new Map(nodes.map(n=>[n.astId,n])),declarationByAST=new Map(),scopeByAST=new Map();
  const aggregateSource=aggregateSources(types,nodes),initializationFor=n=>{
    const info=aggregateSource.initialization(n);return info?{...info,unionSelections:info.unionSelections.map(s=>({...s,source:sourceMap.range(s.source)}))}:null;
  };
  const plan={schemaVersion:3,programId:observations.programId,source:observations.source,backend:observations.backend,
    instructions:[],functions:[],declarations:[],scopes:[],types:observations.types,llvmTypes:observations.llvmTypes,
    bindings:{},coverage:{...observations.coverage,ir:'source work with explicit LLVM observation bindings',
      unboundSourceWork:[],unmappedObservations:[],lifetime:observations.coverage.lifetime,
      automaticLifetimes:observations.coverage.automaticLifetimes,compilerTypeQueries:typeQueries}};
  const genericSelections=new Map(nodes.filter(n=>n.kind==='GenericSelectionExpr'&&n.selectedAssociation).map(n=>[n.id,{
    nodeId:n.id,kind:'generic',stage:'compile-time',source:sourceMap.range(n.source),controlEvaluation:'unevaluated',
    controllingType:n.controllingType,control:{nodeId:n.children[0]?.id,type:n.controllingType,cType:types.spelling(n.controllingType),
      source:sourceMap.range(n.children[0]?.source),evaluation:'unevaluated'},
    selectedAssociationIndex:n.associations.indexOf(n.selectedAssociation),selectedType:n.selectedAssociation.isDefault?'default':n.selectedAssociation.type,
    selectedExpressionNodeId:n.selectedAssociation.children.at(-1)?.id,
    associations:n.associations.map(a=>({nodeId:a.id,type:a.type,canonicalType:a.canonical,isDefault:a.isDefault,selected:a.selected,
      expressionNodeId:a.children.at(-1)?.id,source:sourceMap.range(a.children.at(-1)?.source),evaluation:a.selected?'selected':'unselected'})),
    evidence:'compiler GenericSelectionExpr selected association'
  }]));
  plan.compileTimeSelections=[...genericSelections.values()];
  plan.enumDeclarations=localNodes.filter(n=>n.kind==='EnumDecl'&&n.children.some(c=>c.kind==='EnumConstantDecl')).map(n=>{
    const constants=n.children.filter(c=>c.kind==='EnumConstantDecl').map(c=>({nodeId:c.id,name:name(c),...types.enumConstant(c)})),
      resolved=constants.every(c=>c.enumTypeId&&c.value!=null);
    return {nodeId:n.id,source:sourceMap.range(n.source),status:resolved?'resolved':'unresolved',constants,
      ...(resolved?{enumTypeId:constants[0].enumTypeId}:{reason:'compiler debug enum descriptor unavailable or ambiguous'}),evidence:'compiler AST and DWARF'};
  });
  plan.coverage.compilerEnums={declarations:plan.enumDeclarations.length,
    unresolved:plan.enumDeclarations.filter(e=>e.status==='unresolved').map(e=>({nodeId:e.nodeId,source:e.source,reason:e.reason}))};
  const selectionCache=new WeakMap();
  function selectionsFor(n){
    if(!n||n.executionState)return [];if(selectionCache.has(n))return selectionCache.get(n);
    const found=new Map(n.children.flatMap(selectionsFor).map(s=>[s.nodeId,s]));if(genericSelections.has(n.id))found.set(n.id,genericSelections.get(n.id));
    for(let p=n.parent;p;p=p.parent)if(genericSelections.has(p.id))found.set(p.id,genericSelections.get(p.id));
    const list=[...found.values()];selectionCache.set(n,list);return list;
  }
  for(const n of localNodes.filter(n=>['FunctionDecl','CompoundStmt','ForStmt'].includes(n.kind))){
    let parent=n.parent;while(parent&&!scopeByAST.has(parent.astId))parent=parent.parent;
    const scope={id:`s${plan.scopes.length+1}`,parentId:parent?scopeByAST.get(parent.astId):null,kind:n.kind,
      functionName:n.functionName??null,source:sourceMap.range(n.source)};plan.scopes.push(scope);scopeByAST.set(n.astId,scope.id);
  }
  const scopeFor=n=>{for(let at=n;at;at=at.parent)if(scopeByAST.has(at.astId))return scopeByAST.get(at.astId);return null;};
  for(const n of localNodes.filter(n=>['VarDecl','ParmVarDecl'].includes(n.kind))){
    const declaration={id:`d${plan.declarations.length+1}`,name:name(n),kind:n.kind,functionName:n.functionName??null,
      scopeId:scopeFor(n.parent),source:sourceMap.range(n.source),point:n.declarationPoint&&{...(n.expansionDeclarationPoint??n.declarationPoint),file:filename},
      ...(n.expansionSource?{macroExpansion:{source:sourceMap.range(n.expansionSource),spelling:n.spellingRange}}:{}),
      type:n.type,cType:types.spelling(n.type,n.canonical),storage:/\bstatic\b/.test(n.details)?'static':n.functionName?'automatic':'static',
      hasInitializer:n.kind==='VarDecl'&&n.children.length>0,...(initializationFor(n)?{initialization:initializationFor(n)}:{})};
    plan.declarations.push(declaration);declarationByAST.set(n.astId,declaration.id);
  }
  const treeCache=new Map();
  function tree(n,depth=0){
    if(!n)return null;if(depth>128)return {kind:n.kind,evidence:'expression-depth-limit'};
    if(treeCache.has(n.id))return treeCache.get(n.id);
    const referenced=/\b(?:Var|ParmVar|Function|EnumConstant) (0x[0-9a-f]+)/.exec(n.details)?.[1],enumConstant=types.enumConstant(byAST.get(referenced));
    const member=n.kind==='MemberExpr'?aggregateSource.access(n):null,initialization=n.kind==='InitListExpr'?initializationFor(n):null;
    const literal=['IntegerLiteral','FloatingLiteral','CharacterLiteral'].includes(n.kind)?/ ([^\s]+)\s*$/.exec(n.details)?.[1]:undefined;
    const location=sourceMap.range(n.source),aggregate=n.kind==='InitListExpr';
    const stringLiteral=n.kind==='StringLiteral'?/((?:u8|u|U|L)?"(?:\\.|[^"\\])*")\s*$/.exec(n.details)?.[1]:null;
    const result={nodeId:n.id,kind:n.kind,operator:operator(n),type:n.type,cType:types.spelling(n.type,n.canonical),
      ...(n.kind==='UnaryOperator'?{position:/\bpostfix\b/.test(n.details)?'postfix':'prefix'}:{}),
      ...(referenced?{declarationId:declarationByAST.get(referenced)??null,referencedName:name(byAST.get(referenced))}:{}),
      ...(enumConstant?{enumConstant}:{}),
      ...(member?{fieldNodeId:byAST.get(n.fieldASTId)?.id??null,memberName:n.memberName,memberAccess:n.memberAccess,
        memberPath:member.path.filter(p=>p.kind==='member').map(p=>p.name),targetPath:member.path}:{}),
      ...(initialization?{initialization}:{}),
      ...(literal!==undefined?{literal}:{}),...(n.kind==='StringLiteral'?{literal:stringLiteral?.slice(0,256),literalTruncated:(stringLiteral?.length??0)>256,literalEvidence:'compiler AST'}:{}),
      ...(n.sizeofInfo?{sizeof:n.sizeofInfo}:{}),
      ...(n.alignofInfo?{alignof:n.alignofInfo}:{}),
      ...(n.kind==='GenericSelectionExpr'?{selection:genericSelections.get(n.id)??null}:{}),
      ...(n.kind==='GenericAssociation'?{selected:n.selected,isDefault:n.isDefault}:{}),
      ...(n.executionState?{evaluationState:n.executionState}:{}),
      ...(n.builtin?{builtin:n.builtin}:{}),
      ...(n.pureCall?{pureCall:n.pureCall}:{}),
      ...(n.kind==='ImplicitCastExpr'||n.kind==='CStyleCastExpr'?{cast:/<([^<>]+)>\s*$/.exec(n.details)?.[1]??null}:{}),
      source:location,...(aggregate?{elementCount:n.children.length,childrenOmitted:true}:{}),children:aggregate?[]:n.children.map(c=>tree(c,depth+1))};
    treeCache.set(n.id,result);return result;
  }
  const functionNode=fn=>localNodes.find(n=>n.kind==='FunctionDecl'&&n.functionName===fn&&n.children.some(c=>c.kind==='CompoundStmt'));
  // Clang has already converted each return expression to the function's C
  // result type. Also read the compiler type spelling for implicit main return.
  const sourceReturnTypes=new Map();
  for(const n of localNodes.filter(n=>n.kind==='ReturnStmt'&&n.children[0])){
    const value=n.children[0],type=types.spelling(value.type,value.canonical);if(type)sourceReturnTypes.set(n.functionName,type);
  }
  for(const fn of observations.functions){
    const node=functionNode(fn.name),prefix=t=>{const open=t?.indexOf('(')??-1;
      return open>=0&&!/^\s*[*&]/.test(t.slice(open+1))?t.slice(0,open).trim():undefined;};
    const declared=types.spelling(prefix(node?.type),prefix(node?.canonical));
    if(declared)sourceReturnTypes.set(fn.name,declared);
  }
  const parametersFor=fn=>(functionNode(fn)?.children??[]).filter(n=>n.kind==='ParmVarDecl').map(n=>declarationByAST.get(n.astId)).filter(Boolean);
  const functionNames=new Map(observations.functions.map(f=>[f.id,f.name]));
  const nearest=(op,predicate=()=>true)=>{
    return sourceMap.candidates(op.source,functionNames.get(op.functionId)).find(predicate)??null;
  };
  const aggregates=aggregateBindings(observations,{types,nearest,abi,nodes,source:aggregateSource});
  plan.coverage.sourceTemporaries={bound:aggregates.temporaries.size,unresolved:aggregates.temporaryGaps};
  const bitfields=bitfieldBindings(observations,{nearest,source:aggregateSource,types,abi,paths:aggregates.paths});
  plan.coverage.bitfields={accesses:bitfields.accesses.size,unresolved:bitfields.gaps};
  const evaluations=evaluationBindings(observations,nearest,nodes),evaluationByNode=new Map(),logicalNots=logicalNotBindings(observations,{nodes:localNodes,types,nearest});
  plan.evaluations=localNodes.filter(n=>evaluationKind(n)).map(n=>{
    const part=child=>({nodeId:child.id,source:sourceMap.range(child.source)}),kind=evaluationKind(n);
    const literal=observations.coverage.shortCircuits?.expressions?.find(e=>e.nodeId===n.id);
    const spec={nodeId:n.id,kind,operator:kind==='logical'?expressionOperator(n):'?:',source:sourceMap.range(n.source),
      cType:types.spelling(n.type,n.canonical),...(kind==='logical'?{left:part(n.children[0]),right:part(n.children[1]),
        leftTruth:literal?.left.truth??null,helpMarker:{kind:'logical-short-circuit',status:'stub',when:'right-skipped'}}:
        {truthType:types.spelling('int'),condition:part(n.children[0]),true:part(n.children[1]),false:part(n.children[2])})};
    evaluationByNode.set(n.id,spec);return spec;
  });
  const declarationsFor=op=>{
    const fn=observations.functions.find(f=>f.id===op.functionId)?.name,local=op.local??op.global;
    if(!local)return null;const candidates=plan.declarations.filter(d=>d.name===local.name&&(!fn||d.functionName===fn||d.storage==='static'));
    const line=local.source?.line??op.source?.line;
    const column=local.source?.column||op.source?.column;
    const atPoint=candidates.filter(d=>d.point?.line===line&&d.point?.column===column);
    if(atPoint.length===1)return atPoint[0];
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
    if(node&&['CALC','WRITE','FLOW'].includes(kind)&&node.kind!=='FunctionDecl'){
      const selections=selectionsFor(node);if(selections.length){instruction.selectionIds=selections.map(s=>s.nodeId);if(selections.length===1)instruction.selection=selections[0];}
    }
    plan.instructions.push(instruction);registry.set(key,instruction);return instruction;
  }
  // Decide all supported expression owners from AST before binding observations.
  const expressionOwners=new WeakMap();
  for(const original of localNodes.filter(n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator'||n.builtin?.pure)){
    let n=original,owner=mutationExpression(n);
    if(!owner&&!canCompose(n))owner={node:n,kind:'single'};
    if(!owner){
      while(canCompose(n.parent)&&!memoryAccess(n.parent))n=n.parent;
      if(n.parent?.kind==='CompoundAssignOperator'&&n.parent.children.every(canCompose))owner={node:n.parent,kind:'update'};
      else owner={node:n,kind:'expression'};
    }
    expressionOwners.set(original,owner);
  }
  const semanticNodes=new Map(localNodes.map(n=>[n.id,n]));
  const booleanRepresentations=booleanRepresentationBindings(observations,{nodes:localNodes,types,nearest});
  // The text DWARF adapter may not describe a record pointee yet; the AST's
  // canonical pointer spelling still identifies its arithmetic semantics.
  const isPointer=n=>types.spelling(n.type,n.canonical)?.kind==='pointer'||/\*/.test(n.canonical??n.type??'');
  const semanticExpression=op=>logicalNots.values.get(op.id)?.node??semanticNodes.get(op.semanticNodeId)??nearest(op,n=>expressionKinds.has(n.kind)||n.kind==='CompoundAssignOperator'||n.builtin?.pure);
  const expressionOwner=op=>expressionOwners.get(semanticExpression(op))??null;
  const defaultRole=op=>op.action==='load'?'read':op.action==='store'?'write':op.kind==='CALC'?'calculate':op.action;
  // Only hide private, non-escaping compiler slots. Source locals and storage
  // exposed through a pointer/call retain their observable memory operations.
  const compilerSlots=new Set(),compilerSlotUses=new Set();
  for(const allocation of observations.instructions.filter(o=>o.action==='object.begin'&&(!o.local&&!o.source||o.local?.compilerGenerated))){
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
  const valueProducers=new Map(observations.instructions.filter(o=>o.result).map(o=>[`${o.functionId}:${o.result}`,o])),returnStores=new Map(),returnAnchors=[];
  const valueUsers=new Map();
  for(const o of observations.instructions)for(const value of new Set([...o.inputs??[],...o.args??[],...o.incoming??[],o.pointer].filter(Boolean).map(i=>i.value))){
    const key=`${o.functionId}:${value}`,list=valueUsers.get(key)??[];list.push(o);valueUsers.set(key,list);
  }
  // LLVM GEP adapts narrow source indices to its address-index width even
  // when Clang has no C conversion expression. This only forwards the already
  // observed index value; it is not a calculation on the array base.
  const addressIndexAdaptations=new Set(observations.instructions.filter(o=>o.result&&o.action==='convert'&&
    ['zext','sext','trunc'].includes(o.opcode)&&!o.conversion&&
    semanticExpression(o)?.kind!=='CStyleCastExpr').filter(o=>{
      const users=valueUsers.get(`${o.functionId}:${o.result}`)??[];
      return users.length&&users.every(u=>u.action==='address'&&u.inputs.slice(1).some(input=>input.value===o.result));
    }).map(o=>o.id));
  // VLA subscripts are lowered to index * runtime row stride. Only compiler
  // calculations with no source operator and exclusively address consumers
  // are bookkeeping. A written i*cols remains an ordinary source CALC.
  const addressScales=new Set();
  const variableArray=t=>!!t&&(t.kind==='array'&&(t.variableLength||variableArray(t.elementType))||t.kind==='pointer'&&variableArray(t.pointee));
  let scaleChanged=true;
  while(scaleChanged){scaleChanged=false;
    for(const o of observations.instructions){
      if(addressScales.has(o.id)||!o.result||o.action!=='calculate'||
        !['mul','add'].includes(o.opcode)||visibleOperator(expressionOwner(o)?.node??semanticExpression(o)))continue;
      const n=semanticExpression(o);if(!variableArray(types.spelling(n?.type,n?.canonical)))continue;
      const users=valueUsers.get(`${o.functionId}:${o.result}`)??[];
      if(users.length&&users.every(u=>addressScales.has(u.id)||u.action==='address'&&u.inputs.slice(1).some(i=>i.value===o.result))){
        addressScales.add(o.id);scaleChanged=true;
      }
    }
  }
  const runtimeArrayScales=new Map();
  for(const o of observations.instructions.filter(o=>addressScales.has(o.id)&&o.opcode==='mul')){
    const n=nearest(o,n=>n.kind==='ArraySubscriptExpr'&&variableArray(types.spelling(n.type,n.canonical))),
      arrayType=n&&types.spelling(n.type,n.canonical),index=n?.children[1];
    if(arrayType?.kind!=='array'||!index)continue;
    const ids=new Set(),visit=n=>{ids.add(n.id);for(const c of n.children??[])visit(c);};visit(index);
    const matches=(input,seen=new Set())=>{
      if(!input||seen.has(input.value))return false;seen.add(input.value);
      const p=valueProducers.get(`${o.functionId}:${input.value}`);
      if(p)return !!nearest(p,n=>ids.has(n.id))||p.action==='convert'&&matches(p.inputs[0],seen);
      return [...ids].some(id=>{const n=localNodes.find(n=>n.id===id);return n?.kind==='IntegerLiteral'&&/ (-?\d+)\s*$/.exec(n.details)?.[1]===input.value;});
    };
    const indices=o.inputs.map((input,i)=>matches(input)?i:null).filter(i=>i!==null);
    if(indices.length===1)runtimeArrayScales.set(o.id,{indexInput:indices[0],arrayType,sourceNodeId:n.id});
  }
  for(const ret of observations.instructions.filter(o=>o.action==='function.return')){
    if(aggregates.returns.get(ret.id)?.sites.length){returnStores.set(ret.id,aggregates.returns.get(ret.id).sites);continue;}
    const load=valueProducers.get(`${ret.functionId}:${ret.inputs?.[0]?.value}`);if(load?.action!=='load')continue;
    const stores=observations.instructions.filter(o=>o.functionId===ret.functionId&&o.action==='store'&&o.pointer.value===load.pointer.value)
      .map(store=>({store,node:nearest(store,n=>n.kind==='ReturnStmt')})).filter(s=>s.node);
    if(stores.length)returnStores.set(ret.id,stores);
  }
  // A source return can reach a shared LLVM epilogue without a carrier store
  // (void return, direct SSA value, or NRVO). Its executed edge/value is an
  // anchor; a lexical tail return is also the function's fall-through exit.
  const tailReturns=new Map();
  for(const fn of observations.functions){const body=functionNode(fn.name)?.children.find(n=>n.kind==='CompoundStmt'),last=body?.children.at(-1);
    if(last?.kind==='ReturnStmt')tailReturns.set(fn.id,last);}
  for(const ret of observations.instructions.filter(o=>o.action==='function.return')){
    const sites=returnStores.get(ret.id)??[],edges=observations.instructions.filter(o=>o.functionId===ret.functionId&&o.action==='branch');
    const reaches=start=>{const pending=[start],seen=new Set();while(pending.length){const block=pending.pop();if(block===ret.block)return true;
      if(seen.has(block))continue;seen.add(block);for(const e of edges)if(e.block===block)pending.push(...e.destinations);}return false;};
    for(const op of observations.instructions.filter(o=>o.functionId===ret.functionId&&o.id!==ret.id)){
      const node=nearest(op,n=>n.kind==='ReturnStmt');
      if(node&&reaches(op.block)&&!sites.some(s=>s.store.id===op.id)&&
        (op.action==='branch'||op.action==='load'||op.action==='store'||op.kind==='CALC'||op.action==='call'))sites.push({store:op,node});
    }
    if(sites.length)returnStores.set(ret.id,sites);
  }
  // Pointer comparisons that only control compiler-generated aggregate
  // zero-initialization have no source expression owner. Do not expose them
  // as user comparisons/loops; source comparisons inside an initializer do.
  const initializerControls=new Set(observations.instructions.filter(op=>op.opcode==='icmp'&&
    op.inputs?.length===2&&op.inputs.every(i=>i.type?.endsWith('*'))&&!expressionOwner(op)&&
    nearest(op,n=>n.kind==='InitListExpr')).map(op=>op.id));
  for(const op of observations.instructions){
    const binding={roles:{},administrative:false},node=nearest(op),declaration=declarationsFor(op),role=defaultRole(op);
    if(op.addressBinding)binding.addressBinding=op.addressBinding;
    const put=(selector,kind,action,owner=node,fields={})=>{
      const key=`${op.functionId??'program'}:${kind}:${action}:${owner?.id??op.id}:${fields.accessType??''}:${fields.targetPath?JSON.stringify(fields.targetPath):''}`;
      const instruction=add(key,kind,action,op,owner,fields);binding.roles[selector]=instruction.id;return instruction;
    };
    const bitfield=bitfields.accesses.get(op.id);
    if(bitfields.hidden.has(op.id)){
      binding.administrative=true;plan.bindings[op.id]=binding;continue;
    }
    if(bitfield){
      binding.bitfield={width:bitfield.width,shift:bitfield.shift,cType:bitfield.cType,
        offsetBits:bitfield.offsetBits,storageOffsetBits:bitfield.storageOffsetBits};
      if(bitfield.role==='write')binding.sourceOperands=bitfield.valueOperand?[bitfield.valueOperand]:[];
    }
    const logicalNot=logicalNots.values.get(op.id),condition=logicalNots.branches.get(op.id);
    if(logicalNot){binding.sourceBoolean={invert:logicalNot.invert,cType:logicalNot.cType};binding.sourceOperands=logicalNot.inputs;
      if(logicalNot.materializesObservationId)binding.materializesObservationId=logicalNot.materializesObservationId;}
    if(condition)binding.sourceCondition={invert:condition.invert,cType:condition.cType};
    if(logicalNots.hidden.has(op.id)){binding.administrative=true;plan.bindings[op.id]=binding;continue;}
    const evaluation=evaluations.get(op.id);
    if(evaluation&&!logicalNot){
      const {node:owner,role:evaluationRole}=evaluation,spec=evaluationByNode.get(owner.id);
      binding.evaluation={nodeId:owner.id,role:evaluationRole,...(evaluation.phiIncoming?{phiIncoming:evaluation.phiIncoming}:{})};
      const sourceOwner=expressionOwners.get(owner),work=sourceOwner?.kind==='expression'?sourceOwner.node:owner;
      if(['decision','truth-test','selection'].includes(evaluationRole)){
        if(spec.kind==='conditional'&&(evaluationRole==='decision'||evaluationRole==='selection'&&op.opcode==='select')){
          const instruction=put(evaluationRole==='decision'?'FLOW':'CALC','FLOW','conditional',owner,{operator:'?:',evaluationNodeId:owner.id,
            expression:tree(owner),conditionSource:readSource(owner.children[0].source),
            source:readSource(owner.children[0].source),destinations:op.destinations});
          binding.failedInstructionId=instruction.id;
        }else{
          binding.administrative=true;
          if(evaluationRole==='decision'&&canCompose(work))binding.continueExpressionNodeId=work.id;
        }
      }else{
        const topEvaluation=visibleEvaluation(work);
        const instruction=put('CALC','CALC','expression',work,{expression:tree(work),cType:types.spelling(work.type,work.canonical),
          operator:visibleOperator(work),grouping:'expression',...(evaluationKind(topEvaluation)==='logical'?{evaluationNodeId:topEvaluation.id,helpMarker:spec.helpMarker}:{}),observationIds:[]});
        // An earlier child comparison may already have registered this source
        // group. Completion metadata belongs to that same definition.
        if(evaluationKind(topEvaluation)==='logical')instruction.evaluationNodeId=topEvaluation.id;
        instruction.observationIds.push(op.id);binding.group=instruction.id;
        binding.expressionNodeId=owner.id;binding.sourceOperator=spec.operator;binding.failedInstructionId=instruction.id;
      }
      plan.bindings[op.id]=binding;continue;
    }
    // Clang may emit a dead i1 extension beside a select. It has no source
    // conversion or SSA consumer; retain it only in the observation trace.
    const unusedBooleanExtension=op.opcode==='zext'&&op.inputs?.[0]?.type==='i1'&&!op.conversion&&
      !usedValues.has(`${op.functionId}:${op.result}`);
    if(booleanRepresentations.has(op.id))binding.booleanRepresentation=booleanRepresentations.get(op.id);
    const initializerControl=initializerControls.has(op.id)||op.action==='branch'&&op.inputs?.length===1&&
      initializerControls.has(valueProducers.get(`${op.functionId}:${op.inputs[0].value}`)?.id);
    if(initializerControl||op.action==='globals.ready'||op.action==='function.address'||op.action==='stack.save'||compilerSlots.has(op.id)||compilerSlotUses.has(op.id)||unusedBooleanExtension||addressIndexAdaptations.has(op.id)||booleanRepresentations.has(op.id)){
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
      op.cType??=parameter?.cType;
      put('WRITE:argument','WRITE','argument',null,{parameterIndex:sourceIndex,abiParameterIndex:op.parameter.index,declarationId:parameter?.id??null,cType:parameter?.cType??op.cType,source:parameter?.source??null});
      put('SPACE:object.begin','SPACE','object.begin',null,{declarationId:parameter?.id??null,storage:'automatic',cType:parameter?.cType??op.cType,source:parameter?.source??null});
    }else if(op.action==='object.begin'||op.action==='global.begin'||op.action==='lifetime.start'||op.action==='source.alias'){
      const allocation=op.action==='lifetime.start'?observations.instructions.find(o=>o.id===op.allocationObservationId):op;
      const temporary=aggregates.temporaries.get(allocation?.id);
      if(op.action==='object.begin'&&op.lifetimeManaged)binding.administrative=true;
      binding.declarationObservationId=allocation?.declarationObservationId??null;
      if(temporary)binding.sourceTemporary=true;
      put('SPACE:object.begin','SPACE','object.begin',temporary?.node??(declaration?byAST.get([...declarationByAST].find(([,id])=>id===declaration.id)?.[0]):null),
        {declarationId:declaration?.id??null,storage:op.action==='global.begin'?'static':'automatic',cType:temporary?.cType??op.cType??op.global?.cType??null,
          ...(temporary?{sourceTemporary:true,temporaryRole:temporary.role??'compound-literal'}:{}),visibility:temporary?.visibility??(declaration||temporary?'source':'implementation'),
          scopeId:temporary?scopeFor(temporary.node):declaration?.scopeId??null,
          source:temporary?sourceMap.range(temporary.node.source):declaration?.source??op.source??null});
    }else if(op.action==='source.declaration'){
      binding.sourceDeclaration=true;binding.allocationObservationId=op.allocationObservationId;
      put('SPACE:declaration','SPACE','object.begin',declaration?byAST.get([...declarationByAST].find(([,id])=>id===declaration.id)?.[0]):null,
        {declarationId:declaration?.id??null,storage:'automatic',cType:op.cType,visibility:'source',
          scopeId:declaration?.scopeId??null,source:declaration?.source??op.source??null});
    }else if(op.action==='stack.restore'){
      put('SPACE:object.end','SPACE','object.end',nearest(op,n=>n.kind==='CompoundStmt'),
        {reason:'stack-restore',source:op.source??null});
    }else if(op.action==='lifetime.end'){
      const scope=plan.scopes.find(s=>s.id===declaration?.scopeId),parent=plan.scopes.find(s=>s.id===scope?.parentId);
      const returning=nearest(op,n=>n.kind==='ReturnStmt');
      op.endReason=returning||parent?.kind==='FunctionDecl'?'function-return':'scope-exit';
      // End locations come from compiler markers (closing brace or jump), not
      // from the declaration's source range or a comparison of line numbers.
      put('SPACE:object.end','SPACE','object.end',null,{declarationId:declaration?.id??null,
        scopeId:declaration?.scopeId??null,source:sourceMap.locate(op.source),reason:op.endReason});
    }else if(op.action==='function.return'){
      const owner=nearest(op,n=>n.kind==='ReturnStmt')??tailReturns.get(op.functionId)??null;
      op.cType=sourceReturnTypes.get(functionNames.get(op.functionId))??op.cType;
      const returnType=op.aggregateReturn?.cType??op.cType??op.type;
      if(op.type!=='void'||op.aggregateReturn)put('WRITE:return.value','WRITE','return.value',owner,{returnType});
      put('FLOW:return','FLOW','return',owner);
      // The final ret may be placed after cleanup at a closing brace. An
      // observed write to its carrier slot identifies the actual ReturnStmt.
      if(returnStores.has(op.id)){
        const defaults={...binding.roles};binding.returnSites={};
        for(const {store,node:site}of returnStores.get(op.id)){
          const roles={};if(op.type!=='void'||op.aggregateReturn)roles['WRITE:return.value']=put('WRITE:return.value','WRITE','return.value',site,{returnType}).id;
          roles['FLOW:return']=put('FLOW:return','FLOW','return',site).id;binding.returnSites[site.id]=roles;
          returnAnchors.push({storeId:store.id,returnObservationId:op.id,sourceNodeId:site.id});
        }
        binding.roles=defaults;
      }
      put('SPACE:object.end','SPACE','object.end',owner,{reason:'function-return'});
      put('SPACE:frame.end','SPACE','frame.end',owner);
    }else if(op.action==='call'){
      const callee=op.callee.slice(1).replace(/^"|"$/g,'');
      const resolvedCall=semanticNodes.get(op.semanticNodeId),callNode=aggregates.memoryCalls.has(op.id)?aggregates.memoryCalls.get(op.id):
        resolvedCall?.kind==='CallExpr'?resolvedCall:nearest(op,n=>n.kind==='CallExpr'),
        owner=callNode??nearest(op,n=>n.kind==='VarDecl'||n.kind==='ReturnStmt'||mutation(n));
      let target=callNode?.children[0];while(target&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(target.kind)&&target.children.length===1)target=target.children[0];
      const sourceName=/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target?.details??'')?.[1];
      const callInfo={callee:sourceName?`@${sourceName}`:op.callee,backendCallee:op.callee};
      const projection=callProjection(op,callNode,{types,sourceName});
      if(projection){binding.callProjection=projection;callInfo.callProjection=projection;}
      const memoryArguments=aggregates.argumentsByCall.get(op.id),initialization=owner?.kind==='VarDecl'?initializationFor(owner):null,
        memoryInfo={...(memoryArguments?{memoryArguments}:{}),...(initialization?{initialization}:{})};
      binding.suppressCallBoundary=!callNode&&/^(?:llvm\.)?mem(?:cpy|move|set)/.test(callee);
      if(!binding.suppressCallBoundary){
        const call=put('FLOW:call.begin','FLOW','call',owner,{...callInfo,...memoryInfo,external:op.external,arguments:callNode?.children.slice(1).map(n=>tree(n))??[]});
        binding.callInstructionId=call.id;put('FLOW:call.end','FLOW','resume',owner,{...callInfo,external:op.external});
      }
      // Effects depend on observations, not on a list of function names.
      put('WRITE:output','WRITE','output',owner,{callee:op.callee,evidence:'observed stream output'});
      put('READ:input','READ','input',owner,{callee:op.callee,evidence:'observed stream input'});
      put('WRITE:write.range','WRITE','write.range',owner,{callee:op.callee,...memoryInfo,evidence:'observed linked memory stores'});
      if(op.external){
        if(/^(?:llvm\.)?mem(?:cpy|move)/.test(callee)||['strcpy','strncpy','strcat'].includes(callee))put('WRITE:copy','WRITE','copy',owner,{callee:op.callee,...memoryInfo,evidence:'library API effect'});
        if(/^(?:llvm\.)?memset/.test(callee))put('WRITE:fill','WRITE','fill',owner,{callee:op.callee,...memoryInfo,evidence:'library API effect'});
        if(['scanf','__isoc99_scanf','sscanf','fscanf','fgets'].includes(callee))put('WRITE:input','WRITE','input',owner,{callee:op.callee,...memoryInfo,evidence:'library API effect'});
        put('SPACE:object.begin','SPACE','object.begin',owner,{callee:op.callee,evidence:'observed allocation or compiler-proven storage'});
        if(['free','realloc'].includes(callee))put('SPACE:object.end','SPACE','object.end',owner,{callee:op.callee});
      }
    }else if(op.kind==='CALC'){
      const owner=expressionOwner(op);
      // Classification and expression ownership must use the same AST node.
      // A macro expansion point alone can cover unrelated pointer READs.
      const semantic=semanticNodes.get(op.semanticNodeId),pointerOperation=op.addressBinding?
        semanticNodes.get(op.addressBinding.operatorNodeId):semantic&&
          (semantic.kind==='BinaryOperator'&&['+','-'].includes(operator(semantic))&&isPointer(semantic)||
           semantic.kind==='UnaryOperator'&&(operator(semantic)==='&'||['++','--'].includes(operator(semantic))&&isPointer(semantic)))?semantic:null;
      const point=op.source&&{...op.source,file:op.source.file===filename?'/main.c':op.source.file},
        explicitAddress=pointerOperation&&!pointerOperation.children.some(c=>contains(c.source,point));
      // A GEP located in the lvalue child is storage selection, not another
      // source operator step. The verified binding still describes its target.
      if(addressScales.has(op.id)||op.action==='address'&&!explicitAddress||
        ['bitcast','addrspacecast','ptrtoint','inttoptr'].includes(op.opcode)&&!nearest(op,n=>n.kind==='CStyleCastExpr'&&
          !/<(?:NoOp|LValueToRValue)>/.test(n.details)&&types.spelling(n.type,n.canonical)?.kind==='pointer'===op.type.endsWith('*')&&
          (op.opcode!=='bitcast'||types.spelling(n.children[0]?.type,n.children[0]?.canonical)?.kind==='pointer'))||
        op.action==='merge'&&!nearest(op,n=>['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)||['&&','||'].includes(operator(n)))){
        binding.administrative=true;
        if(runtimeArrayScales.has(op.id))binding.runtimeArrayScale=runtimeArrayScales.get(op.id);
      }else{
        const grouped=owner?.kind==='expression'||owner?.kind==='update'&&owner.node.children.every(canCompose);
        const instruction=put('CALC','CALC',grouped?'expression':op.action,owner?.node??node,
          {expression:owner?tree(owner.node):null,cType:owner?types.spelling(owner.node.type,owner.node.canonical)??op.cType??null:op.cType??null,
            operator:!grouped&&op.action==='convert'?'cast':owner?visibleOperator(owner.node):op.opcode,
            grouping:owner?.kind??'unmapped-observation',observationIds:[],
            ...(owner?.node.kind==='CompoundAssignOperator'?compoundTypes(owner.node,types):{})});
        instruction.observationIds.push(op.id);binding.group=grouped?instruction.id:null;
        const expressionNode=semanticExpression(op);
        binding.expressionNodeId=expressionNode?.id??null;binding.sourceOperator=op.conversion?null:operator(expressionNode);
        if(expressionNode?.builtin){const constants=n=>['IntegerLiteral','FloatingLiteral','CharacterLiteral','StringLiteral'].includes(n.kind)||n.sizeofInfo||n.children.some(constants);
          binding.sourceBuiltin={...expressionNode.builtin,hasLiteralArguments:expressionNode.children.slice(1).some(constants)};}
        if(!owner)plan.coverage.unmappedObservations.push({observationId:op.id,reason:'no reliable source expression',source:op.source});
      }
    }else if(op.action==='load'||op.action==='store'){
      const member=bitfield??aggregates.accesses.get(op.id),owner=member?.initializer??((bitfield?.role==='write'?bitfield.owner??bitfield.node:bitfield?.node)??(op.action==='store'?nearest(op,n=>n.kind==='VarDecl'||mutation(n)):semanticNodes.get(op.semanticNodeId)??nearest(op,n=>n.kind==='ImplicitCastExpr'&&n.details.includes('<LValueToRValue>'))??node));
      put(op.kind,op.kind,role,owner,{cType:bitfield?.cType??op.cType??null,accessType:bitfield?`i${bitfield.cType.sizeBits}`:op.type,
        ...(bitfield?{storageAccessType:op.type,bitfield:binding.bitfield}:{}),expression:owner?tree(owner):null,
        ...(initializationFor(owner)?{initialization:initializationFor(owner)}:{}),
        ...(member?{memberPath:member.memberPath,targetPath:member.targetPath}: {})});
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
            ...(binding.sourceCondition?{sourceDestinations:{true:op.destinations[binding.sourceCondition.invert?1:0],false:op.destinations[binding.sourceCondition.invert?0:1]}}:{}),
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
  // Preserve AST operand types for folded literals and untyped PHI/select
  // values. Match the LLVM representation before adding source type metadata.
  for(const op of observations.instructions.filter(o=>o.kind==='CALC')){
    const b=plan.bindings[op.id],n=semanticExpression(op);if(!b||b.administrative||!n)continue;
    let operands=[];
    if(['BinaryOperator','CompoundAssignOperator'].includes(n.kind))operands=n.children;
    else if(n.kind==='UnaryOperator')operands=[n.children[0],n.children[0]];
    b.inputTypes=(op.inputs??[]).map((input,index)=>{
      const child=operands[index],cType=child&&types.spelling(child.type,child.canonical);
      const integer=/^i\d+$/.test(input.type)&&cType?.sizeBits===Number(input.type.slice(1))&&cType.signedness,
        floating=cType?.encoding==='DW_ATE_float'&&cType.sizeBits===({half:16,float:32,double:64,x86_fp80:80,fp128:128})[input.type],
        pointer=cType?.kind==='pointer'&&input.type.endsWith('*');
      return integer||floating||pointer?
        {nodeId:child.id,cType}:null;
    });
  }
  for(const {storeId,...site}of returnAnchors)(plan.bindings[storeId].returnSourceFor??=[]).push(site);
  // Constant operands can consume source calculations that Clang has already
  // folded. Define their CALCs now; runtime only supplies the observed result.
  function constantInputs(n){
    if(n.kind==='DeclRefExpr'){
      const declaration=byAST.get(/\bEnumConstant (0x[0-9a-f]+)/.exec(n.details)?.[1]),entry=types.enumConstant(declaration);
      if(entry)return [{nodeId:n.id,value:{literal:entry.value,decimal:entry.value,cType:types.spelling(n.type,n.canonical),enumConstant:entry,evidence:entry.evidence}}];
    }
    if(n.sizeofInfo)return [{nodeId:n.id,value:{type:`i${types.spelling(n.type,n.canonical)?.sizeBits??32}`,
      decimal:String(n.sizeofInfo.byteSize),unsigned:String(n.sizeofInfo.byteSize),cType:types.spelling(n.type,n.canonical),evidence:'compiler type size'},sizeof:n.sizeofInfo}];
    if(n.alignofInfo)return n.alignofInfo.byteAlignment?[{nodeId:n.id,value:{type:`i${types.spelling(n.type,n.canonical)?.sizeBits??32}`,
      decimal:String(n.alignofInfo.byteAlignment),unsigned:String(n.alignofInfo.byteAlignment),cType:types.spelling(n.type,n.canonical),evidence:n.alignofInfo.evidence},alignof:n.alignofInfo}]:null;
    if(selectedExpression(n))return constantInputs(selectedExpression(n));
    if(['IntegerLiteral','CharacterLiteral'].includes(n.kind)){
      const literal=/ (-?\d+)\s*$/.exec(n.details)?.[1];return literal===undefined?null:[{nodeId:n.id,value:{literal,decimal:literal,cType:types.spelling(n.type,n.canonical),evidence:'compiler AST literal'}}];
    }
    if(n.kind==='StringLiteral'){const expression=tree(n);return [{nodeId:n.id,value:{literal:expression.literal,
      ...(expression.literalTruncated?{literalTruncated:true}:{}),cType:expression.cType,evidence:'compiler AST literal'}}];}
    if(n.kind==='FloatingLiteral')return [{nodeId:n.id,value:{literal:/ ('[^']*'|[^\s]+)\s*$/.exec(n.details)?.[1],
      cType:types.spelling(n.type,n.canonical),evidence:'compiler AST literal'}}];
    if(n.builtin?.pure){
      const args=n.children.slice(1).map(constantInputs);if(!args.every(Boolean))return null;
      const category=/^__builtin_(?:nan|nans)(?:f|l)?$/.test(n.builtin.name)?'nan':/^__builtin_(?:inf|huge_val)(?:f|l)?$/.test(n.builtin.name)?'infinity':null;
      return category?[{nodeId:n.id,value:{category,cType:types.spelling(n.type,n.canonical),compilerBuiltin:n.builtin.name,
        evidence:'compiler constant semantics; bits unobserved'},inputs:args.flat()}]:args.flat();
    }
    if(n.pureCall)return n.children.slice(1).flatMap(arg=>constantInputs(arg)??[{nodeId:arg.id,
      value:{cType:types.spelling(arg.type,arg.canonical),evidence:'compiler-folded argument expression; no runtime read'},expression:tree(arg)}]);
    if(['ParenExpr','ImplicitCastExpr','CStyleCastExpr','UnaryOperator','BinaryOperator'].includes(n.kind)&&!mutation(n)){
      const parts=n.children.map(constantInputs);return parts.every(Boolean)?parts.flat():null;
    }
    return null;
  }
  const hasCalculation=n=>selectedExpression(n)?hasCalculation(selectedExpression(n)):!n.sizeofInfo&&!n.alignofInfo&&(n.builtin?.pure||n.pureCall||n.kind==='BinaryOperator'||
    ['CStyleCastExpr','ImplicitCastExpr'].includes(n.kind)&&/<(?:IntegralCast|FloatingToIntegral|IntegralToFloating|FloatingCast)>/.test(n.details)||
    n.kind==='UnaryOperator'&&['+','-','~','!'].includes(operator(n))||n.children.some(hasCalculation));
  const compilerScalar=input=>input&&(/^i\d+$/.test(input.type)?/^-?\d+$/.test(input.value)||['true','false'].includes(input.value):
    ['float','double'].includes(input.type)&&/^(?:0x[0-9A-Fa-f]+|[-+]?(?:\d|\.))/.test(input.value));
  function folded(op,expression,input,consumer){
    if(!expression||!compilerScalar(input)||!hasCalculation(expression))return;
    const inputs=constantInputs(expression),cType=types.spelling(expression.type,expression.canonical);if(!inputs||!cType||!(cType.signedness||cType.encoding==='DW_ATE_float'))return;
    // A real producer already bound to this AST expression wins.
    if(plan.instructions.some(i=>i.kind==='CALC'&&i.expression?.nodeId===expression.id&&i.observationIds?.length))return;
    const instruction=add(`${op.functionId}:CALC:folded:${expression.id}`,'CALC','expression',op,expression,
      {expression:tree(expression),operator:visibleOperator(expression),cType,grouping:'expression',evidence:'compiler-folded source calculation'});
    (plan.bindings[op.id].foldedCalculations??=[]).push({instructionId:instruction.id,nodeId:expression.id,inputs,consumer,cType});
    const pending=[expression];while(pending.length){const n=pending.pop();if(n.pureCall)boundNodes.add(n.id);pending.push(...n.children);}
  }
  for(const op of observations.instructions){
    if(op.action==='call'){
      const call=nearest(op,n=>n.kind==='CallExpr'),args=op.args.map((value,index)=>({value,index})).filter(a=>!a.value.sret);
      if(call&&args.length===call.children.length-1)args.forEach((a,index)=>folded(op,call.children[index+1],a.value,{kind:'argument',index:a.index,sourceIndex:index}));
    }else if(op.action==='store'){
      const owner=nearest(op,n=>n.kind==='VarDecl'||n.kind==='ReturnStmt'||n.kind==='BinaryOperator'&&operator(n)==='=');
      const expression=owner?.kind==='BinaryOperator'?owner.children[1]:owner?.children.at(-1);
      folded(op,expression,op.inputs[0],{kind:'value'});
    }else if(op.action==='function.return'){
      const owner=nearest(op,n=>n.kind==='ReturnStmt');folded(op,owner?.children[0],op.inputs[0],{kind:'value'});
    }
  }
  // A folded subexpression can be an immediate operand of a larger observed
  // CALC. Keep it inside that CALC, with the compiler-consumed value and AST
  // identity, rather than fabricating a runtime call or another calculation.
  const foldedOperands=[];
  for(const op of observations.instructions){const b=plan.bindings[op.id];
    for(const [index,spec]of (b?.inputTypes??[]).entries()){
      const input=op.inputs?.[index],node=semanticNodes.get(spec?.nodeId);
      if(!node||!compilerScalar(input))continue;
      const pending=[node],calls=[];while(pending.length){const n=pending.pop();if(n.kind==='CallExpr'){
        if(!n.pureCall||boundNodes.has(n.id)){calls.length=0;break;}calls.push(n);
      }pending.push(...n.children);}
      if(!calls.length)continue;
      spec.foldedExpression={nodeId:node.id,source:sourceMap.range(node.source),expression:tree(node),
        callNodeIds:calls.map(n=>n.id),evidence:'compiler literal operand for AST pure-call expression'};
      for(const n of calls)boundNodes.add(n.id);foldedOperands.push({observationId:op.id,inputIndex:index,nodeId:node.id,callNodeIds:calls.map(n=>n.id)});
    }
  }
  plan.coverage.foldedCalculations={defined:Object.values(plan.bindings).reduce((n,b)=>n+(b.foldedCalculations?.length??0),0),source:'AST expressions at literal LLVM consumers'};
  plan.coverage.foldedCalculations.operands=foldedOperands;
  const projections=Object.entries(plan.bindings).filter(([,b])=>b.callProjection);
  plan.coverage.callABI={source:'compiler AST and LLVM slots',mapped:projections.filter(([,b])=>b.callProjection.status==='mapped').length,
    unresolved:projections.filter(([,b])=>b.callProjection.status!=='mapped').map(([id,b])=>({observationId:id,reason:b.callProjection.reason}))};
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
  bindFunctionDeclarations(plan,{nodes,sourceMap});
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
      declare('WRITE','write',{expression:tree(n)});if(operator(n)!=='=')declare('CALC','calculate',{
        expression:tree(n),operator:visibleOperator(n),cType:types.spelling(n.type,n.canonical)});
    }else if(canCompose(n)&&expressionOwners.get(n)?.node===n&&expressionKinds.has(n.kind)&&n.children.length&&
      visibleOperator(n))declare('CALC','expression',{
        expression:tree(n),operator:visibleOperator(n),cType:types.spelling(n.type,n.canonical)});
  }
  // Source-less jumps feeding a logical PHI are internal expression edges.
  // Keep the source group open across them, just as across a short-circuit
  // decision. The consuming statement/next work still completes the group.
  const byInstruction=new Map(plan.instructions.map(d=>[d.id,d]));
  for(const op of observations.instructions.filter(o=>o.opcode==='phi')){
    const b=plan.bindings[op.id],d=byInstruction.get(b?.group);
    if(b?.evaluation?.role!=='result'||!d||!canCompose(localNodes.find(n=>n.id===d.sourceNodeId)))continue;
    for(const input of op.incoming??[])for(const edge of observations.instructions.filter(o=>o.functionId===op.functionId&&
      o.block===input.block&&o.action==='branch'&&o.destinations.length===1&&o.destinations[0]===op.block))
      plan.bindings[edge.id].continueExpressionNodeId=d.sourceNodeId;
  }
  bindGuardConditions(plan,observations,{nodes,nearest,types,sourceMap,tree,add});
  bindAssertions(plan,observations,{nodes,types,sourceMap,tree,add});
  buildControlFlow(plan,observations,{nodes,nearest,readSource:raw=>sourceMap.range(raw),filename});
  const evaluationResults=new Set(Object.values(plan.bindings).filter(b=>['result','selection','folded'].includes(b.evaluation?.role)).map(b=>b.evaluation.nodeId));
  const guardResults=n=>{if(n.operator)evaluationResults.add(n.nodeId);for(const c of n.children??[])guardResults(c);};
  for(const g of plan.conditionGuards)guardResults(g.tree);
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
  bindPresentationContract(plan,{nodes,types,sourceMap});
  bindResultDeliveries(plan,{nodes:localNodes});
  plan.sourceMap=sourceMap.report();
  plan.sourceMap.unmappedInstructions=plan.instructions.filter(i=>i.sourceStatus==='unmapped')
    .map(i=>({instructionId:i.id,sourceNodeId:i.sourceNodeId,reason:'compiler source range unavailable'}));
  bindConversionConsumers(plan,{nodes:localNodes,types,tree,declarationByAST});
  Object.assign(plan.coverage,resolvedCoverage(plan));
  return validateIRPlan(plan);
}
