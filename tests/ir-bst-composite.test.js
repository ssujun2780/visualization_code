import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {inferStructures,queryBSTOrder,recommendStructureViews} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {validateBSTOverlays} from '../scripts/inference/bst-contract.mjs';
import {comparisonDiagram,inferLexicographicOrder} from '../scripts/inference/bst-key-order.mjs';

async function run(label,source,stdout){
  source='#include <stdio.h>\n'+source;
  const folder=process.env.BST_AUDIT_DIR&&`${process.env.BST_AUDIT_DIR}/${label}`;
  if(folder){await fs.mkdir(folder,{recursive:true});await fs.writeFile(`${folder}/source.c`,source);
    await fs.writeFile(`${folder}/expected.json`,JSON.stringify({stdout,basis:'Assertions below were written from source before execution'}));}
  const r=await traceModel(source,{filename:`${label}.c`});
  if(folder)for(const [name,data]of Object.entries({plan:r.plan,trace:r.trace,inference:r.inference}))await fs.writeFile(`${folder}/${name}.json`,JSON.stringify(data));
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  const before=JSON.stringify({plan:r.plan,trace:r.trace});
  assert.equal(inferStructures(r.plan,r.trace).status,'completed');assert.equal(JSON.stringify({plan:r.plan,trace:r.trace}),before);
  return {...r.trace,structures:r.inference.structures};
}
const at=(t,label)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId;
const target=t=>({objectId:t.objects.find(o=>o.name==='seed').id});
const check=(t,label)=>queryBSTOrder(t,{target:target(t),afterExecutionId:at(t,label)});
const fixture=compare=>`typedef struct N{int noise,z;struct N*lo;int x;struct N*hi;int y;}N;
${compare}
int find(N*p,int a,int b,int c){while(p){int r=compare(a,b,c,p);if(r==0)return 1;p=r<0?p->lo:p->hi;}return 0;}
int walk(N*p){return p?1+walk(p->lo)+walk(p->hi):0;}
int main(void){N v[4]={{70,10,0,2,0,5},{-90,0,0,1,0,9},{500,12,0,2,0,5},{3,7,0,2,0,5}};
v[0].lo=v+1;v[0].hi=v+2;v[1].hi=v+3;N*seed=v;
printf("A %d\\n",walk(seed)+find(seed,2,5,7)+find(seed,2,5,12)+find(seed,2,4,0)+find(seed,2,6,0));
v[3].noise=-500;printf("B %d\\n",walk(seed)+find(seed,2,5,7));
v[3].z=11;printf("C %d\\n",walk(seed));
v[3].z=7;printf("D %d\\n",walk(seed)+find(seed,2,5,7));return 0;}`;

for(const [label,compare]of [
  ['early_returns','int compare(int a,int b,int c,N*p){if(a<p->x)return -1;if(a>p->x)return 1;if(b>p->y)return -1;if(b<p->y)return 1;return (c>p->z)-(c<p->z);}'],
  ['nested_if','int compare(int a,int b,int c,N*p){if(a==p->x){if(b==p->y)return (c>p->z)-(c<p->z);return (b<p->y)-(b>p->y);}return (a>p->x)-(a<p->x);}'],
  ['nested_ternary','int compare(int a,int b,int c,N*p){return a!=p->x?(a<p->x?-1:1):b!=p->y?(b>p->y?-1:1):(c>p->z)-(c<p->z);}'],
  ['logical_helper','int less(int a,int b,int c,N*p){return a<p->x||(a==p->x&&(b>p->y||(b==p->y&&c<p->z)));} int compare(int a,int b,int c,N*p){if(a==p->x&&b==p->y&&c==p->z)return 0;return less(a,b,c,p)?-1:1;}']
])test(`three reordered components, mixed direction, cache write, ancestor violation: ${label}`,async()=>{
  const t=await run(label,fixture(compare),'A 6\nB 5\nC 4\nD 5\n');
  for(const marker of ['A','B','D'])assert.equal(check(t,marker).assessment,'satisfied-observed',`${label} ${marker}`);
  const c=check(t,'A').candidates.find(c=>c.key.kind==='composite');assert.ok(c);
  assert.deepEqual(c.state.keyOrder.map(o=>[c.key.components[o.index].offset,o.direction]),[[12,1],[20,-1],[4,1]]);
  assert.equal(c.state.nodes.length,4);assert.equal(c.state.edges.length,3);
  const bad=check(t,'C');assert.equal(bad.assessment,'contradicted');
  assert.ok(!recommendStructureViews(t,{target:target(t),afterExecutionId:at(t,'C')}).some(r=>r.view==='bst'));
  assert.ok(bad.warnings.some(w=>w.path.length===3&&w.value[w.componentIndex]==='11'&&w.bound[w.componentIndex]==='10'));
  const corrupted=structuredClone(t),overlay=corrupted.structures.find(s=>s.id===c.candidateId);
  const state=overlay.states.find(s=>s.status==='violated');state.violations[0].componentIndex=0;
  assert.throws(()=>validateBSTOverlays(corrupted),/decisive component/);
});

test('split storage arrays with nonzero root and negative null sentinel',async()=>{
  const t=await run('split_storage',`int x[4]={2,1,2,2},y[4]={1,9,8,5},west[4]={-9,-9,-9,1},east[4]={-9,0,-9,2};
int compare(int a,int b,int k){if(a<x[k])return -1;if(a>x[k])return 1;return (b>y[k])-(b<y[k]);}
int find(int k,int a,int b){while(k>=0){int c=compare(a,b,k);if(c==0)return 1;k=c<0?west[k]:east[k];}return 0;}
int walk(int k){return k<0?0:1+walk(west[k])+walk(east[k]);}
int main(void){int seed=3;printf("A %d\\n",walk(seed)+find(seed,2,1)+find(seed,2,8));
y[0]=6;printf("B %d\\n",walk(seed));return 0;}`,'A 6\nB 4\n');
  assert.equal(check(t,'A').assessment,'satisfied-observed');assert.equal(check(t,'B').assessment,'contradicted');
  assert.ok(check(t,'A').candidates.some(c=>c.key.components?.every(k=>k.kind==='array')));
});

test('component-wise conjunction is not lexicographic even when the current values happen to be sorted',async()=>{
  const t=await run('nonlex_and',`typedef struct N{int a,b;struct N*l,*r;}N;
int walk(N*p){return p?1+walk(p->l)+walk(p->r):0;}
int find(N*p,int a,int b){while(p){if(a==p->a&&b==p->b)return 1;p=a<p->a&&b<p->b?p->l:p->r;}return 0;}
int main(void){N v[3]={{10,10,0,0},{5,5,0,0},{15,15,0,0}};v[0].l=v+1;v[0].r=v+2;N*seed=v;
printf("A %d\\n",walk(seed)+find(seed,5,5)+find(seed,15,15)+find(seed,1,20)+find(seed,20,1));return 0;}`,'A 5\n');
  assert.notEqual(check(t,'A').assessment,'satisfied-observed');
  assert.ok(!recommendStructureViews(t,{target:target(t),afterExecutionId:at(t,'A')}).some(r=>r.view==='bst'));
});

for(const copied of [false,true])test(`composite insertion distinguishes full equality from equal prefixes and checks strict ancestor bounds${copied?' through argument copies':''}`,async()=>{
  const t=await run(copied?'duplicate_arguments':'duplicates',`typedef struct{int x,y,l,r;}N;
N n[5]={{2,5,-1,-1},{1,9,-1,-1},{2,8,-1,-1},{2,1,-1,-1},{2,5,-1,-1}};
${copied?'int cmp(int a,int b,int c,int d){if(a<c)return -1;if(a>c)return 1;return (b>d)-(b<d);} int compare(int q,int p){return cmp(n[q].x,n[q].y,n[p].x,n[p].y);}':
'int compare(int q,int p){if(n[q].x<n[p].x)return -1;if(n[q].x>n[p].x)return 1;return (n[q].y>n[p].y)-(n[q].y<n[p].y);}'}
void put(int p,int q){while(1){int c=compare(q,p);if(c<0){if(n[p].l>=0)p=n[p].l;else{n[p].l=q;return;}}
else{if(n[p].r>=0)p=n[p].r;else{n[p].r=q;return;}}}}
int walk(int p){return p<0?0:1+walk(n[p].l)+walk(n[p].r);}
int main(void){int seed=0;put(seed,1);put(seed,2);put(seed,3);put(seed,4);printf("A %d\\n",walk(seed));
n[3].y=5;printf("B %d\\n",walk(seed));return 0;}`,'A 5\nB 5\n');
  const ok=check(t,'A');assert.equal(ok.assessment,'satisfied-observed');
  assert.ok(ok.candidates.some(c=>c.state.contracts.some(p=>p.direction==='greater'&&p.duplicates==='observed-allowed')));
  const bad=check(t,'B');assert.equal(bad.assessment,'contradicted');
  assert.ok(bad.warnings.some(w=>w.componentIndex===null&&w.path.length===3&&JSON.stringify(w.value)===JSON.stringify(w.bound)));
});

test('equal prefixes alone do not establish the unobserved leading component direction',async()=>{
  const t=await run('equality_only',`typedef struct N{int a,b;struct N*l,*r;}N;
int compare(int a,int b,N*p){if(a<p->a)return -1;if(a>p->a)return 1;return (b>p->b)-(b<p->b);}
int find(N*p,int a,int b){while(p){int c=compare(a,b,p);if(!c)return 1;p=c<0?p->l:p->r;}return 0;}
int walk(N*p){return p?1+walk(p->l)+walk(p->r):0;}
int main(void){N n[3]={{2,5,0,0},{2,1,0,0},{2,9,0,0}};n[0].l=n+1;n[0].r=n+2;N*seed=n;
printf("A %d\\n",walk(seed)+find(seed,2,1)+find(seed,2,9));return 0;}`,'A 5\n');
  assert.equal(check(t,'A').assessment,'not-checkable');
  assert.ok(check(t,'A').candidates.some(c=>c.key.kind==='composite'));
});

test('independent signedness and exact wide integer components',async()=>{
  const t=await run('wide_components',`typedef struct N{unsigned long long a;int b;struct N*l,*r;}N;
int compare(unsigned long long a,int b,N*p){if(a<p->a)return -1;if(a>p->a)return 1;return (b>p->b)-(b<p->b);}
int find(N*p,unsigned long long a,int b){while(p){int c=compare(a,b,p);if(!c)return 1;p=c<0?p->l:p->r;}return 0;}
int walk(N*p){return p?1+walk(p->l)+walk(p->r):0;}
int main(void){N n[4]={{9007199254740993ULL,-2,0,0},{9007199254740992ULL,50,0,0},{9007199254740993ULL,-1,0,0},{9007199254740993ULL,-3,0,0}};
n[0].l=n+1;n[0].r=n+2;n[1].r=n+3;N*seed=n;
printf("A %d\\n",walk(seed)+find(seed,n[3].a,n[3].b)+find(seed,n[2].a,n[2].b));
n[3].b=0;printf("B %d\\n",walk(seed));return 0;}`,'A 6\nB 4\n');
  assert.equal(check(t,'A').assessment,'satisfied-observed');const c=check(t,'A').candidates[0];
  assert.deepEqual(c.key.components.map(k=>k.cType.signedness),['unsigned','signed']);
  assert.equal(check(t,'B').assessment,'contradicted');
  assert.ok(check(t,'B').warnings.some(w=>w.value[0]==='9007199254740993'&&w.value[1]==='0'&&w.bound[1]==='-2'));
});

test('symbolic comparison handles many components and rejects equality-only evidence',()=>{
  const d=comparisonDiagram();let route=d.unknown;
  for(let i=19;i>=0;i--)route=d.operation('?:',[d.variable(i),d.variable(i),route]);
  assert.deepEqual(inferLexicographicOrder(d,route,Array.from({length:20},(_,i)=>i)),Array.from({length:20},(_,index)=>({index,direction:1})));
  const partial=d.operation('?:',[d.operation('==',[d.variable(0),d.constant(0n)]),d.variable(1),d.unknown]);
  assert.equal(inferLexicographicOrder(d,partial,[0,1]),null);
  assert.ok(d.size()<8192);
});
