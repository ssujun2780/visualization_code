import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {queueStructures} from '../scripts/inference/queue-views.mjs';
import {validateStructureOverlays} from '../scripts/inference/structure-overlay-contract.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);const before=JSON.stringify({events:r.trace.events,objects:r.trace.objects});
  const queues=queueStructures(r.plan,r.trace);assert.equal(JSON.stringify({events:r.trace.events,objects:r.trace.objects}),before);
  return {...r,queues};
}

test('independent cursors support postfix and separate updates with a nonzero index origin',async()=>{
  const r=await inspect(`#include <stdio.h>
int main(void){int slab[7];unsigned alpha=2,beta=2;
slab[beta++-2]=31;slab[beta-2]=47;beta+=1;int sum=0;
while(beta>alpha){int v=slab[alpha-2];alpha=alpha+1;sum+=v;}
printf("%d\\n",sum);return 0;}`,'78\n');
  assert.equal(r.queues.length,1);const q=r.queues[0];assert.equal(q.classification,'candidate');assert.equal(q.intent,'unconfirmed');
  assert.equal(q.roles.indexOffset,-2);assert.equal(q.operations.length,4);assert.ok(q.operations.every(o=>o.status==='supported'));
  assert.deepEqual(q.operations.filter(o=>o.kind==='enqueue').map(o=>o.index),[0,1]);
  assert.deepEqual(q.operations.filter(o=>o.kind==='dequeue').map(o=>o.index),[0,1]);
  assert.ok(q.states.some(s=>s.status==='intermediate'));assert.ok(q.states.some(s=>s.status==='supported'&&s.activeRange.start===0&&s.activeRange.end===2));
  assert.ok(q.states.some(s=>s.status==='supported'&&s.activeRange.start===2&&s.activeRange.end===2));assert.equal(q.states.at(-1).status,'ended');
  const accesses=q.operations.map(o=>r.trace.events.find(e=>e.eventId===o.accessExecutionId));
  assert.deepEqual(accesses.map(e=>e.value.decimal),['31','47','31','47']);
  const tampered=structuredClone(r.trace),fake=tampered.structures.find(s=>s.kind==='queue-candidate');
  assert.ok(fake);fake.roles.front.offset=99999;
  assert.throws(()=>validateStructureOverlays(tampered));
  // Drop a late cursor write from the saved observation, rather than executing
  // a new fixture with an invalid memory read. Its operation stays incomplete.
  const last=q.operations.at(-1),partial={...r.trace,events:r.trace.events.filter(e=>e.eventId!==last.updateExecutionId)};
  const [p]=queueStructures(r.plan,partial);assert.ok(p);assert.equal(p.operations.at(-1).status,'partial');
  assert.ok(p.states.some(s=>s.status==='intermediate'&&s.pendingAccessExecutionIds.includes(last.accessExecutionId)));
});

test('repeated invocations keep cursor and array lifetimes separate and retain invalid bounds',async()=>{
  const r=await inspect(`#include <stdio.h>
void visit(int seed){int store[4];int x=0,y=0;store[y++]=seed;
while(x!=y){printf("%d ",store[x++]);}y=9;}
int main(void){visit(13);visit(29);return 0;}`,'13 29 ');
  assert.equal(r.queues.length,2);assert.notEqual(r.queues[0].objectId,r.queues[1].objectId);
  assert.notEqual(r.queues[0].roles.front.objectId,r.queues[1].roles.front.objectId);
  for(const q of r.queues){assert.equal(q.operations.length,2);assert.ok(q.states.some(s=>s.status==='contradicted'&&s.back===9&&!s.activeRange.valid));
    assert.equal(q.states.at(-1).status,'ended');assert.ok(q.states.some(s=>s.status==='supported'&&s.front===1&&s.back===1));}
});

test('one-cursor stacks and two-cursor comparisons without endpoint progress are not FIFO evidence',async()=>{
  const r=await inspect(`#include <stdio.h>
int main(void){int stack[3];int pos=0;stack[pos++]=8;int value=stack[--pos];
int buffer[3]={2,4,6},a=0,b=2;if(a<b){buffer[b]=7;b=3;value+=buffer[a];a=1;}
printf("%d\\n",value);return 0;}`,'10\n');assert.deepEqual(r.queues,[]);
});
