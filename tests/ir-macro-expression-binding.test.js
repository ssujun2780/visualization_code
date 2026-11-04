import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const definitions=new Map(r.plan.instructions.map(i=>[i.id,i]));
  const comparisons=r.observations.plan.instructions.filter(o=>['icmp','fcmp'].includes(o.opcode)&&o.semanticNodeId);
  for(const op of comparisons){
    const binding=r.plan.bindings[op.id];assert.ok(['<','<=','>','>=','==','!='].includes(binding.sourceOperator));
    assert.equal(op.cType?.name,'int');assert.equal(binding.expressionNodeId,op.semanticNodeId);
    assert.ok(r.plan.sourceMap.macroExpansions.some(e=>e.nodeId===op.semanticNodeId&&e.tokenRange));
  }
  return {...r,comparisons,definitions};
}

test('renamed checking macros bind six comparisons of struct fields through compiler expansion locations',async()=>{
  const source=`#include <stdio.h>
#define KITE(condition) ((condition)||reject())
int failures=0;
int reject(void){failures++;return 0;}
struct S{unsigned count;};
void examine(struct S *p,unsigned limit){
 KITE(p->count < limit); KITE(p->count <= 2); KITE(p->count > 1);
 KITE(p->count >= 2); KITE(p->count == 2); KITE(p->count != 0);
}
int main(void){struct S value={2};examine(&value,4);printf("%u %d\\n",value.count,failures);return 0;}`;
  const r=await inspect(source,'2 0\n');assert.equal(r.comparisons.length,6);
  assert.deepEqual(r.comparisons.map(o=>r.plan.bindings[o.id].sourceOperator),['<','<=','>','>=','==','!=']);
  const calcs=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='||'),
    comparisons=calcs.flatMap(e=>e.steps.filter(s=>['<','<=','>','>=','==','!='].includes(s.operator)));
  assert.equal(calcs.length,6);assert.equal(comparisons.length,6);
  assert.ok(calcs.every(e=>e.value.cType?.name==='int'&&e.value.decimal==='1'&&e.evaluation.right==='skipped'));
  assert.ok(comparisons.every(s=>s.value.cType?.name==='int'&&s.value.decimal==='1'&&s.nodeId&&s.observationIds.length));
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@reject').length,0);
});

test('repeated identical argument comparisons retain separate token occurrences and SSA input nodes',async()=>{
  const source=`#include <stdio.h>
#define TWO(v) (((v)<4)+((v)<4))
#define SHIFTED(v) (((v)<2)+((v)<5))
int main(void){int n=3;int a=TWO(n);int b=SHIFTED(n);printf("%d %d\\n",a,b);return 0;}`;
  const r=await inspect(source,'2 1\n');assert.equal(r.comparisons.length,4);
  assert.equal(new Set(r.comparisons.map(o=>o.semanticNodeId)).size,4);
  const reads=r.observations.plan.instructions.filter(o=>o.action==='load'&&o.semanticNodeId);
  const descendants=n=>[n?.nodeId,...(n?.children??[]).flatMap(descendants)];
  for(const op of r.comparisons){
    const binding=r.plan.bindings[op.id],definition=r.definitions.get(binding.roles.CALC);
    const nodes=[];const visit=n=>{if(n?.nodeId===op.semanticNodeId)nodes.push(n);for(const c of n?.children??[])visit(c);};visit(definition.expression);
    assert.equal(nodes.length,1);const producer=reads.find(o=>o.functionId===op.functionId&&o.result===op.inputs[0].value);
    assert.ok(producer);assert.ok(descendants(nodes[0].children[0]).includes(producer.semanticNodeId));
  }
});

test('macro comparisons preserve floating predicates and execute call/postincrement arguments once',async()=>{
  const source=`#include <stdio.h>
#define SENTINEL(expr) ((expr)||miss())
int calls=0;
int miss(void){return 0;}
int sample(void){calls++;return 3;}
int main(void){int i=1;double d=2.5;
 SENTINEL(sample()<9); SENTINEL(i++<9); SENTINEL(d>=2.0);
 printf("%d %d\\n",calls,i);return 0;}`;
  const r=await inspect(source,'1 2\n');assert.equal(r.comparisons.length,3);
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@sample').length,1);
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='++').length,2); // sample's counter and i
  assert.ok(r.comparisons.some(o=>o.opcode==='fcmp'&&o.predicate==='oge'));
});

test('repeated macro comparisons retain short-circuit decisions and the final C int materialization',async()=>{
  const source=`#include <stdio.h>
#define TWICE(q) (((q)<4)&&((q)<4))
#define AGAIN(q) (((q)>=4)||((q)>=4))
int main(void){int a=2,b=5;
 int x=TWICE(a),y=TWICE(b),z=AGAIN(a),w=AGAIN(b);
 printf("%d %d %d %d\\n",x,y,z,w);return 0;}`;
  const r=await inspect(source,'1 0 0 1\n');assert.equal(r.comparisons.length,8);
  assert.equal(new Set(r.comparisons.map(o=>o.semanticNodeId)).size,8);
  const calcs=r.trace.events.filter(e=>e.kind==='CALC'&&['&&','||'].includes(e.operator));
  assert.equal(calcs.length,4);assert.deepEqual(calcs.map(e=>e.value.decimal),['1','0','0','1']);
  assert.ok(calcs.every(e=>e.value.cType?.name==='int'));
  const evaluations=calcs.flatMap(e=>e.inputEvaluations??[e.evaluation]);
  assert.deepEqual(evaluations.map(e=>e.right),['evaluated','skipped','evaluated','skipped']);
});
