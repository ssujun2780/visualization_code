import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import animationExamples, {exampleApi} from '../scripts/animation/example-api.mjs';
import {createRecording, Playback} from '../src/animation/playback.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('example HTTP API executes the current model for every request and returns delivery-before-cleanup IR', async t => {
  const middleware = exampleApi(root);
  const server = createServer((request, response) => middleware(request, response, () => { response.writeHead(404); response.end(); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/animation/examples/`;
  const response = await fetch(endpoint + 'functions');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const first = await response.json();
  assert.equal(first.plan.sourceMap.snapshot.text, await readFile(new URL('../examples/c/animation/add.c', import.meta.url), 'utf8'));
  assert.equal(first.trace.status, 'completed');
  assert.equal(first.trace.events.length, 27);
  const returned = first.trace.events.find(event => event.action === 'return' && event.delivery);
  const delivery = returned.delivery;
  const receiver = first.trace.events.findIndex(event => event.eventId === delivery.completionExecutionId);
  const cleanup = first.trace.events.findIndex(event => event.eventId === delivery.frameEndExecutionId);
  assert.ok(receiver < cleanup);
  assert.equal(first.trace.events[receiver].value.decimal, '30');
  const player = new Playback(createRecording(first.plan, first.trace));
  player.seek(cleanup);
  assert.equal(player.state.frames.get(returned.activationId).alive, true);
  assert.equal(player.state.pendingFrameEnds.size, 0);
  player.seek(cleanup + 1);
  assert.equal(player.state.frames.get(returned.activationId).alive, false);
  const second = await (await fetch(endpoint + 'functions')).json();
  assert.notEqual(second.trace.runId, first.trace.runId, 'rerunning must generate a fresh model result');
  const scalar = await (await fetch(endpoint + 'scalar')).json();
  assert.equal(scalar.trace.status, 'completed');
  assert.equal(scalar.plan.sourceMap.snapshot.text, await readFile(new URL('../examples/c/animation/scalar.c', import.meta.url), 'utf8'));
  for (const id of ['comparisons', 'logic', 'branches']) {
    const generated = await (await fetch(endpoint + id)).json();
    assert.equal(generated.trace.status, 'completed', generated.error);
    const compatible = new Playback(createRecording(generated.plan, generated.trace));
    compatible.seek(generated.trace.events.length);
    assert.ok([...compatible.state.frames.values()].every(frame => !frame.alive));
  }
  assert.equal((await fetch(endpoint + 'missing')).status, 404);
  assert.equal((await fetch(endpoint + 'functions', {method: 'PUT'})).status, 405);
});

test('model and example changes notify live animation pages to regenerate their examples', () => {
  const sent = [];
  const plugin = animationExamples();
  const server = {config: {root}, ws: {send: message => sent.push(message)}};
  for (const file of ['scripts/model/return-sequence.mjs', 'examples/c/animation/add.c']) {
    assert.deepEqual(plugin.handleHotUpdate({server, file: fileURLToPath(new URL(`../${file}`, import.meta.url))}), []);
  }
  assert.equal(sent.length, 2);
  assert.ok(sent.every(message => message.event === 'animation:model-changed'));
  assert.equal(plugin.handleHotUpdate({server, file: fileURLToPath(new URL('../docs/design/return-sequence.md', import.meta.url))}), undefined);
});

test('input examples execute supplied stdin, distinguish streams, and validate request input',async t=>{
  const middleware=exampleApi(root),server=createServer((req,res)=>middleware(req,res,()=>res.end()));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const endpoint=`http://127.0.0.1:${server.address().port}/api/animation/examples/io-library`;
  const run=async stdin=>{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stdin})});
    assert.equal(response.status,200);return response.json();
  };
  const result=await run('4 xy\nworld\n'),player=new Playback(createRecording(result.plan,result.trace));player.seek(result.trace.events.length);
  assert.equal(result.trace.status,'completed');assert.equal(player.state.outputByChannel.get('stdout'),'xy!:4\n!!!\nworld\n');
  assert.equal(player.state.outputByChannel.get('stderr'),'len=5\n');assert.equal(player.state.input,'4 xy\nworld\n');
  const empty=await run('');assert.equal(empty.trace.status,'completed');assert.ok(!empty.trace.events.some(e=>e.action==='output'));
  assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,400);
  assert.equal((await fetch(endpoint,{method:'POST',body:JSON.stringify({stdin:'x'.repeat(16385)})})).status,413);
});
