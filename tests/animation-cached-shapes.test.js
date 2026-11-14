import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {PreparedStructures} from '../src/animation/prepared-state.js';
import {WorldLayout} from '../src/animation/world.js';
import {structureEdgePaths} from '../src/animation/structure-ink.js';
// Optional archived inputs are prepared with prepare-view-file.mjs. No C
// execution or inference is performed by these renderer integration checks.
for(const [name,view,count]of [['union-find','disjoint-set',6],['circular-queue','queue',5],['heap','max-heap',4],['range-tree','segment-tree',7],['weighted-graph','graph',6]]){
  test(`saved ${name}: original cells and current structural relations`,async t=>{
    let r;try{r=JSON.parse(await readFile(`test-results/structure-shapes/${name}.json`,'utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('prepare archived renderer input first');return;}throw e;}
    const immutable=JSON.stringify(r),recording=createRecording(r.plan,r.trace),p=new Playback(recording),layout=new WorldLayout();layout.resolveType=recording.resolveType;layout.setPrepared(new PreparedStructures(r.preparedScene));
    p.seek(r.trace.events.findLastIndex(e=>e.action==='output')+1);const scene=displayScene(recording,p.state),g=layout.resolve(scene),nodes=[...g.structureNodes.values()].filter(n=>n.view===view);assert.equal(nodes.length,count);
    for(const c of g.cells.values()){const original=scene.objects.get(c.objectId)?.renderCells?.find(v=>v.id===c.id);if(original)assert.deepEqual(c.value,original.value);}
    if(view==='disjoint-set'){assert.equal(g.structureEdges.length,4);assert.equal(g.structureEdges.filter(e=>e.from.nodeLabel==='3').length,1);}
    if(view==='queue')assert.equal(new Set(nodes.map(n=>Math.round(n.y))).size>2,true);
    if(view==='segment-tree')assert.ok(g.structureAnnotations.some(a=>a.text==='[0, 4)'));
    if(view==='graph'){assert.equal(g.structureEdges.length,9);const paths=structureEdgePaths(g.structureEdges,{readRange:r=>[...g.cells.values()].find(c=>c.objectId===r.objectId&&c.offset===r.offset&&c.size===r.size)?.value?.decimal});assert.deepEqual(paths.map(p=>Number(p.text)),[10,30,15,20,5,5,20,5,20]);}
    if(view==='graph'){p.seek(208);const early=layout.resolve(displayScene(recording,p.state)),paths=structureEdgePaths(early.structureEdges,{readRange:r=>[...early.cells.values()].find(c=>c.objectId===r.objectId&&c.offset===r.offset&&c.size===r.size)?.value?.decimal});assert.deepEqual(paths.map(p=>Number(p.text)),[10,30,15,20,5,5,20,5,20],'all initialized global weights are readable before the loop visits them');assert.equal(early.structurePorts.length,9);}
    assert.equal(JSON.stringify(r),immutable);
  });
}
