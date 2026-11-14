import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {WorldLayout} from '../src/animation/world.js';
import {hiddenStorageEndpoint,internalConstantStorage} from '../src/animation/source-storage.js';
import {dataFlowForEvent} from '../src/animation/transfers.js';

test('compiler constant backing boxes disappear from layout while declarations, copies and outputs remain intact',async()=>{
  const result=await traceModel(`#include <stdio.h>
#include <string.h>
int shown=4;static int kept=2;const int _user[2]={1,2};
int main(void){int a[2]={10,20};char s[8];strcpy(s,"AB");printf("%d %s %d %d\\n",a[0],s,kept,_user[1]);return 0;}`);
  const before=JSON.stringify(result),recording=createRecording(result.plan,result.trace),player=new Playback(recording),layout=new WorldLayout();
  assert.ok(recording.internalConstantStorage.size>=3);
  let hiddenFlows=0;
  for(let i=0;i<result.trace.events.length;i++){
    player.seek(i+1);const scene=displayScene(recording,player.state),geometry=layout.resolve(scene);
    for(const id of recording.internalConstantStorage){assert.equal(scene.objects.has(id),false);assert.equal(geometry.objects.has(id),false);}
    for(const edge of dataFlowForEvent(recording,result.trace.events[i]))if(hiddenStorageEndpoint(recording,scene,edge.from))hiddenFlows++;
    for(const object of player.state.objects.values())if(['shown','kept','_user','a','s'].includes(object.name))assert.ok(scene.objects.has(object.id));
  }
  assert.ok(hiddenFlows>0,'hidden compiler copy sources are identified for the renderer');
  assert.equal(player.state.output,'10 AB 2 2\n');
  assert.equal(JSON.stringify(result),before,'presentation never deletes compiler storage from IR');
  assert.ok([...player.state.objects.keys()].some(id=>recording.internalConstantStorage.has(id)));
});

test('a user pointer exposes its literal target only while referenced, with readable identity and current contents',async()=>{
  const result=await traceModel('#include <stdio.h>\nint main(void){char *p="Hello";puts(p);p=0;return 0;}');
  const recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  const p=result.trace.objects.find(o=>o.name==='p'),writes=result.trace.events.map((e,i)=>({e,i})).filter(({e})=>e.kind==='WRITE'&&e.target?.objectId===p.id);
  assert.equal(writes.length,2);
  const target=writes[0].e.value.reference.targetObjectId;assert.ok(recording.internalConstantStorage.has(target));
  player.seek(writes[0].i);assert.equal(displayScene(recording,player.state).objects.has(target),false);
  player.seek(writes[0].i+1);const view=displayScene(recording,player.state).objects.get(target);
  assert.equal(view.name,'문자열 리터럴');assert.equal(view.stringPreview,'"Hello"');
  assert.ok(displayScene(recording,player.state).objects.get(p.id).value.reference.targetObjectId===target);
  player.seek(writes[1].i+1);assert.equal(displayScene(recording,player.state).objects.has(target),false);
  assert.equal(player.state.objects.get(target).alive,true);
});

test('classification uses source declarations and compiler storage metadata, never a name pattern',()=>{
  const objects=new Map([
    ['declared',{id:'declared',name:'.str',storage:'static',constant:true}],
    ['generated',{id:'generated',name:'arbitrary-name',storage:'static',constant:true}],
    ['unknown',{id:'unknown',name:'__const.example',storage:'static',constant:true}],
    ['mutable',{id:'mutable',name:'.str.5',storage:'static',constant:false}],
  ]);
  const events=new Map([...objects.keys()].filter(id=>id!=='unknown').map(id=>[id,{action:'object.begin',objectId:id,instructionId:id}]));
  const instructions=new Map([['declared',{declarationId:'d1',source:{line:1}}],['generated',{source:null}],['mutable',{source:null}]]);
  assert.deepEqual([...internalConstantStorage({objects,events,instructions})],['generated']);
});
