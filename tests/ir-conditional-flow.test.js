import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of r.trace.events)for(const k of ['dataInputs','addressInputs','controlInputs','calleeInputs'])
    for(const id of e[k]??[])assert.ok(positions.get(id)<positions.get(e.eventId),`${k}: ${id} -> ${e.eventId}`);
  const choices=r.trace.events.filter(e=>e.action==='conditional');
  for(const c of choices){
    assert.equal(c.kind,'FLOW');assert.equal(c.condition.cType.name,'int');assert.equal(c.condition.type,'i32');
    assert.equal(c.condition.decimal,c.evaluation.conditionTruth?'1':'0');
    assert.equal(c.evaluation.selected,c.evaluation.conditionTruth?'true':'false');
    assert.notEqual(c.evaluation.skipped,c.evaluation.selected);assert.equal(c.selectedOutcome,c.evaluation.selected);
    assert.ok(c.dataInputs.length);assert.ok(c.evaluation.decisionExecutionIds.includes(c.eventId));
  }
  return {...r,events,positions,choices};
}

test('pointer conditional decisions precede selected member reads and preserve pointer aliases',async()=>{
  const r=await inspect(`typedef struct{int *left,*right;} Pair;
void choose(int **out,Pair *p){*out=p->left?p->left:p->right;}
int main(void){int a=11,b=7;Pair p={&a,&b};int *out;
 choose(&out,&p);p.left=0;choose(&out,&p);return *out;}`,7);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['true','false']);
  const definitions=new Map(r.plan.instructions.map(d=>[d.id,d]));
  for(const c of r.choices){
    const selected=r.trace.events.find(e=>e.activationId===c.activationId&&e.kind==='READ'&&e.controlInputs.includes(c.eventId)&&
      definitions.get(e.instructionId)?.memberPath?.includes(c.evaluation.selected==='true'?'left':'right'));
    assert.ok(selected);assert.ok(r.positions.get(c.eventId)<r.positions.get(selected.eventId));
    const write=r.trace.events.find(e=>e.activationId===c.activationId&&e.kind==='WRITE'&&e.inputEvaluations?.some(v=>v.nodeId===c.evaluation.nodeId));
    assert.ok(write);assert.ok(write.dataInputs.includes(selected.eventId));
    assert.equal(write.value.reference.targetObjectId,selected.value.reference.targetObjectId);
  }
});

test('nested conditional calls execute only selected arms and keep activation boundaries',async()=>{
  const r=await inspect(`int bump(int *p){*p+=1;return *p;}
int choose(int a,int b,int*x,int*y){return a?(b?bump(x):bump(y)):0;}
int main(void){int x=3,y=7;return choose(0,0,&x,&y)+choose(1,0,&x,&y)+choose(1,1,&x,&y);}`,12);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','false','true','true']);
  const calls=r.trace.events.filter(e=>e.action==='call'&&e.callee==='@bump');assert.equal(calls.length,2);
  for(const c of calls){
    const deciding=c.controlInputs.map(id=>r.events.get(id)).filter(e=>e.action==='conditional');assert.equal(deciding.length,2);
    assert.ok(deciding.every(e=>e.activationId===c.activationId));
    const resume=r.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===c.eventId);assert.ok(resume.returnExecutionId);
  }
});

test('compiler selects expose their observed truth without inventing arm work',async()=>{
  const r=await inspect('int f(double c){return c?7:9;} int main(void){return f(-0.0)+f(2.0);}',16);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true']);
  assert.ok(r.choices.every(c=>c.observationIds.some(id=>r.observations.trace.events.find(e=>e.eventId===id)?.action==='select')));
  for(const c of r.choices)assert.ok(!r.trace.events.some(e=>e.kind==='CALC'&&e.activationId===c.activationId&&e.operator==='?:'));
});

test('short-circuit conditions complete each ternary choice before selected side effects',async()=>{
  const r=await inspect(`int f(int *p,int a){int x=1,y=2;return (!p&&a)?++x:++y;}
int main(void){int n=1;return f(0,1)+f(&n,1)+f(0,0);}`,8);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['true','false','false']);
  for(const c of r.choices){
    const effect=r.trace.events.find(e=>e.kind==='CALC'&&e.operator==='++'&&e.activationId===c.activationId);
    assert.ok(effect.controlInputs.includes(c.eventId));assert.ok(r.positions.get(c.eventId)<r.positions.get(effect.eventId));
    assert.equal(r.events.get(c.dataInputs[0]).kind,'CALC');
  }
});

test('nested logical guards refresh conditional state on every loop iteration',async()=>{
  const r=await inspect(`int main(void){int x=0,sum=0,n=1;int*p=&n;
for(int i=0;i<4;i++){sum+=(i&&(i<2||!p))?++x:--x;}
return sum+10;}`,6);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','false','false']);
  for(const c of r.choices){
    const effect=r.trace.events.find(e=>e.kind==='CALC'&&['++','--'].includes(e.operator)&&e.controlInputs.includes(c.eventId));
    assert.ok(effect);assert.equal(effect.operator,c.evaluation.conditionTruth?'++':'--');
    assert.ok(effect.controlInputs.filter(id=>r.choices.some(other=>other.eventId===id)).every(id=>id===c.eventId));
    const calc=r.events.get(c.dataInputs[0]);assert.equal(calc.operator,'&&');
    assert.equal(calc.value.decimal,c.condition.decimal);
  }
});

test('conditional metadata cannot contradict its observed truth or lose decision provenance',async()=>{
  const r=await inspect('int f(int c){return c?5:6;}int main(void){return f(1);}',5);
  for(const mutate of [
    e=>{e.evaluation.selected='false';},
    e=>{e.evaluation.skipped='true';},
    e=>{e.condition.bits='0x00000000';e.condition.decimal='0';},
    e=>{e.evaluation.decisionExecutionIds=[];}
  ]){
    const trace=structuredClone(r.trace);mutate(trace.events.find(e=>e.action==='conditional'));
    assert.throws(()=>validateIRTrace(r.plan,trace));
  }
});
