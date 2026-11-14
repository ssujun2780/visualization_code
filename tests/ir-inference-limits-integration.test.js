import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {inferStructures,inferStructuresAsync,createInferenceView,queryStructureConditions,recommendStructureViews,validateStructureTrace} from '../scripts/inference/index.mjs';
import {stateHistoryCoverage,appendStateSnapshot,structureStateAt,stateHistoryGapAt,validateStateHistory,boundStructureHistory} from '../scripts/inference/state-history.mjs';
import {createValueFlow} from '../scripts/inference/observed-value-flow.mjs';
import {buildStructureStorageBindings} from '../scripts/inference/storage-bindings.mjs';
import {recordEvidence} from '../scripts/inference/record-evidence.mjs';
import {createInferenceBudget} from '../scripts/inference/inference-limits.mjs';
import {inferExecutionRelations,validateExecutionRelations,createExecutionWorkQuery} from '../scripts/execution-relations/index.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {tableRowStructures} from '../scripts/inference/table-row-views.mjs';
import {pointerTreeStructures} from '../scripts/inference/pointer-tree-views.mjs';
import {pointerPartitionStructures,sharedRecordStructures} from '../scripts/inference/pointer-semantics.mjs';
import {pointerPriorityStructures} from '../scripts/inference/priority-comparison.mjs';
import {rangeAggregateStructures} from '../scripts/inference/range-aggregate-views.mjs';
import {deferredUpdateStructures} from '../scripts/inference/composed-update-views.mjs';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
const dir='test-results/inference-limits-integration-2026-11-12',metrics=[],memo=new Map();
await fs.mkdir(dir,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const id=s=>s.afterExecutionId??s.executionId;
async function load(name){
 if(memo.has(name))return memo.get(name);
 const r=await frozenInferenceExecution(name);memo.set(name,r);return r;
}
function infer(raw,limits){return inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace,limits});}
function noFailure(r){assert.ok(!r.diagnostics.some(d=>d.code==='structure-inference-failed'),JSON.stringify(r.diagnostics));}
// These are interface contract tests, not classifiers or replacements for C execution.
test('all snapshot families preserve exact prefix/gap/latest boundaries and object lifetimes',()=>{
 const events=Array.from({length:12},(_,i)=>({eventId:`e${i}`})),pos=new Map(events.map((e,i)=>[e.eventId,i])),objects=[{id:'old',createdBy:'e0',endedBy:'e10'},{id:'new',createdBy:'e10'}];
 for(const kind of ['linked-structure','pointer-tree-projection','ordered-tree-candidate','rooted-index-structure','range-aggregate-candidate','representative-partition-candidate','queue-candidate','deferred-update-candidate','index-domain-graph-candidate','shared-substructure-candidate']){
  const s={kind,objectId:'old',states:[],coverage:stateHistoryCoverage(2)};
  for(const at of [1,3,5,7])appendStateSnapshot(s.states,{afterExecutionId:`e${at}`,alive:true,status:'supported-observed',nodes:[{id:'same-value',range:{objectId:'old',offset:0,size:4}}]},s.coverage);
  validateStateHistory(s,pos);assert.deepEqual(s.states.map(id),['e1','e7']);
  assert.equal(stateHistoryGapAt(s,pos,2),false);assert.equal(structureStateAt(s,pos,3).historyGap,true);
  assert.equal(stateHistoryGapAt(s,pos,6),true);assert.equal(stateHistoryGapAt(s,pos,7),false);
  assert.equal(structureStateAt(s,pos,9,objects).alive,true);assert.equal(structureStateAt(s,pos,10,objects).status,'ended');
  const corrupt=structuredClone(s);corrupt.coverage.historyGapFromExecutionId='e7';assert.throws(()=>validateStateHistory(corrupt,pos));
 }
 const single={states:[],coverage:stateHistoryCoverage(1)};for(const at of [1,3,7])appendStateSnapshot(single.states,{executionId:`e${at}`},single.coverage);
 assert.equal(single.coverage.firstStateExecutionId,'e1');assert.equal(structureStateAt(single,pos,3),null);assert.equal(stateHistoryGapAt(single,pos,3),true);validateStateHistory(single,pos);
 const already={states:[],coverage:stateHistoryCoverage(3)};for(const at of [1,2,3,4,5,6,7])appendStateSnapshot(already.states,{afterExecutionId:`e${at}`},already.coverage);
 const smaller=boundStructureHistory(already,1);assert.equal(smaller.states.length,1);assert.equal(smaller.coverage.omittedStates,6);assert.equal(smaller.coverage.historyGapFromExecutionId,'e1');validateStateHistory(smaller,pos);
});

const cases=[
 ['returned-list','linked-structure'],['pointer-selected-records','pointer-partition-candidate'],
 ['constant-leaf-range','range-aggregate-candidate'],['full-flag-ring','queue-candidate'],
 ['xor-even-range','deferred-update-candidate'],['string-key-hash','associative-lookup-candidate'],
 ['trie-history','sequence-lookup-candidate'],['pointer-policy-lifetime','composite-priority-candidate']
];
for(const [name,kind]of cases)test(`${name}: public inference limits preserve identity, latest state and honest missing intervals`,async()=>{
 const raw=await load(name),before=hash(raw),normal=infer(raw);noFailure(normal);
 const selected=normal.structures.find(s=>s.kind===kind&&s.states.length>1);assert.ok(selected,kind);
 const pos=new Map(raw.trace.events.map((e,i)=>[e.eventId,i]));
 for(const maxStates of [1,2,5]){
  const t=performance.now(),limited=infer(raw,{maxStates});noFailure(limited);
  const exceeds=normal.structures.some(s=>s.states?.length>maxStates);
  assert.equal(limited.status,exceeds?'partial':normal.status);assert.equal(limited.diagnostics.some(d=>d.resource==='omittedStates'),exceeds);
  assert.ok(limited.structures.every(s=>!s.states||s.states.length<=maxStates));
  const s=limited.structures.find(s=>s.id===selected.id);assert.ok(s,`lost ${selected.id}`);
  assert.equal(s.discoveredAtExecutionId,selected.discoveredAtExecutionId,'history budget cannot change discovery time');
  assert.equal(id(s.states.at(-1)),id(selected.states.at(-1)),'latest lifetime/write observation must survive');
  const view=createInferenceView(raw,limited),gap=s.coverage?.historyGapFromExecutionId;validateStructureTrace(view.plan,view.trace);
  if(gap){const at=pos.get(gap);assert.equal(stateHistoryGapAt(s,pos,at),true);
   assert.ok(!recommendStructureViews(view.trace,{target:{structureId:s.id},afterExecutionId:gap}).some(r=>r.structureId===s.id));
   const state=structureStateAt(s,pos,at);assert.ok(state===null||state.status==='incomplete');
  }
  assert.equal(hash(raw),before);metrics.push({name,maxStates,milliseconds:performance.now()-t,events:raw.trace.events.length,candidates:limited.structures.length});
  await fs.writeFile(`${dir}/${name}-${maxStates}.inference.json`,JSON.stringify(limited));
 }
});

test('origin depth and dependency-node exhaustion are distinct from absent evidence and from C errors',()=>{
 const plan={instructions:[]},events=[{eventId:'create',kind:'SPACE'}],objects=[{id:'records',size:28,createdBy:'create',cType:{kind:'record'}}],range=i=>({objectId:'records',offset:i*4,size:4});
 for(let i=1;i<=6;i++)events.push({eventId:`copy${i}`,kind:'WRITE',action:'copy',target:range(i),sourceObjectId:'records',sourceOffset:(i-1)*4,sourceSize:4,dataInputs:i>1?[`copy${i-1}`]:[]});
 const budget=createInferenceBudget({maxOriginDepth:3,maxDependencyNodes:2}),trace={events,objects,structures:[],inferenceBudget:budget};budget.setStage('contract-probe');
 const c=recordEvidence(plan,trace);assert.equal(c.origin(range(6),6),null);assert.deepEqual(c.dependencies(['copy6']),[]);
 assert.deepEqual(new Set(budget.diagnostics().map(d=>d.resource)),new Set(['record-origin-depth','record-dependencies']));
 const unrestricted=recordEvidence(plan,{events,objects,structures:[]});assert.deepEqual(unrestricted.origin(range(6),6).range,range(0));
 assert.equal(c.origin(null,6),null);assert.equal(budget.diagnostics().length,2);
});

test('low evidence limits are exposed through public sync/worker APIs without mutating execution',async()=>{
 const raw=await load('pointer-selected-records'),before=hash(raw),limits={maxDependencyNodes:1,maxOriginDepth:1},sync=infer(raw,limits);
 assert.equal(sync.status,'partial');assert.ok(sync.diagnostics.some(d=>d.code==='structure-inference-limit'));noFailure(sync);
 const worker=await inferStructuresAsync(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace,limits});
 assert.deepEqual(worker,sync);assert.equal(hash(raw),before);
 assert.throws(()=>infer(raw,{maxStates:0}),RangeError);
});
test('long dependency paths stop at the evidence budget, not the JavaScript call stack',()=>{
 const value={type:'i32',decimal:'1'},events=[{eventId:'first',kind:'READ',value,target:{objectId:'x',offset:0,size:4},dataInputs:[]}];
 for(let i=1;i<10000;i++)events.push({eventId:`calc${i}`,kind:'CALC',operator:'+',value,dataInputs:[events.at(-1).eventId]});
 const budget=createInferenceBudget({maxDependencyNodes:9000}),flow=createValueFlow({instructions:[]},{events,inferenceBudget:budget});
 assert.throws(()=>flow.dependencyReads(events.at(-1).eventId),e=>e.code==='structure-inference-limit');assert.equal(budget.diagnostics()[0].resource,'value-dependencies');
 const complete=createValueFlow({instructions:[]},{events,inferenceBudget:createInferenceBudget({maxDependencyNodes:11000})});assert.deepEqual(complete.dependencyReads(events.at(-1).eventId).map(e=>e.eventId),['first']);
});
test('retained proof checkpoints validate but never fill an omitted current-state interval',async()=>{
 const raw=await load('xor-even-range'),inference=infer(raw,{maxStates:1}),view=createInferenceView(raw,inference),s=inference.structures.find(s=>s.proofStates?.length);assert.ok(s);
 const pos=new Map(raw.trace.events.map((e,i)=>[e.eventId,i])),proof=s.proofStates.find(st=>stateHistoryGapAt(s,pos,pos.get(id(st))));assert.ok(proof);
 assert.equal(structureStateAt(s,pos,pos.get(id(proof))),null);
 assert.equal(queryStructureConditions(view.trace,{candidateId:s.id,expected:'segment-tree',afterExecutionId:id(proof)}).assessment,'incomplete');
 const bad=structuredClone(view.trace);bad.structures.find(x=>x.id===s.id).proofStates[0].nodes[0].range.offset+=1;assert.throws(()=>validateStructureTrace(view.plan,bad));
});
test('membership/storage/root limits cannot silently reuse a successful condition',async()=>{
 const events=[{eventId:'e0'},{eventId:'e1'}],pos=new Map(events.map((e,i)=>[e.eventId,i])),s={states:[{afterExecutionId:'e0',status:'supported-observed',omittedEntries:2}]};
 assert.equal(structureStateAt(s,pos,1).evidenceGap,true);assert.equal(structureStateAt(s,pos,1).status,'incomplete');
 const budget=createInferenceBudget(),a={id:'grid',kind:'array',objectId:'grid',geometry:{rank:2,dimensions:[200,200],byteStrides:[800,4],leafType:{signedness:'signed'}}};
 assert.deepEqual(tableRowStructures({instructions:[]},{events,objects:[{id:'grid',createdBy:'e0'}],structures:[a],inferenceBudget:budget}),[]);
 assert.equal(budget.diagnostics()[0].resource,'table-cells');
 const raw=await load('returned-list'),normal=infer(raw),view=createInferenceView(raw,normal),limited=createInferenceBudget();
 pointerTreeStructures(view.plan,{...view.trace,inferenceBudget:limited,valueFlow:createValueFlow(view.plan,view.trace)},{maxRoots:1});
 assert.ok(limited.diagnostics().some(d=>d.resource==='pointer-roots'));
});
test('streaming producers preserve the newest snapshot even with a single retained slot',async()=>{
 for(const [name,build]of [['trie-history',pointerTreeStructures],['pointer-selected-records',pointerPartitionStructures],['persistent-tree',sharedRecordStructures],['pointer-heap',pointerPriorityStructures],['constant-leaf-range',rangeAggregateStructures],['xor-even-range',deferredUpdateStructures]]){
  const raw=await load(name),normal=infer(raw);noFailure(normal);const v=createInferenceView(raw,normal),context={...v.trace,valueFlow:createValueFlow(v.plan,v.trace)},full=build(v.plan,context,{maxStates:10000});assert.ok(full.some(s=>s.states.length>2),name);
  for(const maxStates of [1,2]){const small=build(v.plan,context,{maxStates});assert.deepEqual(new Set(small.map(s=>s.id)),new Set(full.map(s=>s.id)),`${name}: retention must not erase a discovered candidate`);
   for(const s of small){const original=full.find(x=>x.id===s.id);assert.ok(s.states.length<=maxStates);assert.deepEqual(s.states.at(-1),original.states.at(-1));assert.equal(s.discoveredAtExecutionId,original.discoveredAtExecutionId);validateStateHistory(s,new Map(v.trace.events.map((e,i)=>[e.eventId,i])));}
  }
 }
});

function accessContract(raw,inference){
 const input=hash(raw),options={outputSchemaVersion:2,structureInference:inference},r=inferExecutionRelations(raw.plan,raw.trace,options);
 assert.notEqual(r.status,'failed',JSON.stringify(r.diagnostics));validateExecutionRelations(raw.plan,raw.trace,r,{structureInference:inference});
 const pos=new Map(raw.trace.events.map((e,i)=>[e.eventId,i])),bindings=inference.storageBindings,relations=r.relations.filter(r=>r.kind==='structure-access');
 let bound=0;
 for(const relation of relations){const element=relation.participants.find(p=>p.kind==='structure-element'),storage=relation.participants.find(p=>p.kind==='storage'),at=pos.get(relation.availableAtExecutionId);
  const matches=bindings.filter(b=>b.structureId===element.structureId&&b.elementId===element.elementId&&b.objectId===storage.objectId&&b.offset<storage.offset+storage.size&&storage.offset<b.offset+b.size&&pos.get(b.availableAtExecutionId)<=at&&!(pos.get(b.invalidatedAtExecutionId)<=at));
  if(inference.structures.find(s=>s.id===element.structureId)?.kind==='array')continue;
  const node=inference.structures.find(s=>s.id===element.structureId)?.nodes?.find(n=>n.id===element.elementId),o=raw.trace.objects.find(o=>o.id===storage.objectId),
    staticProof=node?.range?.objectId===storage.objectId&&node.range.offset<storage.offset+storage.size&&storage.offset<node.range.offset+node.range.size&&
      pos.get(node.discoveredAtExecutionId)<=at&&pos.get(o.createdBy)<=at&&!(pos.get(o.endedBy)<=at);
  assert.ok(matches.length||staticProof,JSON.stringify({element,storage,at}));if(matches.length)bound++;
 }
 assert.ok(bound>0,'real inferred elements must reach the execution-relations consumer');assert.equal(hash(raw),input);
 const emitted=new Set(relations.map(r=>{const el=r.participants.find(p=>p.kind==='structure-element'),st=r.participants.find(p=>p.kind==='storage');return JSON.stringify([r.availableAtExecutionId,el.structureId,el.elementId,st.objectId,st.offset,st.size]);}));
 for(const e of raw.trace.events)if(['READ','WRITE'].includes(e.kind)&&e.target&&e.phase!=='failed')for(const b of bindings){const at=pos.get(e.eventId),t=e.target;
  if(b.objectId!==t.objectId||b.offset>=t.offset+t.size||t.offset>=b.offset+b.size||pos.get(b.availableAtExecutionId)>at||pos.get(b.invalidatedAtExecutionId)<=at)continue;
  assert.ok(emitted.has(JSON.stringify([e.eventId,b.structureId,b.elementId,t.objectId,t.offset,t.size])),`missing structure access ${e.eventId}/${b.structureId}/${b.elementId}`);
 }
 return {r,bound};
}
for(const name of ['returned-list','pointer-selected-records','constant-leaf-range','full-flag-ring'])test(`${name}: actual inference storage bindings reach execution-relations unchanged`,async()=>{
 const raw=await load(name),inference=infer(raw);noFailure(inference);const {r,bound}=accessContract(raw,inference);
 const q=createExecutionWorkQuery(raw.plan,raw.trace,r,{schemaVersion:2,structureInference:inference});assert.ok(q.at(raw.trace.events.at(-1).eventId));
 await fs.writeFile(`${dir}/${name}.relations.json`,JSON.stringify(r));metrics.push({name,structureAccesses:bound});
});

test('storage exchange preserves sharing, gaps, detachment/reinsertion and allocation identity',()=>{
 const trace={events:Array.from({length:10},(_,i)=>({eventId:`e${i}`})),objects:[{id:'old',size:8,createdBy:'e0',endedBy:'e8'},{id:'new',size:8,createdBy:'e8'}]},
  n={id:'member',range:{objectId:'old',offset:0,size:4}},a={id:'A',states:[],coverage:stateHistoryCoverage(2)};
 for(const [time,nodes]of [[1,[n]],[3,[]],[4,[n]],[6,[n]]])appendStateSnapshot(a.states,{afterExecutionId:`e${time}`,nodes},a.coverage);
 const b={id:'B',states:[{afterExecutionId:'e2',nodes:[n]},{afterExecutionId:'e7',nodes:[]}]},replacement={id:'C',states:[{afterExecutionId:'e8',nodes:[{id:'member',range:{objectId:'new',offset:0,size:4}}]}]};
 const late={id:'D',states:[{afterExecutionId:'e6',nodes:[n]},{afterExecutionId:'e9',nodes:[],status:'ended'}]};
 const input=hash([trace,a,b,replacement,late]),actual=buildStructureStorageBindings(trace,[a,b,replacement,late]).map(x=>[x.structureId,x.elementId,x.objectId,x.availableAtExecutionId,x.invalidatedAtExecutionId]);
 assert.deepEqual(actual,[['A','member','old','e1','e3'],['A','member','old','e6','e8'],['B','member','old','e2','e7'],['C','member','new','e8',null],['D','member','old','e6','e8']]);
 assert.equal(hash([trace,a,b,replacement,late]),input);
});

for(const n of [4,8,16])test(`mixed linked storage/queue grows to ${n} elements without changing order or lifetime`,async()=>{
 const source=`#include <stdio.h>\n#include <stdlib.h>\ntypedef struct N{int v;struct N*next;}N;\nN*q[${n}];int head,tail,count;\nvoid put(N*p){q[tail]=p;tail=(tail+1)%${n};count++;}\nN*get(void){N*p=q[head];head=(head+1)%${n};count--;return p;}\nint main(void){N*a=calloc(${n},sizeof(N));if(!a)return 1;for(int i=0;i<${n};i++){a[i].v=i+1;a[i].next=i+1<${n}?a+i+1:NULL;}for(N*p=a;p;p=p->next)put(p);int sum=0;while(count){N*p=get();sum+=p->v;}printf("%d\\n",sum);free(a);return 0;}\n`,expected={sourceHash:hash(source),stdout:`${n*(n+1)/2}\n`,order:Array.from({length:n},(_,i)=>i+1)};
 const path=`${dir}/mixed-${n}.expected.json`;try{await fs.writeFile(path,JSON.stringify(expected),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(JSON.parse(await fs.readFile(path)),expected);}
 await fs.writeFile(`${dir}/mixed-${n}.c`,source);
 const raw=await traceModel(source,{filename:`mixed-${n}.c`,includeObservations:true});assert.equal(raw.trace.status,'completed');assert.equal(raw.stdout,expected.stdout);
 const before=hash(raw),t=performance.now(),inference=infer(raw);noFailure(inference);assert.equal(inference.status,'completed');
 const linked=inference.structures.filter(s=>s.kind==='linked-structure');assert.ok(linked.some(s=>s.states.some(st=>st.topology?.reachableNodeIds?.length===n)));
 const queues=inference.structures.filter(s=>s.kind==='queue-candidate'),queue=queues.find(s=>s.operations.filter(op=>op.kind==='dequeue').length===n);assert.ok(queue);
 const reads=queue.operations.filter(op=>op.kind==='dequeue').map(op=>raw.trace.events.find(e=>e.eventId===op.accessExecutionId)),refs=reads.map(e=>e.value.reference),storage=raw.trace.objects.find(o=>o.id===refs[0].targetObjectId);
 assert.deepEqual(refs.map(r=>[r.targetObjectId,r.targetOffset]),expected.order.map(i=>[storage.id,(i-1)*(storage.size/n)]),'the queue must return the original nodes in source insertion order');
 const {bound}=accessContract(raw,inference);assert.equal(hash(raw),before);
 await fs.writeFile(`${dir}/mixed-${n}.execution.json`,JSON.stringify(raw));await fs.writeFile(`${dir}/mixed-${n}.inference.json`,JSON.stringify(inference));
 metrics.push({name:`mixed-${n}`,events:raw.trace.events.length,milliseconds:performance.now()-t,candidates:inference.structures.length,structureAccesses:bound});
});
after(async()=>{await fs.writeFile(`${dir}/metrics.json`,JSON.stringify(metrics,null,2));});
