import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createValueFlow} from '../scripts/model/observed-value-flow.mjs';

async function inspect(source){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const original=JSON.stringify(r.trace),flow=createValueFlow(r.plan,r.trace),comparisons=[];
  for(const event of r.trace.events)for(const step of event.steps??[])if(['==','<','>','!=','<=','>='].includes(step.operator))
    comparisons.push({event,step,reads:step.inputs.map(input=>flow.sourceReadOperand(input,event,step))});
  assert.equal(JSON.stringify(r.trace),original,'source lookup must not mutate runtime work');
  return {...r,flow,comparisons,object:name=>r.trace.objects.find(o=>o.name===name)};
}

test('distinct signed and unsigned character promotions retain their exact array reads',async()=>{
  const r=await inspect(`int main(void){signed char first[2]={-3,65};unsigned char other[2]={250,65};
int lower=first[0]<other[0];int same=first[1]==other[1];return lower+same;}`);
  assert.equal(r.trace.exitCode,2);assert.equal(r.comparisons.length,2);
  for(const [index,c]of r.comparisons.entries()){
    assert.deepEqual(c.reads.map(e=>e?.target.objectId),[r.object('first').id,r.object('other').id]);
    assert.deepEqual(c.reads.map(e=>e.target.offset),[index,index]);
    assert.notEqual(c.reads[0].eventId,c.reads[1].eventId);
    assert.ok(c.step.inputs.every(input=>input.executionId===c.event.eventId));
    assert.notEqual(c.step.inputs[0].observationId,c.step.inputs[1].observationId);
  }
});

test('nested value-preserving casts keep separate operand identities without splitting CALC',async()=>{
  const r=await inspect(`int main(void){int buffer[2]={23,23};
int match=(long long)(unsigned int)buffer[0]==(long long)buffer[1];return match;}`);
  assert.equal(r.trace.exitCode,1);assert.equal(r.comparisons.length,1);
  const c=r.comparisons[0];assert.deepEqual(c.reads.map(e=>e?.target.offset),[0,4]);
  assert.ok(c.reads.every(e=>e.target.objectId===r.object('buffer').id));
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='==').length,1);
});

test('narrowing, arithmetic identity and sign-changing conversion stop copy provenance',async()=>{
  const r=await inspect(`int main(void){int samples[3]={19,19,-1};unsigned target[3]={19,19,4294967295U};
int a=(unsigned char)samples[0]==target[0];
int b=(samples[1]+0)==target[1];
int c=(unsigned)samples[2]==target[2];return a+b+c;}`);
  assert.equal(r.trace.exitCode,3);assert.equal(r.comparisons.length,3);
  for(const [index,c]of r.comparisons.entries()){
    assert.equal(c.reads[0],null);
    assert.equal(c.reads[1]?.target.objectId,r.object('target').id);
    assert.equal(c.reads[1].target.offset,index*4);
  }
});

test('promoted call results retain exact dynamic return identity',async()=>{
  const r=await inspect(`int value(int *data,int at){return data[at];}
int main(void){int data[2]={31,31};int match=(long long)value(data,0)==(long long)value(data,1);return match;}`);
  assert.equal(r.trace.exitCode,1);assert.equal(r.comparisons.length,1);
  const c=r.comparisons[0];assert.deepEqual(c.reads.map(e=>e?.target.offset),[0,4]);
  assert.ok(c.reads.every(e=>e.target.objectId===r.object('data').id));
  assert.notEqual(c.reads[0].activationId,c.reads[1].activationId);
  const unproved=createValueFlow(r.plan,{events:r.trace.events});
  assert.ok(c.step.inputs.every(input=>unproved.sourceReadOperand(input,c.event,c.step)===null));
});

test('internal operand lookup rejects ambiguous, mismatched and forward references',()=>{
  const value=n=>({type:'i32',bits:`0x${n.toString(16)}`,decimal:String(n),cType:{sizeBits:32,signedness:'signed'}});
  const read={eventId:'read',activationId:'f',phase:'complete',kind:'READ',target:{objectId:'a',offset:0,size:4},value:value(7),observationIds:['raw-read']};
  const cast={observationIds:['cast'],operator:'cast',inputs:[{executionId:'read',observationId:'raw-read',value:value(7)}],value:value(7)};
  const compare={observationIds:['compare'],operator:'==',inputs:[{executionId:'group',observationId:'cast',value:value(7)}],value:value(1)};
  const group={eventId:'group',activationId:'f',phase:'complete',kind:'CALC',steps:[cast,compare],value:value(1)};
  const later={...read,eventId:'later',observationIds:['raw-later']},flow=createValueFlow({instructions:[]},{events:[read,group,later]});
  assert.equal(flow.sourceReadOperand(compare.inputs[0],group,compare),read);
  assert.equal(flow.sourceReadOperand({executionId:'group',value:value(7)},group,compare),null);
  assert.equal(flow.sourceReadOperand({executionId:'read',observationId:'cast',value:value(7)},group,compare),null);
  assert.equal(flow.sourceReadOperand({executionId:'group',observationId:'compare',value:value(1)},group,cast),null);
  assert.equal(flow.sourceReadOperand({executionId:'later',observationId:'raw-later',value:value(7)},group,compare),null);
});
