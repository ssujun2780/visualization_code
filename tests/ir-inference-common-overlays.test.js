import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recommendStructureViews,inferStructures} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertNestedLists} from './helpers/nested-link-contract.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function inspect(name,source,stdout){
  const r=await traceModel(source,{filename:name+'.c'});
  if(process.env.MODEL_INFERENCE_RESULTS){const dir=path.resolve(process.env.MODEL_INFERENCE_RESULTS,name);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'source.c'),source);await fs.writeFile(path.join(dir,'prediction.json'),JSON.stringify({stdout}));
    await fs.writeFile(path.join(dir,'trace.json'),JSON.stringify(r.trace));await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(r.plan));}
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.coverage.irGaps??[],[]);assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  const before=hash({plan:r.plan,trace:r.trace});inferStructures(r.plan,r.trace);assert.equal(hash({plan:r.plan,trace:r.trace}),before);
  return r.trace;
}
const output=t=>t.events.filter(e=>e.action==='output');
const state=(s,t,event=output(t).at(-1).eventId)=>{const pos=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(s=>pos.get(s.afterExecutionId)<=pos.get(event));};
const recommend=(t,name,event=output(t).at(-1).eventId)=>recommendStructureViews(t,{target:{objectId:t.objects.find(o=>o.name===name).id},afterExecutionId:event});

test('renamed parent records produce a reversed view without rewriting physical edges',async()=>{
  const t=await inspect('parent-record-permutation',`#include <stdio.h>
typedef struct{int cache,data,route;}Q;
int main(void){Q v[5]={{87,1,2},{87,2,2},{87,3,-7},{87,4,0},{87,5,0}};int n=0;
for(int j=0;j<5;j++)for(int k=j;k!=-7;k=v[k].route)n++;printf("%d\\n",n);return 0;}`,'11\n');
  const s=t.structures.find(s=>s.kind==='record-index-graph-candidate'),now=state(s,t),p=now.parentRoleTopologies[0];
  assert.ok(p);assert.equal(p.topology.roots.length,1);assert.equal(p.topology.edgeCount,4);assert.ok(now.edges.some(e=>e.fromIndex===0&&e.toIndex===2));
  assert.ok(recommend(t,'v').some(r=>r.view==='tree'));
});

test('row links use moved columns and sparse identities; overwrite invalidates the old edge',async()=>{
  const t=await inspect('row-links-permutation',`#include <stdio.h>
int main(void){int x[8][5]={{0}};x[6][4]=2;x[2][4]=5;x[5][4]=-9;x[6][0]=9;x[2][0]=8;x[5][0]=7;
int sum=0;for(int p=6;p!=-9;p=x[p][4])sum+=x[p][0];printf("%d\\n",sum);x[2][4]=2;printf("%d\\n",sum);return 0;}`,'24\n24\n');
  const s=t.structures.find(s=>s.kind==='table-row-graph-candidate'),first=state(s,t,output(t)[0].eventId),last=state(s,t);
  assert.deepEqual(first.nodes.map(n=>n.index),[2,5,6]);assert.equal(first.topology.complete,true);assert.equal(recommend(t,'x',output(t)[0].eventId)[0].view,'linked-list');
  assert.ok(last.edges.some(e=>e.source?.offset===2*20+16&&e.status==='unknown'&&e.to===null));
});

test('ordinary table values do not become row links and embedded arrays stay recommendable',async()=>{
  const t=await inspect('table-decoy-embedded',`#include <stdio.h>
typedef struct{int cache;int data[4];}B;
int main(void){int x[2][3]={{0,1,2},{1,0,2}},s=0;B b={99,{4,3,2,1}};
for(int i=0;i<2;i++)for(int j=0;j<3;j++)s+=x[i][j];for(int i=0;i<4;i++)s+=b.data[i];printf("%d\\n",s);return 0;}`,'16\n');
  assert.ok(!t.structures.some(s=>s.kind==='table-row-graph-candidate'));assert.equal(recommend(t,'b')[0].view,'array');
  const a=t.structures.find(s=>s.kind==='array'&&s.storageEvidence?.kind==='embedded-array');assert.equal(a.range.size,16);assert.equal(a.range.offset,4);
});

test('counted adjacency ignores capacity and expires on a changed count',async()=>{
  const t=await inspect('counted-adjacency-permutation',`#include <stdio.h>
typedef struct{int spare,used,value,to[5];}V;
int main(void){V a[3]={0};a[0].value=2;a[1].value=3;a[2].value=5;a[0].to[0]=1;a[0].to[1]=2;a[1].to[0]=2;a[0].used=2;a[1].used=1;
int sum=0;for(int u=0;u<3;u++)for(int j=0;j<a[u].used;j++){int k=a[u].to[j];sum+=a[k].value;}
printf("%d\\n",sum);a[0].used=3;printf("%d\\n",sum);return 0;}`,'13\n13\n');
  const s=t.structures.find(s=>s.kind==='record-index-graph-candidate'),first=state(s,t,output(t)[0].eventId),last=state(s,t);
  assert.equal(first.edges.length,15);assert.equal(first.inactiveEdgeIds.length,12);assert.equal(first.logicalTopology.complete,true);
  assert.equal(first.logicalTopology.edgeCount,3);assert.equal(last.logicalTopology.complete,false);assert.equal(last.prefixMembership.length,2);
});

test('early exit is not evidence for a complete active prefix',async()=>{
  const t=await inspect('counted-early-exit',`#include <stdio.h>
typedef struct{int e[4],n,v;}R;
int main(void){R a[3]={{{1,2},2,5},{{0},0,7},{{0},0,9}};int z=0;
for(int u=0;u<3;u++)for(int j=0;j<a[u].n;j++){z+=a[a[u].e[j]].v;break;}printf("%d\\n",z);return 0;}`,'7\n');
  const s=t.structures.find(s=>s.kind==='record-index-graph-candidate');assert.ok(s);assert.ok(!state(s,t).logicalTopology?.complete);
  assert.ok(!s.prefixMembershipEvidence.some(p=>p.count===2));
});

function queueSource(eager=false){return `#include <stdio.h>
typedef struct{int b[6],m,a[6],n;}Q;
void put(Q*q,int x){q->a[q->n]=x;q->n+=1;}
int take(Q*q){${eager?'':'if(q->m==0)'}while(q->n){q->n-=1;q->b[q->m]=q->a[q->n];q->m+=1;}q->m-=1;return q->b[q->m];}
int main(void){Q q={0};put(&q,5);put(&q,5);put(&q,5);printf("%d\\n",q.n);int a=take(&q);printf("%d\\n",a);put(&q,5);int b=take(&q);printf("%d\\n",b);return 0;}`;}
test('two stacks compose by token provenance with separate counter updates and equal payloads',async()=>{
  const t=await inspect('two-stack-separated',queueSource(),'3\n5\n5\n');
  assert.ok(!recommend(t,'q',output(t)[0].eventId).some(r=>r.view==='queue'));assert.equal(recommend(t,'q')[0].view,'queue');
  const s=t.structures.find(s=>s.kind==='composed-container-candidate');assert.equal(s.transfers.length,3);assert.equal(state(s,t).logicalOrder.length,2);
  assert.equal(state(s,t).status,'supported');
});
test('equal numbers cannot hide an order contradiction in a composed queue',async()=>{
  const t=await inspect('two-stack-order-contradiction',queueSource(true),'3\n5\n5\n');
  const s=t.structures.find(s=>s.kind==='composed-container-candidate');assert.ok(s);assert.equal(state(s,t).status,'contradicted');
  assert.ok(!recommend(t,'q').some(r=>r.view==='queue'));
});

test('unexplained backing-array writes invalidate a previously supported queue',async()=>{
  const source=queueSource().replace('int b=take(&q);','int b=take(&q);q.b[0]=17;');
  const t=await inspect('two-stack-storage-overwrite',source,'3\n5\n5\n'),s=t.structures.find(s=>s.kind==='composed-container-candidate');
  assert.equal(state(s,t).status,'contradicted');assert.equal(s.invalidatingExecutionIds.length,1);
  assert.ok(!recommend(t,'q').some(r=>r.view==='queue'));
});

test('nested lists need no reverse owner read and retain both inner lists',async()=>{
  const t=await inspect('nested-no-backlink',`#include <stdio.h>
typedef struct A A;struct A{A*link;int value;};typedef struct B{int cache;A*items;struct B*link;}B;
int main(void){A a[4]={{a+1,1},{0,2},{a+3,3},{0,4}};B b[2]={{77,a,b+1},{77,a+2,0}};int n=0;
for(B*p=b;p;p=p->link)for(A*q=p->items;q;q=q->link)n+=q->value;printf("%d\\n",n);return 0;}`,'10\n');
  assertNestedLists(t,output(t).at(-1).eventId,{outer:'b',inner:'a',outerLink:'link',innerLink:'link',entry:'items',
    outerOrder:[0,1],groups:[{outerIndex:0,innerIndices:[0,1]},{outerIndex:1,innerIndices:[2,3]}]});
  assert.equal(recommend(t,'b')[0].view,'nested-containers');
  assert.ok(t.structures.some(s=>s.kind==='linked-structure'));
});

test('heterogeneous edge records preserve vertices, edge identity and storage',async()=>{
  const t=await inspect('heterogeneous-permutation',`#include <stdio.h>
typedef struct V V;typedef struct E E;struct E{E*link;int w;V*to;};struct V{E*items;int value;};
int main(void){V a[3]={{0,1},{0,2},{0,3}};E b[3]={{0,0,a+1},{0,0,a+2},{0,0,a}};for(int i=0;i<3;i++)a[i].items=b+i;
int s=0;for(int i=0;i<3;i++)for(E*p=a[i].items;p;p=p->link)s+=p->to->value;printf("%d\\n",s);return 0;}`,'6\n');
  const s=t.structures.find(s=>s.kind==='composed-reference-candidate'),now=state(s,t);assert.equal(now.nodes.length,3);assert.equal(now.edges.length,3);
  assert.ok(now.edges.every(e=>e.viaRange&&e.viaNodeId));assert.equal(recommend(t,'a')[0].view,'graph');
});
