import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,queryStructureRelations,validateStructureTrace} from '../scripts/inference/index.mjs';
import {bindLinkedStructures} from '../scripts/inference/linked-views.mjs';
const dir='test-results/inference-performance-followup-2026-11-13';
const cases=[
 {name:'branch-return',function:'N*choose(N*a,N*b,int flag){return flag?a:b;}',setup:'N left[2]={{4,0},{5,0}},right[2]={{4,0},{5,0}};left[0].next=left+1;right[0].next=right+1;N*x=left;N*y=right;',calls:'N*r=choose(x,y,1);printf("%d\\n",visit(r));puts("A");r=choose(x,y,0);printf("%d\\n",visit(r));puts("B");',stdout:'9\nA\n9\nB\n',roots:['x','y'],storage:['left','right'],offset:0,members:2},
 {name:'offset-return',function:'N*choose(N*a){return a+1;}',setup:'N left[3]={{1,0},{4,0},{5,0}};left[0].next=left+1;left[1].next=left+2;N*x=left;',calls:'printf("%d\\n",visit(choose(x)));puts("A");',stdout:'9\nA\n',roots:['x'],storage:['left'],offset:1,members:2},
 {name:'indirect-return',function:'N*choose(N*a,N*b,int flag){return flag?a:b;}',setup:'N left[2]={{4,0},{5,0}},right[2]={{4,0},{5,0}};left[0].next=left+1;right[0].next=right+1;N*x=left;N*y=right;N*(*pick)(N*,N*,int)=choose;',calls:'printf("%d\\n",visit(pick(x,y,1)));puts("A");printf("%d\\n",visit(pick(x,y,0)));puts("B");',stdout:'9\nA\n9\nB\n',roots:['x','y'],storage:['left','right'],offset:0,members:2},
];
// The former indirect-return compilation blocker is now a required regression.
// Preserve the original normal-execution and source-derived identity assertions.
for(const c of cases)test(`${c.name}: call results do not invent static aliases and actual parameter roots stay precise`,async()=>{
 const source=`#include <stdio.h>\ntypedef struct N{int value;struct N*next;}N;\n${c.function}\nint visit(N*received){int sum=0;for(N*p=received;p;p=p->next)sum+=p->value;return sum;}\nint main(void){${c.setup}${c.calls}return 0;}`;
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/${c.name}.c`,source);await fs.writeFile(`${dir}/${c.name}.expected.json`,JSON.stringify(c,null,2));
 const raw=await traceModel(source,{filename:c.name+'.c'});await fs.writeFile(`${dir}/${c.name}.execution.json`,JSON.stringify(raw));assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,c.stdout);
 const before=JSON.stringify(raw),result=inferStructures(raw.plan,raw.trace),view=createInferenceView(raw,result),{plan,trace}=view;assert.equal(result.status,'completed',JSON.stringify(result.diagnostics));validateStructureTrace(plan,trace);assert.equal(JSON.stringify(raw),before);
 for(const name of c.roots){const id=plan.declarations.find(d=>d.name===name).id;assert.ok(!result.bindings.linkRootDeclarations.includes(id),name+' is only passed to a returning function');assert.ok(!result.bindings.linkRootOrigins.some(o=>o.rootDeclarationId===id));}
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),parameters=trace.objects.filter(o=>o.name==='received');assert.equal(parameters.length,c.storage.length);
 for(let i=0;i<parameters.length;i++){const root=parameters[i],candidate=trace.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id);assert.ok(candidate);const storage=trace.objects.find(o=>o.name===c.storage[i]),state=candidate.states.findLast(s=>s.rootAlive&&s.reachableMembers.length===c.members);assert.ok(state);
  const nodes=state.reachableMembers.map(id=>candidate.logicalNodes.find(n=>n.id===id));assert.deepEqual(nodes.map(n=>n.objectId),Array(c.members).fill(storage.id));const stride=nodes[0].size;assert.deepEqual(nodes.map(n=>n.offset),Array.from({length:c.members},(_,j)=>(j+c.offset)*stride));assert.equal(state.orders[0].termination,'null');
  const relation=queryStructureRelations(trace,{candidateId:candidate.id,afterExecutionId:state.afterExecutionId});assert.ok(relation.relations.some(r=>r.nodes.length===c.members));assert.ok(candidate.states.every(s=>!s.rootAlive||pos.get(s.afterExecutionId)>=pos.get(root.createdBy)&&pos.get(s.afterExecutionId)<pos.get(root.endedBy)));
 }
 await fs.writeFile(`${dir}/${c.name}.execution.json`,JSON.stringify(raw));await fs.writeFile(`${dir}/${c.name}.inference.json`,JSON.stringify(result));
});

test('returned link recurrence follows exact nested deliveries and local copies, never another invocation',async()=>{
 const source=`#include <stdio.h>
typedef struct N{int value;struct N*next;}N;
N* advance(N*p,int yes){N*selected=yes?p->next:p;return selected;}
N* wrap(N*p,int yes){N*copy=advance(p,yes);return copy;}
int visit(N*cur){int sum=0;cur=wrap(cur,0);for(;cur;cur=wrap(cur,1))sum+=cur->value;return sum;}
int main(void){N a[3]={{2,0},{3,0},{4,0}};a[0].next=a+1;a[1].next=a+2;N*root=a;printf("%d\\n",visit(root));return 0;}`;
 const expected={stdout:'9\n',cursor:'cur',returnedLinks:3,memberIndices:[0,1,2],termination:'null'};
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/nested-return.c`,source);await fs.writeFile(`${dir}/nested-return.expected.json`,JSON.stringify(expected,null,2));
 const raw=await traceModel(source,{filename:'nested-return.c'});await fs.writeFile(`${dir}/nested-return.execution.json`,JSON.stringify(raw));assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,expected.stdout);
 const before=JSON.stringify(raw),result=inferStructures(raw.plan,raw.trace);assert.equal(result.status,'completed',JSON.stringify(result.diagnostics));assert.equal(JSON.stringify(raw),before);
 const {plan,trace}=createInferenceView(raw,result);validateStructureTrace(plan,trace);
 const cursor=plan.declarations.find(d=>d.name===expected.cursor),recurrence=result.bindings.linkRecurrences.find(r=>r.cursorDeclarationId===cursor.id);assert.ok(recurrence);assert.equal(recurrence.returnWitnesses.length,expected.returnedLinks);
 const events=new Map(trace.events.map(e=>[e.eventId,e])),pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),defs=new Map(plan.instructions.map(d=>[d.id,d]));
 for(const w of recurrence.returnWitnesses){
  assert.equal(events.get(w.cursorReadExecutionId).target.objectId,w.cursorObjectId);assert.equal(events.get(w.writeExecutionId).target.objectId,w.cursorObjectId);
  let field=defs.get(events.get(w.fieldReadExecutionId).instructionId).expression;while(['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(field.kind))field=field.children[0];assert.equal(field.kind,'MemberExpr');assert.equal(field.fieldNodeId,recurrence.fieldNodeId);
  assert.equal(w.callExecutionIds.length,2,'one wrapper and its own nested call');assert.ok(w.callExecutionIds.every(id=>trace.resultDeliveries.some(d=>d.callExecutionId===id)));
  assert.ok(w.evidenceExecutionIds.every(id=>pos.get(id)<=pos.get(w.afterExecutionId)));assert.deepEqual(w.evidenceExecutionIds,[...w.evidenceExecutionIds].sort((a,b)=>pos.get(a)-pos.get(b)));
 }
 const root=trace.objects.find(o=>o.name==='root'),storage=trace.objects.find(o=>o.name==='a'),candidate=result.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id);assert.ok(candidate);
 const state=candidate.states.findLast(s=>s.rootAlive&&s.reachableMembers.length===3),members=state.reachableMembers.map(id=>candidate.logicalNodes.find(n=>n.id===id));assert.deepEqual(members.map(n=>n.objectId),Array(3).fill(storage.id));assert.deepEqual(members.map(n=>n.offset/n.size),expected.memberIndices);assert.equal(state.orders[0].termination,expected.termination);
 const fieldRead=recurrence.returnWitnesses[0].fieldReadExecutionId;assert.ok(candidate.states.filter(s=>pos.get(s.afterExecutionId)<pos.get(fieldRead)).every(s=>s.observedRoleIds.length===0));
 const binding=trace=>{const p=structuredClone(raw.plan);bindLinkedStructures(p,trace);return p.structureBindings.linkRecurrences.filter(r=>r.cursorDeclarationId===cursor.id);};
 assert.deepEqual(binding({...raw.trace,resultDeliveries:[]}),[],'missing call-result evidence cannot prove traversal');
 const wrong=structuredClone(raw.trace);for(const d of wrong.resultDeliveries)d.callerActivationId='unrelated-activation';assert.deepEqual(binding(wrong),[],'same pointer values cannot substitute for activation identity');
 const first=recurrence.returnWitnesses[0],partial={...raw.trace,resultDeliveries:raw.trace.resultDeliveries.filter(d=>!first.callExecutionIds.includes(d.callExecutionId))},remaining=binding(partial)[0];assert.ok(remaining);assert.equal(remaining.returnWitnesses.length,2);assert.ok(remaining.returnWitnesses.every(w=>w.writeExecutionId!==first.writeExecutionId),'later calls cannot prove an earlier update');
 await fs.writeFile(`${dir}/nested-return.inference.json`,JSON.stringify(result));
});
