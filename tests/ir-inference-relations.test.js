import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {coindexedRecordStructures,queryCoindexedRecords,validateCoindexedRecords} from '../scripts/model/coindexed-record-views.mjs';
import {recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/model/structure-presentation.mjs';
const live=s=>s.states.filter(x=>x.alive).at(-1);
async function inspect(source){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);assert.equal(r.trace.events.some(e=>e.kind==='ERROR'),false);return r;
}
test('stored termination predicates support recursive, iterative and reversed-boundary representations',async()=>{
  const forms=[
    ['if(v[k]<0)return k;return seek(v,v[k]);','-4,0,1,2'],
    ['while(v[k]>=0)k=v[k];return k;','-7,0,1,2'],
    ['if(0>v[k])return k;return seek(v,v[k]);','-2,0,1,2'],
    ['if(9==v[k])return k;return seek(v,v[k]);','9,0,1,2']
  ];
  for(const [body,values]of forms){
    const r=await inspect(`int seek(int *v,int k){${body}}int main(void){int a[4]={${values}};return seek(a,3)!=0;}`),
      g=r.trace.structures.find(s=>s.kind==='value-index-graph-candidate'),s=live(g);
    assert.ok(s.topology.views.includes('parent-forest-candidate'));assert.deepEqual(s.topology.roots,[0]);
    assert.ok(s.representatives.every(n=>n.rootIndex===0));assert.equal(s.edges.find(e=>e.fromIndex===0).status,'root-termination');
    assert.equal(s.edges.find(e=>e.fromIndex===0).to,null);assert.equal(s.nodes.find(n=>n.index===0).value,Number(values.split(',')[0]));
    assert.ok(g.terminationEvidence.every(p=>p.predicate.kind==='stored-boundary'));
    const rec=recommendStructureViews(r.trace,{target:{structureId:g.id},afterExecutionId:s.afterExecutionId});
    assert.ok(rec.some(c=>c.view==='tree'));assert.ok(rec.length<=5);
  }
});
test('a stored marker is unknown before proof; writes invalidate local proof without erasing actual values',async()=>{
  const r=await inspect(`int seek(int*a,int k){if(a[k]<0)return k;return seek(a,a[k]);}
int main(void){int a[4]={-1,0,1,-2};int unused=a[3];int k=seek(a,2);a[0]=17;a[0]=-9;return k+(unused!=-2);}`),
    g=r.trace.structures.find(s=>s.kind==='value-index-graph-candidate'),proof=g.terminationConvention.inferredAtExecutionId,
    pos=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  assert.ok(g.states.filter(s=>pos.get(s.afterExecutionId)<pos.get(proof)).every(s=>!s.rootEvidence.length));
  const bad=g.writes.find(w=>w.index===0&&w.value===17),changed=g.writes.find(w=>w.value===-9),
    before=g.states.find(s=>s.afterExecutionId===bad.executionId),after=g.states.find(s=>s.afterExecutionId===changed.executionId);
  assert.equal(before.edges.find(e=>e.fromIndex===0).status,'out-of-bounds');
  assert.equal(after.rootEvidence.find(p=>p.index===0).kind,'inferred-boundary-termination');
  assert.equal(after.rootEvidence.find(p=>p.index===3).kind,'inferred-boundary-termination');
  assert.equal(g.states.at(-1).status,'ended');
});
test('comparison without exit and compound-condition exit do not invent terminal conventions',async()=>{
  for(const body of [
    'int sum=0;for(int n=0;n<4;n++){if(a[k]<0)sum++;if(a[k]<0)k=2;else k=a[k];}return sum<0;',
    'if(a[k]<0 || k==2)return 0;return 0;'
  ]){
    const r=await inspect(`int main(void){int a[3]={-1,0,1},k=a[2];k=a[k];${body}}`),
      g=r.trace.structures.find(s=>s.kind==='value-index-graph-candidate');
    assert.ok(g);assert.deepEqual(g.terminationEvidence,[]);
    assert.ok(g.states.every(s=>s.topology.roots.length===0));
  }
});
const split=`int visit(int*a,int*b,int*c,int k){if(k<0)return 0;int v=c[k];int x=a[k],y=b[k];return v+visit(a,b,c,x)+visit(a,b,c,y);}
int main(void){int q[3]={1,-1,-1},r[5]={2,-1,-1,0,0},s[4]={10,20,30,99};return visit(q,r,s,0)!=60;}`;
test('unequal split arrays form logical record alternatives and observed index links through calls',async()=>{
  const r=await inspect(split),groups=r.trace.structures.filter(s=>s.kind==='coindexed-record-candidate'),
    group=groups.find(s=>s.arrays.length===3&&s.relationEvidence.some(e=>e.sourceIndex===0&&e.targetIndex===1));
  assert.ok(group,JSON.stringify(groups.map(g=>({arrays:g.arrays.length,relations:g.relationEvidence.length}))));
  assert.deepEqual(group.arrays.map(a=>a.capacity).sort(),[3,4,5]);
  const at=r.trace.events.findLast(e=>e.kind==='FLOW'&&e.action==='call')?.eventId,
    state=queryCoindexedRecords(group,r.trace,{afterExecutionId:at});
  assert.ok(state.nodes.some(n=>n.index===0&&n.parts.length===3));assert.ok(state.edges.some(e=>e.toIndex===1));
  assert.ok(state.edges.some(e=>e.toIndex===2));assert.equal(state.topology.complete,false);
  const rec=recommendStructureViews(r.trace,{target:{structureId:group.id},afterExecutionId:at});
  assert.ok(rec.some(c=>c.view==='graph'));assert.ok(!rec.some(c=>['tree','bst','min-heap'].includes(c.view)));
  const manual=setStructurePresentation(null,r.trace,{target:{structureId:group.id},view:'tree'});
  assert.equal(resolveStructurePresentation(r.trace,{target:{structureId:group.id},afterExecutionId:at,preferences:manual}).source,'user');
  assert.equal(queryCoindexedRecords(group,r.trace).status,'ended');
  const raw=JSON.stringify({events:r.trace.events,objects:r.trace.objects}),again=coindexedRecordStructures(r.plan,r.trace);
  assert.equal(JSON.stringify({events:r.trace.events,objects:r.trace.objects}),raw);assert.deepEqual(again,groups);
});
test('initialization, equal extents and equal index numbers with independent provenance do not group arrays',async()=>{
  const r=await inspect(`int main(void){int tree[3]={1,2,0},parent[3]={1,2,0};int a=1,b=1;
int sum=tree[a]+parent[b];return sum!=4;}`);
  assert.deepEqual(r.trace.structures.filter(s=>s.kind==='coindexed-record-candidate'),[]);
});
test('coincidentally equal transformed indices and overlapping typed aliases do not create record fields',async()=>{
  for(const source of [
    'int main(void){int a[5]={1,2,3,4,5},b[5]={5,4,3,2,1},i=1;return a[i*2]+b[i+1]!=6;}',
    'int main(void){int a[3]={1,2,3},i=1;unsigned int*b=(unsigned int*)a;return a[i]+b[i]!=4;}'
  ]){const r=await inspect(source);assert.deepEqual(r.trace.structures.filter(s=>s.kind==='coindexed-record-candidate'),[]);}
});
test('overlapping A/B and B/C groups remain alternatives without a fabricated A/B/C record',async()=>{
  const r=await inspect(`int main(void){int a[3]={1,2,3},b[3]={4,5,6},c[3]={7,8,9},v=0;
for(int i=0;i<3;i++)v+=a[i]+b[i];for(int j=0;j<3;j++)v+=b[j]+c[j];return v!=60;}`),
    groups=r.trace.structures.filter(s=>s.kind==='coindexed-record-candidate');
  assert.ok(groups.length>=2);assert.ok(groups.every(g=>g.arrays.length===2));
  assert.ok(groups.every(g=>!g.relationEvidence.length));
});
test('changed index fields invalidate old edges, including stored values carried across a later write',async()=>{
  const r=await inspect(`int main(void){int a[4]={1,2,-1,0},b[5]={4,5,6,7,8},i=0,s=0;
s+=a[i]+b[i];int k=a[i];s+=b[k];k=a[i];a[i]=2;s+=b[k];return s!=15;}`),
    groups=r.trace.structures.filter(s=>s.kind==='coindexed-record-candidate');
  assert.ok(groups.length);const g=groups.find(g=>g.relationEvidence.length);assert.ok(g);
  const state=queryCoindexedRecords(g,r.trace,{afterExecutionId:g.changes.findLast(c=>c.upsertEdges.some(e=>e.status==='unconfirmed-after-write')).afterExecutionId});
  assert.ok(state.edges.some(e=>e.status==='unconfirmed-after-write'&&e.to===null));
  const liveState=queryCoindexedRecords(g,r.trace,{afterExecutionId:r.trace.events.find(e=>e.action==='return.value').eventId});
  assert.ok(liveState.edges.every(e=>e.status!=='observed'));
  const clone=structuredClone(r.trace),bad=clone.structures.find(s=>s.id===g.id);
  bad.logicalNodes[0].parts[0].range.offset++;assert.throws(()=>validateCoindexedRecords(clone),/shifted storage/);
});
test('parameter guards complete split-node topology and a later shared child removes the tree recommendation',async()=>{
  const r=await inspect(`int scan(int*x,int*y,int*z,int n){if(n<0)return 0;int s=z[n];s+=scan(x,y,z,x[n]);s+=scan(x,y,z,y[n]);return s;}
int main(void){int x[3]={1,-1,-1},y[3]={2,-1,-1},z[3]={10,20,30};int a=scan(x,y,z,0);y[0]=1;int b=scan(x,y,z,0);return a!=60||b!=50;}`),
    group=r.trace.structures.find(s=>s.kind==='coindexed-record-candidate'&&s.arrays.length===3),
    moments=group.changes.map(c=>({id:c.afterExecutionId,state:queryCoindexedRecords(group,r.trace,{afterExecutionId:c.afterExecutionId})})),
    tree=moments.find(x=>x.state.topology.complete&&x.state.topology.sharedChildren.length===0&&x.state.topology.edgeCount===2),
    dag=moments.findLast(x=>x.state.alive&&x.state.topology.complete&&x.state.topology.sharedChildren.length>0);
  assert.ok(tree);assert.ok(dag);assert.ok(group.terminationEvidence.some(p=>p.mode==='guard-before-access'));
  assert.ok(recommendStructureViews(r.trace,{target:{structureId:group.id},afterExecutionId:tree.id}).some(v=>v.view==='binary-tree'));
  assert.ok(!recommendStructureViews(r.trace,{target:{structureId:group.id},afterExecutionId:dag.id}).some(v=>['tree','binary-tree','forest'].includes(v.view)));
  for(const p of group.terminationEvidence){const before=r.trace.events.findIndex(e=>e.eventId===p.executionId)-1,
    state=queryCoindexedRecords(group,r.trace,{afterExecutionId:r.trace.events[before].eventId});
    assert.ok(!state.edges.some(e=>e.terminationExecutionId===p.executionId));}
});
test('an unrelated helper returning on negative payloads does not supply an index traversal guard',async()=>{
  const r=await inspect(`int classify(int k){if(k<0)return 1;return 0;}
int main(void){int a[4]={-1,0,1,2},i=a[3];i=a[i];int n=classify(a[0]);return n!=1;}`),
    g=r.trace.structures.find(s=>s.kind==='value-index-graph-candidate');
  assert.ok(g);assert.deepEqual(g.terminationEvidence,[]);
});
