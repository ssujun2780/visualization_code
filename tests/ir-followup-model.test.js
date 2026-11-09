import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,recommendStructureViews,queryStorageReferences} from '../scripts/model/index.mjs';
async function inspect(source,stdout=''){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);r.defs=new Map(r.plan.instructions.map(d=>[d.id,d]));return r;
}
const of=(r,kind)=>r.trace.structures.filter(s=>s.kind===kind);
const atEnd=r=>r.trace.events.find(e=>e.action==='call'&&e.callee==='@printf')?.eventId??r.trace.events.findLast(e=>e.action==='return.value')?.eventId;

test('anonymous nested aggregates and zero-fill loops retain the real member path',async()=>{
  const r=await inspect(`typedef struct B B;struct B{int z,v[3];B*c[4];union{int number;struct{B*one,*two;}pair;}u;};
int main(void){B a={0},b={0},c={0};B root={.z=1,.v={3,4},.c={&a,&b,&c},.u.pair={&a,&b}};
return root.v[2]!=0||root.c[3]!=0||root.u.pair.two!=&b;}`);
  const root=r.trace.objects.find(o=>o.name==='root'),writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===root.id),
    member=name=>root.cType.members.find(m=>m.name===name).offsetBits/8;
  for(const [name,bytes]of [['v',12],['c',16]])for(const w of writes.filter(w=>w.target.offset>=member(name)&&w.target.offset<member(name)+bytes)){
    const p=r.defs.get(w.instructionId).targetPath;assert.equal(p[0].name,name);assert.equal(p.length,2);
    if(p[1].index!==null)assert.equal(Number(p[1].index),(w.target.offset-member(name))/4);
    assert.ok(w.value.cType);
  }
  for(const w of writes.filter(w=>w.target.offset>=member('u'))){assert.deepEqual(r.defs.get(w.instructionId).memberPath.slice(0,2),['u','pair']);assert.equal(w.value.cType.kind,'pointer');}
});

test('anonymous global postfix reads keep unsigned type and old values through wrapping',async()=>{
  const r=await inspect(`#include <limits.h>
struct{unsigned amount;} state={UINT_MAX-1};
int main(void){unsigned old=state.amount++;unsigned next=state.amount++;return old!=UINT_MAX-1||next!=UINT_MAX||state.amount!=0;}`);
  const o=r.trace.objects.find(o=>o.name==='state'),reads=r.trace.events.filter(e=>e.kind==='READ'&&e.target?.objectId===o.id);
  assert.deepEqual(reads.map(e=>e.value.decimal),['4294967294','4294967295','0']);
  assert.ok(reads.every(e=>e.value.cType.signedness==='unsigned'));assert.equal(r.plan.declarations.find(d=>d.name==='state').cType.kind,'record');
});

test('header statistics do not turn a comparison boundary into a payload node',async()=>{
  const r=await inspect('typedef struct N{int count;struct N*hop;}N;int main(void){N h={2,0},a={5,0},b={8,0};h.hop=&a;a.hop=&b;b.hop=&h;int sum=h.count;for(N*p=h.hop;p!=&h;p=p->hop)sum+=p->count;return sum!=15;}');
  assert.ok(of(r,'linked-structure').some(s=>s.states.some(t=>t.boundaries.length===1&&t.orders.some(o=>o.nodeIds.length===2&&["anchor","sentinel"].includes(o.termination)))));
});

test('long-lived copy cursors are not persistent vector cardinalities',async()=>{
  const r=await inspect('#include <stdlib.h>\nint main(void){int cap=5,used=3,*old=malloc(cap*sizeof(int)),*next=malloc(used*sizeof(int));for(int i=0;i<used;i++)old[i]=i+2;int cursor=0;while(cursor<used){next[cursor]=old[cursor];cursor++;}int answer=next[2];free(old);free(next);return answer!=4;}');
  assert.ok(of(r,'array-cursor-relation').some(s=>s.roleAssessment.copyOnlyIndexedScan));
  assert.equal(of(r,'separate-array-structure').length,0);
});

test('global and record-owned ring storage share endpoint-operation inference',async()=>{
  for(const record of [false,true]){
    const field=x=>record?`store.${x}`:x;
    const r=await inspect(`${record?'struct{int cells[9],begin,size;}store;':'int cells[9],begin,size;'}
void front(int x){${field('begin')}=(${field('begin')}+8)%9;${field('cells')}[${field('begin')}]=x;${field('size')}++;}
void back(int x){${field('cells')}[(${field('begin')}+${field('size')})%9]=x;${field('size')}++;}
int pop(void){${field('size')}--;return ${field('cells')}[(${field('begin')}+${field('size')})%9];}
int take(void){int x=${field('cells')}[${field('begin')}];${field('begin')}=(${field('begin')}+1)%9;${field('size')}--;return x;}
int main(void){front(4);back(7);front(8);int x=pop(),y=take(),z=take();return x!=7||y!=8||z!=4;}`);
    assert.ok(of(r,'array-structure').some(s=>s.roleCandidates.includes('deque')&&s.roleAlternatives.some(a=>a.status==='supported')));
  }
});

test('VLA shapes use the frozen observed stride and keep slice extents',async()=>{
  const r=await inspect('#include <stdlib.h>\nint main(void){int cols=5,rows=2;int(*p)[cols]=malloc(rows*cols*sizeof(int));cols=3;for(int i=0;i<rows;i++)for(int j=0;j<5;j++)p[i+0][j]=10*i+j;int(*q)[5]=(int(*)[5])(p+1);int answer=q[0][4];free(p);return answer!=14;}');
  const arrays=of(r,'array');assert.ok(arrays.some(a=>JSON.stringify(a.geometry.dimensions)==='[2,5]'));
  assert.ok(arrays.some(a=>a.range.offset===20&&a.geometry.dimensions[0]===1));
  assert.ok(arrays.filter(a=>a.runtimeShape).every(a=>a.runtimeShape.strideObservationId&&a.discoveredAtExecutionId));
});

test('pointer-array roles retain branches and per-slot alternatives over the original nodes',async()=>{
  const r=await inspect('#include <stdio.h>\ntypedef struct N{int v;struct N*edge[3];}N;int visit(N*p){if(!p)return 0;int sum=p->v;for(int i=0;i<3;i++)sum+=visit(p->edge[i]);return sum;}int main(void){N a={1,{0}},b={2,{0}},c={3,{0}},h={4,{&a,&b,&c}};printf("%d\\n",visit(&h));return 0;}','10\n');
  const g=of(r,'storage-reference-graph')[0],group=g.roleProjections.find(p=>p.interpretation.startsWith('record pointer-array'));
  assert.ok(group);assert.equal(group.roleIds.length,3);
  const q=queryStorageReferences(g,r.trace,{afterExecutionId:atEnd(r),roleIds:group.roleIds});assert.equal(q.edges.filter(e=>e.to).length,3);
  assert.ok(recommendStructureViews(r.trace,{target:{objectId:r.trace.objects.find(o=>o.name==='h').id},afterExecutionId:atEnd(r)}).some(v=>v.view==='tree'));
});

test('different vertex and edge record types retain a heterogeneous relation projection',async()=>{
  const r=await inspect('typedef struct V V;typedef struct E{V*to;struct E*link;}E;struct V{int seen;E*edges;};int main(void){V a={0},b={0};E e={&b,0};a.edges=&e;for(E*p=a.edges;p;p=p->link)p->to->seen=1;return b.seen!=1;}');
  const g=of(r,'storage-reference-graph')[0];assert.ok(g.roleProjections.some(p=>p.typeIds.length===2&&p.roleIds.length>1));
  assert.ok(g.changes.flatMap(c=>c.upsertEdges).some(e=>e.sourceTypeId!==e.targetTypeId&&e.sourceTypeId&&e.targetTypeId));
});

test('packed bits and arithmetic address dependencies retain observations without algorithm labels',async()=>{
  const r=await inspect('int main(void){unsigned bits[2]={0,0};int jump[3]={2,0,1},values[4]={3,4,5,6};int i=jump[0];bits[1]|=1u<<i;int answer=values[jump[2]+1];return answer!=5||!(bits[1]&(1u<<i));}');
  const s=of(r,'storage-dependencies')[0];assert.ok(s.packedAccesses.length>=2);
  assert.ok(s.relations.some(r=>!r.preserved&&r.transforms.length&&r.sourceUnit==='array-element'));
  assert.ok(s.packedAccesses.every(p=>p.intent==='unconfirmed'));
});

test('all sibling formulas constrain one index interpretation per array',async()=>{
  const r=await inspect('int walk(int*a,int k,int n){return k>=n?0:a[k]+walk(a,3*k-1,n)+walk(a,3*k,n)+walk(a,3*k+1,n);}int main(void){int a[8]={0,2,3,4,5,6,7,8};return walk(a,1,8)!=35;}');
  const t=of(r,'index-tree');assert.equal(t.length,1);assert.equal(t[0].descriptor.degree,3);assert.equal(t[0].descriptor.base,1);
});

test('plain alias/storage topology never promotes an array into a tree or list',async()=>{
  const r=await inspect('#include <stdio.h>\nint main(void){int values[3]={2,4,6};int*p=values;printf("%d\\n",p[1]);return 0;}','4\n');
  const o=r.trace.objects.find(o=>o.name==='values'),views=recommendStructureViews(r.trace,{target:{objectId:o.id},afterExecutionId:atEnd(r)});
  assert.ok(views.some(v=>v.view==='array'));assert.ok(views.every(v=>!['tree','forest','binary-tree','linked-list'].includes(v.view)));
  const aliases=await inspect('#include <stdlib.h>\nint main(void){int*p=malloc(2*sizeof(int));unsigned*q=(unsigned*)p;p[0]=1;p[1]=2;unsigned n=q[1];free(p);return n!=2;}');
  const heap=aliases.trace.objects.find(o=>o.storage==='heap'),typed=of(aliases,'array').filter(a=>a.objectId===heap.id);
  assert.deepEqual([...new Set(typed.map(a=>a.elementType.signedness))].sort(),['signed','unsigned']);
});
