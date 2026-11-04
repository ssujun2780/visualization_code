import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';

test('No5 uses logical CALCs, skipped-operand help stubs and selected-value forwarding',async()=>{
  const source=await readFile(new URL('../examples/c/blind/No5.c',import.meta.url),'utf8');
  const {plan,trace,stdout,observations}=await traceModel(source,{includeObservations:true});
  assert.equal(trace.status,'completed');assert.equal(stdout,'0 0\n1 0\n1 1\n1 2\n1 2 1\n0 2 0\n');
  const defs=new Map(plan.instructions.map(i=>[i.id,i])),line=e=>defs.get(e.instructionId).source?.line;
  const logical=trace.events.filter(e=>e.kind==='CALC'&&['&&','||'].includes(e.operator));
  assert.deepEqual(logical.map(e=>[line(e),e.value.decimal]),[[7,'0'],[10,'1'],[13,'1'],[16,'1']]);
  assert.ok(logical.every(e=>e.value.cType.name==='int'));
  assert.deepEqual(logical.map(e=>e.evaluation.right),['skipped','skipped','evaluated','evaluated']);
  assert.equal(logical.filter(e=>e.helpMarker).length,2);
  for(const e of logical.slice(0,2)){
    assert.equal(e.helpMarker.status,'stub');assert.equal(e.helpMarker.highlight.line,line(e));
    assert.ok(e.helpMarker.skippedSource.start.column>e.helpMarker.highlight.start.column);
    const def=defs.get(e.instructionId);assert.ok(def.sourceNodeId);assert.equal(def.helpMarker.when,'right-skipped');
    const write=trace.events.find(w=>w.action==='write'&&line(w)===line(e));assert.ok(write.dataInputs.includes(e.eventId));
  }
  assert.ok(!trace.events.some(e=>['icmp','zext','phi'].includes(e.operator)));
  assert.ok(!trace.events.some(e=>e.kind==='FLOW'&&['branch','short-circuit'].includes(e.action)));
  // Four logical results, four mutations, two conditional tests.
  assert.equal(trace.events.filter(e=>e.kind==='CALC').length,10);
  for(const l of [19,22]){
    const comparisons=trace.events.filter(e=>e.kind==='CALC'&&line(e)===l&&e.steps?.some(s=>s.operator==='=='));
    assert.equal(comparisons.length,1);
    const decision=trace.events.find(e=>e.action==='conditional'&&line(e)===l);
    assert.ok(decision.dataInputs.includes(comparisons[0].eventId));
    const update=trace.events.find(e=>e.kind==='CALC'&&line(e)===l&&['++','--'].includes(e.operator));
    assert.ok(update.controlInputs.includes(decision.eventId));
    const write=trace.events.filter(e=>e.action==='write'&&line(e)===l).at(-1),selection=write.inputEvaluations.find(e=>e.kind==='conditional');
    assert.equal(selection.selected,l===19?'true':'false');
    assert.deepEqual(write.dataInputs,[update.eventId]);
    assert.ok(!write.dataInputs.includes(decision.eventId));
    assert.ok(write.controlInputs.includes(decision.eventId));
    assert.ok(selection.decisionExecutionIds.includes(decision.eventId));
    assert.ok(!plan.bindings[observations.plan.instructions.find(o=>o.opcode==='phi'&&o.source?.line===l).id].roles.CALC);
  }
});

test('runtime operands and nested logical expressions keep per-call decisions and one final CALC',async()=>{
  const source=`int f(int a,int b){int x=0;
int c=a&&++x;
int d=a||++x;
int e=a?++x:--x;
int z=a?17:42;
int n=a&&(b||++x);
return c+d+e+z+n+x;} int main(){return f(0,1)+f(1,0)+f(1,1);}`;
  const {plan,trace}=await traceModel(source);assert.equal(trace.exitCode,92);assert.equal(trace.status,'completed');
  const defs=new Map(plan.instructions.map(i=>[i.id,i]));
  const logical=trace.events.filter(e=>e.evaluation?.kind==='logical');
  assert.equal(logical.length,11);assert.equal(new Set(logical.map(e=>e.activationId)).size,3);
  assert.ok(logical.every(e=>e.value.cType.name==='int'&&['0','1'].includes(e.value.decimal)&&e.evaluation.right!=='unknown'));
  assert.equal(logical.filter(e=>e.helpMarker).length,5);
  assert.ok(!trace.events.some(e=>['icmp','zext','phi','select'].includes(e.operator)));
  const resultWrites=trace.events.filter(e=>e.action==='write'&&[4,5].includes(defs.get(e.instructionId).source?.line)&&e.inputEvaluations?.some(x=>x.kind==='conditional'));
  assert.deepEqual(resultWrites.map(e=>e.value.decimal),['0','42','2','17','2','17']);
  assert.deepEqual(resultWrites.map(e=>e.inputEvaluations.find(x=>x.kind==='conditional').selected),['false','false','true','true','true','true']);
  for(const frame of new Set(logical.map(e=>e.activationId)))for(const id of new Set(logical.map(e=>e.instructionId)))
    assert.ok(logical.filter(e=>e.activationId===frame&&e.instructionId===id).length<=1);
});

test('repeated conditional arms retain only selected values and logical comparisons stay typed',async()=>{
  const source=`int main(){int x=0;int y=0;int z=0;
for(int i=0;i<3;i++){
 z=(i==1)?++x:++y;
 int a=(i>0)&&++x;
 int b=(i!=0)||++y;
}
return x*10+y+z;}`;
  // Final x=3, y=3, z=3: 30+3+3=36.
  const {plan,trace}=await traceModel(source,{includeObservations:true});assert.equal(trace.exitCode,36);assert.equal(trace.status,'completed');
  const defs=new Map(plan.instructions.map(i=>[i.id,i]));
  const writes=trace.events.filter(e=>e.action==='write'&&defs.get(e.instructionId).source?.line===3&&e.inputEvaluations?.some(v=>v.kind==='conditional'));
  assert.deepEqual(writes.map(e=>e.value.decimal),['1','1','3']);
  assert.deepEqual(writes.map(e=>e.inputEvaluations.find(v=>v.kind==='conditional').selected),['false','true','false']);
  const logical=trace.events.filter(e=>e.evaluation?.kind==='logical');assert.equal(logical.length,6);
  assert.ok(logical.every(e=>e.value.cType.name==='int'));
  assert.deepEqual(logical.map(e=>e.evaluation.right),['skipped','evaluated','evaluated','skipped','evaluated','skipped']);
  // A later iteration must not inherit the previous unselected arm's producer.
  for(const write of writes){
    const choice=write.inputEvaluations.find(v=>v.kind==='conditional'),spec=plan.evaluations.find(s=>s.nodeId===choice.nodeId);
    const skipped=trace.events.filter(e=>e.kind==='CALC'&&defs.get(e.instructionId).sourceNodeId===spec[choice.skipped].nodeId).map(e=>e.eventId);
    assert.ok(write.dataInputs.every(id=>!skipped.includes(id)));
  }
});

test('compile-only exports help markers and operand ranges without manufacturing executions',async()=>{
  const {plan,trace}=await compileCToIR('int f(int x){return x||1;} int main(){return 0&&f(1);}');
  assert.equal(trace,undefined);
  const specs=plan.evaluations.filter(e=>e.kind==='logical');assert.equal(specs.length,2);
  for(const e of specs){assert.equal(e.helpMarker.status,'stub');assert.ok(e.left.nodeId);assert.ok(e.right.source.endExclusive);}
});
