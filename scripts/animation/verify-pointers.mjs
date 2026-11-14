import {AvoidLib} from 'libavoid-js';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {traceModel} from '../model/index.mjs';
import {createRecording, emptyScene, applyEvent, displayScene} from '../../src/animation/playback.js';
import {referenceEdges} from '../../src/animation/memory.js';
import {WorldLayout} from '../../src/animation/world.js';
import {pointerGraph} from '../../src/animation/pointer-graph.js';
import {PointerWiring} from '../../src/animation/pointer-wiring.js';
import {examples} from './examples.mjs';

await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
const directory = resolve('test-results/pointer-wiring'); await mkdir(directory, {recursive: true});
const rows = [];
for (const id of ['pointers', 'pointer-arrays', 'pointer-network']) {
  try {
    const example = examples[id], source = await readFile(example.file, 'utf8');
    const result = await traceModel(source, {filename: example.file, maxEvents: 10000, timeoutMs: 25000});
    await writeFile(resolve(directory, `${id}.json`), JSON.stringify(result));
    if (result.trace.status !== 'completed' || result.trace.exitCode !== 0) throw new Error(JSON.stringify(result.trace.diagnostics));
    const recording = createRecording(result.plan, result.trace), layout = new WorldLayout(), wiring = new PointerWiring(AvoidLib.getInstance());
    let state = emptyScene(), peak = 0, last = 0;
    const checkpoints = [];
    for (const event of result.trace.events) {
      const previous = state; state = applyEvent(recording, state, event);
      const count = referenceEdges(state).length;
      if (count > peak) { peak = count; if (count >= last + 40 || count < 20) { checkpoints.push({event: event.eventId, state}); last = count; } }
      if (event.action === 'object.end' && recording.objects.get(event.objectId)?.storage === 'heap') {
        checkpoints.push({event: `before-${event.eventId}`, state: previous}, {event: event.eventId, state});
      }
    }
    if (!checkpoints.some(c => referenceEdges(c.state).length === peak)) {
      state = emptyScene();
      for (const event of result.trace.events) { state = applyEvent(recording, state, event); if (referenceEdges(state).length === peak) { checkpoints.push({event: event.eventId, state}); break; } }
    }
    for (const checkpoint of checkpoints) {
      const visible = displayScene(recording, checkpoint.state), geometry = layout.resolve(visible), graph = pointerGraph(visible, geometry);
      const routed = wiring.update(graph);
      if (routed.missing.length) await writeFile(resolve(directory, `${id}-unrouted.json`), JSON.stringify({graph, routed,
        native: [...wiring.routers].flatMap(([region, router]) => [...router.edges].filter(([, edge]) => edge.native).map(([id, edge]) => {
          const line = edge.native.displayRoute(); return {region, id, source: edge.source, target: edge.target,
            points: Array.from({length: line.size()}, (_, i) => { const p = line.at(i); return {x: p.x, y: p.y}; })};
        }))}));
      const row = {example: id, event: checkpoint.event, traceStatus: result.trace.status, traceEvents: result.trace.events.length,
        output: result.trace.events.filter(e => e.action === 'output').map(e => e.text ?? '').join(''),
        peakReferences: peak, ...routed.stats, missing: routed.missing.length, inactive: graph.inactive.length, quality: routed.quality};
      rows.push(row); console.log(JSON.stringify(row));
    }
    wiring.dispose();
  } catch (error) { console.error(id, error.message); process.exitCode = 1; }
}
await writeFile(resolve(directory, 'real-c-results.json'), JSON.stringify(rows, null, 2));
