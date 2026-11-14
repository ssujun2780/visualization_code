import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storageRoot} from '../scripts/shared/storage-alias.mjs';
import {beginMemory,observeMemory,synchronizeAliases} from '../src/animation/memory.js';
import {graphEdgeIdentity,mergeGraphEvidence} from '../scripts/inference/graph-proof-identity.mjs';
import {inverseRoleCoverage} from '../scripts/inference/inverse-role-coverage.mjs';
import {encodePreparedStructures,decodePreparedStructures} from '../src/animation/prepared-format.js';
import {inputContext,snapshotOf,digest} from '../scripts/execution-relations/v2/common.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {addressSelectionControls} from '../scripts/inference/address-selection-controls.mjs';
import {storageReferenceView} from '../src/animation/structure-storage-view.js';

test('nested aliases translate offsets without merging lifetimes or address-reused allocations',()=>{
 const objects=new Map([{id:'root',size:16},{id:'local',size:8,storageAlias:{objectId:'root',offset:4}},
   {id:'leaf',size:4,storageAlias:{objectId:'local',offset:4}},{id:'reused',size:16}].map(o=>[o.id,o]));
 assert.equal(storageRoot(id=>objects.get(id),'leaf').offset,8);
 const state={objects:new Map([...objects].map(([id,o])=>[id,beginMemory(o,{address:'0x1000'},null)]))},recording={objects};
 const e={kind:'WRITE',eventId:'write',target:{objectId:'leaf',offset:0,size:4},value:{decimal:'27',bytesHex:'1b000000'}};
 observeMemory(recording,state,e);synchronizeAliases(recording,state,e);
 assert.equal(state.objects.get('root').cells.get(8).value.decimal,'27');
 assert.equal(state.objects.get('local').cells.get(4).value.decimal,'27');
 assert.equal(state.objects.get('reused').cells.size,0);
 state.objects.get('leaf').alive=false;assert.equal(state.objects.get('root').alive,true);
 objects.get('local').storageAlias.offset=20;assert.equal(storageRoot(id=>objects.get(id),'leaf'),null);
});
test('matrix evidence coalesces by physical range; parallel storage remains distinct',()=>{
 const range={objectId:'slab',offset:20,size:4},a={kind:'matrix-operand-pair',fromIndex:2,toIndex:5,sourceSlots:[],properties:[{source:range,readExecutionId:'r1'}],executionId:'c1'},
 b={kind:'matrix-gated-access',fromIndex:2,toIndex:5,sourceSlots:[range],properties:[],executionId:'c2'};
 a.edgeIdentity=graphEdgeIdentity(a);b.edgeIdentity=graphEdgeIdentity(b);
 assert.equal(a.edgeIdentity,b.edgeIdentity);
 assert.notEqual(a.edgeIdentity,graphEdgeIdentity({...b,sourceSlots:[{...range,offset:24}]}));
 const merged=mergeGraphEvidence(a,b);assert.equal(merged.supportingProofIds.length,2);assert.equal(merged.properties[0].readExecutionId,'r1');
});
test('inverse links must cover every child and may not hide unknown or unrelated links',()=>{
 const edges=[{from:'a',to:'b',fieldNodeId:'child',lastWrite:'w1'},{from:'b',to:'a',fieldNodeId:'parent',lastWrite:'w2'},
 {from:'a',to:null,fieldNodeId:'parent',status:'null',lastWrite:'w0'}],s={edges};
 assert.ok(inverseRoleCoverage(s,['child'],['parent'],['a','b']));
 assert.equal(inverseRoleCoverage({edges:[...edges,{from:'b',to:'c',fieldNodeId:'parent'}]},['child'],['parent'],['a','b','c']),null);
 assert.equal(inverseRoleCoverage({edges:edges.map(e=>e.to===null?{...e,status:'unknown'}:e)},['child'],['parent'],['a','b']),null);
});
test('prepared transport retains every historical value and special metadata',()=>{
 const relation={nodes:[{id:'n',value:3}],evidence:['x1']},data={tracks:[{objectId:'o',entries:[
 {index:1,presentation:{relation,recommendations:[{view:'tree'}]}},{index:7,presentation:{relation,recommendations:[{view:'tree'}]}},
 {index:9,presentation:{relation:{nodes:[{id:'n',value:4}],evidence:['x9']},missing:undefined}}]}]};
 const encoded=encodePreparedStructures(data),decoded=decodePreparedStructures(JSON.parse(JSON.stringify(encoded)));
 assert.deepEqual(decoded,data);
 assert.equal(decoded.tracks[0].entries[0].presentation.relation,decoded.tracks[0].entries[1].presentation.relation);
 assert.equal(decoded.tracks[0].entries[2].presentation.relation.nodes[0].value,4);
 assert.equal(decodePreparedStructures(data),data);
});
test('disjoint initialization/output cursors do not establish a queue',async()=>{
 const r=await traceWithStructureView('int main(void){int a[5];for(int i=0;i<5;i++)a[i]=i+1;int s=0;for(int i=0;i<5;i++)s+=a[i];return s==15?0:1;}');
 assert.equal(r.trace.status,'completed');assert.equal(r.trace.structures.filter(s=>s.kind==='queue-candidate').length,0);
});
test('typed heap range starts at type evidence, and immutable snapshots cannot be poisoned',async()=>{
 const r=await traceWithStructureView('#include <stdlib.h>\nint main(void){void*p=malloc(12);int*x=p;x[0]=7;int n=x[0];free(p);return n==7?0:1;}');
 const order=new Map(r.trace.events.map((e,i)=>[e.eventId,i])),o=r.trace.objects.find(o=>o.storage==='heap'),
   a=r.trace.structures.find(s=>s.kind==='array'&&s.objectId===o.id);
 assert.ok(a);assert.ok(order.get(a.availableAtExecutionId)>order.get(o.createdBy));
 const c=inputContext(r.plan,r.trace,{}),first=snapshotOf(c);
 assert.equal(first.inputDigests.trace,digest(c.trace));first.inputDigests.trace='tampered';
 assert.equal(snapshotOf(c).inputDigests.trace,digest(c.trace));
 const changed=structuredClone(r.trace);changed.status='partial';
 assert.notEqual(snapshotOf(inputContext(r.plan,changed,{})).inputDigests.trace,snapshotOf(c).inputDigests.trace);
});
test('VLA extents stay compiler helpers while written multiplication stays CALC',async()=>{
 const r=await traceModel('#include <stdio.h>\nint main(void){int n=2,m=3;int a[n][m];int product=n*m;a[n-1][m-1]=9;printf("%zu %d %d\\n",sizeof(a),product,a[1][2]);return 0;}',{includeObservations:true});
 assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'24 6 9\n');
 assert.ok(r.plan.coverage.compilerHelpers.some(p=>p.kind==='runtime-allocation-extent'));
 assert.equal(r.plan.coverage.unmappedObservations.length,0);
 assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&e.value?.decimal==='6'&&e.steps?.some(s=>s.operator==='*')));
 assert.ok(r.trace.objects.some(o=>o.name==='a'&&o.size===24));
});
test('address-selected routing excludes conditions on a different storage slot',()=>{
 const e={target:{objectId:'o',offset:8},addressInputs:['p'],controlInputs:['direct']},
   flow={chain:()=>[
     {value:{reference:{status:'in-bounds',targetObjectId:'o',targetOffset:8}},controlInputs:['selected']},
     {value:{reference:{status:'in-bounds',targetObjectId:'o',targetOffset:0}},controlInputs:['other']}
   ]};
 assert.deepEqual(addressSelectionControls(e,flow),['direct','selected']);
});
test('integer child slots handle nonzero roots and reject later cycles without declaring unused slots null',async()=>{
 const source='#include <stdio.h>\n'+
 'typedef struct {int marker;int branch[3];} X;X bank[12];int next=4;\n'+
 'void add(const char*s){int p=3;while(*s){int k=*s++-48;if(!bank[p].branch[k])bank[p].branch[k]=next++;p=bank[p].branch[k];}bank[p].marker=7;}\n'+
 'int find(const char*s){int p=3;while(*s){p=bank[p].branch[*s++-48];if(!p)return 0;}return bank[p].marker;}\n'+
 'int main(void){add("01");printf("A %d\\n",find("01"));bank[5].branch[2]=3;printf("B %d\\n",find("01201"));return 0;}';
 const r=await traceWithStructureView(source),order=new Map(r.trace.events.map((e,i)=>[e.eventId,i])),
   first=r.trace.events.find(e=>e.action==='output'&&e.text.startsWith('A')),last=r.trace.events.find(e=>e.action==='output'&&e.text.startsWith('B')),
   candidates=r.trace.structures.filter(s=>s.kind==='sequence-lookup-candidate'),
   state=(s,e)=>s.states.findLast(st=>order.get(st.afterExecutionId)<=order.get(e.eventId));
 assert.equal(r.stdout,'A 7\nB 7\n');
 assert.ok(candidates.some(s=>state(s,first)?.conditions.trie==='supported-observed'));
 assert.ok(candidates.every(s=>state(s,last)?.conditions.trie!=='supported-observed'));
 const record=r.trace.structures.find(s=>s.kind==='record-index-graph-candidate'),snapshot=state(record,first);
 assert.deepEqual(snapshot.nodes.map(n=>n.index).sort((a,b)=>a-b),[3,4,5]);
 const unused=snapshot.edges.filter(e=>e.value===0);assert.ok(unused.length);
 for(const e of unused){
   assert.equal(e.to,null);assert.equal(e.terminationExecutionId,null);assert.equal(e.physicalBounds,'in-bounds');
   assert.ok(!['observed','observed-termination','inferred'].includes(e.status));
 }
});
test('prepared storage queries preserve every root, role, time and detached return value',async()=>{
 const r=await traceWithStructureView('typedef struct N{int v;struct N*next;}N;int main(void){N a={1,0},b={2,0};a.next=&b;b.next=&a;a.next=0;return b.v;}'),
 graph=r.trace.structures.find(s=>s.kind==='storage-reference-graph'),cached=storageReferenceView,
 targets=r.trace.objects.filter(o=>o.cType?.kind==='record').map(o=>({objectId:o.id})),
 times=[...graph.changes.map(c=>c.afterExecutionId)].reverse(),roles=[null,...new Set(graph.changes.flatMap(c=>c.upsertEdges.map(e=>e.roleId)))].map(r=>r===null?null:[r]);
 for(const at of times)for(const target of targets)for(const role of roles){
   const expected=storageReferenceView(graph,r.trace,target,at,role),actual=cached(graph,r.trace,target,at,role);
   assert.deepEqual(actual,expected);
   if(actual?.nodes[0])actual.nodes[0].range.offset+=1000;
   assert.deepEqual(cached(graph,r.trace,target,at,role),expected);
 }
});
