import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ModelRecorder} from '../scripts/model/recorder.mjs';
import {traceModel} from '../scripts/model/index.mjs';

function fixture(){
 const r=new ModelRecorder({instructions:[]},{layout:()=>({size:4})});r.setMemory(new WebAssembly.Memory({initial:1}));
 r.nativeMemoryCoverage=true;r.stack.push({id:'f1',calls:new Map(),sourceDecisions:new Map(),definitions:new Map(),origins:new Map()});
 const begin=id=>{const op={id,kind:'FLOW',action:'call',callee:'@'+id,external:true,args:[],inputs:[],returnType:'i32'};r.call(op,0,0n);return op;};
 const end=op=>{r.call(op,1,0n);return r.events.findLast(e=>e.action==='call.end');};
 const bytes=new Uint8Array(r.memory.buffer);
 return {r,bytes,begin,end,store:(address,data)=>{bytes.set(data,address);r.nativeMemory(2,address,data.length);}};
}

for(const width of [1,2,4,8])test(`library ${width}-byte writes retain completed writers and input ancestors`,()=>{
 const {r,bytes,begin,end,store}=fixture(),producer=begin('producer'),data=Uint8Array.from({length:width},(_,i)=>i+51);
 bytes.set(data,16);r.input(data,0,[{address:16,size:width,streamOffset:0}]);r.nativeMemory(1,16,width);
 store(128,bytes.slice(16,16+width));const written=end(producer);
 const consumer=begin('consumer');r.nativeMemory(1,128,width);const read=end(consumer);
 assert.deepEqual(read.libraryReadRegions.map(p=>[p.address,p.size,p.writerAccessSize]),[['0x00000080',width,width]]);
 assert.ok(read.dataInputs.includes(written.eventId));
 const source=r.events.find(e=>e.inputStage==='arrival'),buffer=r.events.find(e=>e.inputStage==='buffer-read');
 assert.ok(written.dataInputs.includes(buffer.eventId));assert.ok(buffer.dataInputs.includes(source.eventId));
 assert.equal(r.events.filter(e=>e.inputStage==='arrival').length,1);
 assert.equal(read.libraryReadRegions[0].streamOffset,undefined,'a copy does not invent an exact byte-to-input map');
 assert.equal(read.libraryReadRegions[0].bytesHex,Buffer.from(data).toString('hex'));
 assert.equal(r.events.filter(e=>e.kind==='SPACE').length,0,'library metadata does not create source boxes');
 const seen=new Set();for(const e of r.events){for(const id of e.dataInputs??[])assert.ok(seen.has(id));seen.add(e.eventId);}
});

test('mixed-width overlaps and identical overwrites use the latest actual writer',()=>{
 const {r,begin,end,store}=fixture(),a=begin('first');store(128,new Uint8Array(8).fill(7));const first=end(a);
 const b=begin('second');store(130,new Uint8Array(2).fill(7));const second=end(b);
 // A source write outside any external call must invalidate only its bytes.
 store(133,new Uint8Array(1).fill(7));
 const c=begin('reader');r.nativeMemory(1,128,8);const read=end(c);
 assert.deepEqual(read.libraryReadRegions.map(p=>[p.address,p.size,p.dataInputs[0]]),[
  ['0x00000080',2,first.eventId],['0x00000082',2,second.eventId],['0x00000084',1,first.eventId],['0x00000086',2,first.eventId]]);
 assert.ok(!r.events.some(e=>e.action==='input'),'library state does not become host input');
});

test('compiled input, word copy and output retain buffer writers across real library calls',async()=>{
 const r=await traceModel(`#include <stdio.h>
#include <string.h>
int main(void){char first[40]={0},second[40]={0};if(!fgets(first,sizeof first,stdin))return 1;memcpy(second,first,32);printf("%s",second);return 0;}`,{stdin:'wide buffer data\n'});
 assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,'wide buffer data\n');assert.deepEqual(r.trace.coverage.irGaps,[]);
 const copy=r.trace.events.find(e=>e.action==='call'&&/memcpy/.test(e.callee));assert.ok(copy);
 assert.ok(r.trace.events.some(e=>e.libraryReadRegions?.some(p=>p.writerAccessSize>1&&p.dataInputs.includes(copy.eventId))));
 assert.equal(r.trace.events.filter(e=>e.inputStage==='arrival').map(e=>e.bytesHex).join(''),Buffer.from('wide buffer data\n').toString('hex'));
});
