import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording, emptyScene, applyEvent, displayScene} from '../src/animation/playback.js';
import {referenceEdges} from '../src/animation/memory.js';
import {WorldLayout} from '../src/animation/world.js';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {dataFlowForEvent} from '../src/animation/transfers.js';

test('observed subobject pointers survive struct/memory copies and byte overwrites invalidate provenance', async () => {
  const result = await traceModel(`#include <string.h>
    struct B { int *p; int *r[2]; };
    int main(void) { int a[8]={0}; int *p[2]={a,a+1};
      struct B b={a+1,{a+2,a+3}}; struct B c=b;
      memmove(&p[1],&b.p,sizeof b.p); memset(&b.p,0,sizeof b.p);
      *p[0]=9; return c.r[1] ? 0:1; }`);
  assert.equal(result.trace.status, 'completed');
  const recording = createRecording(result.plan, result.trace);
  let state = emptyScene();
  for (const event of result.trace.events) {
    if (event.action === 'return.value') break;
    const ancestor = state, previous = structuredClone(state); state = applyEvent(recording, state, event);
    // Every replay step is immutable; presentation must not alter it either.
    const next = structuredClone(state); displayScene(recording, state); assert.deepEqual(state, next);
    assert.notEqual(state, ancestor); assert.deepEqual(ancestor, previous);
  }
  const objects = [...state.objects.values()], object = name => objects.find(o => o.name === name);
  const edges = referenceEdges(state), copied = edges.filter(e => e.sourceObjectId === object('c').id);
  assert.deepEqual(copied.map(e => e.targetOffset).sort((a,b)=>a-b), [4,8,12]);
  assert.equal(edges.some(e => e.sourceObjectId === object('b').id && e.sourceOffset === 0), false);
  assert.equal(edges.find(e => e.sourceObjectId === object('p').id && e.sourceOffset === 4).targetOffset, 4);
  const visible = displayScene(recording, state), graph = pointerGraph(visible, new WorldLayout().resolve(visible));
  assert.equal(graph.edges.length, 7); assert.ok(graph.nodes.length >= 16);
  assert.equal(visible.objects.get(object('a').id).renderCells[0].value.decimal, '9');
});
test('deallocation keeps a dangling badge without routing to dead storage or leaking final references', async () => {
  const result = await traceModel('#include <stdlib.h>\nint main(){int *a=calloc(4,sizeof *a);if(!a)return 1;int *b=a+2;free(a);b=0;return 0;}');
  assert.equal(result.trace.status, 'completed');
  const recording = createRecording(result.plan, result.trace); let state = emptyScene(), checked = false;
  for (const event of result.trace.events) {
    state = applyEvent(recording, state, event);
    if (event.action !== 'object.end') continue;
    const visible = displayScene(recording, state), graph = pointerGraph(visible, new WorldLayout().resolve(visible));
    assert.equal(graph.edges.length, 0); assert.equal(graph.inactive.filter(e => e.status === 'dangling').length, 2); checked = true;
  }
  assert.ok(checked);
});
test('static pointer initializers use only observed addresses even if overwritten later', async () => {
  const result = await traceModel('int a=7;int b=9;int *p=&a;int *q[2]={&b,0};int main(){p=&b;return 0;}');
  assert.equal(result.trace.status, 'completed');
  const recording = createRecording(result.plan, result.trace); let state = emptyScene(), initial, after;
  for (const event of result.trace.events) {
    if (event.action === 'frame.begin') initial = state;
    state = applyEvent(recording, state, event);
    if (event.kind === 'WRITE' && event.target?.objectId) after = state;
  }
  const id = name => [...initial.objects.values()].find(o => o.name === name).id;
  assert.equal(referenceEdges(initial).find(e => e.sourceObjectId === id('p')).targetObjectId, id('a'));
  assert.equal(referenceEdges(after).find(e => e.sourceObjectId === id('p')).targetObjectId, id('b'));
  assert.equal(initial.objects.get(id('a')).value.decimal, '7');
  assert.equal(referenceEdges(initial).find(e => e.sourceObjectId === id('q')).targetObjectId, id('b'));
});
test('value arrows distinguish two cells of the same array', async () => {
  const result = await traceModel('int main(){int a[2]={1,2};a[1]=a[0];return 0;}');
  const recording = createRecording(result.plan, result.trace);
  const write = result.trace.events.find(e => e.kind === 'WRITE' && e.target?.offset === 4);
  const edges = dataFlowForEvent(recording, write);
  assert.equal(edges.length, 1); assert.equal(edges[0].from.id, edges[0].to.id);
  assert.equal(edges[0].from.offset ?? 0, 0); assert.equal(edges[0].to.offset, 4);
});
