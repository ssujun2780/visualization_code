import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inferStructures,recommendStructureViews,queryBSTOrder,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {validateBSTOverlays} from '../scripts/inference/bst-contract.mjs';

async function run(source,stdout){
  const r=await traceModel('#include <stdio.h>\n'+source,{filename:'ordered-relations.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  const before=JSON.stringify({plan:r.plan,trace:r.trace}),again=inferStructures(r.plan,r.trace);
  assert.equal(again.status,'completed');assert.equal(JSON.stringify({plan:r.plan,trace:r.trace}),before);
  return {...r.trace,structures:r.inference.structures};
}
const at=(t,label)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId;
const target=(t,name)=>({objectId:t.objects.find(o=>o.name===name).id});
const check=(t,name,label)=>queryBSTOrder(t,{target:target(t,name),afterExecutionId:at(t,label)});

test('recursive integer-index records, computed key writes, ancestor violation and restoration',async()=>{
  const t=await run(`typedef struct{int east,spare,key,west;}N;
N nodes[4]={{2,50,10,1},{3,60,5,-7},{-7,70,15,-7},{-7,80,7,-7}};
int walk(int k){return k<0?0:1+walk(nodes[k].west)+walk(nodes[k].east);}
int find(int k,int q){if(k<0)return 0;if(nodes[k].key==q)return 1;return q<nodes[k].key?find(nodes[k].west,q):find(nodes[k].east,q);}
int main(void){int seed=0;printf("A %d\\n",walk(seed)+find(seed,7)+find(seed,15));
nodes[3].key=nodes[1].key+7;printf("B %d\\n",walk(seed)+find(seed,12));
nodes[3].key=nodes[1].key+2;printf("C %d\\n",walk(seed)+find(seed,7));return 0;}`,'A 6\nB 4\nC 5\n');
  assert.equal(check(t,'seed','A').assessment,'satisfied-observed');
  const semantic=check(t,'seed','A').candidates[0],sourceId=t.structures.find(s=>s.id===semantic.candidateId).sourceStructureId;
  assert.equal(queryBSTOrder(t,{target:{structureId:sourceId},afterExecutionId:at(t,'A')}).assessment,'satisfied-observed');
  const bad=check(t,'seed','B');assert.equal(bad.assessment,'contradicted');assert.ok(bad.warnings.some(w=>w.value==='12'&&w.bound==='10'&&w.path.length===3));
  assert.equal(check(t,'seed','C').assessment,'satisfied-observed');
  const prefs=setStructurePresentation(null,t,{target:target(t,'seed'),view:'bst'}),shown=resolveStructurePresentation(t,{target:target(t,'seed'),preferences:prefs,afterExecutionId:at(t,'B')});
  assert.equal(shown.view,'bst');assert.equal(shown.mode,'manual');assert.equal(shown.expectationCheck.assessment,'contradicted');
  const generic=setStructurePresentation(null,t,{target:target(t,'seed'),view:'tree'});
  // A generic tree now has its own topology check; it must not inherit the
  // violated BST subtype condition from an automatic recommendation.
  const genericCheck=resolveStructurePresentation(t,{target:target(t,'seed'),preferences:generic,afterExecutionId:at(t,'B')}).expectationCheck;
  assert.equal(genericCheck.expected,'tree');assert.equal(genericCheck.assessment,'satisfied-observed');
  assert.ok(genericCheck.candidates.every(c=>c.checks.every(check=>check.conditionId!=='bst-order')));
  assert.deepEqual(genericCheck.warnings,[]);
});

test('wide unsigned keys retain exact order without Number rounding',async()=>{
  const t=await run(`typedef struct N{struct N*x;unsigned long long k;struct N*y;}N;
int find(N*p,unsigned long long q){while(p){if(q==p->k)return 1;p=q<p->k?p->x:p->y;}return 0;}
int walk(N*p){return p?1+walk(p->x)+walk(p->y):0;}
int main(void){N a={0,9007199254740993ULL,0},b={0,9007199254740992ULL,0},c={0,9007199254740994ULL,0};
a.x=&b;a.y=&c;N*seed=&a;printf("A %d\\n",walk(seed)+find(seed,b.k)+find(seed,c.k));
b.k=9007199254740994ULL;printf("B %d\\n",walk(seed));return 0;}`,'A 5\nB 3\n');
  assert.equal(check(t,'seed','A').assessment,'satisfied-observed');
  assert.ok(check(t,'seed','B').warnings.some(w=>w.value==='9007199254740994'&&w.bound==='9007199254740993'));
});

test('index-link insertion derives duplicate direction from key and destination identities',async()=>{
  const t=await run(`typedef struct{int k,x,y;}R;R a[4]={{8,-1,-1},{4,-1,-1},{12,-1,-1},{4,-1,-1}};
void put(int p,int q){while(1){if(a[q].k<a[p].k){if(a[p].x>=0)p=a[p].x;else{a[p].x=q;return;}}
else{if(a[p].y>=0)p=a[p].y;else{a[p].y=q;return;}}}}
int visit(int p){return p<0?0:1+visit(a[p].x)+visit(a[p].y);}
int main(void){int seed=0;put(seed,1);put(seed,2);put(seed,3);printf("A %d\\n",visit(seed));return 0;}`,'A 4\n');
  const q=check(t,'seed','A');assert.equal(q.assessment,'satisfied-observed');
  assert.ok(q.candidates.some(c=>c.state.contracts.some(c=>c.direction==='greater'&&c.duplicates==='observed-allowed')));
});

test('a conditional link read without traversal does not establish BST intent',async()=>{
  const t=await run(`typedef struct N{int k;struct N*a,*b;}N;
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int main(void){N n[3]={{10,0,0},{5,0,0},{15,0,0}};n[0].a=n+1;n[0].b=n+2;N*seed=n;
for(int q=0;q<20;q+=19){if(q<seed->k)printf("%d\\n",seed->a!=0);else printf("%d\\n",seed->b!=0);}
printf("A %d\\n",walk(seed));return 0;}`,'1\n1\nA 3\n');
  assert.equal(check(t,'seed','A').assessment,'not-checkable');
  assert.ok(!recommendStructureViews(t,{target:target(t,'seed'),afterExecutionId:at(t,'A')}).some(r=>r.view==='bst'));
});

test('signed to unsigned reinterpretation is not silently treated as signed numeric ordering',async()=>{
  const t=await run(`typedef struct N{int k;struct N*a,*b;}N;
int find(N*p,unsigned q){while(p){if((unsigned)p->k==q)return 1;p=q<(unsigned)p->k?p->a:p->b;}return 0;}
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int main(void){N n[3]={{1,0,0},{0,0,0},{-1,0,0}};n[0].a=n+1;n[0].b=n+2;N*seed=n;
printf("A %d\\n",walk(seed)+find(seed,0)+find(seed,~0U));return 0;}`,'A 5\n');
  assert.equal(check(t,'seed','A').assessment,'not-checkable');
  assert.ok(!recommendStructureViews(t,{target:target(t,'seed'),afterExecutionId:at(t,'A')}).some(r=>r.view==='bst'));
});

test('passing selected children to an output helper is not search traversal',async()=>{
  const t=await run(`typedef struct N{int k;struct N*a,*b;}N;
void display(N*p){printf("%d\\n",p!=0);}
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int main(void){N n[3]={{10,0,0},{5,0,0},{15,0,0}};n[0].a=n+1;n[0].b=n+2;N*seed=n;
for(int q=0;q<20;q+=19){if(q<seed->k)display(seed->a);else display(seed->b);}
printf("A %d\\n",walk(seed));return 0;}`,'1\n1\nA 3\n');
  assert.equal(check(t,'seed','A').assessment,'not-checkable');
});

test('rotations preserve order after relinking and do not hide transient graph structure',async()=>{
  const t=await run(`typedef struct N{int k;struct N*a,*b;}N;
int find(N*p,int q){while(p){if(q==p->k)return 1;p=q<p->k?p->a:p->b;}return 0;}
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int main(void){N a={4,0,0},b={2,0,0},c={6,0,0},d={3,0,0};a.a=&b;a.b=&c;b.b=&d;N*seed=&a;
printf("A %d\\n",walk(seed)+find(seed,3)+find(seed,6));
N*up=seed->a;seed->a=up->b;up->b=seed;seed=up;
printf("B %d\\n",walk(seed));return 0;}`,'A 6\nB 4\n');
  assert.equal(check(t,'seed','A').assessment,'satisfied-observed');assert.equal(check(t,'seed','B').assessment,'satisfied-observed');
  const corrupt=structuredClone(t),overlay=corrupt.structures.find(s=>s.kind==='ordered-tree-candidate'&&s.states.some(st=>st.status==='satisfied-observed'));
  overlay.states.find(st=>st.status==='satisfied-observed').nodes.pop();assert.throws(()=>validateBSTOverlays(corrupt),/node set/);
});
