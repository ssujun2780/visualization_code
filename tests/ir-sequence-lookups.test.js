import assert from 'node:assert/strict';import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {recommendStructureViews,querySequenceLookup,validateStructureTrace} from '../scripts/inference/index.mjs';
async function run(code,stdout){const r=await traceWithStructureView(code,{filename:'sequence-variation.c',includeObservations:true});
 assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r;}
const at=(t,text)=>t.events.find(e=>e.action==='output'&&e.text.startsWith(text)).eventId;
const lookups=t=>t.structures.filter(s=>s.kind==='sequence-lookup-candidate');
const state=(t,s,id)=>querySequenceLookup(t,{candidateId:s.id,afterExecutionId:id}).state;
test('sparse child slots use indexed input, a nonzero root and reordered fields without name/alphabet rules',async()=>{
 const {trace:t}=await run(String.raw`#include <stdio.h>
typedef struct Cell{int noise;struct Cell*route[3];int flag;}Cell;Cell bank[9];int extent=3;
void add(const char*w){Cell*p=&bank[2];for(int j=0;w[j];j++){int x=w[j]-'0';if(!p->route[x])p->route[x]=&bank[extent++];p=p->route[x];p->noise=99;}p->flag=7;}
int has(const char*w){Cell*p=&bank[2];for(int j=0;w[j];j++){int x=w[j]-'0';if(!p->route[x])return 0;p=p->route[x];}return p->flag;}
int main(void){add("0");add("01");add("2");int a=has("01"),b=has("2"),c=has("00");printf("A %d %d %d\n",a,b,c);return 0;}`,'A 7 7 0\n');
 const id=at(t,'A'),s=lookups(t).find(s=>state(t,s,id).conditions.trie==='supported-observed');assert.ok(s);
 const st=state(t,s,id),width=st.nodes[0].range.size,index=new Map(st.nodes.map(n=>[n.id,n.range.offset/width]));
 assert.deepEqual(st.nodes.map(n=>index.get(n.id)).sort((a,b)=>a-b),[2,3,4,5]);
 assert.deepEqual(st.edges.map(e=>[index.get(e.from),e.labels[0].text,index.get(e.to)]).sort(),[[2,'0',3],[2,'2',5],[3,'1',4]].sort());
 assert.deepEqual(st.nodes.filter(n=>n.terminalMarkers.some(m=>m.accepted)).map(n=>index.get(n.id)).sort((a,b)=>a-b),[3,4,5]);
 assert.ok(st.nodes.every(n=>n.terminalMarkers.every(m=>m.value!==99)));
});
test('a cyclic sibling chain is preserved as a relation conflict, not silently made into a trie',async()=>{
 const {trace:t}=await run(String.raw`#include <stdio.h>
typedef struct N{struct N*side;int accept;char symbol;struct N*down;}N;N a[3];
int get(const char*s){N*p=a;while(*s){N*q=p->down;int steps=0;while(q&&q->symbol!=*s&&steps++<3)q=q->side;if(!q||q->symbol!=*s)return 0;p=q;s++;}return p->accept;}
int main(void){a[0].down=a+1;a[1].side=a+2;a[2].side=a+1;a[1].symbol='x';a[2].symbol='y';a[1].accept=a[2].accept=1;printf("A %d\n",get("y"));return 0;}`,'A 1\n');
 const id=at(t,'A'),cs=lookups(t);assert.ok(cs.length);assert.ok(cs.some(s=>state(t,s,id).topology.relationConflicts?.some(c=>c.kind==='sibling-cycle')));
 assert.ok(cs.every(s=>state(t,s,id).conditions.trie!=='supported-observed'));
 assert.ok(!recommendStructureViews(t,{target:{objectId:t.objects.find(o=>o.name==='a'&&o.storage==='static').id},afterExecutionId:id}).some(r=>r.view==='trie'));
});
test('owned edge field order, prefix collision and freed label bytes retain source truth',async()=>{
 const {trace:t,plan}=await run(String.raw`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct N N;typedef struct{N*dest;char*text;}E;struct N{int spare;E paths[2];int end;};N a[3];
int get(const char*s){N*p=a;while(*s){int found=0;for(int i=0;i<2;i++){char*z=p->paths[i].text;if(z){int n=strlen(z);if(strncmp(s,z,n)==0){s+=n;p=p->paths[i].dest;found=1;break;}}}if(!found)return 0;}return p->end;}
int main(void){char*z=malloc(3);if(!z)return 1;strcpy(z,"ab");a[0].paths[0].text=z;a[0].paths[0].dest=a+1;a[0].paths[1].text="xy";a[0].paths[1].dest=a+2;a[1].end=a[2].end=1;
int x=get("ab"),y=get("xy");printf("A %d %d\n",x,y);a[0].paths[1].text="a";int q=get("a");printf("B %d\n",q);free(z);puts("C");return 0;}`,'A 1 1\nB 1\nC\n');
 const cs=lookups(t);assert.equal(cs.length,1);const s=cs[0],a=state(t,s,at(t,'A')),b=state(t,s,at(t,'B')),c=state(t,s,at(t,'C'));
 assert.equal(a.conditions.trie,'supported-observed');assert.deepEqual(a.edges.flatMap(e=>e.labels.map(l=>l.text)).sort(),['ab','xy']);
 assert.equal(b.conditions.deterministic,'violated');assert.equal(b.conditions.trie,'not-established');
 assert.ok(c.edges.some(e=>e.labels.length===0));assert.equal(c.conditions.trie,'not-established');
 const copy=structuredClone(t),st=copy.structures.find(x=>x.id===s.id).states.find(x=>x.afterExecutionId===a.afterExecutionId);st.edges[0].labels[0].units[0]++;
 assert.throws(()=>validateStructureTrace(plan,copy));
});
test('symbol-indexed cyclic automaton stays non-trie even with an end-of-input acceptance marker',async()=>{
 const {trace:t}=await run(String.raw`#include <stdio.h>
int hops[2][2]={{1,0},{0,1}},marked[2]={1,0};
int run(const char*s){int p=0;while(*s){p=hops[p][*s-'x'];s++;}return marked[p];}
int main(void){int a=run("xyx"),b=run("x");printf("A %d %d\n",a,b);return 0;}`,'A 1 0\n');
 const id=at(t,'A'),cs=lookups(t);assert.ok(cs.length);assert.ok(cs.some(s=>state(t,s,id).terminalRoles.length));assert.ok(cs.every(s=>state(t,s,id).conditions.trie!=='supported-observed'));
});

// Separate fixture: the three-term condition above currently fails in IR
// recording. Keep that reproduction and its assertions unchanged.
test('explicit sibling scan keeps the complete cyclic relation and refuses trie',async()=>{
 const {trace:t}=await run(String.raw`#include <stdio.h>
typedef struct N{struct N*side;int accept;char symbol;struct N*down;}N;N a[3];
int get(const char*s){N*p=a;while(*s){N*q=p->down;int steps=0;while(q){if(q->symbol==*s)break;if(steps==3)return 0;steps++;q=q->side;}if(!q)return 0;p=q;s++;}return p->accept;}
int main(void){a[0].down=a+1;a[1].side=a+2;a[2].side=a+1;a[1].symbol='x';a[2].symbol='y';a[1].accept=a[2].accept=1;printf("A %d\n",get("y"));return 0;}`,'A 1\n');
 const id=at(t,'A'),cs=lookups(t);assert.ok(cs.length);
 const s=cs.find(s=>state(t,s,id).topology.relationConflicts?.some(c=>c.kind==='sibling-cycle'));assert.ok(s);
 const st=state(t,s,id),width=st.nodes[0].range.size,index=new Map(st.nodes.map(n=>[n.id,n.range.offset/width]));
 assert.deepEqual(st.nodes.map(n=>index.get(n.id)).sort(),[0,1,2]);
 assert.deepEqual(st.edges.map(e=>[index.get(e.from),index.get(e.to)]).sort(),[[0,1],[0,2]]);
 assert.ok(cs.every(s=>state(t,s,id).conditions.trie!=='supported-observed'));
 assert.ok(!recommendStructureViews(t,{target:{objectId:t.objects.find(o=>o.name==='a'&&o.storage==='static').id},afterExecutionId:id}).some(r=>r.view==='trie'));
});
