import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

test('same-width member conversion preserves scalar READ to cast to WRITE and separate address reads',async()=>{
  // Keep the original one-line main: source line/column proximity cannot select
  // the pointer READ as the owner of the scalar field's unsigned-to-int cast.
  const source=`#include <stdlib.h>
typedef struct {unsigned tag,previous;} Entry;
typedef struct {unsigned cap;Entry*data;unsigned count;} Store;
void put(Store*s,Entry x){if(s->count==s->cap)return;s->data[s->count]=x;s->count++;}
int main(void){Store s={7,malloc(7*sizeof(Entry)),0};put(&s,(Entry){5,~0u});put(&s,(Entry){6,0});put(&s,(Entry){7,1});Entry temporary=s.data[2];temporary.previous=0;unsigned k=2;k=s.data[k].previous;k=s.data[k].previous;int result=s.data[k].tag;s.data[1].previous=99;free(s.data);return result!=5;}`;
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,'');
  assert.deepEqual(r.trace.diagnostics,[]);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const defs=new Map(r.plan.instructions.map(i=>[i.id,i])),events=new Map(r.trace.events.map(e=>[e.eventId,e])),
    text=e=>defs.get(e.instructionId)?.source?.expression;
  const field=r.trace.events.find(e=>e.kind==='READ'&&text(e)==='s.data[k].tag'),
    cast=r.trace.events.find(e=>e.kind==='CALC'&&text(e)==='s.data[k].tag'),
    write=r.trace.events.find(e=>e.kind==='WRITE'&&text(e)==='int result=s.data[k].tag');
  assert.ok(field);assert.ok(cast);assert.ok(write);
  assert.equal(cast.operator,'cast');assert.equal(cast.steps.length,1);
  assert.equal(cast.steps[0].conversion.sameWidth,true);assert.equal(cast.steps[0].conversion.bitsUnchanged,true);
  assert.deepEqual([field.value.cType.signedness,cast.value.cType.signedness,write.value.cType.signedness],['unsigned','signed','signed']);
  assert.deepEqual([field.value.decimal,cast.value.decimal,write.value.decimal],['5','5','5']);
  assert.deepEqual(cast.dataInputs,[field.eventId]);assert.deepEqual(write.dataInputs,[cast.eventId]);
  assert.equal(cast.inputs[0].executionId,field.eventId);assert.equal(write.inputs[0].executionId,cast.eventId);
  const addressReads=field.addressInputs.map(id=>events.get(id));
  assert.deepEqual(addressReads.map(e=>[e.kind,text(e)]),[['READ','s.data'],['READ','k']]);
  assert.ok(addressReads[0].value.type.endsWith('*'));assert.equal(addressReads[1].value.decimal,'0');
  assert.deepEqual(cast.addressInputs,[]);
  const at=r.trace.events.indexOf(field);
  assert.deepEqual(r.trace.events.slice(at-2,at+3).map(e=>e.eventId),[...field.addressInputs,field.eventId,cast.eventId,write.eventId]);
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&text(e)==='s.data').length,0);
  const rawCast=r.observations.plan.instructions.find(o=>o.opcode==='c.integral-cast');
  assert.equal(rawCast.semanticNodeId,cast.steps[0].nodeId);
  assert.equal(r.plan.bindings[rawCast.id].expressionNodeId,rawCast.semanticNodeId);
  const rawLoad=r.observations.plan.instructions.find(o=>o.opcode==='load'&&o.result===rawCast.inputs[0].value&&o.functionId===rawCast.functionId);
  assert.ok(rawLoad);assert.notEqual(rawLoad.semanticNodeId,rawCast.semanticNodeId);
  assert.equal(rawLoad.type,'i32');assert.equal(rawLoad.result,rawCast.result);
});
