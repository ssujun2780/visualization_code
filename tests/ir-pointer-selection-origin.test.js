import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
async function inspect(source,exitCode){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.ok(r.trace.events.every(e=>['SPACE','READ','CALC','WRITE','FLOW'].includes(e.kind)));
  return {...r,objects:new Map(r.trace.objects.map(o=>[o.id,o])),defs:new Map(r.plan.instructions.map(d=>[d.id,d]))};
}

test('alternating pointer selections preserve selected allocation and one-past origin through stores and reads',async()=>{
  const r=await inspect(`int main(void){int short_row[3]={11,12,13},long_row[4]={21,22,23,24};int total=0;
for(int round=0;round<4;round++){
 int *cursor=(round&1)?long_row:short_row;
 int *end=(round&1)?long_row+4:short_row+3;
 int current=cursor[1];cursor[1]=current+1;total+=cursor[1];
 int present=end!=0;total+=present;
}
return total;}`,78);
  const targets=['short_row','long_row','short_row','long_row'].map(name=>r.trace.objects.find(o=>o.name===name&&o.storage==='automatic'));
  for(const [name,onePast] of [['cursor',false],['end',true]]){
    const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&r.objects.get(e.target?.objectId)?.name===name);
    assert.equal(writes.length,4);
    for(const [index,write] of writes.entries()){
      const expected=targets[index],offset=onePast?expected.size:0;
      const reads=r.trace.events.filter(e=>e.kind==='READ'&&e.target?.objectId===write.target.objectId);
      assert.ok(reads.length>0,`${name} must be read after selection`);
      for(const event of [write,...reads]){
        const reference=event.value.reference;
        assert.equal(reference.targetObjectId,expected.id,`${name} iteration ${index}: selected allocation`);
        assert.equal(reference.targetOffset,offset);
        assert.equal(reference.onePast,onePast);
        assert.equal(reference.dereferenceable,!onePast);
        assert.equal(BigInt(event.value.address),BigInt(expected.address+offset));
      }
    }
  }
  const targetIds=new Set(targets.map(o=>o.id));
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&targetIds.has(e.target?.objectId));
  assert.deepEqual(writes.map(e=>[r.objects.get(e.target.objectId).name,e.target.offset,e.value.decimal]),[
    ['short_row',4,'13'],['long_row',4,'23'],['short_row',4,'14'],['long_row',4,'24'],
  ]);
  const reads=r.trace.events.filter(e=>e.kind==='READ'&&targetIds.has(e.target?.objectId));
  assert.deepEqual(reads.map(e=>[r.objects.get(e.target.objectId).name,e.target.offset,e.value.decimal]),[
    ['short_row',4,'12'],['short_row',4,'13'],['long_row',4,'22'],['long_row',4,'23'],
    ['short_row',4,'13'],['short_row',4,'14'],['long_row',4,'23'],['long_row',4,'24'],
  ]);
  assert.ok([...reads,...writes].every(e=>e.target.offset+e.target.size<=r.objects.get(e.target.objectId).size));
});

test('a user function inside assert retains its observed callee and matching source call node',async()=>{
  const r=await inspect(`#include <assert.h>
struct Item{int size;};int visits=0;
int measure(const struct Item *p){visits++;return p->size;}
int main(void){struct Item item={6};assert(measure(&item)==6);return visits;}`,1);
  const calls=r.trace.events.filter(e=>e.kind==='FLOW'&&e.action==='call');
  assert.equal(calls.length,1);assert.equal(calls[0].callee,'@measure');
  assert.ok(!r.trace.events.some(e=>e.callee==='@__assert_fail'));
  const definition=r.defs.get(calls[0].instructionId);
  assert.equal(definition.callee,'@measure');assert.equal(definition.backendCallee,'@measure');
  assert.equal(definition.source.expression,'measure(&item)');
  const observedCall=r.observations.plan.instructions.find(o=>o.action==='call'&&o.callee==='@measure');
  assert.ok(observedCall);assert.equal(observedCall.semanticNodeId,definition.sourceNodeId);
  assert.ok(r.plan.sourceMap.macroExpansions.some(e=>e.nodeId===definition.sourceNodeId&&e.tokenRange));
  const callNode=r.plan.instructions.flatMap(d=>walk(d.expression)).find(n=>n.nodeId===definition.sourceNodeId);
  assert.ok(callNode);assert.equal(callNode.kind,'CallExpr');
  assert.ok(walk(callNode).some(n=>n.kind==='DeclRefExpr'&&n.referencedName==='measure'));
  assert.ok(calls[0].observationIds.some(id=>r.observations.trace.events.some(e=>e.eventId===id&&e.instructionId===observedCall.id)));
});
