import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {resolvedCoverage} from '../scripts/model/coverage-resolution.mjs';

test('final coverage distinguishes recovered bindings, executed conversions and unexecuted work',async()=>{
  const r=await traceModel(`int main(void){
    int value=4;int *cursor=&value;
    unsigned long index=0;
    while(cursor){index++;cursor=0;}
    unsigned long stop=0;
    return index<9 ? (int)(index+stop) : 0;
  }`);
  assert.equal(r.trace.exitCode,1);assert.equal(r.trace.status,'completed');
  assert.ok(r.plan.coverage.resolvedObservations.length>0,'pointer truth mapped after initial source lookup');
  assert.equal(r.plan.coverage.unmappedObservations.length,0);
  assert.equal(r.trace.coverage.unmappedObservations.length,0,'runtime coverage must not restore stale compiler diagnostics');
  assert.ok(r.plan.coverage.cConversions.resolved.length>=3,'initializer and comparison literal conversions are bound');
  assert.equal(r.plan.coverage.cConversions.unobserved.length,0);
  assert.equal(r.trace.coverage.cConversions.unobserved.length,0);
  assert.ok(r.trace.coverage.cConversions.resolved.every(c=>c.bindings.some(b=>b.executionId)));
  const unexecuted=resolvedCoverage(r.plan,{events:[]});
  assert.equal(unexecuted.cConversions.resolved.length,0,'bound source work alone does not prove a runtime conversion');
  assert.equal(unexecuted.cConversions.unobserved.length,r.plan.coverage.cConversions.initiallyUnobserved.length);
  const uncertain=structuredClone(r.plan);
  uncertain.coverage.observationMappingHistory.push({observationId:'absent',reason:'no source mapping'});
  uncertain.coverage.cConversions.initiallyUnobserved.push({nodeId:'absent',reason:'missing conversion'});
  const final=resolvedCoverage(uncertain,{events:r.trace.events});
  assert.deepEqual(final.unmappedObservations.map(x=>x.observationId),['absent']);
  assert.deepEqual(final.cConversions.unobserved.map(x=>x.nodeId),['absent']);
  assert.equal(r.plan.coverage.unmappedObservations.length,0,'diagnostic reconciliation is not destructive');
});

test('a source-only expression does not clear an unresolved observation',()=>{
  const source={file:'unit.c',line:1,column:1},plan={instructions:[{id:'i1',kind:'CALC',sourceNodeId:'n1',source,bindingStatus:'source-only'}],
    bindings:{o1:{roles:{CALC:'i1'}}},coverage:{unmappedObservations:[{observationId:'o1',reason:'ambiguous source'}]}};
  assert.equal(resolvedCoverage(plan).unmappedObservations.length,1);
});
