import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inferStructures,recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {structureRootRange} from '../scripts/inference/structure-storage.mjs';
import {annotateLinkedPolicies} from '../scripts/inference/linked-container-policy.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function run(source,stdout){
  const r=await traceModel(source,{filename:'linked-policy.c'});
  assert.equal(r.stdout,stdout);assert.equal(r.trace.exitCode,0);assert.equal(r.trace.status,'completed');
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));assert.deepEqual(r.trace.coverage.irGaps??[],[]);
  const before=hash({plan:r.plan,trace:r.trace}),again=inferStructures(r.plan,r.trace);
  assert.equal(hash({plan:r.plan,trace:r.trace}),before);assert.equal(again.status,'completed');
  return {...r.trace,structures:again.structures};
}
const fixture=name=>fs.readFile(new URL(`../example/c/codex_code/linked-containers-audit-2026-11-10/${name}.c`,import.meta.url),'utf8');
const output=(t,i=0)=>t.events.filter(e=>e.action==='output')[i].eventId;
const object=(t,name)=>{const o=t.objects.find(o=>o.name===name);assert.ok(o,name);return o;};
const at=(t,s,id)=>{const pos=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states?.findLast(st=>pos.get(st.afterExecutionId)<=pos.get(id));};
const recommend=(t,name,id=output(t),range=null)=>recommendStructureViews(t,{target:range?{ranges:[range]}:{objectId:object(t,name).id},afterExecutionId:id});

test('dormant traversal never supplies runtime evidence; future traversal does not leak backward',async()=>{
  const t=await run(await fixture('15_pointer_lookup_counterexample'),'S0 9\n');
  for(const name of ['a','table'])assert.ok(!recommend(t,name).some(r=>r.view==='linked-list'));
  const q=await run(`#include <stdio.h>
typedef struct K{int number;struct K *route;}K;
int main(void){K z[2]={{2,z+1},{3,0}};K *seed=z;puts("before");
int sum=0;for(K *walk=seed;walk;walk=walk->route)sum+=walk->number;printf("%d\\n",sum);return 0;}`,'before\n5\n');
  assert.ok(!recommend(q,'seed',output(q,0)).some(r=>r.view==='linked-list'));
  assert.ok(recommend(q,'seed',output(q,1)).some(r=>r.view==='linked-list'));
});

test('disjoint pointer-array roots retain exact slots and selected-root preference',async()=>{
  const t=await run(await fixture('20_disjoint_root_slots'),'S0 2 2\n'),o=object(t,'roots'),width=o.cType.elementType.sizeBits/8;
  for(let i=0;i<2;i++){
    const range={objectId:o.id,offset:i*width,size:width},rs=recommend(t,'roots',output(t),range),list=rs.find(r=>r.view==='linked-list'),s=t.structures.find(s=>s.id===list?.candidateId);
    assert.ok(s);assert.equal(s.root.offset,i*width);assert.deepEqual(structureRootRange(s,t),range);
    assert.ok(rs.length<=5);assert.ok(rs.every(r=>r.intent==='unconfirmed'));
    const preferences=setStructurePresentation(null,t,{target:{ranges:[range]},view:'array'}),chosen=resolveStructurePresentation(t,{target:{ranges:[range]},preferences,afterExecutionId:output(t)});
    assert.equal(chosen.view,'array');assert.equal(chosen.source,'user');assert.equal(chosen.locked,true);
  }
});

test('unknown link stays unknown across projection and recommendation paths',async()=>{
  const t=await run(await fixture('17_unwritten_link'),'S0 2\n'),root=object(t,'head'),s=t.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id);
  assert.equal(at(t,s,output(t)).orders[0].termination,'unknown');
  assert.ok(!recommend(t,'head').some(r=>['linked-list','tree','binary-tree'].includes(r.view)&&r.status==='supported'));
  assert.ok(recommend(t,'head').some(r=>r.status==='partial'));
});

test('embedded boundary remains physical but has zero logical members when empty',async()=>{
  const t=await run(await fixture('05_embedded_sentinel'),'S0 10\nS1 0\n'),o=object(t,'box'),f=o.cType.members.find(f=>f.name==='nil'),range={objectId:o.id,offset:f.offsetBits/8,size:f.sizeBits/8};
  for(const [i,count]of [[0,2],[1,0]]){
    const r=recommend(t,'box',output(t,i),range).find(r=>r.view==='linked-list'),s=t.structures.find(s=>s.id===r?.candidateId),state=at(t,s,output(t,i));
    assert.equal(r.representedNodeCount,count);assert.equal(state.membership.dataNodeIds.length,count);
    assert.equal(state.membership.physicalNodeIds.length,count+1);assert.equal(state.membership.boundaryNodeIds.length,1);
  }
  assert.ok(!recommend(t,'box',output(t,1),range).some(r=>['tree','binary-tree'].includes(r.view)&&r.status==='supported'));
});

test('a data-head ring remains a list; a tail entering a cycle is not a simple circular list',async()=>{
  const t=await run(await fixture('04_circular_data_head'),'S0 9\nS1 9\n');
  assert.equal(recommend(t,'head').find(r=>r.view==='linked-list')?.variant,'circular');
  assert.notEqual(recommend(t,'head',output(t,1)).find(r=>r.view==='linked-list')?.variant,'circular');
  const bad=await run(`#include <stdio.h>
typedef struct N{int v;struct N *n;}N;
int main(void){N z[3]={{2,z+1},{2,z+2},{2,z+1}};N *head=z,*p=head;int sum=0;
for(int i=0;i<5;i++){sum+=p->v;p=p->n;}printf("%d\\n",sum);return 0;}`,'10\n');
  assert.ok(!recommend(bad,'head').some(r=>r.view==='linked-list'&&r.variant==='circular'));
});

for(const [name,stdout,checks]of [
  ['10_index_records','S0 18\nS1 24\n',[['head',0,[5,1,4]],['head',1,[5,1,2,4]]]],
  ['11_split_value_links','S0 9\nS1 6\n',[['head',0,[6,2,5]],['head',1,[6,5]]]],
  ['12_table_rows','S0 12\nS1 12\n',[['head',0,[4,1,6]],['head',1,[4,6,1]]]],
  ['13_active_free_pool','S0 3 3\nS1 4 2\n',[['used',0,[4,2,0]],['spare',0,[5,3,1]],['used',1,[5,4,2,0]],['spare',1,[3,1]]]],
])test('integer root provenance and directed membership: '+name,async()=>{
  const t=await run(await fixture(name),stdout);
  for(const [root,i,expected]of checks){
    const r=recommend(t,root,output(t,i)).find(r=>r.view==='linked-list'),s=t.structures.find(s=>s.id===r?.candidateId);
    assert.equal(s?.kind,'rooted-index-structure');assert.equal(s.root.objectId,object(t,root).id);
    assert.deepEqual(at(t,s,output(t,i)).orders[0].indices,expected);assert.equal(at(t,s,output(t,i)).orders[0].termination,'boundary');
  }
  if(name==='11_split_value_links'){
    const s=t.structures.find(s=>s.kind==='value-index-graph-candidate'&&s.objectId===object(t,'links').id),st=at(t,s,output(t,1));
    assert.ok(st.edges.some(e=>e.fromIndex===2&&e.toIndex===5));assert.ok(st.edges.some(e=>e.fromIndex===6&&e.toIndex===5));
  }
});

test('numeric coincidence creates no index root; linked FIFO is an observed policy',async()=>{
  const t=await run(await fixture('16_numeric_counterexample'),'S0 18\n');
  assert.ok(!t.structures.some(s=>s.kind==='rooted-index-structure'));
  const q=await run(await fixture('18_queue_on_links'),'S0 4 12\n'),r=recommend(q,'head').find(r=>r.view==='queue');
  assert.ok(r);const s=q.structures.find(s=>s.id===r.candidateId);assert.ok(s.endpointOperations.some(o=>o.kind==='remove'));
  assert.equal(at(q,s,output(q)).endpointPolicies[0].scope,'observed-episode');
});

test('endpoint identity policy separates FIFO, LIFO, deque, ambiguous singletons and bulk edits',()=>{
  const views=orders=>annotateLinkedPolicies({states:orders.map((nodeIds,i)=>({afterExecutionId:`x${i}`,rootAlive:true,
    orders:[{fieldNodeId:'role',nodeIds,termination:'null'}]}))}).states.at(-1).endpointPolicies.map(p=>p.view);
  assert.deepEqual(views([[],['a'],['a','b'],['b']]),['queue']);
  assert.deepEqual(views([[],['a'],['b','a'],['a']]),['stack']);
  assert.deepEqual(views([[],['a'],['a','b'],['c','a','b'],['c','a']]),['deque']);
  assert.deepEqual(views([[],['a'],[]]),[]);
  assert.deepEqual(views([[],['a','b','c'],['c','a','b'],['a','b']]),[]);
  assert.deepEqual(views([[],['a'],['a','b','c'],['b','c']]),[]);
});

test('a record-owned 64-bit integer seed follows bulk copying to an observed empty boundary',async()=>{
  const t=await run(`#include <stdio.h>
#include <string.h>
typedef struct{long long origin;int noise;} Owner;
int walk(int *v,long long *route,long long p){int sum=0;while(p>=0){sum+=v[p];p=route[p];}return sum;}
int main(void){int v[6]={2,2,2,2,2,2};long long route[6]={-7,-7,-7,-7,-7,-7};
route[4]=2;route[2]=1;Owner box={4,99};printf("%d\\n",walk(v,route,box.origin));
long long empty=-7;memcpy(&box.origin,&empty,sizeof empty);printf("%lld\\n",box.origin);return 0;}`,'6\n-7\n');
  const o=object(t,'box'),field=o.cType.members.find(f=>f.name==='origin'),range={objectId:o.id,offset:field.offsetBits/8,size:field.sizeBits/8};
  assert.equal(range.size,8);
  for(const [i,expected]of [[0,[4,2,1]],[1,[]]]){
    const r=recommend(t,'box',output(t,i),range).find(r=>r.view==='linked-list'),s=t.structures.find(s=>s.id===r?.candidateId);
    assert.equal(s?.root.objectId,o.id);assert.deepEqual(at(t,s,output(t,i)).orders[0].indices,expected);
    assert.equal(at(t,s,output(t,i)).orders[0].termination,'boundary');
  }
});

test('pointer slot width follows observed compiler types for either ABI',()=>{
  for(const bytes of [4,8]){
    const trace={objects:[{id:'owner',size:3*bytes,cType:{kind:'array',sizeBits:24*bytes}}],events:[
      {kind:'WRITE',target:{objectId:'owner',offset:bytes,size:bytes},value:{cType:{kind:'pointer',sizeBits:8*bytes}}}]};
    assert.deepEqual(structureRootRange({root:{kind:'pointer-slot',objectId:'owner',offset:bytes}},trace),{objectId:'owner',offset:bytes,size:bytes});
  }
});
