import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readExecutionFiles} from '../scripts/shared/execution-files.mjs';
import {encodeExecution,decodeExecution,EXECUTION_ENCODING,EXECUTION_ACCEPT} from '../scripts/shared/execution-format.mjs';
import {inferStructures,decodeInference} from '../scripts/inference/index.mjs';
import {inferExecutionRelations} from '../scripts/execution-relations/index.mjs';
import {sessionApi} from '../scripts/animation/session-api.mjs';
import {exampleApi} from '../scripts/animation/example-api.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
const exec=promisify(execFile);
test('default CLI separates definitions and inference CLI consumes them without modifying the execution',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'execution-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const source=join(dir,'program.c'),output=join(dir,'trace');await writeFile(source,'#include <stdio.h>\ntypedef struct N{int v;struct N*next;}N;int sum(const N*p){int n=0;for(;p;p=p->next)n+=p->v;return n;}int main(void){N a={3,0},b={5,&a};printf("%d\\n",sum(&b));return 0;}');
 await exec(process.execPath,['scripts/trace-model.mjs',source,'--out-dir',output,'--with-observations','--jsonl'],{cwd:resolve('.'),timeout:30000});
 const saved=await readFile(join(output,'trace.json'),'utf8');assert.equal(JSON.parse(saved).encoding,EXECUTION_ENCODING);
 const raw=await readExecutionFiles(output);assert.equal(raw.trace.status,'completed');assert.equal(await readFile(join(output,'stdout.txt'),'utf8'),'8\n');
 assert.equal((await readFile(join(output,'trace.jsonl'),'utf8')).trimEnd().split('\n').length,raw.trace.events.length);
 const player=new Playback(createRecording(raw.plan,raw.trace));player.seek(raw.trace.events.length);assert.equal(player.state.output,'8\n');
 const baseline=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations.plan,observedTrace:raw.observations.trace});
 await exec(process.execPath,['scripts/infer-structures.mjs',output,'--out-dir',join(dir,'inferred'),'--shared'],{cwd:resolve('.'),timeout:30000});
 assert.deepEqual(decodeInference(JSON.parse(await readFile(join(dir,'inferred','inference.json'),'utf8'))),baseline);
 await exec(process.execPath,['scripts/infer-execution-relations.mjs',output,'--out-dir',join(dir,'relations')],{cwd:resolve('.'),timeout:30000});
 assert.deepEqual(JSON.parse(await readFile(join(dir,'relations','execution-relations.json'),'utf8')),JSON.parse(JSON.stringify(inferExecutionRelations(raw.plan,raw.trace))));
 await exec(process.execPath,['scripts/animation/prepare-view-file.mjs',output,join(dir,'inferred','inference.json'),join(dir,'prepared.json')],{cwd:resolve('.'),timeout:30000});
 const prepared=decodeExecution(JSON.parse(await readFile(join(dir,'prepared.json'),'utf8')));assert.deepEqual(prepared.plan,raw.plan);assert.deepEqual(prepared.trace,raw.trace);assert.ok(prepared.preparedScene);
 assert.equal(await readFile(join(output,'trace.json'),'utf8'),saved);
});
test('stored linked and pointer-heap evidence produces the identical inference after shared-definition restoration',async()=>{
 for(const name of ['returned-list','pointer-heap']){
  const raw=await frozenInferenceExecution(name),restored=decodeExecution(JSON.parse(JSON.stringify(encodeExecution(raw))));assert.deepEqual(restored,raw);
  const options=r=>({observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});
  assert.deepEqual(inferStructures(restored.plan,restored.trace,options(restored)),inferStructures(raw.plan,raw.trace,options(raw)));
 }
});
test('negotiated HTTP snapshots retain one live execution and can be consumed by ordinary playback',async t=>{
 const middleware=sessionApi(resolve('.')),server=createServer((req,res)=>void middleware(req,res,()=>{res.writeHead(404);res.end();}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{middleware.close();server.closeAllConnections();server.close();});
 const root=`http://127.0.0.1:${server.address().port}/api/animation/sessions`,headers={'Content-Type':'application/json',Accept:EXECUTION_ACCEPT},
  source='#include <stdio.h>\nint main(void){int n;puts("ready");scanf("%d",&n);printf("%d\\n",n+1);return 0;}';
 const firstResponse=await fetch(root,{method:'POST',headers,body:JSON.stringify({source})}),firstWire=await firstResponse.json();assert.equal(firstResponse.status,200);assert.equal(firstWire.encoding,EXECUTION_ENCODING);
 const first=decodeExecution(firstWire);assert.equal(first.type,'input');
 const response=await fetch(`${root}/${first.sessionId}/input`,{method:'POST',headers,body:JSON.stringify({stdin:'9\n',eof:false,requestId:first.request.id})}),wire=await response.json();assert.equal(response.status,200);assert.equal(wire.encoding,EXECUTION_ENCODING);
 const last=decodeExecution(wire);assert.equal(last.type,'complete');assert.equal(last.trace.runId,first.trace.runId);
 const p=new Playback(createRecording(last.plan,last.trace));p.seek(last.trace.events.length);assert.equal(p.state.output,'ready\n10\n');
 assert.deepEqual(last.trace.events.slice(0,first.trace.events.length).map(e=>e.eventId),first.trace.events.map(e=>e.eventId));
});
test('example endpoint negotiates the format and retains legacy JSON for existing clients',async t=>{
 const middleware=exampleApi(resolve('.')),server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/animation/examples/scalar`;
 const packed=await (await fetch(url,{headers:{Accept:EXECUTION_ACCEPT}})).json(),legacy=await (await fetch(url)).json();
 assert.equal(packed.encoding,EXECUTION_ENCODING);assert.equal(legacy.encoding,undefined);
 const decoded=decodeExecution(packed);assert.equal(decoded.trace.status,'completed');assert.equal(legacy.trace.status,'completed');
 // scalar.c adds 10 + 20 and returns without printing.
 for(const result of [decoded,legacy]){const p=new Playback(createRecording(result.plan,result.trace));p.seek(result.trace.events.length);assert.equal(p.state.output,'');
  const c=result.trace.objects.find(o=>o.name==='c');assert.ok(result.trace.events.some(e=>e.kind==='WRITE'&&e.target?.objectId===c.id&&e.value?.decimal==='30'));
 }
});
