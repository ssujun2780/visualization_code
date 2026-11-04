// Reconstruct condition completion from observed CFG edges, not C execution.
const transparent=n=>['ParenExpr','ImplicitCastExpr'].includes(n?.kind);
const unwrap=n=>{while(transparent(n))n=n.children[0];return n;};
const operator=n=>n?.kind==='BinaryOperator'?/ '(\&\&|\|\|)'\s*$/.exec(n.details)?.[1]:null;
const order=(a,b)=>a.line-b.line||a.column-b.column;
const inside=(r,p)=>r&&p&&order(r.start,p)<=0&&order(p,r.end)<=0;
const children=n=>[n,...n.children.flatMap(children)];
export function createAddressBoundaryTest(plan,nodes){
  const byNode=new Map(nodes.map(n=>[n.id,n])),groups=new Map(plan.instructions.map(d=>[d.id,byNode.get(d.sourceNodeId)]));
  return (binding,root)=>{
    let node=groups.get(binding?.group);
    while(node&&node!==root){
      if(['ArraySubscriptExpr','MemberExpr'].includes(node.kind)||node.kind==='UnaryOperator'&&/prefix '\*'/.test(node.details))return true;
      node=node.parent;
    }
    return false;
  };
}
export function bindGuardConditions(plan,observations,{nodes,nearest,types,sourceMap,tree,add}){
  const needsAddress=createAddressBoundaryTest(plan,nodes);
  const materialized=new Set(Object.values(plan.bindings).filter(b=>['result','folded'].includes(b.evaluation?.role)).map(b=>b.evaluation.nodeId)),
    producers=new Map(observations.instructions.filter(o=>o.result).map(o=>[`${o.functionId}:${o.result}`,o]));
  plan.conditionGuards=[];plan.conditionConsumers=[];
  for(const owner of nodes.filter(n=>['IfStmt','WhileStmt','DoStmt','ForStmt','ConditionalOperator'].includes(n.kind)&&n.source?.file==='/main.c')){
    const conditional=owner.kind==='ConditionalOperator';
    const condition={IfStmt:owner.children[0],WhileStmt:owner.children[0],DoStmt:owner.children.at(-1),ForStmt:owner.childSlots[2],ConditionalOperator:owner.children[0]}[owner.kind];
    let root=unwrap(condition),invert=false;
    while(root?.kind==='UnaryOperator'&&/prefix '!'/.test(root.details)){invert=!invert;root=unwrap(root.children[0]);}
    if(!operator(root)){
      // Conditional scalar truth already belongs to its observed selection
      // FLOW; only logical CFG conditions need completion reconstruction.
      if(conditional)continue;
      // A scalar used directly as a condition still has a source-level truth
      // test. C need not contain an explicit comparison AST node for it.
      if(invert)continue;
      const tests=observations.instructions.filter(o=>['icmp','fcmp'].includes(o.opcode)&&!o.cType&&
        ['ne','une'].includes(o.predicate)&&['null','0','0.000000e+00'].includes(o.inputs?.[1]?.value)&&
        (nearest(o,n=>n===root)||nearest(producers.get(`${o.functionId}:${o.inputs[0]?.value}`)??o,n=>n===root)));
      for(const o of tests){
        const b=plan.bindings[o.id];if(b.administrative)continue;
        const fields={operator:'truth',sourceNodeId:root.id,expression:tree(root),cType:types.spelling('int'),grouping:'expression',conditionTest:true},
          existing=plan.instructions.find(d=>d.id===b.roles.CALC&&d.kind==='CALC'&&!d.operator),
          calc=existing?Object.assign(existing,fields):add(`condition:truth:${root.id}`,'CALC','expression',o,root,fields);
        b.group=calc.id;b.roles.CALC=calc.id;b.expressionNodeId=root.id;b.sourceOperator='truth';
        b.sourceBoolean={invert:false,cType:types.spelling('int')};
        for(const consumer of observations.instructions.filter(c=>c.functionId===o.functionId&&c.action==='branch'&&c.inputs?.[0]?.value===o.result))
          plan.bindings[consumer.id].sourceCondition={invert:false,cType:types.spelling('int')};
      }
      continue;
    }
    plan.conditionConsumers.push({nodeId:root.id,consumerNodeId:owner.id,controlKind:owner.kind,invert,
      source:sourceMap.range(condition.source),materialized:materialized.has(root.id)});
    if(materialized.has(root.id))continue;
    const ops=observations.instructions.filter(o=>nearest(o,n=>n===root)),blocks=new Set(ops.map(o=>o.block)),
      branches=observations.instructions.filter(o=>o.action==='branch'&&o.inputs.length&&o.destinations.length===2&&
        (nearest(o,n=>n===root)||nearest(producers.get(`${o.functionId}:${o.inputs[0].value}`)??o,n=>n===root)));
    if(!branches.length)continue; // Existing folded-consumer handling remains separate.
    const shape=n=>{n=unwrap(n);return operator(n)?{nodeId:n.id,operator:operator(n),children:n.children.map(shape)}:
      {nodeId:n.id,...(n.kind==='IntegerLiteral'?{literalTruth:/ (-?\d+)\s*$/.exec(n.details)?.[1]!=='0'}:{})};};
    const pure=!children(root).some(n=>n.kind==='CallExpr'||n.kind==='CompoundAssignOperator'||
      n.kind==='BinaryOperator'&&/ '='\s*$/.test(n.details)||n.kind==='UnaryOperator'&&/'(?:\+\+|--)'/.test(n.details));
    const calc=plan.instructions.find(d=>d.kind==='CALC'&&d.sourceNodeId===root.id&&d.action==='expression')??
      add(`guard:calc:${root.id}`,'CALC','expression',branches[0],root,{operator:operator(root),expression:tree(root),
        cType:types.spelling('int'),grouping:'expression'});
    // Source-only declarations can predate the observed CFG binding. Complete
    // their semantic contract just as for a newly created guard definition.
    Object.assign(calc,{operator:operator(root),expression:tree(root),cType:types.spelling('int'),
      grouping:'expression',evaluationNodeId:root.id});
    const flow=add(`guard:flow:${root.id}`,'FLOW',conditional?'conditional':'branch',branches[0],owner,{source:sourceMap.range(condition.source,{text:true}),
      conditionSource:sourceMap.range(condition.source),statementSource:sourceMap.range(owner.source),controlKind:owner.kind,
      ...(conditional?{operator:'?:',evaluationNodeId:owner.id}:{}),
      destinations:[...new Set(branches.flatMap(o=>o.destinations.filter(d=>!blocks.has(d))))]});
    const spec={nodeId:root.id,consumerNodeId:owner.id,calcInstructionId:calc.id,flowInstructionId:flow.id,
      tree:shape(root),invert,pure,source:sourceMap.range(root.source),rightSource:sourceMap.range(root.children[1].source),cType:types.spelling('int'),blocks:[...blocks],
      ...(conditional?{conditionalNodeId:owner.id}:{})};
    plan.conditionGuards.push(spec);
    const leafAt=(n,p)=>{n=unwrap(n);if(!operator(n))return n;const child=n.children.find(c=>inside(c.source,p));return child?leafAt(child,p):null;};
    for(const o of branches){
      const p=producers.get(`${o.functionId}:${o.inputs[0]?.value}`),leaf=leafAt(root,p?.source??o.source),b=plan.bindings[o.id];
      if(!leaf)continue;
      b.guardDecision={nodeId:root.id,leafNodeId:leaf.id,completeTargets:o.destinations.filter(d=>!blocks.has(d))};
      b.evaluation={nodeId:root.id,role:'decision'};b.administrative=true;
      b.roles['CALC:guard']=calc.id;b.roles['FLOW:guard']=flow.id;
    }
    if(pure)for(const o of ops){
      const b=plan.bindings[o.id];if(o.kind!=='CALC'||b.administrative)continue;
      // An index/address expression must finish before its memory READ. It
      // already has an AST owner; a surrounding guard must not absorb it.
      if(needsAddress(b,root))continue;
      b.group=calc.id;b.guardGroup=root.id;
    }
  }
}

export function createGuardTracker(plan){
  const specs=new Map((plan.conditionGuards??[]).map(s=>[s.nodeId,s])),states=new Map();
  return {observe(e,b){
    if(e.action==='frame.end'){for(const k of states.keys())if(k.startsWith(`${e.activationId}:`))states.delete(k);}
    const decision=b?.guardDecision,spec=specs.get(decision?.nodeId);if(!spec||e.action!=='branch')return null;
    const key=`${e.activationId}:${spec.nodeId}`;let state=states.get(key);
    if(!state)states.set(key,state={values:new Map(),decisions:[],inputs:[]});
    state.values.set(decision.leafNodeId,BigInt(e.condition.bits)!==0n);state.decisions.push(e.eventId);state.inputs.push(...e.dataInputs??[]);
    if(!decision.completeTargets.includes(e.selected))return null;
    states.delete(key);const evaluations=[];
    function evaluate(n){
      if(!n.operator)return state.values.get(n.nodeId)??n.literalTruth??null;
      const left=evaluate(n.children[0]);if(left===null)return null;
      const skipped=n.operator==='&&'?!left:left,right=skipped?null:evaluate(n.children[1]);
      if(!skipped&&right===null)return null;
      const truth=skipped?left:right,reason=skipped?(n.operator==='&&'?'and-left-false':'or-left-true'):null;
      evaluations.push({nodeId:n.nodeId,kind:'logical',leftTruth:left,right:skipped?'skipped':'evaluated',reason,truth,
        decisionObservationIds:state.decisions.slice()});return truth;
    }
    const truth=evaluate(spec.tree);if(truth===null)return {spec,unresolved:true};
    const evaluation=evaluations.find(x=>x.nodeId===spec.nodeId),conditionTruth=spec.invert?!truth:truth;
    return {spec,truth,conditionTruth,evaluation,nestedEvaluations:evaluations.filter(x=>x!==evaluation),
      inputs:[...new Set(state.inputs)],decisions:state.decisions};
  }};
}
