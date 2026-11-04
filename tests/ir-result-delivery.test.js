import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {buildResultDeliveries,validateResultDeliveries,validateResultDeliveryPlan} from '../scripts/model/result-delivery.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
  const before=structuredClone(r.trace.events),deliveries=buildResultDeliveries(r.plan,r.trace);
  assert.deepEqual(r.trace.events,before,'delivery annotations must not mutate or reorder observed work');
  assert.deepEqual(r.trace.resultDeliveries,deliveries);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const d of deliveries){
    if(d.returnValueExecutionId){
      assert.equal(events.get(d.returnValueExecutionId).callExecutionId,d.callExecutionId);
      assert.equal(events.get(d.returnExecutionId).activationId,events.get(d.returnValueExecutionId).activationId);
      assert.ok(positions.get(d.returnValueExecutionId)<positions.get(d.returnExecutionId));
      assert.ok(positions.get(d.returnExecutionId)<positions.get(d.resumeExecutionId));
    }
    if(d.consumer){const consumer=events.get(d.consumer.executionId);
      assert.ok(positions.get(d.resumeExecutionId)<positions.get(consumer.eventId));
      assert.equal(d.consumer.availableAtExecutionId,consumer.eventId);
      assert.ok(d.consumer.inputIndices.every(i=>consumer.inputs[i].executionId===d.resumeExecutionId));
    }
  }
  return {...r,events,positions,deliveries};
}

test('returned values connect directly to assignment or calculation without changing work order',async()=>{
  const r=await inspect('int f(int x){return x+1;}int main(void){int total=f(1);total=f(2)*3;return total;}',9);
  assert.equal(r.deliveries.length,2);
  const [assignment,calculation]=r.deliveries;
  assert.equal(r.events.get(assignment.consumer.executionId).action,'write');
  assert.equal(r.events.get(calculation.consumer.executionId).kind,'CALC');
  assert.equal(r.events.get(calculation.consumer.executionId).operator,'*');
  assert.equal(assignment.consumer.target.objectId,r.events.get(assignment.consumer.executionId).target.objectId);
  for(const d of r.deliveries){
    assert.equal(d.status,'delivered');assert.equal(d.sourceExecutionId,d.returnValueExecutionId);
    assert.equal(r.events.get(d.sourceExpressionExecutionIds[0]).kind,'CALC');
    const between=r.trace.events.slice(r.positions.get(d.returnExecutionId)+1,r.positions.get(d.resumeExecutionId));
    assert.ok(between.some(e=>e.action==='frame.end'),'actual cleanup remains before resume');
  }
});

test('nested calls consume returned values in argument slots and passthrough returns',async()=>{
  const r=await inspect('int f(int x){return x+1;}int g(int x){return x*2;}int pass(void){return f(4);}int main(void){return g(f(2))+pass();}',11);
  const argument=r.deliveries.find(d=>d.consumer?.role==='argument'),returned=r.deliveries.find(d=>d.consumer?.role==='return-value');
  assert.ok(argument);assert.ok(returned);assert.deepEqual(argument.consumer.parameterIndices,[0]);
  assert.equal(r.events.get(argument.consumer.executionId).callee,'@g');
  assert.equal(r.events.get(returned.consumer.executionId).action,'return.value');
  const outer=r.deliveries.find(d=>d.returnValueExecutionId===returned.consumer.executionId);
  assert.ok(outer);assert.equal(r.events.get(outer.consumer.executionId).kind,'CALC');
  assert.notEqual(returned.callerActivationId,outer.callerActivationId);
});

test('repeated and recursive calls keep distinct observed delivery identities',async()=>{
  const r=await inspect('int count(int n){if(n)return count(n-1)+1;return 1;}int main(void){int total=0;for(int i=0;i<3;i++)total+=count(i);return total;}',6);
  assert.equal(r.deliveries.length,6);
  for(const field of ['id','callExecutionId','returnValueExecutionId','returnExecutionId','resumeExecutionId'])
    assert.equal(new Set(r.deliveries.map(d=>d[field])).size,6);
  assert.ok(r.deliveries.every(d=>d.status==='delivered'&&d.consumer.kind==='CALC'));
  for(const d of r.deliveries)assert.equal(d.consumer.activationId,d.callerActivationId);
});

test('discarded and void returns stay distinct and destinations wait for observed consumers',async()=>{
  const r=await inspect('int f(void){return 4;}void sink(void){}int main(void){f();(void)f();sink();int x=f();return x;}',4);
  assert.deepEqual(r.deliveries.map(d=>d.status),['discarded','discarded','void','delivered']);
  assert.ok(r.deliveries.slice(0,3).every(d=>d.consumer===null));
  const last=r.deliveries.at(-1),beforeResume=r.trace.events.slice(0,r.positions.get(last.resumeExecutionId));
  const waiting=buildResultDeliveries(r.plan,{events:beforeResume}).at(-1);assert.equal(waiting.status,'not-returned');assert.equal(waiting.consumer,null);
  assert.equal(waiting.returnValueExecutionId,last.returnValueExecutionId);assert.equal(waiting.sourceExecutionId,last.returnValueExecutionId);
  const resumed=buildResultDeliveries(r.plan,{events:r.trace.events.slice(0,r.positions.get(last.resumeExecutionId)+1)}).at(-1);
  assert.equal(resumed.status,'unresolved');assert.equal(resumed.consumer,null);
});

test('pointer addresses and aggregate ABI storage remain distinct from direct value operands',async()=>{
  const r=await inspect('int *ptr(int*p){return p;}int main(void){int n=2;*ptr(&n)=7;int b=*ptr(&n);int*q=ptr(&n);return b+*q;}',14);
  assert.deepEqual(r.deliveries.map(d=>d.status),['unresolved','unresolved','delivered']);
  for(const d of r.deliveries.slice(0,2)){
    assert.equal(d.consumer,null);assert.ok(d.addressUses.length);
    assert.ok(d.addressUses.every(use=>use.role==='address'&&r.events.get(use.executionId).addressInputs.includes(d.resumeExecutionId)));
  }
  const stored=r.deliveries[2];assert.equal(stored.consumer.action,'write');assert.equal(stored.consumer.role,'value');
  assert.equal(r.events.get(stored.consumer.executionId).inputs[0].executionId,stored.resumeExecutionId);
  const aggregate=await inspect('typedef struct{int n;int*p;} Box;Box make(int*p){Box b={7,p};return b;}int main(void){int n=3;Box b=make(&n);return b.n+*b.p;}',10),
    delivery=aggregate.deliveries[0],returned=aggregate.events.get(delivery.returnValueExecutionId);
  assert.equal(returned.value.kind,'aggregate');assert.ok(returned.memoryState);
  assert.equal(delivery.sourceExecutionId,returned.eventId);assert.equal(delivery.status,'storage-delivered');assert.equal(delivery.consumer,null);
  const storage=delivery.storageDelivery;
  assert.equal(storage.target.objectId,returned.sourceObjectId);assert.equal(storage.target.address,returned.sourceAddress);
  assert.equal(storage.snapshotExecutionId,returned.eventId);assert.equal(storage.availableAtExecutionId,returned.eventId);
  assert.ok(storage.writtenByExecutionIds.length);
  for(const id of storage.writtenByExecutionIds){
    const write=aggregate.events.get(id);assert.equal(write.kind,'WRITE');assert.equal(write.target.objectId,storage.target.objectId);
    assert.ok(aggregate.positions.get(id)<aggregate.positions.get(returned.eventId));
  }
  const noEvidence=structuredClone(aggregate.trace);delete noEvidence.events.find(e=>e.eventId===delivery.callExecutionId).backendArguments;
  const unresolved=buildResultDeliveries(aggregate.plan,noEvidence)[0];assert.equal(unresolved.status,'unresolved');assert.equal(unresolved.storageDelivery,null);
  assert.match(unresolved.reason,/address was not observed/);
});

test('compile-only candidates remain separate from runtime destinations and forged links are rejected',async()=>{
  const source='int f(void){return 2;}int main(void){int x=f();return x;}';
  const compiled=await compileCToIR(source);assert.equal(compiled.trace,undefined);assert.equal(compiled.plan.resultDeliveries.length,1);
  const site=compiled.plan.resultDeliveries[0];assert.equal(site.status,'candidate');assert.equal(site.consumer.role,'value');assert.ok(!site.consumer.target);
  const badPlan=structuredClone(compiled.plan);badPlan.resultDeliveries[0].consumer.instructionIds=['missing'];
  assert.throws(()=>validateResultDeliveryPlan(badPlan),/정적 소비 명령/);
  const r=await inspect(source,2);
  for(const mutate of [
    d=>{d.consumer.executionId=d.returnValueExecutionId;},
    d=>{d.consumer.availableAtExecutionId=d.resumeExecutionId;},
    d=>{d.consumer.target.objectId='invented';},
    d=>{d.sourceExpressionExecutionIds=['invented'];},
    d=>{d.status='discarded';d.consumer=null;}
  ]){const trace=structuredClone(r.trace);mutate(trace.resultDeliveries[0]);assert.throws(()=>validateResultDeliveries(r.plan,trace),/반환 전달/);}
  const missing=structuredClone(r.trace);delete missing.resultDeliveries;assert.throws(()=>validateResultDeliveries(r.plan,missing),/연결 목록/);
});
