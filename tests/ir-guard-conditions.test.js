import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const ids=new Set(r.plan.conditionConsumers.map(g=>g.nodeId)),defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  return {...r,guards:r.trace.events.filter(e=>e.kind==='CALC'&&ids.has(e.evaluation?.nodeId)),
    branches:r.trace.events.filter(e=>e.action==='branch'&&[e.evaluation,...e.inputEvaluations??[]].some(x=>ids.has(x?.nodeId))),defs};
}
test('control-only nested logic retains observed truth, skipped operands and final source branches',async()=>{
  const r=await inspect(`#include <stdio.h>
int f(int a,int b,int c){if((a&&b)||c)return 1;return 0;}
int main(void){int x=f(0,1,1);int y=f(1,0,0);int z=f(1,1,0);printf("%d %d %d\\n",x,y,z);return 0;}`,'1 0 1\n');
  assert.deepEqual(r.guards.map(e=>e.value.decimal),['1','0','1']);assert.equal(r.branches.length,3);
  assert.equal(r.guards[0].nestedEvaluations[0].right,'skipped');assert.equal(r.guards[0].evaluation.right,'evaluated');
  assert.equal(r.guards[2].evaluation.right,'skipped');assert.equal(r.guards[2].helpMarker.status,'stub');
  assert.deepEqual(r.branches.map(e=>e.selectedOutcome),['true','false','true']);
});
test('side effects and calls execute once while a skipped right operand stays skipped',async()=>{
  const r=await inspect(`#include <stdio.h>
int hit(int *c){++*c;return 1;}
int main(void){int count=0,total=0;for(int i=0;i<2;i++){int n=i;if(n++&&hit(&count))total+=n;}
 printf("%d %d\\n",total,count);return 0;}`,'2 1\n');
  assert.deepEqual(r.guards.map(e=>e.evaluation.right),['skipped','evaluated']);
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@hit').length,1);
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='++'&&r.defs.get(e.instructionId).source?.expression==='n++').length,2);
});
test('while, do and for guards keep iteration-specific decisions and nested logical evaluation',async()=>{
  const r=await inspect(`#include <stdio.h>
int main(void){int a=2,b=3,k=0;while(a>0&&b>0){--a;--b;++k;}
 do{++a;--b;}while(a<2&&b>0);
 for(int i=0;i<2&&(a>0||b>0);i++)k++;
 printf("%d %d %d\\n",k,a,b);return 0;}`,'4 1 0\n');
  assert.equal(r.guards.length,7);assert.equal(r.branches.length,7);
  assert.deepEqual(r.plan.coverage.expressionEvaluations.unbound,[]);
});
test('negated consumers and recursive condition activations retain separate actual outcomes',async()=>{
  const r=await inspect(`#include <stdio.h>
int f(int n){if(n==0)return 1;if(n>0&&f(n-1))return 1;return 0;}
int main(void){int a=1,b=0,x=0;if(!(a&&b))x=3;printf("%d %d\\n",x,f(2));return 0;}`,'3 1\n');
  const outer=r.guards.find(e=>e.activationId==='f1'),branch=r.branches.find(e=>e.activationId==='f1');
  assert.equal(outer.value.decimal,'0');assert.equal(branch.condition.decimal,'1');
  assert.equal(new Set(r.guards.filter(e=>e.activationId!=='f1').map(e=>e.activationId)).size,2);
});

test('overlapping NULL macro ranges bind each pointer leaf and emit its source branch',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stddef.h>
int missing(const int *p,const int *q){if(p==NULL||q==NULL)return 1;return 0;}
int main(void){int a=2,b=3;printf("%d %d %d %d\\n",missing(&a,&b),missing(NULL,&b),missing(&a,NULL),missing(NULL,NULL));return 0;}`,'0 1 1 1\n');
  assert.deepEqual(r.guards.map(e=>e.value.decimal),['0','1','1','1']);
  assert.deepEqual(r.guards.map(e=>e.evaluation.right),['evaluated','skipped','evaluated','skipped']);
  assert.deepEqual(r.branches.map(e=>e.selectedOutcome),['false','true','true','true']);
  for(const e of r.branches)assert.equal(r.trace.events.find(x=>x.eventId===e.dataInputs[0]).kind,'CALC');
});

test('numeric conditions retain one source calculation and consume observed truth in FLOW',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdint.h>
int masked(uint64_t mask,int shift){if(mask & (UINT64_C(1)<<shift))return 1;return 0;}
int number(int a,int b){if(a+b)return 1;return 0;}
int real(double a,double b){if(a*b)return 1;return 0;}
int main(void){printf("%d %d %d %d %d %d\\n",masked(8,3),masked(8,2),number(3,-1),number(3,-3),real(2,3),real(2,0));return 0;}`,'1 0 1 0 1 0\n');
  for(const [name,values]of [['masked',['8','0']],['number',['2','0']],['real',null]]){
    const frames=r.trace.frames.filter(f=>f.functionName===name);
    for(const [index,frame]of frames.entries()){
      const work=r.trace.events.filter(e=>e.activationId===frame.id),calcs=work.filter(e=>e.kind==='CALC');
      assert.equal(calcs.length,1);assert.notEqual(calcs[0].operator,'truth');
      if(values)assert.equal(calcs[0].value.decimal,values[index]);
      const branch=work.find(e=>e.action==='branch');assert.ok(branch.dataInputs.includes(calcs[0].eventId));
      assert.ok(work.indexOf(calcs[0])<work.indexOf(branch));assert.equal(branch.condition.decimal,index?'0':'1');
    }
  }
});
