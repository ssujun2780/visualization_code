import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {recommendStructureViews,validateStructureTrace} from '../scripts/inference/index.mjs';

const at=(t,s,id)=>{const pos=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(st=>pos.get(st.afterExecutionId)<=pos.get(id));};
const checkpoint=(t,tag)=>t.events.find(e=>e.action==='output'&&e.text.startsWith(tag+' ')).eventId;
const edgeRows=st=>st.edges.filter(e=>e.status==='observed').map(e=>[e.fromIndex,e.toIndex,Number(e.properties[0]?.value.decimal)]).sort();
const graph=(t,name)=>t.structures.find(s=>s.kind==='index-domain-graph-candidate'&&s.vertexDomain.range.objectId===t.objects.find(o=>o.name===name).id);
async function run(source,stdout){
  const r=await traceWithStructureView(source,{filename:'graph-role-variation.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));assert.deepEqual(r.trace.coverage.irGaps,[]);
  return r;
}

const linkedSource=`#include <stdio.h>
typedef struct Q { int z, padding; struct Q *route; long amount; } Q;
Q items[6]; Q *entries[9]; long scores[9];
void scan(int mode, const char *tag){
  for(int a=0;a<5;a++)scores[a]=500; scores[0]=0;
  int count=0;long sum=0;
  for(int a=0;a<5;a++)for(Q *q=entries[a];q;q=q->route){
    if(mode==1)break;
    if(mode==2)continue;
    int b=q->z; long w=q->amount;
    if(scores[a]!=500 && scores[b]>scores[a]+w)scores[b]=scores[a]+w;
    count++;sum+=w;
  }
  printf("%s %d %ld\\n",tag,count,sum);
}
int main(void){
  items[0]=(Q){1,77,&items[1],0};items[1]=(Q){2,77,&items[2],3};
  items[2]=(Q){4,77,0,8};items[3]=(Q){2,77,0,-2};
  entries[0]=items;entries[1]=&items[3];scan(0,"A");
  items[0].route=&items[2];items[4]=(Q){4,77,0,-5};entries[3]=&items[4];
  scan(1,"B");scan(2,"C");scan(0,"D");return 0;
}`;

test('learned storage roles survive short circuit, reordered fields, skipped rows and spare capacity',async()=>{
  // Independent source expectations, fixed before compilation/inference.
  const initial=[[0,1,0],[0,2,3],[0,4,8],[1,2,-2]].sort(),final=[[0,1,0],[0,4,8],[1,2,-2],[3,4,-5]].sort();
  const {trace:t,plan}=await run(linkedSource,'A 4 9\nB 0 0\nC 0 0\nD 4 1\n'),s=graph(t,'scores');assert.ok(s);
  const a=at(t,s,checkpoint(t,'A')),b=at(t,s,checkpoint(t,'B')),c=at(t,s,checkpoint(t,'C')),d=at(t,s,checkpoint(t,'D'));
  assert.deepEqual(edgeRows(a),initial);assert.deepEqual(edgeRows(d),final);
  for(const st of [a,b,c,d])assert.deepEqual(st.nodes.map(n=>n.index),[0,1,2,3,4],'capacity 9 is not nine observed vertices');
  for(const st of [b,c])assert.notEqual(st.edges.find(e=>e.fromIndex===0&&e.toIndex===2).status,'absent','partial traversal cannot confirm removal');
  assert.equal(d.edges.find(e=>e.fromIndex===0&&e.toIndex===2).status,'absent');
  const recovered=d.edges.find(e=>e.fromIndex===3&&e.toIndex===4);assert.equal(recovered.basis,'learned-storage-role');
  const proof=s.storageEvidence.find(p=>p.executionId===recovered.executionId&&p.edgeIdentity===recovered.edgeIdentity);
  assert.ok(proof);assert.ok(proof.evidenceExecutionIds.every(id=>t.events.some(e=>e.eventId===id)));
  const entry=t.objects.find(o=>o.name==='entries'),end=checkpoint(t,'D'),whole=recommendStructureViews(t,{target:{objectId:entry.id},afterExecutionId:end});
  assert.equal(whole[0].view,'graph');
  const slot=recommendStructureViews(t,{target:{ranges:[{objectId:entry.id,offset:0,size:plan.target?.pointerBits/8||4}]},afterExecutionId:end});
  assert.ok(slot[0].exactRoot,'an explicitly selected single root keeps its priority');
  // Forged endpoint values or source provenance must fail the same validator.
  for(const corrupt of ['endpoint','evidence']){
    const copy=structuredClone(t),candidate=copy.structures.find(x=>x.id===s.id),p=candidate.storageEvidence.find(x=>x.edgeIdentity===recovered.edgeIdentity);
    if(corrupt==='endpoint')p.toIndex=0;else p.sourceReadExecutionId=candidate.evidence[0].executionId;
    assert.throws(()=>validateStructureTrace(plan,copy));
  }
});

test('conditional state writes retain their association instead of claiming an independent tree',async()=>{
  const {trace:t}=await run(`#include <stdio.h>
int starts[5]={0,2,3,3,3},endpoints[3]={1,2,3},weights[3]={0,-2,5};
int distance[4]={0,999,999,999},marks[4]={0};
int main(void){int sum=0;for(int a=0;a<4;a++)for(int k=starts[a];k<starts[a+1];k++){
  int b=endpoints[k],w=weights[k];if(distance[b]>distance[a]+w){distance[b]=distance[a]+w;marks[b]=1;}sum+=w;
}printf("A %d\\n",sum);return 0;}`,'A 3\n');
  const end=checkpoint(t,'A'),o=t.objects.find(o=>o.name==='marks'),choices=recommendStructureViews(t,{target:{objectId:o.id},afterExecutionId:end});
  assert.equal(choices[0].view,'array');assert.equal(choices[0].relationRole.kind,'conditional-vertex-state');
  assert.ok(!choices.some(c=>['tree','binary-tree','forest'].includes(c.view)));
  assert.ok(choices.some(c=>c.view==='graph'),'the observed update projection remains available');
});

test('inverted matrix absence guard preserves zero and negative properties and confirms deletion',async()=>{
  const expected=[[1,2,-6],[3,2,11]].sort();
  const {trace:t}=await run(`#include <stdio.h>
int table[7][7],cost[7];
void scan(const char *tag){for(int a=0;a<4;a++)cost[a]=500;cost[0]=0;int count=0,sum=0;
for(int a=0;a<4;a++)for(int b=0;b<4;b++)if(table[a][b]==12345){}else{
  int w=table[a][b];if(cost[a]!=500&&cost[b]>cost[a]+w)cost[b]=cost[a]+w;count++;sum+=w;
}printf("%s %d %d\\n",tag,count,sum);}
int main(void){for(int a=0;a<4;a++)for(int b=0;b<4;b++)table[a][b]=12345;
table[0][1]=0;table[1][2]=-6;scan("A");table[0][1]=12345;table[3][2]=11;scan("B");return 0;}`,'A 2 -6\nB 2 5\n');
  const s=t.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.vertexDomain.range.objectId===t.objects.find(o=>o.name==='cost').id);assert.ok(s);
  const st=at(t,s,checkpoint(t,'B'));assert.deepEqual(edgeRows(st),expected);assert.deepEqual(st.nodes.map(n=>n.index),[0,1,2,3]);
  assert.equal(st.edges.find(e=>e.fromIndex===0&&e.toIndex===1).status,'absent');
});

test('a false compound loop guard does not prove the adjacency row was exhausted',async()=>{
  const {trace:t}=await run(`#include <stdio.h>
typedef struct N {int dest,w;struct N *next;}N;
N cells[2];N *first[4];int values[4];
void scan(int stop,const char*tag){for(int i=0;i<4;i++)values[i]=100;values[0]=0;int sum=0;
for(int i=0;i<4;i++)for(N*p=first[i];p&&!stop;p=p->next){int j=p->dest,w=p->w;
if(values[j]>values[i]+w)values[j]=values[i]+w;sum+=w;}printf("%s %d\\n",tag,sum);}
int main(void){cells[0]=(N){1,2,&cells[1]};cells[1]=(N){2,3,0};first[0]=cells;
scan(0,"A");first[0]=&cells[1];scan(1,"B");return 0;}`,'A 5\nB 0\n');
  const s=graph(t,'values');assert.ok(s);const st=at(t,s,checkpoint(t,'B'));
  assert.ok(st.edges.some(e=>e.fromIndex===0&&e.toIndex===1&&e.status==='unconfirmed-after-write'));
  assert.ok(!st.edges.some(e=>e.status==='absent'));
});
