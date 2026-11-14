import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutStructure} from '../src/animation/structure-layout.js';
import {structuredMemory} from '../src/animation/structured-memory.js';
import {structureEdgePaths} from '../src/animation/structure-ink.js';
import {PreparedStructures} from '../src/animation/prepared-state.js';
const nodes=Array.from({length:6},(_,i)=>({id:`n${i}`,index:i,ranges:[{objectId:'o',offset:i*4,size:4}]}));
const object={id:'o',name:'storage',size:24,cType:{kind:'array',dimensions:[2,3]},renderCells:nodes.map((n,i)=>({id:`o@${i*4}`,offset:i*4,size:4,path:`[${i}]`,cType:{kind:'integer'},value:{decimal:String(i+10)}}))};
const edges=[{id:'e0',from:'n0',to:'n1'},{id:'e1',from:'n0',to:'n2'},{id:'e2',from:'n2',to:'n3'}];
function presentation(view,extra={}){const p={view,label:view,descriptor:{objectId:'o',capacity:6,elementBytes:4},relation:{id:'r',nodes,edges,rootNodeIds:['n0']},layoutNodes:nodes,...extra};p.positions=[...layoutStructure({view,nodes,edges:p.relation.edges,roots:['n0'],variant:p.variant,semantic:p.relation.semantic}).positions];return p;}
test('circular queue uses fixed physical slots, explicit cursors and current values',()=>{
  const p=presentation('queue',{variant:'circular',relation:{id:'r',nodes:[nodes[4],nodes[5],nodes[0]],edges:[],semantic:{head:4,tail:1,capacity:6,logicalOrder:{start:4,count:3,modulus:6,direction:1}}}}),before=structuredClone(object),a=structuredMemory(object,p,new Set(),new Map()),b=structuredMemory(object,{...p,relation:{...p.relation,semantic:{...p.relation.semantic,head:5,logicalOrder:{start:5,count:2,modulus:6}}}},new Set(),new Map());
  assert.equal(a.structure.circular,true);assert.equal(a.cells.size,6);assert.equal(new Set([...a.cells.values()].map(c=>c.y)).size>2,true);
  for(const [id,c]of a.cells){assert.deepEqual([c.x,c.y],[b.cells.get(id).x,b.cells.get(id).y]);assert.deepEqual(c.value,object.renderCells.find(v=>v.id===id).value);}
  assert.equal([...a.cells.values()].filter(c=>!c.inactive).length,3);assert.equal([...b.cells.values()].filter(c=>!c.inactive).length,2);assert.ok(a.structure.annotations.some(a=>a.text==='front'));assert.ok(a.structure.annotations.some(a=>a.text==='rear'));assert.deepEqual(object,before);
});
for(const view of ['array','grid','dynamic-array','string','stack','queue','deque','linked-list','tree','binary-tree','bst','avl','red-black','forest','min-heap','max-heap','graph','dag','trie','hash-table','disjoint-set','segment-tree','fenwick-tree','range-aggregate']){
  test(`${view}: shape preserves source cells, identities and values`,()=>{const p=presentation(view),snapshot=structuredClone({object,p}),v=structuredMemory(object,p,new Set(),new Map());assert.equal(v.cells.size,6);for(const c of v.cells.values()){const original=object.renderCells.find(o=>o.id===c.id);assert.ok(original);assert.deepEqual(c.value,original.value);assert.ok(c.offset>=0&&c.offset+c.size<=object.size);}assert.deepEqual({object,p},snapshot);assert.ok(v.width>0&&v.height>0);});
}
test('stack, grid, trie labels, range coverage, buckets and parent relationships affect only presentation',()=>{
  const stack=structuredMemory(object,presentation('stack'),new Set(),new Map());assert.ok(stack.cells.get('o@0').y>stack.cells.get('o@20').y);
  const grid=structuredMemory(object,presentation('grid'),new Set(),new Map());assert.equal(new Set([...grid.cells.values()].map(c=>c.y)).size,2);
  const rangeNodes=nodes.map((n,i)=>({...n,coverage:{start:i,end:i+1},bucket:i%2})),range=structuredMemory(object,presentation('segment-tree',{layoutNodes:rangeNodes,relation:{id:'r',nodes:rangeNodes,edges}}),new Set(),new Map());assert.ok(range.structure.annotations.some(a=>a.text==='[0, 1)'));
  const parentNodes=nodes.map((n,i)=>({...n,parent:i===0?0:i===5?5:i-1})),layout=layoutStructure({view:'disjoint-set',nodes:parentNodes,edges:[]});assert.ok(layout.positions.get('n0').y<layout.positions.get('n4').y);assert.equal(layout.positions.get('n0').y,layout.positions.get('n5').y);
});
test('directed, undirected, parallel and self edges preserve endpoints and weights',()=>{
  const a={x:10,y:80,width:84,height:84,shape:'circle'},b={x:250,y:80,width:84,height:84,shape:'circle'},ab={id:'ab',fromNodeId:'a',toNodeId:'b',from:a,to:b,directed:true,weightRange:{objectId:'w',offset:0,size:4}},ba={id:'ba',fromNodeId:'b',toNodeId:'a',from:b,to:a,directed:true,weight:7},loop={...ab,id:'loop',toNodeId:'a',to:a,weight:9,weightRange:null},snapshot=structuredClone([ab,ba,loop]);
  const paths=structureEdgePaths([ab,ba,loop],{readRange:()=>3});assert.equal(paths.length,3);assert.equal(paths[0].text,'3');assert.notDeepEqual(paths[0].label,paths[1].label);assert.ok(paths[2].loop);assert.deepEqual([ab,ba,loop],snapshot);
  const undirected=structureEdgePaths([{...ab,directed:false,weightRange:null,weight:7},{...ba,directed:false}]);assert.equal(undirected.length,1);assert.deepEqual(undirected[0].ids,['ab','ba']);
  const single=structureEdgePaths([ab],{readRange:()=>3}),changed=structureEdgePaths([ab],{readRange:()=>11});assert.equal(changed[0].text,'11');assert.deepEqual(changed[0].points,single[0].points);
  assert.ok(Math.abs(Math.hypot(single[0].points[0].x-52,single[0].points[0].y-122)-42)<1e-6);
  assert.ok(Math.abs(Math.hypot(single[0].points.at(-1).x-292,single[0].points.at(-1).y-122)-42)<1e-6);
  assert.equal(structureEdgePaths([{...ab,labels:['stale weight']}])[0].text,'?');
});
test('multi-key record, confirmed colour and height remain presentation metadata',()=>{
  const root={id:'root',ranges:[{objectId:'o',offset:0,size:24}]},p=presentation('b-tree',{layoutNodes:[root],relation:{id:'r',nodes:[root],edges:[]}}),v=structuredMemory(object,p,new Set(),new Map());
  assert.equal(v.structure.nodeRects.size,1);assert.equal([...v.cells.values()].filter(c=>!c.hidden).length,6);assert.equal(new Set([...v.cells.values()].map(c=>c.y)).size,1);assert.equal(new Set([...v.cells.values()].map(c=>c.x)).size,6);
  const attributed=nodes.map((n,i)=>({...n,color:i%2?'red':'black',height:i})),coloured=structuredMemory(object,presentation('red-black',{layoutNodes:attributed,relation:{id:'r',nodes:attributed,edges}}),new Set(),new Map());assert.equal(coloured.cells.get('o@4').color,'red');assert.ok(coloured.structure.annotations.some(a=>a.text==='h: 1'));assert.equal(coloured.cells.get('o@4').value.decimal,'11');
});
test('manual shape/direction keeps prepared recording and relation history immutable',()=>{
  const p=presentation('array'),data={tracks:[{objectId:'o',variants:{auto:{view:'array',positions:p.positions,layoutNodes:nodes,entries:[{index:0,presentation:p}]}}}]},snapshot=structuredClone(data),reader=new PreparedStructures(data);
  reader.setView('o','circular-queue');const q=reader.at('o',0);assert.equal(q.view,'queue');assert.equal(q.variant,'circular');reader.setView('o','graph');reader.setOptions('o',{directed:false});assert.equal(reader.at('o',0).directed,false);assert.equal(reader.at('o',0),reader.at('o',0));assert.deepEqual(data,snapshot);
});
test('an array of records keeps each record together instead of flattening its members',()=>{
  const recordArray={...object,cType:{kind:'array',elementType:{kind:'record',sizeBits:96}}},p=presentation('array',{descriptor:{objectId:'o',capacity:2,elementBytes:12}}),v=structuredMemory(recordArray,p,new Set(),new Map());
  assert.equal(v.structure.nodeRects.size,2);assert.equal(v.cells.size,6);assert.equal(v.cells.get('o@0').x,v.cells.get('o@4').x);assert.notEqual(v.cells.get('o@0').x,v.cells.get('o@12').x);
});
test('DAG layers follow every predecessor while retaining shared children',()=>{
  const graph={view:'dag',nodes:nodes.slice(0,4),edges:[{from:'n0',to:'n3'},{from:'n0',to:'n1'},{from:'n1',to:'n2'},{from:'n2',to:'n3'}]},snapshot=structuredClone(graph),p=layoutStructure(graph).positions;
  for(const e of graph.edges)assert.ok(p.get(e.from).y<p.get(e.to).y);assert.deepEqual(graph,snapshot);
});
