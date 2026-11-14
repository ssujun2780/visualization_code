import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording, emptyScene, applyEvent, displayScene} from '../src/animation/playback.js';
import {WorldLayout, rectangleCenter} from '../src/animation/world.js';
import {containerId, connectionFocus, visibleMemoryCells} from '../src/animation/object-view.js';
import {cellId} from '../src/animation/memory.js';
import {pointerGraph} from '../src/animation/pointer-graph.js';
import {pointerAppearance} from '../src/animation/pointer-appearance.js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {AvoidLib} from 'libavoid-js';
import {resolve} from 'node:path';

const result = await traceModel(`struct Inner { int value; int *ptr; };
struct Outer { struct Inner items[2]; int *refs[2]; };
int main(void) {
  int a[3]={11,22,33}; int grid[2][3]={{0}};
  struct Outer outer={{{1,&a[0]},{2,&a[1]}},{&a[1],&a[2]}};
  struct Inner *item=&outer.items[0]; struct Outer *whole=&outer;
  int (*array)[3]=&a; int *first=a; int (*row)[3]=grid;
  return 0;
}`);
assert.equal(result.trace.status, 'completed');
const recording = createRecording(result.plan, result.trace); let state = emptyScene();
for (const event of result.trace.events) { if (event.action === 'return.value') break; state = applyEvent(recording, state, event); }
const visible = displayScene(recording, state), named = name => [...visible.objects.values()].find(o => o.name === name);
const outer = named('outer'), a = named('a'), grid = named('grid');

test('compiler-declared pointer array lanes remain distinct from pointer fields after folding',()=>{
  const layout=new WorldLayout(),idle={active:false,edges:new Set()},ink=geometry=>{
    const get=path=>[...geometry.cells.values()].find(c=>c.objectId===outer.id&&c.path===path);
    return ['.items[0].ptr','.refs[0]','.refs[1]'].map(path=>pointerAppearance(path,idle,{scale:.12,source:get(path)}));
  },before=ink(layout.resolve(visible));
  assert.equal(before[0].opacity,.4);assert.equal(before[0].haloWidth,undefined);
  assert.equal(before[1].opacity,.86);assert.ok(before[1].haloWidth>before[1].width);
  for(const p of before.slice(1))assert.notEqual(p.color,before[0].color,'array lanes keep their palette rather than ordinary muted ink');
  layout.toggleContainer(containerId(outer.id));assert.deepEqual(ink(layout.resolve(visible)),before);
});

test('nested arrays and records have distinct selectable containers and leaves', () => {
  const layout = new WorldLayout(), geometry = layout.resolve(visible), snapshot = structuredClone(state);
  const member = [...geometry.cells.values()].find(c => c.objectId === outer.id && c.path === '.items[0].ptr');
  assert.ok(member);
  assert.equal(layout.hitTest(visible, rectangleCenter(member)).logicalId, member.id);
  assert.equal(layout.hitTest(visible, rectangleCenter(member)).dragKey,`object:${outer.id}`);
  const group = geometry.containers.get(containerId(outer.id, '.items[0]'));
  assert.equal(layout.hitTest(visible, rectangleCenter(group.toggle)).kind, 'toggle');
  const header = {x: group.x + 60, y: group.y + 15};
  assert.equal(layout.hitTest(visible, header).logicalId, group.id);
  assert.deepEqual(state, snapshot);
});
test('dragging an inner value moves its original storage without changing selection or memory',()=>{
  const layout=new WorldLayout(),before=layout.resolve(visible),snapshot=structuredClone(state),member=[...before.cells.values()].find(c=>c.objectId===a.id&&c.path==='[1]'),hit=layout.hitTest(visible,rectangleCenter(member));
  assert.equal(hit.logicalId,member.id);assert.equal(hit.dragKey,`object:${a.id}`);
  const start=layout.positions.get(hit.dragKey);layout.move(hit.dragKey,{x:start.x+700,y:start.y+400});layout.finishMove();
  const after=layout.resolve(visible);assert.ok(after.cells.get(member.id).x!==member.x);assert.deepEqual(state,snapshot);assert.ok(layout.pinned.has(hit.dragKey));
});
test('pointers to aggregate objects select that container, not its first scalar field', () => {
  const layout = new WorldLayout(), graph = pointerGraph(visible, layout.resolve(visible));
  const edge = name => graph.edges.find(e => e.sourceObjectId === named(name).id);
  assert.equal(edge('whole').targetLogicalId, containerId(outer.id));
  assert.equal(edge('item').targetLogicalId, containerId(outer.id, '.items[0]'));
  assert.equal(edge('array').targetLogicalId, containerId(a.id));
  assert.equal(edge('first').targetLogicalId, cellId(a.id));
  assert.equal(edge('row').targetLogicalId, containerId(grid.id, '[0]'));
});
test('container focus does not include contained pointers or references to a contained object', () => {
  const layout = new WorldLayout(), graph = pointerGraph(visible, layout.resolve(visible));
  const root = connectionFocus({kind: 'aggregate', logicalId: containerId(outer.id)}, graph.edges);
  assert.equal(root.edges.size, 1);
  assert.equal(graph.edges.find(e => root.edges.has(e.id)).sourceObjectId, named('whole').id);
  const leaf = graph.edges.find(e => e.sourceObjectId === outer.id);
  const one = connectionFocus({kind: 'wire', id: leaf.id}, graph.edges);
  assert.deepEqual(new Set(one.edges),new Set([leaf.id,cellId(named('first').id)]));assert.equal(one.logicalIds.size,3);
});
test('folding preserves logical endpoints, member values, unrelated coordinates and nested fold settings', () => {
  const layout = new WorldLayout(), expanded = layout.resolve(visible), before = pointerGraph(visible, expanded);
  const position = {...layout.positions.get(`object:${outer.id}`)}, snapshot = structuredClone(state);
  layout.toggleContainer(containerId(outer.id));
  const folded = layout.resolve(visible), graph = pointerGraph(visible, folded);
  assert.deepEqual(graph.edges.map(e => [e.id,e.sourceLogicalId,e.targetLogicalId]), before.edges.map(e => [e.id,e.sourceLogicalId,e.targetLogicalId]));
  assert.ok([...folded.cells.values()].filter(c => c.objectId === outer.id).every(c => c.hidden));
  assert.deepEqual(layout.positions.get(`object:${outer.id}`), position);
  assert.deepEqual(folded.objects.get(a.id), expanded.objects.get(a.id));
  assert.equal(connectionFocus({kind: 'aggregate', logicalId: containerId(outer.id)}, graph.edges).edges.size, 1);
  assert.ok(graph.edges.filter(e => e.sourceObjectId === outer.id).every(e => e.source === containerId(outer.id)));
  layout.toggleContainer(containerId(outer.id)); layout.toggleContainer(containerId(outer.id, '.items'));
  const nested = layout.resolve(visible);
  assert.ok(nested.cells.get(cellId(outer.id, 4)).hidden); // items[0].ptr
  assert.equal(nested.cells.get(cellId(outer.id, 16)).hidden, false); // refs[0]
  layout.toggleContainer(containerId(outer.id)); layout.toggleContainer(containerId(outer.id));
  assert.ok(layout.resolve(visible).containers.get(containerId(outer.id, '.items')).collapsed);
  assert.deepEqual(state, snapshot);
});
test('folded proxies remain routable and focus includes real aliases without unrelated proxy siblings', async () => {
  await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
  const layout = new WorldLayout(), engine = new PointerWiring(AvoidLib.getInstance());
  try {
    for (const id of [null, containerId(outer.id), containerId(a.id)]) {
      if (id) layout.toggleContainer(id);
      const graph = pointerGraph(visible, layout.resolve(visible)), routes = engine.update(graph);
      assert.deepEqual(routes.missing, []); assert.equal(routes.quality.nodeCrossings, 0);
      const edge = graph.edges.find(e => e.sourceObjectId === outer.id);
      assert.deepEqual(connectionFocus({kind:'wire',id:edge.id},graph.edges).edges,new Set([edge.id,cellId(named('first').id)]));
    }
  } finally { engine.dispose(); }
});
test('reserving post-write geometry never reveals the post-write value early', () => {
  let previous = emptyScene();
  for (const event of result.trace.events) {
    const after = applyEvent(recording, previous, event);
    if (event.kind === 'WRITE' && event.target?.objectId === outer.id && event.value?.reference) {
      const before = displayScene(recording, previous), next = displayScene(recording, after), layout = new WorldLayout();
      const id = cellId(outer.id, event.target.offset);
      const oldCell = before.objects.get(outer.id).renderCells.find(c => c.id === id);
      const newCell = next.objects.get(outer.id).renderCells.find(c => c.id === id);
      assert.notDeepEqual(oldCell.value, newCell.value);
      const drawn = visibleMemoryCells(before.objects.get(outer.id), layout.resolve(next)).find(c => c.id === id);
      assert.deepEqual(drawn.value, oldCell.value); return;
    }
    previous = after;
  }
  assert.fail('expected an observed pointer member write');
});
test('folding a container hides only edges wholly between hidden descendants', () => {
  const copy = structuredClone(visible), first = copy.objects.get(outer.id).cells.get(4);
  // A pointer member referencing another scalar member in the same structure.
  first.value = {...first.value, reference: {targetObjectId: outer.id, targetOffset: 8, status: 'in-bounds'}};
  const layout = new WorldLayout(); layout.toggleContainer(containerId(outer.id));
  const graph = pointerGraph(copy, layout.resolve(copy));
  assert.ok(graph.hiddenEdges.some(e => e.id === cellId(outer.id, 4)));
  assert.ok(graph.edges.some(e => e.sourceObjectId === named('whole').id));
});
test('record padding does not replace members or prevent nested folding', async () => {
  const result = await traceModel('struct P{char tag;int *ptr;};int v=7;struct P p[2]={{65,&v},{66,&v}};int main(){return 0;}');
  assert.equal(result.trace.status, 'completed');
  const record = createRecording(result.plan, result.trace); let state = emptyScene();
  for (const event of result.trace.events) { if (event.action === 'frame.begin') break; state = applyEvent(record, state, event); }
  const scene = displayScene(record, state), p = [...scene.objects.values()].find(o => o.name === 'p');
  assert.deepEqual(p.renderCells.map(c => c.path), ['[0].tag','[0].ptr','[1].tag','[1].ptr']);
  const layout = new WorldLayout(); layout.toggleContainer(containerId(p.id, '[0]'));
  const geometry = layout.resolve(scene);
  assert.ok(geometry.cells.get(cellId(p.id, 0)).hidden);
  assert.equal(geometry.cells.get(cellId(p.id, 8)).hidden, false);
});
