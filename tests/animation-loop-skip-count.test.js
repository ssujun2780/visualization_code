import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {loopSkipContext,loopSkipDestination} from '../src/animation/loop-skip.js';

const source=`#include <stdio.h>
int batch(int n){int total=0;for(int i=0;i<n;i++){total+=i+1;printf("%d ",total);}return total;}
int main(void){
  int a=batch(49),b=batch(3);
  int w=0;while(w<7){w++;}
  int d=0;do{d++;}while(d<4);
  for(int i=0;i<2;i++){int j=0;while(j<3){j++;}}
  for(int z=0;z<0;z++)w++;
  printf("done %d %d %d %d",a,b,w,d);return 0;
}`;
let recording;
const setup=()=>recording??=traceModel(source).then(r=>({result:r,recording:createRecording(r.plan,r.trace)}));
const completed=(recording,target)=>{const p=new Playback(recording);p.play();while(p.cursor<target){const cursor=p.cursor;p.advance(p.duration);assert.ok(p.cursor>cursor,'ordinary playback reaches each boundary');}assert.equal(p.cursor,target);return p;};

test('counted skips apply every effect and cap 50/100/all to the 49-iteration loop exit',async()=>{
  const {result,recording}=await setup(),loop=recording.loopGroups.instances.find(l=>l.iterations.length===49),before=JSON.stringify(result);
  for(const count of [1,5,10,50,100,'all']){
    const skipped=count==='all'?49:Math.min(count,49),destination=loopSkipDestination(recording.loopGroups,loop.iterations[0].start,count),
      expected=skipped===49?loop.end:loop.iterations[skipped-1].end,p=new Playback(recording);
    assert.equal(destination.target,expected);assert.equal(destination.skipped,skipped);
    p.seek(loop.iterations[0].start);p.skipTo(destination.target);
    assert.deepEqual(p.state,completed(recording,expected).state);
    assert.equal(p.state.output,Array.from({length:skipped},(_,i)=>(i+1)*(i+2)/2+' ').join(''));
    assert.equal(p.playing,false);
  }
  assert.equal(JSON.stringify(result),before);
});

test('mid-iteration counting includes the current iteration, preserves playing, and is repeatable after seeking back',async()=>{
  const {recording}=await setup(),loop=recording.loopGroups.instances.find(l=>l.iterations.length===49),at=loop.iterations[14].end-1,
    destination=loopSkipDestination(recording.loopGroups,at,5),p=new Playback(recording);
  assert.equal(destination.first,14);assert.equal(destination.remaining,35);assert.equal(destination.target,loop.iterations[18].end);
  for(let repeat=0;repeat<2;repeat++){
    p.seek(at);p.play();p.skipTo(destination.target);assert.equal(p.playing,true);
    assert.deepEqual(p.state,completed(recording,destination.target).state);
  }
  assert.equal(loopSkipDestination(recording.loopGroups,at,100).target,loop.end);
});

test('while, do-while, setup, final false test and zero-iteration loops share the same destination rules',async()=>{
  const {recording}=await setup();
  for(const loop of recording.loopGroups.instances.filter(l=>['WhileStmt','DoStmt'].includes(l.scope.kind))){
    const destination=loopSkipDestination(recording.loopGroups,loop.start,'all');assert.equal(destination.target,loop.end);
    const p=new Playback(recording);p.seek(loop.start);p.skipTo(destination.target);assert.deepEqual(p.state,completed(recording,loop.end).state);
  }
  const first=recording.loopGroups.instances.find(l=>l.iterations.length===49);
  assert.equal(loopSkipDestination(recording.loopGroups,first.start,1).target,first.iterations[0].end);
  const final=loopSkipDestination(recording.loopGroups,first.iterations.at(-1).end,1);
  assert.equal(final.remaining,0);assert.equal(final.target,first.end);
  const empty=recording.loopGroups.instances.find(l=>!l.iterations.length);
  assert.equal(loopSkipDestination(recording.loopGroups,empty.start,100).target,empty.end);
});

test('large skips stay inside the innermost loop and the selected dynamic invocation',async()=>{
  const {recording}=await setup(),first=recording.loopGroups.instances.find(l=>l.iterations.length===49),second=recording.loopGroups.instances.find(l=>l.scopeId===first.scopeId&&l.frameId!==first.frameId);
  assert.ok(second);assert.equal(second.iterations.length,3);assert.ok(first.end<second.start);
  assert.equal(loopSkipDestination(recording.loopGroups,first.iterations[20].start,100).target,first.end);
  for(const inner of recording.loopGroups.instances.filter(l=>l.scope.kind==='WhileStmt'&&l.iterations.length===3)){
    const context=loopSkipContext(recording.loopGroups,inner.iterations[1].start);
    assert.equal(context.loop.id,inner.id);assert.equal(loopSkipDestination(recording.loopGroups,inner.iterations[1].start,100).target,inner.end);
  }
  assert.equal(loopSkipDestination(recording.loopGroups,recording.playbackLength,'all'),null);
  for(const count of [0,-1,1.5,Infinity,'unknown'])assert.throws(()=>loopSkipDestination(recording.loopGroups,first.start,count),RangeError);
});

test('native execution matches independent source-derived totals and supplies the UI verification recording',async()=>{
  const {result,recording}=await setup(),loop=recording.loopGroups.instances.find(l=>l.iterations.length===49),dir='test-results/loop-skip-count';await mkdir(dir,{recursive:true});
  assert.equal(result.trace.status,'completed');
  assert.equal(result.stdout,Array.from({length:49},(_,i)=>(i+1)*(i+2)/2+' ').join('')+'1 3 6 done 1225 6 7 4');
  await writeFile(`${dir}/recording.json`,JSON.stringify({plan:result.plan,trace:result.trace}));
  await writeFile(`${dir}/expectations.json`,JSON.stringify({start:loop.iterations[0].start,end:loop.end,totalIterations:49,
    destinations:Object.fromEntries([1,5,10,50,100,'all'].map(n=>[n,loopSkipDestination(recording.loopGroups,loop.iterations[0].start,n).target])),
    finalSum:49*50/2,expectedOutput:Array.from({length:49},(_,i)=>(i+1)*(i+2)/2+' ').join('')},null,2));
});
