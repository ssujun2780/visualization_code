// Explicit manual graph annotation for a renderer fixture, NOT inference.
// Source prediction is fixed before execution; production renderer is shared.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {traceModel} from '../model/index.mjs';
import {createRecording,Playback,displayScene} from '../../src/animation/playback.js';
import {layoutStructure} from '../../src/animation/structure-layout.js';
const source=await readFile('examples/c/animation/weighted-graph.c','utf8'),r=process.argv.includes('--reuse')?JSON.parse(await readFile('test-results/structure-shapes/weighted-graph.json','utf8')):await traceModel(source,{filename:'weighted-graph.c'});
assert.equal(r.trace.status,'completed');
const recording=createRecording(r.plan,r.trace),player=new Playback(recording);player.seek(r.trace.events.length);assert.equal(player.state.output,'0 10 20 15 30 25 ');player.seek(r.trace.events.findLastIndex(e=>e.action==='output')+1);
const scene=displayScene(recording,player.state),distance=[...scene.objects.values()].find(o=>o.name==='distance'),storage=[...scene.objects.values()].find(o=>o.name==='edges'),
  cells=storage.renderCells,records=new Map();
// The fixture declares these fields explicitly. Mapping is an external user
// annotation; no field-name classification is used by production code.
for(const c of cells){const match=/\[(\d+)\]\.(from|to|weight)$/.exec(c.path);if(match){const row=records.get(match[1])??{};row[match[2]]=c;records.set(match[1],row);}}
assert.equal(records.size,9);
const nodes=distance.renderCells.map((c,i)=>({id:`vertex:${i}`,index:i,label:String.fromCharCode(65+i),ranges:[{objectId:distance.id,offset:c.offset,size:c.size}]})),
  edges=[...records].map(([id,row])=>({id:`edge:${id}`,from:`vertex:${row.from.value.decimal}`,to:`vertex:${row.to.value.decimal}`,weightRange:{objectId:storage.id,offset:row.weight.offset,size:row.weight.size},directed:true,storedEdgeIds:[]})),
  at=r.trace.events.findIndex(e=>e.action==='object.begin'&&e.objectId===distance.id),positions=[...layoutStructure({view:'graph',nodes,edges}).positions],
  p={target:{objectId:distance.id},view:'graph',label:'방향·가중 그래프 · 수동 역할 지정',directed:true,descriptor:{objectId:distance.id,capacity:6,elementBytes:distance.renderCells[0].size},relation:{id:'manual-graph',nodes,edges,rootNodeIds:[],complete:true},diagramOwnerObjectId:distance.id};
const preparedScene={schemaVersion:1,programId:r.plan.programId,runId:r.trace.runId,eventCount:r.trace.events.length,placements:[],tracks:[{objectId:distance.id,variants:{auto:{view:'graph',label:p.label,layoutNodes:nodes,positions,entries:[{index:at,presentation:p}]}}}]};
await writeFile('test-results/structure-shapes/weighted-graph.json',JSON.stringify({plan:r.plan,trace:r.trace,preparedScene}));
console.log(JSON.stringify({events:r.trace.events.length,nodes:nodes.length,edges:edges.length,annotation:'explicit manual roles; inference not evaluated'}));
