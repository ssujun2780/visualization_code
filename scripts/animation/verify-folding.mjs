import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {AvoidLib} from 'libavoid-js';
import {createRecording, applyEvent, emptyScene, displayScene} from '../../src/animation/playback.js';
import {referenceEdges} from '../../src/animation/memory.js';
import {containerId} from '../../src/animation/object-view.js';
import {WorldLayout} from '../../src/animation/world.js';
import {pointerGraph} from '../../src/animation/pointer-graph.js';
import {PointerWiring} from '../../src/animation/pointer-wiring.js';

// Reuse an actual recorded execution; this audits presentation, not inference.
const file = process.argv[2] ?? 'test-results/pointer-wiring/pointer-network.json';
const data = JSON.parse(await readFile(file, 'utf8')), recording = createRecording(data.plan, data.trace);
let state = emptyScene(), peak = {count: -1};
for (const event of data.trace.events) {
  state = applyEvent(recording, state, event);
  const count = referenceEdges(state).length;
  if (count > peak.count) peak = {count, state, event: event.eventId};
}
const scene = displayScene(recording, peak.state), snapshot = structuredClone(peak.state);
await AvoidLib.load(resolve('node_modules/libavoid-js/dist/libavoid.wasm'));
const layout = new WorldLayout(), engine = new PointerWiring(AvoidLib.getInstance()), rows = [];
try {
  for (const phase of ['expanded', 'folded', 'expanded-again']) {
    if (phase !== 'expanded') for (const object of scene.objects.values()) if (object.alive && object.renderCells?.length) layout.toggleContainer(containerId(object.id));
    const graph = pointerGraph(scene, layout.resolve(scene)), result = engine.update(graph);
    const row = {phase, peakEvent: peak.event, references: peak.count, visibleEdges: graph.edges.length, hiddenEdges: graph.hiddenEdges.length,
      nodes: graph.nodes.length, missing: result.missing.length, milliseconds: result.stats.milliseconds, quality: result.quality};
    rows.push(row); console.log(JSON.stringify(row));
    assert.equal(result.missing.length, 0); assert.equal(result.quality.nodeCrossings, 0);
    assert.equal(graph.edges.length + graph.hiddenEdges.length + graph.inactive.length, peak.count);
    assert.deepEqual(peak.state, snapshot);
  }
} finally { engine.dispose(); }
await mkdir('test-results/pointer-wiring', {recursive: true});
await writeFile('test-results/pointer-wiring/folding.json', JSON.stringify({file, rows}, null, 2));
