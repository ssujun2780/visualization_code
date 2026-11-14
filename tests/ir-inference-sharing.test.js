import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {inferStructures,createInferenceView,encodeInference,decodeInference,validateStructureTrace,queryStructureRelations} from '../scripts/inference/index.mjs';
import {createSharedValues} from '../scripts/inference/shared-values.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {recordEvidence} from '../scripts/inference/record-evidence.mjs';
const dir='test-results/inference-performance-2026-11-13';
test('interning resolves hash collisions by exact identity-bearing values',()=>{
 const original=Math.imul;try{Math.imul=()=>0;const pool=createSharedValues(),values=[{id:'a',v:0},{id:'b',v:0},{id:'a',v:-0},{id:'a',v:NaN},[1,2],{'0':1,'1':2},new Array(2),[]],out=values.map(v=>pool.intern(v));
  assert.equal(new Set(out).size,values.length);for(let i=0;i<values.length;i++){assert.deepEqual(out[i],values[i]);assert.equal(pool.intern(structuredClone(values[i])),out[i]);}
 }finally{Math.imul=original;}
});
test('record indexes preserve overlapping field precedence and non-monotonic historical queries',()=>{
 const type={kind:'record',recordTypeId:'record',sizeBits:64,members:[{offsetBits:0,sizeBits:32,typeId:'first'},{offsetBits:0,sizeBits:32,typeId:'second'}]},range={objectId:'owner',offset:0,size:4};
 const events=['born','link','detach','ended'].map(eventId=>({eventId,kind:'SPACE'})),objects=[{id:'owner',size:8,cType:type,createdBy:'born',endedBy:'ended'},{id:'target',size:8,cType:type,createdBy:'born'}],
  edge={source:range,target:{objectId:'target',offset:0,size:8},lastObservationExecutionId:'link'},cleared={...edge,target:null,lastObservationExecutionId:'detach'},
  trace={events,objects,structures:[{kind:'storage-reference-graph',nodes:[],changes:[{afterExecutionId:'link',upsertEdges:[edge]},{afterExecutionId:'detach',upsertEdges:[cleared]}]}]},c=recordEvidence({instructions:[]},trace);
 assert.equal(c.fieldAt(range,1).typeId,'first');const linked=c.edgesAt(1);assert.equal(linked[0].recordTo,'record:target:0:8');
 assert.equal(c.edgesAt(2)[0].recordTo,null);assert.deepEqual(c.edgesAt(0),[]);assert.equal(c.edgesAt(1)[0],linked[0]);assert.deepEqual(c.edgesAt(3),[]);
 assert.equal(linked[0].lastObservationExecutionId,'link');
});
test('shared wire values preserve identity, exceptional scalars and hostile property names',()=>{
 const x={id:'node:1',range:{objectId:'o1',offset:0,size:4}},input={a:x,b:x,distinct:{...x,id:'node:2'},missing:undefined,nan:NaN,negativeZero:-0,sparse:[,undefined,],empty:[]},pool=createSharedValues(),shared=pool.intern(input);
 const result=decodeInference(JSON.parse(JSON.stringify(encodeInference(shared))));
 assert.deepEqual(result,input);assert.equal(result.a,result.b);assert.notEqual(result.a,result.distinct);assert.ok(Object.isFrozen(result.a));
 const hostile=JSON.parse('{"__proto__":{"polluted":true},"constructor":7}');assert.deepEqual(decodeInference(encodeInference(hostile)),hostile);assert.equal({}.polluted,undefined);
 const malformed=encodeInference(input);malformed.root=[malformed.values.length];assert.throws(()=>decodeInference(malformed),/참조/);
});
test('shared inference roundtrip retains temporal evidence and rejects altered provenance',async()=>{
 const raw=JSON.parse(await fs.readFile('test-results/inference-semantic-extensions-2026-11-13/scale-8.execution.json')),before=JSON.stringify(raw),result=inferStructures(raw.plan,raw.trace),wire=encodeInference(result),decoded=decodeInference(JSON.parse(JSON.stringify(wire)));
 assert.deepEqual(decoded,result);assert.equal(JSON.stringify(raw),before);assert.ok(JSON.stringify(wire).length<JSON.stringify(result).length);
 const view=createInferenceView(raw,wire);validateStructureTrace(view.plan,view.trace);
 const pointer=result.structures.find(s=>s.kind==='pointer-priority-candidate'&&s.comparisonPolicy);assert.ok(pointer);
 const bad=structuredClone(view.trace),state=bad.structures.find(s=>s.id===pointer.id).states.find(s=>s.nodes.length);state.nodes[0].values[0]='forged';assert.throws(()=>validateStructureTrace(view.plan,bad));
});
test('aliases, temporary frames, detachment, reconnection and equal-value writes retain their evidence',async()=>{
 const source=`#include <stdio.h>
typedef struct N{int value;struct N*next;}N;
N a[3]={{1,0},{2,0},{3,0}};N*head=a;
int visit(N*p){int sum=0;while(p){sum+=p->value;p=p->next;}return sum;}
int helper(N*p){N*alias=p;return visit(alias);}
int main(void){a[0].next=a+1;a[1].next=a+2;printf("%d\\n",helper(head));puts("A");N*saved=a[1].next;a[1].next=0;printf("%d\\n",visit(head));puts("B");a[1].next=saved;printf("%d\\n",helper(head));puts("C");a[1].next=a[1].next;puts("D");return 0;}`;
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/aliases.c`,source);await fs.writeFile(`${dir}/aliases.expected.json`,JSON.stringify({stdout:'6\nA\n3\nB\n6\nC\nD\n',members:{A:3,B:2,C:3,D:3}}));
 const raw=await traceModel(source,{filename:'aliases.c'});assert.equal(raw.trace.status,'completed');assert.equal(raw.stdout,'6\nA\n3\nB\n6\nC\nD\n');
 const result=inferStructures(raw.plan,raw.trace),{plan,trace}=createInferenceView(raw,result);assert.equal(result.status,'completed',JSON.stringify(result.diagnostics));validateStructureTrace(plan,trace);
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),head=trace.objects.find(o=>o.name==='head'),s=trace.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===head.id);assert.ok(s);
 const states={};for(const [label,count]of Object.entries({A:3,B:2,C:3,D:3})){
  const event=trace.events.find(e=>e.text===label+'\n'),st=s.states.findLast(st=>pos.get(st.afterExecutionId)<=pos.get(event.eventId));states[label]=st;assert.equal(st.reachableMembers.length,count);
  const q=queryStructureRelations(trace,{candidateId:s.id,afterExecutionId:event.eventId});assert.ok(q.relations.some(r=>r.nodes.length===count));
 }
 assert.notDeepEqual(states.C.edges.map(e=>e.lastWrite),states.D.edges.map(e=>e.lastWrite),'equal pointers still have different observed writes');
 for(const candidate of trace.structures.filter(s=>s.kind==='linked-structure')){const o=trace.objects.find(o=>o.id===candidate.root.objectId);for(const st of candidate.states){const at=pos.get(st.afterExecutionId);assert.equal(st.rootAlive,at>=pos.get(o.createdBy)&&(!o.endedBy||at<pos.get(o.endedBy)));}}
 await fs.writeFile(`${dir}/aliases.inference.json`,JSON.stringify(encodeInference(result)));
});
