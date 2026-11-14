import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback,displayScene,emptyScene,formatValue} from '../src/animation/playback.js';
import {WorldLayout,rectangleCenter,containsPoint} from '../src/animation/world.js';
import {containerId,visibleMemoryCells,connectionFocus,focusForTargets} from '../src/animation/object-view.js';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {cellId} from '../src/animation/memory.js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {AvoidLib} from 'libavoid-js';
import {resolve} from 'node:path';

const result=await traceModel(`#include <stdlib.h>
struct Group{int grid[8][16];int *link;};
int main(void){int values[128]={0};int raw[128];raw[0]=7;
int *heap=calloc(128,sizeof(int));int *alias=heap;int **chain=&alias;int *far=heap+90;
struct Group group={0};group.link=heap;heap[0]=10;heap[90]=20;heap[127]=30;return values[0];}`);
const recording=createRecording(result.plan,result.trace),player=new Playback(recording);
player.seek(result.trace.events.findIndex(e=>e.action==='return.value'));
const scene=displayScene(recording,player.state),named=name=>[...scene.objects.values()].find(o=>o.name===name);
const heap= [...scene.objects.values()].find(o=>o.storage==='heap');
const layoutFor=()=>{const layout=new WorldLayout();layout.resolveType=recording.resolveType;return layout;};

test('drawer resizing shows more/fewer current cells without changing default geometry or execution state',()=>{
  const layout=layoutFor(),before=layout.resolve(scene),snapshot=JSON.stringify(result),state=structuredClone(player.state);
  for(const object of [named('values'),heap,named('raw')]){
    const root=containerId(object.id),initial=layout.resolve(scene).containers.get(root);
    assert.ok(initial);assert.equal(layout.windows.has(root),false);
    const baseline=visibleMemoryCells(layout.projection(object).memory,layout.resolve(scene)).length;
    layout.resizeContainer(initial,900,500);const enlarged=layout.resolve(scene);
    assert.equal(enlarged.containers.get(root).width,900);assert.equal(enlarged.containers.get(root).height,500);
    const visible=visibleMemoryCells(layout.projection(object).memory,enlarged);assert.ok(visible.length>baseline);
    for(const cell of visible){assert.ok(containsPoint(enlarged.containers.get(root),cell));assert.ok(containsPoint(enlarged.containers.get(root),{x:cell.x+cell.width,y:cell.y+cell.height}));}
    if(object.id===named('raw').id)assert.equal(visible.find(c=>c.offset===52).value,null,'unobserved malloc/automatic bytes do not acquire invented values');
    layout.resizeContainer(initial,250,160);const small=layout.resolve(scene);
    assert.equal(visibleMemoryCells(layout.projection(object).memory,small).length,2);
    assert.equal(layout.hitTest(scene,rectangleCenter(small.containers.get(root).resizeHandle)).kind,'resize');
    layout.toggleContainer(root);assert.equal(layout.resolve(scene).containers.get(root).collapsed,true);
    layout.toggleContainer(root);assert.equal(layout.resolve(scene).containers.get(root).width,250);
  }
  assert.equal(layout.windows.size,3);assert.deepEqual(player.state,state);assert.equal(JSON.stringify(result),snapshot);
  assert.deepEqual(before.objects.get(heap.id),layoutFor().resolve(scene).objects.get(heap.id),'a fresh viewer retains the original default');
});

test('hidden pointer cells use drawer ports and recover their exact endpoints after expansion',()=>{
  const layout=layoutFor(),root=containerId(heap.id),initial=layout.resolve(scene).containers.get(root);
  const original=pointerGraph(scene,layout.resolve(scene));
  layout.resizeContainer(initial,250,160);let geometry=layout.resolve(scene),graph=pointerGraph(scene,geometry);
  const far=graph.edges.find(e=>e.sourceObjectId===named('far').id);
  assert.equal(far.targetLogicalId,cellId(heap.id,360));assert.equal(far.target,root);
  assert.equal(geometry.cells.get(far.targetLogicalId).hidden,true);
  layout.resizeContainer(initial,900,1500);geometry=layout.resolve(scene);graph=pointerGraph(scene,geometry);
  assert.equal(graph.edges.find(e=>e.id===far.id).target,far.targetLogicalId);
  assert.deepEqual(graph.edges.map(e=>[e.id,e.sourceLogicalId,e.targetLogicalId]),original.edges.map(e=>[e.id,e.sourceLogicalId,e.targetLogicalId]));
});

test('nested drawers resize independently and expanded current cells never reveal a later WRITE',()=>{
  const layout=layoutFor(),group=named('group'),rowId=containerId(group.id,'.grid[0]');
  const row=layout.resolve(scene).containers.get(rowId);assert.ok(row);
  layout.resizeContainer(row,1000,300);assert.equal(layout.resolve(scene).containers.get(rowId).width,1000);
  const write=result.trace.events.findIndex(e=>e.kind==='WRITE'&&e.target?.objectId===heap.id&&e.target.offset===360);
  const prior=new Playback(recording);prior.seek(write);const before=displayScene(recording,prior.state),after=displayScene(recording,prior.after);
  layout.resizeContainer(layout.resolve(after).containers.get(containerId(heap.id)),900,1500);
  const cell=visibleMemoryCells(layout.projection(before.objects.get(heap.id)).memory,layout.resolve(after)).find(c=>c.offset===360);
  assert.equal(formatValue(cell.value),'0');assert.equal(formatValue(layout.projection(after.objects.get(heap.id)).memory.renderCells.find(c=>c.offset===360).value),'20');
});

test('enormous allocations keep a bounded preview when a drawer is expanded',()=>{
  const layout=layoutFor(),state=emptyScene(),element={kind:'scalar',name:'int',sizeBits:32,signedness:'signed'};
  const object={id:'huge',name:'huge',storage:'heap',size:400000000,alive:true,cType:{kind:'array',count:100000000,sizeBits:3200000000,elementType:element},cells:new Map(),regions:[],observedOffsets:new Set(),exposedOffsets:new Set(),renderCells:[]};
  state.objects.set(object.id,object);
  layout.resizeContainer({id:containerId(object.id),objectId:object.id,offset:0,size:object.size},1e9,1e9);
  assert.ok(layout.projection(object).memory.renderCells.length<=2060);
  assert.equal(layout.projection(object).width,4096);assert.equal(layout.projection(object).height,4096);
});

test('pointer focus follows complete cyclic/alias components, never containment or layout proxies',()=>{
  const edges=[{id:'pp',sourceLogicalId:'pp',targetLogicalId:'p'},{id:'p',sourceLogicalId:'p',targetLogicalId:'v'},
    {id:'alias',sourceLogicalId:'q',targetLogicalId:'v'},{id:'cycle',sourceLogicalId:'v',targetLogicalId:'pp'},
    {id:'other',sourceLogicalId:'array.child',targetLogicalId:'other'},{id:'parent',sourceLogicalId:'rootptr',targetLogicalId:'array'}];
  for(const selection of [{kind:'cell',logicalId:'v'},{kind:'wire',id:'pp'}]){
    const focus=connectionFocus(selection,edges);assert.deepEqual(focus.edges,new Set(['pp','p','alias','cycle']));
    assert.deepEqual(focus.logicalIds,new Set(['pp','p','q','v']));
  }
  assert.deepEqual(connectionFocus({kind:'aggregate',logicalId:'array'},edges).edges,new Set(['parent']));
  const layout=layoutFor(),geometry=layout.resolve(scene),graph=pointerGraph(scene,geometry);
  const operation=focusForTargets([{objectId:heap.id,offset:0,size:4}],geometry),focus=connectionFocus(operation,graph.edges);
  for(const name of ['alias','chain'])assert.ok(focus.logicalIds.has(cellId(named(name).id)));
  assert.equal(focus.edges.has(cellId(named('far').id)),false,'another element in the same array is not the same target');
});

test('resized visible and proxy pointer endpoints remain routable around boxes and fields',async()=>{
  await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
  const engine=new PointerWiring(AvoidLib.getInstance()),layout=layoutFor();
  try{
    const drawer=layout.resolve(scene).containers.get(containerId(heap.id));
    for(const [width,height] of [[250,160],[900,500],[900,1500],[250,160]]){
      layout.resizeContainer(drawer,width,height);
      const graph=pointerGraph(scene,layout.resolve(scene)),result=engine.update(graph);
      assert.deepEqual(result.missing,[]);assert.equal(result.quality.nodeCrossings,0);
    }
  }finally{engine.dispose();}
});
