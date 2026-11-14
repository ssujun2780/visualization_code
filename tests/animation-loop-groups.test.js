import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {loopSkipDestination} from '../src/animation/loop-skip.js';

const mixedSource=`#include <stdio.h>
int descend(int depth){int sum=0;for(int x=0;x<2;x++){sum++;if(depth)sum+=descend(depth-1);}return sum;}
int main(void){int total=0;
  for(int outer=0;outer<3;outer++){
    for(int inner=0;inner<4;inner++){
      if(inner==1)continue;if(inner==3)break;total+=outer*10+inner;
    }
  }
  total+=descend(1);printf("%d\\n",total);return 0;
}`;
let mixedRun;
const mixed=()=>mixedRun??=traceModel(mixedSource);

test('for groups preserve nested loops, repeated invocations, recursion and real continue/break boundaries',async()=>{
  const result=await mixed(),before=JSON.stringify(result),recording=createRecording(result.plan,result.trace);
  const groups=recording.loopGroups;
  const main=groups.instances.filter(loop=>loop.scope.functionName==='main');
  assert.deepEqual(main.map(loop=>loop.iterations.length),[3,4,4,4]);
  const recursive=groups.instances.filter(loop=>loop.scope.functionName==='descend');
  assert.equal(new Set(recursive.map(loop=>loop.frameId)).size,3);
  assert.ok(recursive.every(loop=>loop.iterations.length===2));
  assert.equal(groups.iterations.length,21);
  for(const loop of groups.instances)assert.deepEqual(loop.iterations.map(i=>i.number),Array.from({length:loop.iterations.length},(_,i)=>i+1));
  for(const [index,iteration] of main[0].iterations.entries()){
    assert.equal(main[index+1].parent,iteration,'inner loop belongs to its current outer iteration');
    const inner=main[index+1];
    assert.ok(result.trace.events.slice(inner.iterations[1].start,inner.iterations[1].end).some(e=>e.action==='continue'));
    assert.ok(result.trace.events.slice(inner.iterations[3].start,inner.iterations[3].end).some(e=>e.action==='break'));
    assert.ok(inner.iterations.every(i=>i.complete));
  }
  assert.equal(JSON.stringify(result),before,'grouping never mutates source IR');
});

test('iteration skip produces the same state as sequential animation and preserves play/pause',async()=>{
  const result=await mixed(),recording=createRecording(result.plan,result.trace);
  const reference=new Playback(recording);reference.play();
  const expected=new Map();
  const ends=new Set(recording.loopGroups.iterations.map(i=>i.end));
  while(reference.event){
    reference.advance((1-reference.progress)*reference.duration);
    if(ends.has(reference.cursor))expected.set(reference.cursor,structuredClone(reference.state));
  }
  assert.equal(reference.state.output,'72\n');
  for(const iteration of recording.loopGroups.iterations){
    const player=new Playback(recording);player.seek(iteration.start);player.skipTo(iteration.end);
    assert.deepEqual(player.state,expected.get(iteration.end));assert.equal(player.playing,false);
    player.seek(iteration.start);player.play();player.skipTo(iteration.end);
    assert.deepEqual(player.state,expected.get(iteration.end));assert.equal(player.playing,Boolean(player.event));
  }
});

test('counts are independent of induction values; zero, empty and conditionless loops are represented',async()=>{
  const result=await traceModel(`#include <stdio.h>
int main(void){int total=0;
  for(int z=9;z>5;z--)total++;
  for(int z=0;z<0;z++)total+=999;
  int n=0;for(;;){n++;if(n==2)break;}
  for(;;)if(++n==4)break;
  for(int z=0;z<2;z++);
  printf("%d %d",total,n);return 0;}`);
  const recording=createRecording(result.plan,result.trace);
  assert.deepEqual(recording.loopGroups.instances.map(loop=>loop.iterations.length),[4,0,2,2,2]);
  const player=new Playback(recording);player.play();player.advance(1e9);assert.equal(player.state.output,'4 4');
});

test('condition calls belong to the correct iteration, with final false condition outside iterations',async()=>{
  const result=await traceModel(`#include <stdio.h>
int probe(int *p){return (*p)++<2;}
int main(void){int total=0;for(int n=0;probe(&n);){total++;}printf("%d",total);return 0;}`);
  const recording=createRecording(result.plan,result.trace),loop=recording.loopGroups.instances[0];
  assert.equal(loop.iterations.length,2);
  const probes=result.trace.events.map((e,i)=>({e,i})).filter(({e})=>e.action==='call'&&e.callee==='@probe');
  assert.equal(probes.length,3);
  for(let n=0;n<2;n++)assert.equal(recording.loopGroups.at(probes[n].i),loop.iterations[n]);
  assert.equal(recording.loopGroups.at(probes[2].i),null);
});

test('an iteration skip cannot bypass a fatal event or fabricate later effects',async()=>{
  const result=await traceModel(`#include <stdio.h>
int main(void){int z=0;for(int i=0;i<4;i++){if(i==2){int bad=8/z;printf("%d",bad);}puts("ok");fflush(stdout);}return 0;}`);
  const recording=createRecording(result.plan,result.trace),faultIndex=result.trace.events.findIndex(e=>e.kind==='ERROR');
  assert.ok(faultIndex>=0);const iteration=recording.loopGroups.at(faultIndex);assert.ok(iteration);
  assert.equal(iteration.number,3);assert.equal(iteration.complete,false);
  const player=new Playback(recording);player.seek(iteration.start);player.play();player.skipTo(iteration.end);
  assert.ok(player.faultEvent);assert.equal(player.playing,false);assert.equal(player.state.output,'ok\nok\n');
  for(const count of [100,'all']){player.seek(iteration.start);player.play();player.skipTo(loopSkipDestination(recording.loopGroups,iteration.start,count).target);
    assert.ok(player.faultEvent);assert.equal(player.playing,false);assert.equal(player.state.output,'ok\nok\n');}
});

test('partial input snapshots stay in an unfinished iteration and grow without inventing the next one',async t=>{
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'loop-input.c',source:`#include <stdio.h>
int main(void){for(int i=0;i<2;i++){int value=0;scanf("%d",&value);printf("%d\\n",value);}return 0;}`},execArgv:[]});
  t.after(()=>worker.terminate());
  const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
  const partial=createRecording(first.plan,first.trace),iteration=partial.loopGroups.iterations[0];
  assert.equal(partial.loopGroups.iterations.length,1);assert.equal(iteration.complete,false);
  const player=new Playback(partial);player.inputRequest=first.request;player.seek(iteration.start);player.play();player.skipTo(iteration.end);
  assert.equal(player.waitingForInput,true);assert.equal(player.playing,false);
  for(const count of [100,'all']){player.seek(iteration.start);player.play();player.skipTo(loopSkipDestination(partial.loopGroups,iteration.start,count).target);
    assert.equal(player.waitingForInput,true);assert.equal(player.playing,false);assert.equal(player.cursor,partial.playbackLength);}
  const next=once(worker,'message'),bytes=new TextEncoder().encode('5\n7\n');new Uint8Array(shared,12).set(bytes);
  Atomics.store(control,1,bytes.length);Atomics.store(control,2,1);Atomics.store(control,0,1);Atomics.notify(control,0);
  const [last]=await next;assert.equal(last.type,'complete',last.error);
  const complete=createRecording(last.plan,last.trace);assert.equal(complete.loopGroups.iterations.length,2);
  assert.ok(complete.loopGroups.iterations.every(i=>i.complete));
  assert.equal(complete.loopGroups.iterations[0].id,iteration.id);
  const final=new Playback(complete);final.play();final.advance(1e9);assert.equal(final.state.output,'5\n7\n');
});
