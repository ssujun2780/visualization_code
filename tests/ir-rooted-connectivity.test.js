import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {rootedConnectivity} from '../scripts/model/rooted-connectivity.mjs';

async function inspect(source,stdout){
  const result=await traceModel(source);
  assert.equal(result.trace.status,'completed',JSON.stringify(result.trace.diagnostics));
  assert.equal(result.stdout,stdout);
  assert.deepEqual(result.trace.coverage.irGaps,[]);
  assert.deepEqual(result.trace.coverage.observationAccounting.unexplained,[]);
  return result;
}

test('recursive pointer slots discover both links and mixed paths while preserving real temporary storage',async()=>{
  const {plan,trace}=await inspect(`#include <stdio.h>
#include <stdlib.h>
typedef struct R {struct R *z; int n; struct R *q;} R;
void put(R **p,int value){if(!*p){*p=malloc(sizeof **p);if(!*p)exit(1);**p=(R){.n=value,.z=0,.q=0};return;}
 if(value<(*p)->n)put(&(*p)->q,value);else put(&(*p)->z,value);}
int sum(R*p){if(!p)return 0;int x=sum(p->q),y=sum(p->z);return x+y+p->n;}
int main(void){R*h=0;int values[]={8,4,12,2,6,10,14};for(int i=0;i<7;i++)put(&h,values[i]);
 printf("%d\\n",sum(h));R*cut=h->q;h->q=0;free(cut->q);free(cut);
 h->z->q=h->z->z;h->z->z->z=h;return 0;}`,'56\n');
  const root=trace.objects.find(o=>o.name==='h'),candidate=trace.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id);
  assert.ok(candidate);assert.equal(candidate.roles.length,2);
  assert.ok(plan.structureBindings.linkRecurrences.some(r=>r.callInstructionIds.length));
  const full=candidate.states.find(s=>s.topology.status==='tree'&&s.topology.nodeCount===7);
  assert.ok(full);assert.equal(full.topology.edgeCount,6);assert.ok(full.topology.views.includes('binary-tree-candidate'));
  assert.equal(full.topology.ordering.status,'unknown');assert.ok(!candidate.views.includes('singly-linked-candidate'));
  assert.ok(candidate.states.some(s=>s.detachedMembers.length===3));
  assert.ok(candidate.states.some(s=>s.topology.sharedChildren.length));
  assert.ok(candidate.states.some(s=>s.topology.cyclic));
  assert.ok(candidate.states.some(s=>s.endedMembers.length===2));
  assert.equal(candidate.logicalNodes.filter(n=>n.membershipEvidence==='observed root reachability').length,7);
  const temporaryIds=candidate.storageNodes.filter(n=>n.sourceTemporary).map(n=>n.id);
  assert.equal(temporaryIds.length,7);
  assert.ok(candidate.states.every(s=>s.reachableMembers.every(id=>!temporaryIds.includes(id))));
  assert.equal(candidate.states.at(-1).temporaryStorage.endedNodeIds.length,7);
});

test('mutual recursion follows parameter identities across reordered argument slots and a stable root',async()=>{
  const {plan,trace}=await inspect(`#include <stdio.h>
typedef struct T {int v;struct T *m,*n;} T;
int a(T*,int);
int b(int k,T*p){return a(p,k);}
int a(T*p,int k){if(!p)return 0;int x=b(k,p->m),y=b(k,p->n);return p->v+x+y;}
int main(void){T l={2,0,0},r={3,0,0},t={1,&l,&r};T*fixed=&t;printf("%d\\n",a(fixed,0));return 0;}`,'6\n');
  const root=trace.objects.find(o=>o.name==='fixed'),candidate=trace.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id);
  assert.ok(candidate);assert.ok(candidate.states.some(s=>s.topology.nodeCount===3&&s.topology.status==='tree'));
  assert.equal(candidate.roles.length,2);
  assert.ok(plan.structureBindings.linkRecurrences.some(r=>r.callInstructionIds.length>=2));
});

test('a one-way call using a field is not recurrence evidence',async()=>{
  const {plan,trace}=await inspect(`#include <stdio.h>
typedef struct T {int v;struct T*p;} T;
int value(T*p){return p?p->v:0;}
int main(void){T b={3,0},a={1,&b};printf("%d\\n",value(a.p));return 0;}`,'3\n');
  assert.equal(plan.structureBindings.linkRoles.length,0);
  assert.equal(trace.structures.filter(s=>s.kind==='linked-structure').length,0);
});

test('topology keeps missing, ended, cyclic and shared relations without claiming a complete tree',()=>{
  const nodes=new Map(['a','b','c'].map(id=>[id,{id}])),roles=[{fieldNodeId:'f'},{fieldNodeId:'g'}],slots=new Map(),alive=new Set(nodes.keys());
  const set=(from,field,to)=>slots.set(`${from}:${field}`,{from,to,fieldNodeId:field,status:to?'in-bounds':'null'});
  for(const id of nodes.keys())for(const role of roles)set(id,role.fieldNodeId,null);
  set('a','f','b');set('b','g','c');
  const read=()=>rootedConnectivity('a',{nodes,roles,rootStatus:'in-bounds',relation:(n,r)=>slots.get(`${n.id}:${r.fieldNodeId}`),isAlive:n=>alive.has(n.id)});
  assert.equal(read().status,'tree');assert.deepEqual(read().reachableNodeIds,['a','b','c']);
  slots.delete('c:g');assert.equal(read().status,'partial');assert.equal(read().unknownRelations.length,1);
  set('c','g',null);alive.delete('c');assert.equal(read().status,'partial');assert.deepEqual(read().endedTargetNodeIds,['c']);
  alive.add('c');set('a','g','c');assert.equal(read().status,'graph');assert.equal(read().sharedChildren.length,1);
  set('c','f','a');assert.equal(read().cyclic,true);assert.ok(!read().views.includes('binary-tree-candidate'));
});
