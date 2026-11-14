import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {snapshotRelation} from '../src/animation/snapshot-relation.js';
import {prepareStructures,PreparedStructures} from '../src/animation/prepared-structures.js';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {WorldLayout} from '../src/animation/world.js';

const trace={events:Array.from({length:6},(_,i)=>({eventId:`e${i+1}`})),objects:[{id:'o',size:8,endedBy:'e6'}]},
  nodes=[{id:'a',index:0,objectId:'o',offset:0,size:4},{id:'b',index:1,range:{objectId:'o',offset:4,size:4}}],
  edge={id:'link',from:'a',to:'b',status:'observed'},candidate={id:'supplied',kind:'new-relation-kind',objectId:'o',discoveredAtExecutionId:'e2',states:[{afterExecutionId:'e2',alive:true,status:'observed',nodes,edges:[edge]}]};
test('selected supplied graph facts work independently of candidate kind and never appear before discovery',()=>{
  const before=structuredClone({trace,candidate});assert.equal(snapshotRelation(candidate,trace,'e1'),null);
  const r=snapshotRelation(candidate,trace,'e3');assert.equal(r.nodes.length,2);assert.deepEqual(r.nodes[0].range,{objectId:'o',offset:0,size:4});assert.equal(r.edges[0].id,'link');assert.equal(r.edges[0].from,'a');assert.deepEqual({trace,candidate},before);
});
test('invalidated links, missing history and ended storage are not replaced with final relations',()=>{
  const invalid={...candidate,states:[...candidate.states,{afterExecutionId:'e4',alive:true,status:'observed',nodes,edges:[{...edge,status:'unconfirmed-after-write'}]}]};
  assert.equal(snapshotRelation(invalid,trace,'e4').edges.length,0);assert.equal(snapshotRelation(invalid,trace,'e4').complete,false);
  const gap={...candidate,states:[...candidate.states,{afterExecutionId:'e5',alive:true,status:'observed',nodes,edges:[edge]}],coverage:{omittedStates:1,historyGapFromExecutionId:'e2'}};
  assert.equal(snapshotRelation(gap,trace,'e3').historyGap,true);assert.equal(snapshotRelation(gap,trace,'e3').edges.length,0);
  assert.equal(snapshotRelation(candidate,trace,'e6').alive,false);assert.equal(snapshotRelation(candidate,trace,'e6').nodes.length,0);
});
test('fresh API index graph reaches one diagram while original backing arrays stay visible',async t=>{
  let r;try{r=JSON.parse(await readFile('test-results/inference-connection/recheck/structure-indexed-graph.api.json','utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('run the connection recheck first');return;}throw e;}
  const before=JSON.stringify(r),prepared=prepareStructures(r.plan,r.trace,r.workAnalysis.structureInference),reader=new PreparedStructures(prepared),recording=createRecording(r.plan,r.trace),player=new Playback(recording),layout=new WorldLayout();layout.resolveType=recording.resolveType;layout.setPrepared(reader);
  player.seek(r.trace.events.findLastIndex(e=>e.action==='output')+1);const scene=displayScene(recording,player.state),g=layout.resolve(scene),graphNodes=[...g.structureNodes.values()].filter(n=>n.view==='graph');
  assert.equal(graphNodes.length,5);assert.equal(g.structureEdges.filter(e=>e.view==='graph').length,6);assert.equal(new Set(graphNodes.map(n=>n.objectId)).size,1);
  for(const name of ['first','next','to']){const object=[...scene.objects.values()].find(o=>o.name===name),projected=layout.projection(object);assert.equal([...projected.cells.values()].filter(c=>!c.hidden).length,object.size/4);const track=prepared.tracks.find(t=>t.objectId===object.id);assert.ok(track.variants.auto.entries.every(e=>e.presentation.backingStorageOnly));}
  const firstGraph=r.workAnalysis.structureInference.structures.find(s=>s.kind==='observed-traversal-graph-candidate'),prefix=r.trace.events.findIndex(e=>e.eventId===firstGraph.discoveredAtExecutionId)-1;
  player.seek(prefix+1);const early=layout.resolve(displayScene(recording,player.state));assert.equal(early.structureEdges.filter(e=>e.view==='graph').length,0);assert.equal(JSON.stringify(r),before);
});
