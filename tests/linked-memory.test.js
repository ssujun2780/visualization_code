import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeWasmMemory} from '../scripts/instrumentation/wasm-memory.mjs';
import {RangeOrigins} from '../scripts/model/ranges.mjs';

const u=n=>{const r=[];do{const b=n&127;n>>>=7;r.push(b|(n?128:0));}while(n);return r;};
const str=s=>[...u(s.length),...Buffer.from(s)],section=(n,b)=>[n,...u(b.length),...b];
function moduleWith(instructions){
  const body=[0,...instructions,11];
  return Buffer.from([0,97,115,109,1,0,0,0,
    ...section(1,[2,96,6,127,127,127,127,126,126,0,96,0,1,127]),
    ...section(2,[1,...str('cvtrace'),...str('emit'),0,0]),
    ...section(3,[1,1]),...section(5,[1,0,1]),
    ...section(7,[2,...str('run'),0,1,...str('memory'),2,0]),
    ...section(10,[1,...u(body.length),...body])]);
}

test('linked scalar access hooks preserve the effective address and stored result',async()=>{
  const binary=moduleWith([65,8,65,17,54,2,4,65,8,40,2,4]),events=[];
  const plain=await WebAssembly.instantiate(binary,{cvtrace:{emit(){}}});
  const observed=observeWasmMemory(binary),run=await WebAssembly.instantiate(observed.bytes,{cvtrace:{emit:(...v)=>events.push(v)}});
  assert.equal(plain.instance.exports.run(),17);assert.equal(run.instance.exports.run(),17);
  assert.deepEqual(events.map(e=>e.slice(0,4)),[[-1,2,12,4],[-1,1,12,4]]);
  assert.deepEqual(new Uint8Array(run.instance.exports.memory.buffer),new Uint8Array(plain.instance.exports.memory.buffer));
});

test('a trapping load is not recorded as a completed access and unsupported instructions are rejected',async()=>{
  const binary=moduleWith([65,255,255,3,40,2,0]),events=[];
  const run=await WebAssembly.instantiate(observeWasmMemory(binary).bytes,{cvtrace:{emit:(...v)=>events.push(v)}});
  assert.throws(()=>run.instance.exports.run(),WebAssembly.RuntimeError);assert.deepEqual(events,[]);
  assert.throws(()=>observeWasmMemory(moduleWith([252,10,0,0,65,0])),/does not support/);
});

test('interval provenance handles overlaps, reused storage and explicit invalidation',()=>{
  const actual=new RangeOrigins(),expected=Array(64).fill(null);let seed=17;
  const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let i=0;i<250;i++){
    const start=rand(64),size=rand(65-start),value=rand(4)||null;actual.set(start,size,value);expected.fill(value,start,start+size);
    const expanded=[];for(const r of actual.get(0,64))expanded.push(...Array(r.end-r.start).fill(r.value));
    assert.deepEqual(expanded,expected);
    for(let j=1;j<actual.ranges.length;j++)assert.ok(actual.ranges[j-1].end<=actual.ranges[j].start);
  }
});
