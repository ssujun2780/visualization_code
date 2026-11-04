import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {describeLogicalWork,validatePresentationContract} from '../scripts/model/presentation-contract.mjs';

test('record blueprints remain static while field updates retain reads, calculations and writes',async()=>{
  const r=await traceModel(`struct Parcel; typedef struct Parcel {int amount; struct Parcel *trail;} Parcel;
int change(Parcel *item,int delta){item->amount+=delta;item->amount-=1;item->amount+=delta*2;return item->amount;}
int main(void){Parcel box={2,0};int result=change(&box,3);return result;}`);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,10);
  const b=r.plan.typeBlueprints;assert.equal(b.length,1);assert.equal(b[0].name,'Parcel');
  assert.deepEqual(b[0].fields.map(f=>f.name),['amount','trail']);assert.equal(b[0].allocatesStorage,false);
  assert.ok(!r.plan.instructions.some(d=>d.kind==='SPACE'&&d.sourceNodeId===b[0].nodeId));
  assert.deepEqual(r.plan.compoundUpdates.map(u=>[u.operator,u.rightForm]),[['+=','single-value'],['-=','single-value'],['+=','expression']]);
  const definitions=new Map(r.plan.instructions.map(d=>[d.id,d]));
  const calls=r.trace.events.filter(e=>e.kind==='CALC'&&r.plan.compoundUpdates.some(u=>u.calculationInstructionId===e.instructionId));
  assert.deepEqual(calls.map(e=>e.value.decimal),['5','4','10']);
  for(const calc of calls){
    assert.ok(calc.inputs.some(i=>r.trace.events.find(e=>e.eventId===i.executionId)?.kind==='READ'));
    assert.ok(r.trace.events.some(e=>e.kind==='WRITE'&&e.inputs.some(i=>i.executionId===calc.eventId)));
  }
  const result=r.trace.objects.find(o=>o.name==='result'),create=r.trace.events.findIndex(e=>e.eventId===result.createdBy),
    call=r.trace.events.findIndex(e=>e.action==='call'&&definitions.get(e.instructionId).callee==='@change');
  assert.ok(create<call,'destination storage exists before its initializer call');
  const broken=structuredClone(r.plan);broken.compoundUpdates[0].rightForm='expression';
  assert.throws(()=>validatePresentationContract(broken),/복합 대입/);
});

test('detailed logical explanation includes skipped operands without executing side effects or invalid access',async()=>{
  const r=await traceModel(`int main(void){int count=0;int *ptr=0;
int a=0&&++count;int b=ptr!=0&&*ptr>0;int c=1||++count;return count+a+b+c;}`);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,1);
  const before=JSON.stringify(r.trace),skips=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical'&&e.evaluation.right==='skipped');
  assert.equal(skips.length,3);
  for(const e of skips){const detailed=describeLogicalWork(r.plan,e),compact=describeLogicalWork(r.plan,e,{mode:'compact'});
    assert.equal(detailed[0].operands.length,2);assert.equal(compact[0].operands.length,1);
    assert.equal(detailed[0].operands[1].truth,null);assert.equal(detailed[0].operands[1].explanationOnly,true);
    assert.equal(detailed[0].operands[1].preview.status,'not-evaluated');
  }
  assert.equal(JSON.stringify(r.trace),before);
  const count=r.trace.objects.find(o=>o.name==='count');
  assert.deepEqual(r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===count.id).map(e=>e.value.decimal),['0']);
  assert.ok(!r.trace.events.some(e=>e.kind==='READ'&&e.target?.address==='0x00000000'));
  assert.equal(r.plan.presentation.recording,'detailed');
  const broken=structuredClone(r.plan);broken.presentation.recording='compact';
  assert.throws(()=>validatePresentationContract(broken),/시각화 정책/);
});

test('blueprint identities survive anonymous records and unions without inventing allocations at compile time',async()=>{
  const r=await compileCToIR(`typedef struct {short a;int b;} Pair;union Mix{int value;unsigned char bytes[4];};
int main(void){Pair a={1,2};union Mix b={3};return a.a+b.value;}`);
  assert.ok(r.plan,JSON.stringify(r.trace?.diagnostics));
  assert.equal(r.plan.typeBlueprints.length,2);
  assert.deepEqual(new Set(r.plan.typeBlueprints.map(b=>b.recordKind)),new Set(['struct','union']));
  assert.equal(new Set(r.plan.typeBlueprints.map(b=>b.nodeId)).size,2);
  assert.ok(r.plan.typeBlueprints.every(b=>b.allocatesStorage===false&&b.source?.editorRange));
  assert.equal(r.plan.presentation.rules.returnDelivery,'direct-to-observed-next-consumer');
});
