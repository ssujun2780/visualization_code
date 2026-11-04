import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,plain.stdout);assert.equal(r.stderr,plain.stderr);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.deepEqual(r.plan.coverage.assertions.unbound,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  return {...r,defs,checks:r.trace.events.filter(e=>e.action==='assert.check')};
}

test('standard assert keeps comparison/truth checks and header implementation observations',async()=>{
  const r=await inspect('#include <assert.h>\nint main(void){int capacity=7;assert(capacity<8);assert(capacity);return 0;}');
  assert.deepEqual(r.checks.map(e=>e.assertion.result),['passed','passed']);
  assert.deepEqual(r.trace.events.filter(e=>e.kind==='CALC').map(e=>e.operator),['<','truth']);
  assert.deepEqual(r.checks.map(e=>r.defs.get(e.instructionId).source.expression),['capacity<8','capacity']);
  assert.ok(r.plan.assertions.every(s=>s.provenance.header==='/sys/include/assert.h'&&s.implementationObservationIds.length));
  const hidden=new Set(r.plan.assertions.flatMap(s=>s.implementationObservationIds));
  assert.ok(r.observations.trace.events.some(e=>hidden.has(e.instructionId)));
  assert.ok(r.plan.instructions.every(d=>d.operator!=='||'));
});

test('failed assert keeps the observed failed check, failure call and output path',async()=>{
  const r=await inspect('#include <assert.h>\nint main(void){int remaining=0;assert(remaining);return 99;}');
  assert.notEqual(r.trace.exitCode,0);assert.equal(r.checks.length,1);assert.equal(r.checks[0].assertion.result,'failed');
  const call=r.trace.events.find(e=>r.defs.get(e.instructionId)?.assertion?.role==='failure');
  assert.ok(call);assert.equal(call.action,'call');assert.ok(call.controlInputs.includes(r.checks[0].eventId));
  assert.ok(r.stderr.includes('Assertion failed'));assert.ok(r.trace.events.some(e=>e.action==='output'));
});

test('assert argument side effects run once, and user macro OR retains its own logical operation',async()=>{
  const r=await inspect(`#include <assert.h>
#include <stdio.h>
#define SELECT_ONE(a,b) ((a)||(b))
int main(void){int probe=0,backup=0;assert(++probe);int chosen=SELECT_ONE(probe,++backup);
assert(SELECT_ONE(0,++backup));printf("%d %d %d\\n",probe,backup,chosen);return 0;}`);
  assert.equal(r.stdout,'1 1 1\n');assert.deepEqual(r.checks.map(e=>e.assertion.result),['passed','passed']);
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='++').length,2);
  const ors=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='||');assert.equal(ors.length,2);
  assert.ok(ors.every(e=>r.defs.get(e.instructionId).source.expression.includes('SELECT_ONE')));
});

test('nested logical assert retains failed truth and short-circuit details before noreturn',async()=>{
  const r=await inspect('#include <assert.h>\nint main(void){int first=0,second=1,third=0;assert((first&&second)||third);return 0;}');
  assert.notEqual(r.trace.exitCode,0);assert.equal(r.checks[0].assertion.result,'failed');
  const calc=r.trace.events.find(e=>e.kind==='CALC'&&e.operator==='||');assert.equal(calc.value.decimal,'0');
  assert.equal(calc.evaluation.right,'evaluated');assert.equal(calc.nestedEvaluations[0].right,'skipped');
});

test('negated scalar assertions preserve source truth across compiler branch inversion',async()=>{
  const r=await inspect('#include <assert.h>\nint main(void){int signal=0;assert(!signal);signal=1;assert(!signal);return 0;}');
  assert.deepEqual(r.checks.map(e=>e.assertion.result),['passed','failed']);
  assert.deepEqual(r.checks.map(e=>e.condition.decimal),['1','0']);
  for(const e of r.checks)assert.equal(r.defs.get(e.instructionId).sourceDestinations[e.condition.decimal==='1'?'true':'false'],e.selected);
});

test('negated logical assertions preserve observed short circuits and final negated checks',async()=>{
  const r=await inspect('#include <assert.h>\nint examine(int left,int right){assert(!(left&&right));return 1;}\nint main(void){examine(0,1);examine(1,1);return 0;}');
  assert.deepEqual(r.checks.map(e=>e.assertion.result),['passed','failed']);
  const calcs=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='!');
  assert.deepEqual(calcs.map(e=>e.value.decimal),['1','0']);
  assert.deepEqual(calcs.map(e=>e.evaluation.right),['skipped','evaluated']);
  assert.ok(calcs.every(e=>r.defs.get(e.instructionId).source.expression==='!(left&&right)'));
  const ends=r.trace.events.filter(e=>e.action==='frame.end'&&e.reason==='process-exit');assert.equal(ends.length,2);
  assert.ok(ends.every(e=>e.activationId===e.frameId));
  const objects=new Map(r.observations.trace.objects.map(o=>[o.id,o]));
  for(const e of r.observations.trace.events.filter(e=>e.action==='object.end'&&e.reason==='process-exit'))
    assert.equal(e.activationId,objects.get(e.objectId).frameId);
});

test('assert guard preserves index calculation before its dependent memory read',async()=>{
  const r=await inspect('#include <assert.h>\nint main(void){int values[3]={1,3,5};int position=0;assert(position<2&&values[position+1]>values[position]);return 0;}');
  assert.equal(r.checks[0].assertion.result,'passed');
  const events=r.trace.events,index=events.find(e=>e.kind==='CALC'&&r.defs.get(e.instructionId).source?.expression==='position+1'),
    read=events.find(e=>e.kind==='READ'&&r.defs.get(e.instructionId).source?.expression==='values[position+1]');
  assert.ok(index);assert.ok(read);assert.ok(events.indexOf(index)<events.indexOf(read));
  assert.ok(read.addressInputs.includes(index.eventId));
  const guards=events.filter(e=>e.kind==='CALC'&&e.operator==='&&');assert.equal(guards.length,1);
  assert.ok(!guards[0].steps.some(s=>s.operator==='+'));
  const indexed=events.filter(e=>e.kind==='CALC'&&r.defs.get(e.instructionId).source?.expression==='position+1');
  assert.equal(indexed.length,1);assert.equal(indexed[0].operator,'+');assert.equal(indexed[0].value.decimal,'1');
  const values=events.filter(e=>e.kind==='READ'&&/^values\[/.test(r.defs.get(e.instructionId).source?.expression??''));
  assert.deepEqual(values.map(e=>r.defs.get(e.instructionId).source.expression),['values[position+1]','values[position]']);
  assert.deepEqual(values.map(e=>e.value.decimal),['3','1']);
  assert.notEqual(values[0].instructionId,values[1].instructionId);
  assert.ok(guards[0].steps.some(s=>s.operator==='>'&&s.inputs.map(i=>i.value.decimal).join(',')==='3,1'));
});

test('No28 exposes twelve successful assertions without the header OR calculation',async()=>{
  const source=await readFile(new URL('../examples/c/blind/No28.c',import.meta.url),'utf8'),r=await inspect(source);
  assert.equal(r.checks.length,12);assert.ok(r.checks.every(e=>e.assertion.result==='passed'));
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='||').length,0);
  assert.equal(r.plan.assertions.length,2);
});
