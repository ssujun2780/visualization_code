import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {sessionApi} from '../scripts/animation/session-api.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';

test('batch stdin reaches completion in one execution before playback preparation',async t=>{
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared:new SharedArrayBuffer(16396),file:'batch.c',initialInput:'10 20',inputEnded:true,
    source:'#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}'},execArgv:[]});
  t.after(()=>worker.terminate());const [result]=await once(worker,'message');assert.equal(result.type,'complete');assert.equal(result.trace.status,'completed');
  const p=new Playback(createRecording(result.plan,result.trace));p.seek(result.trace.events.length);assert.equal(p.state.output,'30\n');assert.equal(p.state.input,'10 20');
});

test('live stdin retains one execution, memory and source work across two independent input waits',async t=>{
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'live-input.c',source:`
    #include <stdio.h>
    int read_next(int *count){++*count;int value=0;if(scanf("%d",&value)!=1)return -1;return value+*count;}
    int main(void){int visits=0;puts("first?");int a=read_next(&visits);printf("a=%d\\n",a);
      puts("second?");fflush(stdout);int b=read_next(&visits);printf("b=%d visits=%d\\n",b,visits);return 0;}`},execArgv:[]});
  t.after(()=>worker.terminate());
  const receive=async()=>{const [message]=await once(worker,'message');assert.notEqual(message.type,'failure',message.error);return message;};
  const submit=async text=>{const next=receive(),bytes=new TextEncoder().encode(text);new Uint8Array(shared,12).set(bytes);
    Atomics.store(control,1,bytes.length);Atomics.store(control,2,0);Atomics.store(control,0,1);Atomics.notify(control,0);return next;};
  const first=await receive();assert.equal(first.type,'input');assert.equal(first.request.name,'scanf');
  const player=new Playback(createRecording(first.plan,first.trace));player.inputRequest=first.request;player.play();player.advance(1e9);
  assert.equal(player.waitingForInput,true);assert.equal(player.playing,false);assert.equal(player.state.input,'');
  assert.equal(player.state.output,'first?\n');
  const paused=structuredClone(player.state);player.play();player.advance(1e9);assert.deepEqual(player.state,paused);
  const second=await submit('7\n');assert.equal(second.type,'input');assert.equal(second.request.id,2);
  assert.equal(second.trace.runId,first.trace.runId,'same recorder and WASM execution, never a rerun');
  const next=new Playback(createRecording(second.plan,second.trace));next.seek(second.trace.events.length);
  assert.equal(next.state.output,'first?\na=8\nsecond?\n');
  assert.equal([...next.state.objects.values()].find(o=>o.name==='visits').value.decimal,'2');
  const final=await submit('9\n');assert.equal(final.type,'complete');assert.equal(final.trace.runId,first.trace.runId);
  assert.equal(final.trace.exitCode,0);const complete=new Playback(createRecording(final.plan,final.trace));complete.seek(final.trace.events.length);
  assert.equal(complete.state.output,'first?\na=8\nsecond?\nb=11 visits=2\n');
  assert.equal(complete.state.input,'7\n9\n');assert.equal(final.trace.events.filter(e=>e.action==='call'&&e.callee==='@read_next').length,2);
});

test('EOF is explicit and waiting has no fabricated input, result or cleanup',async t=>{
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'eof.c',source:`
    #include <stdio.h>
    int main(void){int c=getchar();printf("%d",c==EOF);return 0;}`},execArgv:[]});
  t.after(()=>worker.terminate());
  const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
  assert.ok(!first.trace.events.some(e=>e.action==='input'||e.action==='frame.end'||e.action==='output'));
  const pending=once(worker,'message');Atomics.store(control,1,0);Atomics.store(control,2,1);Atomics.store(control,0,1);Atomics.notify(control,0);
  const [final]=await pending;assert.equal(final.type,'complete',final.error);
  const player=new Playback(createRecording(final.plan,final.trace));player.seek(final.trace.events.length);assert.equal(player.state.output,'1');
});

test('a returned operand awaits its consumer across input without renumbering displayed commands or cleaning its field early',async t=>{
  const shared=new SharedArrayBuffer(16396),control=new Int32Array(shared,0,3);
  const worker=new Worker(new URL('../scripts/animation/session-worker.mjs',import.meta.url),{workerData:{shared,file:'pending-return.c',source:`
    #include <stdio.h>
    int left(void){return 7;}int right(void){int value=0;scanf("%d",&value);return value;}
    int main(void){int sum=left()+right();printf("%d",sum);return 0;}`},execArgv:[]});
  t.after(()=>worker.terminate());
  const [first]=await once(worker,'message');assert.equal(first.type,'input',first.error);
  const before=new Playback(createRecording(first.plan,first.trace));before.seek(first.trace.events.length);
  const returned=first.trace.events.find(e=>e.action==='return');assert.equal(returned.cleanupPending,true);
  assert.equal(before.state.frames.get(returned.activationId).alive,true);
  const pending=once(worker,'message'),bytes=new TextEncoder().encode('4\n');new Uint8Array(shared,12).set(bytes);
  Atomics.store(control,1,bytes.length);Atomics.store(control,0,1);Atomics.notify(control,0);
  const [final]=await pending;assert.equal(final.type,'complete',final.error);
  assert.deepEqual(final.trace.events.slice(0,first.trace.events.length).map(e=>[e.eventId,e.instructionId,e.action]),first.trace.events.map(e=>[e.eventId,e.instructionId,e.action]));
  const after=new Playback(createRecording(final.plan,final.trace));after.seek(before.cursor);
  assert.equal(after.state.frames.get(returned.activationId).alive,true);
  assert.equal(after.state.input,'');after.seek(final.trace.events.length);assert.equal(after.state.output,'11');
});

test('session API validates pending input, resumes same run and closes abandoned sessions',async t=>{
  const middleware=sessionApi(fileURLToPath(new URL('../',import.meta.url)));
  const server=createServer((req,res)=>void middleware(req,res,()=>res.end()));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{middleware.close();server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/animation/sessions`;
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post('',{example:'io-library'});assert.equal(response.status,200);const first=await response.json();assert.equal(first.type,'input');
  const path=`/${first.sessionId}/input`,requestId=first.request.id;
  assert.equal((await post(path,{requestId:requestId+1,stdin:'3 abc\n',eof:false})).status,409);
  assert.equal((await post(path,{requestId,stdin:'',eof:false})).status,400);
  const second=await(await post(path,{requestId,stdin:'3 abc\n',eof:false})).json();assert.equal(second.type,'input',second.error);assert.equal(second.request.name,'fgets');
  assert.equal(second.trace.runId,first.trace.runId);
  const final=await(await post(path,{requestId:second.request.id,stdin:'hello\n',eof:false})).json();assert.equal(final.type,'complete',final.error);
  const player=new Playback(createRecording(final.plan,final.trace));player.seek(final.trace.events.length);
  assert.equal(player.state.outputByChannel.get('stdout'),'abc!:3\n!!!\nhello\n');
  assert.equal((await post(path,{requestId,stdin:'extra',eof:false})).status,404);
  const abandoned=await(await post('',{example:'io-library'})).json();assert.equal((await fetch(`${base}/${abandoned.sessionId}`,{method:'DELETE'})).status,200);
  assert.equal((await post(`/${abandoned.sessionId}/input`,{requestId:1,stdin:'extra',eof:false})).status,404);
});
