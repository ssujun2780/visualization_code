import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {sessionApi} from '../scripts/animation/session-api.mjs';
import {createRecording,Playback,applyEvent} from '../src/animation/playback.js';
import {eventSource,recordedFault,isAttempt} from '../src/animation/faults.js';
import {transferPresentation,valueEffectForEvent} from '../src/animation/transfers.js';

async function run(source) {
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{
    workerData:{source,file:'arbitrary.c',shared:new SharedArrayBuffer(16396)},execArgv:[]});
  try {return (await once(worker,'message'))[0];} finally {await worker.terminate();}
}

test('fatal calculation preserves the actual prefix, has no result, and stops playback before subsequent work',async()=>{
  const result=await run(`#include <stdio.h>
int main(void) {
  int amount=12; int denominator=0;
  printf("before:%d\\n",amount);
  int answer=amount/denominator;
  puts("unreachable"); return answer;
}`);
  assert.equal(result.type,'complete',result.error);
  const recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  const fault=result.trace.events.find(e=>e.kind==='ERROR');assert.ok(fault);
  const attempted=result.trace.events.filter(isAttempt);
  assert.equal(eventSource(recording,fault).line,5);
  assert.equal(recordedFault(recording,fault).title,'런타임 오류');
  assert.equal(player.state.error,null);assert.equal(player.state.output,'');
  player.play();player.advance(1e9);
  assert.equal(player.playing,false);assert.equal(player.faultEvent,fault);
  assert.equal(player.state.output,'before:12\n');
  assert.ok(!player.state.output.includes('unreachable'));
  assert.ok([...player.state.frames.values()].some(f=>f.alive),'fault does not fabricate cleanup');
  assert.equal([...player.state.objects.values()].find(o=>o.name==='answer').value,null);
  for(const event of attempted){
    assert.equal(applyEvent(recording,player.state,event),player.state);
    assert.equal(transferPresentation(recording,event,1).resultReady,false);
    assert.equal(valueEffectForEvent(event),null);
    assert.ok(!player.state.tokens.has(event.eventId));
  }
  const end=structuredClone(player.state);player.advance(1e9);assert.deepEqual(player.state,end);
  player.seek(0);assert.equal(player.faultEvent,null);assert.equal(player.state.error,null);
  player.play();player.advance(1e9);assert.deepEqual(player.state,end);
  // Even a malformed imported recording cannot continue into post-fault work.
  const tail=result.trace.events.find(e=>e.action==='output');
  const extra={...tail,eventId:'after-fault',text:'must not execute'};
  const extended=createRecording(result.plan,{...result.trace,events:[...result.trace.events,extra]});
  const stopped=new Playback(extended);stopped.play();stopped.advance(1e9);
  assert.equal(stopped.cursor,extended.playbackLength);assert.equal(stopped.state.output,'before:12\n');
  stopped.seek(extended.trace.events.length);assert.equal(stopped.state.output,'before:12\n');
});

test('failed or incomplete attempts accept fault evidence but never apply values, memory writes or invalid addresses',async()=>{
  const sample=JSON.parse(await readFile(new URL('../public/animation-demo.json',import.meta.url),'utf8'));
  const index=sample.trace.events.findIndex(e=>e.kind==='CALC');
  const faultDefinition={id:'fault-definition',kind:'ERROR',action:'fault'};
  for(const phase of ['failed','incomplete'])for(const kind of ['CALC','WRITE','READ']){
    const attempt={...sample.trace.events[index],phase,kind,
      action:kind==='CALC'?'expression':kind==='WRITE'?'write':'read',instructionId:'attempt-definition',
      ...(kind==='CALC'?{}:{target:{objectId:sample.trace.objects[0].id,offset:999999,size:4}})};
    delete attempt.value;
    const error={eventId:'fault-event',instructionId:faultDefinition.id,kind:'ERROR',action:'fault',phase:'failed',
      failedExecutionId:attempt.eventId,diagnostic:{code:'fault',message:'recorded failure'}};
    const plan={...sample.plan,instructions:[...sample.plan.instructions,faultDefinition,
      {...sample.plan.instructions.find(i=>i.id===sample.trace.events[index].instructionId),id:attempt.instructionId,kind,action:attempt.action}]};
    const trace={...sample.trace,status:'fault',events:[...sample.trace.events.slice(0,index),attempt,error]};
    const recording=createRecording(plan,trace),player=new Playback(recording);player.seek(index);
    const before=player.state;
    assert.equal(applyEvent(recording,before,attempt),before);
    assert.equal(transferPresentation(recording,attempt,1).resultReady,false);
    assert.equal(valueEffectForEvent(attempt),null);
    assert.ok(eventSource(recording,error));
    player.play();player.advance(1e9);
    assert.equal(player.faultEvent,error);assert.deepEqual(player.state.objects,before.objects);
    assert.ok(!player.state.tokens.has(attempt.eventId));
  }
});

test('fatal memory access is shown at its recorded source without accepting a failed write',async()=>{
  const result=await run(`int main(void) {
  int values[2]={7,8};
  int index=4;
  values[index]=99;
  return 0;
}`);
  assert.equal(result.type,'complete',result.error);
  const recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  player.play();player.advance(1e9);
  assert.ok(player.faultEvent);assert.equal(eventSource(recording,player.faultEvent).line,4);
  assert.equal(player.playing,false);
  assert.ok(![...player.state.tokens.values()].some(t=>t.value?.decimal==='99'));
});

test('compile errors retain compiler coordinates and source before any execution',async()=>{
  const source='int main(void) {\n  return undefined_symbol;\n}';
  const result=await run(source);
  assert.equal(result.type,'failure');assert.equal(result.failure.stage,'compile');
  assert.equal(result.failure.source.line,2);assert.ok(result.failure.source.column>0);
  assert.equal(result.snapshot.text,source);assert.equal(result.trace,undefined);
  assert.ok(result.failure.details.includes('undefined_symbol'));
});

test('link failures are immediate and have no invented source position',async()=>{
  const result=await run('extern int missing(void); int main(void){return missing();}');
  assert.equal(result.type,'failure');assert.equal(result.failure.stage,'link');
  assert.equal(result.failure.source,null);assert.equal(result.trace,undefined);
});

test('successful compiler warnings and voluntary nonzero exits do not become runtime faults',async()=>{
  const result=await run('int main(void){int unused=7;return 3;}');
  assert.equal(result.type,'complete',result.error);
  const player=new Playback(createRecording(result.plan,result.trace));player.play();player.advance(1e9);
  assert.equal(player.faultEvent,null);assert.equal(player.state.error,null);
  assert.equal(result.trace.exitCode,3);
});

test('source-less traps and internal conversion errors do not invent C locations or causes',()=>{
  const recording={instructions:new Map(),events:new Map(),trace:{status:'fault',diagnostics:[]}};
  const event={eventId:'x1',kind:'ERROR',diagnostic:{code:'runtime-trap',message:'trap'}};
  assert.equal(eventSource(recording,event),null);
  assert.equal(recordedFault(recording,event).source,null);
  recording.trace.status='engine-error';assert.equal(recordedFault(recording,event).title,'중간언어 기록 오류');
});

test('a fatal operation after live input resumes the same prefix and stops without post-fault output',async t=>{
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'input-fault.c',source:`#include <stdio.h>
int main(void){int d;puts("ready");scanf("%d",&d);puts("received");fflush(stdout);int q=8/d;printf("%d",q);return 0;}`},execArgv:[]});
  t.after(()=>worker.terminate());
  const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
  const next=once(worker,'message'),bytes=new TextEncoder().encode('0\n');new Uint8Array(shared,12).set(bytes);
  Atomics.store(control,1,bytes.length);Atomics.store(control,0,1);Atomics.notify(control,0);
  const [final]=await next;assert.equal(final.type,'complete',final.error);
  assert.equal(final.trace.runId,first.trace.runId);
  assert.deepEqual(final.trace.events.slice(0,first.trace.events.length),first.trace.events);
  const player=new Playback(createRecording(final.plan,final.trace));player.seek(first.trace.events.length);
  assert.equal(player.state.output,'ready\n');assert.equal(player.state.error,null);
  player.play();player.advance(1e9);assert.ok(player.faultEvent);
  assert.equal(player.state.output,'ready\nreceived\n');assert.equal(player.waitingForInput,false);
});

test('HTTP session responses preserve compile diagnostics and runtime prefix records',async t=>{
  const api=sessionApi(fileURLToPath(new URL('../',import.meta.url)));
  const server=createServer((req,res)=>void api(req,res,()=>res.end()));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{api.close();server.closeAllConnections();server.close();});
  const post=example=>fetch(`http://127.0.0.1:${server.address().port}/api/animation/sessions`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({example})});
  const compile=await post('compile-error');assert.equal(compile.status,422);
  const failure=await compile.json();assert.equal(failure.failure.stage,'compile');
  assert.equal(failure.failure.source.line,5);assert.ok(failure.snapshot.text.includes('unknown_value'));
  const runtime=await post('runtime-error');assert.equal(runtime.status,200);
  const result=await runtime.json();assert.equal(result.type,'complete');
  const player=new Playback(createRecording(result.plan,result.trace));assert.equal(player.state.error,null);
  player.play();player.advance(1e9);assert.ok(player.faultEvent);
  assert.equal(player.state.output,'before: 12\n');
});
