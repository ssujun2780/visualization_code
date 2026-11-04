import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);return r;
}
const candidates=r=>r.trace.structures.filter(s=>s.kind==='array-structure');
test('embedded LIFO follows prefix/postfix updates and retains physical bytes after logical removal',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {int a[4];unsigned b;} T;
void x(T*p,int v){p->a[p->b++]=v;}
int y(T*p){return p->a[--p->b];}
int main(void){T q={0};x(&q,7);x(&q,9);int u=y(&q);int v=y(&q);printf("%d %d %d %d\\n",u,v,q.a[0],q.a[1]);return 0;}`,'9 7 7 9\n');
  const [s]=candidates(r);assert.equal(candidates(r).length,1);assert.deepEqual(s.roleCandidates,['lifo']);
  assert.equal(s.operationEvidence.length,4);assert.equal(s.range.size,16);assert.equal(s.elementBytes,4);
  assert.equal(s.latestValidState.length,0);assert.deepEqual(s.latestValidState.inactiveRanges,[s.range]);
  assert.ok(s.states.some(x=>x.status==='intermediate'&&x.logicalOrder===null));assert.equal(s.states.at(-1).active,false);
  assert.ok(s.arrayViewIds.length);for(const id of s.arrayViewIds){const v=r.trace.views.find(v=>v.id===id);assert.equal(v.objectId,s.range.objectId);assert.equal(v.size,s.range.size);}
  assert.ok(r.trace.structures.some(x=>x.kind==='array'&&x.objectId===s.ownerObjectId&&x.range.offset===s.range.offset&&x.range.size===s.range.size));
  assert.ok(!('cells'in s));
});
test('temporaries and separate assignments preserve FIFO wrap mapping and intermediate states',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {char z;int a[3];unsigned h,n;} T;
void x(T*p,int v){const unsigned c=3;unsigned t=p->h+p->n;unsigned k=t%c;p->a[k]=v;unsigned q=p->n+1;p->n=q;}
int y(T*p){unsigned k=p->h;int v=p->a[k];unsigned t=p->h+1;unsigned h=t%3;p->h=h;unsigned q=p->n-1;p->n=q;return v;}
int main(void){T q={0};x(&q,4);x(&q,5);int a=y(&q);x(&q,6);x(&q,7);int b=y(&q);int c=y(&q);int d=y(&q);printf("%d %d %d %d\\n",a,b,c,d);return 0;}`,'4 5 6 7\n');
  const [s]=candidates(r);assert.deepEqual(s.roleCandidates,['fifo']);assert.equal(s.range.offset,4);assert.equal(s.capacity,3);
  assert.equal(s.operationEvidence.length,8);assert.equal(s.circularAccess.observed,true);
  const full=s.states.find(x=>x.status==='consistent'&&x.head===1&&x.length===3);assert.ok(full);
  assert.deepEqual(Array.from({length:full.logicalOrder.count},(_,i)=>(full.logicalOrder.start+i)%full.logicalOrder.modulus),[1,2,0]);
  assert.deepEqual(full.inactiveRanges,[]);
  assert.ok(s.states.some(x=>x.status==='intermediate'&&x.head===2&&x.length===3&&x.logicalOrder===null));
  assert.equal(s.latestValidState.length,0);assert.deepEqual(s.latestValidState.inactiveRanges,[s.range]);
});
test('separate stack updates work while insertion-only and modulo-only observations remain partial',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {int a[2];unsigned n;} T;
void x(T*p,int v){unsigned i=p->n;p->a[i]=v;unsigned n=p->n+1;p->n=n;}
int y(T*p){unsigned n=p->n-1;p->n=n;unsigned i=n;return p->a[i];}
int main(void){T q={0},r={0};x(&q,8);int z=y(&q);x(&r,6);printf("%d %d\\n",z,r.a[r.n%2]);return 0;}`,'8 0\n');
  const cs=candidates(r),complete=cs.find(s=>s.roleCandidates.includes('lifo')),partial=cs.find(s=>!s.roleCandidates.length);
  assert.ok(complete&&partial);assert.equal(complete.operationEvidence.length,2);assert.equal(partial.operationEvidence.length,1);
  assert.equal(partial.circularAccess.observed,true);assert.ok(partial.states.every(s=>s.logicalOrder===null));
  assert.equal(partial.latestValidState,null);assert.equal(partial.range.size,8);
});
test('observed invalid count is retained after an established role without repairing logical order',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {int a[2];int n;} T;
void x(T*p){p->a[p->n++]=3;}
int y(T*p){return p->a[--p->n];}
int main(void){T q={0};x(&q);int v=y(&q);q.n=-1;printf("%d %d\\n",v,q.n);return 0;}`,'3 -1\n');
  const [s]=candidates(r);assert.deepEqual(s.roleCandidates,['lifo']);
  assert.ok(s.states.some(x=>x.length===-1&&x.status==='inconsistent-or-unavailable'&&x.logicalOrder===null));
  assert.equal(s.latestValidState.length,0);assert.equal(s.states.at(-1).length,-1);
});
test('a contradictory insertion keeps the established role and does not repair its later states',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {int a[3];unsigned n;} T;
void x(T*p,int v){p->a[p->n++]=v;}
int y(T*p){return p->a[--p->n];}
void z(T*p){p->a[p->n+1]=9;p->n++;}
int main(void){T q={0};x(&q,4);int v=y(&q);z(&q);printf("%d %d %u\\n",v,q.a[1],q.n);return 0;}`,'4 9 1\n');
  const [s]=candidates(r);assert.deepEqual(s.roleCandidates,['lifo']);
  assert.equal(s.operationEvidence.filter(o=>o.status==='supported').length,2);
  const failure=s.operationEvidence.find(o=>o.status==='contradicted');assert.ok(failure);
  const state=s.states.find(x=>x.afterExecutionId===failure.completeExecutionId);
  assert.equal(state.status,'inconsistent-or-unavailable');assert.equal(state.length,1);assert.equal(state.logicalOrder,null);
  assert.equal(s.states.at(-1).logicalOrder,null);assert.equal(s.latestValidState.length,0);
});

test('active prefix is independent of ordering and survives multiple writes and nested pointer helpers',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {char z;unsigned used;int cells[5];} T;
void swap(int*a,int*b){int t=*a;*a=*b;*b=t;}
void add(T*p,int x){unsigned k=p->used++;p->cells[k]=x;for(unsigned j=0;j+1<p->used;j++)swap(&p->cells[j],&p->cells[j+1]);}
int take(T*p){int x=p->cells[0];p->cells[0]=p->cells[--p->used];return x;}
int main(void){T q={0};add(&q,7);add(&q,9);add(&q,6);int a=take(&q),b=take(&q),c=take(&q);printf("%d %d %d\\n",a,b,c);return 0;}`,'7 9 6\n');
  const [s]=candidates(r);assert.deepEqual(s.roleCandidates,['active-prefix']);
  assert.equal(s.range.offset,8);assert.equal(s.roles.length.offset,4);assert.equal(s.capacity,5);
  assert.equal(s.operationEvidence.length,6);assert.ok(s.operationEvidence.every(o=>o.status==='supported'));
  assert.ok(s.boundEvidence.length);assert.equal(s.latestValidState.length,0);assert.deepEqual(s.latestValidState.inactiveRanges,[s.range]);
  assert.ok(s.states.some(x=>x.status==='intermediate'&&x.length===3&&x.pendingOperations.length));
  const helpers=new Set(r.trace.frames.filter(f=>f.functionName==='swap').map(f=>f.id));
  const helperWrites=new Set(r.trace.events.filter(e=>helpers.has(e.activationId)&&e.kind==='WRITE'&&e.target?.objectId===s.ownerObjectId).map(e=>e.eventId));
  const related=new Set(s.operationEvidence.flatMap(o=>o.relatedAccessExecutionIds));
  assert.equal(helperWrites.size,6);assert.ok([...helperWrites].every(id=>related.has(id)));
  assert.ok(s.operationEvidence.every(o=>r.trace.events.find(e=>e.eventId===o.completeExecutionId)?.action==='frame.end'));
});

test('prefix evidence preserves incorrect endpoint use instead of repairing the array view',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct{int a[4];unsigned n;} T;
void add(T*p,int x){unsigned k=p->n++;p->a[k]=x;for(unsigned j=0;j<p->n;j++)p->a[j]+=0;}
int take(T*p){int x=p->a[0];p->a[0]=p->a[--p->n];return x;}
int wrong(T*p){--p->n;int x=p->a[p->n+1];p->a[0]=x;return x;}
int main(void){T q={0};add(&q,4);add(&q,8);int x=take(&q);int y=wrong(&q);printf("%d %d\\n",x,y);return 0;}`,'4 8\n');
  const [s]=candidates(r);assert.deepEqual(s.roleCandidates,['active-prefix']);
  const bad=s.operationEvidence.find(o=>o.status==='contradicted');assert.ok(bad);
  const state=s.states.find(x=>x.afterExecutionId===bad.completeExecutionId);assert.equal(state.length,0);
  assert.equal(state.status,'inconsistent-or-unavailable');assert.equal(state.logicalOrder,null);
});
