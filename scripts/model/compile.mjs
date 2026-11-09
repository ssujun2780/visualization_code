import {emitLLVM,macroTokenLocations} from '../instrumentation/toolchain.mjs';
import {instrumentLLVM} from './instrument.mjs';
import {astNodes} from './ast.mjs';
import {needsMacroLocations} from './macro-locations.mjs';

export function validateSource(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>512*1024||source.includes('\0'))
    throw new Error('소스는 NUL이 없는 512KiB 이하 문자열이어야 합니다.');
}

export async function prepareCModel(source,options={}){
  validateSource(source);
  const analysis=await emitLLVM(source);
  try{const parsedNodes=analysis.parsedNodes??astNodes(analysis.ast),macroTokens=needsMacroLocations(parsedNodes)?await macroTokenLocations(source):null;
    return {analysis,generated:instrumentLLVM(analysis.llvm,source,{...options,ast:analysis.ast,parsedNodes,macroTokens,recordLayouts:analysis.recordLayouts})};}
  catch(error){error.stage='ir-conversion';error.analysis=analysis;throw error;}
}

// This runs the compiler frontend, never the user's C program.
export async function compileCToIR(source,options={}){
  const {analysis,generated}=await prepareCModel(source,options);
  return {plan:generated.plan,ast:analysis.ast,llvm:analysis.llvm,instrumentedLLVM:generated.llvm,
    compilerDiagnostics:analysis.diagnostics,
    ...(options.includeObservations?{observations:{plan:generated.observationPlan}}:{})};
}
