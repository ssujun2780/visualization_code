import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {SceneCanvas} from '../src/animation/canvas.js';
import {createRecording, Playback, formatValue} from '../src/animation/playback.js';
import {WorldCamera, WorldLayout} from '../src/animation/world.js';

test('scalar and function playback draw local writes and data-flow arrows without staging cards', async () => {
  for (const file of ['animation-demo.json', 'animation-functions.json']) {
    const data = JSON.parse(await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8'));
    const player = new Playback(createRecording(data.plan, data.trace));
    const renderer = Object.create(SceneCanvas.prototype);
    Object.assign(renderer, {camera: new WorldCamera(), layout: new WorldLayout(), width: 1600, height: 1600, pixelRatio: 1,
      context: new Proxy({globalAlpha: 1}, {get: (target, key) => key in target ? target[key] : () => {}})});
    const drawn = new Map();
    let labels = [];
    let arrows = [];
    renderer.box = () => {};
    renderer.label = text => labels.push(String(text));
    renderer.drawObject = object => drawn.set(object.id, structuredClone(object));
    renderer.connection = () => {};
    renderer.routedConnection = path => arrows.push(path);
    for (let i = 0; i < data.trace.events.length; i++) {
      player.seek(i);
      labels = [];
      drawn.clear();
      arrows = [];
      renderer.render(player);
      const event = player.event;
      const before = structuredClone(player.state);
      player.progress = 0.2;
      renderer.render(player);
      player.progress = (player.timing.valueAt+100)/player.duration;
      renderer.render(player);
      if (event.action === 'frame.begin' && player.recording.frames.get(event.frameId)?.parent) {
        const parameters = player.recording.parameters.get(event.frameId);
        assert.equal(parameters.length, 2);
        for (const parameter of parameters) {
          assert.equal(drawn.get(parameter.id).parameter, true);
          assert.equal(drawn.get(parameter.id).value, null);
          assert.equal(player.state.objects.has(parameter.id), false);
        }
      }
      if (event.kind === 'WRITE' && event.target?.objectId) {
        assert.equal(formatValue(drawn.get(event.target.objectId).value), formatValue(event.value));
        assert.equal(drawn.get(event.target.objectId).initialized, true);
      }
      if (event.action === 'return.value') assert.ok(labels.includes(formatValue(event.value)));
      if (event.kind === 'CALC' || event.action === 'argument' || event.kind === 'WRITE' && event.inputs?.some(input => input.executionId)) {
        assert.ok(arrows.length > 0, `${event.eventId} must show its recorded data flow`);
      }
      assert.ok(labels.every(text => !/상수 공급기|값 전달기|전달을 기다리는 값/.test(text)));
      assert.deepEqual(player.state, before, 'presentation must not commit or reorder the recorded event');
    }
  }
});

test('Canvas displays the assigned return value before fading its source field and local boxes', async () => {
  const data = JSON.parse(await readFile(new URL('../public/animation-functions.json', import.meta.url), 'utf8'));
  const player = new Playback(createRecording(data.plan, data.trace));
  const end = data.trace.events.find(e => e.action === 'frame.end' && e.frameId === 'f2');
  const until = player.recording.framePresentationUntil.get(end.frameId);
  const renderer = Object.create(SceneCanvas.prototype);
  const context = {globalAlpha: 1};
  const saved = [];
  context.save = () => saved.push(context.globalAlpha);
  context.restore = () => { context.globalAlpha = saved.pop(); };
  Object.assign(renderer, {camera: new WorldCamera(), layout: new WorldLayout(), width: 2400, height: 2400, pixelRatio: 1,
    context: new Proxy(context, {get: (target, key) => key in target ? target[key] : () => {}})});
  const objects = new Map(),labels = [];
  renderer.box = () => {};
  renderer.label = text => labels.push({text: String(text),alpha: context.globalAlpha});
  renderer.drawObject = (object, state, alpha) => objects.set(object.id, {object,alpha});
  renderer.connection = () => {};
  const draw = progress => { objects.clear();labels.length = 0;player.progress = progress;renderer.render(player); };
  player.seek(player.recording.eventOrder.get(end.eventId));
  draw(0.8);
  assert.equal(labels.find(l => l.text === 'STACK · add').alpha, 1, 'frame.end does not start folding the return source');
  player.seek(until);
  draw(0.25);
  assert.equal(objects.get(player.event.target.objectId).object.value, null, 'the result has not arrived yet');
  draw(0.75);
  assert.equal(formatValue(objects.get(player.event.target.objectId).object.value), '30');
  assert.equal(labels.find(l => l.text === 'STACK · add').alpha, 1);
  assert.ok([...objects.values()].filter(x => x.object.frameId === 'f2').every(x => x.alpha === 1));
  assert.ok(!labels.some(l => l.text === 'add 반환'), 'no replacement marker floating in an empty field');
  draw(0.96);
  const alpha = labels.find(l => l.text === 'STACK · add').alpha;
  assert.ok(alpha > 0 && alpha < 1, 'fold only in the later phase, after assignment is visible');
  player.seek(until + 1);
  draw(0);
  assert.ok(!labels.some(l => l.text === 'STACK · add'));
  assert.ok([...objects.values()].every(x => x.object.frameId !== 'f2'));
});
