// Presentation describes existing source work; it never evaluates C or removes events.
export function presentationContract(){
  return {version:1,recording:'detailed',animation:'stub',
    defaults:{mode:'detailed',logicalExplanation:'both-operands'},
    compact:{scope:'presentation-only',mayShorten:['travel','operand-transfer','calculation-steps','loop-transitions','technical-detail'],
      preserve:['source-position','value-changes','reference-changes','object-lifetime','faults'],discardRecordedWork:false},
    rules:{blueprints:'static-type-description-without-storage',
      assignment:'visit-target-read-calculate-write',targetAvailability:'observed-address-only',compoundUpdate:'update-at-target-after-operands-are-observed',
      initialization:'create-at-declaration-before-initializer',returnDelivery:'direct-to-observed-next-consumer',
      order:'preserve-observed-value-work; deliver-return-before-frame-cleanup',
      returnCleanup:'after-recorded-receiver; raw-lifetimes-retained',
      skippedOperand:'explanation-only-never-execute',previewEvaluation:'not-implemented'}};
}

const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const singleValue=n=>{
  n=unwrap(n);return !!n&&(['DeclRefExpr','IntegerLiteral','FloatingLiteral','CharacterLiteral','StringLiteral','GNUNullExpr',
    'MemberExpr','ArraySubscriptExpr'].includes(n.kind)||n.kind==='UnaryOperator'&&n.operator==='*');
};

export function bindPresentationContract(plan,{nodes,types,sourceMap}){
  plan.presentation=presentationContract();
  // AST identity, not the record's spelling, identifies each blueprint. No
  // allocation, size/layout guess, or synthetic execution is introduced.
  plan.typeBlueprints=nodes.filter(n=>n.kind==='RecordDecl'&&n.source?.file==='/main.c'&&n.children.some(c=>c.kind==='FieldDecl')).map(n=>({
    nodeId:n.id,kind:'record-blueprint',phase:'compile-time',allocatesStorage:false,
    recordKind:/\bunion\b/.test(n.details)?'union':'struct',
    name:/\b(?:struct|union)\s+(\S+)\s+definition\b/.exec(n.details)?.[1]??null,
    source:sourceMap.range(n.source),fields:n.children.filter(c=>c.kind==='FieldDecl').map(c=>({
      nodeId:c.id,name:/\s([^\s']+)\s+'/.exec(c.details)?.[1]??null,
      type:c.type??null,cType:types.spelling(c.type,c.canonical),source:sourceMap.range(c.source)})),evidence:'compiler AST record definition'}));
  plan.compoundUpdates=plan.instructions.filter(i=>i.kind==='CALC'&&unwrap(i.expression)?.kind==='CompoundAssignOperator').map(i=>{
    const expression=unwrap(i.expression);return {calculationInstructionId:i.id,expressionNodeId:expression.nodeId,operator:expression.operator,
      targetNodeId:expression.children[0].nodeId,rightNodeId:expression.children[1].nodeId,
      rightForm:singleValue(expression.children[1])?'single-value':'expression',
      preserves:['operand-reads','C-conversions','calculation','write','side-effects'],evidence:'compiler AST compound assignment'};
  });
}

// A read-only descriptor for the future renderer. In particular, a skipped
// operand never supplies an invented green/red result or a new READ/CALC.
export function describeLogicalWork(plan,event,{mode=plan.presentation?.defaults.mode??'detailed'}={}){
  if(!['detailed','compact'].includes(mode))throw new Error('Unknown logical presentation mode');
  const specs=new Map((plan.evaluations??[]).map(e=>[e.nodeId,e])),seen=new Set(),result=[];
  for(const e of [event.evaluation,...event.nestedEvaluations??[]]){
    if(e?.kind!=='logical'||seen.has(e.nodeId))continue;seen.add(e.nodeId);
    const spec=specs.get(e.nodeId);if(!spec)continue;
    const truth=e.truth??(event.evaluation===e&&event.value?.decimal!=null?event.value.decimal!=='0':null);
    const right={nodeId:spec.right.nodeId,source:spec.right.source,evaluation:e.right,
      truth:e.right==='evaluated'&&typeof e.leftTruth==='boolean'&&typeof truth==='boolean'?truth:null,
      explanationOnly:e.right==='skipped',...(e.right==='skipped'?{reason:e.reason,preview:{status:'not-evaluated'}}:{})};
    result.push({evaluationNodeId:e.nodeId,operator:spec.operator,source:spec.source,
      operands:[{nodeId:spec.left.nodeId,source:spec.left.source,evaluation:'evaluated',truth:e.leftTruth??null,explanationOnly:false},
        ...(mode==='compact'&&e.right==='skipped'?[]:[right])],recordedExecutionId:event.eventId});
  }
  return result;
}

export function validatePresentationContract(plan){
  if(!plan.presentation)return;
  const p=plan.presentation;
  if(p.recording!=='detailed'||p.animation!=='stub'||p.defaults?.mode!=='detailed'||p.defaults.logicalExplanation!=='both-operands'||
    p.compact?.scope!=='presentation-only'||p.compact.discardRecordedWork!==false||p.rules?.skippedOperand!=='explanation-only-never-execute')
    throw new Error('시각화 정책은 실제 중간언어 작업을 생략하거나 실행을 추가할 수 없습니다.');
  const ids=new Set();for(const b of plan.typeBlueprints??[]){
    if(ids.has(b.nodeId)||b.phase!=='compile-time'||b.allocatesStorage!==false||!Array.isArray(b.fields))throw new Error('자료형 설계도는 저장 공간이 아닙니다.');
    ids.add(b.nodeId);
  }
  const definitions=new Map(plan.instructions.map(i=>[i.id,i]));
  for(const u of plan.compoundUpdates??[]){const d=definitions.get(u.calculationInstructionId),n=unwrap(d?.expression);
    if(d?.kind!=='CALC'||n?.kind!=='CompoundAssignOperator'||n.nodeId!==u.expressionNodeId||n.operator!==u.operator||
      n.children[0]?.nodeId!==u.targetNodeId||n.children[1]?.nodeId!==u.rightNodeId||
      u.rightForm!==(singleValue(n.children[1])?'single-value':'expression'))throw new Error('복합 대입의 계산과 대상 연결이 다릅니다.');
  }
}
