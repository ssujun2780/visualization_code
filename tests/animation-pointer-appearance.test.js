import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pointerAppearance} from '../src/animation/pointer-appearance.js';
import {SceneCanvas} from '../src/animation/canvas.js';

const pointer={kind:'pointer'},array={kind:'array',elementType:pointer},record={kind:'record'},
  source=(...types)=>({ancestors:types.map(cType=>({cType}))}),idle={active:false,edges:new Set()};

test('ordinary pointer ink stays below structural relations at ordinary and overview zoom',()=>{
  for(const scale of [1,.12])for(const cell of [undefined,source(record),source({kind:'array',elementType:record},record)]){
    const p=pointerAppearance('reference',idle,{scale,source:cell});
    assert.equal(p.color,'#628da7');assert.equal(p.opacity,.4);assert.equal(p.haloWidth,undefined);
    assert.ok(p.width*scale<=1.2);assert.ok(p.head*scale<=4);
  }
});

test('pointer arrays retain their former colours, halo and overview legibility including nested and folded cells',()=>{
  for(const scale of [1,.12])for(const cell of [source(array),source(record,array),source({kind:'array',elementType:array},array)]){
    const colours=new Set();
    for(const id of ['left','right','third','fourth']){
      const p=pointerAppearance(id,idle,{scale,source:{...cell,hidden:true}});colours.add(p.color);
      assert.equal(p.opacity,.86);assert.equal(p.width,Math.max(1.5,1.2/scale));
      assert.equal(p.haloWidth,p.width+1.6/scale);assert.equal(p.head,Math.max(5,5/scale));
      assert.deepEqual(p,pointerAppearance(id,idle,{scale,source:cell}));
    }
    assert.ok(colours.size>1);
  }
});

test('explicit connected-component emphasis and unrelated dimming retain the same existing style',()=>{
  const focus={active:true,edges:new Set(['selected'])};
  for(const scale of [1,.12])for(const cell of [undefined,source(record),source(array)]){
    assert.deepEqual(pointerAppearance('selected',focus,{scale,source:cell}),{
      color:'#9ed9ff',opacity:1,width:Math.max(2.7,1.8/scale),head:5});
    assert.deepEqual(pointerAppearance('unrelated',focus,{scale,source:cell}),{
      color:'#628da7',opacity:.12,width:Math.max(1.5,.8/scale),head:5});
  }
});

test('shared renderer passes original source cell identity to ink without changing paths or hit targets',()=>{
  const strokes=[],c={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth,opacity:this.globalAlpha});}},
    paths=['plain','array'].map((id,i)=>({id,points:[{x:10,y:10+i*20},{x:40,y:10+i*20}]})),
    cells=new Map([['plain-cell',{label:'p',...source(record)}],['array-cell',{label:'[0]',...source(record,array)}]]),
    edges=paths.map(p=>({id:p.id,sourceLogicalId:`${p.id}-cell`,targetLogicalId:'target'})),geometry={cells,containers:new Map()},renderer=Object.create(SceneCanvas.prototype);
  Object.assign(renderer,{context:c,camera:{scale:.12,visible:()=>true},layout:{resolve:()=>geometry},wireFocus:idle,
    wireBoundaries:[{paths}],boundaryGraphs:[{edges,inactive:[]}],label(){}});
  renderer.drawWires({recording:{instructions:new Map()},event:null,progress:0},{},{});
  assert.equal(strokes[0].color,'#628da7');assert.equal(strokes[0].opacity,.4);
  assert.ok(strokes.some(s=>s.color!=='#628da7'&&s.opacity===.86));
  assert.deepEqual(renderer.visibleWires.map(w=>[w.id,w.points]),paths.map(w=>[w.id,w.points]));
});
