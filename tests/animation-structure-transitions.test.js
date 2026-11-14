import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PreparedStructures} from '../src/animation/prepared-state.js';
import {structuredMemory} from '../src/animation/structured-memory.js';
import {relationChanges,nodeState} from '../src/animation/structure-history.js';
import {interpolateStructureGeometry,geometryChanges,attachMovingRoute,motionProgress,mixFill,semanticFill} from '../src/animation/structure-motion.js';
import {WorldLayout} from '../src/animation/world.js';
import {emptyScene} from '../src/animation/playback.js';
import {layoutSnapshot,restoreLayout} from '../src/animation/presentation-journal.js';
import {commandTimeline} from '../src/animation/timing.js';

const nodes=Array.from({length:4},(_,i)=>({id:`id-${i}`,index:i,ranges:[{objectId:'store',offset:i*4,size:4}],color:i===1?'red':'black'})),
  link=(id,from,to)=>({id,from:nodes[from].id,to:nodes[to].id}),a=[link('right-a',0,1),link('left-b',1,2)],b=[link('left-b',1,0),link('right-a',0,2)];
const presentation=(rows,edges,roots)=>({view:'red-black',label:'RB',afterExecutionId:'e',descriptor:{objectId:'store'},relation:{id:'tree',nodes:rows,edges,rootNodeIds:roots}});
function readerFor(view='red-black',rows=nodes,descriptor={objectId:'store'},relations){
  const entries=relations??[presentation(rows,a,[rows[0].id,rows[3]?.id].filter(Boolean)),presentation(rows.map(n=>({...n,color:n.id===rows[1].id?'black':n.color})),a,[rows[0].id,rows[3]?.id].filter(Boolean)),presentation(rows,b,[rows[1].id,rows[3]?.id].filter(Boolean))];
  return new PreparedStructures({tracks:[{objectId:'store',variants:{auto:{view,label:view,layoutNodes:rows,entries:entries.map((p,index)=>({index,presentation:{...p,view,descriptor}}))}}}]});
}
const object={id:'store',name:'unrelated-name',alive:true,storage:'stack',frameId:'main',size:16,cType:{kind:'array'},renderCells:nodes.map((n,i)=>({id:`store@${i*4}`,offset:i*4,size:4,path:`[${i}]`,cType:{kind:'integer'},value:{decimal:'7'}}))};
object.cType={kind:'array',count:4,sizeBits:128,elementType:{kind:'integer',name:'int',sizeBits:32}};
object.cells=new Map(object.renderCells.map(c=>[c.offset,{...c,cType:object.cType.elementType}]));
const view=(reader,index,obj=object)=>structuredMemory(obj,reader.at('store',index),new Set(),new Map());
const positions=v=>[...v.cells].map(([id,c])=>[id,c.x,c.y]);

test('current topology sets root depth; recolour keeps geometry and rotation moves the same identities',()=>{
  const r=readerFor(),snapshot=JSON.stringify(r.data),first=view(r,0),colour=view(r,1),rotated=view(r,2);
  assert.ok(first.cells.get('store@0').y<first.cells.get('store@4').y,'future root cannot be above the current root');
  assert.deepEqual(positions(first),positions(colour));assert.equal(colour.cells.get('store@4').color,'black');
  assert.ok(rotated.cells.get('store@4').y<rotated.cells.get('store@0').y);assert.ok(rotated.cells.get('store@0').y<rotated.cells.get('store@8').y);
  assert.deepEqual(positions(rotated).find(p=>p[0]==='store@12'),positions(first).find(p=>p[0]==='store@12'),'separate unchanged tree stays put');
  for(const index of [2,0,1,2,1,0])assert.deepEqual(positions(view(r,index)),positions([first,colour,rotated][index]));
  assert.equal(JSON.stringify(r.data),snapshot);
});

test('shared/cyclic intermediate writes keep their recorded connections without fabricating a valid tree',()=>{
  const start=presentation(nodes,a,['id-0','id-3']),cycle=presentation(nodes,[...a,link('back',2,0)],['id-0']),end=presentation(nodes,b,['id-1','id-3']),r=readerFor('bst',nodes,{objectId:'store'},[start,cycle,end]);
  assert.deepEqual(positions(view(r,1)),positions(view(r,0)));assert.equal(view(r,1).structure.edges.length,3);
  assert.notDeepEqual(positions(view(r,2)),positions(view(r,1)));
});

test('change records keep IDs/ranges and never infer visit, copying or balance from equal values',()=>{
  const r=readerFor(),changes=r.at('store',1).changes;
  assert.equal(changes.filter(c=>c.field==='color').length,1);assert.deepEqual(changes[0].ranges,nodes[1].ranges);assert.equal(changes[0].index,1);
  assert.equal(relationChanges(null,presentation(nodes,a,[]).relation,0,'x').length,0);
  assert.equal(relationChanges({historyGap:true},presentation(nodes,a,[]).relation,0,'x').length,0);
  assert.equal(nodeState({status:'observed'}),undefined);assert.equal(nodeState({value:1}),undefined);assert.equal(nodeState({visited:true}),'visited');
  assert.equal(nodeState({settled:true,visited:true}),'settled');
  assert.ok(r.at('store',2).changes.some(c=>c.kind==='connection'));
});

test('array heap slots stay fixed while pointer hierarchies and current membership may change',()=>{
  const indexed=readerFor('max-heap',nodes,{objectId:'store',elementBytes:4,capacity:4}),pointer=readerFor('min-heap',nodes.map(({index,...n})=>n));
  assert.deepEqual(positions(view(indexed,0)),positions(view(indexed,2)));
  assert.notDeepEqual(positions(view(pointer,0)),positions(view(pointer,2)));
});

test('confirmed multi-key ranges separate key slots from administrative bytes and keep original cells',()=>{
  const row={id:'group',ranges:[{objectId:'store',offset:0,size:16}],keyRanges:[{objectId:'store',offset:4,size:4},{objectId:'store',offset:8,size:4}]},p=presentation([row],[],['group']),r=readerFor('2-3-4-tree',[row],{objectId:'store'},[p]),v=view(r,0);
  const keys=[...v.cells.values()].filter(c=>c.keyRole),admin=[...v.cells.values()].filter(c=>c.administrative);
  assert.deepEqual(keys.map(c=>c.offset),[4,8]);assert.deepEqual(admin.map(c=>c.offset),[0,12]);
  assert.ok(admin.every(c=>c.y>keys[0].y));assert.equal(v.cells.size,4);for(const c of v.cells.values())assert.equal(c.value.decimal,'7');
});

test('confirmed traversal state is separate from semantic colour and may be reversed by later records',()=>{
  const rows=nodes.map(n=>({...n,visited:true})),r=readerFor('graph',nodes,{objectId:'store'},[presentation(nodes,[],[]),presentation(rows,[],[]),presentation(nodes,[],[])]);
  assert.equal(view(r,0).cells.get('store@4').nodeState,undefined);assert.equal(view(r,1).cells.get('store@4').nodeState,'visited');
  assert.equal(view(r,1).cells.get('store@4').color,'red');assert.equal(view(r,2).cells.get('store@4').nodeState,undefined);
});

test('separately allocated nodes use time-aware placement; pins and sparse journal restoration remain valid',()=>{
  const rows=nodes.slice(0,3).map((n,i)=>({...n,ranges:[{objectId:'alloc'+i,offset:0,size:4}]})),r=readerFor('bst',rows),layout=new WorldLayout();layout.setPrepared(r);
  const state=index=>{const s=emptyScene();s.boundaryIndex=index;s.frames.set('main',{id:'main',name:'main',alive:true});for(let i=0;i<3;i++)s.objects.set('alloc'+i,{id:'alloc'+i,name:'x',alive:true,storage:'heap',size:4,cType:{kind:'integer'},value:{decimal:'7'}});return s;};
  const first=state(0),last=state(2);layout.resolve(first);const saved=layoutSnapshot(layout),before={...layout.positions.get('object:alloc0')};
  layout.resolve(last);assert.notDeepEqual(layout.positions.get('object:alloc0'),before);restoreLayout(layout,saved);layout.resolve(first);assert.deepEqual(layout.positions.get('object:alloc0'),before);
  layout.move('object:alloc0',{x:1700,y:1500});layout.resolve(last);assert.deepEqual(layout.positions.get('object:alloc0'),{x:1700,y:1500});
});

test('midpoint drawing, hit targets, structure edges and pointer endpoints share the same interpolation',()=>{
  const r=readerFor(),layout=new WorldLayout();layout.setPrepared(r);const scene=index=>{const s=emptyScene();s.boundaryIndex=index;s.frames.set('main',{id:'main',name:'main',alive:true});s.objects.set('store',object);return s;};
  const old=layout.resolve(scene(0)),next=layout.resolve(scene(2)),original=JSON.stringify([...next.cells]),middle=interpolateStructureGeometry(old,next,.5),id='store@0';
  assert.equal(middle.cells.get(id).y,(old.cells.get(id).y+next.cells.get(id).y)/2);assert.equal(middle.ports.get(id).y,middle.cells.get(id).y);
  for(const e of middle.structureEdges)assert.equal(e.from.y,middle.structureNodes.get(`${e.from.relationId}:${e.fromNodeId}`).y);
  layout.motionGeometry=new Map([[2,middle]]);assert.equal(layout.resolve(scene(2)),middle);
  const c=middle.cells.get(id),hit=layout.hitTest(scene(2),{x:c.x+c.width/2,y:c.y+c.height/2});assert.equal(hit.logicalId,id);
  const a=new Map([['a',{x:0,y:0,width:10,height:10}],['b',{x:100,y:0,width:10,height:10}]]),b=new Map([['a',{x:20,y:30,width:10,height:10}],['b',{x:110,y:40,width:10,height:10}]]),route={source:'a',target:'b',points:[{x:10,y:5},{x:100,y:5}]},m=attachMovingRoute(route,a,b);
  assert.deepEqual(m.points[0],{x:30,y:35});assert.deepEqual(m.points.at(-1),{x:110,y:45});for(let i=1;i<m.points.length;i++)assert.ok(m.points[i].x===m.points[i-1].x||m.points[i].y===m.points[i-1].y);
  assert.equal(JSON.stringify([...next.cells]),original);
});

test('colour and movement use the existing apply/hold interval and retained values never imply transport',()=>{
  const timeline=commandTimeline({kind:'WRITE'},0,false);assert.equal(motionProgress(timeline,timeline.valueAt-1,false),0);
  assert.equal(motionProgress(timeline,timeline.valueAt,true),0);assert.equal(motionProgress(timeline,timeline.fade.start,true),1);
  assert.notEqual(mixFill('red','black',.5),semanticFill('red'));assert.equal(mixFill('red','black',1),semanticFill('black'));
  const r=readerFor(),layout=new WorldLayout();layout.setPrepared(r);const s=emptyScene();s.frames.set('main',{id:'main',name:'main',alive:true});s.objects.set('store',object);s.boundaryIndex=0;
  const before=layout.resolve(s),after=layout.resolve({...s,boundaryIndex:1}),changes=geometryChanges(before,after);assert.equal(changes.filter(c=>c.kind==='value').length,0);assert.equal(changes.filter(c=>c.field==='color').length,1);
});
