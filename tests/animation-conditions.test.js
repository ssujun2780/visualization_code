import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording, Playback, formatValue} from '../src/animation/playback.js';
import {conditionForEvent, recordedTruth} from '../src/animation/conditions.js';
import {toolsForEvent} from '../src/animation/tools.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldLayout} from '../src/animation/world.js';
import {dataFlowForEvent, transferPresentation} from '../src/animation/transfers.js';

const results = new Map();
async function example(name) {
  if (!results.has(name)) {
    const source = await readFile(new URL(`../examples/c/animation/${name}.c`, import.meta.url), 'utf8');
    const result = await traceModel(source);
    assert.equal(result.trace.status, 'completed', JSON.stringify(result.trace.diagnostics));
    const recording = createRecording(result.plan, result.trace);
    results.set(name, {...result, recording});
  }
  return results.get(name);
}
const expression = (r, event) => r.plan.instructions.find(i => i.id === event.instructionId)?.source?.expression;

test('six comparisons, signed/unsigned conversions and NaN use recorded C outcomes', async () => {
  const r = await example('comparisons');
  const compare = r.trace.events.filter(e => e.kind === 'CALC' && ['<', '<=', '>', '>=', '==', '!='].includes(e.operator));
  const first = compare.slice(0, 6);
  assert.deepEqual(first.map(e => conditionForEvent(r.recording, e).truth), [true, true, false, false, false, true]);
  const snapshot = JSON.stringify(r.trace);
  for (const event of compare) {
    const edges = dataFlowForEvent(r.recording, event);
    assert.ok(edges.length > 0);
    assert.equal(transferPresentation(r.recording, event, 0.2).active.index, 0);
    if (edges.length === 2) {
      assert.equal(transferPresentation(r.recording, event, 0.27).active.index, 0);
      assert.equal(transferPresentation(r.recording, event, 0.46).active.index, 1);
    }
    const ready = transferPresentation(r.recording, event, 0.88);
    assert.ok(ready.inputs.every(input => input.arrived));
    assert.equal(ready.active, null);
    const write = r.trace.events.find(e => e.kind === 'WRITE' && e.inputs?.some(input => input.executionId === event.eventId));
    assert.ok(write);
    assert.equal(dataFlowForEvent(r.recording, write).length, 1);
  }
  assert.equal(JSON.stringify(r.trace), snapshot, 'presentation does not mutate or reorder recorded IR');
  const converted = compare.find(e => expression(r, e) === 'negative < positive');
  assert.equal(conditionForEvent(r.recording, converted).truth, false);
  const nanEqual = compare.find(e => expression(r, e) === 'real == real');
  const nanDifferent = compare.find(e => expression(r, e) === 'real != real');
  assert.equal(conditionForEvent(r.recording, nanEqual).truth, false);
  assert.equal(conditionForEvent(r.recording, nanDifferent).truth, true);
});

test('scalar, negative, signed zero, nonzero real, NaN, bool and NULL guards use observed truth conversions', async () => {
  const r = await example('comparisons');
  const branches = r.trace.events.filter(e => e.action === 'branch');
  const outcomes = text => branches.filter(e => expression(r, e) === text).map(e => conditionForEvent(r.recording, e).truth);
  assert.deepEqual(outcomes('negative'), [true]);
  assert.deepEqual(outcomes('a - a'), [false]);
  assert.deepEqual(outcomes('real'), [false, true, true]);
  assert.deepEqual(outcomes('flag'), [true, false]);
  assert.deepEqual(outcomes('pointer'), [true, false]);
  for (const event of branches) assert.deepEqual(toolsForEvent(event, r.recording), ['alu']);
  assert.equal(recordedTruth({decimal: '8'}), null, 'rendering does not invent a truth conversion from an arithmetic result');
});

test('nested logic and NOT preserve inner outcomes while skipped expressions stay unknown and unexecuted', async () => {
  const r = await example('logic');
  const original = JSON.stringify(r.trace);
  const logical = r.trace.events.filter(e => e.kind === 'CALC' && conditionForEvent(r.recording, e)?.parts.some(part => part.operands.length));
  assert.ok(logical.length >= 6);
  const skipped = logical.flatMap(e => conditionForEvent(r.recording, e).parts.flatMap(part => part.operands.filter(operand => operand.skipped)));
  assert.ok(skipped.length >= 4);
  assert.ok(skipped.every(operand => operand.truth === null));
  assert.ok(skipped.some(operand => operand.expression.includes('touch')));
  const skippedCall = logical.find(e => expression(r, e) === 'a > b && touch(&calls)');
  assert.deepEqual(conditionForEvent(r.recording, skippedCall).inputValues.map(formatValue), ['3', '5'],
    'LLVM short-circuit placeholders are not shown as values read from the skipped operand');
  assert.equal(r.trace.frames.filter(frame => frame.functionName === 'touch').length, 1);
  const negated = logical.find(e => expression(r, e) === '!(a && b)');
  assert.ok(negated);
  const view = conditionForEvent(r.recording, negated);
  assert.equal(view.truth, false);
  assert.equal(view.parts.find(part => part.operator === '&&').truth, true);
  const player = new Playback(r.recording);
  player.seek(r.trace.events.findIndex(e => e.action === 'return.value' && e.activationId === 'f1'));
  assert.equal(formatValue([...player.state.objects.values()].find(o => o.name === 'calls' && o.frameId === 'f1').value), '1');
  assert.equal(JSON.stringify(r.trace), original);
});

test('ternary and loop conditions show actual repeated outcomes while switch remains a value selection', async () => {
  const r = await example('branches');
  const ternary = r.trace.events.find(e => e.action === 'conditional');
  assert.equal(conditionForEvent(r.recording, ternary).truth, true);
  const selection = conditionForEvent(r.recording, r.trace.events.find(e => e.action === 'switch'));
  assert.equal(selection.mode, 'selection');
  assert.equal(selection.truth, null);
  assert.equal(selection.selected, 'case 2');
  const whileChecks = r.trace.events.filter(e => e.action === 'branch' && expression(r, e) === 'i < 2');
  assert.deepEqual(whileChecks.map(e => conditionForEvent(r.recording, e).truth), [true, true, false]);
  const player = new Playback(r.recording);
  const index = r.trace.events.findIndex(e => e.action === 'return.value');
  player.seek(index);
  assert.equal(formatValue([...player.state.objects.values()].find(o => o.name === 'score').value), '201');
  player.seek(0);
  player.seek(index);
  assert.equal(conditionForEvent(r.recording, whileChecks.at(-1)).truth, false);
});

test('ordinary arithmetic is not treated as boolean just because its result is 0 or 1', async () => {
  const r = await traceModel('int main(void){int left=1,right=0;int ordinary=left+right;int nested=(left<right)+2;return 0;}');
  const recording = createRecording(r.plan, r.trace);
  const plain = r.trace.events.find(e => e.kind === 'CALC' && e.value?.decimal === '1');
  assert.equal(conditionForEvent(recording, plain), null);
  const nested = r.trace.events.find(e => e.kind === 'CALC' && e.value?.decimal === '2');
  assert.equal(conditionForEvent(recording, nested).mode, 'parts');
  assert.equal(conditionForEvent(recording, nested).truth, null);
  assert.equal(conditionForEvent(recording, nested).parts[0].truth, false);
});

test('ALU draws recorded true/false colors and switch selection without changing trace state', async () => {
  const cases = [[await example('comparisons'), 'a < b', '참 · True', '#7ee4ae'],
    [await example('comparisons'), 'a > b', '거짓 · False', '#ff8f9a'],
    [await example('branches'), null, 'case 2', '#83baff']];
  for (const [r, text, label, color] of cases) {
    const event = text ? r.trace.events.find(e => e.kind === 'CALC' && expression(r, e) === text) : r.trace.events.find(e => e.action === 'switch');
    const player = new Playback(r.recording);
    player.seek(r.trace.events.indexOf(event));
    player.progress = 0.88;
    const snapshot = structuredClone(player.state);
    const renderer = Object.create(SceneCanvas.prototype);
    const labels = [];
    Object.assign(renderer, {layout: new WorldLayout(), context: new Proxy({}, {get: () => () => {}})});
    renderer.box = () => {};
    renderer.label = (value, x, y, options) => labels.push({value, color: options.color});
    renderer.drawDevice(player, 'alu', 1);
    assert.ok(labels.some(item => item.value === label && item.color === color));
    assert.deepEqual(player.state, snapshot);
  }
});
