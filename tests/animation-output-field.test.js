import assert from 'node:assert/strict';
import {test} from 'node:test';
import {updateOutputField} from '../src/animation/output-field.js';
import {positionInputField} from '../src/animation/input-field.js';
import {WorldLayout,WorldCamera} from '../src/animation/world.js';
import {emptyScene} from '../src/animation/playback.js';

test('output keeps every line, follows new output at the end, and preserves manual inspection',()=>{
  const element={textContent:'',clientHeight:100,scrollTop:0,get scrollHeight(){return this.textContent.split('\n').length*20;}};
  const text=Array.from({length:1000},(_,i)=>String(i+1)).join('\n');
  assert.equal(updateOutputField(element,text),true);assert.equal(element.textContent,text);
  assert.equal(element.scrollTop,element.scrollHeight);
  element.scrollTop=80;
  updateOutputField(element,text+'\n1001');assert.equal(element.scrollTop,80);assert.ok(element.textContent.endsWith('1001'));
  assert.equal(updateOutputField(element,text+'\n1001'),false);assert.equal(element.scrollTop,80);
  updateOutputField(element,'1\n2');assert.equal(element.scrollTop,0,'seeking back or changing stream shows its beginning');
});

test('input and full output are anchored inside larger movable world fields without altering state',()=>{
  const layout=new WorldLayout(),camera=new WorldCamera(),state=emptyScene(),snapshot=structuredClone(state);
  const geometry=layout.resolve(state),element={style:{setProperty(){}},hidden:false};
  for(const id of ['tool:input','tool:output']){
    const mat=geometry.mats.get(id).rectangle;assert.ok(mat.width>=440&&mat.height>=360);
    const pose=positionInputField(element,{layout,camera,width:1600,height:1000},id),world=camera.toWorld(pose);
    assert.ok(world.x>=mat.x&&world.y>=mat.y);assert.ok(world.x+pose.width<=mat.x+mat.width&&world.y+pose.height<=mat.y+mat.height);
    layout.move(id,{x:-200,y:200});camera.zoom(1.5,{x:300,y:300});
    const next=positionInputField(element,{layout,camera,width:1600,height:1000},id);
    assert.equal(next.scale,1.5);assert.equal(camera.toWorld(next).x,-184);camera.scale=1;
  }
  assert.deepEqual(state,snapshot);
});
