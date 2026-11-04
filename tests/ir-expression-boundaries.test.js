import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  return {...r,defs:new Map(r.plan.instructions.map(d=>[d.id,d]))};
}

test('completed discarded logical expressions precede reads of the next statement, including on the same line',async()=>{
  const r=await inspect(`#include <stdio.h>
int fail(void){puts("unexpected");return 0;}
int main(void){int v=3; (v>0 || fail()); int a=v+1;
 (v<10 || fail());
 int b=v*2;
 printf("%d %d\\n",a,b);return 0;}`);
  assert.equal(r.stdout,'4 6\n');
  const events=r.trace.events,raw=new Map(r.observations.trace.events.map((e,i)=>[e.eventId,i]));
  const logical=events.filter(e=>e.kind==='CALC'&&e.operator==='||');assert.equal(logical.length,2);
  for(const calc of logical){
    assert.equal(calc.evaluation.right,'skipped');
    const last=Math.max(...calc.observationIds.map(id=>raw.get(id)));
    const next=events.find(e=>e.kind==='READ'&&e.activationId===calc.activationId&&e.observationIds.every(id=>raw.get(id)>last));
    assert.ok(next);assert.ok(events.indexOf(calc)<events.indexOf(next),'the completed condition must precede the next read');
  }
  assert.equal(events.filter(e=>e.kind==='FLOW'&&e.action==='call'&&e.callee==='@fail').length,0);
});

test('reads within a pure expression keep its arithmetic and short-circuit subcalculations in one CALC',async()=>{
  const r=await inspect(`#include <stdio.h>
int f(int a,int b,int c,int d){return (a+b)*(c+d)+(a>0 && c>0);}
int main(void){printf("%d\\n",f(2,3,4,5));return 0;}`);
  assert.equal(r.stdout,'46\n');
  const f=r.trace.frames.find(f=>f.functionName==='f'),calcs=r.trace.events.filter(e=>e.activationId===f.id&&e.kind==='CALC');
  assert.equal(calcs.length,1);assert.equal(calcs[0].operator,'+');assert.equal(calcs[0].value.decimal,'46');
});

test('a fault in the next expression does not fail the preceding completed calculation',async()=>{
  const r=await traceModel(`int fail(void){return 0;}
int main(void){int v=3;(v>0 || fail());return *(int *)0;}`);
  assert.equal(r.trace.status,'fault');
  const calc=r.trace.events.find(e=>e.kind==='CALC'&&e.operator==='||');
  assert.ok(calc);assert.equal(calc.phase,'complete');assert.equal(calc.value.decimal,'1');
  const fault=r.trace.events.find(e=>e.action==='fault');assert.ok(fault);
  assert.notEqual(fault.failedExecutionId,calc.eventId);
  const same=await traceModel('int main(void){int v=3;return (v+2)+*(int *)0;}');
  assert.equal(same.trace.status,'fault');
  const incomplete=same.trace.events.find(e=>e.kind==='CALC'&&e.operator==='+');
  assert.ok(incomplete);assert.equal(incomplete.phase,'failed');assert.equal(incomplete.value,undefined);
});
