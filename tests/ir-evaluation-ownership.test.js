import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const definitions=new Map(r.plan.instructions.map(d=>[d.id,d])),
    events=new Map(r.trace.events.map(e=>[e.eventId,e])),
    positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i])),
    choices=r.trace.events.filter(e=>e.kind==='FLOW'&&e.action==='conditional');
  for(const e of r.trace.events)for(const key of ['dataInputs','addressInputs','controlInputs','calleeInputs'])
    for(const id of e[key]??[])assert.ok(positions.get(id)<positions.get(e.eventId),`${key}: ${id} -> ${e.eventId}`);
  assert.ok(!r.trace.events.some(e=>['phi','select'].includes(e.operator)));
  return {...r,definitions,events,positions,choices};
}
const value=e=>Number(e.value.decimal??e.value.signed);
const writesFor=(r,name)=>{
  const objects=new Set(r.trace.objects.filter(o=>o.name===name).map(o=>o.id));
  return r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&objects.has(e.target?.objectId));
};
function assertSelectedWrites(r,writes,expected){
  assert.deepEqual(writes.map(value),expected);
  for(const w of writes){
    const selections=w.inputEvaluations?.filter(e=>e.kind==='conditional')??[];
    assert.ok(selections.length,'selected value must retain its conditional provenance');
    for(const selection of selections){
      const choice=r.choices.findLast(c=>c.activationId===w.activationId&&c.evaluation.nodeId===selection.nodeId&&
        r.positions.get(c.eventId)<r.positions.get(w.eventId));
      assert.ok(choice);assert.equal(selection.selected,choice.evaluation.selected);
      assert.ok(w.controlInputs.includes(choice.eventId),'selection decision is a control cause, not a value operand');
      assert.ok(selection.decisionExecutionIds.includes(choice.eventId));
    }
  }
}

test('logical condition and ternary selection keep distinct reads despite a shared LLVM location',async()=>{
  // Original preserved reproducer; the later recursive call compresses links.
  const r=await inspect(`int jump(int *a,int k){if(a[k]!=k)a[k]=jump(a,a[k]);return a[k];}
int main(void){int v[5];for(int i=0;i<5;i++)v[i]=i&&i<4?i-1:i;
int n=jump(v,3);return n;}`,0);
  const logical=r.plan.evaluations.find(e=>e.kind==='logical'&&e.operator==='&&'),
    calc=r.trace.events.find(e=>e.kind==='CALC'&&e.evaluation?.nodeId===logical.nodeId),
    conditionRead=r.trace.events.find(e=>e.kind==='READ'&&r.definitions.get(e.instructionId)?.sourceNodeId===logical.left.nodeId),
    choice=r.choices[0],selection=r.plan.evaluations.find(e=>e.nodeId===choice.evaluation.nodeId),
    armRead=r.trace.events.find(e=>e.kind==='READ'&&r.definitions.get(e.instructionId)?.sourceNodeId===selection.false.nodeId);
  assert.ok(calc);assert.ok(conditionRead);assert.ok(armRead);
  assert.ok(calc.inputs.some(i=>i.executionId===conditionRead.eventId));
  assert.ok(!calc.inputs.some(i=>i.executionId===armRead.eventId));
  assert.equal(value(calc),0);assert.equal(calc.evaluation.right,'skipped');
  assert.ok(choice.dataInputs.includes(calc.eventId));
  assert.ok(r.positions.get(conditionRead.eventId)<r.positions.get(calc.eventId));
  assert.ok(r.positions.get(calc.eventId)<r.positions.get(choice.eventId));
  assert.ok(r.positions.get(choice.eventId)<r.positions.get(armRead.eventId));
  const writes=writesFor(r,'v'),initial=writes.slice(0,5);
  assertSelectedWrites(r,initial,[0,0,1,2,4]);
  assert.ok(initial[0].dataInputs.includes(armRead.eventId));
  const slots=[];for(const w of writes)slots[w.target.offset/w.target.size]=value(w);
  assert.deepEqual(slots,[0,0,0,0,4]);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','true','true','false']);
});

test('renamed multiline OR guards forward the selected arithmetic value rather than the condition',async()=>{
  const r=await inspect(`int pick(int gate,int payload){
 int chosen = gate || payload > 2
   ? payload + 7
   : gate - 4;
 return chosen;
}
int main(void){int a=pick(0,1),b=pick(1,1),c=pick(0,3);return a+b+c+10;}`,24);
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');
  assert.deepEqual(logical.map(value),[0,1,1]);
  assert.deepEqual(logical.map(e=>e.evaluation.right),['evaluated','skipped','evaluated']);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','true']);
  const writes=writesFor(r,'chosen');assertSelectedWrites(r,writes,[-4,8,10]);
  for(const w of writes){
    const arm=w.dataInputs.map(id=>r.events.get(id)).find(e=>e.kind==='CALC'&&value(e)===value(w));
    assert.ok(arm,'chosen arithmetic result must reach the write');
    assert.ok(arm.controlInputs.some(id=>r.choices.some(c=>c.eventId===id)));
  }
});

test('nested conditional arms keep their own logical guards and selected-value provenance',async()=>{
  const r=await inspect(`int pick(int a,int b,int c){
 int chosen=(a&&b)?(c?b+10:b+20):(b||c?a+30:a+40);
 return chosen;
}
int main(void){return pick(0,0,0)+pick(0,1,0)+pick(1,1,0)+pick(1,1,1);}`,102);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),
    ['false','false','false','true','true','false','true','true']);
  assertSelectedWrites(r,writesFor(r,'chosen'),[40,30,21,11]);
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');
  assert.deepEqual(logical.filter(e=>e.operator==='&&').map(value),[0,0,1,1]);
  assert.deepEqual(logical.filter(e=>e.operator==='||').map(value),[0,1]);
  for(const w of writesFor(r,'chosen')){
    const choices=r.choices.filter(c=>c.activationId===w.activationId);
    assert.equal(choices.length,2);
    assert.ok(choices.every(c=>r.positions.get(c.eventId)<r.positions.get(w.eventId)));
  }
});

test('short-circuit guards choose one side-effecting call and forward its actual return',async()=>{
  const r=await inspect(`int touch(int *p){*p+=1;return *p;}
int pick(int enabled,int *left,int *right){
 int chosen=enabled&&*left<5?touch(left):touch(right);
 return chosen;
}
int main(void){int left=3,right=8;
 int a=pick(0,&left,&right),b=pick(1,&left,&right),c=pick(1,&left,&right),d=pick(1,&left,&right);
 return a+b+c+d+left+right;}`,43);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','true','false']);
  const calls=r.trace.events.filter(e=>e.action==='call'&&e.callee==='@touch');assert.equal(calls.length,4);
  const writes=writesFor(r,'chosen');assertSelectedWrites(r,writes,[9,4,5,10]);
  for(const choice of r.choices){
    const selected=calls.filter(c=>c.controlInputs.includes(choice.eventId));assert.equal(selected.length,1);
    const call=selected[0],resume=r.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId),
      write=writes.find(e=>e.activationId===choice.activationId);
    assert.ok(r.positions.get(choice.eventId)<r.positions.get(call.eventId));
    assert.ok(resume.returnExecutionId);assert.ok(write.dataInputs.includes(resume.eventId));
    assert.equal(value(write),value(resume));
  }
});

test('constant conditional arms keep the selection distinct from the logical condition',async()=>{
  const r=await inspect(`int pick(int a,int b){int chosen=a&&b?11:29;return chosen;}
int main(void){return pick(0,1)+pick(1,0)+pick(1,2);}`,69);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','false','true']);
  assertSelectedWrites(r,writesFor(r,'chosen'),[29,29,11]);
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');
  assert.deepEqual(logical.map(value),[0,0,1]);
  assert.deepEqual(logical.map(e=>e.evaluation.right),['skipped','evaluated','evaluated']);
  for(const choice of r.choices){
    const condition=logical.find(e=>e.activationId===choice.activationId);
    assert.ok(choice.dataInputs.includes(condition.eventId));
    assert.ok(r.positions.get(condition.eventId)<r.positions.get(choice.eventId));
  }
});

test('a conditional operand completes inside its enclosing logical condition before the outer choice',async()=>{
  const r=await inspect(`int pick(int c,int a,int b,int d){
 int chosen=((c?a:b)&&d)?11:29;
 return chosen;
}
int main(void){return pick(0,0,1,1)+pick(1,0,1,1)+pick(1,2,0,0);}`,69);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','true','false','true','false']);
  assertSelectedWrites(r,writesFor(r,'chosen'),[11,29,29]);
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');
  assert.deepEqual(logical.map(value),[1,0,0]);
  assert.deepEqual(logical.map(e=>e.evaluation.right),['evaluated','skipped','evaluated']);
  for(const calc of logical){
    const choices=r.choices.filter(e=>e.activationId===calc.activationId);assert.equal(choices.length,2);
    assert.ok(r.positions.get(choices[0].eventId)<r.positions.get(calc.eventId));
    assert.ok(r.positions.get(calc.eventId)<r.positions.get(choices[1].eventId));
    assert.ok(choices[1].dataInputs.includes(calc.eventId));
    const inner=choices[0],spec=r.plan.evaluations.find(e=>e.nodeId===inner.evaluation.nodeId),
      selectedNode=spec[inner.evaluation.selected].nodeId,
      selectedRead=r.trace.events.find(e=>e.kind==='READ'&&e.activationId===calc.activationId&&
        r.definitions.get(e.instructionId)?.sourceNodeId===selectedNode);
    assert.ok(selectedRead);assert.ok(calc.inputs.some(input=>input.executionId===selectedRead.eventId));
    assert.ok(calc.dataInputs.includes(selectedRead.eventId));
  }
});

test('a conditional operand preserves its own choice when the outer guard selects an update',async()=>{
  const r=await inspect(`int f(int c,int a,int b,int d){int x=10;return ((c?a:b)&&d)?++x:--x;}
int main(void){return f(0,0,1,1)+f(1,0,1,1)+f(1,2,0,0);}`,29);
  assert.deepEqual(r.choices.map(c=>c.evaluation.selected),['false','true','true','false','true','false']);
  const logical=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');
  assert.deepEqual(logical.map(value),[1,0,0]);
  for(const calc of logical){
    const [inner,outer]=r.choices.filter(e=>e.activationId===calc.activationId),
      spec=r.plan.evaluations.find(e=>e.nodeId===inner.evaluation.nodeId),
      selectedRead=r.trace.events.find(e=>e.kind==='READ'&&e.activationId===calc.activationId&&
        r.definitions.get(e.instructionId)?.sourceNodeId===spec[inner.evaluation.selected].nodeId),
      effects=r.trace.events.filter(e=>e.kind==='CALC'&&['++','--'].includes(e.operator)&&e.activationId===calc.activationId);
    assert.ok(selectedRead);assert.ok(calc.inputs.some(input=>input.executionId===selectedRead.eventId));
    assert.ok(calc.dataInputs.includes(selectedRead.eventId));
    assert.ok(r.positions.get(inner.eventId)<r.positions.get(calc.eventId));
    assert.ok(r.positions.get(calc.eventId)<r.positions.get(outer.eventId));
    assert.equal(effects.length,1);assert.equal(effects[0].operator,outer.evaluation.conditionTruth?'++':'--');
    assert.ok(effects[0].controlInputs.includes(outer.eventId));
  }
});
