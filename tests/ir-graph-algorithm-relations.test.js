import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {recommendStructureViews,validateStructureTrace} from '../scripts/inference/index.mjs';
const object=(t,name)=>t.objects.find(o=>o.name===name&&o.storage==='static');
const edges=s=>s.states.at(-1).edges.filter(e=>e.status==='observed').map(e=>[e.fromIndex,e.toIndex]).sort();
async function run(code,output){const r=await traceWithStructureView(code,{filename:'relation-variation.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,output);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r;
}
test('count-controlled ring uses FIFO writer identity across wrap and equal payloads',async()=>{
  const {trace:t,plan}=await run(String.raw`#include <stdio.h>
int cells[3],a=2,b=2,c;
void put(int v){cells[b]=v;b=(b+1)%3;c++;}
int take(void){int v=cells[a];a=(a+1)%3;c--;return v;}
int main(void){put(5);put(5);put(7);for(int j=0;j<2;j++)printf("%d ",take());put(9);while(c)printf("%d ",take());return 0;}`,'5 5 7 9 ');
  const q=t.structures.find(s=>s.kind==='queue-candidate'&&s.layout==='ring');assert.ok(q);
  assert.deepEqual(q.operations.filter(o=>o.kind==='enqueue').map(o=>o.index),[2,0,1,2]);
  assert.deepEqual(q.operations.filter(o=>o.kind==='dequeue').map(o=>o.index),[2,0,1,2]);
  assert.deepEqual(q.operations.filter(o=>o.kind==='dequeue').map(o=>o.consumedWriteExecutionId),q.operations.filter(o=>o.kind==='enqueue').map(o=>o.accessExecutionId));
  assert.equal(q.states.at(-1).count,0);assert.deepEqual(q.states.at(-1).ringOrder.indices,[]);
  for(const tamper of ['writer','order','count']){const copy=structuredClone(t),s=copy.structures.find(s=>s.id===q.id);
    if(tamper==='writer')s.operations.find(o=>o.kind==='dequeue').consumedWriteExecutionId=s.operations[1].accessExecutionId;
    if(tamper==='order')s.states[1].ringOrder.indices.reverse();if(tamper==='count')s.states[1].count++;
    assert.throws(()=>validateStructureTrace(plan,copy),tamper);
  }
});
test('count and circular writes alone do not prove FIFO',async()=>{
  const {trace:t}=await run(String.raw`#include <stdio.h>
int cells[4],a,b,c;int main(void){for(int i=0;i<3;i++){cells[b]=i;b=(b+1)%4;c++;}
a=2;while(c){printf("%d ",cells[a]);a=(a+3)%4;c--;}return 0;}`,'2 1 0 ');
  assert.ok(!t.structures.some(s=>s.kind==='queue-candidate'&&s.objectId===object(t,'cells').id));
});
test('matrix predicate with a destination read or branch write recovers observed edges',async()=>{
  const {trace:t,plan}=await run(String.raw`#include <stdio.h>
int cells[4][4]={{0,1,0,1},{0},{1},{0}},seen[4],hits[4];
int main(void){for(int a=0;a<3;a++)for(int b=0;b<4;b++){
 if(cells[a][b]&&!seen[b])seen[b]=1;
 if(cells[a][b])hits[b]++;
}printf("%d %d %d\n",hits[0],hits[1],hits[3]);return 0;}`,'1 1 1\n');
  for(const name of ['seen','hits']){const s=t.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.vertexDomain.range.objectId===object(t,name).id);
    assert.ok(s);assert.deepEqual(edges(s),[[0,1],[0,3],[2,0]]);
    const copy=structuredClone(t),p=copy.structures.find(x=>x.id===s.id).evidence.find(p=>p.kind==='matrix-gated-access');p.toIndex=2;
    assert.throws(()=>validateStructureTrace(plan,copy));}
});
test('counted adjacency retains non-enqueued destinations, empty rows and unused capacity',async()=>{
  const {trace:t}=await run(String.raw`#include <stdio.h>
int cells[5][3]={{2,3,4},{2,4,3},{4,3,1},{4,2,1},{1,2,3}},used[5]={2,1,1,1,0},state[5];
int main(void){for(int a=0;a<5;a++)for(int b=0;b<used[a];b++){int x=cells[a][b];state[x]++;}
printf("%d %d %d\n",state[2],state[3],state[4]);return 0;}`,'2 1 2\n');
  const s=t.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.vertexDomain.range.objectId===object(t,'state').id);
  assert.ok(s);assert.deepEqual(edges(s),[[0,2],[0,3],[1,2],[2,4],[3,4]]);
});
test('row totals and stride copies are not graph or index-tree evidence',async()=>{
  const {trace:t}=await run(String.raw`#include <stdio.h>
typedef struct {int value,pad;} Cell;Cell cells[8];int table[3][3]={{1,2,3},{4,5,6},{7,8,9}},totals[3];
int main(void){for(int a=0;a<3;a++)for(int b=0;b<3;b++)if(table[a][b])totals[a]+=table[a][b];
for(int i=0;i<3;i++)cells[2*i]=(Cell){totals[i],0};printf("%d\n",totals[2]);return 0;}`,'24\n');
  assert.ok(!t.structures.some(s=>s.kind==='observed-traversal-graph-candidate'||s.kind==='index-tree'));
});
test('whole-record COPY heap derives index relations and ordering from a nonfirst field',async()=>{
  const {trace:t,plan}=await run(String.raw`#include <stdio.h>
typedef struct {int payload;int score;} Cell;Cell cells[9];int used;
void put(int v){int k=used++;while(k){int p=(k-1)/2;if(cells[p].score>=v)break;cells[k]=cells[p];k=p;}cells[k]=(Cell){99,v};}
Cell take(void){Cell out=cells[0],save=cells[--used];int k=0;while(2*k+1<used){int c=2*k+1;if(c+1<used&&cells[c+1].score>cells[c].score)c++;if(save.score>=cells[c].score)break;cells[k]=cells[c];k=c;}cells[k]=save;return out;}
int main(void){put(8);put(3);put(12);put(12);put(1);printf("A ");while(used){Cell x=take();printf("%d ",x.score);}return 0;}`,'A 12 12 8 3 1 ');
  const s=t.structures.find(s=>s.kind==='index-tree'&&s.objectId===object(t,'cells').id);assert.ok(s);assert.equal(s.status,'supported');
  assert.equal(s.orderingProperty.offset,4);assert.equal(s.orderingProperty.size,4);assert.ok(s.copyAccessEvidence.length>0);
  const at=t.events.find(e=>e.action==='output'&&e.text==='A ').eventId,pos=new Map(t.events.map((e,i)=>[e.eventId,i])),st=s.states.findLast(x=>pos.get(x.afterExecutionId)<=pos.get(at));
  assert.equal(st.activeRange.count,5);assert.equal(st.max.status,'satisfied');assert.equal(st.min.status,'violated');
  assert.ok(recommendStructureViews(t,{target:{objectId:s.objectId},afterExecutionId:at}).some(x=>x.view==='max-heap'));
  const copy=structuredClone(t);copy.structures.find(x=>x.id===s.id).copyAccessEvidence[0].index++;
  assert.throws(()=>validateStructureTrace(plan,copy));
});
