import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateCalcTrace} from '../scripts/model/calc-contract.mjs';

test('call arguments keep one observed address while preserving index causes and actual READ/CALC/return producers',async()=>{
  const r=await traceModel(`struct Row{int cells[3];};
int take(const int *p,int q){return p[0]+q;}
const int *identity(const int *p){return p;}
int main(void){struct Row rows[2]={{{2,3,5}},{{7,11,13}}};int index=1;int *saved=rows[0].cells;
int a=take(rows[index].cells,3);
int b=take(saved,4);
int c=take(saved+1,5);
int d=take(identity(saved),6);
return a+b+c+d;}`,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,32);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);validateCalcTrace(r.plan,r.trace);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),raw=new Map(r.observations.trace.events.map(e=>[e.eventId,e])),
    ops=new Map(r.observations.plan.instructions.map(o=>[o.id,o])),objects=new Map(r.trace.objects.map(o=>[o.id,o])),
    calls=r.trace.events.filter(e=>e.action==='call'&&e.callee==='@take');
  assert.equal(calls.length,4);
  for(const call of calls){
    assert.equal(call.arguments.length,2);assert.equal(call.inputs.length,2);
    assert.deepEqual(call.inputs.map(i=>i.parameterIndex),[0,1]);
    assert.equal(call.inputs[0].value.address,call.arguments[0].address);
    assert.equal(call.inputs[1].value.bits,call.arguments[1].bits);
    const argument=r.trace.events.find(e=>e.action==='argument'&&e.callExecutionId===call.eventId&&e.parameterIndex===0);
    assert.equal(argument.inputs.length,1);assert.equal(argument.inputs[0].value.address,call.arguments[0].address);
    assert.equal(argument.inputs[0].executionId,call.inputs[0].executionId);
  }
  const address=calls[0].inputs[0],sample=raw.get(address.observationId),op=ops.get(sample.instructionId);
  assert.equal(op.action,'address');assert.equal(r.plan.bindings[op.id].administrative,true);
  assert.equal(address.value.address,sample.value.address);assert.equal(address.executionId,null);
  assert.ok(calls[0].addressInputs.some(id=>{const e=events.get(id);return e.kind==='READ'&&objects.get(e.target.objectId)?.name==='index';}));
  assert.ok(calls[0].addressInputs.some(id=>{const e=events.get(id);return e.action==='object.begin'&&objects.get(e.objectId)?.name==='rows';}));
  assert.equal(events.get(calls[1].inputs[0].executionId).kind,'READ');
  assert.equal(events.get(calls[2].inputs[0].executionId).kind,'CALC');
  assert.equal(events.get(calls[3].inputs[0].executionId).action,'resume');
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@identity').length,1);
});
