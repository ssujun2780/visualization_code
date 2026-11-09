import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {queryStorageReferences,storageRelationStructures} from '../scripts/model/storage-relations.mjs';
async function inspect(source){const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);
 assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);return r;}
const structures=(r,kind)=>r.trace.structures.filter(s=>s.kind===kind);
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
test('payload consumption distinguishes circular data roots from comparison-only dummy boundaries',async()=>{
 const r=await inspect('typedef struct N{struct N*hop;long code;}N;int main(void){N a[3]={{0,4},{0,5},{0,6}};for(int i=0;i<3;i++)a[i].hop=&a[(i+1)%3];N*h=&a[1],*p=h;long sum=0;do{sum+=p->code;p=p->hop;}while(p!=h);return sum!=15;}');
 const candidates=structures(r,'linked-structure');assert.ok(candidates.some(s=>s.states.some(t=>t.rootAlive&&t.topology.cyclic&&t.topology.nodeCount===3)));
 const sums=r.trace.events.filter(e=>e.kind==='READ'&&e.value?.decimal==='5'),at=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
 assert.ok(candidates.some(s=>s.states.some(t=>at.get(t.afterExecutionId)>=at.get(sums[0].eventId)&&t.topology.nodeCount===3)));
});
test('direct array arguments discover shared-child graphs without an extra root variable',async()=>{
 const r=await inspect('typedef struct N{int x;struct N*a,*b;}N;int total(N*p){return p?p->x+total(p->a)+total(p->b):0;}int main(void){N a[3]={{1,0,0},{2,0,0},{3,0,0}};a[0].a=&a[1];a[0].b=&a[2];a[1].b=&a[2];return total(a)!=9;}');
 assert.ok(structures(r,'linked-structure').some(s=>s.root.kind==='record-root'&&s.states.some(t=>t.topology.sharedChildren.length>0&&t.topology.nodeCount===3)));
});
test('unknown record-array membership preserves observed index destinations',async()=>{
 const r=await inspect('typedef struct{int link,value;}N;int main(void){N a[5]={{2,7},{-1,9},{1,8}};int k=0,sum=0;while(k>=0){sum+=a[k].value;k=a[k].link;}return sum!=24;}');
 const graphs=structures(r,'record-index-graph-candidate');assert.ok(graphs.length);
 assert.ok(graphs.some(g=>g.states.some(s=>s.length===null&&s.edges.some(e=>e.to!==null&&e.activeMembership==='unknown'))));
 assert.ok(graphs.every(g=>g.states.every(s=>s.nodes.length<=3)));
});
test('recursive index formulas cross actual parameter bindings and matrix strides do not nominate trees',async()=>{
 const r=await inspect('int visit(int*a,int k,int n){if(k>=n)return 0;return a[k]+visit(a,2*k+1,n)+visit(a,2*k+2,n);}int main(void){int a[3]={2,3,4};return visit(a,0,3)!=9;}');
 const byEvent=new Map(r.trace.events.map(e=>[e.eventId,e]));
 assert.ok(structures(r,'index-tree').some(t=>t.formulaEvidence.some(f=>f.childAccessExecutionIds.some(id=>byEvent.get(id).activationId!==byEvent.get(f.executionId).activationId))));
 const matrix=await inspect('int main(void){int a[12]={0};for(int i=0;i<3;i++)for(int j=0;j<4;j++)a[i*4+j]=i+j;return a[11]!=5;}');
 assert.equal(structures(matrix,'index-tree').length,0);
});
test('copy-only cursor scans do not become FIFO removal evidence',async()=>{
 const r=await inspect('int main(void){int a[4]={3,4,5,6},b[4]={0};int w=0;for(int i=0;i<4;i++)b[w++]=a[i];int k=0;while(k<w){a[k]=b[k];k++;}return a[3]!=6;}');
 const copies=structures(r,'cursor-interval-candidate');assert.ok(copies.length);assert.ok(copies.every(s=>!s.views.includes('fifo-candidate')));
});
test('shifted-prefix storage recognizes FIFO and LIFO independently of field names',async()=>{
 for(const front of [false,true]){
 const insert=front?'for(int j=z.used;j>0;j--)z.data[j]=z.data[j-1];z.data[0]=v;':'z.data[z.used]=v;';
 const r=await inspect(`typedef struct{long used;int data[6];}B;int main(void){B z={0};for(int v=1;v<=3;v++){${insert}z.used++;}int sum=0;while(z.used){int t=z.data[0];for(int j=1;j<z.used;j++)z.data[j-1]=z.data[j];z.used--;sum=10*sum+t;}return sum!=${front?321:123};}`);
 const s=structures(r,'array-structure')[0];assert.deepEqual(s.roleCandidates,[front?'lifo':'fifo']);assert.ok(s.roleAlternatives.some(a=>a.status==='supported'&&!a.contradictingExecutionIds.length));
 }
});
test('deque role explains both ends and retains FIFO counterevidence',async()=>{
 const r=await inspect('typedef struct{int used,data[6],start;}B;void f(B*p,int v){p->start=(p->start+5)%6;p->data[p->start]=v;p->used++;}void b(B*p,int v){p->data[(p->start+p->used)%6]=v;p->used++;}int pop(B*p){p->used--;return p->data[(p->start+p->used)%6];}int take(B*p){int v=p->data[p->start];p->start=(p->start+1)%6;p->used--;return v;}int main(void){B z={0};f(&z,5);b(&z,7);f(&z,9);int a=pop(&z),c=take(&z),d=take(&z);return a!=7||c!=9||d!=5;}');
 const s=structures(r,'array-structure')[0];assert.deepEqual(s.roleCandidates,['deque']);assert.ok(s.roleAlternatives.some(a=>a.role==='fifo'&&a.contradictingExecutionIds.length));
});
test('separate global pointer/count/capacity roles survive temporary growth-size variables',async()=>{
 const r=await inspect('#include <stdlib.h>\ndouble*data;unsigned used,cap;int push(double v){if(used==cap){unsigned next=cap+3;double*q=realloc(data,next*sizeof *data);if(!q)return 0;data=q;cap=next;}data[used++]=v;return 1;}int main(void){for(int i=0;i<4;i++)if(!push(i))return 1;int ok=used==4&&data[3]==3;free(data);return !ok;}');
 const s=structures(r,'separate-array-structure')[0];assert.ok(s);assert.equal(s.latestValidState.length,4);assert.equal(s.latestValidState.capacity,6);assert.equal(s.elementBytes,8);assert.equal(s.backingHistory.length,2);
 assert.equal(s.states.at(-1).active,false);
});
test('flexible child arrays and distinct link roles retain temporal storage edges',async()=>{
 const r=await inspect('#include <stdlib.h>\ntypedef struct N{int key;struct N*child[];}N;int main(void){N*p=calloc(1,sizeof *p+2*sizeof(N*)),*a=calloc(1,sizeof *a),*b=calloc(1,sizeof *b);if(!p||!a||!b)return 1;p->child[0]=a;p->child[1]=b;p->child[0]=b;free(a);free(b);free(p);return 0;}');
 const g=structures(r,'storage-reference-graph')[0];assert.ok(g);
 const edges=g.changes.flatMap(c=>c.upsertEdges).filter(e=>e.roleId.startsWith('field:')&&e.reference.targetObjectId);assert.ok(edges.length>=3);
 const slot=edges[0].source,own=edges.filter(e=>e.source.objectId===slot.objectId&&e.source.offset===slot.offset);
 assert.ok(new Set(own.map(e=>e.target.objectId)).size>=2);
 const first=queryStorageReferences(g,r.trace,{afterExecutionId:own[0].lastObservationExecutionId,roleIds:[own[0].roleId]});
 assert.equal(first.edges.find(e=>e.id===own[0].id).target.objectId,own[0].target.objectId);
 const last=queryStorageReferences(g,r.trace,{afterExecutionId:own.at(-1).lastObservationExecutionId,roleIds:[own[0].roleId],view:'tree',expected:'tree'});
 assert.equal(last.presentation.source,'user');assert.equal(last.edges.find(e=>e.id===own[0].id).target.objectId,own.at(-1).target.objectId);
 const before=JSON.stringify(r.trace.events);storageRelationStructures(r.plan,r.trace);assert.equal(JSON.stringify(r.trace.events),before);
});
test('cross-array and byte-offset relationships use observed dependencies instead of equal values',async()=>{
 const r=await inspect('typedef struct{int value,next;}N;int main(void){int map[2]={1,0},values[2]={5,8},unrelated[2]={1,0};int k=map[0],sum=values[k];N a[2]={{3,sizeof(N)},{4,-1}};unsigned char*b=(unsigned char*)a;int at=0;while(at!=-1){N*p=(N*)(b+at);sum+=p->value;at=p->next;}return sum!=15||unrelated[0]!=1;}');
 const relations=structures(r,'storage-dependencies').flatMap(s=>s.relations);assert.ok(relations.some(x=>x.kind==='value-index-use'&&x.sourceArrayId!==x.targetArrayId));assert.ok(relations.some(x=>x.kind==='computed-address-use'));
 const unrelated=r.trace.objects.find(o=>o.name==='unrelated');assert.ok(relations.every(x=>x.source.objectId!==unrelated.id));
});
test('storage projections invalidate unknown bytes and never resurrect an ended target at a reused address',()=>{
 const record={kind:'record',recordTypeId:'R',sizeBits:64},pointer={kind:'pointer',sizeBits:32,pointee:record},
   objects=[{id:'slot',address:8,size:4,cType:pointer},{id:'old',address:64,size:8,cType:record},{id:'new',address:64,size:8,cType:record}],
   events=[{eventId:'a',kind:'SPACE',action:'object.begin',objectId:'slot'},{eventId:'b',kind:'SPACE',action:'object.begin',objectId:'old'},
     {eventId:'c',kind:'WRITE',target:{objectId:'slot',offset:0,size:4},value:{address:64,cType:pointer,reference:{targetObjectId:'old',targetOffset:0,status:'in-bounds'}}},
     {eventId:'d',kind:'WRITE',target:{objectId:'slot',offset:0,size:1},memoryState:{byteLength:1,ranges:[{offset:0,length:1,initialization:'unknown'}]}},
     {eventId:'e',kind:'READ',target:{objectId:'slot',offset:0,size:4},value:{address:64,cType:pointer,reference:{targetObjectId:'old',targetOffset:0,status:'in-bounds'}}},
     {eventId:'f',kind:'SPACE',action:'object.end',objectId:'old'},{eventId:'g',kind:'SPACE',action:'object.begin',objectId:'new'}],
   trace={objects,events,structures:[]},[graph]=storageRelationStructures({instructions:[]},trace);
 const before=JSON.stringify(trace),unknown=queryStorageReferences(graph,trace,{afterExecutionId:'d',roleIds:['slot:slot:0:4'],expected:'tree'});
 assert.equal(unknown.edges[0].status,'unknown');assert.equal(unknown.edges[0].to,null);assert.equal(unknown.presentation.assessment,'incomplete');
 const ended=queryStorageReferences(graph,trace,{afterExecutionId:'g',includeEnded:true,view:'custom',expected:'custom-invariant'});
 assert.equal(ended.edges[0].status,'ended-target');assert.equal(ended.edges[0].target.objectId,'old');assert.equal(ended.presentation.assessment,'not-checkable');
 assert.equal(JSON.stringify(trace),before);
});
