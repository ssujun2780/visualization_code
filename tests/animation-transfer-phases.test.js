import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRecording, Playback, displayScene, formatValue} from '../src/animation/playback.js';
import {dataFlowForEvent, transferPresentation,instructionTiming} from '../src/animation/transfers.js';
import {routeTransfer, segmentBlocked} from '../src/animation/routing.js';
import {WorldLayout, WorldCamera, containsPoint} from '../src/animation/world.js';
import {SceneCanvas, transferColors} from '../src/animation/canvas.js';
import {transferSegmentsMeet} from '../src/animation/transfer-routing.js';

const sample = JSON.parse(await readFile(new URL('../public/animation-demo.json', import.meta.url), 'utf8'));
const recording = createRecording(sample.plan, sample.trace);
const calculation = sample.trace.events.find(e => e.kind === 'CALC');
const write = sample.trace.events.find(e => e.inputs?.some(i => i.executionId === calculation.eventId));
const loaded = view => view.inputs.map(input => input.arrived ? formatValue(input.value) : null);

test('all input arrows remain visible, take turns in emphasis, then fade as one group', () => {
  const original = JSON.stringify(sample);
  const duration=instructionTiming(recording,calculation).duration;
  const first = transferPresentation(recording, calculation, 800/duration);
  const gap = transferPresentation(recording, calculation, 1750/duration);
  const second = transferPresentation(recording, calculation, 2600/duration);
  assert.equal(first.active.edge.producerId, calculation.inputs[0].executionId);
  assert.equal(gap.active.index, 0);
  assert.deepEqual(loaded(gap), ['10', null]);
  assert.equal(second.active.edge.producerId, calculation.inputs[1].executionId);
  assert.deepEqual(loaded(second), ['10', null]);
  const ready = transferPresentation(recording, calculation, 5600/duration);
  assert.equal(ready.active, null);
  assert.equal(ready.resultReady, true);
  assert.deepEqual(loaded(ready), ['10', '20']);
  for (const view of [first,gap,second,ready]) { assert.equal(view.edges.length, 2); assert.equal(view.groupOpacity, 1); }
  assert.ok(transferPresentation(recording, calculation, 0.98).groupOpacity < 1);
  assert.equal(transferPresentation(recording, calculation, 1).groupOpacity, 0);
  const preview = transferPresentation(recording, calculation, 0, {inspection:true});
  assert.equal(preview.edges.length, 2); assert.equal(preview.active, null); assert.equal(preview.groupOpacity, 1);
  assert.equal(preview.delivered, false); assert.equal(preview.resultReady, false);
  assert.deepEqual(loaded(transferPresentation(recording, write, 0.2)), ['10', '20']);
  assert.deepEqual(dataFlowForEvent(recording, write).map(e => e.from), [{kind: 'device', id: 'alu'}]);
  assert.equal(JSON.stringify(sample), original);
});

test('the same schedule handles arbitrary operators, repeated input occurrences and constants', () => {
  for (const operator of ['+', '*', '<=', '!=', '&', '<<', '&&']) {
    const event = {...calculation, eventId: `custom:${operator}`, operator,
      inputs: [...calculation.inputs, calculation.inputs[0], {value: {decimal: '7'}}]};
    const midway = transferPresentation(recording, event, 0.32);
    assert.deepEqual(loaded(midway), ['10', null, null, '7']);
    const done = transferPresentation(recording, event, 0.9);
    assert.deepEqual(loaded(done), ['10', '20', '10', '7']);
    for (let p = 0; p <= 1; p += 0.01) {
      const view = transferPresentation(recording, event, p);
      if (view.active) {
        assert.equal(view.active.edge.producerId, event.inputs[view.active.edge.inputIndex].executionId);
        assert.ok(view.active.opacity > 0 && view.active.opacity <= 1);
      }
      if (view.resultReady) assert.ok(view.inputs.every(input => input.arrived));
    }
  }
});

test('FLOW consumes an existing calculation without replaying its reads, while direct scalar guards transfer once', () => {
  const event = {eventId: 'flow', kind: 'FLOW', action: 'branch', dataInputs: [calculation.eventId], inputs: [{value: {decimal: '1'}}]};
  assert.deepEqual(dataFlowForEvent(recording, event), []);
  assert.equal(transferPresentation(recording, event, 0).resultReady, true);
  const direct = {...event, eventId: 'direct', dataInputs: [], inputs: [calculation.inputs[0]]};
  assert.equal(dataFlowForEvent(recording, direct).length, 1);
  assert.equal(transferPresentation(recording, direct, 0.2).resultReady, false);
  assert.equal(transferPresentation(recording, direct, 0.8).resultReady, true);
});

function checkRoute(path, from, to, obstacles) {
  assert.ok(path?.length >= 2);
  assert.ok(containsPoint(from, path[0]));
  assert.ok(containsPoint(to, path.at(-1)));
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i - 1].x === path[i].x || path[i - 1].y === path[i].y, 'every segment is horizontal or vertical');
    assert.equal(segmentBlocked(path[i - 1], path[i], obstacles), false, 'no segment crosses an occupied box');
  }
}

test('routing avoids intervening boxes, walls and mats in both axes and negative coordinates', () => {
  for (const transpose of [false, true]) for (const offset of [0, -600]) {
    const transform = r => transpose ? {x: r.y + offset, y: r.x, width: r.height, height: r.width} : {...r, x: r.x + offset};
    const from = transform({x: 0, y: 0, width: 100, height: 80});
    const to = transform({x: 500, y: 0, width: 160, height: 100});
    const obstacles = [{x: 140, y: -40, width: 100, height: 160}, {x: 300, y: -300, width: 80, height: 600}].map(transform);
    const before = structuredClone({from, to, obstacles});
    const path = routeTransfer(from, to, obstacles);
    checkRoute(path, from, to, obstacles);
    assert.ok(path.length > 2);
    assert.deepEqual({from, to, obstacles}, before);
    assert.deepEqual(routeTransfer(from, to, obstacles), path, 'same layout gives the same path');
  }
  assert.equal(routeTransfer({x: 0, y: 0, width: 50, height: 50}, {x: 200, y: 0, width: 50, height: 50}, [{x: -100, y: -100, width: 250, height: 250}]), null,
    'an enclosed source never falls back to crossing a box');
});

test('Canvas previews all routes, emphasizes only the active one and keeps geometry fixed while playing', () => {
  const player = new Playback(recording);
  player.seek(sample.trace.events.indexOf(calculation));
  const renderer = Object.create(SceneCanvas.prototype);
  const paths = [], labels = [];
  Object.assign(renderer, {camera: new WorldCamera(), layout: new WorldLayout(), context: new Proxy({globalAlpha: 1}, {get: (t, key) => key in t ? t[key] : () => {}})});
  renderer.box = () => {};
  renderer.label = text => labels.push(String(text));
  renderer.routedConnection = (path,color,options) => paths.push({path,color,...options,alpha:renderer.context.globalAlpha});
  const state = displayScene(recording, player.state), after = displayScene(recording, player.after);
  const snapshot = structuredClone(player.state);
  const draw = p => { paths.length = 0; labels.length = 0; player.progress = p; renderer.drawDataFlow(player, state, after); renderer.drawDevice(player, 'alu', 1); return paths.find(p=>p.index===0)?.path; };
  const preview = draw(0);
  assert.equal(paths.length,2); assert.ok(paths.every(p=>!p.emphasized&&p.color===transferColors.base));
  assert.ok(labels.includes('10, 20'));
  renderer.camera.scale=0.34;draw(0);assert.ok(labels.includes('1')&&labels.includes('2'));renderer.camera.scale=1;
  player.play(); const first = draw(0.2);
  assert.deepEqual(first,preview); assert.equal(paths.length,2);
  assert.equal(paths.filter(p=>p.emphasized).length,1);assert.equal(paths.find(p=>p.emphasized).index,0);
  assert.equal(paths.find(p=>p.emphasized).color,transferColors.active);
  const source = dataFlowForEvent(recording, calculation)[0].from.id;
  assert.ok(containsPoint(renderer.layout.resolve(after).objects.get(source),first[0]));
  assert.ok(containsPoint(renderer.layout.deviceRectangle('alu'),first.at(-1)));
  draw(0.33); assert.equal(paths.length,2); assert.ok(labels.includes('10, …'));
  draw(0.46); assert.equal(paths.length,2); assert.equal(paths.find(p=>p.emphasized).index,1); assert.ok(labels.includes('10, …'));
  assert.deepEqual(paths.find(p=>p.index===0).path,first);
  draw(0.75); assert.equal(paths.length,2); assert.ok(paths.every(p=>!p.emphasized)); assert.ok(labels.includes('10, 20'));
  const steady = paths.map(p=>p.alpha);draw(0.98);assert.ok(paths.every((p,i)=>p.alpha<steady[i]));
  draw(1);assert.equal(paths.length,0);
  const anchor = renderer.layout.positions.get('tool:workbench');
  renderer.layout.move('tool:workbench', {x: anchor.x + 250, y: anchor.y + 400});
  const moved = draw(0.2);
  assert.notDeepEqual(moved, first);
  assert.ok(containsPoint(renderer.layout.deviceRectangle('alu'),moved.at(-1)));
  for(let i=1;i<paths[0].path.length;i++)for(let j=1;j<paths[1].path.length;j++)assert.equal(transferSegmentsMeet(paths[0].path[i-1],paths[0].path[i],paths[1].path[j-1],paths[1].path[j]),false);
  assert.deepEqual(player.state, snapshot);
  player.seek(0); player.seek(sample.trace.events.indexOf(calculation));
  assert.deepEqual(transferPresentation(recording, player.event, 0.75), transferPresentation(recording, calculation, 0.75));
});

test('row inspection and paused playback retain distinct presentation states without committing values',()=>{
  const player=new Playback(recording);player.seek(sample.trace.events.indexOf(calculation));
  assert.equal(player.presentationMode,'inspect');
  player.play();player.advance(player.duration*0.2);player.playing=false;
  const p=player.progress, state=structuredClone(player.state);
  player.advance(9999);assert.equal(player.progress,p);assert.deepEqual(player.state,state);
  assert.equal(player.presentationMode,'playback');
  assert.equal(transferPresentation(recording,player.event,p).active.index,0);
  player.seek(player.cursor);assert.equal(player.presentationMode,'inspect');assert.equal(player.progress,0);
});
