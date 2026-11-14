import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures} from '../scripts/inference/structure-inference.mjs';
import {prepareStructures,PreparedStructures} from '../src/animation/prepared-structures.js';
import {createStructureViewQuery} from '../src/animation/structure-query.js';

test('scoped preparation preserves every graph change despite unrelated writes, later joins and unlinking',async()=>{
 const source=`#include <stdio.h>
 typedef struct N{int value;struct N *next;}N;
 int main(void){N a[3]={{1,0},{2,0},{3,0}},b[2]={{4,0},{5,0}};
 a[0].next=a+1;
 for(int i=0;i<12;i++)b[0].next=i%2?b+1:0;
 a[1].next=b;b[1].next=a+2;
 printf("%d\\n",a[0].next->next->value);
 b[0].next=b+1;printf("%d\\n",a[0].next->next->next->value);
 a[1].next=0;printf("%d\\n",a[0].next->value);return 0;}`;
 const r=await traceModel(source);assert.equal(r.stdout,'4\n5\n2\n');assert.equal(r.trace.status,'completed');
 const inference=inferStructures(r.plan,r.trace);assert.equal(inference.diagnostics.length,0);
 const data=prepareStructures(r.plan,r.trace,inference),prepared=new PreparedStructures(data),q=createStructureViewQuery(r.plan,r.trace,inference),positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
 const object=r.trace.objects.find(o=>o.name==='a'),target={objectId:object.id},begin=positions.get(object.createdBy),end=(positions.get(object.endedBy)??r.trace.events.length)-1;
 const choiceAt=r.trace.events.findLastIndex((e,i)=>i<=end&&['READ','WRITE'].includes(e.kind)&&e.target?.objectId===object.id);
 q.set(target,{view:'graph'},r.trace.events[choiceAt].eventId);
 const choice=q.project(target,r.trace.events[choiceAt].eventId,{limit:256});
 assert.ok(data.tracks.find(t=>t.objectId===object.id)?.variants.graph);prepared.setView(object.id,'graph');
 for(let i=begin;i<=end;i++){
  const direct=q.project(target,r.trace.events[i].eventId,{limit:256,selection:choice.selection});
  assert.deepEqual(prepared.at(object.id,i)?.relation,direct.relation,`original relation at event ${i}`);
 }
 // Backward seeking must not reuse later edges either.
 assert.deepEqual(prepared.at(object.id,begin)?.relation,q.project(target,r.trace.events[begin].eventId,{limit:256,selection:choice.selection}).relation);
});
