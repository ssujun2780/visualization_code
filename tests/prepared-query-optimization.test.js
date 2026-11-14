import {test} from 'node:test';
import assert from 'node:assert/strict';
import {samePreparedValue} from '../src/animation/prepared-equality.js';
import {createStorageReferenceView,storageReferenceView} from '../src/animation/structure-storage-view.js';
import {queryStorageReferences} from '../scripts/inference/storage-relations.mjs';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {historyDiagnostics} from '../scripts/inference/inference-limits.mjs';
import {stateHistoryCoverage,appendStateSnapshot,structureStateAt} from '../scripts/inference/state-history.mjs';

test('preparation equality preserves JSON decisions including absent keys, order, sparse arrays and signed zero',()=>{
 const values=[null,undefined,0,-0,NaN,Infinity,false,'x',[],[undefined],[null],new Array(1),{}, {x:undefined},
   {x:0},{x:null},{x:NaN},{x:1,y:2},{y:2,x:1},{n:[{x:1}],a:null}];
 for(const a of values)for(const b of values){
   // Top-level undefined is not a presentation object; wrap values to exercise
   // the exact array/object JSON rules used by preparation signatures.
   assert.equal(samePreparedValue([a],[b]),JSON.stringify([a])===JSON.stringify([b]));
   assert.equal(samePreparedValue({a},{a:b}),JSON.stringify({a})===JSON.stringify({a:b}));
 }
});

test('scoped storage queries equal full queries through joins, cycles, unlinking, roles and backwards seeks',async()=>{
 const r=await traceWithStructureView('typedef struct N {int value;struct N *next,*other;} N;\n'+
  'int main(void){N a[3]={{1,0,0},{2,0,0},{3,0,0}},b[2]={{4,0,0},{5,0,0}};\n'+
  'a[0].next=a+1;a[1].next=b;b[0].next=b+1;b[1].next=a+2;\n'+
  'a[1].other=a;b[0].other=b+1;a[1].next=0;{N c={6,a,0};a[2].next=&c;a[2].next=0;}return a[0].value;}');
 const graph=r.trace.structures.find(s=>s.kind==='storage-reference-graph'),query=createStorageReferenceView(),
  objects=r.trace.objects.filter(o=>['array','record'].includes(o.cType?.kind)),
  targets=[...objects.map(o=>({objectId:o.id})),{structureId:graph.id},{objectIds:objects.map(o=>o.id)},
    ...objects.map(o=>({ranges:[{objectId:o.id,offset:0,size:Math.min(4,o.size)}]}))],
  times=[...graph.changes.map(c=>c.afterExecutionId),r.trace.events.at(-1).eventId],
  roles=[null,[],...[...new Set(graph.changes.flatMap(c=>c.upsertEdges.map(e=>e.roleId)))].map(id=>[id])];
 const before=JSON.stringify({graph,trace:r.trace});
 for(const at of [...times,...times.toReversed()])for(const target of targets)for(const roleIds of roles){
  assert.deepEqual(query(graph,r.trace,target,at,roleIds),storageReferenceView(graph,r.trace,target,at,roleIds));
 }
 assert.equal(JSON.stringify({graph,trace:r.trace}),before);
 const at=times[Math.floor(times.length/2)],full=queryStorageReferences(graph,r.trace,{afterExecutionId:at,expected:'tree'}),
   lean=queryStorageReferences(graph,r.trace,{afterExecutionId:at,expected:'tree',includeTopology:false});
 assert.deepEqual(lean,full,'expectation checks cannot be disabled by a display optimization');
});

test('history limit diagnostics state the retained count and exact unknown interval',()=>{
 const events=Array.from({length:6},(_,i)=>({eventId:`e${i}`})),positions=new Map(events.map((e,i)=>[e.eventId,i])),
  candidate={id:'s',states:[],coverage:stateHistoryCoverage(3)};
 for(let i=0;i<6;i++)appendStateSnapshot(candidate.states,{afterExecutionId:`e${i}`,nodes:[],status:'observed',value:i},candidate.coverage);
 const [d]=historyDiagnostics([candidate]);
 assert.equal(d.limit,3);assert.equal(d.retainedStates,3);assert.equal(d.omitted,3);
 assert.equal(d.historyGapFromExecutionId,'e2');assert.equal(d.historyGapToExecutionId,'e5');
 for(let i=2;i<5;i++)assert.equal(structureStateAt(candidate,positions,i).historyGap,true);
 assert.equal(structureStateAt(candidate,positions,5).value,5);
 assert.equal(structureStateAt(candidate,positions,5).historyGap,undefined);
});
