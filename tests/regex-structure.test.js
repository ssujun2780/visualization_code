import assert from "node:assert/strict";
import { test } from "node:test";
import { topology,inferDynamicArray,inferPairGrid,inferBitset } from "../scripts/experiments/regex-equivalence/structure.mjs";

test("structural references suggest trees or cycles without type names",()=>{
  const nodes=[{id:"x",name:"grid"},{id:"y",name:"array"}];
  const tree=topology(nodes,[{from:"x",to:"y"}]);
  assert.ok(tree.views.includes("tree-or-forest"));
  const cycle=topology(nodes,[{from:"x",to:"y"},{from:"y",to:"x"}]);
  assert.equal(cycle.cyclic,true);
  assert.ok(!cycle.views.includes("tree-or-forest"));
  assert.deepEqual(topology([],[]).views,[]);
});

test("array roles follow append, stride and allocation constraints, not field names or order",()=>{
  const sample={before:[{id:"tree",kind:"size",value:0},{id:"graph",kind:"size",value:0},{id:"grid",kind:"size",value:4}],
    after:[{id:"grid",kind:"size",value:4},{id:"graph",kind:"size",value:8},{id:"tree",kind:"size",value:1}],
    store:{offset:0,width:4},payloadBytes:32};
  const found=inferDynamicArray([sample]);
  assert.equal(found.lengthField,"tree");assert.equal(found.capacityField,"graph");assert.equal(found.strideField,"grid");
  assert.equal(inferDynamicArray([{...sample,store:{offset:9,width:4}}]),null);
});

test("integer coordinate pairs alone do not justify a grid or graph",()=>{
  assert.equal(inferPairGrid({domains:[],points:[{coordinates:[0,1]}]}),null);
  const domains=[{id:"A",keys:[0,1],observedIndexResolution:true},{id:"B",keys:[0,1],observedIndexResolution:true}];
  const found=inferPairGrid({domains,points:[{coordinates:[0,1]}]});
  assert.equal(found.view,"sparse-cartesian-projection");assert.equal(found.memoryIsTwoDimensional,false);
  assert.equal(inferPairGrid({domains,points:[{coordinates:[2,1]}]}),null);
});

test("bitset inference requires observed bit operations within word bounds",()=>{
  assert.equal(inferBitset({wordBits:64,wordCount:4,operations:[]}),null);
  const value="8000000000000000";
  const found=inferBitset({wordBits:64,wordCount:4,operations:[{word:3,bit:63,valueHex:value}]});
  assert.equal(found.bitCount,256);assert.equal(found.bitsAreStrings,true);
  assert.equal(inferBitset({wordBits:64,wordCount:4,operations:[{word:3,bit:64,valueHex:value}]}),null);
});
