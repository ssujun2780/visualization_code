import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {executionCacheKey,readExecutionCache,writeExecutionCache} from './helpers/execution-cache.mjs';
import {cases} from './fixtures/priority-partition-range.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,recommendStructureViews,setStructurePresentation,resolveStructurePresentation,validateStructureTrace} from '../scripts/inference/index.mjs';
import {queryIndexRelations} from '../scripts/inference/index-relations.mjs';
import {queryDisjointSet} from '../scripts/inference/partition-views.mjs';
import {partitionStructures} from '../scripts/inference/partition-views.mjs';
import {queryRangeAggregate} from '../scripts/inference/range-aggregate-views.mjs';
const dir='test-results/priority-partition-range-2026-11-12',runs=new Map();
async function run(id,source,stdout,cached=false){
 await fs.mkdir(dir,{recursive:true});const folder='example/c/codex_code/priority_partition_range_20261112';await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(`${folder}/${id}.c`,source);const expected={stdout,sourceHash:crypto.createHash('sha256').update(source).digest('hex')};
 try{await fs.writeFile(`${dir}/${id}.expected.json`,JSON.stringify(expected,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(JSON.parse(await fs.readFile(`${dir}/${id}.expected.json`)),expected,'source expectation changed; review separately');}
 const options={filename:`${id}.c`,includeObservations:true},toolchain=await Promise.all(['clang.wasm.gz','wasm-ld.wasm.gz','clang-fs.tar.gz'].map(async n=>[n,crypto.createHash('sha256').update(await fs.readFile(`public/toolchain/${n}`)).digest('hex')])),cacheKey=await executionCacheKey(source,options,{toolchain});
 let r=cached?await readExecutionCache(`${dir}/${id}.cache.json`,cacheKey):null;
 r??=await traceModel(source,options);
 await writeExecutionCache(`${dir}/${id}.cache.json`,cacheKey,r);
 assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);
 const before=JSON.stringify(r),inference=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});assert.equal(JSON.stringify(r),before);
 assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));
 const view=createInferenceView(r,inference),result={...r,...view,inference};runs.set(id,result);
 if(!cached)await fs.writeFile(`${dir}/${id}.execution.json`,JSON.stringify(r));
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/${id}.checked.json`,JSON.stringify({stdout:r.stdout,inference}));return result;
}
const of=(r,kind)=>r.trace.structures.filter(s=>s.kind===kind),last=s=>s.states.at(-1),rec=(r,s,at)=>recommendStructureViews(r.trace,{target:{objectId:s.objectId},afterExecutionId:at});
test('source expectations: all ten original cases, exact identities, ranges, order and recommendation boundaries',async()=>{
 for(const c of cases){const r=await run(c.id,c.source,c.stdout,true);
  if(c.family==='heap'){const t=of(r,'index-tree').find(t=>t.descriptor.base===c.expected.base);assert.ok(t,c.id);assert.equal(t.descriptor.degree,c.expected.degree);
   const state=last(t);assert.equal(state.activeRange.count,c.expected.values.length);assert.equal(state[c.expected.order].status,'satisfied');
   const edges=queryIndexRelations(t,r.trace,{start:c.expected.base+1,limit:c.expected.values.length-1});
   assert.deepEqual(edges.map(e=>[e.parentIndex,e.childIndex,e.parent.value,e.child.value]),c.expected.values.slice(1).map((v,i)=>{
    const child=i+1,parent=Math.floor((child-1)/c.expected.degree);return [parent+c.expected.base,child+c.expected.base,String(c.expected.values[parent]),String(v)];}));
   assert.ok(rec(r,t).some(x=>x.view===`${c.expected.order}-heap`),c.id);
  }else if(c.family==='partition'){const [s]=of(r,'representative-partition-candidate');assert.ok(s);assert.deepEqual(last(s).nodes.map(n=>n.root),c.expected.roots);
   assert.deepEqual(last(s).groups.map(g=>g.members),c.expected.groups);assert.equal(last(s).status,'supported-observed');assert.ok(rec(r,s).some(x=>x.view==='disjoint-set'));
   assert.equal(queryDisjointSet(s,r.trace,{afterExecutionId:r.trace.events[0].eventId}),null);
  }else if(c.family==='range'){const [s]=of(r,'range-aggregate-candidate');assert.ok(s);const expectedView=c.id==='fenwick'?'fenwick-tree':'segment-tree';
   assert.equal(last(s).view,expectedView);const root=last(s).nodes.find(n=>n.coverage?.start===0&&n.coverage.end===4);assert.ok(root);assert.equal(root.value.decimal,String(c.expected.final));
   assert.ok(s.states.some(st=>st.nodes.some(n=>n.coverage?.start===0&&n.coverage.end===4&&n.value?.decimal===String(c.expected.initial))));
   assert.equal(last(s).status,'supported-observed');assert.ok(rec(r,s).some(x=>x.view===expectedView));
   assert.equal(queryRangeAggregate(s,r.trace,{afterExecutionId:r.trace.events[0].eventId}),null);
   if(c.id!=='fenwick')assert.ok(s.states.some(st=>st.status==='stale'),'partial propagation must stay visible');
  }else for(const a of of(r,'array'))assert.ok(!rec(r,a).some(x=>c.expected.absent.includes(x.view)),c.id);
 }
});
test('independent heap insertion oracle records the original prediction correction',()=>{
 function insertAll(values,d,min){const a=[];for(const v of values){let i=a.length;a.push(v);while(i){const p=Math.floor((i-1)/d);if(min?a[p]<=a[i]:a[p]>=a[i])break;[a[p],a[i]]=[a[i],a[p]];i=p;}}return a;}
 assert.deepEqual(insertAll([4,9,2,9],2,false),cases[0].expected.values);
 assert.deepEqual(insertAll([4,9,2,9],2,true),cases[1].expected.values);
 assert.deepEqual(insertAll([4,9,2,4,-1],3,true),cases[2].expected.values);
});
test('record fields and renamed representative helpers preserve DSU membership',async()=>{
 const r=await run('partition-record',String.raw`#include <stdio.h>
typedef struct {int payload,p;} Cell; Cell boxes[5];
int root_of(int k){if(boxes[k].p==k)return k;return boxes[k].p=root_of(boxes[k].p);}
void link_to(int x,int y){int a=root_of(x),b=root_of(y);if(a!=b)boxes[b].p=a;}
int main(void){for(int i=0;i<5;i++){boxes[i].payload=99;boxes[i].p=i;}link_to(2,4);link_to(1,3);link_to(2,1);for(int i=0;i<5;i++)printf("%d ",root_of(i));return 0;}`,'0 2 2 2 2 ');
 const s=of(r,'representative-partition-candidate').find(s=>s.fieldOffset===4);assert.ok(s);assert.equal(last(s).status,'supported-observed');assert.deepEqual(last(s).groups.map(g=>g.members),[[0],[1,2,3,4]]);
});
test('zero-based bit traversal uses actual operands and coverage, not one special spelling',async()=>{
 const r=await run('fenwick-zero',String.raw`#include <stdio.h>
int input[4]={2,3,4,5},store[4];
void push(int k,int d){for(;k<4;k=k|(k+1))store[k]+=d;}
int sum(int k){int z=0;while(k>=0){z+=store[k];k=(k&(k+1))-1;}return z;}
int main(void){for(int i=0;i<4;i++)push(i,input[i]);printf("%d ",sum(2));push(1,4);printf("%d ",sum(3));return 0;}`,'9 18 ');
 const [s]=of(r,'range-aggregate-candidate');assert.ok(s);assert.equal(last(s).view,'fenwick-tree');assert.ok(s.walkEvidence.some(p=>p.mode==='zero-based'));assert.equal(last(s).nodes.find(n=>n.index===3).value.decimal,'18');
});
test('inlined representative loops, repeated unions and a later cycle retain actual topology',async()=>{
 const r=await run('partition-inline',String.raw`#include <stdio.h>
int p[5]={0,1,2,3,4};int main(void){int pairs[3][2]={{1,2},{3,4},{1,3}};
for(int i=0;i<3;i++){int a=pairs[i][0],b=pairs[i][1];while(p[a]!=a)a=p[a];while(p[b]!=b)b=p[b];if(a!=b)p[b]=a;}
int a=2,b=4;while(p[a]!=a)a=p[a];while(p[b]!=b)b=p[b];if(a!=b)p[b]=a;
printf("%d %d ",a,b);p[1]=2;printf("%d ",p[1]);return 0;}`,'1 1 2 ');
 const s=of(r,'representative-partition-candidate').find(s=>s.operations.length);assert.ok(s);assert.equal(s.operations.filter(o=>o.kind==='merge').length,3);
 const at=r.trace.events.find(e=>e.action==='output').eventId,state=queryDisjointSet(s,r.trace,{afterExecutionId:at});
 assert.deepEqual(state.groups.map(g=>g.members),[[1,2,3,4]]); // 0 was initialized but never accessed: no invented member.
 assert.equal(state.status,'supported-observed');assert.equal(last(s).status,'contradicted');assert.ok(last(s).nodes.some(n=>n.cycle));
 assert.ok(!rec(r,s).some(x=>x.view==='disjoint-set'));
});
test('heap storage, changed payloads, literal leaf updates and deallocation retain range identity',async()=>{
 const r=await run('segment-heap',String.raw`#include <stdio.h>
#include <stdlib.h>
int main(void){int a[4]={-2,0,0,9};int *q=calloc(8,sizeof(int));if(!q)return 1;for(int i=0;i<4;i++)q[4+i]=a[i];for(int i=3;i;i--)q[i]=q[2*i]+q[2*i+1];printf("%d ",q[1]);q[6]=5;for(int i=3;i;i/=2)q[i]=q[2*i]+q[2*i+1];printf("%d ",q[1]);free(q);return 0;}`,'7 12 ');
 const [s]=of(r,'range-aggregate-candidate');assert.ok(s);assert.equal(last(s).status,'ended');const live=s.states.findLast(st=>st.alive);assert.equal(live.nodes.find(n=>n.index===1).value.decimal,'12');
 assert.deepEqual(live.nodes.find(n=>n.index===1).leaves.map(l=>l.index),[0,1,2,3]);assert.ok(!rec(r,s).some(x=>x.view==='segment-tree'));
});
test('bulk overwrite invalidates aggregation evidence and input coverage',async()=>{
 const r=await run('range-overwrite',String.raw`#include <stdio.h>
#include <string.h>
int a[4]={1,2,3,4},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);memset(v,0,sizeof(v));printf("%d ",v[1]);return 0;}`,'10 0 ');
 const [s]=of(r,'range-aggregate-candidate');assert.ok(s);assert.equal(last(s).status,'incomplete');assert.ok(!rec(r,s).some(x=>x.view==='segment-tree'));assert.ok(last(s).nodes.every(n=>!n.complete));
});
test('prefix sums and strides remain general relationships, not segment/Fenwick trees',async()=>{
 const r=await run('range-negative',String.raw`#include <stdio.h>
int a[4]={1,2,3,4},v[8],w[4];int main(void){int sum=0;for(int i=0;i<4;i++){sum+=a[i];w[i]=sum;v[2*i]=a[i];}printf("%d ",sum);return 0;}`,'10 ');
 for(const a of of(r,'array'))assert.ok(!rec(r,a).some(x=>['segment-tree','fenwick-tree','disjoint-set','min-heap','max-heap'].includes(x.view)));
});
test('bounded relation history is incomplete instead of reusing the final retained state',async()=>{
 const base=cases.find(c=>c.id==='partition-self'),r=runs.get(base.id)??await run(base.id,base.source,base.stdout,true),
  [s]=partitionStructures(r.plan,r.trace,{maxNodes:3,maxStates:3});assert.ok(s.coverage.truncated);
 assert.equal(queryDisjointSet(s,r.trace,{afterExecutionId:r.trace.events.at(-1).eventId}).status,'incomplete');
   // The current contract retains a prefix AND the latest snapshot. Only the
   // omitted interval is a history gap; node truncation is a separate limit.
   assert.equal(queryDisjointSet(s,r.trace,{afterExecutionId:s.coverage.historyGapFromExecutionId}).historyGap,true);
   assert.ok(!queryDisjointSet(s,r.trace,{afterExecutionId:r.trace.events.at(-1).eventId}).historyGap);
});
test('independent validation rejects changed membership, ranges, reads, values and future evidence; manual view stays first',async()=>{
 for(const id of ['partition-self','segment-recursive']){
  const r=runs.get(id)??await run(id,cases.find(c=>c.id===id).source,cases.find(c=>c.id===id).stdout,true),kind=id.startsWith('partition')?'representative-partition-candidate':'range-aggregate-candidate',s=of(r,kind)[0];
  for(const change of ['value','identity','future','relation']){const t=structuredClone(r.trace),x=t.structures.find(x=>x.id===s.id),st=last(x);
   if(change==='value'){if(kind.startsWith('representative'))st.nodes[0].value=777;else st.nodes[0].value.decimal='777';}
   if(change==='identity')st.nodes[0].range.offset+=4;
   if(change==='future')x.states[0].evidenceExecutionIds.push(r.trace.events.at(-1).eventId);
   if(change==='relation'){if(kind.startsWith('representative'))st.groups[0].members.pop();else st.nodes.find(n=>n.coverage).coverage.end++;}
   assert.throws(()=>validateStructureTrace(r.plan,t),`${id}:${change}`);
  }
  const preferences=setStructurePresentation(null,r.trace,{target:{objectId:s.objectId},view:'array'}),selected=resolveStructurePresentation(r.trace,{target:{objectId:s.objectId},preferences});
  assert.equal(selected.view,'array');assert.equal(selected.locked,true);assert.ok(selected.recommendations.length<=5);
 }
});
