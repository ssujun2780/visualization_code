import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {immediateInputs, toolsForEvent, toolAppearances, spaceEffect} from '../src/animation/tools.js';
import {createRecording, Playback} from '../src/animation/playback.js';
import {WorldLayout} from '../src/animation/world.js';
import {traceModel} from '../scripts/model/index.mjs';

const sample = JSON.parse(await readFile(new URL('../public/animation-demo.json', import.meta.url), 'utf8'));

test('the actual a b c recording summons tools per task and keeps all 14 events intact', async () => {
  const original = JSON.stringify(sample);
  const expected = sample.trace.events.map(event => event.kind === 'CALC' ? ['alu'] : []);
  assert.equal(sample.trace.events.length, 14);
  assert.deepEqual(sample.trace.events.map(toolsForEvent), expected);
  for (const event of sample.trace.events.filter(event => event.kind === 'SPACE')) {
    assert.equal(toolsForEvent(event).length, 0);
    assert.ok(spaceEffect(event));
  }
  assert.equal(JSON.stringify(sample), original);
  const current = await traceModel(sample.plan.sourceMap.snapshot.text);
  assert.equal(current.trace.status, 'completed');
  assert.equal(current.trace.events.length, 14);
  assert.deepEqual(current.trace.events.map(toolsForEvent), expected);
  assert.deepEqual(current.trace.events.map(event => [event.kind, event.action, event.value?.decimal]),
    sample.trace.events.map(event => [event.kind, event.action, event.value?.decimal]));
});

test('reads and writes use no tools while ALU appears and retires on calculation tasks', () => {
  const events = sample.trace.events;
  assert.deepEqual(toolAppearances(events, 8, 0), []);
  assert.deepEqual(toolAppearances(events, 3, 0.4), []);
  assert.deepEqual(toolAppearances(events, 9, 0), [{id: 'alu', opacity: 0}]);
  assert.deepEqual(toolAppearances(events, 9, 1), [{id: 'alu', opacity: 0}]);
  assert.deepEqual(toolAppearances(events, 9, 0.4), [{id: 'alu', opacity: 1}]);
  assert.deepEqual(toolAppearances(events, 0, 0.5), []);
  assert.deepEqual(toolAppearances(events, events.length, 0), []);
});

test('tool retirement leaves pending READ and CALC values available for the next task', () => {
  const player = new Playback(createRecording(sample.plan, sample.trace));
  player.seek(9);
  assert.deepEqual([...player.state.tokens.values()].map(token => token.value.decimal), ['10', '20']);
  assert.ok(toolAppearances(sample.trace.events, 9, 0).every(tool => tool.opacity === 0));
  player.play();
  player.advance(player.duration);
  assert.equal(player.state.tokens.get('x10').value.decimal, '30');
  assert.equal(player.state.objects.get(sample.trace.events[10].target.objectId).value, null);
  player.advance(player.duration);
  assert.equal(player.state.objects.get(sample.trace.events[10].target.objectId).value.decimal, '30');
});

test('literal operands use ALU directly while copies keep their observed origins without tools', async () => {
  const result = await traceModel('int main(void){int value=3;int result=value*2;value=result;return value;}');
  assert.equal(result.trace.status, 'completed');
  const calc = result.trace.events.find(event => event.kind === 'CALC');
  assert.deepEqual(toolsForEvent(calc), ['alu']);
  assert.equal(immediateInputs(calc)[0].value.decimal ?? immediateInputs(calc)[0].value.literal, '2');
  const computedWrite = result.trace.events.find(event => event.kind === 'WRITE' && event.inputs?.some(input => input.executionId === calc.eventId));
  assert.deepEqual(toolsForEvent(computedWrite), []);
  assert.deepEqual(immediateInputs({kind: 'WRITE', inputs: [{observationId: 'private', value: {decimal: '2', evidence: 'compiler operand'}}]}), []);
});

test('moving ALU workbench preserves source boxes and ignores internal pending values', () => {
  const player = new Playback(createRecording(sample.plan, sample.trace));
  player.seek(9);
  const layout = new WorldLayout();
  const geometry = layout.resolve(player.state);
  const source = {...geometry.objects.get(sample.trace.events[7].target.objectId)};
  const alu = layout.deviceRectangle('alu');
  const anchor = layout.positions.get('tool:workbench');
  layout.move('tool:workbench', {x: anchor.x + 1000, y: anchor.y - 500});
  layout.resolve(player.state);
  assert.equal(layout.deviceRectangle('alu').x, alu.x + 1000);
  assert.equal(layout.deviceRectangle('alu').y, alu.y - 500);
  assert.deepEqual(layout.resolve(player.state).objects.get(sample.trace.events[7].target.objectId), source);
});
