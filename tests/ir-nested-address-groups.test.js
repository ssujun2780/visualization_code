import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source,{includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const order=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of r.trace.events)for(const key of ['dataInputs','addressInputs','controlInputs'])for(const id of e[key])
    assert.ok(order.get(id)<order.get(e.eventId),`${key} must not consume a future complete calculation`);
  return {...r,defs:new Map(r.plan.instructions.map(d=>[d.id,d]))};
}
test('array address calculations suspend the condition without publishing its left truth as a completed result',async()=>{
  const r=await inspect(`#include <stdio.h>
int probe(const int *r,unsigned n,int limit){if(n>0 && r[n-1]>limit)return 1;return 0;}
int main(void){int a[3]={5,1,7};int x=probe(a,3,6),y=probe(a,2,4),z=probe(a,0,4);printf("%d %d %d\\n",x,y,z);return 0;}`,'1 0 0\n');
  const frames=r.trace.frames.filter(f=>f.functionName==='probe');
  for(const [i,f]of frames.entries()){
    const events=r.trace.events.filter(e=>e.activationId===f.id),logical=events.filter(e=>e.kind==='CALC'&&e.operator==='&&');
    assert.equal(logical.length,1);assert.equal(logical[0].value.decimal,i===0?'1':'0');
    assert.equal(logical[0].evaluation.right,i===2?'skipped':'evaluated');
    assert.equal(events.filter(e=>e.kind==='CALC').flatMap(e=>e.steps??[]).filter(s=>s.operator==='-').length,i===2?0:1);
    assert.ok(events.filter(e=>e.kind==='READ').every(e=>events.indexOf(e)<events.indexOf(logical[0])));
  }
});
test('two levels of address arithmetic preserve one enclosing arithmetic expression and real read order',async()=>{
  const r=await inspect(`#include <stdio.h>
int pick(int *a,int *ix,int k,int n){return (n+2)*3+a[ix[k-1]+1]*2;}
int main(void){int a[4]={2,4,8,16},ix[2]={1,0};printf("%d\\n",pick(a,ix,1,1));return 0;}`,'25\n');
  const f=r.trace.frames.find(f=>f.functionName==='pick'),calcs=r.trace.events.filter(e=>e.activationId===f.id&&e.kind==='CALC');
  assert.equal(calcs.length,3);assert.deepEqual(calcs.map(e=>e.value.decimal),['0','2','25']);
  assert.deepEqual(calcs.at(-1).steps.map(s=>s.operator),['+','*','*','+']);
  assert.ok(calcs.every(e=>e.phase==='complete'));
});
test('a nested invalid address leaves the enclosing computation failed with no final value',async()=>{
  const r=await traceModel('int main(void){int a[1]={3},i=2;return (i+1)+a[i-1];}');
  assert.equal(r.trace.status,'fault');
  const parents=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='+');
  assert.equal(parents.length,1);assert.equal(parents[0].phase,'failed');assert.equal(parents[0].value,undefined);
  const index=r.trace.events.find(e=>e.kind==='CALC'&&e.operator==='-');assert.ok(index);assert.equal(index.phase,'complete');
});

test('control-only guards keep required index calculations before the element reads',async()=>{
  const r=await inspect(`#include <stdio.h>
int check(int *v,unsigned k,unsigned end){if(k+1<end && v[k+1]>v[k])return 1;return 0;}
int main(void){int v[3]={2,5,1};printf("%d %d\\n",check(v,0,3),check(v,2,3));return 0;}`,'1 0\n');
  for(const [index,f]of r.trace.frames.filter(f=>f.functionName==='check').entries()){
    const es=r.trace.events.filter(e=>e.activationId===f.id),calcs=es.filter(e=>e.kind==='CALC');
    assert.deepEqual(calcs.map(e=>e.operator),index?['&&']:['+','&&']);
    const whole=calcs.at(-1);assert.equal(whole.evaluation.right,index?'skipped':'evaluated');
    assert.deepEqual(whole.steps.map(s=>s.operator),index?['+','<','&&']:['+','<','>','&&']);
    if(!index){const read=es.find(e=>e.kind==='READ'&&e.addressInputs.includes(calcs[0].eventId));
      assert.ok(read);assert.ok(es.indexOf(calcs[0])<es.indexOf(read));assert.ok(es.indexOf(read)<es.indexOf(whole));}
  }
});
