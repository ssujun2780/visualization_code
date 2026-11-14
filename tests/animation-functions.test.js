import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording, Playback, formatValue, displayScene} from '../src/animation/playback.js';
import {valueEffectForEvent} from '../src/animation/transfers.js';
import {WorldLayout} from '../src/animation/world.js';

const sample = JSON.parse(await readFile(new URL('../public/animation-functions.json', import.meta.url), 'utf8'));
const objectNamed = (player, name, frameId) => [...player.state.objects.values()].find(o => o.name === name && (!frameId || o.frameId === frameId));
const effect = player => valueEffectForEvent(player.event);
const seekAction = (player, action, predicate = () => true) => {
  const index = player.recording.trace.events.findIndex(event => event.action === action && predicate(event));
  assert.ok(index >= 0, action);
  player.seek(index);
};

test('actual add trace preserves all 27 tasks, caller boxes and argument sources', async () => {
  const current = await traceModel(sample.plan.sourceMap.snapshot.text);
  assert.equal(current.trace.status, 'completed');
  assert.equal(current.trace.exitCode, 0);
  assert.equal(current.trace.events.length, 27);
  const observedOrder = [...current.trace.events].sort((a, b) => a.recordedOrder - b.recordedOrder);
  assert.deepEqual(observedOrder.map(e => [e.kind, e.action, e.value?.decimal]), sample.trace.events.map(e => [e.kind, e.action, e.value?.decimal]));
  const immutable = JSON.stringify(current);
  const player = new Playback(createRecording(current.plan, current.trace));
  seekAction(player, 'call');
  assert.equal(objectNamed(player, 'c').value, null);
  assert.equal(player.state.frames.size, 1);
  const sources = player.event.inputs.map(input => input.executionId);
  assert.deepEqual(sources.map(id => formatValue(player.state.tokens.get(id).value)), ['10', '20']);
  player.seek(player.cursor + 1);
  assert.ok(sources.every(id => player.state.tokens.has(id)), 'call must not erase argument cards');
  assert.equal(player.state.frames.size, 1, 'callee mat is created only by frame.begin');
  for (const event of current.trace.events.filter(e => e.action === 'argument')) {
    player.seek(current.trace.events.indexOf(event));
    assert.equal(objectNamed(player, event.name, event.activationId).value, null);
    assert.deepEqual(effect(player).target, {kind: 'object', id: event.target.objectId});
    assert.equal(formatValue(effect(player).value), formatValue(event.value));
    player.seek(player.cursor + 1);
    assert.equal(formatValue(objectNamed(player, event.name, event.activationId).value), formatValue(event.value));
  }
  assert.equal(JSON.stringify(current), immutable, 'viewer must not rewrite the IR');
});

test('return appears locally and retains its provenance through cleanup until the actual destination write', () => {
  const player = new Playback(createRecording(sample.plan, sample.trace));
  seekAction(player, 'return.value', e => Boolean(e.callExecutionId));
  const returnValue = player.event;
  assert.equal(effect(player).target.kind, 'return-port');
  seekAction(player, 'return', e => Boolean(e.callExecutionId));
  const callId = player.event.callExecutionId;
  assert.equal(effect(player), null, 'FLOW return has no additional transport animation');
  player.seek(player.cursor + 1);
  const waiting = structuredClone(player.state.tokens.get(returnValue.eventId));
  assert.equal(formatValue(waiting.value), '30');
  seekAction(player, 'resume');
  assert.equal(player.state.frames.get('f2').alive, false);
  assert.equal(objectNamed(player, 'x').alive, false);
  assert.equal(objectNamed(player, 'y').alive, false);
  const returningView = displayScene(player.recording, player.state);
  assert.equal(returningView.frames.get('f2').alive, true, 'return source remains visible until delivery');
  assert.equal(returningView.frames.get('f2').returnPending, true);
  assert.ok([...returningView.objects.values()].filter(o => o.frameId === 'f2').every(o => o.alive));
  assert.equal(objectNamed(player, 'a').alive, true);
  assert.equal(objectNamed(player, 'c').value, null);
  assert.equal(effect(player), null, 'resume reuses provenance without a second copy');
  const resumeId = player.event.eventId;
  player.seek(player.cursor + 1);
  assert.equal(player.state.tokens.get(resumeId).slot, waiting.slot);
  assert.equal(player.state.tokens.has(returnValue.eventId), false);
  assert.equal(player.state.calls.get(callId).status, 'resumed');
  assert.deepEqual(effect(player).target, {kind: 'object', id: objectNamed(player, 'c').id});
  assert.equal(objectNamed(player, 'c').value, null);
  player.seek(player.cursor + 1);
  assert.equal(formatValue(objectNamed(player, 'c').value), '30');
  assert.equal(displayScene(player.recording, player.state).frames.get('f2').alive, false, 'delivery precedes field removal');
  assert.equal(player.state.pendingFrameEnds.size, 0);
  assert.equal(player.state.tokens.has(resumeId), false);
  player.seek(sample.trace.events.length);
  assert.ok([...player.state.frames.values()].every(frame => !frame.alive));
  assert.ok([...player.state.objects.values()].every(object => !object.alive));
  assert.equal(player.state.tokens.size, 0);
});

test('renamed, repeated and nested functions share scalar transfers and retain pending sibling results', async () => {
  const result = await traceModel('int mix(int left,int right){int hold=left*3;return hold-right;}int main(void){int alpha=4;int beta=mix(alpha,2);int gamma=mix(beta,1);int delta=mix(mix(2,1),beta);return delta;}');
  assert.equal(result.trace.status, 'completed');
  const recording = createRecording(result.plan, result.trace);
  const player = new Playback(recording);
  const names = [...recording.frameNames.values()];
  assert.deepEqual(names, ['main', 'mix1', 'mix2', 'mix3', 'mix4']);
  for (let i = 0; i < result.trace.events.length; i++) {
    player.seek(i);
    const event = player.event;
    if (event.action === 'frame.begin' && recording.frames.get(event.frameId).parent) {
      const view = displayScene(recording, player.after);
      const objects = [...view.objects.values()].filter(object => object.frameId === event.frameId);
      assert.equal(objects.length, 2);
      assert.ok(objects.every(object => object.parameter && object.awaitingStorage && object.value === null));
      assert.ok([...player.after.objects.values()].every(object => object.frameId !== event.frameId));
    }
    if (event.action === 'argument') {
      assert.equal(effect(player).target.id, event.target.objectId);
      assert.equal(formatValue(effect(player).value), formatValue(event.value));
    }
  }
  seekAction(player, 'return.value', e => !e.callExecutionId);
  assert.equal(formatValue(objectNamed(player, 'beta').value), '10');
  assert.equal(formatValue(objectNamed(player, 'gamma').value), '29');
  assert.equal(formatValue(objectNamed(player, 'delta').value), '5');
});

test('recursive activations, void calls and discarded results replay without fictitious return cards', async () => {
  const sources = [
    ['int down(int n){if(n==0)return 1;int next=down(n-1);return next+n;}int main(void){int answer=down(3);return answer;}', '7'],
    ['void put(int *p,int v){*p=v;}int unused(int v){return v+1;}int main(void){int answer=2;put(&answer,8);unused(answer);return answer;}', '8'],
  ];
  for (const [source, expected] of sources) {
    const result = await traceModel(source);
    assert.equal(result.trace.status, 'completed');
    const player = new Playback(createRecording(result.plan, result.trace));
    for (let i = 0; i < result.trace.events.length; i++) {
      player.seek(i);
      if (player.event.action === 'argument') assert.equal(effect(player).target.id, player.event.target.objectId);
    }
    seekAction(player, 'return.value', e => !e.callExecutionId);
    assert.equal(formatValue(objectNamed(player, 'answer').value), expected);
    player.play();
    player.advance(100000);
    assert.equal(player.state.tokens.size, 0);
    assert.equal(player.state.pendingFrameEnds.size, 0);
    assert.ok([...player.state.frames.values()].every(frame => !frame.alive));
    const final = structuredClone(player.state);
    player.seek(Math.floor(result.trace.events.length / 2));
    player.play();
    player.advance(100000);
    assert.deepEqual(player.state, final, 'seeking must restore call context and card identity');
  }
});

test('current model orders nested, recursive and compound return cleanup without renderer deferral', async () => {
  const result = await traceModel('int bump(int n){return n+1;}int down(int n){if(!n)return 1;return down(n-1)+n;}int main(void){int a=bump(bump(2));int b=bump(3)+bump(4);int c=down(2);return a+b+c;}');
  assert.equal(result.trace.status, 'completed');
  const original = JSON.stringify(result),recording = createRecording(result.plan, result.trace),player = new Playback(recording);
  const deferred = result.trace.events.filter(e => e.action === 'frame.end' && e.cleanupAfterExecutionId);
  assert.ok(deferred.length >= 6);
  for (const end of deferred) {
    const at = recording.eventOrder.get(end.eventId),until = recording.eventOrder.get(end.cleanupAfterExecutionId);
    assert.ok(until < at);
    player.seek(until + 1);
    const waiting = displayScene(recording, player.state);
    assert.equal(waiting.frames.get(end.frameId).alive, true);
    assert.equal(player.state.pendingFrameEnds.size, 0);
    player.seek(at + 1);
    assert.equal(player.state.frames.get(end.frameId).alive, false);
    assert.equal(displayScene(recording, player.state).frames.get(end.frameId).alive, false);
    assert.equal(player.state.pendingFrameEnds.size, 0);
    player.seek(until + 1);
    assert.deepEqual(displayScene(recording, player.state), waiting);
  }
  assert.ok(deferred.some(e => recording.events.get(e.cleanupAfterExecutionId).action === 'argument'));
  assert.ok(deferred.some(e => recording.events.get(e.cleanupAfterExecutionId).action === 'return.value'));
  player.seek(result.trace.events.length);
  assert.equal(player.state.pendingFrameEnds.size, 0);
  assert.equal(JSON.stringify(result), original);
});

test('moving callee mats changes both parameter and return endpoints while caller boxes stay put', () => {
  const player = new Playback(createRecording(sample.plan, sample.trace));
  seekAction(player, 'argument');
  const layout = new WorldLayout();
  const geometry = layout.resolve(player.state);
  const caller = {...geometry.objects.get(objectNamed(player, 'a').id)};
  const parameter = {...geometry.objects.get(player.event.target.objectId)};
  const port = layout.returnPoint(player.event.activationId, player.state);
  const key = `frame:${player.event.activationId}`;
  const anchor = layout.positions.get(key);
  layout.move(key, {x: anchor.x + 2000, y: anchor.y + 600});
  const moved = layout.resolve(player.state);
  assert.deepEqual(moved.objects.get(objectNamed(player, 'a').id), caller);
  assert.equal(moved.objects.get(player.event.target.objectId).x, parameter.x + 2000);
  assert.deepEqual(layout.returnPoint(player.event.activationId, player.state), {x: port.x + 2000, y: port.y + 600});
});
