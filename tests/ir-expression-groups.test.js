import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source);
  assert.equal(r.stdout,expected);assert.equal(r.stdout,plain.stdout);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));return {...r,defs};
}

test('mixed arithmetic and nested materialized logical results share the AST source group',async()=>{
  const r=await inspect(`#include <stdio.h>
int f(int *p,int x,int y){return (p && *p>x) + (x<y || y<0)*2;}
int main(void){int v=5;int a=f(&v,1,2);int b=f(0,3,2);printf("%d %d\\n",a,b);return 0;}`,'3 0\n');
  const frames=r.trace.frames.filter(f=>f.functionName==='f');
  for(const [index,f]of frames.entries()){
    const calcs=r.trace.events.filter(e=>e.activationId===f.id&&e.kind==='CALC');
    assert.equal(calcs.length,1,JSON.stringify(calcs.map(e=>({op:e.operator,source:r.defs.get(e.instructionId).source}))));
    assert.equal(calcs[0].operator,'+');assert.equal(calcs[0].value.decimal,index===0?'3':'0');
    assert.equal(calcs[0].nestedEvaluations.length,2);
  }
});

test('assignment and control consumers both keep one complete pure logical calculation',async()=>{
  const r=await inspect(`#include <stdio.h>
int f(int a,int b,int c){
 int q=(a+1>b*2)&&(c-1!=0);
 if((a+1>b*2)&&(c-1!=0))return q+2;
 return q;
}
int main(void){printf("%d %d %d\\n",f(4,1,3),f(0,2,3),f(4,1,1));return 0;}`,'3 0 0\n');
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='&&');
  assert.equal(logical.length,6);assert.ok(logical.every(e=>e.evaluation?.kind==='logical'));
  for(const f of r.trace.frames.filter(f=>f.functionName==='f')){
    const calculations=r.trace.events.filter(e=>e.kind==='CALC'&&e.activationId===f.id);
    assert.equal(calculations.filter(e=>e.operator==='&&').length,2);
    assert.equal(calculations.filter(e=>['>','!=','*'].includes(e.operator)).length,0);
  }
});

test('pointer-only loop conditions retain source truth and C int results',async()=>{
  const r=await inspect(`#include <stdio.h>
int main(void){int n=7;int *p=&n;int count=0;
 while(p){++count;p=0;}
 printf("%d\\n",count);return 0;}`,'1\n');
  const truth=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='truth');
  assert.deepEqual(truth.map(e=>e.value.decimal),['1','0']);
  assert.ok(truth.every(e=>r.defs.get(e.instructionId).source.expression==='p'&&e.value.cType.name==='int'));
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='icmp').length,0);
  const ids=new Set(truth.map(e=>e.eventId)),branches=r.trace.events.filter(e=>e.action==='branch'&&e.dataInputs.some(id=>ids.has(id)));
  assert.deepEqual(branches.map(e=>e.condition.decimal),['1','0']);assert.ok(branches.every(e=>e.condition.cType.name==='int'));
});
