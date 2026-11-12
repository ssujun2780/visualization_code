import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';

async function inspect(source,stdout){
  const result=await traceModel(source);
  assert.equal(result.trace.status,'completed',JSON.stringify(result.trace.diagnostics));
  assert.equal(result.stdout,stdout);
  assert.deepEqual(result.trace.coverage.irGaps,[]);
  assert.deepEqual(result.trace.coverage.observationAccounting.unexplained,[]);
  return {...result,linked:result.trace.structures.filter(s=>s.kind==='linked-structure')};
}
const rootFor=(result,name)=>{
  const object=result.trace.objects.find(o=>o.name===name);
  assert.ok(object,`missing pointer storage ${name}`);
  const candidate=result.linked.find(s=>s.root.kind==='pointer-slot'&&s.root.objectId===object.id);
  assert.ok(candidate,`missing linked root ${name}`);return candidate;
};
const memberIds=c=>c.logicalNodes.filter(n=>n.membershipEvidence==='observed root reachability').map(n=>n.id).sort();

test('root declarations propagate through wrapper parameters and local aliases without requiring a changing pointer',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct A {struct A*r;int x;} A;
int count(A*input){A*alias=input;int total=0;for(A*walk=alias;walk;walk=walk->r)total+=walk->x;return total;}
int middle(A*received){A*forwarded=received;return count(forwarded);}
int outer(int unused,A*item){(void)unused;return middle(item);}
int main(void){A*origin=calloc(3,sizeof*origin);if(!origin)return 1;
origin[0].x=4;origin[1].x=7;origin[2].x=2;origin[0].r=&origin[1];origin[1].r=&origin[2];
printf("%d\\n",outer(9,origin));free(origin);return 0;}`,'13\n');
  const candidate=rootFor(r,'origin'),decl=r.plan.declarations.find(d=>d.name==='origin'),
    evidence=r.plan.structureBindings.linkRootOrigins.filter(o=>o.rootDeclarationId===decl.id);
  assert.ok(evidence.some(o=>o.callInstructionIds.length===3&&o.viaDeclarationIds.length>=6));
  assert.ok(candidate.views.includes('singly-linked-candidate'));
  assert.ok(candidate.states.some(s=>s.reachableMembers.length===3&&s.orders[0].termination==='null'));
  assert.equal(new Set(candidate.logicalNodes.map(n=>n.objectId)).size,1);
  const stride=candidate.roles[0].recordType.sizeBits/8;
  assert.deepEqual(candidate.logicalNodes.map(n=>n.offset).sort((a,b)=>a-b),[0,stride,2*stride]);
  assert.equal(candidate.states.at(-1).endedMembers.length,3);
});

test('different roots and repeated wrapper activations keep disjoint interior lists in the same allocation',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct B {int x;unsigned marker;struct B*z;} B;
int scan(B*head){int sum=0;for(B*p=head;p;p=p->z)sum+=p->x;return sum;}
int relay(B*arg){B*copy=arg;return scan(copy);}
int main(void){B*storage=calloc(4,sizeof*storage);if(!storage)return 1;
storage[0].x=1;storage[1].x=2;storage[2].x=7;storage[3].x=9;
storage[0].z=&storage[1];storage[2].z=&storage[3];B*left=storage;B*right=storage+2;
int a=relay(left),b=relay(right),c=relay(left);printf("%d %d %d\\n",a,b,c);free(storage);return 0;}`,'3 16 3\n');
  const left=rootFor(r,'left'),right=rootFor(r,'right'),leftIds=memberIds(left),rightIds=memberIds(right);
  assert.equal(leftIds.length,2);assert.equal(rightIds.length,2);assert.ok(leftIds.every(id=>!rightIds.includes(id)));
  assert.equal(left.logicalNodes[0].objectId,right.logicalNodes[0].objectId);
  const stride=left.roles[0].recordType.sizeBits/8;
  assert.deepEqual(left.logicalNodes.map(n=>n.offset).sort((a,b)=>a-b),[0,stride]);
  assert.deepEqual(right.logicalNodes.map(n=>n.offset).sort((a,b)=>a-b),[2*stride,3*stride]);
  const copyObjects=r.trace.objects.filter(o=>o.name==='copy'),copies=copyObjects.map(o=>r.linked.find(s=>s.root.objectId===o.id));
  assert.equal(copies.length,3);assert.ok(copies.every(Boolean));assert.equal(new Set(copies.map(c=>c.root.objectId)).size,3);
  assert.deepEqual(copies.map(memberIds),[leftIds,rightIds,leftIds]);
  assert.ok(copies.every(c=>c.states.at(-1).rootAlive===false));
  assert.ok([...copies,left,right].every(c=>c.states.every(s=>s.reachableMembers.length<=2)));
});

test('repeated local-root declarations and freed allocations stay separate by observed object identity',async()=>{
  const r=await inspect(`#include <stdlib.h>
#include <stdio.h>
typedef struct C {struct C*jump;int v;} C;
int sum(C*first){int value=0;for(C*it=first;it;it=it->jump)value+=it->v;return value;}
int make(int v){C*owned=calloc(2,sizeof*owned);if(!owned)exit(1);owned[0].v=v;owned[1].v=v+1;owned[0].jump=&owned[1];
int result=sum(owned);free(owned);return result;}
int main(void){int x=make(2),y=make(8);printf("%d %d\\n",x,y);return 0;}`,'5 17\n');
  const owners=r.trace.objects.filter(o=>o.name==='owned'),roots=owners.map(o=>r.linked.find(s=>s.root.objectId===o.id));
  assert.equal(roots.length,2);assert.ok(roots.every(Boolean));
  assert.notEqual(roots[0].root.objectId,roots[1].root.objectId);
  assert.notEqual(roots[0].logicalNodes[0].objectId,roots[1].logicalNodes[0].objectId);
  assert.ok(roots.every(c=>memberIds(c).length===2&&c.states.at(-1).endedMembers.length===2));
});

test('an observed returned pointer can be a root without inventing a static return-alias path',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct D {int value;struct D*edge;} D;
D*identity(D*p){return p;}
int add(D*arg){int n=0;for(D*p=arg;p;p=p->edge)n+=p->value;return n;}
int main(void){D a={2,0},b={4,0};a.edge=&b;D*seed=&a;D*returned=identity(seed);
printf("%d\\n",add(returned));return 0;}`,'6\n');
  const returned=rootFor(r,'returned'),seed=r.plan.declarations.find(d=>d.name==='seed');
  assert.equal(memberIds(returned).length,2);
  assert.ok(!r.plan.structureBindings.linkRootDeclarations.includes(seed.id));
  assert.ok(!r.plan.structureBindings.linkRootOrigins.some(o=>o.rootDeclarationId===seed.id));
});

test('array decay arguments use separate non-cursor parameter roots for each invocation and interior offset',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct E {struct E*next;int v;} E;
int scan(E*received){int s=0;for(E*cursor=received;cursor;cursor=cursor->next)s+=cursor->v;return s;}
int main(void){E storage[4]={{.v=1},{.v=2},{.v=7},{.v=9}};
storage[0].next=&storage[1];storage[2].next=&storage[3];
int x=scan(storage),y=scan(&storage[2]),z=scan(storage);printf("%d %d %d\\n",x,y,z);return 0;}`,'3 16 3\n');
  const parameters=r.trace.objects.filter(o=>o.name==='received'),roots=parameters.map(o=>r.linked.find(s=>s.root.objectId===o.id)),
    cursorIds=new Set(r.trace.objects.filter(o=>o.name==='cursor').map(o=>o.id));
  assert.equal(roots.length,3);assert.ok(roots.every(Boolean));
  assert.ok(r.linked.every(s=>!cursorIds.has(s.root.objectId)));
  assert.equal(new Set(roots.map(s=>s.root.objectId)).size,3);
  const stride=roots[0].roles[0].recordType.sizeBits/8;
  assert.deepEqual(roots.map(s=>s.logicalNodes.map(n=>n.offset).sort((a,b)=>a-b)),[[0,stride],[2*stride,3*stride],[0,stride]]);
  assert.equal(new Set(roots.flatMap(s=>s.logicalNodes.map(n=>n.objectId))).size,1);
  assert.ok(roots.every(s=>s.states.some(state=>state.rootAlive&&state.reachableMembers.length===2)&&s.states.at(-1).rootAlive===false));
});

test('a direct call-result argument uses observed parameter storage while its return-alias path stays unknown',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct F {int value;struct F*hop;} F;
F*identity(F*value){return value;}
int visit(F*received){int total=0;for(F*cursor=received;cursor;cursor=cursor->hop)total+=cursor->value;return total;}
int main(void){F objects[2]={{.value=4},{.value=6}};objects[0].hop=&objects[1];F*seed=objects;
printf("%d\\n",visit(identity(seed)));return 0;}`,'10\n');
  const candidate=rootFor(r,'received'),seed=r.plan.declarations.find(d=>d.name==='seed');
  assert.equal(memberIds(candidate).length,2);
  assert.ok(!r.plan.structureBindings.linkRootDeclarations.includes(seed.id));
  assert.ok(!r.plan.structureBindings.linkRootOrigins.some(o=>o.rootDeclarationId===seed.id));
});
