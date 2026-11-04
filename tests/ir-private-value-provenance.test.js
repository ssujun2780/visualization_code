import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

test('hidden return storage preserves literal origins separately from controlling branches',async()=>{
  const r=await traceModel(`
int choose(int gate){if(gate<0)return 19;if(gate>2)return 7;return 43;}
unsigned wide(int gate){if(gate)return 4000000000U;return 9U;}
int main(void){int a=choose(-2),b=choose(5),c=choose(1);unsigned d=wide(1),e=wide(0);return a+b+c+(d==4000000000U)+e;}`);
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,79);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),defs=new Map(r.plan.instructions.map(i=>[i.id,i]));
  const deliveries=r.trace.resultDeliveries.filter(d=>d.returnValueExecutionId);
  assert.equal(deliveries.length,5);
  assert.deepEqual(deliveries.map(d=>events.get(d.returnValueExecutionId).value.decimal),['19','7','43','4000000000','9']);
  for(const delivery of deliveries){
    const returned=events.get(delivery.returnValueExecutionId);
    assert.deepEqual(returned.dataInputs,[],'a literal must not inherit the earlier control decision as a value producer');
    assert.deepEqual(delivery.sourceExpressionExecutionIds,[]);
    assert.equal(returned.inputs.length,1);
    assert.equal(returned.inputs[0].value.decimal,returned.value.decimal);
    assert.equal(BigInt.asUintN(returned.value.cType.sizeBits,BigInt(returned.inputs[0].value.literal)),BigInt(returned.value.bits),
      'LLVM literal spelling may be signed; its bits and C decimal display must remain correct');
    assert.ok(!returned.inputs[0].executionId);
    assert.equal(returned.inputs[0].sourceNodeId,defs.get(returned.instructionId).sourceNodeId);
    assert.ok(returned.controlInputs.some(id=>events.get(id)?.kind==='FLOW'),'the branch remains a control cause');
  }
});

test('hidden scalar forwarding preserves actual variable and calculated producers through selected returns',async()=>{
  const r=await traceModel(`
int selected(int gate,int value){if(gate)return value;return value+5;}
int nested(int flag){int local=11;if(flag)return selected(1,local);return selected(0,local);}
int main(void){return nested(1)+nested(0);}`);
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,27);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),frames=new Map(r.trace.frames.map(f=>[f.id,f]));
  for(const d of r.trace.resultDeliveries){
    const returned=events.get(d.returnValueExecutionId),fn=frames.get(returned.activationId).functionName;
    assert.ok(returned.dataInputs.length);
    assert.ok(returned.inputs.some(i=>i.executionId));
    for(const id of d.sourceExpressionExecutionIds){
      const producer=events.get(id);
      if(fn==='nested')assert.equal(producer.action,'resume');
      else assert.ok(['READ','CALC'].includes(producer.kind));
    }
    assert.ok(returned.dataInputs.every(id=>events.get(id).action!=='branch'));
  }
});
