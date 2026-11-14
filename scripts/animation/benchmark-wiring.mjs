import {AvoidLib} from 'libavoid-js';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {PointerWiring, wiringQuality} from '../../src/animation/pointer-wiring.js';

export function fixture(count, mode = 'mesh', regions = 1) {
  const perRegion = Math.ceil(count / regions), columns = Math.ceil(Math.sqrt(perRegion));
  const width = columns * 230 + 100, height = Math.ceil(perRegion / columns) * 145 + 190;
  const fields = Array.from({length: regions}, (_, i) => ({id: `r${i}`, x: i * (width + 200), y: 0, width, height}));
  const nodes = Array.from({length: count}, (_, i) => {
    const r = Math.floor(i / perRegion), slot = i % perRegion;
    return {id: `n${i}`, objectId: `o${i}`, offset: 0, region: `r${r}`, x: fields[r].x + 60 + slot % columns * 230,
      y: 100 + Math.floor(slot / columns) * 145, width: 140, height: 70};
  });
  const edges = nodes.map((node, i) => ({id: `e${i}`, source: node.id, target: `n${mode === 'fan' ? count - 1 : (i * 17 + 7) % count}`,
    sourceObjectId: node.objectId, targetObjectId: `o${mode === 'fan' ? count - 1 : (i * 17 + 7) % count}`}));
  for (const field of fields) {
    const count = edges.filter(e => nodes.find(n => n.id === e.source).region !== nodes.find(n => n.id === e.target).region &&
      [nodes.find(n => n.id === e.source).region, nodes.find(n => n.id === e.target).region].includes(field.id)).length;
    field.height = Math.max(field.height, count * 5 + 185);
  }
  return {nodes, regions: fields, edges, inactive: []};
}

export async function runBenchmark() {
  await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
  const rows = [];
  for (const [count, mode, regions] of [[24, 'mesh', 1], [100, 'mesh', 1], [300, 'mesh', 3], [1000, 'mesh', 4], [160, 'fan', 1]]) {
    const engine = new PointerWiring(AvoidLib.getInstance(), {measureQuality: false}), graph = fixture(count, mode, regions);
    const measure = (phase, next) => {
      const start = performance.now(), result = engine.update(next), ms = performance.now() - start;
      const auditStart = performance.now(), quality = wiringQuality(next, result.paths), auditMilliseconds = performance.now() - auditStart;
      const row = {count, mode, regions, phase, milliseconds: +ms.toFixed(3), ...result.stats, auditMilliseconds, quality, missing: result.missing.length};
      row.milliseconds = +ms.toFixed(3); delete row.quality.crowdedObjects;
      rows.push(row); console.log(JSON.stringify(row)); return result;
    };
    const initial = measure('initial', graph), old = new Map(initial.paths.map(p => [p.id, JSON.stringify(p.points)]));
    for (let i = 0; i < 5; i++) measure('unchanged', graph);
    const changed = structuredClone(graph);
    for (let i = 0; i < Math.max(1, Math.floor(count / 100)); i++) changed.edges[i].target = `n${(i + 3) % count}`;
    const delta = measure('repoint-1pct', changed);
    rows.at(-1).unchangedPathFraction = delta.paths.filter(p => old.get(p.id) === JSON.stringify(p.points)).length / count;
    const moved = structuredClone(changed); moved.nodes[Math.floor(count / 2)].x += 20;
    measure('move-one-box', moved);
    const removed = structuredClone(moved); removed.edges = removed.edges.filter(e => e.source !== 'n0' && e.target !== 'n0'); removed.nodes.shift();
    measure('delete-one-box', removed); engine.dispose();
  }
  const directory = resolve('test-results/pointer-wiring'); await mkdir(directory, {recursive: true});
  await writeFile(resolve(directory, 'benchmark.json'), JSON.stringify({runtime: process.version, platform: process.platform, generatedAt: new Date().toISOString(), rows}, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBenchmark().catch(error => { console.error(error.message); process.exitCode = 1; });
}
