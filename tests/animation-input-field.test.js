import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldLayout,WorldCamera} from '../src/animation/world.js';
import {emptyScene} from '../src/animation/playback.js';
import {inputFieldPose,positionInputField} from '../src/animation/input-field.js';

test('the editable input stays inside its movable world mat through pan, zoom, reset and offscreen culling',()=>{
  const layout=new WorldLayout(),camera=new WorldCamera(),state=emptyScene();
  const element={hidden:false,style:{},value:'draft input\nunchanged'};
  const renderer={layout,camera,width:1200,height:900};
  for(const [x,y,scale] of [[50,500,1],[-400,300,0.5],[900,-200,2],[-20000,-30000,0.1]]) {
    layout.move('tool:input',{x,y});layout.resolve(state);camera.scale=scale;camera.pan(25,-15);
    const pose=positionInputField(element,renderer),world=camera.toWorld(pose),mat=layout.toolRectangle('tool:input');
    assert.equal(world.x,mat.x+16);assert.equal(world.y,mat.y+52);
    assert.ok(world.x+pose.width<mat.x+mat.width);assert.ok(world.y+pose.height<mat.y+mat.height);
    assert.equal(element.hidden,!pose.visible);assert.equal(element.value,'draft input\nunchanged');
    assert.equal(pose.scale,scale);assert.equal(element.style.width,`${pose.width}px`);
  }
  assert.equal(element.hidden,true);layout.reset();layout.resolve(state);camera.x=0;camera.y=0;camera.scale=1;
  assert.equal(inputFieldPose(layout,camera,1200,900).visible,true);
});
