import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,queryStructureConditions,setStructurePresentation,resolveStructurePresentation,buildStructureStorageBindings,validateStructureTrace} from '../scripts/inference/index.mjs';
import {scalarPayload,comparePayload} from '../scripts/inference/scalar-domain.mjs';
import {compareKeyValues} from '../scripts/inference/bst-key-order.mjs';
import {storageEvidence} from '../scripts/inference/storage-semantics.mjs';
import {executionCacheKey,readExecutionCache,writeExecutionCache} from './helpers/execution-cache.mjs';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
const dir='test-results/inference-common-completion-2026-11-12',memo=new Map(),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
await fs.mkdir(dir,{recursive:true});
async function inspect(id,source,stdout){
 if(memo.has(id))return memo.get(id);let execution;
 if(source===undefined){execution=await frozenInferenceExecution(id);
 }else{await fs.writeFile(`${dir}/${id}.c`,source);await fs.writeFile(`${dir}/${id}.expected.json`,JSON.stringify({sourceHash:hash(source),stdout}));
  execution=await traceModel(source,{filename:`${id}.c`,includeObservations:true});assert.equal(execution.trace.status,'completed');assert.equal(execution.stdout,stdout);await fs.writeFile(`${dir}/${id}.execution.json`,JSON.stringify(execution));}
 const before=hash(JSON.stringify(execution)),start=performance.now(),inference=inferStructures(execution.plan,execution.trace,{observationPlan:execution.observations?.plan,observedTrace:execution.observations?.trace});
 await fs.writeFile(`${dir}/${id}.inference.json`,JSON.stringify(inference));await fs.writeFile(`${dir}/${id}.metrics.json`,JSON.stringify({milliseconds:performance.now()-start,events:execution.trace.events.length,structures:inference.structures.length,bindings:inference.storageBindings?.length,inputHash:before,unchanged:before===hash(JSON.stringify(execution))}));
 assert.equal(hash(JSON.stringify(execution)),before);assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));
 const view={...createInferenceView(execution,inference),inference};memo.set(id,view);return view;
}
const kinds=(r,k)=>r.trace.structures.filter(s=>s.kind===k),last=s=>s.states.at(-1);
test('constant leaves retain observed storage coordinates, child order and real writes',async()=>{
 const r=await inspect('constant-leaf-range'),s=kinds(r,'range-aggregate-candidate').find(s=>last(s).view==='segment-tree');assert.ok(s);
 const root=last(s).nodes.find(n=>n.index===1);assert.deepEqual(root.children.map(c=>c.index),[2,3]);assert.deepEqual(root.leaves.map(l=>l.index),[4,5,6,7]);assert.equal(root.value.decimal,'15');
 assert.equal(root.coverage.arrayId,s.arrayId);assert.deepEqual([root.coverage.start,root.coverage.end],[4,8]);
 const q=queryStructureConditions(r.trace,{candidateId:s.id,expected:'segment-tree'});assert.equal(q.assessment,'satisfied-observed');
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.at(-1).nodes.find(n=>n.index===1).leaves[0].index=0;assert.throws(()=>validateStructureTrace(r.plan,bad));
});
test('tag-only XOR and ordinary OR propagate the same parent version to both children',async()=>{
 for(const id of ['xor-even-range','or-lazy']){const r=await inspect(id),s=kinds(r,'deferred-update-candidate').find(s=>s.propagations.length===2);assert.ok(s,id);
  assert.deepEqual(s.propagations.map(p=>[p.index,p.childIndices]),[[1,[2,3]],[3,[6,7]]]);
  if(id==='xor-even-range'){assert.ok(s.applications.some(a=>a.aggregateEffect==='not-written'&&a.aggregateWriteExecutionId===null));
   const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).applications.find(a=>a.aggregateEffect==='not-written').siteProofExecutionId='absent';assert.throws(()=>validateStructureTrace(r.plan,bad));}
 }
});
test('full flag queue distinguishes full/empty equal cursors and retains FIFO writer identity',async()=>{
 const r=await inspect('full-flag-ring'),s=kinds(r,'queue-candidate').find(s=>s.layout==='flag-ring');assert.ok(s);
 const full=s.states.find(st=>st.full);assert.equal(full.front,full.back);assert.equal(full.count,3);assert.deepEqual(full.ringOrder.indices,[0,1,2]);
 assert.equal(last(s).count,0);assert.deepEqual(s.operations.filter(o=>o.kind==='dequeue').map(o=>r.trace.events.find(e=>e.eventId===o.accessExecutionId).value.decimal),['1','2','3','4','5']);
 assert.equal(queryStructureConditions(r.trace,{candidateId:s.id,expected:'queue',afterExecutionId:full.executionId}).assessment,'satisfied-observed');
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.find(st=>st.full).ringOrder.indices.reverse();assert.throws(()=>validateStructureTrace(r.plan,bad));
});
test('string hash uses actual strcmp arguments and byte-derived bucket dependencies',async()=>{
 const r=await inspect('string-key-hash'),s=kinds(r,'associative-lookup-candidate').find(s=>s.lookupEvidence.some(p=>p.comparisonDomain==='nul-terminated-bytes'));assert.ok(s);
 assert.ok(s.lookupEvidence.every(p=>p.bucketTransformExecutionIds.length));assert.equal(queryStructureConditions(r.trace,{candidateId:s.id,expected:'hash-table'}).assessment,'satisfied-observed');
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).lookupEvidence[0].queryReadExecutionId=s.lookupEvidence[0].keyReadExecutionId;assert.throws(()=>validateStructureTrace(r.plan,bad));
});
test('standalone pointer comparator yields a policy without inventing heap nodes; free ends lifetime',async()=>{
 const r=await inspect('pointer-policy-lifetime'),s=kinds(r,'composite-priority-candidate')[0];assert.ok(s);assert.equal(last(s).alive,false);assert.equal(last(s).status,'ended');
 assert.ok(s.states.some(st=>st.alive&&st.keyOrder?.length===2));assert.ok(s.states.every(st=>st.nodes.length===0&&st.min==='unknown'));
});
test('manual kind keeps user priority and checks dedicated conditions; generic tree ignores heap conditions',async()=>{
 const r=await inspect('constant-leaf-range'),s=kinds(r,'range-aggregate-candidate')[0],target={structureId:s.id};
 const preferences=setStructurePresentation(null,r.trace,{target,view:'segment-tree'}),p=resolveStructurePresentation(r.trace,{target,preferences});
 assert.equal(p.mode,'manual');assert.equal(p.expected,'segment-tree');assert.equal(p.expectationCheck.assessment,'satisfied-observed');
 const tree=setStructurePresentation(preferences,r.trace,{target,view:'tree'}),q=resolveStructurePresentation(r.trace,{target,preferences:tree});assert.equal(q.expected,'tree');assert.ok(q.expectationCheck.candidates.every(c=>c.checks.every(c=>!c.conditionId.includes('heap'))));
});
test('exact integer payload, floating/NaN comparison and coordinate separation',()=>{
 const a=scalarPayload({decimal:'18446744073709551614',cType:{signedness:'unsigned',sizeBits:64}}),b=scalarPayload({decimal:'18446744073709551615',cType:{signedness:'unsigned',sizeBits:64}});
 assert.equal(comparePayload(a,b).sign,-1);assert.equal(compareKeyValues([a.value],[b.value],[{index:0,direction:1}]).sign,-1);
 assert.equal(comparePayload({kind:'float',value:'NaN'},{kind:'float',value:'0'}).status,'unordered');assert.equal(compareKeyValues(['NaN'],[0],[{index:0,direction:1}]).sign,null);
 assert.equal(compareKeyValues([1.25],[1.5],[{index:0,direction:1}]).sign,-1);
 const trace={objects:[{id:'o',size:8,createdBy:'x1'}],structures:[],events:[{eventId:'x1',kind:'SPACE',objectId:'o'},{eventId:'x2',kind:'WRITE',target:{objectId:'o',offset:0,size:8},value:{bits:'0xfffffffffffffffe'}}]},c=storageEvidence({instructions:[]},trace),range={objectId:'o',offset:0,size:8};
 assert.equal(c.scalar(range,1,{signed:false}),null);assert.equal(c.payloadScalar(range,1,{signed:false}),a.value);
});
test('temporal storage exchange preserves shared membership, removal, re-entry and lifetime',()=>{
 const trace={events:Array.from({length:6},(_,i)=>({eventId:`x${i}`})),objects:[{id:'o',size:8,createdBy:'x0',endedBy:'x5'}]},node={id:'n',range:{objectId:'o',offset:0,size:4}},s={id:'s',states:[{afterExecutionId:'x1',nodes:[node]},{afterExecutionId:'x2',nodes:[node]},{afterExecutionId:'x3',nodes:[]},{afterExecutionId:'x4',nodes:[node]}]};
 const bs=buildStructureStorageBindings(trace,[s,{id:'other',states:[{afterExecutionId:'x2',nodes:[node]}]}]);
 assert.deepEqual(bs.map(b=>[b.structureId,b.availableAtExecutionId,b.invalidatedAtExecutionId]),[['s','x1','x3'],['s','x4','x5'],['other','x2','x5']]);
 assert.ok(bs.every(b=>b.elementId==='n'));assert.equal(s.states[0].nodes[0],node);
});
test('cache refuses missing tool identity, changed source/options/model and modified result',async()=>{
 const modelDir=`${dir}/cache-source`;await fs.mkdir(modelDir,{recursive:true});await fs.writeFile(`${modelDir}/model.mjs`,'v1');const opts={toolchain:'tool-a',roots:[modelDir]},k=await executionCacheKey('code',{x:1},opts),file=`${dir}/cache.json`;
 await writeExecutionCache(file,k,{stdout:'ok'});assert.deepEqual(await readExecutionCache(file,k),{stdout:'ok'});
 assert.equal(await readExecutionCache(file,await executionCacheKey('other',{x:1},opts)),null);assert.equal(await executionCacheKey('code',{}),null);
 assert.notEqual(k,await executionCacheKey('code',{x:2},opts));await fs.writeFile(`${modelDir}/model.mjs`,'v2');assert.notEqual(k,await executionCacheKey('code',{x:1},opts));
 const envelope=JSON.parse(await fs.readFile(file));envelope.execution.stdout='fake';await fs.writeFile(file,JSON.stringify(envelope));assert.equal(await readExecutionCache(file,k),null);
});
test('return-based linked traversal preserves the original three member identities',async()=>{
 const source=String.raw`#include <stdio.h>
typedef struct N{int value;struct N*next;} N;
N* advance(N*p){return p->next;}
N* identity(N*p){return p;}
int total(N*p){int sum=0;for(;p;p=advance(p))sum+=p->value;return sum;}
int main(void){N a[3]={{5,&a[1]},{7,&a[2]},{9,0}};N*root=identity(a);printf("%d\n",total(root));return 0;}`;
 const r=await inspect('returned-list',source,'21\n'),s=kinds(r,'linked-structure').find(s=>s.states.some(st=>st.topology?.reachableNodeIds.length===3));assert.ok(s);
 const st=s.states.find(st=>st.topology?.reachableNodeIds.length===3),nodes=st.topology.reachableNodeIds.map(id=>s.logicalNodes.find(n=>n.id===id));assert.deepEqual(nodes.map(n=>n.offset).sort((a,b)=>a-b),[0,8,16]);
 assert.ok(st.topology.edges.some(e=>e.status==='null'||e.termination==='boundary'));
});
test('pointer representative merge controls selected edge copy without algorithm-name inference',async()=>{
 const source=String.raw`#include <stdio.h>
typedef struct N{struct N*p;int v;} N;typedef struct E{N*a,*b;int cost;} E;
N*find(N*p){while(p->p!=p)p=p->p;return p;}
int main(void){N n[3];for(int i=0;i<3;i++){n[i].p=&n[i];n[i].v=i;}E e[3]={{n,n+1,4},{n+1,n+2,2},{n,n+2,8}},out[3];int count=0;
for(int i=0;i<3;i++){N*a=find(e[i].a),*b=find(e[i].b);if(a!=b){b->p=a;out[count++]=e[i];}}printf("%d %d %d\n",count,out[0].cost,out[1].cost);return 0;}`;
 const r=await inspect('pointer-selected-records',source,'2 4 2\n'),s=kinds(r,'partition-selection-candidate')[0];assert.ok(s);assert.deepEqual(s.selections.map(p=>[p.sourceIndex,p.targetIndex]),[[0,0],[1,1]]);
 assert.equal(r.trace.structures.find(p=>p.id===s.partitionId).kind,'pointer-partition-candidate');
});
test('renamed full flag with bit-mask wrap keeps equal payloads as different FIFO writes',async()=>{
 const source=String.raw`#include <stdio.h>
int data[4],reader,writer,packed;
void put(int value){if(packed)return;data[writer]=value;writer=(writer+1)&3;packed=writer==reader;}
int get(void){if(reader==writer&&!packed)return -1;int v=data[reader];reader=(reader+1)&3;packed=0;return v;}
int main(void){put(7);put(7);put(7);put(7);printf("%d ",get());put(7);for(int i=0;i<4;i++)printf("%d ",get());return 0;}`;
 const r=await inspect('mask-flag-equal-payload',source,'7 7 7 7 7 '),s=kinds(r,'queue-candidate').find(s=>s.layout==='flag-ring');assert.ok(s);
 const inserts=s.operations.filter(o=>o.kind==='enqueue').map(o=>o.accessExecutionId),removed=s.operations.filter(o=>o.kind==='dequeue').map(o=>o.consumedWriteExecutionId);
 assert.deepEqual(removed,inserts);assert.equal(new Set(removed).size,5);
});
test('string linear search remains non-hash even when an unrelated hash helper exists',async()=>{
 const source=String.raw`#include <stdio.h>
#include <string.h>
char*keys[3]={"aa","bb","cc"};int values[3]={2,4,6};
unsigned unrelated(const char*p){unsigned h=0;while(*p)h=h*31+(unsigned char)*p++;return h%3;}
int find(const char*q){for(int i=0;i<3;i++)if(strcmp(keys[i],q)==0)return values[i];return 0;}
int main(void){printf("%d %d\n",find("bb"),find("dd"));return 0;}`;
 const r=await inspect('string-linear-negative',source,'4 0\n');assert.equal(kinds(r,'associative-lookup-candidate').length,0);
});
test('storage exchange closes missing history and reopens the latest observed state',()=>{
 const trace={events:[0,1,2,3,4,5].map(n=>({eventId:`x${n}`})),objects:[{id:'o',size:4,createdBy:'x0'}]},node={id:'n',range:{objectId:'o',offset:0,size:4}},s={id:'s',states:[{afterExecutionId:'x1',nodes:[node]},{afterExecutionId:'x4',nodes:[node]}],coverage:{historyGapFromExecutionId:'x2'}};
 assert.deepEqual(buildStructureStorageBindings(trace,[s]).map(b=>[b.availableAtExecutionId,b.invalidatedAtExecutionId]),[['x1','x2'],['x4',null]]);
});
test('manual key role checks observed parent priorities without rewriting the graph',async()=>{
 const r=await inspect('returned-list'),s=kinds(r,'linked-structure').find(s=>s.states.some(st=>st.topology?.reachableNodeIds.length===3)),st=s.states.find(st=>st.topology?.reachableNodeIds.length===3);
 const q=queryStructureConditions(r.trace,{candidateId:s.id,afterExecutionId:st.afterExecutionId,expected:'min-heap',bindings:{key:{kind:'record',offset:0,size:4,signed:true}}});
 assert.equal(q.assessment,'satisfied-observed');assert.equal(q.candidates[0].properties.key.origin,'user');
 const bad=queryStructureConditions(r.trace,{candidateId:s.id,afterExecutionId:st.afterExecutionId,expected:'max-heap',bindings:{key:{kind:'record',offset:0,size:4,signed:true}}});assert.equal(bad.assessment,'contradicted');
});
test('scaled returned traversal checks member identity and records actual inference growth',async()=>{
 const rows=[];
 for(const count of [8,16,32]){
  const source=`#include <stdio.h>\ntypedef struct N{struct N*next;int value;}N;N*step(N*p){return p->next;}int main(void){N a[${count}];for(int i=0;i<${count};i++){a[i].next=i+1<${count}?a+i+1:0;a[i].value=i;}int sum=0;for(N*p=a;p;p=step(p))sum+=p->value;printf("%d\\n",sum);return 0;}`;
  const id=`scale-list-${count}`,r=await inspect(id,source,`${count*(count-1)/2}\n`),s=kinds(r,'linked-structure').find(s=>s.states.some(st=>st.topology?.reachableNodeIds.length===count));assert.ok(s);
  const st=s.states.find(st=>st.topology?.reachableNodeIds.length===count),nodes=st.topology.reachableNodeIds.map(id=>s.logicalNodes.find(n=>n.id===id));
  assert.deepEqual(nodes.map(n=>n.offset/n.size).sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i));
  assert.ok(st.topology.edges.some(e=>e.status==='null'||e.termination==='boundary'));
  rows.push({count,...JSON.parse(await fs.readFile(`${dir}/${id}.metrics.json`))});
 }
 await fs.writeFile(`${dir}/growth.json`,JSON.stringify(rows,null,2));
});
test('pointer priorities compare wide integer and fractional keys from actual recorded bytes',async()=>{
 for(const [id,type,values,expected]of [
  ['wide-pointer-keys','unsigned long long',['18446744073709551614ULL','18446744073709551613ULL','18446744073709551615ULL'],['18446744073709551613','18446744073709551614','18446744073709551615']],
  ['float-pointer-keys','double',['1.25','-2.5','0.5'],[-2.5,0.5,1.25]],
 ]){
  const source=`#include <stdio.h>\ntypedef struct N{${type} key;struct N*child,*sibling;}N;N*root;N*join(N*a,N*b){if(!a)return b;if(!b)return a;if(a->key>b->key){N*t=a;a=b;b=t;}b->sibling=a->child;a->child=b;return a;}int main(void){N n[3]={{${values[0]},0,0},{${values[1]},0,0},{${values[2]},0,0}};root=join(root,n);root=join(root,n+1);root=join(root,n+2);puts("ok");return 0;}`;
  const r=await inspect(id,source,'ok\n'),s=kinds(r,'pointer-priority-candidate').find(s=>s.states.some(st=>st.nodes.length===3&&st.min==='satisfied'));assert.ok(s,id);
  const state=s.states.findLast(st=>st.nodes.length===3&&st.min==='satisfied'),actual=state.nodes.map(n=>n.value).sort((a,b)=>compareKeyValues([a],[b],[{index:0,direction:1}]).sign);
  assert.deepEqual(actual,expected);assert.equal(queryStructureConditions(r.trace,{candidateId:s.id,afterExecutionId:state.afterExecutionId,expected:'min-heap'}).assessment,'satisfied-observed');
  const root=state.nodes.find(n=>n.value===expected[0]);assert.ok(state.priorityEdges.every(e=>e.from===root.id));assert.equal(state.edges.length,2);
  const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.find(st=>st.afterExecutionId===state.afterExecutionId).priorityEdges[0].from='missing';assert.throws(()=>validateStructureTrace(r.plan,bad));
 }
});
test('explicit terminal role uses actual bytes and cannot borrow the automatic role when unavailable',async()=>{
 const r=await inspect('trie-history'),s=kinds(r,'sequence-lookup-candidate')[0],st=s.states.findLast(st=>st.conditions.trie==='supported-observed');assert.ok(st);
 const options={candidateId:s.id,afterExecutionId:st.afterExecutionId,expected:'trie'},q=queryStructureConditions(r.trace,{...options,bindings:{terminal:{kind:'record',offset:8,size:4}}});
 assert.equal(q.assessment,'satisfied-observed');assert.equal(q.candidates[0].properties.terminal.origin,'user');
 assert.equal(queryStructureConditions(r.trace,{...options,bindings:{terminal:{kind:'record',offset:12,size:4}}}).assessment,'incomplete');
});
