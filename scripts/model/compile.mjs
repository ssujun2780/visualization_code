import {emitLLVM,macroTokenLocations} from '../instrumentation/toolchain.mjs';
import {instrumentLLVM} from './instrument.mjs';
import {astNodes} from './ast.mjs';
import {needsMacroLocations} from './macro-locations.mjs';
import {orderEvaluationLLVM,validateEvaluationOrderPlan} from './evaluation-order.mjs';

export function validateSource(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>512*1024||source.includes('\0'))
    throw new Error('소스는 NUL이 없는 512KiB 이하 문자열이어야 합니다.');
}

export async function prepareCModel(source,options={}){
  validateSource(source);
  const analysis=await emitLLVM(source);
  try{const parsedNodes=analysis.parsedNodes??astNodes(analysis.ast),macroTokens=needsMacroLocations(parsedNodes)?await macroTokenLocations(source):null,
      settings={...options,ast:analysis.ast,parsedNodes,macroTokens,recordLayouts:analysis.recordLayouts};
    let generated=instrumentLLVM(analysis.llvm,source,settings);
    const ordered=orderEvaluationLLVM(analysis.llvm,generated.observationPlan,parsedNodes,options);
    if(ordered.policy.transformations.length){
      analysis.compilerLLVM=analysis.llvm;analysis.llvm=ordered.llvm;
      generated=instrumentLLVM(analysis.llvm,source,settings);
    }
    generated.plan.evaluationOrder=ordered.policy;
    generated.plan.coverage.evaluationOrder={default:ordered.policy.default,enforcedAt:ordered.policy.enforcedAt,
      transformedExpressions:ordered.policy.transformations.length,sourceRewrites:0,
      preservedExpressions:ordered.policy.groups.filter(g=>g.status==='compiler-order-preserved').length};
    const groups=new Map(ordered.policy.groups.map(g=>[g.nodeId,g]));
    for(const i of generated.plan.instructions)if(i.action==='call'&&groups.has(i.sourceNodeId)){
      const g=groups.get(i.sourceNodeId);
      i.evaluationOrder={nodeId:i.sourceNodeId,order:g.effectiveOrder===undefined?g.order:g.effectiveOrder,
        preferredOrder:g.order,reason:g.reason,preservedBecause:g.preservedBecause??null};
    }
    validateEvaluationOrderPlan(generated.plan);
    return {analysis,generated};}
  catch(error){error.stage='ir-conversion';error.analysis=analysis;throw error;}
}

// This runs the compiler frontend, never the user's C program.
export async function compileCToIR(source,options={}){
  const {analysis,generated}=await prepareCModel(source,options);
  return {plan:generated.plan,ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,
    compilerDiagnostics:analysis.diagnostics,
    ...(options.includeObservations?{observations:{plan:generated.observationPlan}}:{})};
}
