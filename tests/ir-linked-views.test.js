import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  return {...r,linked:r.trace.structures.filter(s=>s.kind==='linked-structure')};
}
test('cursor recurrence discovers a list with reordered fields and retains a later cycle and detached live node',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct B {struct B *q;int x;} B;
int main(void){B *h=0,*a=malloc(sizeof*a),*b=malloc(sizeof*b);if(!a||!b)return 1;
*a=(B){.q=b,.x=1};*b=(B){.q=0,.x=2};h=a;int sum=0;
for(B*p=h;p;p=p->q)sum+=p->x;
b->q=a;int k=0;for(B*p=h;p&&k<3;p=p->q)k++;
b->q=0;h=b;free(a);h=0;free(b);printf("%d %d\\n",sum,k);return 0;}`,'3 3\n');
  const root=r.trace.objects.find(o=>o.name==='h'),c=r.linked.find(c=>c.root.objectId===root.id);
  assert.ok(c);assert.ok(c.views.includes('singly-linked-candidate'));assert.equal(c.roles[0].offset,0);
  assert.ok(c.states.some(s=>s.orders.some(o=>o.termination==='cycle')));
  assert.ok(c.states.some(s=>s.detachedMembers.length===1));assert.equal(c.states.at(-1).endedMembers.length,2);
  assert.equal(c.logicalNodes.length,2);
});
test('paired field traversal identifies an automatic sentinel and preserves asymmetric rewiring without repairing it',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct R {struct R*q;int v;struct R*z;} R;
int f(R*s,int rev){R*p=rev?s->z:s->q;int sum=0;while(p!=s){R*t=rev?p->z:p->q;sum+=p->v;p=t;}return sum;}
int main(void){R s={.q=&s,.z=&s},a={.q=&s,.v=1,.z=&s},b={.q=&s,.v=2,.z=&a};
s.q=&a;a.q=&b;s.z=&b;printf("%d %d\\n",f(&s,0),f(&s,1));
s.q=&b;b.z=&s;return 0;}`,'3 3\n');
  const root=r.trace.objects.find(o=>o.name==='s'&&o.cType?.kind==='record'),c=r.linked.find(c=>c.root.objectId===root.id&&c.root.kind==='anchor');
  assert.ok(c);assert.equal(c.logicalNodes.length,3);assert.ok(c.views.includes('doubly-linked-candidate'));
  assert.ok(c.views.includes('sentinel-candidate'));assert.ok(c.views.includes('circular-linked-candidate'));
  const changes=c.states.filter(s=>s.rootAlive),mismatch=changes.find(s=>s.orders.some(o=>o.nodeIds.length===1)&&s.orders.some(o=>o.nodeIds.length===2));
  assert.ok(mismatch);assert.ok(mismatch.inconsistencies.length);
  assert.ok(changes.some(s=>s.detachedMembers.length===1&&!s.inconsistencies.length&&s.orders.every(o=>o.nodeIds.length===1)));
  assert.equal(r.linked.length,1);
});
test('an interior pointer field gets its own bounded range while a large heap array keeps its complete range',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct N {int x;struct N*q;} N;
int main(void){N*a=malloc(sizeof*a);int*v=calloc(10000,sizeof*v);if(!a||!v)return 1;*a=(N){.x=4,.q=0};
N**s=&a->q;*s=0;v[9999]=9;printf("%d %d\\n",a->x,v[9999]);free(a);free(v);return 0;}`,'4 9\n');
  const arrays=r.trace.structures.filter(s=>s.kind==='array'),n=r.trace.objects.find(o=>o.storage==='heap'&&o.size===8),v=r.trace.objects.find(o=>o.storage==='heap'&&o.size===40000);
  const field=arrays.find(a=>a.objectId===n.id&&a.elementType.kind==='pointer');
  assert.deepEqual(field.range,{objectId:n.id,offset:4,size:4});assert.equal(field.capacity,1);
  assert.ok(arrays.some(a=>a.objectId===v.id&&a.capacity===10000&&a.range.offset===0));
});
test('inconsistent length/capacity metadata does not erase a candidate supported by actual indexed writes',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct {int*p;size_t u,v;} K;
void f(K*k,int x){if(k->u==k->v){size_t c=k->v+1;int*p=realloc(k->p,c*sizeof*p);if(!p)exit(1);k->p=p;k->v=c;}k->p[k->u++]=x;}
int main(void){K k={.p=calloc(4,sizeof(int)),.u=3,.v=1};if(!k.p)return 1;f(&k,8);printf("%zu %zu %d\\n",k.u,k.v,k.p[3]);free(k.p);return 0;}`,'4 1 8\n');
  const owner=r.trace.objects.find(o=>o.name==='k'&&o.cType?.kind==='record'),c=r.trace.structures.find(s=>s.kind==='dynamic-array'&&s.ownerObjectId===owner.id);
  assert.ok(c);assert.ok(c.states.some(s=>s.length===4&&s.capacity===1&&s.status==='intermediate-or-unavailable'));
  assert.equal(c.latestValidState,undefined);assert.equal(c.elementType.name,'int');
});
