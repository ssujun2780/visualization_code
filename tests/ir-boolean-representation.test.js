import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

const bool=t=>t?.encoding==='DW_ATE_boolean';
async function inspect(source){
  const r=await traceModel(`#include <stdbool.h>\n${source}`,{includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.diagnostics,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const observations=new Map(r.observations.plan.instructions.map(o=>[o.id,o]));
  for(const [id,binding]of Object.entries(r.plan.bindings).filter(([,b])=>b.booleanRepresentation)){
    const op=observations.get(id),proof=binding.booleanRepresentation;
    assert.equal(binding.administrative,true);assert.deepEqual(binding.roles,{});
    assert.ok(bool(proof.cType));assert.ok(observations.has(proof.sourceObservationId));
    assert.equal(op.conversion,undefined,'a genuine C conversion must stay public');
    assert.deepEqual([op.inputs[0].type,op.type],proof.kind==='storage-to-value'?['i8','i1']:['i1','i8']);
  }
  return r;
}
const source=(r,event)=>r.plan.instructions.find(i=>i.id===event.instructionId)?.source?.expression;

test('bool member copies and branch decisions retain the actual READ producers',async()=>{
  const r=await inspect(`struct S{bool flag;};
    int main(void){bool local=true;struct S s;s.flag=local;if(s.flag)return 0;return 1;}`);
  assert.deepEqual(r.trace.events.filter(e=>e.kind==='CALC'),[]);
  const read=r.trace.events.find(e=>e.kind==='READ'&&source(r,e)==='local'),
    write=r.trace.events.find(e=>e.kind==='WRITE'&&source(r,e)==='s.flag=local'),
    member=r.trace.events.find(e=>e.kind==='READ'&&source(r,e)==='s.flag'),
    branch=r.trace.events.find(e=>e.kind==='FLOW'&&e.action==='branch');
  assert.ok(bool(read.value.cType));assert.ok(bool(member.value.cType));
  assert.deepEqual(write.dataInputs,[read.eventId]);assert.deepEqual(branch.dataInputs,[member.eventId]);
  assert.equal(write.inputs[0].executionId,read.eventId);assert.equal(branch.inputs[0].executionId,member.eventId);
  assert.equal(BigInt(write.value.bits),1n);assert.equal(BigInt(branch.condition.bits),1n);
});

test('bool parameters, returns and aliases forward values across the ABI boundary',async()=>{
  const r=await inspect(`typedef bool Flag;struct S{Flag member;};
    static Flag echo(Flag x){Flag y=x;return y;}
    int main(void){struct S s;s.member=echo(true);Flag no=echo(false);
      if(s.member){if(no)return 1;return 0;}return 2;}`);
  assert.deepEqual(r.trace.events.filter(e=>e.kind==='CALC'),[]);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  const returned=r.trace.events.filter(e=>e.action==='return.value'&&source(r,e)==='return y');
  assert.equal(returned.length,2);
  assert.deepEqual(returned.map(e=>BigInt(e.value.bits)),[1n,0n]);
  for(const e of returned){assert.equal(e.dataInputs.length,1);assert.equal(events.get(e.dataInputs[0]).kind,'READ');}
  for(const e of r.trace.events.filter(e=>e.kind==='WRITE'&&['s.member=echo(true)','Flag no=echo(false)'].includes(source(r,e))))
    assert.ok(e.dataInputs.some(id=>events.get(id)?.action==='resume'));
});

test('integer, floating and pointer truth conversions and bool promotions remain calculations',async()=>{
  const r=await inspect(`int main(void){int n=-9;bool b=n;int wide=b;
    double d=0.5;bool f=d;int *p=&n;bool q=p;unsigned char byte=b;
    return wide+(int)f+(int)q+byte-4;}`);
  const ops=r.observations.plan.instructions,conversions=ops.filter(o=>o.conversion),
    toBool=conversions.filter(o=>bool(o.conversion.toType)),fromBool=conversions.filter(o=>bool(o.conversion.fromType));
  assert.equal(toBool.length,3);
  assert.deepEqual(toBool.map(o=>o.opcode),['icmp','fcmp','icmp']);
  assert.equal(fromBool.length,4);assert.ok(fromBool.every(o=>o.opcode==='zext'));
  for(const o of [...toBool,...fromBool])assert.notEqual(r.plan.bindings[o.id].administrative,true);
  const n=r.trace.events.find(e=>e.kind==='CALC'&&source(r,e)==='n');
  assert.equal(n.operator,'cast');assert.equal(BigInt(n.value.bits),1n);
  assert.equal(n.steps[0].conversion.fromValue.decimal,'-9');
  const adaptedLoads=ops.filter(o=>r.plan.bindings[o.id].booleanRepresentation?.kind==='storage-to-value');
  assert.equal(adaptedLoads.length,4,'promotions reuse four bool READ values without extra source casts');
});

test('comparisons stored or returned as bool keep their source comparisons',async()=>{
  const r=await inspect(`struct S{bool ok;};static bool less(int a,int b){return a<b;}
    int main(void){struct S s;int n=3;s.ok=n<4;bool x=less(2,3);
      if(s.ok){if(x)return 0;}return 1;}`);
  const calculations=r.trace.events.filter(e=>e.kind==='CALC');
  assert.deepEqual(calculations.map(e=>[e.operator,source(r,e)]),[['<','n<4'],['<','a<b']]);
  assert.ok(calculations.every(e=>BigInt(e.value.bits)===1n));
  const stored=r.trace.events.find(e=>e.kind==='WRITE'&&source(r,e)==='s.ok=n<4');
  assert.ok(stored.dataInputs.includes(calculations[0].eventId));
});
