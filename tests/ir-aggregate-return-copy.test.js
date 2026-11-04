import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.ok(r.trace.events.every(e=>['SPACE','READ','CALC','WRITE','FLOW'].includes(e.kind)));
  return {...r,events:r.trace.events,defs:new Map(r.plan.instructions.map(d=>[d.id,d]))};
}

test('record-return assignments into array elements keep one user call followed by each compiler copy',async()=>{
  const r=await inspect(`struct Pair{int first;int second;};
struct Pair pack(int x,int y){struct Pair value={x,y};return value;}
int main(void){struct Pair rows[2];
for(int slot=0;slot<2;slot++)rows[slot]=pack(slot+5,slot+11);
return rows[0].first+rows[1].second;}`,17);
  const rows=r.trace.objects.find(o=>o.name==='rows'),calls=r.events.filter(e=>e.action==='call'),
    copies=r.events.filter(e=>e.action==='copy'&&e.target?.objectId===rows.id);
  assert.deepEqual(calls.map(e=>[e.callee,e.backendCallee,e.arguments.length]),[['@pack','@pack',2],['@pack','@pack',2]]);
  assert.deepEqual(copies.map(e=>[e.target.offset,e.target.size]),[[0,8],[8,8]]);
  for(const [index,call]of calls.entries()){
    const returned=r.events.find(e=>e.action==='return.value'&&e.callExecutionId===call.eventId),
      resume=r.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId),copy=copies[index];
    assert.equal(returned.value.kind,'aggregate');assert.equal(resume.value.kind,'aggregate');
    assert.ok(r.events.indexOf(call)<r.events.indexOf(returned));
    assert.ok(r.events.indexOf(returned)<r.events.indexOf(resume));
    assert.ok(r.events.indexOf(resume)<r.events.indexOf(copy));
    assert.equal(copy.callExecutionId,null);
    assert.notEqual(r.defs.get(copy.instructionId).sourceNodeId,r.defs.get(call.instructionId).sourceNodeId);
  }
  const intrinsic=r.observations.plan.instructions.filter(o=>o.callee?.startsWith('@llvm.memcpy.'));
  assert.ok(intrinsic.length>0);
  for(const op of intrinsic){
    const binding=r.plan.bindings[op.id];assert.equal(binding.suppressCallBoundary,true);
    assert.equal(binding.roles['FLOW:call.begin'],undefined);assert.equal(binding.callProjection,undefined);
    assert.ok(binding.roles['WRITE:copy']);
  }
});

test('implicit member copies stay separate from explicit memcpy and nested pointer-return calls',async()=>{
  const r=await inspect(`#include <string.h>
struct Pair{int first;int second;};struct Holder{unsigned tag;struct Pair nested;};
struct Pair form(int x,int y){struct Pair value={x,y};return value;}
void *address(void *p){return p;}
int main(void){struct Holder holder;struct Pair result;
holder.nested=form(3,8);
memcpy(address(&result),&holder.nested,sizeof result);
return result.first+result.second;}`,11);
  const calls=r.events.filter(e=>e.action==='call');
  assert.deepEqual(calls.map(e=>e.callee),['@form','@address','@memcpy']);
  assert.deepEqual(calls.map(e=>e.arguments.length),[2,1,3]);
  const holder=r.trace.objects.find(o=>o.name==='holder'),result=r.trace.objects.find(o=>o.name==='result'),
    implicit=r.events.find(e=>e.action==='copy'&&e.target?.objectId===holder.id),
    explicit=r.events.find(e=>e.action==='copy'&&e.target?.objectId===result.id);
  assert.ok(implicit&&explicit);assert.equal(implicit.target.offset,4);assert.equal(implicit.target.size,8);
  assert.equal(implicit.callExecutionId,null);assert.equal(explicit.callExecutionId,calls[2].eventId);
  assert.ok(r.events.indexOf(implicit)<r.events.indexOf(calls[1]));
  assert.ok(r.events.indexOf(calls[1])<r.events.indexOf(calls[2]));
  assert.ok(r.events.indexOf(calls[2])<r.events.indexOf(explicit));
  const publicCall=r.defs.get(calls[2].instructionId);
  assert.equal(publicCall.callProjection.sourceArgumentCount,3);assert.match(publicCall.backendCallee,/^@llvm\.memcpy\./);
  const intrinsics=r.observations.plan.instructions.filter(o=>o.callee?.startsWith('@llvm.memcpy.'));
  assert.equal(intrinsics.filter(o=>r.plan.bindings[o.id].suppressCallBoundary).length,1);
  assert.equal(intrinsics.filter(o=>r.plan.bindings[o.id].callProjection).length,1);
});
