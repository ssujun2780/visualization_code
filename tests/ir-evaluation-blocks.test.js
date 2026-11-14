import assert from 'node:assert/strict';
import {test} from 'node:test';
import {orderEvaluationLLVM} from '../scripts/model/evaluation-order.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {getToolchain,execute,file} from '../scripts/instrumentation/toolchain.mjs';

async function assemble(llvm){
  const tools=await getToolchain(),result=await execute(tools.clang,['clang','-cc1','-triple','wasm32-unknown-wasi','-x','ir','-emit-obj','-o','/check.o','/check.ll'],
    {...tools.fs,'/check.ll':file('/check.ll',llvm)});
  assert.equal(result.exitCode,0,result.stderr);
}

test('shared numeric slots retain unnamed entry, arguments, named blocks and implicit dead PHI predecessors',async()=>{
  const children=['callee','left','right'].map(id=>({id,kind:'DeclRefExpr',details:'',children:[],depth:1,functionName:'probe'})),
    root={id:'call',kind:'CallExpr',details:'',children,depth:0,functionName:'probe',source:{file:'/main.c'}};
  for(const c of children)c.parent=root;
  const observations={functions:[{id:'fn',name:'probe'}],instructions:[
    {functionId:'fn',backendInstruction:'%3 = add i32 %0, 10',semanticNodeId:'right',action:'calculate'},
    {functionId:'fn',backendInstruction:'%4 = add i32 %0, 20',semanticNodeId:'left',action:'calculate'},
  ]};
  const llvm=`define i32 @probe(i32, i1) "unchanged"="%3" {
  %3 = add i32 %0, 10
  %4 = add i32 %0, 20
  br i1 %1, label %named, label %5
  ; Anonymous branch target takes slot 5 in the bundled LLVM format.
  %6 = add i32 %3, %4
  ret i32 %6
named:
  ret i32 %4
  ; Anonymous unreachable block takes slot 7, even with no printed label.
  br label %join
join:
  %8 = phi i32 [ %3, %7 ]
  ret i32 %8
}`;
  await assemble(llvm);
  const result=orderEvaluationLLVM(llvm,observations,[root,...children]);
  assert.equal(result.policy.transformations.length,1);
  assert.ok(result.llvm.indexOf('%__cvm_evaluation_4 =')<result.llvm.indexOf('%__cvm_evaluation_3 ='));
  for(const n of [2,5,7])assert.ok(result.llvm.includes(`\n__cvm_evaluation_${n}:`));
  assert.ok(result.llvm.includes('[ %__cvm_evaluation_3, %__cvm_evaluation_7 ]'));
  assert.ok(result.llvm.includes('"unchanged"="%3"'));
  await assemble(result.llvm);
  // A function which needs no reordering must retain its original text.
  assert.equal(orderEvaluationLLVM(llvm,observations,[root,...children],{evaluationOrder:'right-to-left'}).llvm,llvm);
});

for(const [name,guard]of [['assert','assert(cells[1]==7);'],['noreturn expression','int ok=cells[1]==7 || (abort(),0); (void)ok;']]){
  test(`${name}: reordering beside unnamed unreachable blocks keeps values and actual calls`,async()=>{
    const source=`#include <stdio.h>
#include <stdlib.h>
#include <assert.h>
int order,cells[2];
int slot(void){order=order*10+1;return 1;}
int value(void){order=order*10+2;return 7;}
int main(void){cells[slot()]=value();${guard}printf("%d %d\\n",order,cells[1]);return 0;}`;
    for(const [evaluationOrder,expected,calls]of [['left-to-right','12 7\n',['@slot','@value']],['right-to-left','21 7\n',['@value','@slot']]]){
      const r=await traceModel(source,{evaluationOrder,includeObservations:true});
      assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,expected);
      assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
      assert.deepEqual(r.trace.events.filter(e=>e.action==='call'&&calls.includes(e.callee)).map(e=>e.callee),calls);
      assert.deepEqual(r.observations.trace.events.filter(e=>e.action==='call.begin'&&calls.includes(e.callee)).map(e=>e.callee),calls);
      if(evaluationOrder==='left-to-right')assert.ok(r.plan.evaluationOrder.transformations.length);
    }
  });
}
