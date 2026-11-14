import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures} from '../scripts/inference/structure-inference.mjs';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {createStructureViewQuery} from '../src/animation/structure-query.js';
import {hydrateStructure,layoutStructure} from '../src/animation/structure-shapes.js';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {digest} from '../scripts/execution-relations/v2/common.mjs';

test('list presentation preserves ranges, values, manual override and causal prefixes',async()=>{
  const r=await frozenInferenceExecution('returned-list'),a=inferStructures(r.plan,r.trace),before=digest({r,a}),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),player=new Playback(recording),
    index=r.trace.events.findLastIndex(e=>e.action==='output'),at=r.trace.events[index].eventId,object=r.trace.objects.find(o=>o.name==='root'),target={objectId:object.id};
  player.seek(index+1);const p=q.project(target,at),shape=hydrateStructure(recording,displayScene(recording,player.state),p);
  assert.equal(p.view,'linked-list');assert.equal(shape.nodes.length,3);assert.equal(shape.edges.length,2);assert.ok(shape.nodes.every(n=>n.ranges.every(r=>recording.objects.has(r.objectId))));
  q.set(target,{view:'graph'},at);assert.equal(q.project(target,at).mode,'manual');assert.equal(q.project(target,at).view,'graph');
  q.set(target,{view:'auto'},at);assert.equal(q.project(target,at).view,'linked-list');assert.equal(q.project(target,null).view,'boxes');
  // A later relation value cannot replace the canonical memory snapshot.
  const forged=structuredClone(a);for(const s of forged.structures)for(const state of s.states??[])for(const n of state.nodes??[])n.value={decimal:'FORGED'};
  const corrupted=createStructureViewQuery(r.plan,r.trace,forged);
  assert.ok(hydrateStructure(recording,displayScene(recording,player.state),corrupted.project(target,at)).nodes.every(n=>n.fields.every(f=>!f.text.includes('FORGED'))));
  assert.equal(digest({r,a}),before,'recording and original inference remain read-only');
});

test('observed range trees use live values; gaps and future structures never become current',async()=>{
  const r=await frozenInferenceExecution('constant-leaf-range'),a=inferStructures(r.plan,r.trace),before=digest({plan:r.plan,trace:r.trace,inference:a}),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),p=new Playback(recording),
    index=r.trace.events.findLastIndex(e=>e.action==='output'),at=r.trace.events[index].eventId,object=r.trace.objects.find(o=>o.name==='v'),target={objectId:object.id};
  p.seek(index+1);const view=q.project(target,at),shape=hydrateStructure(recording,displayScene(recording,p.state),view);assert.equal(view.view,'segment-tree');assert.equal(shape.nodes.length,7);assert.equal(shape.edges.length,6);
  const gap={...view,relation:{...view.relation,historyGap:true}};assert.equal(hydrateStructure(recording,displayScene(recording,p.state),gap),null);
  assert.equal(q.project(target,null).view,'boxes');assert.equal(digest({plan:r.plan,trace:r.trace,inference:a}),before);
  assert.throws(()=>createStructureViewQuery(r.plan,{...r.trace,runId:'another-run'},a),/다른 프로그램/);
});

test('layouts retain all cyclic/shared nodes and stable graph positions without overlaps',()=>{
  const nodes=Array.from({length:100},(_,i)=>({id:`n${i}`,fields:[{}]})),edges=nodes.map((n,i)=>({id:`e${i}`,from:n.id,to:nodes[(i+1)%nodes.length].id}));edges.push({from:'n0',to:'n0'},{from:'n2',to:'n5'});
  const shape={nodes,edges,view:'graph',roots:[]},first=layoutStructure(shape),next=layoutStructure({...shape,nodes:nodes.slice(1),edges:edges.slice(1)},first.positions);
  for(const n of nodes.slice(1))assert.deepEqual(first.positions.get(n.id),next.positions.get(n.id));
  const boxes=[...first.positions.values()];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(!(a.x<b.x+first.w&&b.x<a.x+first.w&&a.y<b.y+first.h&&b.y<a.y+first.h));}
  const tree=layoutStructure({...shape,view:'tree',roots:['n0']});assert.equal(tree.positions.size,100);assert.equal(shape.edges.length,102);
});

const fresh=[{file:'examples/c/structure-views/tree.c',stdout:'1 3 6 8 10 12 14 \n'},
  {file:'examples/c/structure-views/indexed-graph.c',stdout:'0 1 2 3 4 \n'},
  {file:'examples/c/structure-views/stack-queue.c',stdout:'2 5\n6 8\n9 7\n'}];
for(const c of fresh)test(`fresh inference/view contract: ${c.file}`,{timeout:60000},async()=>{
  const r=await traceModel(await readFile(c.file,'utf8'),{filename:c.file,includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,c.stdout);
  const before=digest({plan:r.plan,trace:r.trace}),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace}),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),p=new Playback(recording);
  let shapes=0;for(const [index,e]of r.trace.events.entries())if(e.action==='output'){
    p.seek(index+1);const scene=displayScene(recording,p.state);for(const o of scene.objects.values())if(o.alive){const v=q.project({objectId:o.id},e.eventId),shape=hydrateStructure(recording,scene,v);if(!shape)continue;shapes++;
      for(const n of shape.nodes)for(const range of n.ranges){const object=scene.objects.get(range.objectId);assert.ok(object?.alive);assert.ok(range.offset>=0&&range.offset+range.size<=object.size);}assert.equal(layoutStructure(shape).positions.size,shape.nodes.length);
    }
  }
  assert.ok(shapes>0);assert.equal(digest({plan:r.plan,trace:r.trace}),before);
});

test('manual tree uses observed topology instead of an empty container descriptor',async()=>{
  const r=await traceModel(await readFile('examples/c/structure-views/tree.c','utf8'),{includeObservations:true}),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace}),q=createStructureViewQuery(r.plan,r.trace,a),
    at=r.trace.events.findLast(e=>e.action==='output').eventId,target={objectId:r.trace.objects.find(o=>o.name==='nodes').id};
  q.set(target,{view:'tree'},at);const p=q.project(target,at);assert.equal(p.mode,'manual');assert.equal(p.view,'tree');assert.equal(p.relation.nodes.length,7);assert.equal(p.relation.edges.length,6);
  assert.equal(p.roleIds,null,'generic tree does not inherit inferred BST roles');
});

test('large array includes active distant slots without changing allocation or values',async()=>{
  const r=await traceModel('#include <stdio.h>\nint main(void){int data[300]={0};data[299]=42;printf("%d\\n",data[299]);return 0;}',{includeObservations:true}),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace}),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),player=new Playback(recording),
    index=r.trace.events.findLastIndex(e=>e.action==='output'),object=r.trace.objects.find(o=>o.name==='data');
  player.seek(index+1);const p=q.project({objectId:object.id},r.trace.events[index].eventId),shape=hydrateStructure(recording,displayScene(recording,player.state),p,[{objectId:object.id,offset:1196,size:4,role:'read'}]);
  assert.equal(shape.nodes.length,64);assert.equal(shape.omitted,236);assert.ok(shape.nodes.some(n=>n.index===299&&n.fields[0].text==='42'));assert.equal(object.size,1200);
  q.set({objectId:object.id},{view:'boxes'},r.trace.events[index].eventId);assert.equal(hydrateStructure(recording,displayScene(recording,player.state),q.project({objectId:object.id},r.trace.events[index].eventId)),null);
});

test('compiler-declared multidimensional storage becomes a full grid of scalar cells',async()=>{
  const r=await traceModel(await readFile('examples/c/execution-relations/work-grid.c','utf8'),{includeObservations:true});assert.equal(r.stdout,'17 20\n');
  const a=inferStructures(r.plan,r.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace}),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),player=new Playback(recording),index=r.trace.events.findLastIndex(e=>e.action==='output');
  player.seek(index+1);const scene=displayScene(recording,player.state);for(const o of scene.objects.values())if(o.alive&&o.cType?.dimensions?.length===2){
    const shape=hydrateStructure(recording,scene,q.project({objectId:o.id},r.trace.events[index].eventId));assert.equal(shape.nodes.length,12);assert.equal(shape.columns,4);assert.equal(shape.nodes[7].label,'[1][3]');assert.equal(shape.nodes[7].ranges[0].size,4);
    if(o.name==='input')assert.deepEqual(shape.nodes.map(n=>n.fields[0].text),Array.from({length:12},(_,i)=>String(i+1)));
  }
});

test('cyclic pointer graph preserves five vertices and both outgoing roles',async()=>{
  const r=await traceModel(await readFile('examples/c/structure-views/pointer-graph.c','utf8'),{includeObservations:true});assert.equal(r.stdout,'10\n');
  const a=inferStructures(r.plan,r.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace}),q=createStructureViewQuery(r.plan,r.trace,a),target={objectId:r.trace.objects.find(o=>o.name==='vertices').id},at=r.trace.events.findLast(e=>e.action==='output').eventId;
  q.set(target,{view:'graph'},at);const p=q.project(target,at);assert.equal(p.relation.nodes.length,5);assert.equal(p.relation.edges.length,10);
  q.set(target,{view:'tree'},at);const tree=q.project(target,at);assert.equal(tree.view,'tree');assert.equal(tree.relation.nodes.length,5);assert.equal(tree.relation.edges.length,10,'manual tree must not erase cycles');
  assert.ok(tree.warnings.length,'incompatible shape is not silently repaired');
  const pointer={objectId:r.trace.objects.find(o=>o.name==='p').id};q.set(pointer,{view:'graph'},at);const alias=q.project(pointer,at);
  assert.equal(alias.relation.nodes.length,6,'pointer storage and five real vertices remain distinct');assert.equal(alias.relation.edges.length,11,'pointer alias does not drop the untraversed field role');
});
