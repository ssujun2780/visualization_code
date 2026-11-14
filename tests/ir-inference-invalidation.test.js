import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace} from '../scripts/inference/index.mjs';
test('same-allocation roots preserve every checkpoint through join, split, cycle, repair and free',async()=>{
 const dir='test-results/inference-performance-followup-2026-11-13',source=`#include <stdio.h>
#include <stdlib.h>
typedef struct N {int value;struct N*next;}N;
int visit(N*p){int n=0;while(p){n++;p=p->next;}return n;}
int main(void){N*pool=calloc(6,sizeof(N));if(!pool)return 1;for(int i=0;i<6;i++)pool[i].value=i;
pool[0].next=pool+1;pool[1].next=pool+2;pool[3].next=pool+4;pool[4].next=pool+5;N*a=pool;N*b=pool+3;
printf("%d %d\\n",visit(a),visit(b));puts("A");pool[1].next=pool+4;puts("B");pool[1].next=NULL;puts("C");
pool[1].next=pool+2;pool[2].next=pool;puts("D");pool[2].next=NULL;puts("E");free(pool);puts("F");return 0;}`,
 expected={stdout:'3 3\nA\nB\nC\nD\nE\nF\n',a:{A:[0,1,2],B:[0,1,4,5],C:[0,1],D:[0,1,2],E:[0,1,2],F:[]},b:{A:[3,4,5],B:[3,4,5],C:[3,4,5],D:[3,4,5],E:[3,4,5],F:[]}};
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/invalidation.c`,source);await fs.writeFile(`${dir}/invalidation.expected.json`,JSON.stringify(expected));
 const raw=await traceModel(source);await fs.writeFile(`${dir}/invalidation.execution.json`,JSON.stringify(raw));assert.equal(raw.trace.status,'completed');assert.equal(raw.stdout,expected.stdout);const before=JSON.stringify(raw),inf=inferStructures(raw.plan,raw.trace),{plan,trace}=createInferenceView(raw,inf);assert.equal(inf.status,'completed',JSON.stringify(inf.diagnostics));validateStructureTrace(plan,trace);assert.equal(JSON.stringify(raw),before);
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i]));for(const name of ['a','b']){const object=trace.objects.find(o=>o.name===name),s=trace.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===object.id);assert.ok(s);for(const [label,indices]of Object.entries(expected[name])){
  const e=trace.events.find(e=>e.text===label+'\n'),state=s.states.findLast(st=>pos.get(st.afterExecutionId)<=pos.get(e.eventId));assert.ok(state);assert.deepEqual(state.reachableMembers.map(id=>{const n=s.logicalNodes.find(n=>n.id===id);return n.offset/n.size;}),indices);assert.equal(state.topology.cyclic,name==='a'&&label==='D');
  if(label==='F'){assert.equal(state.topology.status,'partial');assert.ok(state.endedMembers.length>=3);}else assert.equal(state.orders[0].termination,name==='a'&&label==='D'?'cycle':'null');
 }}await fs.writeFile(`${dir}/invalidation.inference.json`,JSON.stringify(inf));
});
