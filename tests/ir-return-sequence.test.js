import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateReturnSequence} from '../scripts/model/return-sequence.mjs';
async function inspect(source,exitCode=0){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.events.map(e=>e.eventId),r.trace.events.map((_,i)=>`x${i+1}`));
  const valueOrder=r.trace.events.filter(e=>e.action!=='frame.end').map(e=>e.recordedOrder);
  assert.deepEqual(valueOrder,[...valueOrder].sort((a,b)=>a-b),'only field cleanup may move');
  return {...r,positions:new Map(r.trace.events.map((e,i)=>[e.eventId,i])),byId:new Map(r.trace.events.map(e=>[e.eventId,e]))};
}
test('direct scalar delivery names the receiver in FLOW/return and orders WRITE before frame.end',async()=>{
  const r=await inspect('int add(int x,int y){return x+y;}int main(void){int a=10;int b=20;int c=add(a,b);return 0;}'),
    returned=r.trace.events.find(e=>e.action==='return'&&e.callExecutionId),link=returned.delivery,
    receiver=r.byId.get(link.completionExecutionId),end=r.byId.get(link.frameEndExecutionId),
    object=r.trace.objects.find(o=>o.name==='c'),raw=r.observations.trace.events;
  assert.equal(receiver.action,'write');assert.equal(receiver.value.decimal,'30');assert.equal(receiver.target.objectId,object.id);
  assert.equal(link.receivers[0].target.objectId,object.id);assert.equal(link.receivers[0].executionId,receiver.eventId);
  assert.deepEqual(r.trace.events.slice(r.positions.get(returned.eventId),r.positions.get(end.eventId)+1).map(e=>e.action),['return','resume','write','frame.end']);
  assert.ok(raw.findIndex(e=>end.observationIds.includes(e.eventId))<raw.findIndex(e=>receiver.observationIds.includes(e.eventId)));
  for(const id of end.endedObjects){const o=r.trace.objects.find(o=>o.id===id);assert.equal(o.endedBy,end.eventId);
    assert.ok(raw.some(e=>e.eventId===o.runtimeLifetime.endedAtObservationId));}
  assert.equal(r.trace.events.length,27,'no duplicated WRITE or added animation event');
});
test('nested arguments, combined expressions and recursive passthroughs receive values before their source fields end',async()=>{
  const r=await inspect('int inc(int n){return n+1;}int walk(int n){if(!n)return 1;return walk(n-1)+n;}int main(void){int a=inc(inc(2));int b=inc(3)+inc(4);int c=walk(2);return a+b+c;}',17),
    transfers=r.trace.events.filter(e=>e.action==='return'&&e.delivery?.completionExecutionId).map(e=>e.delivery);
  assert.ok(transfers.some(t=>t.receivers.some(x=>x.action==='argument')));
  assert.ok(transfers.some(t=>t.receivers.some(x=>x.action==='return.value')));
  assert.equal(new Set(transfers.map(t=>t.frameEndExecutionId)).size,transfers.length);
  for(const t of transfers)assert.ok(r.positions.get(t.completionExecutionId)<r.positions.get(t.frameEndExecutionId));
  const combined=r.trace.objects.find(o=>o.name==='b'),write=r.trace.events.find(e=>e.action==='write'&&e.target?.objectId===combined.id);
  assert.equal(transfers.filter(t=>t.completionExecutionId===write.eventId).length,2);
});
test('void, discarded, conditional and address consumers use their actual kind rather than inventing assignments',async()=>{
  const r=await inspect('int f(void){return 2;}void done(void){}int *ptr(int*p){return p;}int main(void){f();done();int n=0;if(f())n=1;*ptr(&n)=3;return n;}',3),
    transfers=r.trace.events.filter(e=>e.delivery).map(e=>e.delivery);
  for(const t of transfers.filter(t=>['void','discarded'].includes(t.status))){assert.deepEqual(t.receivers,[]);assert.equal(t.completionExecutionId,null);
    assert.equal(r.byId.get(t.frameEndExecutionId).cleanupAfterExecutionId,undefined);}
  assert.ok(transfers.some(t=>t.receivers.some(x=>['branch','conditional'].includes(x.action))));
  assert.ok(transfers.some(t=>t.receivers.some(x=>x.action==='write'&&r.byId.get(x.executionId).value.decimal==='3')));
});
test('aggregate copy receivers finish before cleanup without adding a second memory copy',async()=>{
  const r=await inspect('struct P{int a,b;};struct P make(int n){struct P p={n,n+1};return p;}int main(void){struct P v[2];v[0]=make(4);v[1]=make(7);return v[0].a+v[1].b;}',12),
    copies=r.trace.events.filter(e=>e.action==='copy'&&r.trace.objects.find(o=>o.id===e.target?.objectId)?.name==='v');
  assert.equal(copies.length,2);
  for(const copy of copies){const returned=r.trace.events.find(e=>e.delivery?.completionExecutionId===copy.eventId);
    assert.ok(returned,'recorded aggregate copy is the receiver');assert.ok(r.positions.get(copy.eventId)<r.positions.get(returned.delivery.frameEndExecutionId));}
});
test('metadata cannot hide an early cleanup or forge a destination',async()=>{
  const r=await inspect('int f(void){return 5;}int main(void){int k=f();return k;}',5);
  for(const edit of [
    t=>{const e=t.events.find(e=>e.delivery);e.delivery.receivers[0].target.objectId='invented';},
    t=>{const e=t.events.find(e=>e.delivery),end=t.events.findIndex(x=>x.eventId===e.delivery.frameEndExecutionId),
      at=t.events.findIndex(x=>x.eventId===e.delivery.completionExecutionId);const [cleanup]=t.events.splice(end,1);t.events.splice(at,0,cleanup);}
  ]){const trace=structuredClone(r.trace);edit(trace);assert.throws(()=>validateReturnSequence(trace,r.plan),/반환|정리/);}
});
