import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {valueIndexStructures,validateValueIndexStructures} from '../scripts/model/value-index-views.mjs';

async function inspect(source){
  const result=await traceModel(source);assert.equal(result.trace.status,'completed',JSON.stringify(result.trace.diagnostics));
  assert.equal(result.trace.exitCode,0);
  const before=JSON.stringify({events:result.trace.events,objects:result.trace.objects}),graphs=valueIndexStructures(result.plan,result.trace);
  assert.equal(JSON.stringify({events:result.trace.events,objects:result.trace.objects}),before);
  assert.doesNotThrow(()=>validateValueIndexStructures({...result.trace,structures:[...result.trace.structures,...graphs]}));
  return {...result,graphs};
}
const live=g=>g.states.filter(s=>s.alive);

test('renamed recursive arguments and a return wrapper retain observed same-array value links',async()=>{
  for(const [suffix,length]of [[83,4],[146,6]]){
    const r=await inspect(`int z${suffix}(int*x${suffix},int n){if(x${suffix}[n]==n)return n;return z${suffix}(x${suffix},x${suffix}[n]);}
int w${suffix}(int *b,int k){return z${suffix}(b,k);}
int main(void){int s${suffix}[${length}];for(int j=0;j<${length};j++)s${suffix}[j]=j?j-1:0;
int a=w${suffix}(s${suffix},${length-1});int b=s${suffix}[w${suffix}(s${suffix},${length-1})];return a+b;}`);
    assert.equal(r.graphs.length,1);const g=r.graphs[0],s=live(g).findLast(s=>s.topology.views.includes('parent-forest-candidate'));
    assert.ok(s);assert.equal(g.capacity,length);assert.deepEqual(s.topology.roots,[0]);
    assert.ok(s.representatives.every(x=>x.rootIndex===0));assert.ok(g.evidence.every(e=>e.sourceReadExecutionId&&e.targetAccessExecutionId&&e.indexExecutionId));
    assert.ok(g.terminationEvidence.every(e=>e.branchExecutionId&&e.comparisonExecutionId));
    assert.equal(g.states[0].discoveryStatus,'not-yet-observed');assert.equal(g.states.at(-1).status,'ended');
    assert.ok(g.states.every(s=>s.nodes.every(n=>n.objectId===g.objectId&&n.offset===g.range.offset+n.index*g.elementBytes)));
  }
});

test('iterative self-equality termination supports separate components without fixed algorithm shape',async()=>{
  const r=await inspect(`int seek(int *v,int k){while(v[k]!=k)k=v[k];return k;}
int main(void){int r[6];for(int h=0;h<6;h++)r[h]=h%3?h-1:h;
int first=seek(r,2),second=seek(r,5);r[2]=1;r[2]=1;return first+second!=3;}`);
  const [g]=r.graphs,s=live(g).find(s=>s.topology.views.includes('parent-forest-candidate'));
  assert.ok(s);assert.deepEqual(s.topology.roots,[0,3]);assert.equal(s.topology.components.length,2);
  assert.ok(s.topology.components.every(c=>c.status==='rooted-tree-candidate'));
  const writes=g.writes.filter(w=>w.index===2&&w.value===1);assert.ok(writes.length>=3);
  for(const w of writes)assert.ok(g.states.some(s=>s.afterExecutionId===w.executionId));
});

test('a compiler branch merge can return the same slot, with unvisited self roots labelled as inferred',async()=>{
  const r=await inspect(`int jump(int *a,int k){if(a[k]!=k)a[k]=jump(a,a[k]);return a[k];}
int main(void){int v[5];for(int i=0;i<5;i++)v[i]=i?i-1:0;v[4]=4;
int n=jump(v,3);return n;}`);
  const [g]=r.graphs,s=live(g).findLast(s=>s.topology.views.includes('parent-forest-candidate'));
  assert.ok(s);assert.ok(g.terminationEvidence.some(e=>e.evidence.includes('branch merge')));
  assert.deepEqual(s.topology.roots,[0,4]);assert.equal(s.rootEvidence.find(r=>r.index===0).kind,'observed-termination');
  assert.equal(s.rootEvidence.find(r=>r.index===4).kind,'inferred-self-termination');
  const firstProof=r.trace.events.findIndex(e=>e.eventId===g.terminationConvention.inferredAtExecutionId);
  assert.ok(g.states.filter(s=>r.trace.events.findIndex(e=>e.eventId===s.afterExecutionId)<firstProof).every(s=>!s.rootEvidence.length));
});

test('self cycles and real cycles remain graph cycles without an executed terminating check',async()=>{
  for(const [values,start]of [['0,0,1,2',3],['1,2,0,3',0]]){
    const r=await inspect(`int main(void){int a[4]={${values}},k=${start},t=0;for(int i=0;i<5;i++){k=a[k];t+=a[k];}return t<0;}`);
    const [g]=r.graphs;assert.ok(g);assert.deepEqual(g.terminationEvidence,[]);
    assert.ok(live(g).some(s=>s.topology.cyclic===true));assert.ok(live(g).every(s=>!s.topology.views.includes('parent-forest-candidate')));
    assert.ok(live(g).every(s=>s.topology.roots.length===0));
    if(start===0)assert.ok(live(g).some(s=>s.topology.components.some(c=>c.cyclic&&c.indices.length===3)));
  }
});

test('an equality comparison followed by another link access does not make a root',async()=>{
  const r=await inspect(`int main(void){int a[3]={0,0,1},k=2,sum=0;
for(int j=0;j<4;j++){if(a[k]==k)sum++;k=a[k];}return sum<0;}`);
  const [g]=r.graphs;assert.ok(g);assert.deepEqual(g.terminationEvidence,[]);
  assert.ok(live(g).every(s=>s.topology.roots.length===0));assert.ok(live(g).some(s=>s.topology.cyclic===true));
});

test('unrelated integer arrays and transformed indices never establish same-array link evidence',async()=>{
  const r=await inspect(`int main(void){int x[5]={0,1,2,3,4},y[5]={4,3,2,1,0},total=0;
for(int j=0;j<4;j++){total+=y[x[j]];total+=x[x[j]+1];}return total<0;}`);
  assert.deepEqual(r.graphs,[]);
});

test('unknown slots, invalid later values, and object lifetimes remain explicit',async()=>{
  const r=await inspect(`int main(void){int total=0;for(int pass=0;pass<2;pass++){int a[5];
a[0]=0;a[1]=0;a[2]=1;int k=a[2];total+=a[k];a[1]=91;a[2]=-2;}return total;}`);
  assert.equal(r.graphs.length,2);assert.notEqual(r.graphs[0].objectId,r.graphs[1].objectId);
  for(const g of r.graphs){assert.ok(live(g).some(s=>s.unknownSlotCount>=2));
    assert.ok(live(g).some(s=>s.edges.some(e=>e.value===91&&e.status==='out-of-bounds'&&e.to===null)));
    assert.ok(live(g).some(s=>s.edges.some(e=>e.value===-2&&e.status==='out-of-bounds')));
    assert.equal(g.states.at(-1).status,'ended');assert.ok(g.states.at(-1).nodes.every(n=>n.status==='ended'));
  }
  const altered=structuredClone({...r.trace,structures:[...r.trace.structures,...r.graphs]});
  altered.structures.find(s=>s.kind==='value-index-graph-candidate').states[0].afterExecutionId='missing';
  assert.throws(()=>validateValueIndexStructures(altered),/missing execution/);
});

test('large array overlays grow with observed slots rather than compiler capacity',async()=>{
  const r=await inspect('int main(void){int a[50000]={0};a[4]=2;a[2]=1;int n=a[4];n=a[n];return n!=1;}');
  assert.equal(r.graphs.length,1);const g=r.graphs[0];assert.equal(g.capacity,50000);
  assert.ok(g.states.every(s=>s.nodes.length<10));assert.ok(g.states.every(s=>s.unknownSlotCount>49990));
  assert.ok(JSON.stringify(g).length<40000);
});
