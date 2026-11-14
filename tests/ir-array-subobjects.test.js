import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';

async function inspect(source,stdout){
  const r=await traceModel('#include <stdio.h>\n#include <stdlib.h>\n'+source,{filename:'array-subobjects.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  return r.trace;
}
function referent(t,name){
  const o=t.objects.find(o=>o.name===name);assert.ok(o,name);
  const e=t.events.find(e=>e.kind==='WRITE'&&e.target?.objectId===o.id&&e.value?.reference?.status==='in-bounds');assert.ok(e,name);
  return {objectId:e.value.reference.targetObjectId,offset:e.value.reference.targetOffset??0,size:e.value.cType.pointee.sizeBits/8};
}
const arrays=t=>t.structures.filter(s=>s.kind==='array');
function noArray(t,r){assert.ok(!arrays(t).some(a=>a.range.objectId===r.objectId&&a.range.offset<r.offset+r.size&&r.offset<a.range.offset+a.range.size),JSON.stringify(r));}
function exactArray(t,r,count){
  const matches=arrays(t).filter(a=>a.range.objectId===r.objectId&&a.range.offset===r.offset&&a.elementBytes===r.size);
  assert.ok(matches.length,JSON.stringify(r));assert.ok(matches.every(a=>a.range.size===r.size*count&&a.capacity===count),JSON.stringify(matches.map(a=>a.range)));
}

test('taking a scalar field address does not consume the following fields as an array',async()=>{
  const t=await inspect(`typedef struct N{struct N*link;long extra[3];}N;
int main(void){N*p=calloc(1,sizeof*p);if(!p)return 1;N**slot=&p->link;*slot=p;printf("%d\\n",p->link==p);free(p);}`,'1\n');
  noArray(t,referent(t,'slot'));
});

test('nested scalar fields retain their extent through aliases, casts and helper arguments',async()=>{
  const t=await inspect(`typedef struct N{int value;struct N*next;}N;
typedef struct{short prefix;struct{N*link;int value;}inner;long suffix[2];}Box;
void set(N**p,N*v){*p=v;}void number(int*p){*p=7;}
int main(void){Box a={0};Box*b=calloc(1,sizeof*b);if(!b)return 1;N n={1,0};
N**u=&a.inner.link;N**v=(N**)&b->inner.link;N**alias=v;int*w=&b->inner.value;
set(u,&n);set(alias,&n);number(w);printf("%d %d %d\\n",a.inner.link->value,b->inner.link->value,b->inner.value);free(b);}`,'1 1 7\n');
  for(const name of ['u','v','alias','w'])noArray(t,referent(t,name));
});

test('declared one-element pointer arrays remain arrays and stop before adjacent fields',async()=>{
  const t=await inspect(`typedef struct N{int value;}N;
typedef struct{int pad;N*one[1];long tail[3];}Box;
int main(void){Box a={0};Box*b=calloc(1,sizeof*b);if(!b)return 1;N n={5};
N**u=a.one;N**v=b->one;*u=&n;*v=&n;printf("%d %d\\n",a.one[0]->value,b->one[0]->value);free(b);}`,'5 5\n');
  exactArray(t,referent(t,'u'),1);exactArray(t,referent(t,'v'),1);
});

test('one pointer can rebind from a scalar field to a real array without promoting its earlier target',async()=>{
  const t=await inspect(`typedef struct N{int value;}N;
typedef struct{N*single;N*many[4];long tail[2];}Box;
int main(void){Box a={0};N n={9};N**p=&a.single;N**scalar=p;*p=&n;
p=a.many;N**start=p;p[0]=&n;p[1]=&n;N**middle=p+2;*middle=&n;
printf("%d %d %d\\n",a.single->value,a.many[1]->value,a.many[2]->value);}`,'9 9 9\n');
  noArray(t,referent(t,'scalar'));exactArray(t,referent(t,'start'),4);
  const middle=referent(t,'middle');
  assert.ok(arrays(t).some(a=>a.range.objectId===middle.objectId&&a.range.offset<=middle.offset&&a.range.offset+a.range.size>=middle.offset+middle.size));
  assert.ok(arrays(t).filter(a=>a.range.objectId===middle.objectId).every(a=>a.range.offset+a.range.size<=referent(t,'start').offset+4*middle.size));
});

test('qualified scalar typedefs stay fields while an embedded array of one record stays an array',async()=>{
  const t=await inspect(`typedef const int ReadOnly;typedef struct{int value;}N;
typedef struct{ReadOnly value;int tail[2];}A;typedef struct{int pad;N items[1];}B;
int main(void){A a={7,{1,2}};B b={0,{{6}}};ReadOnly*p=&a.value;N*q=b.items;
printf("%d %d\\n",*p,q->value);}`,'7 6\n');
  noArray(t,referent(t,'p'));exactArray(t,referent(t,'q'),1);
});
