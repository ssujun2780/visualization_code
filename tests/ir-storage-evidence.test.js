import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {recordIR} from '../scripts/model/ir-record.mjs';
import {buildResultDeliveries} from '../scripts/model/result-delivery.mjs';
import {inspectWorkTrace} from '../scripts/model/work-contracts.mjs';
import {ModelRecorder} from '../scripts/model/recorder.mjs';
import {layouts} from '../scripts/model/llvm.mjs';
const done=(r,exit)=>{assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exit);assert.deepEqual(r.trace.coverage.irGaps,[]);};

test('variadic ABI storage handles mixed aligned types repeated calls and va_copy',async()=>{
  const r=await traceModel(`#include <stdarg.h>
int sum(int n,...){va_list a,b;va_start(a,n);va_copy(b,a);int i=va_arg(a,int);double d=va_arg(a,double);long long w=va_arg(a,long long);int*p=va_arg(a,int*);int j=va_arg(b,int);va_end(a);va_end(b);return i+(int)d+(int)w+*p+j;}
int main(){int n=7;return sum(4,3,2.0,5LL,&n)+sum(4,1,4.0,2LL,&n);}`);
  done(r,35);const storage=r.trace.objects.filter(o=>o.storageEvidence?.source==='wasm32 variadic ABI');
  assert.equal(storage.length,2);assert.ok(storage.every(o=>o.lifecycle==='ended'&&o.storageEvidence.callExecutionId));
  const reads=r.trace.events.filter(e=>e.kind==='READ'&&e.target);assert.ok(reads.every(e=>e.target.objectId));
  assert.ok(reads.some(e=>storage.some(o=>o.id===e.target.objectId)&&e.value.type==='double'));
});

test('linked static storage is backed by data-segment evidence without inventing object bounds',async()=>{
  const r=await traceModel('#include <string.h>\nint main(){const char*a=strerror(0);const char*b=strerror(1);return (a[0]!=0)+(b[0]!=0);}');
  done(r,2);const regions=r.trace.objects.filter(o=>o.storageEvidence?.source==='linked-data');assert.ok(regions.length);
  for(const o of regions){assert.equal(o.storageEvidence.objectBounds,'unknown');assert.equal(o.storage,'static');assert.ok(o.address>=o.storageEvidence.address&&o.address+o.size<=o.storageEvidence.address+o.storageEvidence.size);}
  const zeroStatic=await traceModel('#include <time.h>\nint main(){time_t t=0;struct tm*p=gmtime(&t);return p?p->tm_year:1;}');done(zeroStatic,70);
  assert.ok(zeroStatic.trace.objects.some(o=>o.storageEvidence?.source==='linked-data'));
  const recorder=new ModelRecorder({programId:'bounds',instructions:[]},layouts(''));
  recorder.setMemory(new WebAssembly.Memory({initial:1}));recorder.linkedDataBase=1024;
  recorder.linkedDataRegions=[{address:1024,size:16,evidence:'active segment',objectBounds:'unknown'}];
  recorder.setStaticDataEnd(1080);const bss=recorder.linkedStorage(1050,null);
  assert.equal(bss.address,1040);assert.equal(bss.size,40);assert.match(bss.storageEvidence.evidence,/__data_end/);
  assert.equal(recorder.linkedStorage(1080,null),null);assert.equal(recorder.linkedStorage(128,null),null);
  const invalid=await traceModel('int main(){int a[1]={3};int*p=a;return p[1];}');
  assert.equal(invalid.trace.status,'fault');assert.equal(invalid.trace.diagnostics[0].code,'object-bounds');
});

test('source locals keep separate lifetimes while recursive sret aliases share physical bytes',async()=>{
  const r=await traceModel(`typedef struct{int v;int*p;} Item;
Item inner(int*p){Item a={3,p};return a;}
Item outer(int*p){Item b=inner(p);b.v+=2;return b;}
int main(){int n=7;struct{int lead;Item tail;} all={99,outer(&n)};return all.tail.v+*all.tail.p;}`);done(r,12);
  const objects=new Map(r.trace.objects.map(o=>[o.id,o])),aliases=r.trace.objects.filter(o=>o.storageAlias);
  assert.deepEqual(aliases.map(o=>o.name),['b','a']);assert.ok(aliases.every(o=>o.lifecycle==='ended'));
  assert.equal(aliases[1].storageAlias.objectId,aliases[0].id);assert.equal(objects.get(aliases[0].storageAlias.objectId).name,'all');
  assert.equal(aliases[0].storageAlias.offset,4);
  const deliveries=r.trace.resultDeliveries.filter(d=>d.storageDelivery);assert.equal(deliveries.length,2);
  for(const d of deliveries){const target=objects.get(d.storageDelivery.target.objectId),ret=r.trace.events.find(e=>e.eventId===d.returnValueExecutionId);
    assert.equal(d.storageDelivery.target.objectId,ret.returnStorage.objectId);assert.notEqual(target.frameId,ret.activationId);}
  const outer=deliveries.find(d=>d.storageDelivery.target.objectId===aliases[0].storageAlias.objectId);assert.equal(outer.storageDelivery.target.offset,4);
  assert.ok(r.trace.references.some(e=>e.objectId===aliases[0].storageAlias.objectId&&objects.get(e.targetObjectId)?.name==='n'));
  const forged=structuredClone(r.trace);forged.objects.find(o=>o.storageAlias).storageAlias.offset++;
  assert.ok(inspectWorkTrace(r.plan,forged).some(i=>i.code==='source-storage-alias'));
});

test('by-value arguments connect actual member writers and completed return values, not storage creation',async()=>{
  const r=await traceModel(`typedef struct{int a,b;} Pair;Pair make(int x){Pair p={x,x+1};return p;}int sum(Pair p){return p.a+p.b;}
int main(){int first=4;return sum(make(first));}`,{includeObservations:true});done(r,9);
  const first=r.trace.objects.find(o=>o.name==='first'),initial=r.trace.events.findIndex(e=>e.action==='write'&&e.target?.objectId===first.id),
    temporary=r.trace.events.findIndex(e=>r.plan.instructions.find(d=>d.id===e.instructionId)?.temporaryRole==='abi-return-storage');
  assert.ok(temporary>initial);assert.equal(r.plan.instructions.find(d=>d.id===r.trace.events[temporary].instructionId).visibility,'implementation');
  const call=r.trace.events.find(e=>e.action==='call'&&e.callee==='@sum'),input=call.inputs[0],producer=r.trace.events.find(e=>e.eventId===input.executionId);
  assert.equal(producer.action,'resume');assert.equal(producer.value.kind,'aggregate');assert.ok(call.dataInputs.includes(producer.eventId));
  assert.ok(input.dataInputs.length>=2);assert.ok(input.dataInputs.every(id=>r.trace.events.some(e=>e.eventId===id&&e.kind==='WRITE')));
  const parameter=r.trace.events.find(e=>e.action==='argument'&&e.value?.kind==='aggregate');assert.deepEqual(parameter.dataInputs,call.dataInputs);
  assert.equal(parameter.copiedFrom.valueExecutionId,producer.eventId);assert.ok(parameter.copiedFrom.dataInputs.length>=2);
  const copy=structuredClone(r.observations.trace);recordIR(r.plan,r.observations.plan,r.observations.trace);assert.deepEqual(r.observations.trace,copy);
  assert.equal(r.trace.resultDeliveries.find(d=>d.resumeExecutionId===producer.eventId).consumer.executionId,call.eventId);
});

test('external aggregate returns expose observed snapshots and delivery without a library frame',async()=>{
  for(const [fn,type,literal]of [['div','div_t','-23'],['ldiv','ldiv_t','-23L'],['lldiv','lldiv_t','-23LL']]){
    const r=await traceModel(`#include <stdlib.h>\nint main(){${type} r=${fn}(${literal},7);return r.quot==-3&&r.rem==-2;}`);done(r,1);
    const delivery=r.trace.resultDeliveries[0],resume=r.trace.events.find(e=>e.eventId===delivery.resumeExecutionId);
    assert.equal(delivery.status,'storage-delivered');assert.equal(resume.value.kind,'aggregate');assert.equal(resume.value.cType.name,type);
    assert.ok(resume.memoryState.complete);assert.ok(delivery.storageDelivery.writtenByExecutionIds.length);assert.equal(r.trace.frames.length,1);
    const forged=structuredClone(r.trace);forged.events.find(e=>e.eventId===resume.eventId).dataInputs=[];
    assert.equal(buildResultDeliveries(r.plan,forged)[0].status,'unresolved');
  }
});

test('callback frame links resolve to public calls while raw evidence stays separate',async()=>{
  const r=await traceModel('#include <stdlib.h>\nvoid f(void){}void g(void){}int main(){atexit(f);atexit(g);exit(0);}');done(r,0);
  const exit=r.trace.events.find(e=>e.action==='call'&&e.callee==='@exit'),callbacks=r.trace.frames.filter(f=>f.callbackOfCallExecutionId);
  assert.deepEqual(callbacks.map(f=>f.functionName),['g','f']);assert.ok(callbacks.every(f=>f.callbackOfCallExecutionId===exit.eventId&&f.callbackOfCallObservationId.startsWith('e')));
  const forged=structuredClone(r.trace);forged.frames.find(f=>f.callbackOfCallExecutionId).callbackOfCallExecutionId='missing';
  assert.ok(inspectWorkTrace(r.plan,forged).some(i=>i.code==='callback-owner'));
});
