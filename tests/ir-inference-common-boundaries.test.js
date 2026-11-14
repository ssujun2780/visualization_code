import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {recommendStructureViews,resolveStructurePresentation,setStructurePresentation} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {queryCoindexedRecords} from '../scripts/inference/coindexed-record-views.mjs';
import {indexDomainStructures} from '../scripts/inference/index-domain-views.mjs';
async function run(name,source,stdout){
  const r=await traceModel(source,{filename:name+'.c'});
  if(process.env.MODEL_INFERENCE_RESULTS){const dir=path.resolve(process.env.MODEL_INFERENCE_RESULTS,name);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'source.c'),source);await fs.writeFile(path.join(dir,'prediction.json'),JSON.stringify({stdout}));
    await fs.writeFile(path.join(dir,'trace.json'),JSON.stringify(r.trace));await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(r.plan));}
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.coverage.irGaps??[],[]);return r;
}
const outputs=t=>t.events.filter(e=>e.action==='output');
const recommend=(t,name,at=outputs(t).at(-1).eventId)=>recommendStructureViews(t,{target:{objectId:t.objects.find(o=>o.name===name).id},afterExecutionId:at});
const liveAt=(s,t,at)=>{const pos=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(s=>pos.get(s.afterExecutionId)<=pos.get(at));};

test('relation coverage stays stable under repeated reads and preserves explicit projections',async()=>{
  const {trace:t}=await run('role-coverage',`#include <stdio.h>
typedef struct N{int v;struct N*c[3];}N;int sum(N*p){int n=p->v;for(int j=0;j<3;j++)if(p->c[j])n+=sum(p->c[j]);return n;}
int main(void){N a[4]={{2,{0}},{3,{0}},{5,{0}},{7,{0}}};N*root=a;for(int j=0;j<3;j++)a[0].c[j]=a+j+1;for(int k=0;k<5;k++)printf("%d\\n",sum(root));return 0;}`, '17\n'.repeat(5));
  for(const out of outputs(t)){const rec=recommend(t,'root',out.eventId);assert.equal(rec[0].view,'tree');assert.equal(rec[0].roleIds.length,3);
    assert.ok(rec.find(c=>c.view==='binary-tree')?.coverage.excludedRoleIds.length);}
  const target={objectId:t.objects.find(o=>o.name==='root').id},preferences=setStructurePresentation(null,t,{target,view:'graph'});
  assert.equal(resolveStructurePresentation(t,{target,afterExecutionId:outputs(t)[0].eventId,preferences}).view,'graph');
});

test('record fields, embedded slots and explicit work stacks share observed tree relations',async()=>{
  for(const embedded of [false,true]){
    const fields=embedded?'int z,c[2];':'int z,l,r;',left=embedded?'c[0]':'l',right=embedded?'c[1]':'r';
    const {trace:t}=await run('record-'+embedded,`#include <stdio.h>
typedef struct{${fields}}R;R q[4]={${embedded?'{3,{1,2}},{5,{-1,-1}},{7,{-1,-1}}':'{3,1,2},{5,-1,-1},{7,-1,-1}'}};
int f(int k){if(k<0)return 0;return q[k].z+f(q[k].${left})+f(q[k].${right});}int main(void){printf("%d\\n",f(0));return 0;}`, '15\n');
    const rec=recommend(t,'q');assert.equal(rec[0].view,'binary-tree');
    const s=t.structures.find(s=>s.kind==='record-index-graph-candidate'),state=liveAt(s,t,outputs(t)[0].eventId);
    assert.equal(state.length,null);assert.equal(state.capacity,4);assert.deepEqual(state.topology.visitedIndices,[0,1,2]);assert.equal(state.topology.complete,true);
  }
  const {trace:t}=await run('split-work-stack',`#include <stdio.h>
int main(void){int v[4]={2,3,5},a[4]={1,-1,-1},b[4]={2,-1,-1},s[8],n=0,z=0;s[n++]=0;while(n){int k=s[--n];z+=v[k];if(a[k]>=0)s[n++]=a[k];if(b[k]>=0)s[n++]=b[k];}printf("%d\\n",z);return 0;}`, '10\n');
  assert.equal(recommend(t,'a')[0].view,'binary-tree');
  const group=t.structures.find(s=>s.kind==='coindexed-record-candidate'&&s.arrays.length===3);
  const state=queryCoindexedRecords(group,t,{afterExecutionId:outputs(t)[0].eventId});assert.equal(state.topology.complete,true);assert.deepEqual(state.topology.includedIndices,[0,1,2]);
});

test('in-range zero boundaries require observed traversal guards',async()=>{
  const {trace:t}=await run('zero-boundary',`#include <stdio.h>
int v[5]={99,3,5,7},l[5]={0,2,0,0},r[5]={0,3,0,0};int f(int k){if(k==0)return 0;return v[k]+f(l[k])+f(r[k]);}
int main(void){printf("%d\\n",f(1));return 0;}`, '15\n');
  assert.equal(recommend(t,'l')[0].view,'binary-tree');
  const g=t.structures.find(s=>s.kind==='coindexed-record-candidate'&&s.arrays.length===3),snapshot=queryCoindexedRecords(g,t,{afterExecutionId:outputs(t)[0].eventId});
  assert.deepEqual(snapshot.topology.includedIndices,[1,2,3]);assert.ok(snapshot.edges.some(e=>e.status==='observed-termination'));
  const decoy=await run('zero-payload',`#include <stdio.h>
int main(void){int a[3]={0,1,2},s=0;for(int i=0;i<3;i++)if(a[i]==0)s++;printf("%d\\n",s);return 0;}`, '1\n');
  assert.ok(!recommend(decoy.trace,'a').some(r=>['tree','forest'].includes(r.view)));
});

test('pointer boxes resolve the current matrix allocation without reviving previous storage',async()=>{
  const {trace:t}=await run('matrix-binding',`#include <stdio.h>
#include <stdlib.h>
int main(void){int(*p)[3]=calloc(2,sizeof *p);if(!p)return 1;p[1][2]=7;printf("%d\\n",p[1][2]);free(p);p=calloc(4,sizeof *p);if(!p)return 1;p[3][2]=9;printf("%d\\n",p[3][2]);free(p);return 0;}`, '7\n9\n');
  const selections=outputs(t).map(e=>recommend(t,'p',e.eventId)[0]);assert.ok(selections.every(r=>r.view==='grid'));assert.notEqual(selections[0].candidateId,selections[1].candidateId);
  assert.ok(!recommend(t,'p',t.events.at(-1).eventId).some(r=>r.candidateId===selections[0].candidateId));
});

test('fixed and pointer-backed FIFO containers accept derived and separately advanced tail positions',async()=>{
  for(const heap of [false,true])for(const tail of [false,true]){
    const source=`#include <stdio.h>
#include <stdlib.h>
typedef struct{${heap?'int*d;':'int d[4];'}int h,t,n;}Q;
void put(Q*q,int v){q->d[${tail?'q->t':'(q->h+q->n)%4'}]=v;${tail?'q->t=(q->t+1)%4;':''}q->n++;}
int take(Q*q){int v=q->d[q->h];q->h=(q->h+1)%4;q->n--;return v;}
int main(void){Q z={0};${heap?'z.d=calloc(4,sizeof *z.d);if(!z.d)return 1;':''}put(&z,2);put(&z,3);put(&z,5);int s=take(&z);put(&z,7);s+=take(&z);put(&z,11);while(z.n)s+=take(&z);printf("%d\\n",s);${heap?'free(z.d);':''}return 0;}`;
    const {trace:t}=await run(`fifo-${heap}-${tail}`,source,'28\n');assert.equal(recommend(t,'z')[0].view,'queue');
    const q=t.structures.find(s=>s.kind==='array-structure'&&s.roleCandidates.includes('fifo'));assert.ok(q);assert.equal(q.latestValidState.length,0);
    if(heap)assert.notEqual(q.range.objectId,q.ownerObjectId);
  }
});

test('inline multi-access heap operations separate occupied size from capacity',async()=>{
  const {trace:t}=await run('heap-membership',`#include <stdio.h>
int main(void){int q[9],n=0,in[4]={8,2,5,1};for(int k=0;k<4;k++){int i=n++;q[i]=in[k];while(i){int p=(i-1)/2;if(q[p]<=q[i])break;int v=q[p];q[p]=q[i];q[i]=v;i=p;}}printf("%d %d\\n",n,q[0]);int s=0;while(n){s+=q[0];q[0]=q[--n];int i=0;while(2*i+1<n){int j=2*i+1;if(j+1<n&&q[j+1]<q[j])j++;if(q[i]<=q[j])break;int v=q[i];q[i]=q[j];q[j]=v;i=j;}}printf("%d\\n",s);return 0;}`, '4 1\n16\n');
  const tree=t.structures.find(s=>s.kind==='index-tree'),a=liveAt(tree,t,outputs(t)[0].eventId),b=liveAt(tree,t,outputs(t)[1].eventId);
  assert.equal(tree.capacity,9);assert.equal(a.activeRange.count,4);assert.equal(a.checkedEdges,3);assert.equal(a.min.status,'satisfied');assert.equal(b.activeRange.count,0);assert.equal(b.checkedEdges,0);
});

test('compressed and record edge domains preserve zero properties and exact endpoint pairs',async()=>{
  for(const record of [false,true]){
    const init=record?'typedef struct{int a,b,w;}E;E e[3]={{0,1,0},{0,2,6},{1,2,3}};':'int o[4]={0,2,3,3},to[3]={1,2,2},w[3]={0,6,3};';
    const loop=record?'for(int k=0;k<3;k++)if(d[e[k].a]<99&&d[e[k].b]>d[e[k].a]+e[k].w)d[e[k].b]=d[e[k].a]+e[k].w;':'for(int u=0;u<3;u++)for(int k=o[u];k<o[u+1];k++)if(d[to[k]]>d[u]+w[k])d[to[k]]=d[u]+w[k];';
    const r=await run('edge-domain-'+record,`#include <stdio.h>\n${init}int main(void){int d[3]={0,99,99};for(int p=0;p<3;p++){${loop}}printf("%d %d %d\\n",d[0],d[1],d[2]);return 0;}`,'0 0 3\n');
    const g=r.trace.structures.find(s=>s.kind==='index-domain-graph-candidate');assert.ok(g);const state=liveAt(g,r.trace,outputs(r.trace)[0].eventId);
    assert.deepEqual(state.edges.map(e=>[e.fromIndex,e.toIndex]).sort(),[[0,1],[0,2],[1,2]]);assert.ok(state.edges.some(e=>e.properties.some(p=>p.value?.decimal==='0')));
    const before=JSON.stringify(r.trace);indexDomainStructures(r.plan,r.trace);assert.equal(JSON.stringify(r.trace),before);
    const limited=indexDomainStructures(r.plan,r.trace,{maxEvidence:4,maxEdges:2,maxStates:2})[0];assert.ok(limited.coverage.omittedEvidence>0);assert.ok(limited.states.length<=2);assert.ok(limited.states.every(s=>s.edges.length<=2));
    assert.equal(recommend(r.trace,record?'e':'to')[0].view,'graph');
  }
  const r=await run('equal-number-decoy',`#include <stdio.h>\nint main(void){int a[3]={1,2,0},b[3]={2,0,1};int s=0;for(int i=0;i<3;i++)s+=a[i]+b[i];printf("%d\\n",s);return 0;}`,'6\n');
  assert.equal(r.trace.structures.filter(s=>s.kind==='index-domain-graph-candidate').length,0);
});

test('linked edge records bind logical graphs to head storage and invalidate changed links',async()=>{
  const r=await run('linked-edge-domain',`#include <stdio.h>
typedef struct E{int v,w;struct E*next;}E;
int main(void){E a[3]={{1,0,0},{2,6,0},{2,3,0}};a[0].next=a+1;E*heads[3]={a,a+2,0};int d[3]={0,99,99};
for(int pass=0;pass<3;pass++)for(int u=0;u<3;u++)for(E*p=heads[u];p;p=p->next)if(d[p->v]>d[u]+p->w)d[p->v]=d[u]+p->w;
printf("%d %d %d\\n",d[0],d[1],d[2]);a[0].next=0;printf("changed\\n");return 0;}`, '0 0 3\nchanged\n');
  assert.equal(recommend(r.trace,'heads',outputs(r.trace)[0].eventId)[0].view,'graph');
  const g=r.trace.structures.find(s=>s.kind==='index-domain-graph-candidate');assert.ok(g.evidence.some(e=>e.rootBindings.length));
  assert.ok(liveAt(g,r.trace,outputs(r.trace)[1].eventId).edges.some(e=>e.status==='unconfirmed-after-write'));
});

test('distinct endpoint fields retain an observed self edge, not a duplicate operand read',async()=>{
  const r=await run('self-edge-domain',`#include <stdio.h>
typedef struct{int u,v,w;}E;int main(void){E e[2]={{0,0,0},{0,1,2}};int d[2]={0,9};
for(int k=0;k<2;k++)if(d[e[k].v]>d[e[k].u]+e[k].w)d[e[k].v]=d[e[k].u]+e[k].w;
printf("%d\\n",d[1]);return 0;}`, '2\n');
  const g=r.trace.structures.find(s=>s.kind==='index-domain-graph-candidate');
  assert.deepEqual(liveAt(g,r.trace,outputs(r.trace)[0].eventId).edges.map(e=>[e.fromIndex,e.toIndex]),[[0,0],[0,1]]);
});
