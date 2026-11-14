import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRecording, Playback, displayScene} from '../src/animation/playback.js';
import {dataFlowForEvent, calculationForEvent} from '../src/animation/transfers.js';
import {toolsForEvent, toolAppearances} from '../src/animation/tools.js';
import {WorldLayout, connectorPorts, containsPoint} from '../src/animation/world.js';

const scalar = JSON.parse(await readFile(new URL('../public/animation-demo.json', import.meta.url), 'utf8'));
const functions = JSON.parse(await readFile(new URL('../public/animation-functions.json', import.meta.url), 'utf8'));
const make = sample => createRecording(sample.plan, sample.trace);
const identity = edge => [edge.from.kind, edge.from.id, edge.to.kind, edge.to.id];

test('calculation inputs and result writes have separate variable -> ALU -> destination edges', () => {
  const recording = make(scalar);
  const calculation = scalar.trace.events.find(event => event.kind === 'CALC');
  const write = scalar.trace.events.find(event => event.inputs?.some(input => input.executionId === calculation.eventId));
  const reads = calculation.inputs.map(input => recording.events.get(input.executionId));
  const expected = reads.map(read => ['object', read.target.objectId, 'device', 'alu']);
  assert.deepEqual(dataFlowForEvent(recording, calculation).map(identity), expected);
  assert.deepEqual(dataFlowForEvent(recording, write).map(identity), [['device', 'alu', 'object', write.target.objectId]]);
  assert.equal(calculationForEvent(recording, write), calculation);
  assert.deepEqual(toolsForEvent(write, recording), ['alu']);
  assert.deepEqual(toolAppearances(scalar.trace.events, scalar.trace.events.indexOf(write), 0, recording), [{id: 'alu', opacity: 1}]);
  assert.deepEqual(dataFlowForEvent(recording, scalar.trace.events.find(event => event.action === 'write' && !event.inputs?.[0]?.executionId)), [], 'a literal has no invented source box');
});

test('arguments use caller object identities and returned values retain the actual callee return port', () => {
  const recording = make(functions);
  for (const event of functions.trace.events.filter(event => event.action === 'argument')) {
    const read = recording.events.get(event.inputs[0].executionId);
    assert.deepEqual(dataFlowForEvent(recording, event).map(identity), [['object', read.target.objectId, 'object', event.target.objectId]]);
    assert.deepEqual(toolsForEvent(event, recording), []);
  }
  const resume = functions.trace.events.find(event => event.action === 'resume');
  const returned = recording.events.get(resume.returnExecutionId);
  const write = functions.trace.events.find(event => event.inputs?.some(input => input.executionId === resume.eventId));
  assert.deepEqual(dataFlowForEvent(recording, write).map(identity), [['return-port', returned.activationId, 'object', write.target.objectId]]);
  const renamed = structuredClone(functions);
  for (const object of renamed.trace.objects) if (object.frameId === 'f1') object.name = object.name === 'a' ? 'x' : object.name === 'b' ? 'y' : object.name;
  const other = make(renamed);
  assert.deepEqual(dataFlowForEvent(other, write), dataFlowForEvent(recording, write), 'same names in different scopes must not change provenance');
});

test('all parameter slots appear with the callee mat without allocating objects or exposing future argument values', () => {
  const recording = make(functions);
  const player = new Playback(recording);
  const begin = functions.trace.events.findIndex(event => event.action === 'frame.begin' && recording.frames.get(event.frameId).parent);
  player.seek(begin);
  assert.equal([...displayScene(recording, player.state).objects.values()].filter(object => object.parameter).length, 0);
  const raw = structuredClone(player.after);
  const view = displayScene(recording, player.after);
  const parameters = [...view.objects.values()].filter(object => object.parameter);
  assert.equal(parameters.length, 2);
  assert.deepEqual(parameters.map(parameter => [parameter.name, parameter.size, parameter.value, parameter.initialized]), [['x', 4, null, false], ['y', 4, null, false]]);
  assert.ok(parameters.every(parameter => parameter.awaitingStorage && parameter.cType.name === 'int'));
  assert.deepEqual(player.after, raw);
  const layout = new WorldLayout();
  const initial = layout.resolve(view);
  const anchors = new Map(parameters.map(parameter => [parameter.id, {...initial.objects.get(parameter.id)}]));
  for (const event of functions.trace.events.filter(event => event.action === 'argument')) {
    player.seek(functions.trace.events.indexOf(event));
    const connected = displayScene(recording, player.state);
    const parameter = connected.objects.get(event.target.objectId);
    assert.equal(parameter.value, null);
    assert.equal(parameter.parameter, true);
    assert.deepEqual(layout.resolve(connected).objects.get(parameter.id), anchors.get(parameter.id), 'storage binding must reuse the existing slot');
  }
  player.seek(begin);
  assert.deepEqual(displayScene(recording, player.after), view, 'seeking restores the same empty parameter blueprint');
});

test('data-flow arrow endpoints follow dragged parameter mats and attach to box borders', () => {
  const recording = make(functions);
  const player = new Playback(recording);
  const argument = functions.trace.events.find(event => event.action === 'argument');
  player.seek(functions.trace.events.indexOf(argument));
  const view = displayScene(recording, player.state);
  const layout = new WorldLayout();
  const edge = dataFlowForEvent(recording, argument)[0];
  const before = layout.resolve(view);
  const source = {...before.objects.get(edge.from.id)};
  const target = {...before.objects.get(edge.to.id)};
  const anchor = layout.positions.get(`frame:${argument.activationId}`);
  layout.move(`frame:${argument.activationId}`, {x: anchor.x + 1400, y: anchor.y + 500});
  const after = layout.resolve(view);
  assert.deepEqual(after.objects.get(edge.from.id), source);
  assert.deepEqual(after.objects.get(edge.to.id), {...target, x: target.x + 1400, y: target.y + 500});
  const ports = connectorPorts(after.objects.get(edge.from.id), after.objects.get(edge.to.id));
  assert.ok(containsPoint(after.objects.get(edge.from.id), ports.from));
  assert.ok(containsPoint(after.objects.get(edge.to.id), ports.to));
  const rectangle = after.objects.get(edge.to.id);
  assert.ok(ports.to.x === rectangle.x || ports.to.x === rectangle.x + rectangle.width || ports.to.y === rectangle.y || ports.to.y === rectangle.y + rectangle.height);
});
