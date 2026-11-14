import assert from 'node:assert/strict';
import {test} from 'node:test';
import {layoutStructure} from '../src/animation/structure-layout.js';
import {structuredMemory} from '../src/animation/structured-memory.js';
import {SceneCanvas} from '../src/animation/canvas.js';

const nodes=Array.from({length:8},(_,index)=>({id:`n${index}`,index,ranges:[{objectId:'o',offset:index*36,size:36}]}));
const edges=Array.from({length:6},(_,i)=>[{id:`a${i}`,from:'n0',to:`n${i+1}`},{id:`b${i}`,from:`n${i+1}`,to:'n7'}]).flat();
test('wide graph layers keep sibling vertices on one readable row',()=>{
  const positions=layoutStructure({view:'graph',nodes,edges}).positions;
  assert.equal(new Set(nodes.slice(1,7).map(n=>positions.get(n.id).y)).size,1);
  assert.equal(new Set(nodes.slice(1,7).map(n=>positions.get(n.id).x)).size,6);
  assert.ok(positions.get('n0').y<positions.get('n1').y&&positions.get('n7').y>positions.get('n1').y);
});
test('compact graph retains every original field and uses representative ports for hidden fields',()=>{
  const cells=Array.from({length:72},(_,i)=>({id:`c${i}`,offset:i*4,size:4,path:`[${Math.floor(i/9)}].v${i%9}`,cType:{kind:'integer'},value:{decimal:String(i)}}));
  const object={id:'o',name:'records',size:288,cType:{kind:'array',elementType:{kind:'record',sizeBits:288}},renderCells:cells};
  const shape={view:'graph',label:'graph',layoutNodes:nodes,relation:{id:'g',nodes,edges},positions:[...layoutStructure({view:'graph',nodes,edges}).positions]};
  const result=structuredMemory(object,shape,new Set(),new Map());
  assert.equal(result.structure.nodeRects.size,8);
  assert.equal([...result.cells.values()].filter(c=>!c.hidden&&!c.compactPointer).length,8);
  assert.equal(result.cells.size,72);
  for(const cell of cells){const actual=result.cells.get(cell.id);assert.equal(actual.value,cell.value);
    assert.equal(actual.offset,cell.offset);assert.equal(actual.size,cell.size);assert.ok(result.anchors.has(cell.id));
    if(actual.hidden)assert.notEqual(result.anchors.get(cell.id),`c${Math.floor(cell.offset/36)*9}`,'hidden fields do not impersonate the visible scalar');
  }
});
test('current-work focus includes the complete graph rather than one vertex cell',()=>{
  let fitted;
  const object={id:'o'},box={x:100,y:200,width:900,height:500},scene={objects:new Map([['o',object]])},
    geometry={objects:new Map([['o',box]]),cells:new Map(),mats:new Map()};
  const renderer={displayState:()=>scene,layout:{resolve:()=>geometry,projection:()=>({structure:{view:'graph'}})},
    flowRectangle:()=>({x:150,y:250,width:84,height:84}),camera:{scale:1,fit:r=>{fitted=r}},width:1000,height:600,onCameraChange:()=>{}};
  SceneCanvas.prototype.focusEvent.call(renderer,{event:{kind:'READ',action:'read',target:{objectId:'o',offset:0,size:4}},after:{}});
  assert.deepEqual(fitted,{x:76,y:176,width:948,height:548});
});
