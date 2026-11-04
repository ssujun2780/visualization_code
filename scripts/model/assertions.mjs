// Standard-header assertion plumbing is evidence, not a user logical OR.
// Recognition uses compiler spelling/expansion locations and a noreturn callee.
import {createAddressBoundaryTest} from './guard-conditions.mjs';
const operator=n=>n?.kind==='BinaryOperator'?/ '([^']+)'\s*$/.exec(n.details)?.[1]:null;
const descend=n=>n?[n,...n.children.flatMap(descend)]:[];
const header=n=>/^\/sys\/(?:[^/]+\/)*include\/assert\.h$/.test(n?.spellingRange?.start.file??'');
const unwrap=n=>{while(['ParenExpr','ImplicitCastExpr'].includes(n?.kind)&&n.children.length===1)n=n.children[0];return n;};

export function bindAssertions(plan,observations,{nodes,types,sourceMap,tree,add}){
  const byAST=new Map(nodes.map(n=>[n.astId,n])),byId=new Map(nodes.map(n=>[n.id,n])),
    producers=new Map(observations.instructions.filter(o=>o.result).map(o=>[`${o.functionId}:${o.result}`,o])),
    definitions=new Map(plan.instructions.map(d=>[d.id,d])),internal=new Set(),addressBoundary=createAddressBoundaryTest(plan,nodes);
  plan.assertions=[];
  for(const wrapper of nodes.filter(n=>operator(n)==='||'&&header(n)&&n.expansionSource)){
    const failure=descend(wrapper.children[1]).find(n=>n.kind==='CallExpr'&&descend(n.children[0]).some(c=>{
      const declaration=byAST.get(/\bFunction (0x[0-9a-f]+)/.exec(c.details)?.[1]);
      return header(declaration)&&declaration.children.some(a=>/NoReturnAttr$/.test(a.kind));
    }));
    if(!failure)continue;
    const condition=unwrap(wrapper.children[0]),conditionNodes=new Set(descend(wrapper.children[0]).map(n=>n.id)),
      conditionSource=sourceMap.range(condition.source,{text:true}),statementSource=sourceMap.range(wrapper.expansionSource,{text:true}),
      provenance={header:wrapper.spellingRange.start.file,wrapperNodeId:wrapper.id,failureNodeId:failure.id,
        evidence:'compiler standard-header spelling + macro expansion + noreturn declaration'};
    const spec={nodeId:wrapper.id,conditionNodeId:condition.id,source:statementSource,conditionSource,
      checkInstructionIds:[],failureInstructionIds:[],implementationObservationIds:[],provenance};
    plan.assertions.push(spec);
    const hide=(op,b)=>{b.administrative=true;b.roles={};b.group=null;b.failedInstructionId=null;
      b.assertionImplementation=provenance;spec.implementationObservationIds.push(op.id);};
    for(const op of observations.instructions){
      const b=plan.bindings[op.id];if(!b)continue;
      if(b.evaluation?.nodeId===wrapper.id){
        const role=b.evaluation.role;delete b.evaluation;
        if(role==='decision'&&op.action==='branch'){
          const invert=b.sourceCondition?.invert??false;
          const definition=add(`assert:check:${wrapper.id}:${op.id}`,'FLOW','assert.check',op,condition,
            {source:conditionSource,statementSource,conditionSource,controlKind:'assert',destinations:op.destinations,
              sourceDestinations:{true:op.destinations[invert?1:0],false:op.destinations[invert?0:1]},assertion:provenance});
          b.administrative=false;b.roles.FLOW=definition.id;b.failedInstructionId=definition.id;
          b.sourceCondition={invert,cType:types.spelling('int')};
          b.assertionCheck={nodeId:wrapper.id,conditionNodeId:condition.id};
          spec.checkInstructionIds.push(definition.id);
        }else if(role==='truth-test'){
          const definition=add(`assert:truth:${wrapper.id}:${op.id}`,'CALC','expression',op,condition,
            {source:conditionSource,expression:tree(condition),operator:'truth',cType:types.spelling('int'),
              grouping:'expression',conditionTest:true,assertion:provenance});
          b.administrative=false;b.roles.CALC=definition.id;b.group=definition.id;b.failedInstructionId=definition.id;
          b.expressionNodeId=condition.id;b.sourceOperator='truth';b.sourceBoolean={invert:false,cType:types.spelling('int')};
        }else hide(op,b);
      }
      // Preserve source condition work with its argument range, rather than
      // displaying the header's parenthesis as the whole macro invocation.
      for(const id of Object.values(b.roles)){
        const d=definitions.get(id),n=byId.get(d?.sourceNodeId);
        if(d&&['CALC','READ'].includes(d.kind)&&conditionNodes.has(n?.id)&&header(n)){
          d.source=conditionSource;if(d.kind==='CALC')d.expression=tree(condition);
        }
      }
      if(op.semanticNodeId===failure.id||b.callInstructionId&&definitions.get(b.callInstructionId)?.sourceNodeId===failure.id){
        const d=definitions.get(b.callInstructionId);if(d){d.assertion={...provenance,role:'failure',conditionSource};spec.failureInstructionIds.push(d.id);}
      }
    }
    let logical=condition,invert=false;
    while(logical?.kind==='UnaryOperator'&&/prefix '!'/.test(logical.details)){invert=!invert;logical=unwrap(logical.children[0]);}
    if(['&&','||'].includes(operator(logical))){
      const branches=observations.instructions.filter(o=>o.action==='branch'&&o.inputs?.length&&
        conditionNodes.has(plan.bindings[o.id]?.evaluation?.nodeId)),blocks=new Set(branches.map(o=>o.block));
      const leaves=[];
      const shape=n=>{n=unwrap(n);if(['&&','||'].includes(operator(n)))return {nodeId:n.id,operator:operator(n),children:n.children.map(shape)};
        leaves.push(n);return {nodeId:n.id,...(n.kind==='IntegerLiteral'?{literalTruth:/ (-?\d+)\s*$/.exec(n.details)?.[1]!=='0'}:{})};};
      const conditionTree=shape(logical),leafIds=new Map(leaves.flatMap(n=>descend(n).map(c=>[c.id,n.id])));
      const leafFor=o=>{const seen=new Set();let p=producers.get(`${o.functionId}:${o.inputs[0].value}`);
        while(p&&!seen.has(p.id)){seen.add(p.id);const node=unwrap(byId.get(p.semanticNodeId)),leaf=leafIds.get(node?.id);
          if(leaf)return leaf;
          p=producers.get(`${o.functionId}:${p.inputs?.[0]?.value}`);}return null;};
      if(branches.length&&branches.every(leafFor)){
        const calc=plan.instructions.find(d=>d.kind==='CALC'&&d.expression?.nodeId===condition.id&&d.grouping==='expression')??
          add(`assert:logical:${wrapper.id}`,'CALC','expression',branches[0],condition,{source:conditionSource,
            expression:tree(condition),operator:condition===logical?operator(condition):'!',cType:types.spelling('int'),grouping:'expression'});
        calc.evaluationNodeId=logical.id;
        const flow=add(`assert:check:${wrapper.id}`,'FLOW','assert.check',branches[0],condition,{source:conditionSource,
          statementSource,conditionSource,controlKind:'assert',assertion:provenance});
        const pure=!descend(condition).some(n=>n.kind==='CallExpr'||n.kind==='CompoundAssignOperator'||
          operator(n)==='='||n.kind==='UnaryOperator'&&/'(?:\+\+|--)'/.test(n.details));
        plan.conditionGuards.push({nodeId:logical.id,consumerNodeId:wrapper.id,calcInstructionId:calc.id,flowInstructionId:flow.id,
          tree:conditionTree,invert,pure,resultIsCondition:true,source:conditionSource,rightSource:sourceMap.range(logical.children[1].source),
          cType:types.spelling('int'),blocks:[...blocks],assertion:{nodeId:wrapper.id,conditionNodeId:condition.id}});
        spec.checkInstructionIds.push(flow.id);
        for(const o of branches){const b=plan.bindings[o.id];b.guardDecision={nodeId:logical.id,leafNodeId:leafFor(o),
          completeTargets:o.destinations.filter(d=>!blocks.has(d))};b.administrative=true;
          b.evaluation={nodeId:logical.id,role:'decision'};b.roles['CALC:guard']=calc.id;b.roles['FLOW:guard']=flow.id;}
        for(const o of observations.instructions){const b=plan.bindings[o.id];
          if(conditionNodes.has(b?.evaluation?.nodeId)&&['result','folded'].includes(b.evaluation.role)){
            delete b.evaluation;hide(o,b);
          }else if(pure&&o.kind==='CALC'&&!b?.administrative&&conditionNodes.has(b?.expressionNodeId)){
            if(addressBoundary(b,condition))continue;
            b.group=calc.id;b.guardGroup=logical.id;
          }
        }
      }
    }
    internal.add(wrapper.id);
  }
  if(!internal.size)return;
  // Definitions without public bindings can still appear for folded source
  // work. Header-only calculations do not belong to that public inventory.
  const used=new Set(Object.values(plan.bindings).flatMap(b=>Object.values(b.roles)));
  plan.instructions=plan.instructions.filter(d=>!(d.kind==='CALC'&&!used.has(d.id)&&internal.has(d.expression?.nodeId??d.sourceNodeId)));
  plan.evaluations=plan.evaluations.filter(e=>!internal.has(e.nodeId));
  plan.coverage.assertions={recognized:plan.assertions.length,unbound:plan.assertions.filter(s=>!s.checkInstructionIds.length)
    .map(s=>({nodeId:s.nodeId,source:s.source,reason:'assertion condition edge not observed in compiler IR'}))};
}

export function assertionObservation(e,b){
  if(!b?.assertionCheck||e.action!=='branch')return e;
  const passed=BigInt(e.condition.bits)!==0n;
  return {...e,assertion:{...b.assertionCheck,result:passed?'passed':'failed'},selectedOutcome:passed?'passed':'failed'};
}
