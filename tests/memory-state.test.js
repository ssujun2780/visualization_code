import assert from "node:assert/strict";
import {test} from "node:test";
import {MemorySnapshots,materializeMemory} from "../scripts/model/memory-state.mjs";

test("uninitialized and unobserved ranges never inspect memory or acquire fake zero values",()=>{
  const memory={get buffer(){throw new Error("Unknown bytes must not be inspected");}};
  for(const initialization of ["uninitialized","unobserved"]){
    const snapshot=new MemorySnapshots().capture(memory,0,8,[{start:0,end:8,initialization}]);
    assert.equal(snapshot.ranges[0].data,undefined);
    const decoded=materializeMemory(snapshot);assert.ok(decoded.known.every(b=>b===0));
    assert.ok(decoded.initialization.every(b=>b===(initialization==="uninitialized"?0:2)));
  }
});

test("large repeated initialized data is fully preserved within a small compressed budget",()=>{
  const budget=new MemorySnapshots(32),memory=new WebAssembly.Memory({initial:16});
  const snapshot=budget.capture(memory,0,1024*1024),decoded=materializeMemory(snapshot);
  assert.equal(snapshot.complete,true);assert.equal(snapshot.ranges.length,1);assert.deepEqual(snapshot.ranges[0].data,{encoding:"fill",byte:0});
  assert.ok(decoded.known.every(b=>b===1));assert.ok(decoded.bytes.every(b=>b===0));assert.equal(budget.summary().usedEncodedBytes,32);
});

test("snapshot budget exhaustion preserves initialization while marking values unknown",()=>{
  const memory=new WebAssembly.Memory({initial:1});new Uint8Array(memory.buffer).set([3,6,0,0]);
  const snapshot=new MemorySnapshots(0).capture(memory,0,4),decoded=materializeMemory(snapshot);
  assert.equal(snapshot.complete,false);assert.equal(snapshot.ranges[0].reason,"snapshot-budget");
  assert.ok(decoded.initialization.every(b=>b===1));assert.ok(decoded.known.every(b=>b===0));
});
