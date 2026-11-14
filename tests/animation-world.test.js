import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldCamera, WorldLayout, containsPoint, rectangleCenter, avoidMatOverlap,SYSTEM_MATS} from '../src/animation/world.js';
import {emptyScene} from '../src/animation/playback.js';

function sceneWithFrames(counts) {
  const state = emptyScene();
  counts.forEach((count, frameIndex) => {
    const id = `f${frameIndex + 1}`;
    state.frames.set(id, {id, name: 'work', slot: frameIndex, alive: true});
    for (let index = 0; index < count; index++) {
      const objectId = `${id}:o${index}`;
      state.objects.set(objectId, {id: objectId, name: objectId, frameId: id, slot: index, size: 4, alive: true});
    }
  });
  return state;
}

function assertSeparated(geometry) {
  const mats = [...geometry.mats.values()].filter(mat => mat.alive);
  for (let index = 0; index < mats.length; index++) {
    for (const other of mats.slice(index + 1)) {
      const a = mats[index].rectangle;
      const b = other.rectangle;
      assert.ok(a.x + a.width + 23.99999 <= b.x || b.x + b.width + 23.99999 <= a.x ||
        a.y + a.height + 23.99999 <= b.y || b.y + b.height + 23.99999 <= a.y, `${mats[index].id} overlaps ${other.id}`);
    }
  }
}

test('camera transforms preserve the pointer world position under zoom and allow unbounded pan', () => {
  const camera = new WorldCamera();
  camera.pan(-450, 200);
  const pointer = {x: 280, y: 175};
  const before = camera.toWorld(pointer);
  camera.zoom(2.5, pointer);
  assert.deepEqual(camera.toWorld(pointer), before);
  assert.deepEqual(camera.toScreen(before), pointer);
  camera.pan(1000000, -2000000);
  assert.ok(camera.x > 900000);
  assert.ok(camera.y < -1900000);
});

test('all system mats exist at the beginning and fit includes negative and distant manual positions', () => {
  const layout = new WorldLayout();
  const state = emptyScene();
  assert.equal(layout.resolve(state).mats.size, 3);
  layout.move('tool:input', {x: -20000, y: -30000});
  layout.move('tool:output', {x: 1000000, y: 2000000});
  const geometry = layout.resolve(state);
  const camera = new WorldCamera();
  camera.fit(geometry.bounds, 1000, 600);
  assert.ok(camera.scale < 0.002);
  for (const mat of geometry.mats.values()) {
    const first = camera.toScreen(mat.rectangle);
    const last = camera.toScreen({x: mat.rectangle.x + mat.rectangle.width, y: mat.rectangle.y + mat.rectangle.height});
    assert.ok(first.x >= 0 && first.y >= 0);
    assert.ok(last.x <= 1000 && last.y <= 600);
  }
});

test('large variable fields grow from their contents and subsequent frame defaults do not overlap', () => {
  const layout = new WorldLayout();
  const state = sceneWithFrames([45, 8, 17]);
  const snapshot = structuredClone(state);
  const geometry = layout.resolve(state);
  const frames = [...geometry.mats.values()].filter(mat => mat.frameId);
  assert.ok(frames[0].rectangle.height > 2000 && frames[0].rectangle.height < 2140,'45 boxes use compact rows while preserving routing corridors');
  for (let index = 1; index < frames.length; index++) {
    assert.ok(frames[index].rectangle.y >= frames[index - 1].rectangle.y + frames[index - 1].rectangle.height);
  }
  for (const object of state.objects.values()) {
    const rectangle = geometry.objects.get(object.id);
    const parent = geometry.mats.get(`frame:${object.frameId}`).rectangle;
    assert.ok(containsPoint(parent, rectangle));
    assert.ok(containsPoint(parent, {x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height}));
  }
  assert.deepEqual(state, snapshot, 'layout must not change execution state');
});

test('moving a frame carries its boxes and moving one box preserves its neighbors and scope', () => {
  const layout = new WorldLayout();
  const state = sceneWithFrames([3]);
  const original = layout.resolve(state);
  const first = original.objects.get('f1:o0');
  const neighbor = original.objects.get('f1:o1');
  const anchor = layout.positions.get('frame:f1');
  layout.move('frame:f1', {x: anchor.x + 350, y: anchor.y - 400});
  const moved = layout.resolve(state);
  assert.equal(moved.objects.get('f1:o0').x, first.x + 350);
  assert.equal(moved.objects.get('f1:o1').y, neighbor.y - 400);
  const neighborAfterFrameMove = {...moved.objects.get('f1:o1')};
  layout.move('object:f1:o0', {x: -1000, y: -700});
  const next = layout.resolve(state);
  assert.deepEqual(next.objects.get('f1:o1'), neighborAfterFrameMove);
  assert.equal(state.objects.get('f1:o0').frameId, 'f1');
  const rectangle = next.objects.get('f1:o0');
  assert.ok(containsPoint(next.mats.get('frame:f1').rectangle, rectangle));
  assert.equal(layout.hitTest(state, rectangleCenter(rectangle)).key, 'object:f1:o0');
  layout.resolve(emptyScene());
  assert.deepEqual(layout.resolve(structuredClone(state)).objects.get('f1:o0'), rectangle, 'seeking retains the user layout');
});

test('tool movement carries ALU and layout reset restores defaults without displaying operand tokens', () => {
  const layout = new WorldLayout();
  const state = sceneWithFrames([1]);
  state.tokens.set('x1', {slot: 0});
  state.tokens.set('x2', {slot: 5});
  const before = layout.resolve(state).mats.get('tool:workbench').rectangle;
  const device = layout.deviceRectangle('alu');
  layout.move('tool:workbench', {x: before.x + 420, y: before.y - 650});
  assert.equal(layout.deviceRectangle('alu').x, device.x + 420);
  assert.equal(layout.deviceRectangle('alu').y, device.y - 650);
  assert.equal(layout.resolve(state).mats.get('tool:workbench').rectangle.height, 250);
  const mat = layout.resolve(state).mats.get('tool:workbench').rectangle;
  assert.equal(layout.hitTest(state, {x: mat.x + 20, y: mat.y + 20}).key, 'tool:workbench');
  layout.reset();
  assert.equal(layout.toolRectangle('tool:workbench').x, SYSTEM_MATS.find(m=>m.id==='tool:workbench').x);
  assert.equal(layout.toolRectangle('tool:workbench').y, 100);
});

test('automatic field growth respects a manually positioned tool', () => {
  const layout = new WorldLayout();
  layout.resolve(sceneWithFrames([3]));
  const location = {x: -500, y: -500};
  layout.move('tool:input', location);
  layout.resolve(sceneWithFrames([60]));
  const input = layout.toolRectangle('tool:input');
  assert.equal(input.x, location.x);
  assert.equal(input.y, location.y);
});

test('dropping a tool onto a frame adjusts the moved mat and preserves its neighbors', () => {
  const layout = new WorldLayout();
  const state = sceneWithFrames([3, 2]);
  const before = layout.resolve(state);
  layout.move('tool:input', {x: 90, y: 150});
  const after = layout.resolve(state);
  assertSeparated(after);
  for (const id of ['frame:f1', 'frame:f2', 'tool:workbench', 'tool:output']) {
    assert.deepEqual(after.mats.get(id).rectangle, before.mats.get(id).rectangle, id);
  }
  const result = after.mats.get('tool:input').rectangle;
  assert.ok(result.x !== 90 || result.y !== 150);
});

test('drag preview settles when released including a new frame appearing during execution', () => {
  const layout = new WorldLayout();
  const initial = emptyScene();
  layout.resolve(initial);
  layout.move('tool:workbench', {x: 50, y: 100}, {preview: true});
  const state = sceneWithFrames([3]);
  layout.resolve(state);
  layout.finishMove();
  const after = layout.resolve(state);
  assertSeparated(after);
  const positions = structuredClone(layout.positions);
  for (let index = 0; index < 5; index++) {
    layout.resolve(initial);
    assertSeparated(layout.resolve(state));
  }
  assert.deepEqual(layout.positions, positions, 'repeated before/after rendering must not keep moving mats');
});

test('reserving a future function field avoids a tool placed there before execution', () => {
  const layout = new WorldLayout();
  layout.resolve(emptyScene());
  layout.move('tool:workbench', {x: 50, y: 100});
  const tool = {...layout.resolve(emptyScene()).mats.get('tool:workbench').rectangle};
  const geometry = layout.resolve(sceneWithFrames([3]));
  assertSeparated(geometry);
  assert.deepEqual(geometry.mats.get('tool:workbench').rectangle, tool);
});

test('growth of an existing field avoids pinned tools and moving a box enlarges its owner safely', () => {
  const layout = new WorldLayout();
  layout.resolve(sceneWithFrames([3]));
  layout.move('tool:input', {x: 70, y: 450});
  const before = layout.resolve(sceneWithFrames([3]));
  const input = {...before.mats.get('tool:input').rectangle};
  const expanded = sceneWithFrames([33]);
  const after = layout.resolve(expanded);
  assertSeparated(after);
  assert.deepEqual(after.mats.get('tool:input').rectangle, input);
  layout.move('object:f1:o0', {x: 900, y: -200});
  assertSeparated(layout.resolve(expanded));
  assert.equal(expanded.objects.get('f1:o0').frameId, 'f1');
});

test('internal pending values never enlarge the workbench or move existing mats', () => {
  const layout = new WorldLayout();
  const initial = emptyScene();
  layout.resolve(initial);
  layout.move('tool:input', {x: 770, y: 620});
  const input = {...layout.resolve(initial).mats.get('tool:input').rectangle};
  const before = structuredClone(layout.resolve(initial));
  const expanded = emptyScene();
  expanded.tokens.set('x1', {slot: 15});
  const geometry = layout.resolve(expanded);
  assertSeparated(geometry);
  assert.deepEqual(geometry.mats.get('tool:input').rectangle, input);
  assert.deepEqual(geometry.mats, before.mats);
  assert.deepEqual(geometry.bounds, before.bounds);
});

test('free-position projection clears arbitrary obstacle chains and supports fractional coordinates', () => {
  let seed = 12345;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let iteration = 0; iteration < 100; iteration++) {
    const rectangle = {x: next() * 500, y: next() * 500, width: 150, height: 170};
    const obstacles = Array.from({length: 30}, () => ({x: next() * 900 - 100, y: next() * 900 - 100, width: next() * 300 + 80, height: next() * 300 + 80}));
    const adjusted = avoidMatOverlap(rectangle, obstacles);
    for (const obstacle of obstacles) {
      assert.ok(adjusted.x + adjusted.width + 23.99999 <= obstacle.x || obstacle.x + obstacle.width + 23.99999 <= adjusted.x ||
        adjusted.y + adjusted.height + 23.99999 <= obstacle.y || obstacle.y + obstacle.height + 23.99999 <= adjusted.y);
    }
  }
});
