import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createValueFlow} from '../scripts/model/observed-value-flow.mjs';

async function inspect(source){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const before=structuredClone(r.trace),flow=createValueFlow(r.plan,r.trace);
  for(const e of r.trace.events){flow.sourceRead(e.eventId);flow.reads(e.eventId);}
  assert.deepEqual(r.trace,before,'value annotations cannot change recorded execution or storage');
  const object=name=>r.trace.objects.find(o=>o.name===name),
    write=name=>r.trace.events.find(e=>e.kind==='WRITE'&&e.target?.objectId===object(name)?.id);
  return {...r,flow,object,write};
}

test('wrapper and recursive returns preserve exact reads and copied temporary boundaries',async()=>{
  const r=await inspect(`int sample(int* cells,int slot){return cells[slot];}
int relay(int* cells,int slot,int depth){if(depth)return relay(cells,slot,depth-1);return sample(cells,slot);}
int main(void){int cells[3]={11,23,37};int first=relay(cells,1,2);int second=relay(cells,2,2);cells[0]=first;return second;}`);
  assert.equal(r.trace.exitCode,37);
  const source=r.object('cells'),first=r.write('first'),second=r.write('second');
  const a=r.flow.sourceRead(first.eventId),b=r.flow.sourceRead(second.eventId);
  assert.equal(a.target.objectId,source.id);assert.equal(a.target.offset,4);
  assert.equal(b.target.objectId,source.id);assert.equal(b.target.offset,8);
  assert.notEqual(a.activationId,b.activationId);assert.notEqual(a.eventId,b.eventId);
  assert.equal(r.trace.resultDeliveries.length,8);
  for(const d of r.trace.resultDeliveries){
    const origin=r.flow.sourceRead(d.resumeExecutionId);assert.ok([a.eventId,b.eventId].includes(origin?.eventId));
  }
  const final=r.trace.events.find(e=>e.kind==='WRITE'&&e.action==='write'&&e.target?.objectId===source.id),
    nearest=r.flow.sourceRead(final.eventId),w=r.trace.structures.find(s=>s.kind==='array-work');
  assert.equal(nearest.target.objectId,r.object('first').id,'the copied scalar remains the nearest storage read');
  assert.ok(r.flow.reads(final.eventId).some(e=>e.eventId===a.eventId));
  const temporary=w.temporaries.find(t=>t.createdBy===first.eventId),transfer=w.transfers.find(t=>t.executionId===final.eventId);
  assert.equal(temporary.origin.offset,4);assert.equal(transfer.sourceTemporaryId,temporary.id);
  assert.equal(transfer.readExecutionId,nearest.eventId);
  const noProof=createValueFlow(r.plan,{events:r.trace.events,resultDeliveries:[]});
  assert.equal(noProof.sourceRead(first.eventId),null);
  const forged=structuredClone(r.trace.resultDeliveries);forged[0].returnValueExecutionId=forged.at(-1).returnValueExecutionId;
  assert.equal(createValueFlow(r.plan,{events:r.trace.events,resultDeliveries:forged}).sourceRead(first.eventId),null);
});

test('only the returned argument participates; equal arithmetic and ignored inputs stay separate',async()=>{
  const r=await inspect(`int altered(int* cells){return cells[0]+0;}
int constant(int ignored){return 43;}
int chosen(int value,int ignored){return value;}
int main(void){int cells[3]={43,22,57};int a=altered(cells);int b=constant(cells[0]);int c=chosen(cells[1],cells[0]);return a+b+c;}`);
  assert.equal(r.trace.exitCode,108);
  assert.equal(r.flow.sourceRead(r.write('a').eventId),null);
  assert.equal(r.flow.sourceRead(r.write('b').eventId),null);
  assert.deepEqual(r.flow.reads(r.write('a').eventId),[]);
  assert.deepEqual(r.flow.reads(r.write('b').eventId),[]);
  const actual=r.flow.reads(r.write('c').eventId),arrayReads=actual.filter(e=>e.target.objectId===r.object('cells').id);
  assert.equal(arrayReads.length,1);assert.equal(arrayReads[0].target.offset,4);
  assert.equal(r.flow.sourceRead(r.write('c').eventId).target.objectId,r.object('value').id);
  for(const e of r.trace.events.filter(e=>e.action==='call'))assert.deepEqual(r.flow.reads(e.eventId),[]);
  const arrayRead=arrayReads[0],ignoredIds=[...arrayRead.addressInputs,...arrayRead.controlInputs];
  assert.ok(actual.every(e=>!ignoredIds.includes(e.eventId)));
});

test('only observed value-preserving non-narrowing conversions retain copy provenance',async()=>{
  const r=await inspect(`int main(void){int cells[3]={19,257,-1};
unsigned kept=(unsigned)cells[0];long long wider=(long long)cells[0];
unsigned char fitted=(unsigned char)cells[0];unsigned char reduced=(unsigned char)cells[1];
unsigned changed=(unsigned)cells[2];int adjusted=cells[0]+0;return 0;}`);
  for(const name of ['kept','wider']){
    const origin=r.flow.sourceRead(r.write(name).eventId);assert.ok(origin,name);assert.equal(origin.target.objectId,r.object('cells').id);
  }
  for(const name of ['fitted','reduced','changed','adjusted']){
    assert.equal(r.flow.sourceRead(r.write(name).eventId),null,name);assert.deepEqual(r.flow.reads(r.write(name).eventId),[],name);
  }
  const work=r.trace.structures.find(s=>s.kind==='array-work');
  for(const name of ['fitted','reduced','changed','adjusted'])assert.ok(!work.transfers.some(t=>t.executionId===r.write(name).eventId));
});

test('identity traversal rejects future edges, incomplete events and address-only dependencies',()=>{
  const value={type:'i32',bits:'0x00000005',signed:'5',unsigned:'5',decimal:'5',cType:{sizeBits:32,signedness:'signed'}};
  const read={eventId:'r',activationId:'frame',kind:'READ',action:'read',phase:'complete',value,
    target:{objectId:'slot',offset:0,size:4},dataInputs:[]};
  const events=[read,
    {eventId:'identity',activationId:'frame',kind:'CALC',value,dataInputs:['r']},
    {eventId:'address',activationId:'frame',kind:'CALC',value,dataInputs:[],addressInputs:['r'],controlInputs:['r']},
    {eventId:'later',activationId:'frame',kind:'CALC',value,dataInputs:['future']},
    {...read,eventId:'future'},
    {...read,eventId:'incomplete',phase:'incomplete'}];
  const flow=createValueFlow({instructions:[]},{events});
  assert.equal(flow.sourceRead('identity'),read);assert.deepEqual(flow.reads('identity'),[read]);
  for(const id of ['address','later','incomplete']){assert.equal(flow.sourceRead(id),null);assert.deepEqual(flow.reads(id),[]);}
});
