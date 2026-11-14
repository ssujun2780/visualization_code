import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldLayout,WorldCamera} from '../src/animation/world.js';
import {dataFlowForEvent} from '../src/animation/transfers.js';
import {transferSegmentsMeet,transferSegmentHitsRectangle} from '../src/animation/transfer-routing.js';
import {toolAppearances} from '../src/animation/tools.js';

test('the same renderer covers real arithmetic, repeated reads, logic, bits, parameters, returns, copies and output',async()=>{
  const result=await traceModel(`#include <stdio.h>
    #include <string.h>
    int combine(int u,int v){return (u+v)*(u-v);}
    int main(void){int x=3,y=5,a[4]={3,1,4,2},b[4]={0};
      int first=x+y*x;int repeated=x+x+x;
      int cond=x<y&&y>0;int bits=(x&y)|(x<<1);
      int z=combine(x,y);memcpy(b,a,sizeof a);
      printf("%d %d %d %d %d\\n",first,repeated,cond,bits,z);return 0;}`);
  assert.equal(result.trace.status,'completed');assert.equal(result.trace.exitCode,0);
  const immutable=JSON.stringify(result), recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  const renderer=Object.create(SceneCanvas.prototype), drawn=[];
  Object.assign(renderer,{recording,layout:new WorldLayout(),camera:new WorldCamera(),context:new Proxy({globalAlpha:1},{get:(t,k)=>k in t?t[k]:()=>{}})});
  renderer.label=()=>{};renderer.box=()=>{};renderer.routedConnection=(path,color,options)=>drawn.push({path,color,...options});
  const coverage=new Set();let checked=0;
  for(const[index,event]of result.trace.events.entries()){
    const edges=dataFlowForEvent(recording,event);if(!edges.length)continue;
    player.seek(index);const before=displayScene(recording,player.state),after=displayScene(recording,player.after),snapshot=structuredClone(player.state);
    // Semantic edges may refer to compiler backing constants. The agreed
    // source view omits those boxes; every other real endpoint must be drawn.
    const visible=edges.map((edge,index)=>({edge,index})).filter(({edge})=>{
      const absent=[edge.from,edge.to].filter(p=>p.kind==='object'&&!after.objects.has(p.id));
      for(const p of absent){const o=recording.objects.get(p.id);assert.equal(o?.constant,true);assert.equal(o?.storage,'static');assert.ok(recording.internalConstantStorage.has(p.id));}
      return !absent.length;
    });
    renderer.layout.resolve(before);drawn.length=0;renderer.drawDataFlow(player,before,after);
    assert.equal(drawn.length,visible.length,event.eventId);assert.equal(renderer.transferMissing,0,event.eventId);
    assert.ok(drawn.every(p=>!p.emphasized));
    const ids=drawn.map(p=>p.index).sort((a,b)=>a-b);assert.deepEqual(ids,visible.map(p=>p.index));
    checked++;if(!visible.length)continue;
    const geometry=drawn.map(p=>({index:p.index,path:structuredClone(p.path)}));
    const contents=[...renderer.layout.resolve(after).ports.values()].filter(port=>after.objects.get(port.objectId)?.alive)
      .map(r=>({x:r.x+4,y:r.y+4,width:r.width-8,height:r.height-8}));
    for(const route of geometry)for(let i=1;i<route.path.length;i++)for(const box of contents)
      assert.equal(transferSegmentHitsRectangle(route.path[i-1],route.path[i],box),false,`${event.eventId}: value contents stay readable`);
    player.play();player.progress=0.2;drawn.length=0;renderer.drawDataFlow(player,before,after);
    assert.equal(drawn.filter(p=>p.emphasized).length,1);
    assert.deepEqual(drawn.map(p=>({index:p.index,path:p.path})).sort((a,b)=>a.index-b.index),geometry);
    for(let a=0;a<drawn.length;a++)for(let b=a+1;b<drawn.length;b++)for(let i=1;i<drawn[a].path.length;i++)for(let j=1;j<drawn[b].path.length;j++)
      assert.equal(transferSegmentsMeet(drawn[a].path[i-1],drawn[a].path[i],drawn[b].path[j-1],drawn[b].path[j]),false,event.eventId);
    assert.deepEqual(player.state,snapshot);coverage.add(`${event.kind}:${event.action}`);
  }
  for(const kind of ['CALC:expression','WRITE:argument','WRITE:return.value','WRITE:copy','WRITE:output'])assert.ok(coverage.has(kind),`missing coverage ${kind}`);
  assert.ok(checked>15);
  player.seek(result.trace.events.length);assert.equal(player.state.output,'18 9 1 7 -16\n');
  assert.equal(JSON.stringify(result),immutable);
  const calc=result.trace.events.findIndex(e=>e.kind==='CALC');
  assert.deepEqual(toolAppearances(result.trace.events,calc,0,recording,{inspection:true}),[{id:'alu',opacity:1}]);
  assert.deepEqual(toolAppearances(result.trace.events,calc,0,recording),[{id:'alu',opacity:1}], 'visible transfer arrows never point to an invisible ALU');
});
