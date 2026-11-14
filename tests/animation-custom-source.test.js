import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {sessionApi} from '../scripts/animation/session-api.mjs';
import {Playback,createRecording} from '../src/animation/playback.js';
import {readAnimationSource,storeAnimationSource,sourceStorageKey} from '../src/animation/source-input.js';

async function serverFor(t){
  const api=sessionApi(fileURLToPath(new URL('../',import.meta.url)));
  const server=createServer((req,res)=>void api(req,res,()=>res.end()));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{api.close();server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/animation/sessions`;
  return (body,path='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

test('editor hands off an exact immutable source snapshot, including non-ASCII text',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  let draft='int main(void){return 0;} // 한글';
  assert.equal(readAnimationSource(storage),null);
  storeAnimationSource(storage,draft);const snapshot=draft;draft+=' changed';
  assert.equal(readAnimationSource(storage),snapshot);
  values.set(sourceStorageKey,'invalid');assert.equal(readAnimationSource(storage),null);
  values.set(sourceStorageKey,'{"source":3}');assert.equal(readAnimationSource(storage),null);
});

test('arbitrary C source combines calls, branches, pointers, arrays, records, allocations and live I/O in the same player',async t=>{
  const post=await serverFor(t);
  const source=`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct Cell {int value;struct Cell *next;} Cell;
int adjust(Cell *cursor,int limit){
  int total=0;
  while(cursor){
    if(cursor->value<limit)cursor->value+=2;
    total+=cursor->value;cursor=cursor->next;
  }
  return total;
}
int main(void){
  int count=0;puts("count?");
  if(scanf("%d",&count)!=1||count<1||count>8)return 0;
  Cell *cells=calloc(count,sizeof(Cell));if(!cells)return 1;
  for(int i=0;i<count;i++){cells[i].value=i+1;cells[i].next=i+1<count?&cells[i+1]:NULL;}
  Cell *aliases[2]={cells,cells+count-1};
  int result=adjust(aliases[0],3);
  int values[3]={aliases[0]->value,aliases[1]->value,result};
  char label[16];strcpy(label,"total");
  printf("%s=%d:%d:%d\\n",label,values[0],values[1],values[2]);
  free(cells);return 0;
}`;
  // Expected before invoking the model: [1,2,3] -> [3,4,3], sum=10.
  const response=await post({source});assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.type,'input',first.error);
  assert.equal(first.plan.sourceMap.snapshot.text,source);
  const before=new Playback(createRecording(first.plan,first.trace));before.play();before.advance(1e9);
  assert.equal(before.state.output,'count?\n');before.inputRequest=first.request;assert.equal(before.waitingForInput,true);
  const next=await post({requestId:first.request.id,stdin:'3\n',eof:true},`/${first.sessionId}/input`);
  const final=await next.json();assert.equal(final.type,'complete',final.error);assert.equal(final.trace.status,'completed');
  assert.equal(final.trace.runId,first.trace.runId);
  assert.deepEqual(final.trace.events.slice(0,first.trace.events.length),first.trace.events);
  const player=new Playback(createRecording(final.plan,final.trace));player.play();player.advance(1e9);
  assert.equal(player.state.output,'count?\ntotal=3:3:10\n');assert.equal(player.faultEvent,null);
  assert.ok(final.trace.frames.some(frame=>frame.functionName==='adjust'));
  assert.ok(final.trace.objects.some(object=>object.storage==='heap'));
  assert.ok(final.trace.events.some(event=>event.action==='object.end'));
});

test('custom source preserves immediate compile failure and prefix-then-runtime fault',async t=>{
  const post=await serverFor(t);
  const bad='int main(void){\n return undeclared_value;\n}';
  const failed=await post({source:bad});assert.equal(failed.status,422);
  const compile=await failed.json();assert.equal(compile.failure.stage,'compile');
  assert.equal(compile.snapshot.text,bad);assert.equal(compile.failure.source.line,2);assert.equal(compile.trace,undefined);
  const source='#include <stdio.h>\nint main(void){int z=0;puts("before");fflush(stdout);int q=8/z;puts("after");return q;}';
  const result=await(await post({source})).json();assert.equal(result.type,'complete',result.error);
  const player=new Playback(createRecording(result.plan,result.trace));assert.equal(player.state.error,null);
  player.play();player.advance(1e9);assert.ok(player.faultEvent);assert.equal(player.playing,false);
  assert.equal(player.state.output,'before\n');
});

test('source requests are validated and a source larger than the old input body limit is supported',async t=>{
  const post=await serverFor(t);
  for(const body of [null,[],{source:4},{source:'bad\0source'},{source:'',example:'scalar'}])assert.equal((await post(body)).status,400);
  assert.equal((await post({source:'x'.repeat(512*1024+1)})).status,413);
  const source='/*'+'padding '.repeat(5000)+'*/\nint main(void){int renamed=17;return renamed-17;}';
  const response=await post({source});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.type,'complete',result.error);
  assert.equal(result.plan.sourceMap.snapshot.text,source);assert.equal(result.trace.exitCode,0);
});
