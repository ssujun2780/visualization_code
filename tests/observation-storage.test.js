import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createObservationStorage} from '../scripts/shared/observation-storage.mjs';
import {createExecutionEncoder} from '../scripts/shared/execution-format.mjs';
import {ModelRecorder,TraceStopped} from '../scripts/model/recorder.mjs';

const type={name:'record',fields:Array.from({length:20},(_,i)=>({name:`field${i}`,type:'int',offset:i*4}))};
const event=i=>({schemaVersion:2,eventId:`e${i}`,kind:'READ',source:{line:5,column:2},value:{decimal:String(i),cType:structuredClone(type)}});

test('recording shares immutable definitions, not event/value identities or later mutable inputs',()=>{
 const store=createObservationStorage(),input=event(1),before=structuredClone(input),a=store.append(input),b=store.append(event(2));
 assert.deepEqual(a,input);assert.deepEqual(input,before);assert.notEqual(a,b);assert.notEqual(a.value,b.value);
 assert.equal(a.value.cType,b.value.cType);assert.equal(a.source,b.source);assert.equal(Object.isFrozen(input.value.cType),false);
 input.value.cType.fields[0].name='changed';assert.equal(a.value.cType.fields[0].name,'field0');
 const c=store.append(input);assert.equal(c.value.cType.fields[0].name,'changed');assert.notEqual(c.value.cType,a.value.cType);
 a.value.reference={targetObjectId:'o1'};assert.equal(b.value.reference,undefined);
});

test('budget is the exact encoded rows plus new definitions, rejected records leave no definitions behind',()=>{
 const store=createObservationStorage(),encoder=createExecutionEncoder(),events=[event(1),event(2)],packets=events.map(e=>encoder.pack(e));
 for(const e of events)store.append(e);
 const size=v=>Buffer.byteLength(JSON.stringify(v))+1,expected=packets.reduce((n,p)=>n+size(p.data),0)+encoder.definitions.entries.reduce((n,v)=>n+size(v),0);
 assert.equal(store.summary().observationBytes,expected);
 const before=store.summary(),changed=event(3);changed.source.line=999;changed.value.cType.name='different';
 assert.equal(store.append(changed,before.observationBytes),null);assert.deepEqual(store.summary(),before);
 assert.deepEqual(store.append(changed),changed);
});

test('recorder limits retain contiguous IDs and exactly one terminal error after a rejected definition',()=>{
 const r=new ModelRecorder({programId:'p'},null,{maxObservationBytes:2500}),op={id:'read',source:{line:1}};
 r.event('READ',op,{value:{cType:type,decimal:'1'}});const before=r.observationBytes;
 assert.throws(()=>r.event('READ',{id:'big',source:{line:2}},{value:{text:'x'.repeat(10000),cType:{name:'not-admitted'}}}),TraceStopped);
 assert.deepEqual(r.events.map(e=>e.eventId),['e1','e2']);assert.equal(r.events[1].kind,'ERROR');assert.equal(r.status,'limited');
 assert.ok(r.observationBytes>=before);assert.equal(r.events[1].diagnostic.code,'trace-size-limit');
});
