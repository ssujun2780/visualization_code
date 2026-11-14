import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {validateStructureTrace,recommendStructureViews} from '../scripts/inference/index.mjs';

const code=String.raw`#include <stdio.h>
typedef struct {int a,b,c;} Row;
typedef struct {int incoming,total;} Cell;
Row rows[5]={{0,1,4},{0,2,7},{1,3,2},{2,3,3},{0,1,9}};
Cell pool[5];
int main(void){
 for(int u=0;u<4;u++){
  pool[u].total=0;
  for(int k=0;k<5;k++)if(rows[k].a==u){
   int v=rows[k].b;
   pool[v].incoming++;
   pool[u].total+=rows[k].c;
  }
 }
 puts("ready");
 printf("%d\n",pool[0].total);
 return 0;
}`;
const run=async source=>{
  const r=await traceWithStructureView(source,{filename:'anonymous-records.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'ready\n20\n');
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r;
};
test('record edge endpoints form another record domain before later computation',async()=>{
  const r=await run(code),s=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access'));
  assert.ok(s,'edge-list candidate');
  const positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i])),ready=r.trace.events.find(e=>e.action==='output'&&e.text==='ready\n');
  const state=s.states.findLast(s=>positions.get(s.afterExecutionId)<=positions.get(ready.eventId));
  assert.deepEqual(state.nodes.map(n=>n.index).sort(),[0,1,2,3],'unused capacity is not a vertex');
  const edges=state.edges.filter(e=>e.status==='observed');
  assert.deepEqual(edges.map(e=>[e.fromIndex,e.toIndex]).sort(),[[0,1],[0,1],[0,2],[1,3],[2,3]]);
  assert.deepEqual(edges.map(e=>Number(e.properties.find(p=>p.role==='edge-update-attribute')?.value.decimal)).sort((a,b)=>a-b),[2,3,4,7,9]);
  assert.ok(edges.every(e=>e.weightRange));
  assert.ok(recommendStructureViews(r.trace,{target:{objectId:s.vertexDomain.range.objectId},afterExecutionId:ready.eventId}).some(x=>x.view==='graph'));
  for(const field of ['toIndex','branchExecutionId','fromReadExecutionId']){
    const copy=structuredClone(r.trace),candidate=copy.structures.find(x=>x.id===s.id),p=candidate.evidence[0];
    p[field]=field==='toIndex'?4:r.trace.events[0].eventId;
    assert.throws(()=>validateStructureTrace(r.plan,copy),field);
  }
});
test('field and declaration renaming do not select graph semantics',async()=>{
  const renamed=code.replaceAll('Row','Envelope').replaceAll('Cell','Bucket').replaceAll('rows','cargo').replaceAll('pool','ledger')
    .replaceAll('.a','.departure').replaceAll('.b','.arrival').replaceAll('.c','.amount')
    .replace('int a,b,c;','int departure,arrival,amount;');
  const r=await run(renamed);
  assert.ok(r.trace.structures.some(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access')));
});
test('transformed destination index does not become an unchanged stored endpoint',async()=>{
  const r=await traceWithStructureView(code.replace('int v=rows[k].b;','int v=(rows[k].b+1)%4;'),{filename:'transformed-records.c'});
  assert.equal(r.trace.status,'completed');
  assert.ok(!r.trace.structures.some(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access')));
});
test('a copied edge payload is not an additive weight observation',async()=>{
  const r=await traceWithStructureView(code.replace('pool[u].total+=rows[k].c;','pool[u].total=rows[k].c;'),{filename:'copied-payload.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'ready\n9\n');
  const graph=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access'));
  assert.ok(graph);assert.ok(graph.states.every(s=>s.edges.every(e=>!e.weightRange)));
});
test('rewriting an endpoint invalidates its old connection until observed again',async()=>{
  const r=await run(code.replace('puts("ready");','puts("ready"); rows[0].b=3;'));
  const graph=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access'));
  const old=graph.states.at(-1).edges.filter(e=>e.fromIndex===0&&e.toIndex===1);
  assert.equal(old.filter(e=>e.status==='observed').length,1);
  assert.equal(old.filter(e=>e.status==='unconfirmed-after-write').length,1);
});
test('a transformed cost is not displayed as the unchanged stored edge weight',async()=>{
  const r=await traceWithStructureView(code.replace('pool[u].total+=rows[k].c;','pool[u].total+=2*rows[k].c;'),{filename:'transformed-cost.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'ready\n40\n');
  const graph=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='edge-list-gated-access'));
  assert.ok(graph);assert.ok(graph.states.every(s=>s.edges.every(e=>!e.weightRange)));
});
