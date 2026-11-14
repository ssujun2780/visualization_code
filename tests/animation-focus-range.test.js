import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SceneCanvas} from '../src/animation/canvas.js';

test('current-work camera focuses the accessed cell of a large allocation',()=>{
  const object={x:100,y:100,width:4000,height:6000},cell={id:'large@12',objectId:'large',offset:12,size:4,x:300,y:500,width:90,height:60},
    geometry={objects:new Map([['large',object]]),cells:new Map([[cell.id,cell]]),mats:new Map(),containers:new Map(),anchors:new Map()};
  let fitted;const renderer={width:1000,height:400,displayState:s=>s,layout:{resolve:()=>geometry},flowRectangle:SceneCanvas.prototype.flowRectangle,
    camera:{scale:1,fit:r=>{fitted=r;}},onCameraChange:()=>{}};
  SceneCanvas.prototype.focusEvent.call(renderer,{event:{kind:'WRITE',target:{objectId:'large',offset:12,size:4}},after:{}});
  assert.deepEqual(fitted,{x:220,y:420,width:250,height:220});
});

test('current-work camera uses the visible container when a cell is folded',()=>{
  const cell={id:'large@12',objectId:'large',offset:12,size:4,x:300,y:500,width:90,height:60,hidden:true},proxy={x:100,y:50,width:240,height:70},
    geometry={objects:new Map([['large',{x:0,y:0,width:4000,height:6000}]]),cells:new Map([[cell.id,cell]]),mats:new Map(),containers:new Map([['folded',proxy]]),anchors:new Map([[cell.id,'folded']])};
  let fitted;const renderer={width:1000,height:400,displayState:s=>s,layout:{resolve:()=>geometry},flowRectangle:SceneCanvas.prototype.flowRectangle,
    camera:{scale:1,fit:r=>{fitted=r;}},onCameraChange:()=>{}};
  SceneCanvas.prototype.focusEvent.call(renderer,{event:{kind:'WRITE',target:{objectId:'large',offset:12,size:4}},after:{}});
  assert.deepEqual(fitted,{x:20,y:-30,width:400,height:230});
});
