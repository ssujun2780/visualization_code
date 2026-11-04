import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {recordIndexStructures} from '../scripts/model/record-index-views.mjs';
async function inspect(source,limits){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  const before=JSON.stringify({events:r.trace.events,objects:r.trace.objects}),graphs=recordIndexStructures(r.plan,r.trace,limits);
  assert.equal(JSON.stringify({events:r.trace.events,objects:r.trace.objects}),before);
  const positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const g of graphs)for(const s of g.states){
    assert.ok(s.nodes.length<=g.coverage.maxNodes);assert.ok(s.edges.length<=g.coverage.maxEdges);
    for(const e of s.edges){if(e.lastWriteExecutionId)assert.ok(positions.get(e.lastWriteExecutionId)<=positions.get(s.afterExecutionId));
      if(e.toIndex!==null)assert.ok(e.toIndex>=0&&e.toIndex<s.length);
      for(const id of e.evidenceExecutionIds)assert.ok(positions.get(id)<=positions.get(s.afterExecutionId));}
  }
  return {...r,graphs};
}
const lastLive=g=>g.states.findLast(s=>s.active&&s.nodes.every(n=>n.record));

test('record vectors connect parent values within active length and exclude temporary copies',async()=>{
  const r=await inspect(`#include <stdlib.h>
    #include <string.h>
    typedef struct {unsigned tag,previous;} Entry;
    typedef struct {unsigned cap;void*data;unsigned count,stride;} Store;
    void put(Store*s,Entry x){if(s->count==s->cap)return;memcpy((char*)s->data+s->count*s->stride,&x,s->stride);s->count++;}
    int main(void){Store s={7,malloc(7*sizeof(Entry)),0,sizeof(Entry)};
      put(&s,(Entry){5,~0u});put(&s,(Entry){6,0});put(&s,(Entry){7,1});
      Entry *data=s.data;Entry temporary=data[2];temporary.previous=0;unsigned k=2;
      k=data[k].previous;k=data[k].previous;unsigned result=data[k].tag;
      data[1].previous=99;free(s.data);return result!=5;}`);
  assert.equal(r.graphs.length,1);const g=r.graphs[0];assert.equal(g.storageKind,'record-array');
  const state=g.states.find(s=>s.active&&s.length===3&&s.edges.filter(e=>e.toIndex!==null).length===2);
  assert.ok(state);assert.equal(state.capacity,7);assert.deepEqual(state.edges.map(e=>[e.fromIndex,e.toIndex]),[[0,null],[1,0],[2,1]]);
  assert.ok(g.states.some(s=>s.edges.some(e=>e.value===99&&e.to===null&&e.status==='terminal-or-unresolved')));
  assert.ok(g.states.every(s=>s.nodes.length<=3));assert.ok(g.states.some(s=>s.retrospective));
});

const pointerProgram=`#include <stdlib.h>
  typedef struct N {unsigned code;unsigned*links;} N;
  typedef struct {N**items;unsigned used,limit;} Bag;
  void add(Bag*b,N*n){if(b->used==b->limit)return;n->code=b->used;b->items[b->used]=n;b->used++;}
  N*get(Bag*b,unsigned i){return b->items[i];}
  unsigned connect(Bag*b,unsigned from,unsigned symbol,unsigned to){N*n=get(b,from);unsigned id=get(b,to)->code;n->links[symbol]=id;return id;}
  void make(Bag*b){b->used=0;b->limit=8;b->items=malloc(8*sizeof(N*));
    for(unsigned i=0;i<3;i++){N*n=malloc(sizeof(N));n->links=malloc(2*sizeof(unsigned));
      for(unsigned j=0;j<2;j++)n->links[j]=~0u;add(b,n);}}
  int main(void){Bag a,b;make(&a);make(&b);
    unsigned x=get(&a,connect(&a,0,0,1))->code;unsigned y=get(&a,connect(&a,0,1,2))->code;
    unsigned z=get(&b,connect(&b,0,0,2))->code;unsigned w=get(&b,connect(&b,1,1,0))->code;
    return x+y+z+w!=5;}`;

test('owned index arrays use shared observed values without cache hits or merging identical container types',async()=>{
  const r=await inspect(pointerProgram),gs=r.graphs.filter(g=>g.storageKind==='pointer-record-array');assert.equal(gs.length,2);
  assert.notEqual(gs[0].containerId,gs[1].containerId);
  const maps=gs.map(g=>{const role=g.relations.find(r=>r.kind==='record-owned-index-array');assert.ok(role);
    assert.ok(role.evidence.some(e=>e.sourceKind==='WRITE'));
    const state=lastLive(g);assert.equal(state.length,3);assert.equal(state.capacity,8);
    assert.equal(state.nodes.length,3);assert.ok(state.edges.some(e=>e.relationId===role.id&&e.value===4294967295&&e.to===null));
    return state.edges.filter(e=>e.relationId===role.id&&e.toIndex!==null).map(e=>[e.fromIndex,e.slotIndex,e.toIndex]);});
  assert.deepEqual(maps,[[[0,0,1],[0,1,2]],[[0,0,2],[1,1,0]]]);
});

test('bounded reconstruction preserves partial coverage instead of expanding capacity',async()=>{
  const r=await inspect(pointerProgram,{maxNodes:2,maxEdges:3,maxStates:6});
  assert.ok(r.graphs.length);for(const g of r.graphs){assert.ok(g.states.length<=6);assert.equal(g.coverage.complete,false);
    assert.ok(g.states.some(s=>s.omittedNodeCount>0||s.omittedEdgeCount>0)||g.coverage.omittedStates>0);}
});

test('equal or transformed values used in unrelated storage never establish a container edge',async()=>{
  const r=await inspect(`#include <stdlib.h>
    typedef struct {int link;} R;typedef struct {R*data;int count,capacity;} V;
    void put(V*v,R r){if(v->count==v->capacity)return;v->data[v->count]=r;v->count++;}
    int main(void){V v={malloc(4*sizeof(R)),0,4};put(&v,(R){0});put(&v,(R){1});
      int other[2]={0,1};int n=v.data[0].link;int a=other[n];int b=v.data[n+1].link;
      free(v.data);return a+b!=1;}`);
  assert.deepEqual(r.graphs,[]);
});
