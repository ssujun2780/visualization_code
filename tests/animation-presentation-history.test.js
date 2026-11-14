import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {AvoidLib} from 'libavoid-js';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {PresentationHistory} from '../src/animation/presentation-history.js';
import {PresentationJournal,routeSnapshot} from '../src/animation/presentation-journal.js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {PointerClient} from '../src/animation/pointer-client.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldLayout} from '../src/animation/world.js';
import {ToolFollower} from '../src/animation/tool-placement.js';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {containerId} from '../src/animation/object-view.js';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {inferStructures} from '../scripts/inference/structure-inference.mjs';
import {prepareStructures,PreparedStructures} from '../src/animation/prepared-structures.js';

await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
const viewport={width:850,height:420},source=`#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int value;struct Node *next; } Node;
int touch(int* p,int delta){int scratch[5]={0};scratch[4]=*p;*p+=delta;return scratch[4];}
int recur(int n){int local=n;return n?local+recur(n-1):0;}
int main(void){
 Node nodes[3]={{1,&nodes[1]},{2,&nodes[2]},{3,&nodes[0]}};
 int* refs[3]={&nodes[0].value,&nodes[1].value,&nodes[2].value};Node* head=nodes;
 int* heap=calloc(3,sizeof(int));
 for(int i=0;i<5;i++){
   refs[i%3]=&head->value;touch(refs[i%3],i+1);head=head->next;
   if(i==2)heap=realloc(heap,6*sizeof(int));
   heap[i]=i*7;printf("%d ",*refs[i%3]);
 }
 printf("%d\\n",recur(2));free(heap);return 0;
}`;
let run;
const fixture=()=>run??=traceModel(source).then(r=>({r,recording:createRecording(r.plan,r.trace)}));
const make=(recording,options={})=>new PresentationHistory(recording,{viewport,...options},new PointerWiring(AvoidLib.getInstance(),{measureQuality:false}));
const prepare=(h,cursor)=>{while(!h.prepare(cursor,{timeMs:Infinity,maxSteps:10000})){};};
const signature=(h,cursor)=>[2*cursor+1,2*cursor+2].map(v=>[...h.journal.at(v)].filter(([k])=>k!=='routing').sort(([a],[b])=>a.localeCompare(b)));

test('sparse checkpoints reconstruct old positions and routes after checkpoint eviction',()=>{
  const j=new PresentationJournal({interval:2,maxCheckpoints:2}),expected=[];let p={x:0,y:0};
  for(let i=0;i<19;i++){const next=new Map([['p:box',p],['w:line',{id:'line',points:[{x:0,y:0},{x:i,y:5}]}]]);if(i%3===0)next.set('temporary',i);j.append(next);expected.push(next);if(i%4===0)p={x:i,y:2};}
  assert.equal(j.checkpoints.size,2);for(const i of [1,15,3,19,8,1])assert.deepEqual(j.at(i),expected[i-1]);
  const replica=new PresentationJournal();for(const change of j.changes)replica.accept(structuredClone(change));assert.deepEqual(replica.at(3),expected[2]);
  assert.ok(j.changes.some(c=>!c.set.some(([key])=>key==='p:box')),'unchanged positions are not copied into every delta');
});

test('an unprepared seek keeps the completed drawing and defers geometry-dependent camera actions',()=>{
  const renderer=Object.create(SceneCanvas.prototype);Object.assign(renderer,{historyWaiting:true,layout:{resolve(){throw new Error('unprepared geometry must not be queried');}}});
  renderer.fit({});renderer.focusEvent({});renderer.render({});
  assert.equal(renderer.pendingFit,true);assert.equal(renderer.pendingFocus,true);
});

test('cold jumps, rewind, repeat and later continuation have identical layout, tools, gateways and route points',async t=>{
  const {r,recording}=await fixture(),before=JSON.stringify(r),normal=make(recording),jump=make(recording);t.after(()=>{normal.dispose();jump.dispose();});
  assert.equal(r.trace.status,'completed');
  const selected=[Math.floor(recording.playbackLength*.3),Math.floor(recording.playbackLength*.65),recording.playbackLength];
  const expected=new Map();for(let i=0;i<=recording.playbackLength;i++){prepare(normal,i);if(selected.includes(i))expected.set(i,signature(normal,i));}
  prepare(jump,selected[1]);assert.deepEqual(signature(jump,selected[1]),expected.get(selected[1]));
  const calls=jump.wiring.result.stats.transactions;
  for(const i of [selected[0],selected[1],0,selected[0]]){prepare(jump,i);assert.deepEqual(signature(jump,i),signature(normal,i));}
  assert.equal(jump.wiring.result.stats.transactions,calls,'rewind reads history without rerouting');
  prepare(jump,selected[2]);assert.deepEqual(signature(jump,selected[2]),expected.get(selected[2]));
  assert.equal(JSON.stringify(r),before);
  await mkdir('test-results/presentation-history',{recursive:true});
  await writeFile('test-results/presentation-history/recording.json',JSON.stringify({plan:r.plan,trace:r.trace}));
  await writeFile('test-results/presentation-history/report.json',JSON.stringify({events:r.trace.events.length,selected,matched:true,journalVersions:normal.journal.length,
    changedEntries:normal.journal.changes.reduce((n,d)=>n+d.set.length,0),checkpoints:normal.journal.checkpoints.size,sourceUnchanged:true},null,2));
});

test('the actual renderer installs the same geometry and paths as the chronological worker',async t=>{
  const {recording}=await fixture(),h=make(recording);t.after(()=>h.dispose());
  const renderer=Object.create(SceneCanvas.prototype),player=new Playback(recording),layout=new WorldLayout();
  Object.assign(renderer,{layout,width:viewport.width,height:viewport.height,wireGraphs:new WeakMap(),relaxations:new Map(),toolFollower:new ToolFollower(layout),
    wiring:{requestFrame(p){prepare(h,p.cursor);const before=h.journal.at(2*p.cursor+1),after=h.journal.at(2*p.cursor+2);return {cursor:p.cursor,before,after,routes:[routeSnapshot(before),routeSnapshot(after)]};}}});
  for(const index of [Math.floor(recording.playbackLength*.65),15,Math.floor(recording.playbackLength*.3)]){
    renderer.drag={mode:index===15?'select':'pan'};
    player.seek(index);assert.equal(renderer.prepareWiring(player),true);
    const before=displayScene(recording,player.state),after=displayScene(recording,player.after);
    for(const [i,state]of [before,after].entries()){
      const geometry=layout.resolve(state),graph=pointerGraph(state,geometry,layout.pinned),routes=renderer.wireBoundaries[i];
      assert.deepEqual(routes.missing,[]);
      for(const route of routes.paths){const edge=graph.edges.find(e=>e.id===route.id);assert.ok(edge);
        const a=graph.nodes.find(n=>n.id===edge.source),b=graph.nodes.find(n=>n.id===edge.target);
        for(const [point,box]of [[route.points[0],a],[route.points.at(-1),b]])assert.ok(point.x>=box.x-.001&&point.x<=box.x+box.width+.001&&point.y>=box.y-.001&&point.y<=box.y+box.height+.001,'route endpoints match the restored original cell ports');
      }
    }
  }
});

test('manual pins, collapsed arrays and resized windows are one stable viewing configuration',async t=>{
  const {recording}=await fixture(),nodes=recording.trace.objects.find(o=>o.name==='nodes'),prefs={pinned:['tool:workbench'],positions:[['tool:workbench',{x:1600,y:800}]],collapsed:[containerId(nodes.id)],
    windows:[[containerId(nodes.id),{objectId:nodes.id,offset:0,size:nodes.size,root:true,width:350,height:200,capacity:4}]]},a=make(recording,{preferences:prefs}),b=make(recording,{preferences:prefs});t.after(()=>{a.dispose();b.dispose();});
  const end=Math.floor(recording.playbackLength*.7);for(let i=0;i<=end;i++)prepare(a,i);prepare(b,end);
  assert.deepEqual(signature(a,end),signature(b,end));assert.deepEqual(b.journal.at(2*end+2).get('p:tool:workbench'),{x:1600,y:800});
});

test('prepared structures preserve their selected shapes and source ports through the same history path',async t=>{
  const r=await frozenInferenceExecution('returned-list'),inference=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace}),data=prepareStructures(r.plan,r.trace,inference),prepared=new PreparedStructures(data),recording=createRecording(r.plan,r.trace),
    a=make(recording,{prepared}),b=make(recording,{prepared}),end=r.trace.events.findLastIndex(e=>e.action==='output');t.after(()=>{a.dispose();b.dispose();});
  assert.ok(prepared.tracks.size);for(let i=0;i<=end;i++)prepare(a,i);prepare(b,end);assert.deepEqual(signature(a,end),signature(b,end));
  prepare(b,1);assert.deepEqual(signature(a,end),signature(b,end));
  const preferences={positions:[['tool:input',{x:-1000,y:1500}]],pinned:['tool:input']},factory=()=>new PointerWiring(AvoidLib.getInstance(),{measureQuality:false});
  const edit=a.revise(end,preferences,factory);a.revise(1,preferences,factory);
  assert.deepEqual(a.revise(end,preferences,factory).routes.map(r=>r.paths),edit.routes.map(r=>r.paths));
  assert.deepEqual(signature(a,end),signature(b,end),'presentation edits do not rewrite prepared/base history');
});

test('the Worker client merges overlapping replies, rewinds from cache and rejects old viewing configurations',async t=>{
  const Original=globalThis.Worker;
  class Transport{constructor(){this.messages=[];}postMessage(data){this.messages.push(data);}terminate(){}}
  globalThis.Worker=Transport;t.after(()=>{if(Original===undefined)delete globalThis.Worker;else globalThis.Worker=Original;});
  const {recording}=await fixture(),player=new Playback(recording),layout=new WorldLayout(),client=new PointerClient(),h=make(recording);t.after(()=>{client.reset();h.dispose();});layout.viewport=viewport;
  player.seek(20);assert.equal(client.requestFrame(player,layout),null);const first=client.worker.messages.at(-1);assert.ok(first.recording);
  player.seek(40);assert.equal(client.requestFrame(player,layout),null);const second=client.worker.messages.at(-1);assert.equal(second.epoch,first.epoch);assert.equal(second.setup,undefined);
  prepare(h,20);client.worker.onmessage({data:{type:'frame',epoch:first.epoch,edit:first.edit,...h.result(20,0)}});
  prepare(h,40);client.worker.onmessage({data:{type:'frame',epoch:first.epoch,edit:first.edit,...h.result(40,0)}});
  assert.deepEqual(client.requestFrame(player,layout).routes, [routeSnapshot(h.journal.at(81)),routeSnapshot(h.journal.at(82))]);
  const messages=client.worker.messages.length;player.seek(10);assert.ok(client.requestFrame(player,layout));assert.equal(client.worker.messages.length,messages);
  layout.viewport={width:viewport.width+.01,height:viewport.height-.01};assert.ok(client.requestFrame(player,layout));assert.equal(client.worker.messages.length,messages,'subpixel sizing noise does not rebuild a viewing configuration');
  layout.move('tool:workbench',{x:1500,y:700});assert.equal(client.requestFrame(player,layout),null);const changed=client.worker.messages.at(-1);
  assert.equal(changed.epoch,first.epoch);assert.equal(changed.setup,undefined);assert.equal(client.frameJournal.length,h.journal.length);
  assert.deepEqual(changed.preferences.positions,[['tool:workbench',{x:1500,y:700}]]);
  const overlay=h.revise(player.cursor,changed.preferences,()=>new PointerWiring(AvoidLib.getInstance(),{measureQuality:false}));
  client.worker.onmessage({data:{type:'frame',epoch:first.epoch,edit:changed.edit,overlay,...h.result(player.cursor,changed.known)}});
  assert.deepEqual(client.requestFrame(player,layout).before,overlay.before);
  const delivered=client.worker.messages.length;layout.move('tool:workbench',{x:1500,y:700});
  assert.deepEqual(client.requestFrame(player,layout).before,overlay.before);assert.equal(client.worker.messages.length,delivered,'an unchanged coordinate does not restart preparation');
  layout.move('tool:workbench',{x:1600,y:700});assert.equal(client.requestFrame(player,layout),null);
  client.worker.onmessage({data:{type:'frame',epoch:first.epoch,edit:changed.edit,overlay,...h.result(player.cursor,changed.known)}});
  assert.equal(client.frameCache.size,0,'a late reply cannot restore an older drag');
  layout.toggleContainer('container:any');assert.equal(client.requestFrame(player,layout),null);const reshaped=client.worker.messages.at(-1);
  assert.ok(reshaped.epoch>first.epoch);
  client.worker.onmessage({data:{type:'frame',epoch:first.epoch,edit:changed.edit,...h.result(40,0)}});assert.equal(client.frameJournal.length,0);
});

test('edited boundary snapshots stay aligned with real renderer ports after collisions and navigation',async t=>{
  const {recording}=await fixture(),h=make(recording);t.after(()=>h.dispose());prepare(h,recording.playbackLength);
  const layout=new WorldLayout(),player=new Playback(recording),renderer=Object.create(SceneCanvas.prototype),factory=()=>new PointerWiring(AvoidLib.getInstance(),{measureQuality:false});
  layout.move('tool:workbench',{x:1300,y:650});
  Object.assign(renderer,{layout,width:viewport.width,height:viewport.height,wireGraphs:new WeakMap(),relaxations:new Map(),toolFollower:new ToolFollower(layout),
    wiring:{requestFrame(p){return h.revise(p.cursor,{positions:[...layout.userPositions],pinned:[...layout.pinned]},factory);}}});
  for(const cursor of [244,112,15,244]){
    player.seek(cursor);assert.equal(renderer.prepareWiring(player),true);
    for(const [index,state]of [displayScene(recording,player.state),displayScene(recording,player.after)].entries()){
      const graph=pointerGraph(state,layout.resolve(state),layout.pinned);assert.deepEqual(renderer.wireBoundaries[index].missing,[]);
      for(const route of renderer.wireBoundaries[index].paths){
        const edge=graph.edges.find(e=>e.id===route.id);assert.ok(edge);
        for(const [point,id]of [[route.points[0],edge.source],[route.points.at(-1),edge.target]]){
          const box=graph.nodes.find(n=>n.id===id);assert.ok(point.x>=box.x-.001&&point.x<=box.x+box.width+.001&&point.y>=box.y-.001&&point.y<=box.y+box.height+.001,'edited lines terminate at the drawn original ports');
        }
      }
    }
  }
});

test('moving boxes and mats keeps the canonical journal and only derives the requested edited frames',async t=>{
  const {recording}=await fixture(),h=make(recording);t.after(()=>h.dispose());
  const cursor=Math.floor(recording.playbackLength*.65);prepare(h,recording.playbackLength);
  const source=JSON.stringify(h.journal.changes),next=h.next,versions=h.journal.length;
  const nodes=recording.trace.objects.find(o=>o.name==='nodes'),frame=recording.trace.objects.find(o=>o.name==='refs').frameId;
  const before=h.journal.at(2*cursor+1),old=before.get('p:object:'+nodes.id),mat=before.get('p:frame:'+frame);
  const variants=[{positions:[['object:'+nodes.id,{x:old.x+180,y:old.y+50}]],pinned:['object:'+nodes.id]},
    {positions:[['frame:'+frame,{x:mat.x+400,y:mat.y-200}],['tool:input',{x:-700,y:1400}]],pinned:['frame:'+frame,'tool:input']}];
  const clean=value=>({...value,routes:value.routes.map(({paths,missing})=>({paths,missing}))}),factory=()=>new PointerWiring(AvoidLib.getInstance(),{measureQuality:false});
  for(const preferences of variants){
    const initial=clean(h.revise(cursor,preferences,factory));
    assert.notDeepEqual(initial.before,before,'manual edits must actually change the displayed positions');
    for(const seek of [5,112,recording.playbackLength,17,cursor])h.revise(seek,preferences,factory);
    assert.deepEqual(clean(h.revise(cursor,preferences,factory)),initial,'rewind and forward lookup must use the same edited geometry and paths');
    for(const [key,point]of preferences.positions)assert.deepEqual(initial.before.get('p:'+key),point);
  }
  assert.equal(h.next,next);assert.equal(h.journal.length,versions);assert.equal(JSON.stringify(h.journal.changes),source,'no old entry is replaced or mutated');
});
