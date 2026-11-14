import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inferStructures,recommendStructureViews} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {recordObservedTrace} from '../scripts/model/recorded-result.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';
import {validateStructureTrace} from '../scripts/inference/structure-schema.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
async function run(source,options={}){
  const r=await traceModel(source,options);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.irGaps,[]);
  if(r.inference)assert.deepEqual(r.inference.diagnostics,[]);
  return r;
}
const graphs=(r,kind)=>r.trace.structures.filter(s=>s.kind===kind);
const at=(r,s,id)=>{const p=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(s=>p.get(s.afterExecutionId)<=p.get(id));};
const output=r=>r.trace.events.findLast(e=>e.action==='output').eventId;

test('inference owns read-only snapshots and cannot change completed IR or core planning',async()=>{
  const r=await run('int f(int x){return x+3;}int main(void){int y=f(2);return y!=5;}',{inference:false,includeObservations:true});
  assert.equal(r.plan.structureBindings,undefined);assert.deepEqual(r.trace.structures,[]);
  const before=copy(r),frozen=Object.isFrozen(r.trace);let checkpoint;
  const derived=recordObservedTrace(r.plan,r.observations.plan,r.observations.trace,{onExecution:t=>{checkpoint=copy(t);assert.deepEqual(t.structures,[]);}});
  assert.equal(derived.inference,undefined);
  const metadata=inferStructures(r.plan,derived.trace,{observationPlan:r.observations.plan,observedTrace:r.observations.trace});
  assert.deepEqual(metadata.diagnostics,[]);
  assert.deepEqual(copy(checkpoint),copy(r.trace));
  assert.deepEqual(copy(derived.trace),copy(r.trace));
  assert.deepEqual(copy(r),before);assert.equal(Object.isFrozen(r.trace),frozen);
  const badOverlay={...r.trace,structures:[{id:'bad',kind:'array',objectId:'missing',range:{objectId:'missing',offset:0,size:4},capacity:1,elementBytes:4}]};
  assert.doesNotThrow(()=>validateIRTrace(r.plan,badOverlay));
  assert.throws(()=>validateStructureTrace(r.plan,badOverlay));
  // Simulate missing optional descriptor metadata after execution. Individual
  // inference stages fail without turning the successful run into an ERROR.
  const failed=inferStructures({...r.plan,instructions:null},r.trace);
  assert.equal(failed.status,'partial');assert.ok(failed.diagnostics.length);
  assert.ok(failed.diagnostics.every(d=>d.scope==='visualization-only'));
  assert.deepEqual(copy(r),before);
});

test('an address marker remains a real node; an observed traversal terminator does not',async()=>{
  for(const sentinel of [false,true]){
    const r=await run(`#include <stdio.h>
typedef struct N{int data;struct N*hop;}N;
int main(void){N cells[3]={{7,0},{8,0},{9,0}};cells[1].hop=cells+2;cells[2].hop=cells;
N*root=cells+1;int count=0,marker=0;for(N*p=root;${sentinel?'p!=cells':'p'};p=p->hop){count++;if(p==&cells[0])marker++;}
printf("%d %d",count,marker);return count!=${sentinel?2:3};}`);
    const root=r.trace.objects.find(o=>o.name==='root'),s=graphs(r,'linked-structure').find(s=>s.root.objectId===root.id),state=at(r,s,output(r));
    assert.equal(state.topology.nodeCount,sentinel?2:3);
    assert.equal(state.boundaries.length,sentinel?1:0);
  }
});

test('index formula candidates do not cross an interior alias coordinate system',async()=>{
  const r=await run(`#include <stdio.h>
typedef struct N{struct N*first,*next;int v;}N;
int walk(N*p){int s=p->v;for(N*q=p->first;q;q=q->next)s+=walk(q);return s;}
int main(void){N pool[3]={0};for(int i=0;i<3;i++){pool[i].v=i+1;if(2*i+1<3)pool[i].first=pool+2*i+1;if(i%2&&i+1<3)pool[i].next=pool+i+1;}
N*root=pool;printf("%d",walk(root));return 0;}`);
  assert.equal(r.stdout,'6');assert.deepEqual(r.inference.diagnostics,[]);
  for(const s of graphs(r,'index-tree'))assert.ok(s.descriptor.base>=0&&s.descriptor.base<s.capacity);
});

test('copied links use the guarded storage version, not values created after the guard',async()=>{
  for(const guard of ['if(next!=0)sum+=walk(next);','if(next)sum+=walk(next);','if(!next)continue;sum+=walk(next);','if(next==0)continue;sum+=walk(next);']){
  const r=await run(`#include <stdio.h>
typedef struct{int edge[3],payload;}R;R cells[7];int size=1;
void put(int c){if(cells[0].edge[c]==0)cells[0].edge[c]=size++;}
int walk(int k){int sum=1;for(int c=0;c<3;c++){int next=cells[k].edge[c];${guard}}return sum;}
int main(void){put(0);put(2);put(0);printf("%d",walk(0));return 0;}`);
  const s=graphs(r,'record-index-graph-candidate')[0],state=at(r,s,output(r));
  assert.equal(state.topology.nodeCount,3);assert.equal(state.topology.edgeCount,2);assert.equal(state.topology.complete,true);
  assert.ok(s.terminationEvidence.every(p=>p.predicate.constant===0&&p.predicate.result===(p.predicate.operator==='==')));
  }
});

test('split wrap and pointer wrap share FIFO operations without changing writes',async()=>{
  for(const pointers of [false,true]){
    const r=await run(`#include <stdio.h>
typedef struct{int data[5],used,h,t;int*r,*w;}Box;
void put(Box*b,int x){${pointers?'*b->w=x;if(++b->w==b->data+5)b->w=b->data;':'b->data[b->t]=x;b->t++;if(b->t==5)b->t=0;'}b->used++;}
int take(Box*b){int x=${pointers?'*b->r':'b->data[b->h]'};${pointers?'if(++b->r==b->data+5)b->r=b->data;':'b->h++;if(b->h==5)b->h=0;'}b->used--;return x;}
int main(void){Box b={0};b.r=b.w=b.data;int sum=0;for(int k=1;k<=13;k++){if(b.used==4)sum+=take(&b);put(&b,k);}while(b.used)sum+=take(&b);printf("%d",sum);return sum!=91;}`);
    const s=graphs(r,'array-structure').find(s=>s.roleCandidates.includes('fifo'));assert.ok(s);
    assert.equal(s.operationEvidence.filter(o=>o.operation==='remove'&&o.status==='supported').length,13);
    assert.ok(s.states.some(s=>s.status==='intermediate'));assert.equal(s.latestValidState.length,0);
  }
});

test('parallel endpoints and properties survive helper results, invalidate writes and retain ended property history',async()=>{
  const r=await run(`#include <stdlib.h>
#include <stdio.h>
int sum(int x,int y){return x+y;}
void visit(int*from,int*to,int*w,int*d){for(int k=0;k<3;k++){int v=sum(d[from[k]],w[k]);if(d[to[k]]>v)d[to[k]]=v;}}
int main(void){int from[3]={0,1,0},to[3]={1,2,2},d[3]={0,90,90};int*w=malloc(3*sizeof *w);if(!w)return 1;w[0]=0;w[1]=2;w[2]=3;
visit(from,to,w,d);from[0]=2;printf("a");visit(from,to,w,d);free(w);printf("b");return 0;}`);
  const s=graphs(r,'index-domain-graph-candidate')[0];assert.ok(s);
  const outs=r.trace.events.filter(e=>e.action==='output'),first=at(r,s,outs[0].eventId),last=at(r,s,outs.at(-1).eventId);
  assert.equal(first.edges.find(e=>e.fromIndex===0&&e.toIndex===1).status,'unconfirmed-after-write');
  assert.ok(last.edges.some(e=>e.fromIndex===2&&e.toIndex===1&&e.status==='observed'));
  assert.ok(last.edges.every(e=>e.properties.length===1&&e.properties[0].status==='ended-source'));
  const before=r.trace.events.find(e=>e.action==='object.end'&&e.objectId===last.edges[0].properties[0].source.objectId);
  assert.ok(s.states.some(st=>st.afterExecutionId===before.eventId&&st.edges.some(e=>e.properties[0].status==='ended-source')));
});

test('computed recursive links retain element and byte units with exact target records',async()=>{
  const sources=[`int v[4]={2,3,5,7},left[4]={1,2,0,0},right[4]={2,0,0,0};int visit(int k){int s=v[k];if(left[k])s+=visit(k+left[k]);if(right[k])s+=visit(k+right[k]);return s;}int main(void){printf("%d",visit(0));return 0;}`,
    `typedef struct{int v,a,b;}R;R pool[4]={{2,12,24},{3,36,-1},{5,-1,-1},{7,-1,-1}};int visit(char*base,int off){if(off<0)return 0;R*p=(R*)(base+off);return p->v+visit(base,p->a)+visit(base,p->b);}int main(void){printf("%d",visit((char*)pool,0));return 0;}`];
  for(const source of sources){const r=await run('#include <stdio.h>\n'+source),s=graphs(r,'observed-traversal-graph-candidate')[0];assert.ok(s);
    const state=at(r,s,output(r));assert.equal(state.topology.nodeCount,4);assert.equal(state.topology.edgeCount,3);
    assert.ok(s.evidence.every(e=>e.kind==='computed-index-transfer'&&e.transforms.length));
    assert.ok(recommendStructureViews(r.trace,{target:{structureId:s.id},afterExecutionId:output(r)}).some(c=>c.view==='tree'));
  }
});

test('bounded index walks and presence matrices provide graph proofs independent of algorithm names',async()=>{
  const sources=[`int start[4]={0,2,3,4},dest[4]={1,2,2,0},seen[3]={1},q[3]={0},front=0,back=1;while(front<back){int u=q[front++];for(int k=start[u];k<start[u+1];++k){int v=dest[k];if(!seen[v]){seen[v]=1;q[back++]=v;}}}printf("%d",back);`,
    `int flags[3][3]={{0,1,1},{0,0,1},{1,0,0}},cost[3][3]={{0,0,4},{0,0,2},{3,0,0}},d[3]={0,90,90};for(int pass=0;pass<3;pass++)for(int a=0;a<3;a++)for(int b=0;b<3;b++)if(flags[a][b]&&d[b]>d[a]+cost[a][b])d[b]=d[a]+cost[a][b];printf("%d",d[2]);`];
  for(const [i,body]of sources.entries()){
    const r=await run('#include <stdio.h>\nint main(void){'+body+'return 0;}'),s=graphs(r,'observed-traversal-graph-candidate')[0];assert.ok(s);
    const state=at(r,s,output(r));assert.equal(state.topology.nodeCount,3);assert.equal(state.topology.edgeCount,4);
    // A presence proof and an operand-pair proof may support the same edge.
    // Preserve both, while requiring the original four edges and weight proof.
    assert.ok(s.evidence.every(e=>i?['matrix-operand-pair','matrix-gated-access'].includes(e.kind):e.kind==='bounded-index-walk'));
    if(i){assert.ok(s.evidence.some(e=>e.kind==='matrix-operand-pair'&&e.properties.some(p=>p.value.decimal==='0')));assert.ok(s.evidence.every(e=>e.sourceSlots.length));
      for(const edge of state.edges){assert.ok(edge.supportingProofIds?.length>=2);assert.ok(edge.properties.length);}}
    else assert.equal(graphs(r,'index-domain-graph-candidate').length,0,'range bounds are not vertex edges');
  }
});

test('numerical agreement without cursor or address evidence never creates a logical graph',async()=>{
  const r=await run('int main(void){int a[3]={0,1,2},b[3]={0,1,2},c[3]={0,1,2};int sum=0;for(int i=0;i<3;i++)sum+=a[i]+b[i]+c[i];return sum!=9;}');
  assert.equal(graphs(r,'observed-traversal-graph-candidate').length,0);
  assert.equal(graphs(r,'index-domain-graph-candidate').length,0);
});
