import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PreparedStructures} from '../src/animation/prepared-state.js';
import {structuredMemory} from '../src/animation/structured-memory.js';
import {layoutStructure} from '../src/animation/structure-layout.js';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {WorldLayout} from '../src/animation/world.js';

const nodes=Array.from({length:4},(_,index)=>({id:`n${index}`,index,ranges:[{objectId:'o',offset:index*4,size:4}]})),
  object={id:'o',name:'items',size:16,cType:{kind:'array'},renderCells:nodes.map(n=>({id:`o@${n.index*4}`,offset:n.index*4,size:4,path:`[${n.index}]`,cType:{kind:'integer'},value:{decimal:String(n.index+2)}}))};
function prepared(view,presentations){return new PreparedStructures({tracks:[{objectId:'o',variants:{auto:{view,label:view,layoutNodes:nodes,positions:[...layoutStructure({view,nodes,edges:[]}).positions],entries:presentations.map((p,index)=>({index,presentation:{view,label:view,descriptor:{objectId:'o',capacity:4,elementBytes:4},...p}}))}}}]});}
const draw=p=>structuredMemory(object,p,new Set(),new Map());
const geometry=p=>[...draw(p).cells.values()].map(c=>[c.id,c.x,c.y,c.width,c.height,c.shape]);

test('whole-record shape stays circular across empty, occupied, empty and backward seeks',()=>{
  const reader=prepared('queue',[
    {relation:{nodes:[],edges:[],semantic:{}}},
    {relation:{nodes:[nodes[2]],edges:[],semantic:{currentAccess:{moduloCapacity:true},logicalOrder:{start:2,count:1,modulus:4}}}},
    {relation:{nodes:[],edges:[],semantic:{logicalOrder:{start:3,count:0}}}}
  ]),first=reader.at('o',0),expected=geometry(first);
  assert.equal(first.circular,true);assert.ok(new Set(expected.map(c=>c[2])).size>2);
  for(const index of [2,1,0,1,2]){const p=reader.at('o',index);assert.equal(p.circular,true);assert.equal(p.view,'queue');assert.deepEqual(geometry(p),expected);}
  assert.equal([...draw(reader.at('o',1)).cells.values()].filter(c=>!c.inactive).length,1);
  assert.equal([...draw(reader.at('o',2)).cells.values()].filter(c=>!c.inactive).length,0);
  reader.setView('o','array');assert.equal(reader.at('o',0).circular,false,'explicit user shape changes are allowed');
});

test('missing relation and history gap keep the chosen tree, without future edges or properties',()=>{
  const future=nodes.map(n=>({...n,label:'future-key',color:'red',height:9,coverage:{start:0,end:10}})),edge={id:'edge',from:'n0',to:'n1'},reader=prepared('red-black',[
    {relation:null},
    {relation:{nodes,edges:[],historyGap:true}},
    {relation:{nodes:future,edges:[edge]}}
  ]);
  // Final layout metadata is geometry, not permission to show future facts.
  reader.tracks.get('o').variants.auto.layoutNodes=future;
  const expected=geometry(reader.at('o',2));
  for(const index of [0,1,2,0]){
    const drawn=draw(reader.at('o',index));assert.equal(drawn.structure.view,'red-black');assert.deepEqual(geometry(reader.at('o',index)),expected);
    assert.equal([...drawn.cells.values()].filter(c=>c.shape==='circle').length,4);
    assert.equal(drawn.structure.edges.length,index===2?1:0);
    assert.equal(drawn.cells.get('o@0').color,index===2?'red':undefined);
    assert.equal(drawn.cells.get('o@0').nodeLabel,index===2?'future-key':'0');
    assert.equal(drawn.structure.annotations.some(a=>a.text.includes('h: 9')),index===2);
    for(const c of drawn.cells.values())assert.equal(c.value.decimal,object.renderCells.find(v=>v.id===c.id).value.decimal);
  }
});

test('direction, descriptor and subtype come from one prepared appearance, not the cursor',()=>{
  const reader=prepared('graph',[
    {descriptor:{objectId:'o'},relation:{nodes,edges:[],semantic:{}}},
    {descriptor:{objectId:'o',capacity:4,elementBytes:4},relation:{nodes,edges:[],semantic:{directed:true}}}
  ]);
  for(const index of [0,1,0]){assert.equal(reader.at('o',index).directed,true);assert.equal(reader.at('o',index).descriptor.capacity,4);}
});

test('expanding a sparse memory preview does not renumber or move an existing array slot',()=>{
  const reader=prepared('array',[{relation:null}]),p=reader.at('o',0),drawSparse=cells=>structuredMemory({...object,renderCells:cells},p,new Set(),new Map()),
    first=drawSparse([object.renderCells[3]]),later=drawSparse(object.renderCells);
  assert.equal(first.structure.view,'array');assert.deepEqual([first.cells.get('o@12').x,first.cells.get('o@12').y],[later.cells.get('o@12').x,later.cells.get('o@12').y]);
});

for(const [name,view]of [['circular-queue','queue'],['heap','max-heap'],['union-find','disjoint-set'],['range-tree','segment-tree'],['weighted-graph','graph']])test(`archived ${name} keeps its shape and local slots across every prepared boundary`,async t=>{
  let r;try{r=JSON.parse(await readFile(`test-results/structure-shapes/${name}.json`,'utf8'));}catch(e){if(e.code==='ENOENT'){t.skip('prepare archived renderer input first');return;}throw e;}
  const snapshot=JSON.stringify(r),reader=new PreparedStructures(r.preparedScene),recording=createRecording(r.plan,r.trace),player=new Playback(recording),layout=new WorldLayout();
  layout.resolveType=recording.resolveType;layout.setPrepared(reader);
  const track=[...reader.tracks.values()].find(t=>t.variants.auto.view===view),expected=new Map();
  for(const entry of [...track.variants.auto.entries,...track.variants.auto.entries.toReversed()]){
    player.seek(entry.index+1);const scene=displayScene(recording,player.state);layout.resolve(scene);const original=scene.objects.get(track.objectId);if(!original?.alive)continue;
    const projection=layout.projection(original);assert.equal(projection.structure?.view,view);if(view==='queue')assert.equal(projection.structure.circular,true);
    for(const cell of projection.cells.values())if(!cell.hidden){const point=[cell.x,cell.y,cell.width,cell.height,cell.shape],key=view==='disjoint-set'?`${entry.index}:${cell.id}`:cell.id;if(expected.has(key))assert.deepEqual(point,expected.get(key),`slot ${cell.id} moved at ${entry.index}`);else expected.set(key,point);}
  }
  assert.ok(expected.size>0);assert.equal(JSON.stringify(r),snapshot);
});
