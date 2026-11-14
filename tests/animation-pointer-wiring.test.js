import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {AvoidLib} from 'libavoid-js';
import {PointerWiring} from '../src/animation/pointer-wiring.js';
import {fixture} from '../scripts/animation/benchmark-wiring.mjs';
import {segmentBlocked} from '../src/animation/routing.js';
import {WorldLayout} from '../src/animation/world.js';

await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
function validate(graph, result) {
  assert.deepEqual(result.missing, []);
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  for (const route of result.paths) {
    const from = nodes.get(route.source), to = nodes.get(route.target);
    assert.ok(route.points.length >= 2);
    for (const [point, node] of [[route.points[0], from], [route.points.at(-1), to]]) {
      assert.ok(point.x >= node.x - 0.001 && point.x <= node.x + node.width + 0.001);
      assert.ok(point.y >= node.y - 0.001 && point.y <= node.y + node.height + 0.001);
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      assert.ok(a.x === b.x || a.y === b.y, 'orthogonal path');
      // Independent brute-force check, including every foreign field.
      assert.equal(segmentBlocked(a, b, graph.nodes.filter(n => n.id !== route.source && n.id !== route.target)), false);
      const sourceRegion = from.region, targetRegion = to.region;
      assert.equal(segmentBlocked(a, b, graph.regions.filter(r => r.id !== sourceRegion && r.id !== targetRegion)), false);
    }
  }
}
test('incremental wiring retains untouched routes, skips equal graphs and handles movement/deletion', () => {
  const engine = new PointerWiring(AvoidLib.getInstance()), graph = fixture(24);
  try {
    const first = engine.update(graph); validate(graph, first);
    const stable = new Map(first.paths.map(p => [p.id, JSON.stringify(p.points)]));
    const same = engine.update(structuredClone(graph)); assert.equal(same.stats.transactions, 0);
    const changed = structuredClone(graph); changed.edges[0].target = 'n3';
    const second = engine.update(changed); validate(changed, second);
    assert.equal(second.paths.filter(p => stable.get(p.id) === JSON.stringify(p.points)).length, 23);
    const moved = structuredClone(changed); moved.nodes[12].x += 20; validate(moved, engine.update(moved));
    moved.edges = moved.edges.filter(e => e.source !== 'n0' && e.target !== 'n0'); moved.nodes.shift(); validate(moved, engine.update(moved));
    assert.deepEqual(graph.nodes, fixture(24).nodes, 'routing must not mutate layout');
  } finally { engine.dispose(); }
});
test('shared corridors, self-pointers and cross-field portals avoid foreign boxes and fields', () => {
  for (const graph of [fixture(40, 'fan'), fixture(48, 'mesh', 3)]) {
    const engine = new PointerWiring(AvoidLib.getInstance());
    try { const result = engine.update(graph); validate(graph, result); assert.equal(result.quality.nodeCrossings, 0); }
    finally { engine.dispose(); }
  }
});
test('local corridor opening is bounded and honors manually pinned objects', () => {
  const layout = new WorldLayout(), state = {objects: new Map([['a', {alive: true}], ['b', {alive: true}]])};
  layout.positions.set('object:a', {x: 10, y: 10}); layout.positions.set('object:b', {x: 20, y: 20});
  layout.pinned.add('object:a'); assert.equal(layout.openCorridor(state, ['a', 'b']), 1);
  assert.deepEqual(layout.positions.get('object:a'), {x: 10, y: 10});
  assert.deepEqual(layout.positions.get('object:b'), {x: 38, y: 38});
});
test('changing field dimensions and portal sides preserves valid terminal identities', () => {
  const graph = fixture(72, 'mesh', 3), engine = new PointerWiring(AvoidLib.getInstance());
  try {
    validate(graph, engine.update(graph));
    for (const step of [1, -1, 2]) {
      const changed = structuredClone(graph);
      const region = changed.regions[1], dx = step * 40, dy = step * 30;
      region.x += dx; region.y += dy; region.height += 250;
      for (const node of changed.nodes) if (node.region === region.id) { node.x += dx; node.y += dy; }
      validate(changed, engine.update(changed));
    }
    validate(graph, engine.update(graph));
  } finally { engine.dispose(); }
});

test('saved reservations route only moved or newly obstructed connections and keep unrelated paths exact',()=>{
  const graph=fixture(48,'mesh',3),base=new PointerWiring(AvoidLib.getInstance());
  try{
    const original=base.update(graph),seed=base.snapshot(),seedJSON=JSON.stringify([...seed]);validate(graph,original);
    const moved=structuredClone(graph);moved.nodes[2].x+=20;
    const patch=new PointerWiring(AvoidLib.getInstance());
    let result;try{result=patch.revise(graph,moved,seed,original.paths);}finally{patch.dispose();}
    validate(moved,result);assert.ok(result.stats.requested>0);assert.ok(result.stats.requested<graph.edges.length,'unrelated routes are not submitted for search');
    const untouched=graph.edges.filter(e=>!['n2'].includes(e.source)&&!['n2'].includes(e.target)&&
      graph.nodes.find(n=>n.id===e.source).region===graph.nodes.find(n=>n.id===e.target).region&&graph.nodes.find(n=>n.id===e.source).region!==graph.nodes[2].region);
    assert.ok(untouched.length>0);
    for(const edge of untouched)assert.deepEqual(result.paths.find(p=>p.id===edge.id),original.paths.find(p=>p.id===edge.id));
    const again=new PointerWiring(AvoidLib.getInstance());
    try{assert.deepEqual(again.revise(graph,moved,seed,original.paths).paths,result.paths);}finally{again.dispose();}
    assert.equal(JSON.stringify([...seed]),seedJSON,'saved reservations are immutable');
    // A box without incident edges still invalidates a route it moves across.
    const route=original.paths.find(p=>p.points.some((b,i)=>i&&Math.abs(b.x-p.points[i-1].x)>80));assert.ok(route);
    const index=route.points.findIndex((b,i)=>i&&Math.abs(b.x-route.points[i-1].x)>80),a=route.points[index-1],b=route.points[index],blocked=structuredClone(graph);
    const region=graph.nodes.find(n=>n.id===route.source).region;
    blocked.nodes.push({id:'new-blocker',region,x:(a.x+b.x)/2-8,y:a.y-8,width:16,height:16});
    const repair=new PointerWiring(AvoidLib.getInstance());
    try{const repaired=repair.revise(graph,blocked,seed,original.paths);validate(blocked,repaired);assert.notDeepEqual(repaired.paths.find(p=>p.id===route.id).points,route.points);}finally{repair.dispose();}
  }finally{base.dispose();}
});
