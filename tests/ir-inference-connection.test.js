import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {validateStructureOverlays} from '../scripts/inference/structure-overlay-contract.mjs';
import {indexedNeighborhoodProofs} from '../scripts/inference/indexed-neighborhood-proofs.mjs';
import {createValueFlow} from '../scripts/inference/observed-value-flow.mjs';
const fixture=name=>readFile(new URL(`../examples/c/structure-views/${name}.c`,import.meta.url),'utf8');
async function run(source,expected){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  if(expected!==undefined)assert.equal(r.stdout,expected);
  return r;
}
const atEnd=r=>r.trace.events.findLast(e=>e.action==='output')?.eventId??r.trace.events.at(-1).eventId;
const choices=(r,name)=>recommendStructureViews(r.trace,{target:{objectId:r.trace.objects.find(o=>o.name===name).id},afterExecutionId:atEnd(r)});

// Expected edges are derived from the source's head/link/destination tables,
// before inspecting inference. Include a self edge and a disconnected root.
test('indexed adjacency joins the actual root, link and destination versions',async()=>{
  const r=await run(await fixture('indexed-graph'),'0 1 2 3 4 \n'),before=JSON.stringify(r.trace.events),
    g=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='indexed-list-access'));
  assert.ok(g,'separate index tables must compose into adjacency');
  const state=g.states.findLast(s=>s.alive),edges=state.edges.filter(e=>e.status==='observed');
  assert.equal(state.nodes.length,5);
  assert.deepEqual(edges.map(e=>`${e.fromIndex}>${e.toIndex}`).sort(),['0>1','0>2','1>3','2>2','2>4','3>0']);
  for(const name of ['first','next','to'])assert.equal(choices(r,name)[0].view,'graph',name);
  const early=recommendStructureViews(r.trace,{target:{structureId:g.id},afterExecutionId:r.trace.events[0].eventId});
  assert.equal(early.length,0);
  const bad=structuredClone(r.trace),proof=bad.structures.find(s=>s.id===g.id).evidence[0];proof.fromIndex=(proof.fromIndex+1)%5;
  assert.throws(()=>validateStructureOverlays(bad));
  // Removing cursor-write provenance must not be repaired by equal values.
  const dropped={...r.trace,events:r.trace.events.map(e=>g.evidence.some(p=>p.linkWriteExecutionId===e.eventId)?{...e,dataInputs:[]}:e)};
  assert.equal(indexedNeighborhoodProofs(r.plan,dropped,createValueFlow(r.plan,dropped)).length,0);
  assert.equal(JSON.stringify(r.trace.events),before);
});

test('pointer graph preserves all stored roles and full array range',async()=>{
  const r=await run(await fixture('pointer-graph'),'10\n'),list=choices(r,'vertices'),g=list.find(c=>c.view==='graph'),a=list.find(c=>c.view==='array');
  assert.equal(list[0].view,'graph');assert.equal(g.roleIds,null);
  assert.equal(g.coverage.representedNodeCount,5);assert.equal(g.coverage.omittedNodeCount,0);
  assert.ok(g.alternatives.some(c=>c.roleIds?.length===1&&c.coverage.excludedRoleIds.length===1));
  assert.equal(a.coverage.omittedStorageBytes,0);assert.ok(a.alternatives.some(c=>c.coverage.omittedStorageBytes>0));
  const structure=r.trace.structures.find(s=>s.id===g.candidateId),byId=new Map();
  for(const change of structure.changes){if(Number(change.afterExecutionId.slice(1))>Number(atEnd(r).slice(1)))break;for(const e of change.upsertEdges)byId.set(e.id,e);}
  assert.equal([...byId.values()].filter(e=>e.sourceTypeId&&e.status==='in-bounds').length,10);
  const target={objectId:r.trace.objects.find(o=>o.name==='vertices').id},preferences=setStructurePresentation(undefined,r.trace,{target,view:'array'});
  assert.equal(resolveStructurePresentation(r.trace,{target,preferences,afterExecutionId:atEnd(r)}).view,'array');
});

test('comparison-free FIFO uses insertion identity and never changes stack evidence',async()=>{
  const r=await run(await fixture('stack-queue'),'2 5\n6 8\n9 7\n');
  assert.equal(choices(r,'lifo')[0].view,'stack');assert.equal(choices(r,'fifo')[0].view,'queue');
  const q=r.trace.structures.find(s=>s.kind==='queue-candidate');assert.equal(q.comparisons.length,0);assert.equal(q.fifoProofs.length,3);
  const bad=structuredClone(r.trace);bad.structures.find(s=>s.id===q.id).fifoProofs[0].enqueueExecutionId=q.fifoProofs[1].enqueueExecutionId;
  assert.throws(()=>validateStructureOverlays(bad));
});

test('renamed adjacency with reordered link indices retains a cycle and parallel edges',async()=>{
  const r=await run(`#include <stdio.h>
int aa[3]={2,1,-1},bb[4]={-1,-1,3,0},cc[4]={1,0,1,2},dd[3];
int main(void){int sum=0;for(int u=0;u<3;u++){int z=aa[u];while(z>=0){int v=cc[z];sum+=dd[v];z=bb[z];}}printf("%d\\n",sum);}`,'0\n');
  const g=r.trace.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='indexed-list-access'));assert.ok(g);
  assert.deepEqual(g.states.findLast(s=>s.alive).edges.filter(e=>e.status==='observed').map(e=>`${e.fromIndex}>${e.toIndex}`).sort(),['0>1','0>1','0>2','1>0']);
});

test('equal FIFO payloads, independent scans and overwritten slots keep distinct provenance',async()=>{
  const r=await run(`#include <stdio.h>
int a[6],b[6],c[6],x,y,h,t,p,q;
int main(void){a[y++]=9;a[y++]=9;int sum=a[x++]+a[x++];
b[t++]=9;b[0]=8;sum+=b[h++];
for(int i=0;i<2;i++)c[q++]=i;for(int i=0;i<2;i++)a[i]=c[p++];
printf("%d\\n",sum);}`,'26\n');
  const queues=r.trace.structures.filter(s=>s.kind==='queue-candidate'),names=queues.map(s=>r.trace.objects.find(o=>o.id===s.objectId).name);
  assert.ok(names.includes('a'));assert.ok(!names.includes('b'));assert.ok(!names.includes('c'));
  const q=queues.find(s=>r.trace.objects.find(o=>o.id===s.objectId).name==='a');
  assert.equal(q.fifoProofs.length,2);assert.notEqual(q.fifoProofs[0].enqueueExecutionId,q.fifoProofs[1].enqueueExecutionId);
});

test('an arithmetic table scan is not a linked adjacency walk',async()=>{
  const r=await run(`#include <stdio.h>
int aa[3]={0,1,2},bb[3]={1,2,-1},cc[3]={2,0,1},dd[3]={8,6,4};
int main(void){int sum=0;for(int u=0;u<3;u++){int z=aa[u];while(z<3){int v=cc[z];sum+=dd[v];z++;}}printf("%d\\n",sum);}`,'38\n');
  assert.ok(!r.trace.structures.some(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='indexed-list-access')));
});

test('full-array graph ranking does not displace the observed BST',async()=>{
  const r=await run(await fixture('tree')),c=choices(r,'nodes');assert.equal(c[0].view,'bst');
  assert.equal(c[0].coverage.representedNodeCount,7);
});
