import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures} from '../scripts/inference/structure-inference.mjs';
import {prepareStructures,PreparedStructures} from '../src/animation/prepared-structures.js';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {WorldLayout} from '../src/animation/world.js';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {digest} from '../scripts/execution-relations/v2/common.mjs';
import {cellId} from '../src/animation/memory.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldCamera} from '../src/animation/world.js';
import {dataFlowForEvent} from '../src/animation/transfers.js';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {AvoidLib} from 'libavoid-js';
import {resolve} from 'node:path';

async function setup(r){const inference=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace}),before=digest({r,inference}),data=prepareStructures(r.plan,r.trace,inference);assert.equal(digest({r,inference}),before);
  const prepared=new PreparedStructures(data),recording=createRecording(r.plan,r.trace),player=new Playback(recording),layout=new WorldLayout();layout.resolveType=recording.resolveType;layout.setPrepared(prepared);return {prepared,recording,player,layout};}

test('offline preparation keeps current values, allocation and original field ports in one world',async()=>{
  const r=await frozenInferenceExecution('returned-list'),{prepared,recording,player,layout}=await setup(r),at=r.trace.events.findLastIndex(e=>e.action==='output');
  player.seek(at+1);const scene=displayScene(recording,player.state),geometry=layout.resolve(scene);assert.ok(prepared.tracks.size);
  for(const box of geometry.cells.values()){
    const o=scene.objects.get(box.objectId),actual=(o?.renderCells??[{id:cellId(o.id),value:o.value}]).find(c=>c.id===box.id);assert.ok(actual,'every box has original memory identity');assert.deepEqual(box.value,actual.value);
    assert.ok(box.offset>=0&&box.offset+box.size<=scene.objects.get(box.objectId).size);
  }
  player.seek(0);assert.equal([...layout.resolve(displayScene(recording,player.state)).objects].length,0,'future nodes are not runtime objects');
  assert.equal(prepared.at(r.trace.objects.find(o=>o.cType?.kind==='array').id,-1),null);
});

test('precomputed relation history never replaces a missing interval with final edges',async()=>{
  const r=await frozenInferenceExecution('constant-leaf-range'),{prepared,player,recording,layout}=await setup(r);
  for(const count of [1,Math.floor(r.trace.events.length/2),r.trace.events.findLastIndex(e=>e.action==='output')+1]){
    player.seek(count);const scene=displayScene(recording,player.state),geometry=layout.resolve(scene);for(const id of geometry.objects.keys())assert.ok(scene.objects.has(id));
    for(const t of prepared.tracks.values()){const p=prepared.at(t.objectId,count-1);if(p?.relation?.historyGap){const shown=layout.projection(scene.objects.get(t.objectId)).structure;assert.equal(shown.view,p.view);assert.deepEqual(shown.edges,[]);}}
  }
});

for(const [file,stdout] of [['structure-views/tree.c','1 3 6 8 10 12 14 \n'],['execution-relations/work-grid.c','17 20\n'],['structure-views/pointer-graph.c','10\n'],['execution-relations/work-merge.c','1 2 3 5 6 7 ']]){
  test(`prepared native world: ${file}`,{timeout:60000},async()=>{
    const source=await readFile(`examples/c/${file}`,'utf8'),r=await traceModel(source,{includeObservations:true});
    assert.equal(r.stdout,stdout);
    assert.equal(r.trace.status,'completed');const {prepared,recording,player,layout}=await setup(r),end=r.trace.events.findLastIndex(e=>e.action==='output');player.seek(end+1);
    const scene=displayScene(recording,player.state),geometry=layout.resolve(scene);let shapes=0;
    for(const object of scene.objects.values())if(object.alive&&prepared.tracks.has(object.id)){const p=prepared.at(object.id,end),projection=layout.projection(object);if(projection.structure)shapes++;
      if(file.includes('tree.c')&&object.name==='nodes'){assert.equal(p.view,'bst');assert.equal(projection.structure.nodeRects.size,7);}
      if(file.includes('work-grid')&&object.cType?.kind==='array')assert.equal([...projection.cells.values()].filter(c=>!c.hidden).length,12);
      const visible=[...projection.cells.values()].filter(c=>!c.hidden);for(const c of visible)assert.ok(geometry.ports.has(c.id));
    }assert.ok(shapes>0);
    if(file.includes('tree.c')){
      // The actual original cells must remain reachable through the same
      // transfer/pointer routers, rather than becoming enclosed obstacles.
      const index=r.trace.events.findLastIndex(e=>e.kind==='CALC'&&dataFlowForEvent(recording,e).filter(f=>f.from.kind==='object'&&prepared.tracks.has(f.from.id)).length>=2);
      assert.ok(index>0);player.seek(index);
      const before=displayScene(recording,player.state),after=displayScene(recording,player.after),drawn=[];
      const renderer=Object.create(SceneCanvas.prototype);Object.assign(renderer,{recording,layout,camera:new WorldCamera(),context:new Proxy({globalAlpha:1},{get:(t,k)=>k in t?t[k]:()=>{}})});
      renderer.label=()=>{};renderer.box=()=>{};renderer.routedConnection=p=>drawn.push(p);
      renderer.drawDataFlow(player,before,after);assert.equal(renderer.transferMissing,0);assert.equal(drawn.length,dataFlowForEvent(recording,player.event).length);
      await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));const wiring=new PointerWiring(AvoidLib.getInstance());
      try{const graph=pointerGraph(after,layout.resolve(after)),routed=wiring.update(graph);if(routed.missing.length)await writeFile('test-results/unified-playback/routing-failure.json',JSON.stringify({graph,routed}));assert.deepEqual(routed.missing,[]);assert.equal(routed.quality.nodeCrossings,0);}finally{wiring.dispose();}
    }
    // Stable presentation object and positions across ordinary value events.
    const track=[...prepared.tracks.values()][0];assert.equal(prepared.at(track.objectId,end),prepared.at(track.objectId,end));
  });
}
