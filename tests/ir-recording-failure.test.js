import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {recordObservedTrace} from '../scripts/model/recorded-result.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';

test('conversion failure returns an engine diagnostic while raw execution remains intact',async()=>{
  const r=await traceModel('int main(void){int a=3;int b=a*2;return b;}',{includeObservations:true});
  assert.equal(r.trace.status,'completed');
  const broken=structuredClone(r.plan),id=broken.instructions.find(d=>d.kind==='CALC'&&d.operator==='*').id;
  broken.instructions.find(d=>d.id===id).operator=null;
  const original=structuredClone(r.observations.trace),result=recordObservedTrace(broken,r.observations.plan,r.observations.trace);
  assert.equal(result.trace.status,'engine-error');assert.equal(result.trace.exitCode,6);
  assert.equal(result.conversionFailure.stage,'ir-recording');assert.equal(result.conversionFailure.observedStatus,'completed');
  assert.equal(result.trace.events.length,1);assert.equal(result.trace.events[0].evidence,'engine');
  assert.match(result.conversionFailure.stack,/CALC 계약 위반/);
  assert.equal(result.conversionFailure.diagnostic.cause.context.instructionId,id);
  assert.equal(result.conversionFailure.diagnostic.source.expression,'a*2');
  assert.doesNotThrow(()=>validateIRTrace(broken,result.trace));
  assert.deepEqual(r.observations.trace,original,'failure handling must not overwrite the C execution with an engine fault');
  const valid=recordObservedTrace(r.plan,r.observations.plan,r.observations.trace);
  assert.equal(valid.trace.status,'completed');assert.equal(valid.conversionFailure,undefined);
});
