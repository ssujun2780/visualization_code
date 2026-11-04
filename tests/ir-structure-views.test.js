import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,expected);assert.equal(r.stdout,plain.stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);return r;
}
test('typed indexed appends with non-doubling growth infer roles without names or memcpy',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdlib.h>
typedef struct {double *z;size_t u,v;} K;
void f(K*t,double n){if(t->u==t->v){size_t q=t->v+3;double *p=realloc(t->z,q*sizeof*p);if(!p)exit(1);t->z=p;t->v=q;}t->z[t->u++]=n;}
int main(void){K a={0};for(int i=0;i<5;i++)f(&a,i+1.5);printf("%zu %zu %.1f\\n",a.u,a.v,a.z[4]);free(a.z);a.z=0;return 0;}`,'5 6 5.5\n');
  const a=r.trace.objects.find(o=>o.name==='a'),c=r.trace.structures.find(s=>s.kind==='dynamic-array'&&s.ownerObjectId===a.id);
  assert.ok(c);assert.equal(c.latestValidState.length,5);assert.equal(c.latestValidState.capacity,6);assert.equal(c.latestValidState.elementBytes,8);
  assert.equal(c.elementType.name,'double');assert.equal(c.backingHistory.length,2);assert.equal(c.lifecycle,'ended');
  assert.ok(!('cells' in c));
});
test('shallow copies share storage but an ended allocation is not rebound by the same numeric address',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdlib.h>
typedef struct {int *p;size_t q,r;} K;
void f(K*t,int n){if(t->q==t->r){size_t c=t->r+1;int *p=realloc(t->p,c*sizeof*p);if(!p)exit(1);t->p=p;t->r=c;}t->p[t->q++]=n;}
int main(void){K a={0};f(&a,4);K b=a;f(&b,5);printf("%zu %zu\\n",a.q,b.q);free(b.p);b.p=0;a.p=0;return 0;}`,'1 2\n');
  const a=r.trace.objects.find(o=>o.name==='a'),b=r.trace.objects.find(o=>o.name==='b'),
    ca=r.trace.structures.find(s=>s.kind==='dynamic-array'&&s.ownerObjectId===a.id),cb=r.trace.structures.find(s=>s.kind==='dynamic-array'&&s.ownerObjectId===b.id);
  assert.ok(ca&&cb);assert.notEqual(ca.id,cb.id);assert.equal(ca.latestValidState.length,1);assert.equal(cb.latestValidState.length,2);
  assert.equal(ca.backingHistory.length,1);assert.equal(cb.backingHistory.length,2);assert.equal(ca.backingHistory[0],cb.backingHistory[0]);
  assert.ok(ca.states.some(s=>!s.active));
});
test('read-only indexed records and initializer templates do not become tree/list or dynamic-array claims',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stddef.h>
typedef struct {int*p;size_t a,b;} K;
int main(void){int v[2]={4,8};K x={v,0,2};if(x.a<x.b)printf("%d\\n",x.p[x.a]);return 0;}`,'4\n');
  assert.equal(r.trace.structures.filter(s=>s.kind==='dynamic-array').length,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),events=new Map(r.trace.events.map(e=>[e.eventId,e])),views=new Map(r.trace.views.map(v=>[v.id,v]));
  const hidden=new Set(r.trace.objects.filter(o=>defs.get(events.get(o.createdBy)?.instructionId)?.visibility==='implementation').map(o=>o.id));
  for(const s of r.trace.structures){assert.ok(s.nodes.every(id=>!hidden.has(views.get(id)?.objectId)));if(s.kind==='record-graph-candidate'&&!s.edges.length)assert.deepEqual(s.views,[]);}
});
test('large typed heap views retain lazy bounds without creating per-element objects or reads',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdlib.h>
int main(void){unsigned*p=calloc(10000,sizeof*p);if(!p)return 1;p[9999]=9;printf("%u\\n",p[9999]);free(p);return 0;}`,'9\n');
  const heap=r.trace.objects.filter(o=>o.storage==='heap');assert.equal(heap.length,1);
  const view=r.trace.structures.find(s=>s.kind==='array'&&s.objectId===heap[0].id);assert.ok(view);assert.equal(view.capacity,10000);
  assert.equal(view.elementBytes,4);assert.ok(!('cells' in view));assert.ok(r.trace.objects.length<10);
});
