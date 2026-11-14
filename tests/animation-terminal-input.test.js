import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {inputSubmission} from '../src/animation/terminal-input.js';
import {createRecording,Playback} from '../src/animation/playback.js';

test('Enter-style submission terminates the last token without duplicating line breaks; raw and EOF preserve bytes',()=>{
  for(const [text,expected] of [['1 100','1 100\n'],['1 100\n','1 100\n'],['1\n100','1\n100\n'],['','\n'],['한글  x ','한글  x \n'],['a\r\n','a\r\n']])
    assert.deepEqual(inputSubmission(text),{stdin:expected,eof:false});
  for(const text of ['1 100','a\n','', '\0']){
    assert.deepEqual(inputSubmission(text,{lineMode:false}),{stdin:text,eof:false});
    assert.deepEqual(inputSubmission(text,{eof:true}),{stdin:text,eof:true});
  }
});

async function execution(t,source){
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,source,file:'terminal-input.c'},execArgv:[]});
  t.after(()=>worker.terminate());
  const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
  const submit=async input=>{
    const next=once(worker,'message'),bytes=new TextEncoder().encode(input.stdin);new Uint8Array(shared,12).set(bytes);
    Atomics.store(control,1,bytes.length);Atomics.store(control,2,input.eof?1:0);Atomics.store(control,0,1);Atomics.notify(control,0);
    return (await next)[0];
  };
  return {first,submit};
}

test('the reported prime program records m=1,n=100 when plain 1 100 is submitted as a line',async t=>{
  const source=`#include <stdio.h>
int isPrime(int n){
    for(int j=2;j*j<=n;j++){
        if(n%j==0){return -1;}
    }
    return n;
}
int main(){
    int m,n; scanf("%d %d", &m, &n);
    for(int i=m;i<=n;i++){
        if(i==1){continue;}
        if(isPrime(i) == i) printf("%d\\n", i);
    }
    return 0;
}`;
  const {first,submit}=await execution(t,source);
  const result=await submit(inputSubmission('1 100'));assert.equal(result.type,'complete',result.error);
  assert.equal(result.trace.status,'completed');assert.equal(result.trace.exitCode,0);
  assert.equal(result.trace.runId,first.trace.runId);
  const recording=createRecording(result.plan,result.trace),player=new Playback(recording);
  const frame=result.trace.frames.find(f=>f.functionName==='main');
  for(const [name,expected] of [['m','1'],['n','100']]){
    const object=result.trace.objects.find(o=>o.name===name&&o.frameId===frame.id);
    const write=result.trace.events.findIndex(e=>e.kind==='WRITE'&&e.target?.objectId===object.id);
    assert.ok(write>=0);player.seek(write);assert.equal(player.state.objects.get(object.id).initialized,false);
    player.seek(write+1);assert.equal(player.state.objects.get(object.id).value.decimal,expected);
  }
  const primes=[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
  const calls=result.trace.events.filter(e=>e.action==='call'&&e.callee==='@printf');
  assert.equal(calls.length,primes.length);
  // Check each output's exact producer and replay point, not just the final text.
  for(const [index,call] of calls.entries()){
    const events=result.trace.events.filter(e=>e.action==='output'&&e.callExecutionId===call.eventId);
    assert.equal(events.map(e=>e.text).join(''),`${primes[index]}\n`);
    assert.equal(recording.instructions.get(events[0].instructionId).source.line,12);
    const position=recording.eventOrder.get(events.at(-1).eventId);
    assert.ok(position>recording.eventOrder.get(call.eventId));
    const resume=result.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId);
    assert.ok(position<recording.eventOrder.get(resume.eventId));
    player.seek(position+1);assert.equal(player.state.output,primes.slice(0,index+1).join('\n')+'\n');
  }
});

test('raw unterminated numeric input waits honestly; a later line ending resumes the same scanf',async t=>{
  const {first,submit}=await execution(t,'#include <stdio.h>\nint main(void){int lower,upper;scanf("%d %d",&lower,&upper);printf("%d %d",lower,upper);return 0;}');
  const waiting=await submit(inputSubmission('1 100',{lineMode:false}));assert.equal(waiting.type,'input',waiting.error);
  assert.equal(waiting.request.name,'scanf');assert.equal(waiting.trace.runId,first.trace.runId);
  const done=await submit(inputSubmission(''));assert.equal(done.type,'complete',done.error);
  assert.equal(done.trace.runId,first.trace.runId);
  const player=new Playback(createRecording(done.plan,done.trace));player.seek(done.trace.events.length);
  assert.equal(player.state.output,'1 100');assert.equal(player.state.input,'1 100\n');
});
