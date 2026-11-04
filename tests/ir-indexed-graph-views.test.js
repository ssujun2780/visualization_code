import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {linkedStructures} from '../scripts/model/linked-views.mjs';
import {indexedGraphStructures} from '../scripts/model/indexed-graph-views.mjs';
import {validateStructureOverlays} from '../scripts/model/structure-overlay-contract.mjs';

async function inspect(source){
  const r=await traceModel(source);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  const linked=linkedStructures(r.plan,r.trace),graphs=indexedGraphStructures(r.plan,{...r.trace,
    structures:[...r.trace.structures.filter(s=>s.kind!=='linked-structure'),...linked]});
  return {...r,linked,graphs};
}
const largest=g=>g.states.reduce((a,s)=>s.edges.length>a.edges.length||s.edges.length===a.edges.length&&s.topology?.complete?s:a,{edges:[]});

test('record fields flow through wrapper parameters to indexed roots, with shared targets and an empty root',async()=>{
  const r=await inspect(`typedef struct X {unsigned marker;struct X*hop;int dest;} X;
void step(X**roots,int*seen,int slot);
void relay(int slot,X**roots,int*seen){step(roots,seen,slot);}
void step(X**roots,int*seen,int slot){if(seen[slot])return;seen[slot]=1;
for(X*q=roots[slot];q;q=q->hop){int next=q->dest;relay(next,roots,seen);}}
int main(void){X items[4]={{11,0,1},{22,0,2},{33,0,3},{44,0,3}};
items[0].hop=&items[1];X* roots[4]={items,&items[2],&items[3],0};int seen[4]={0};
step(roots,seen,0);return 0;}`);
  assert.equal(r.graphs.length,1);const g=r.graphs[0],s=largest(g);
  assert.equal(g.origin,'inferred');assert.equal(g.vertexDomain.count,4);
  assert.deepEqual(s.edges.map(e=>[e.fromIndex,e.toIndex]).sort(),[[0,1],[0,2],[1,3],[2,3]]);
  assert.ok(s.vertexStates.some(v=>v.index===3&&v.status==='empty'));
  assert.equal(new Set(s.edges.map(e=>e.source.objectId)).size,1);
  assert.equal(new Set(s.edges.map(e=>e.source.offset)).size,4);
  assert.ok(g.evidence.every(e=>e.fieldReadExecutionId&&e.indexReadExecutionId));
  assert.equal(s.topology.cyclic,false);assert.equal(s.topology.complete,true);
  assert.ok(g.states.at(-1).vertexStates.every(v=>v.status==='ended'));
  assert.doesNotThrow(()=>validateStructureOverlays(r.trace));
  const broken=structuredClone(r.trace),candidate=broken.structures.find(s=>s.kind==='indexed-graph-candidate');
  assert.ok(candidate);candidate.states[0].afterExecutionId='missing-execution';
  assert.throws(()=>validateStructureOverlays(broken));
});

test('integer identities propagated through ordinary array writes and reads support a graph without recursive calls',async()=>{
  const r=await inspect(`typedef struct Y {int destination;struct Y*link;} Y;
int main(void){Y records[3]={{1,0},{2,0},{0,0}};Y* rows[3]={records,records+1,records+2};
int used[3]={0},pending[3],front=0,back=0;pending[back++]=0;used[0]=1;
while(front<back){int at=pending[front++];for(Y*walk=rows[at];walk;walk=walk->link){int target=walk->destination;
if(!used[target]){used[target]=1;pending[back++]=target;}}}return 0;}`);
  assert.equal(r.graphs.length,1);const g=r.graphs[0],s=largest(g);
  assert.deepEqual(s.edges.map(e=>[e.fromIndex,e.toIndex]).sort(),[[0,1],[1,2],[2,0]]);
  assert.equal(s.topology.cyclic,true);
  assert.equal(g.rootStructureIds.length,3);
});

test('integer fields used only in an unrelated array do not classify bucket lists as an indexed graph',async()=>{
  const r=await inspect(`typedef struct Z {struct Z*link;int number;} Z;
int main(void){Z nodes[2]={{0,1},{0,0}};Z* rows[3]={nodes,nodes+1,0};int seen[3]={0};
for(int k=0;k<3;k++)for(Z*p=rows[k];p;p=p->link)seen[p->number]=1;
return 0;}`);
  assert.ok(r.linked.length>=2);assert.deepEqual(r.graphs,[]);
});

test('record destinations preserve their provenance through nested function returns',async()=>{
  const r=await inspect(`typedef struct R {int number;struct R*next;} R;
int read_number(R*item){return item->number;}
int relay(R*item){return read_number(item);}
void visit(R**rows,int*seen,int at){if(seen[at])return;seen[at]=1;
for(R*item=rows[at];item;item=item->next)visit(rows,seen,relay(item));}
int main(void){R items[3]={{1,0},{2,0},{0,0}};R*rows[3]={items,items+1,items+2};
int seen[3]={0};visit(rows,seen,0);return 0;}`);
  assert.equal(r.graphs.length,1);
  assert.deepEqual(largest(r.graphs[0]).edges.map(e=>[e.fromIndex,e.toIndex]).sort(),[[0,1],[1,2],[2,0]]);
  assert.ok(r.graphs[0].evidence.every(e=>e.fieldReadExecutionId&&e.indexReadExecutionId));
});

test('a later bad destination preserves the inferred view and the actual inconsistent value',async()=>{
  const r=await inspect(`typedef struct Q {struct Q*forward;int destination;} Q;
int run(Q**roots,int index){int total=0;for(Q*p=roots[index];p;p=p->forward){int n=p->destination;
if(n>=0&&n<3)for(Q*q=roots[n];q;q=q->forward)total++;}return total;}
int main(void){Q nodes[2]={{0,1},{0,2}};Q*roots[3]={nodes,nodes+1,0};int x=run(roots,0);
nodes[0].destination=-2;nodes[1].destination=7;nodes[1].forward=nodes+1;return x!=1;}`);
  assert.equal(r.graphs.length,1);const g=r.graphs[0];
  assert.ok(g.states.some(s=>s.edges.some(e=>e.destinationValue===-2&&e.toIndex===null&&e.status==='out-of-range')));
  assert.ok(g.states.some(s=>s.edges.some(e=>e.destinationValue===7&&e.toIndex===null&&e.status==='out-of-range')));
  assert.ok(g.states.some(s=>s.status==='inconsistent'));
  assert.ok(g.states.some(s=>s.vertexStates.some(v=>v.status==='unknown'&&v.storageTerminations.some(t=>t.termination==='cycle'))));
  assert.ok(g.states.at(-1).vertexStates.every(v=>v.status==='ended'));
});
