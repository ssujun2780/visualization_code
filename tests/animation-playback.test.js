import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRecording, Playback, formatValue, applyEvent, emptyScene} from '../src/animation/playback.js';
import {traceModel} from '../scripts/model/index.mjs';

const sample = JSON.parse(await readFile(new URL('../public/animation-demo.json', import.meta.url), 'utf8'));
const recording = () => createRecording(sample.plan, sample.trace);
const named = (player, name) => [...player.state.objects.values()].find(object => object.name === name);

test('animation replays the actual scalar trace without leaking final ledger state', () => {
  const player = new Playback(recording());
  assert.equal(player.state.objects.size, 0);
  assert.equal(player.state.frames.size, 0);
  player.seek(3);
  assert.equal(named(player, 'a').alive, true);
  assert.equal(named(player, 'a').value, null);
  assert.equal(named(player, 'a').initialized, false);
  assert.equal(named(player, 'b'), undefined);
  player.seek(4);
  assert.equal(formatValue(named(player, 'a').value), '10');
  player.seek(10);
  assert.equal(named(player, 'c').value, null);
  assert.equal(formatValue(player.state.tokens.get('x10').value), '30');
  assert.equal(player.state.tokens.has('x8'), false);
  player.seek(11);
  assert.equal(formatValue(named(player, 'c').value), '30');
  assert.equal(player.state.tokens.has('x10'), false);
  player.seek(14);
  assert.ok([...player.state.objects.values()].every(object => !object.alive));
  assert.equal(player.state.frames.get('f1').alive, false);
});

test('pause speed and seek preserve commit boundaries and recorded values', () => {
  const player = new Playback(recording());
  player.seek(3);
  player.play();
  player.advance(player.duration / 2);
  assert.equal(player.progress, 0.5);
  assert.equal(named(player, 'a').value, null);
  player.playing = false;
  player.advance(5000);
  assert.equal(player.progress, 0.5);
  player.speed = 2;
  player.play();
  player.advance(player.duration / 4);
  assert.equal(player.cursor, 4);
  assert.equal(formatValue(named(player, 'a').value), '10');
  const final = new Playback(recording());
  final.play();
  final.advance(100000);
  const expected = structuredClone(final.state);
  final.seek(6);
  final.play();
  final.advance(100000);
  assert.deepEqual(final.state, expected);
  assert.equal(final.playing, false);
});

test('all slider rates scale incident time and preserve identical instruction boundaries',()=>{
  let expected;
  for(const speed of [0.25,0.5,1,2,4,10]) {
    const player=new Playback(recording());player.seek(9);player.speed=speed;player.play();
    const duration=player.duration;assert.equal(duration,6400);
    player.advance(800/speed);
    assert.equal(player.cursor,9);assert.ok(Math.abs(player.progress-800/duration)<1e-9);
    assert.equal(named(player,'c').value,null,'the first moving operand does not write the calculation destination');
    player.advance((duration-800)/speed);
    assert.equal(player.cursor,10);assert.equal(player.progress,0);
    assert.equal(player.state.tokens.get('x10').value.decimal,'30');
    if(expected)assert.deepEqual(player.state,expected);else expected=structuredClone(player.state);
    player.advance(player.duration/speed);assert.equal(player.cursor,11);assert.equal(named(player,'c').value.decimal,'30');
  }
});

test('the same player handles changed names values pointer writes and a condition from the real API', async () => {
  const result = await traceModel('int main(void){int first=7;int second=4;int *pointer=&first;*pointer=second+3;if(first==7)second=first*2;return second;}');
  assert.equal(result.trace.status, 'completed');
  const player = new Playback(createRecording(result.plan, result.trace));
  const beforeReturn = result.trace.events.findIndex(event => event.action === 'return.value');
  player.seek(beforeReturn);
  assert.equal(formatValue(named(player, 'first').value), '7');
  assert.equal(formatValue(named(player, 'second').value), '14');
  assert.equal(named(player, 'pointer').value.reference.targetObjectId, named(player, 'first').id);
  assert.ok(result.trace.events.some(event => event.kind === 'FLOW' && event.action === 'branch'));
});

test('unsupported accesses and unbound instructions are rejected before playback', () => {
  const invalid = structuredClone(sample);
  invalid.trace.events[7].target.offset = 1;
  assert.throws(() => createRecording(invalid.plan, invalid.trace), /접근 범위/);
  invalid.trace.events[0].instructionId = 'missing';
  assert.throws(() => createRecording(invalid.plan, invalid.trace), /일치하지/);
});

test('the input mat follows observed arrivals without duplicating buffered reads or splitting UTF-8', () => {
  const data = recording();
  let state = emptyScene();
  state = applyEvent(data, state, {kind: 'READ', action: 'input', inputStage: 'arrival', bytesHex: 'ea'});
  assert.equal(state.input, '');
  state = applyEvent(data, state, {kind: 'READ', action: 'input', inputStage: 'arrival', bytesHex: 'b0800a'});
  assert.equal(state.input, '가\n');
  state = applyEvent(data, state, {kind: 'READ', action: 'input', inputStage: 'buffer-read', bytesHex: 'eab080'});
  assert.equal(state.input, '가\n');
});
