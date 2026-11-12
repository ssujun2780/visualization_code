import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {rootedConnectivity} from '../scripts/inference/rooted-connectivity.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  return {...r,linked:r.trace.structures.filter(s=>s.kind==='linked-structure')};
}

test('reordered child and parent fields retain embedded sentinel identity, valid alternatives and corrupt intermediate topology',async()=>{
  const r=await inspect(`typedef struct N N;struct N{N*up;int payload;N*b;N*a;};
typedef struct{int header;N stop;N*origin;} T;
int descend(T*t,N*p){if(p==&t->stop)return 0;return 1+descend(t,p->b)+descend(t,p->a);}
int climb(T*t,N*p){int n=0;while(p!=&t->stop){n++;p=p->up;}return n;}
int main(void){T box={0};N a={0},b={0},c={0};
box.stop.up=&box.stop;box.stop.b=&box.stop;box.stop.a=&box.stop;box.origin=0;box.origin=&a;
a.up=&box.stop;a.b=&b;a.a=&c;b.up=&a;c.up=&a;
b.b=&box.stop;b.a=&box.stop;c.b=&box.stop;c.a=&box.stop;
int count=descend(&box,box.origin)+climb(&box,&b);
b.up=&c;b.up=&a;
a.a=&b;a.a=&c;
c.a=&a;c.a=&box.stop;
return count;}`,5);
  const box=r.trace.objects.find(o=>o.name==='box'),candidate=r.linked.find(s=>s.root.objectId===box.id&&s.root.kind==='pointer-slot');
  assert.ok(candidate);assert.ok(candidate.views.includes('binary-tree-candidate'));assert.ok(!candidate.views.includes('doubly-linked-candidate'));
  const group=candidate.roleGroups.find(g=>g.fieldNodeIds.length===2&&g.auxiliaryFieldNodeIds.length===1);assert.ok(group);
  const offsets=new Map(candidate.roles.map(role=>[role.fieldNodeId,role.offset]));
  assert.deepEqual(group.fieldNodeIds.map(id=>offsets.get(id)).sort((a,b)=>a-b),[8,12]);
  assert.deepEqual(group.auxiliaryFieldNodeIds.map(id=>offsets.get(id)),[0]);
  const valid=candidate.states.filter(s=>s.rootAlive&&s.topology.status==='tree'&&s.topology.nodeCount===3);
  assert.ok(valid.some(s=>s.topology.edgeCount===2&&s.inconsistencies.length===0));
  const boundary=valid.at(-1).boundaries.find(b=>b.objectId===box.id);assert.ok(boundary);assert.equal(boundary.offset,4);assert.equal(boundary.size,16);
  assert.ok(!valid.at(-1).topology.reachableNodeIds.includes(boundary.nodeId));
  assert.ok(valid.at(-1).topology.edges.some(e=>e.termination==='sentinel'&&e.to===boundary.nodeId&&e.reference.targetOffset===4));
  assert.ok(candidate.states.some(s=>s.topology.sharedChildren.length>0&&s.topology.status==='graph'));
  assert.ok(candidate.states.some(s=>s.topology.cyclic&&s.topology.status==='graph'));
  assert.ok(candidate.states.some(s=>s.inconsistencies.some(i=>i.oppositeFieldNodeIds.length===2)));
  assert.ok(candidate.warningEpisodes.some(w=>w.status==='transient-resolved'&&w.resolvedAtExecutionId));
  const last=candidate.states.filter(s=>s.rootAlive).at(-1);assert.equal(last.topology.status,'tree');assert.deepEqual(last.inconsistencies,[]);
});

test('ordinary doubly linked relations retain both repaired-update and unresolved corruption episodes',async()=>{
  const r=await inspect(`typedef struct M M;struct M{M*back;int value;M*front;};
int scan(M*p,int reverse){int sum=0;while(p){sum+=p->value;p=reverse?p->back:p->front;}return sum;}
int main(void){M a={0},b={0};M*head=0;head=&a;a.value=2;b.value=3;a.front=&b;b.back=&a;
int total=scan(head,0)+scan(&b,1);
b.back=0;b.back=&a;
b.back=&b;
return total;}`,10);
  const head=r.trace.objects.find(o=>o.name==='head'),candidate=r.linked.find(s=>s.root.objectId===head.id);
  assert.ok(candidate);assert.ok(candidate.views.includes('doubly-linked-candidate'));
  assert.ok(candidate.states.some(s=>s.rootAlive&&s.reachableMembers.length===2&&!s.inconsistencies.length));
  assert.ok(candidate.warningEpisodes.some(w=>w.status==='transient-resolved'));
  assert.ok(candidate.warningEpisodes.some(w=>w.status==='unresolved-at-end'&&!w.resolvedAtExecutionId));
  const last=candidate.states.filter(s=>s.rootAlive).at(-1);assert.ok(last.inconsistencies.length);
  for(const issue of last.inconsistencies)assert.ok(candidate.warningEpisodes.some(w=>w.id===issue.episodeId));
});

test('a termination boundary keeps its raw edge and cannot hide an ended root or target',()=>{
  const nodes=new Map(['a','nil'].map(id=>[id,{id}])),roles=[{fieldNodeId:'f'}],alive=new Set(['a','nil']),
    edges=new Map([['a',{from:'a',to:'nil',fieldNodeId:'f',status:'in-bounds',reference:{targetObjectId:'storage',targetOffset:12}}],
      ['nil',{from:'nil',to:'nil',fieldNodeId:'f',status:'in-bounds'}]]),
    options={nodes,roles,relation:n=>edges.get(n.id),isAlive:n=>alive.has(n.id),isTerminal:n=>n.id==='nil',rootStatus:'in-bounds'};
  const tree=rootedConnectivity('a',options);assert.equal(tree.nodeCount,1);assert.equal(tree.edgeCount,0);assert.equal(tree.status,'tree');
  assert.equal(tree.edges[0].to,'nil');assert.equal(tree.edges[0].reference.targetOffset,12);assert.equal(tree.edges[0].termination,'sentinel');
  assert.equal(rootedConnectivity('nil',options).status,'empty');
  alive.delete('nil');const root=rootedConnectivity('nil',options),target=rootedConnectivity('a',options);
  assert.equal(root.status,'partial');assert.deepEqual(root.endedTargetNodeIds,['nil']);
  assert.equal(target.status,'partial');assert.deepEqual(target.endedTargetNodeIds,['nil']);
});
