import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {resolvedCoverage} from '../scripts/model/coverage-resolution.mjs';
import {attachConversionConsumers,conversionConsumerEvidence,validateConversionConsumers} from '../scripts/model/conversion-consumers.mjs';

test('folded operands, selected literals and nested initializer bytes retain distinct evidence',async()=>{
  const r=await traceModel(`#include <stdint.h>
    static unsigned long grow(unsigned long n){
      if(n>SIZE_MAX / 3) return 0UL;
      unsigned long next=n ? 3*n : 3;
      return next;
    }
    int main(void){
      typedef unsigned long Item;
      Item grid[2][3]={{1,2,3},{4,5,6}};
      unsigned long long wide[2]={-1LL,2LL};
      return grow(0)+grow(2)+grid[1][2]+wide[1]!=17;
    }`);
  assert.equal(r.trace.exitCode,0);assert.equal(r.trace.status,'completed');
  assert.deepEqual(r.trace.coverage.cConversions.unobserved,[]);
  const evidence=r.trace.events.flatMap(e=>e.conversionConsumers??[]),folded=evidence.filter(c=>c.conversionValueStatus==='compiler-folded-unobserved');
  assert.equal(folded.length,2);
  for(const c of folded){
    assert.equal(c.consumerValue.decimal,'1431655765');
    assert.ok(c.compilerEvidence.includes('AST'));
    assert.equal(c.conversionValue,undefined,'the division consumer cannot reveal the conversion of its literal divisor');
  }
  const selected=evidence.filter(c=>c.requirements.length&&c.consumer.kind==='value');
  assert.deepEqual(selected.map(c=>c.status),['observed-consumer','not-executed']);
  assert.equal(selected[0].conversionValue.decimal,'3');
  assert.equal(selected[1].consumerValue,undefined);
  const arrays=evidence.filter(c=>c.consumer.kind==='initializer-bytes');
  assert.deepEqual(arrays.slice(0,6).map(c=>[c.consumer.arrayPath,c.consumer.byteOffset,c.consumerValue.decimal]),
    [[[0,0],0,'1'],[[0,1],4,'2'],[[0,2],8,'3'],[[1,0],12,'4'],[[1,1],16,'5'],[[1,2],20,'6']]);
  assert.deepEqual(arrays.slice(6).map(c=>[c.consumer.byteOffset,c.consumer.byteLength,c.consumerValue.decimal]),
    [[0,8,'18446744073709551615'],[8,8,'2']]);
  const ids=r.trace.events.map(e=>[e.eventId,e.instructionId,e.kind]);
  attachConversionConsumers(r.plan,r.trace.events);
  assert.deepEqual(r.trace.events.map(e=>[e.eventId,e.instructionId,e.kind]),ids,'metadata adds no CALC, WRITE or READ');
  assert.doesNotThrow(()=>validateConversionConsumers(r.plan,r.trace.events));
  const forged=structuredClone(r.trace.events.find(e=>e.conversionConsumers?.some(c=>c.conversionValueStatus==='compiler-folded-unobserved')));
  forged.conversionConsumers[0].conversionValue=forged.conversionConsumers[0].consumerValue;
  assert.throws(()=>validateConversionConsumers(r.plan,[forged]),/실제 소비값/);
  const wrongLayout=structuredClone(r.plan),wrong=wrongLayout.instructions.find(i=>i.conversionConsumers?.some(c=>c.consumer.kind==='initializer-bytes'));
  wrong.conversionConsumers[0].consumer.byteOffset++;
  assert.throws(()=>validateConversionConsumers(wrongLayout),/배열 배치/);

  const arrayEvent=r.trace.events.find(e=>e.conversionConsumers?.some(c=>c.consumer.arrayPath?.length===2)),
    instruction=r.plan.instructions.find(i=>i.id===arrayEvent.instructionId),partial=structuredClone(arrayEvent);
  partial.memoryState.ranges=[{offset:0,length:6,initialization:'initialized',data:{encoding:'hex',bytesHex:'010000000200'}},
    {offset:6,length:18,initialization:'initialized',reason:'snapshot-budget'}];
  partial.memoryState.complete=false;
  assert.deepEqual(conversionConsumerEvidence(instruction,partial).map(c=>c.status),
    ['observed-consumer','unobserved','unobserved','unobserved','unobserved','unobserved']);
  const partialCoverage=resolvedCoverage(r.plan,{events:r.trace.events.map(e=>e===arrayEvent?partial:e)});
  assert.equal(partialCoverage.cConversions.unobserved.length,5,'partial bytes cannot clear a whole element conversion');
  partial.target.offset=4;partial.target.size=4;
  partial.memoryState={format:'memory-ranges-v1',byteLength:4,complete:true,
    ranges:[{offset:0,length:4,initialization:'initialized',data:{encoding:'hex',bytesHex:'02000000'}}]};
  const offsetEvidence=conversionConsumerEvidence(instruction,partial);
  assert.deepEqual(offsetEvidence.filter(c=>c.status==='observed-consumer').map(c=>c.consumer.arrayPath),[[0,1]],
    'snapshot offsets are relative to the actual WRITE target');
  partial.memoryState.ranges[0].initialization='unobserved';delete partial.memoryState.ranges[0].data;
  assert.ok(conversionConsumerEvidence(instruction,partial).every(c=>c.status==='unobserved'));
});

test('a never-selected converted literal is not executed, and missing selection stays unknown',async()=>{
  const r=await traceModel(`static unsigned long pick(int flag){
      unsigned long result=flag ? 9UL : 7;
      return result;
    }
    int main(void){return pick(1)!=9UL;}`);
  assert.equal(r.trace.exitCode,0);
  const c=r.trace.coverage.cConversions;
  assert.deepEqual(c.unobserved,[]);assert.equal(c.notExecuted.length,1);
  const skipped=r.trace.events.find(e=>e.conversionConsumers?.some(c=>c.status==='not-executed'));
  assert.ok(skipped);assert.equal(skipped.conversionConsumers[0].conversionValue,undefined);
  const withoutSelection=structuredClone(skipped);delete withoutSelection.inputEvaluations;
  assert.equal(resolvedCoverage(r.plan,{events:r.trace.events.map(e=>e===skipped?withoutSelection:e)}).cConversions.unobserved.length,1);
  const noExecution=resolvedCoverage(r.plan,{events:[]}).cConversions;
  assert.deepEqual(noExecution.notExecuted,[]);assert.equal(noExecution.resolved.length,0);
  assert.equal(noExecution.unobserved.length,noExecution.initiallyUnobserved.length);
});

test('selection proves a skipped calculation branch without manufacturing its operand values',async()=>{
  const r=await traceModel(`static unsigned long pick(unsigned long n){
      unsigned long result=n ? 3*n : 7;
      return result;
    }
    int main(void){return pick(0UL)!=7UL;}`);
  assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.coverage.cConversions.unobserved,[]);
  assert.equal(r.trace.coverage.cConversions.notExecuted.length,1);
  const skipped=r.trace.events.flatMap(e=>e.conversionConsumers??[]).find(c=>c.consumer.kind==='conditional-selection');
  assert.equal(skipped.status,'not-executed');assert.equal(skipped.consumerValue,undefined);
});
