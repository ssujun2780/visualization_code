import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {inferStructures} from '../scripts/inference/structure-inference.mjs';
import {encodeInference} from '../scripts/inference/shared-values.mjs';
import {prepareStructures,PreparedStructures} from '../src/animation/prepared-structures.js';
import {createStructureViewQuery} from '../src/animation/structure-query.js';
import {circularPresentation} from '../src/animation/structure-layout.js';

test('shared inference handoff preserves the same complete relation history, descriptors and scope checks',async()=>{
  const r=await frozenInferenceExecution('returned-list'),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace}),encoded=encodeInference(a),before=JSON.stringify({r,encoded});
  const plain=prepareStructures(r.plan,r.trace,a),shared=prepareStructures(r.plan,r.trace,encoded);
  assert.deepEqual(shared,plain);assert.ok(plain.tracks.some(t=>t.variants.auto.entries.length>1));
  const target={objectId:r.trace.objects.find(o=>o.name==='root').id},at=r.trace.events.findLast(e=>e.action==='output').eventId;
  assert.deepEqual(createStructureViewQuery(r.plan,r.trace,encoded).project(target,at),createStructureViewQuery(r.plan,r.trace,a).project(target,at));
  assert.throws(()=>prepareStructures(r.plan,{...r.trace,runId:'different-run'},encoded),/다른 프로그램/);assert.equal(JSON.stringify({r,encoded}),before);
});

test('index normalization modulus alone never turns a stack or linear queue into a ring',()=>{
  const semantic={logicalOrder:{start:0,count:3,modulus:8,direction:1}};
  for(const view of ['stack','array','grid','queue','deque'])assert.equal(circularPresentation({view,semantic}),false,view);
  assert.equal(circularPresentation({view:'queue',semantic:{...semantic,currentAccess:{moduloCapacity:true}}}),true);
  assert.equal(circularPresentation({view:'stack',semantic:{...semantic,currentAccess:{moduloCapacity:true}}}),false);
  for(const layout of ['ring','flag-ring'])assert.equal(circularPresentation({view:'queue',descriptor:{layout}}),true);
  assert.equal(circularPresentation({view:'linked-list',variant:'circular'}),true);
});

test('public ring-layout metadata reaches the presentation adapter without changing inference',async()=>{
  const r=await frozenInferenceExecution('full-flag-ring'),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace}),before=JSON.stringify(a),candidate=a.structures.find(s=>s.layout==='flag-ring');
  assert.ok(candidate,'the frozen input has observed full-flag ring evidence');
  const q=createStructureViewQuery(r.plan,r.trace,a),at=r.trace.events.findLast(e=>e.action==='output').eventId,p=q.project({structureId:candidate.id},at);
  assert.equal(p.descriptor.layout,'flag-ring');assert.equal(circularPresentation(p),true);assert.equal(JSON.stringify(a),before);
});

test('old prepared stack caches are normalized once instead of retaining the old false ring interpretation',()=>{
  const p={view:'stack',label:'stack',descriptor:{objectId:'o',capacity:3,elementBytes:4},relation:{nodes:[],edges:[],semantic:{logicalOrder:{start:0,count:1,modulus:3}}}},
    v={view:'stack',label:'stack',layoutNodes:[],positions:[],appearance:{view:'stack',circular:true,descriptor:p.descriptor},entries:[{index:0,presentation:p}]},data={tracks:[{objectId:'o',variants:{auto:v}}]},before=structuredClone(data),reader=new PreparedStructures(data);
  assert.equal(reader.at('o',0).circular,false);assert.deepEqual(data,before);
});
