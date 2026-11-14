import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {inferStructures,recommendStructureViews} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function run(code,stdout){
  const r=await traceModel('#include <stdio.h>\n'+code,{filename:'tree-general.c'});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.diagnostics));assert.equal(r.stdout,stdout);
  const h=hash({plan:r.plan,trace:r.trace}),inference=inferStructures(r.plan,r.trace);
  assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(hash({plan:r.plan,trace:r.trace}),h);
  return {...r.trace,structures:inference.structures};
}
const output=(t,n=0)=>t.events.filter(e=>e.action==='output')[n].eventId;
const state=(t,s,id)=>{const p=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(st=>p.get(st.afterExecutionId)<=p.get(id));};
const rec=(t,name,id)=>recommendStructureViews(t,{target:{objectId:t.objects.find(o=>o.name===name).id},afterExecutionId:id});
const sorted=a=>[...a].sort((a,b)=>a-b);

test('conditional termination combines renamed integer child roles and tracks a moved root',async()=>{
  const t=await run(`typedef struct {int spare, east, key, west;} Cell;
int visit(Cell *a,int k){return k<0?0:1+visit(a,a[k].west)+visit(a,a[k].east);}
int main(void){Cell q[6]={{0,-13,9,-13},{0,5,9,2},{0,-13,9,-13},{0,-13,9,-13},{0,-13,9,-13},{0,-13,9,-13}};
int seed=1;printf("%d\\n",visit(q,seed));seed=5;printf("%d\\n",visit(q,seed));return 0;}`,'3\n1\n');
  for(const [i,members]of [[0,[1,2,5]],[1,[5]]]){
    const r=rec(t,'seed',output(t,i)).find(r=>r.view==='tree');assert.equal(r.representedNodeCount,members.length);
    const s=t.structures.find(s=>s.id===r.candidateId);assert.deepEqual(sorted(state(t,s,output(t,i)).memberIndices),members);
    assert.equal(state(t,s,output(t,i)).topology.status,'observed');
  }
});

test('counted pointer slots exclude stale cycles, include zero-child leaves, and invalidate on resize',async()=>{
  const t=await run(`typedef struct N{struct N*ports[3];int tag,extent;}N;
int total(N*p){int z=1;for(int j=0;j<p->extent;j++)z+=total(p->ports[j]);return z;}
int main(void){N a[5]={0};a[3].extent=2;a[3].ports[0]=a+1;a[3].ports[1]=a+4;
a[1].ports[2]=a+3;N*seed=a+3;printf("%d\\n",total(seed));a[3].extent=0;puts("changed");printf("%d\\n",total(seed));return 0;}`,'3\nchanged\n1\n');
  const s=t.structures.find(s=>s.kind==='pointer-tree-projection'&&s.mode==='counted-children'&&s.root.objectId===t.objects.find(o=>o.name==='seed').id);assert.ok(s);
  assert.equal(state(t,s,output(t,0)).nodes.length,3);assert.equal(state(t,s,output(t,0)).topology.status,'observed');
  assert.equal(state(t,s,output(t,1)).topology.status,'partial');
  assert.equal(state(t,s,output(t,2)).nodes.length,1);assert.equal(state(t,s,output(t,2)).topology.status,'observed');
  const raw=t.structures.find(s=>s.kind==='storage-reference-graph');assert.ok(raw.changes.flatMap(c=>c.upsertEdges).some(e=>e.roleId?.endsWith(':slot:2')&&e.status==='in-bounds'));
});

test('inverse parent view keeps stored direction and exact membership',async()=>{
  const t=await run(`typedef struct M{struct M*route;long payload;}M;
int depth(M*p){int z=0;while(p){z++;p=p->route;}return z;}
int main(void){M a[5]={0};a[0].route=a+2;a[1].route=a+2;a[4].route=a+1;
int z=0;for(int j=0;j<5;j++)z+=depth(a+j);printf("%d\\n",z);return 0;}`,'9\n');
  const s=t.structures.find(s=>s.kind==='pointer-tree-projection'&&s.mode==='inverse-parent'&&state(t,s,output(t))?.nodes.length===4);assert.ok(s);
  const st=state(t,s,output(t)),width=t.objects.find(o=>o.name==='a').cType.elementType.sizeBits/8,byNode=new Map(st.nodes.map(n=>[n.id,n.range.offset/width]));
  assert.deepEqual(sorted([...byNode.values()]),[0,1,2,4]);
  assert.deepEqual(st.edges.map(e=>[byNode.get(e.from),byNode.get(e.to)]).sort(),[[1,4],[2,0],[2,1]].sort());
});

test('first-child sibling projection follows traversal roles rather than names or layout',async()=>{
  const t=await run(`typedef struct T{struct T*horizontal;int data;struct T*vertical;}T;
int visit(T*p){int z=1;T*q=p->vertical;while(q){z+=visit(q);q=q->horizontal;}return z;}
int main(void){T a[5]={0};a[4].vertical=a;a[0].horizontal=a+2;a[2].horizontal=a+1;a[2].vertical=a+3;
T*seed=a+4;printf("%d\\n",visit(seed));return 0;}`,'5\n');
  const root=t.objects.find(o=>o.name==='seed'),s=t.structures.find(s=>s.mode==='first-child-next-sibling'&&s.root.objectId===root.id);assert.ok(s);
  const st=state(t,s,output(t)),width=t.objects.find(o=>o.name==='a').cType.elementType.sizeBits/8,byNode=new Map(st.nodes.map(n=>[n.id,n.range.offset/width]));
  assert.equal(st.topology.status,'observed');assert.deepEqual(st.edges.map(e=>[byNode.get(e.from),byNode.get(e.to)]).sort(),[[4,0],[4,2],[4,1],[2,3]].sort());
  assert.equal(rec(t,'seed',output(t))[0].view,'tree');
});

test('completed read-only prefix scans establish bounds; early break and later count writes do not',async()=>{
  const t=await run(`int scan(int*a,int n,int stop){int z=0;for(int i=0;i<n;i++){z+=a[i];int j=i*2+1;if(j<n)z+=a[j];if(j+1<n)z+=a[j+1];if(stop)break;}return z;}
int main(void){int a[9]={3,3,3,3},n=4;printf("%d\\n",scan(a,n,1));printf("%d\\n",scan(a,n,0));n=2;printf("%d\\n",scan(a,n,0));return 0;}`,'9\n21\n9\n');
  const s=t.structures.find(s=>s.kind==='index-tree'&&s.descriptor.base===0);assert.ok(s);
  assert.equal(state(t,s,output(t,0)).activeRange.count,null);
  assert.equal(state(t,s,output(t,1)).activeRange.count,4);
  assert.equal(state(t,s,output(t,2)).activeRange.count,2);
  for(let i=0;i<3;i++)assert.ok(!rec(t,'a',output(t,i)).some(r=>r.view.endsWith('-heap')));
});

test('pointer aliases retain current heap slots rather than copied-value provenance',async()=>{
  const t=await run(`void change(int*a,int*b){int t=*a;*a=*b;*b=t;}
int main(void){int a[10]={0},n=0;int values[4]={8,2,6,1};for(int k=0;k<4;k++){a[n]=values[k];int j=n++;while(j>0){int p=(j-1)/2;if(a[p]<=a[j])break;change(a+j,a+p);j=p;}}
printf("%d\\n",a[0]);a[0]=40;printf("%d\\n",a[0]);return 0;}`,'1\n40\n');
  const r=rec(t,'a',output(t,0));assert.ok(r.some(r=>r.view==='min-heap'));
  const s=t.structures.find(s=>s.kind==='index-tree'&&s.direction.candidate==='min'&&state(t,s,output(t,0)).activeRange.count===4);assert.ok(s);
  assert.equal(state(t,s,output(t,0)).min.status,'satisfied');assert.equal(state(t,s,output(t,1)).min.status,'violated');
});
