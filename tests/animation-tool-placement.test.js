import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ToolFollower} from '../src/animation/tool-placement.js';
import {WorldLayout,rectangleCenter} from '../src/animation/world.js';
import {emptyScene,createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {traceModel} from '../scripts/model/index.mjs';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {AvoidLib} from 'libavoid-js';
import {resolve} from 'node:path';

function fixture(){
  const state=emptyScene();state.activeFrame='f1';state.frames.set('f1',{id:'f1',name:'main',alive:true});
  state.objects.set('local',{id:'local',name:'local',frameId:'f1',size:4,alive:true});
  state.objects.set('heap',{id:'heap',name:'heap',storage:'heap',size:4,alive:true});
  const read=id=>({eventId:`read-${id}`,kind:'READ',action:'read',target:{objectId:id}});
  const calc=id=>({eventId:`calc-${id}`,kind:'CALC',action:'expression',activationId:'f1',inputs:[{executionId:`read-${id}`,value:{decimal:'3'}}]});
  const events=[read('local'),read('heap'),calc('local'),calc('heap')];
  const recording={events:new Map(events.map(e=>[e.eventId,e]))};
  const layout=new WorldLayout(),follower=new ToolFollower(layout);layout.resolve(state);layout.move('memory:heap',{x:3000,y:100});
  layout.resolve(state);return {state,recording,layout,follower,local:events[2],heap:events[3]};
}
const metric=(a,b)=>Math.abs(rectangleCenter(a).x-rectangleCenter(b).x)+Math.abs(rectangleCenter(a).y-rectangleCenter(b).y);
const separated=(a,b)=>a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y;

test('ALU follows current operands across distant storage fields without moving their boxes or changing execution',()=>{
  const {state,recording,layout,follower,local,heap}=fixture(),snapshot=structuredClone(state),ir=JSON.stringify(recording);
  follower.update(recording,local,state);const old=layout.resolve(state),from=old.mats.get('tool:workbench').rectangle;
  assert.equal(follower.update(recording,heap,state),true);
  const next=layout.resolve(state),to=next.mats.get('tool:workbench').rectangle;
  assert.ok(metric(to,next.objects.get('heap'))<metric(from,next.objects.get('heap')));
  for(const [id,mat] of next.mats)if(id!=='tool:workbench'){
    assert.deepEqual(mat.rectangle,old.mats.get(id).rectangle,id);assert.ok(separated(to,mat.rectangle));
  }
  assert.deepEqual(next.objects,old.objects);assert.deepEqual(state,snapshot);assert.equal(JSON.stringify(recording),ir);
});

test('one calculation, its result write and its completed branch retain one tool location without frame-by-frame rewiring',()=>{
  const {state,recording,layout,follower,heap}=fixture();follower.update(recording,heap,state);
  const position={...layout.positions.get('tool:workbench')},revision=layout.revision;
  for(let i=0;i<1000;i++)assert.equal(follower.update(recording,heap,state),false);
  const write={eventId:'write',kind:'WRITE',action:'write',inputs:[{executionId:heap.eventId}],target:{objectId:'local'}};
  const branch={eventId:'branch',kind:'FLOW',action:'branch',dataInputs:[heap.eventId],activationId:'f1'};
  assert.equal(follower.update(recording,write,state),false);assert.equal(follower.update(recording,branch,state),false);
  assert.deepEqual(layout.positions.get('tool:workbench'),position);assert.equal(layout.revision,revision);
});

test('manual tool placement overrides following and reset restores automatic mode',()=>{
  const {state,recording,layout,follower,heap}=fixture();layout.move('tool:workbench',{x:-800,y:900});
  assert.equal(follower.update(recording,heap,state),false);assert.deepEqual(layout.positions.get('tool:workbench'),{x:-800,y:900});
  layout.reset();const next=new ToolFollower(layout);assert.equal(layout.pinned.has('tool:workbench'),false);
  next.update(recording,heap,state);assert.ok(layout.followingTools.has('tool:workbench'));
});

test('literal-only calculations use the current live frame and missing/dead targets are not guessed',()=>{
  const {state,recording,layout,follower}=fixture();
  const literal={eventId:'literal',kind:'CALC',action:'expression',activationId:'f1',inputs:[{value:{literal:'3'}}]};
  follower.update(recording,literal,state);const position={...layout.positions.get('tool:workbench')};
  state.frames.get('f1').alive=false;state.objects.get('local').alive=false;
  assert.equal(follower.update(recording,{...literal,eventId:'later'},state),false);
  assert.deepEqual(layout.positions.get('tool:workbench'),position);
});

test('real calculation and branch playback preserve results and native pointer routing with moving tools',async()=>{
  const result=await traceModel(`#include <stdio.h>
#include <stdlib.h>
int main(void){int x=3;int *heap=calloc(32,sizeof(int));heap[0]=7;
int a=x+2;int b=heap[0]*3;if(b>a)heap[1]=b-a;
printf("%d %d\\n",a,heap[1]);return 0;}`);
  assert.equal(result.stdout,'5 16\n');
  const json=JSON.stringify(result),recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  const layout=new WorldLayout(),follower=new ToolFollower(layout);layout.resolveType=recording.resolveType;
  await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
  const engine=new PointerWiring(AvoidLib.getInstance());
  try{
    for(let i=0;i<result.trace.events.length;i++){
      player.seek(i);const state=displayScene(recording,player.state),before=structuredClone(player.state);
      follower.update(recording,player.event,state);
      const graph=pointerGraph(state,layout.resolve(state)),wiring=engine.update(graph);
      assert.deepEqual(wiring.missing,[]);assert.equal(wiring.quality.nodeCrossings,0);
      assert.deepEqual(player.state,before);
    }
  }finally{engine.dispose();}
  player.seek(result.trace.events.length);assert.equal(player.state.output,'5 16\n');assert.equal(JSON.stringify(result),json);
});
