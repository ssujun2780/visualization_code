import {cResult} from './evaluation.mjs';
import {materializeMemory} from './memory-state.mjs';

const sameType=(a,b)=>!!a&&!!b&&a.sizeBits===b.sizeBits&&a.signedness===b.signedness&&a.encoding===b.encoding;
const constantTree=n=>!!n&&!n.evaluationState&&(!!n.sizeof||!!n.alignof||!!n.enumConstant||
  ['IntegerLiteral','CharacterLiteral','FloatingLiteral'].includes(n.kind)||
  ['ParenExpr','ImplicitCastExpr','CStyleCastExpr','UnaryOperator','BinaryOperator'].includes(n.kind)&&
  !['++','--','=',',','&&','||'].includes(n.operator)&&(n.children?.length??0)>0&&n.children.every(constantTree));
const walk=(n,visit)=>{if(!n)return;visit(n);for(const c of n.children??[])walk(c,visit);};
const unwrap=n=>n?.kind==='ParenExpr'?unwrap(n.children[0]):n;

// Link compiler conversion nodes to existing source consumers. This creates no
// execution, evaluates no C expression, and does not expand aggregate ASTs in IR.
export function bindConversionConsumers(plan,{nodes,types,tree,declarationByAST}){
  const conversions=plan.coverage.cConversions;if(!conversions)return;
  const original=conversions.initiallyUnobserved??conversions.unobserved??[],issues=new Map(original.map(c=>[c.nodeId,c])),
    ast=new Map(nodes.map(n=>[n.id,n])),instructions=new Map(plan.instructions.map(i=>[i.id,i])),bound=new Set();
  for(const b of Object.values(plan.bindings))for(const id of [b.group,...Object.values(b.roles??{})].filter(Boolean))bound.add(id);
  function add(instructionId,root,consumer,observationId=null,requirements=[]){
    const instruction=instructions.get(instructionId),selectionOnly=consumer.kind==='conditional-selection';
    if(!instruction||!['CALC','WRITE'].includes(instruction.kind)||!root||!selectionOnly&&!constantTree(root))return;
    walk(root,n=>{
      const issue=issues.get(n.nodeId);if(!issue||!['ImplicitCastExpr','CStyleCastExpr'].includes(n.kind)||
        !sameType(n.cType,issue.toType)||!sameType(n.children?.[0]?.cType,issue.fromType))return;
      const spec={nodeId:n.nodeId,fromType:issue.fromType,toType:issue.toType,source:n.source,
        compilerEvidence:'compiler AST conversion within a bound source consumer',
        consumer:{...consumer,nodeId:root.nodeId,cType:root.cType},requirements,
        direct:!selectionOnly&&unwrap(root)?.nodeId===n.nodeId,...(observationId?{observationId}:{})};
      const list=instruction.conversionConsumers??=[];
      if(!list.some(s=>s.nodeId===spec.nodeId&&JSON.stringify(s.consumer)===JSON.stringify(spec.consumer)))list.push(spec);
    });
  }
  for(const [observationId,b]of Object.entries(plan.bindings)){
    for(const [inputIndex,input]of (b.inputTypes??[]).entries())if(input?.nodeId)
      add(b.group??b.roles?.CALC,tree(ast.get(input.nodeId)),{kind:'input',inputIndex},observationId);
    for(const f of b.foldedCalculations??[])add(f.instructionId,tree(ast.get(f.nodeId)),{kind:'value'},observationId);
  }
  function scalar(instructionId,n,requirements=[]){
    if(!n||n.executionState)return;
    if(n.kind==='ParenExpr')return scalar(instructionId,n.children[0],requirements);
    if(n.kind==='ConditionalOperator'){
      for(const [index,selected]of [[1,'true'],[2,'false']])
        scalar(instructionId,n.children[index],[...requirements,{nodeId:n.id,selected}]);
      return;
    }
    const root=tree(n);
    add(instructionId,root,{kind:requirements.length&&!constantTree(root)?'conditional-selection':'value'},null,requirements);
  }
  // Clang's semantic InitListExpr children and the compiler array element size
  // supply each byte range, including nested arrays. Unknown layouts fail closed.
  function array(instructionId,n,cType,offsetBytes,declarationId,arrayPath=[]){
    if(n?.kind!=='InitListExpr'||cType?.kind!=='array'||!Number.isSafeInteger(cType.count)||
      n.children.length>cType.count||!Number.isSafeInteger(cType.elementType?.sizeBits/8))return;
    const elementType=cType.elementType,elementBytes=elementType.sizeBits/8;if(elementBytes<=0)return;
    n.children.forEach((child,index)=>{
      const childType=types.spelling(child.type,child.canonical),byteOffset=offsetBytes+index*elementBytes,path=[...arrayPath,index];
      if(childType?.sizeBits!==elementType.sizeBits)return;
      if(elementType.kind==='array')array(instructionId,child,elementType,byteOffset,declarationId,path);
      else if(elementType.signedness&&sameType(childType,elementType))
        add(instructionId,tree(child),{kind:'initializer-bytes',declarationId,byteOffset,byteLength:elementBytes,arrayPath:path});
    });
  }
  for(const i of plan.instructions){
    if(i.kind!=='WRITE'||!bound.has(i.id))continue;
    const n=ast.get(i.sourceNodeId);if(!n)continue;
    const expression=n.kind==='VarDecl'?n.children.at(-1):n.kind==='BinaryOperator'&&/ '='\s*$/.test(n.details)?n.children[1]:n;
    if(['write','return.value'].includes(i.action))scalar(i.id,expression);
    if(n.kind==='VarDecl'&&['copy','fill','write.range'].includes(i.action))
      array(i.id,expression,types.spelling(n.type,n.canonical),0,declarationByAST.get(n.astId));
  }
}

const evaluations=e=>[e.evaluation,...e.inputEvaluations??[],...e.nestedEvaluations??[]].filter(Boolean);
function selection(spec,event){
  for(const requirement of spec.requirements??[]){
    const evidence=evaluations(event).find(e=>e.nodeId===requirement.nodeId);
    if(!evidence?.selected)return 'unknown';
    if(evidence.selected!==requirement.selected)return 'not-executed';
  }
  return 'selected';
}
function bytesValue(spec,event,memoryFor){
  const c=spec.consumer,t=event.target,s=event.memoryState;
  if(!t||!s||!Number.isSafeInteger(t.offset)||!Number.isSafeInteger(t.size)||s.byteLength!==t.size||
    !Number.isSafeInteger(c.byteLength)||c.byteLength<=0||c.byteLength*8!==c.cType?.sizeBits)return null;
  const start=c.byteOffset-t.offset,end=start+c.byteLength;if(start<0||end>t.size)return null;
  const memory=memoryFor();if(!memory)return null;
  if(!memory.known.subarray(start,end).every(Boolean)||!memory.initialization.subarray(start,end).every(v=>v===1))return null;
  const bytesHex=Buffer.from(memory.bytes.subarray(start,end)).toString('hex'),bits=`0x${Buffer.from(memory.bytes.subarray(start,end)).reverse().toString('hex')}`;
  return cResult({bits,bytesHex,byteLength:c.byteLength,evidence:'observed initializer memory bytes'},c.cType);
}

// A folded conversion's intermediate result stays unobserved. Only a conversion
// whose result is the consumer value itself receives conversionValue.
export function conversionConsumerEvidence(instruction,event){
  let memory;
  const memoryFor=()=>{if(memory!==undefined)return memory;
    try{memory=materializeMemory(event.memoryState);}catch{memory=null;}return memory;};
  return (instruction?.conversionConsumers??[]).map(spec=>{
    const selected=selection(spec,event),base={nodeId:spec.nodeId,fromType:spec.fromType,toType:spec.toType,
      compilerEvidence:spec.compilerEvidence,consumer:spec.consumer,requirements:spec.requirements,
      instructionId:instruction.id,executionId:event.eventId,...(spec.observationId?{observationId:spec.observationId}:{})};
    if(selected==='not-executed')return {...base,status:'not-executed',reason:'observed conditional selected the other branch'};
    if(selected==='unknown'||event.phase!=='complete')return {...base,status:'unobserved',reason:'source consumer evaluation is not observed'};
    if(spec.consumer.kind==='conditional-selection')return {...base,status:'unobserved',reason:'branch selection alone does not observe the conversion value'};
    const c=spec.consumer,input=c.kind==='input'?[...event.inputs??[],...(event.steps??[]).flatMap(s=>s.inputs??[])].find(i=>i.nodeId===c.nodeId):null,
      value=c.kind==='initializer-bytes'?bytesValue(spec,event,memoryFor):c.kind==='input'?input?.value:event.value;
    if(!value?.bits||!sameType(value.cType,c.cType))return {...base,status:'unobserved',reason:'typed consumer value or initialized byte range is not observed'};
    const direct=spec.direct&&sameType(value.cType,spec.toType);
    return {...base,status:'observed-consumer',consumerValue:value,
      conversionValueStatus:direct?'observed-at-consumer':'compiler-folded-unobserved',...(direct?{conversionValue:value}:{})};
  });
}

export function attachConversionConsumers(plan,events){
  const instructions=new Map(plan.instructions.map(i=>[i.id,i]));
  for(const event of events){
    const evidence=conversionConsumerEvidence(instructions.get(event.instructionId),event);
    if(evidence.length)event.conversionConsumers=evidence;
  }
}

export function validateConversionConsumers(plan,events){
  const conversions=plan.coverage?.cConversions,issues=new Map((conversions?.initiallyUnobserved??conversions?.unobserved??[]).map(c=>[c.nodeId,c])),
    instructions=new Map(plan.instructions.map(i=>[i.id,i])),declarations=new Map((plan.declarations??[]).map(d=>[d.id,d])),
    evaluationsById=new Map((plan.evaluations??[]).map(e=>[e.nodeId,e]));
  for(const i of instructions.values())for(const spec of i.conversionConsumers??[]){
    const issue=issues.get(spec.nodeId),c=spec.consumer;
    if(!['CALC','WRITE'].includes(i.kind)||!issue||!sameType(issue.fromType,spec.fromType)||!sameType(issue.toType,spec.toType)||
      !['input','value','initializer-bytes','conditional-selection'].includes(c?.kind)||!c.nodeId||!c.cType?.sizeBits||
      (spec.requirements??[]).some(r=>evaluationsById.get(r.nodeId)?.kind!=='conditional'||!['true','false'].includes(r.selected)))
      throw new Error('변환과 원래 소비 명령의 연결이 올바르지 않습니다.');
    if(c.kind==='initializer-bytes'){
      let type=declarations.get(c.declarationId)?.cType,offset=0;
      for(const index of c.arrayPath??[]){
        if(type?.kind!=='array'||!Number.isSafeInteger(index)||index<0||index>=type.count){type=null;break;}
        type=type.elementType;offset+=index*type.sizeBits/8;
      }
      if(!c.arrayPath?.length||!sameType(type,c.cType)||c.byteLength!==type.sizeBits/8||c.byteOffset!==offset)
        throw new Error('배열 초기화 변환의 바이트 범위가 컴파일된 배열 배치와 다릅니다.');
    }
  }
  for(const event of events??[]){
    const instruction=instructions.get(event.instructionId),expected=conversionConsumerEvidence(instruction,event);
    if(JSON.stringify(event.conversionConsumers??[])!==JSON.stringify(expected))
      throw new Error('변환의 실제 소비값 또는 미실행 근거가 실행 기록과 다릅니다.');
  }
}
