import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
async function inspect(source){const r=await traceModel(source,{includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
 assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);return r;}
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
test('folded expressions retain their AST tree without fabricated observed intermediate results',async()=>{
 const r=await inspect('int main(void){unsigned long n=sizeof(int)+5*sizeof(short);return n!=14;}');
 const e=r.trace.events.find(e=>e.foldedExpression&&walk(e.foldedExpression.expression).some(n=>n.operator==='*'));
 assert.ok(e);assert.equal(e.value.decimal??e.value.unsigned,'14');assert.equal(e.foldedExpression.intermediateValues,'not-observed');
 assert.equal(e.steps.length,1);assert.equal(e.steps[0].kind,'folded-expression');assert.equal(e.steps[0].operator,'expression');
 assert.ok(walk(e.foldedExpression.expression).some(n=>n.operator==='*'));
});
test('C conversions keep cast identity when their source is a dereference or a conditional',async()=>{
 const r=await inspect("int main(void){char a[]={'c',0};char*p=a;int n=*p++-'a';int k=4;char t=(char)(k?66:67);return n!=2||t!='B';}");
 const conversions=r.trace.events.filter(e=>e.kind==='CALC'&&e.action==='convert');assert.ok(conversions.length);
 assert.ok(conversions.every(e=>e.operator==='cast'));
});
test('offsetof address arithmetic is one CALC while preserving actual pointer input and destination',async()=>{
 const r=await inspect('#include <stddef.h>\ntypedef struct {long tag;int body;} X;int main(void){X x={7,9};int*p=&x.body;X*q=(X*)((char*)p - offsetof(X,body));return q!=&x;}');
 const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),calculations=r.trace.events.filter(e=>e.kind==='CALC'&&walk(defs.get(e.instructionId)?.expression).some(n=>n.kind==='OffsetOfExpr'));
 assert.equal(calculations.length,1);assert.ok(calculations[0].inputs.some(i=>i.executionId));
 assert.equal(calculations[0].value.reference.targetObjectId,r.trace.objects.find(o=>o.name==='x').id);
});
test('initializer zero-fill control stays internal but user initializer comparisons remain public',async()=>{
 const r=await inspect('typedef struct{int a;} T;int choose(int*a,int*b){return a==b;}int main(void){T t={1};T*p[5]={&t};int a=2,b=3;int x[4]={a<b,choose(&a,&a)};return p[4]!=0||x[0]!=1||x[1]!=1||x[3]!=0;}');
 const ops=new Map(r.observations.plan.instructions.map(o=>[o.id,o])),raw=new Map(r.observations.trace.events.map(e=>[e.eventId,e])),defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
 const leaked=r.trace.events.filter(e=>e.kind==='CALC'&&e.observationIds.some(id=>{const o=ops.get(raw.get(id)?.instructionId);return o?.opcode==='icmp'&&o.inputs?.every(i=>i.type?.endsWith('*'))&& !walk(defs.get(e.instructionId)?.expression).some(n=>['==','!=','<','>','<=','>='].includes(n.operator));}));
 assert.deepEqual(leaked,[]);assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&e.operator==='<'));assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&e.operator==='=='));
 const p=r.trace.objects.find(o=>o.name==='p');assert.ok(r.trace.events.some(e=>e.kind==='WRITE'&&e.target?.objectId===p.id));
});
test('tentative scalar, pointer and array globals compile and retain zero initialization',async()=>{
 const r=await inspect('int n;int*a;int v[3];int main(void){if(n||a||v[2])return 1;n=7;return n!=7;}');
 for(const name of ['n','a','v']){const o=r.trace.objects.find(o=>o.name===name);assert.ok(o);const e=r.trace.events.find(e=>e.eventId===o.createdBy);assert.equal(e.initialized,true);}
});
