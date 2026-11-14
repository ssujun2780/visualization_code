import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {traceModel} from '../scripts/model/index.mjs';
import {loopNavigation} from '../scripts/animation/loop-navigation.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';

const mixedSource=`#include <stdio.h>
int recur(int depth){int total=0,n=0;while(n<2){n++;total++;if(depth)total+=recur(depth-1);}return total;}
int main(void){int total=0;
  for(int outer=0;outer<2;outer++){
    int w=0;while(w<2){int d=0;do{d++;if(d==1)continue;total+=outer*100+w*10+d;if(d==3)break;}while(d<5);w++;}
  }
  total+=recur(1);printf("%d\\n",total);return 0;
}`;
let mixedRun;
async function prepare(source){
  const result=await traceModel(source),before=JSON.stringify([result.plan,result.trace]);
  const navigation=loopNavigation(result.plan,{ast:result.ast});
  const recording=createRecording(result.plan,result.trace,navigation);
  assert.equal(JSON.stringify([result.plan,result.trace]),before,'navigation never changes IR');
  return {result,recording,navigation};
}
const mixed=()=>mixedRun??=prepare(mixedSource);

test('mixed for/while/do loops preserve nesting, continue/break and recursive identities',async()=>{
  const {result,recording}=await mixed(),groups=recording.loopGroups;
  assert.equal(result.stdout,'466\n');
  assert.equal(groups.iterations.length,2+2*2+4*3+3*2);
  assert.deepEqual(groups.instances.filter(l=>l.scope.kind==='ForStmt').map(l=>l.iterations.length),[2]);
  const mainWhiles=groups.instances.filter(l=>l.scope.kind==='WhileStmt'&&l.scope.functionName==='main');
  assert.deepEqual(mainWhiles.map(l=>l.iterations.length),[2,2]);
  const dos=groups.instances.filter(l=>l.scope.kind==='DoStmt');
  assert.deepEqual(dos.map(l=>l.iterations.length),[3,3,3,3]);
  for(const loop of dos){
    assert.equal(loop.parent.kind,'iteration');assert.equal(loop.parent.loop.scope.kind,'WhileStmt');
    assert.ok(result.trace.events.slice(loop.iterations[0].start,loop.iterations[0].end).some(e=>e.action==='continue'));
    assert.ok(result.trace.events.slice(loop.iterations[2].start,loop.iterations[2].end).some(e=>e.action==='break'));
  }
  const recursive=groups.instances.filter(l=>l.scope.functionName==='recur');
  assert.equal(new Set(recursive.map(l=>l.frameId)).size,3);
  assert.ok(recursive.every(l=>l.iterations.length===2));
});

test('skipping every mixed loop endpoint equals sequential animation and preserves play/pause',async()=>{
  const {recording}=await mixed(),reference=new Playback(recording),ends=new Set(recording.loopGroups.iterations.map(i=>i.end)),states=new Map();
  reference.play();
  while(reference.event){reference.advance((1-reference.progress)*reference.duration);if(ends.has(reference.cursor))states.set(reference.cursor,structuredClone(reference.state));}
  assert.equal(reference.state.output,'466\n');
  for(const iteration of recording.loopGroups.iterations)for(const playing of [false,true]){
    const player=new Playback(recording);player.seek(iteration.start);if(playing)player.play();player.skipTo(iteration.end);
    assert.deepEqual(player.state,states.get(iteration.end));assert.equal(player.playing,playing&&Boolean(player.event));
  }
});

test('pre-test false condition is outside while iterations; post-test false condition stays inside do',async()=>{
  const {result,recording}=await prepare(`int probe(int *p){return (*p)++<2;}
int main(void){int a=0,b=0;while(probe(&a)){}do{}while(probe(&b));return a+b;}`);
  const loops=recording.loopGroups.instances;
  assert.deepEqual(loops.map(l=>l.iterations.length),[2,3]);
  const calls=result.trace.events.map((e,i)=>({e,i})).filter(({e})=>e.action==='call'&&e.callee==='@probe');
  assert.equal(calls.length,6);
  assert.equal(recording.loopGroups.at(calls[2].i),null);
  for(let i=0;i<3;i++)assert.equal(recording.loopGroups.at(calls[i+3].i),loops[1].iterations[i]);
  const last=loops[1].iterations.at(-1),decision=result.trace.events[last.end-1];
  assert.equal(decision.action,'branch');assert.equal(decision.condition.unsigned,'0');
});

test('AST ranges retain folded do-while(0), unbraced bodies and at-least-once behavior without fabricated events',async()=>{
  const {recording}=await prepare(`int main(void){int n=0;while(n<0)n++;do n++;while(0);do{n++;}while(0);while(n<4)n++;return n;}`);
  assert.deepEqual(recording.loopGroups.instances.map(l=>[l.scope.kind,l.iterations.length]),[['WhileStmt',0],['DoStmt',1],['DoStmt',1],['WhileStmt',2]]);
  const player=new Playback(recording);player.play();player.advance(1e9);
  const main=recording.trace.frames.find(f=>f.functionName==='main');assert.equal(player.state.returned.get(main.id).signed,'4');
});

test('constant-true while/do continue and early returns finish real iterations',async()=>{
  const {recording}=await prepare(`int once(void){do{return 7;}while(1);}
int main(void){int a=0;while(1){a++;if(a<2)continue;break;}int b=0;do{b++;if(b<2)continue;break;}while(1);return a+b+once();}`);
  assert.deepEqual(recording.loopGroups.instances.map(l=>[l.scope.kind,l.iterations.length]),[['WhileStmt',2],['DoStmt',2],['DoStmt',1]]);
  assert.ok(recording.loopGroups.iterations.every(i=>i.complete));
});

test('older records still group dynamic while/do by existing compiler statement ranges',async()=>{
  const {result}=await prepare('int main(void){int a=0;while(a<2)a++;do a--;while(a>0);return a;}');
  const recording=createRecording(result.plan,result.trace);
  assert.deepEqual(recording.loopGroups.instances.map(l=>[l.scope.kind,l.iterations.length]),[['WhileStmt',2],['DoStmt',2]]);
});

test('while/do fatal iteration stops at ERROR and never applies later output',async()=>{
  for(const body of ['while(i<3){i++;if(i==2){int bad=8/z;printf("%d",bad);}puts("ok");fflush(stdout);}',
    'do{i++;if(i==2){int bad=8/z;printf("%d",bad);}puts("ok");fflush(stdout);}while(i<3);']){
    const {result,recording}=await prepare(`#include <stdio.h>\nint main(void){int i=0,z=0;${body}return 0;}`);
    const fault=result.trace.events.findIndex(e=>e.kind==='ERROR'),iteration=recording.loopGroups.at(fault);
    assert.ok(iteration);assert.equal(iteration.number,2);assert.equal(iteration.complete,false);
    const player=new Playback(recording);player.play();player.skipTo(iteration.end);
    assert.ok(player.faultEvent);assert.equal(player.playing,false);assert.equal(player.state.output,'ok\n');
  }
});

test('live while/do input groups remain incomplete until the same execution resumes',async t=>{
  for(const body of ['while(i<2){int n=0;scanf("%d",&n);printf("%d\\n",n);i++;}',
    'do{int n=0;scanf("%d",&n);printf("%d\\n",n);i++;}while(i<2);']){
    const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
    const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'input.c',source:`#include <stdio.h>\nint main(void){int i=0;${body}return 0;}`},execArgv:[]});
    t.after(()=>worker.terminate());
    const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
    const partial=createRecording(first.plan,first.trace,first.navigation),iteration=partial.loopGroups.iterations[0];
    assert.equal(iteration.complete,false);assert.equal(partial.loopGroups.iterations.length,1);
    const player=new Playback(partial);player.inputRequest=first.request;player.play();player.skipTo(iteration.end);
    assert.equal(player.waitingForInput,true);assert.equal(player.playing,false);
    const next=once(worker,'message'),bytes=new TextEncoder().encode('5\n7\n');new Uint8Array(shared,12).set(bytes);
    Atomics.store(control,1,bytes.length);Atomics.store(control,2,1);Atomics.store(control,0,1);Atomics.notify(control,0);
    const [last]=await next;assert.equal(last.type,'complete',last.error);
    const complete=createRecording(last.plan,last.trace,last.navigation);
    assert.equal(complete.loopGroups.iterations.length,2);assert.ok(complete.loopGroups.iterations.every(i=>i.complete));
    assert.equal(complete.loopGroups.iterations[0].id,iteration.id);
    const final=new Playback(complete);final.play();final.advance(1e9);assert.equal(final.state.output,'5\n7\n');
  }
});
