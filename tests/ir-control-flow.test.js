import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

function inspect(result){
  const {plan,trace}=result;assert.equal(trace.status,'completed');assert.deepEqual(trace.coverage.irGaps,[]);
  const defs=new Map(plan.instructions.map(i=>[i.id,i])),events=new Map(trace.events.map(e=>[e.eventId,e]));
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of trace.events)for(const key of ['dataInputs','addressInputs','controlInputs'])
    for(const id of e[key])assert.ok(positions.get(id)<positions.get(e.eventId),`${id} must precede ${e.eventId}`);
  return {plan,trace,defs,events,line:e=>defs.get(e.instructionId)?.source?.line};
}
test('No3 preserves source work and connects case selection, fall-through and controlling decisions',async()=>{
  const filename='examples/c/blind/No3.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
  const result=await traceModel(source,{filename,includeObservations:true}),{plan,trace,defs,line}=inspect(result);
  assert.equal(result.stdout,'3 307\n');assert.equal(trace.exitCode,0);assert.equal(trace.events.length,35);
  const at=(n,action)=>trace.events.find(e=>line(e)===n&&e.action===action);
  const first=at(9,'branch'),second=at(11,'branch'),select=at(17,'switch');
  assert.deepEqual(at(14,'write').controlInputs,[first.eventId,second.eventId]);
  assert.deepEqual(second.controlInputs,[first.eventId]);
  assert.equal(select.selection.kind,'case');assert.equal(select.selection.value,'3');assert.equal(select.selection.source.line,24);
  const labels=new Map(plan.controlFlow.labels.map(l=>[l.id,l]));
  assert.equal(labels.get(select.selection.labelId).value,'3');
  const transition=trace.flowTransitions[0],edge=plan.controlFlow.edges.find(e=>e.id===transition.edgeId);
  assert.equal(trace.flowTransitions.length,1);assert.equal(edge.kind,'fall-through');
  assert.equal(labels.get(edge.fromLabelId).value,'3');assert.equal(labels.get(edge.toLabelId).kind,'default');
  assert.equal(labels.get(edge.toLabelId).source.line,27);
  assert.equal(transition.beforeExecutionId,at(28,'read').eventId);
  assert.deepEqual(transition.controlInputs,[select.eventId]);assert.deepEqual(at(28,'read').incomingTransitions,[transition.id]);
  const observed=result.observations.trace.events.find(e=>e.eventId===transition.observationIds[0]);
  assert.equal(observed.action,'branch');assert.equal(observed.selected,edge.toBlock);
  for(const n of [25,28])assert.deepEqual(at(n,'write').controlInputs,[select.eventId]);
  assert.ok(trace.events.filter(e=>line(e)>=32).every(e=>e.controlInputs.length===0),'switch control ends at reconvergence');
  const calc=at(28,'expression');assert.equal(calc.value.cType.name,'int');assert.equal(calc.value.decimal,'307');
  assert.equal(calc.steps.length,1);assert.equal(calc.steps[0].value.cType.name,'int');
  assert.equal(defs.get(calc.instructionId).calculationType.name,'int');
  assert.deepEqual(trace.events.slice(-3).map(e=>e.action),['return.value','return','frame.end']);
});
test('shared labels and default selection retain source identities without invented fall-through',async()=>{
  const source=`int choose(int n){int x=0; switch(n){case 1:case 2:x=10;break;default:x=20;}return x;}
int main(){choose(2);choose(5);return 0;}`;
  const {plan,trace}=inspect(await traceModel(source));
  const selects=trace.events.filter(e=>e.action==='switch');
  assert.deepEqual(selects.map(e=>e.selection.kind),['case','default']);
  assert.equal(selects[0].selection.value,'2');
  assert.equal(plan.controlFlow.labels.find(l=>l.id===selects[0].selection.labelId).value,'2');
  assert.equal(plan.controlFlow.labels.find(l=>l.id===selects[1].selection.labelId).kind,'default');
  assert.deepEqual(trace.flowTransitions,[]);
});
test('loop decisions refer to the current iteration and expire after the loop',async()=>{
  const source=`int main(){
 int total=0;
 for(int i=0;i<3;i++){
  if(i==1)continue;
  total+=i;
 }
 int after=total;
 return after;
}`;
  const {trace,line}=inspect(await traceModel(source));
  const conditions=trace.events.filter(e=>line(e)===3&&e.action==='branch');
  assert.equal(conditions.length,4);
  const writes=trace.events.filter(e=>line(e)===5&&e.action==='write');assert.equal(writes.length,2);
  assert.deepEqual(writes.map(e=>e.controlInputs.filter(id=>conditions.some(c=>c.eventId===id))),[[conditions[0].eventId],[conditions[2].eventId]]);
  assert.ok(trace.events.filter(e=>line(e)>=7).every(e=>e.controlInputs.length===0));
});
test('recursive calls keep decision occurrences isolated by activation',async()=>{
  const source=`int f(int n){
 if(n>0){int x=f(n-1);return x+1;}
 return 0;
}
int main(){int r=f(2);return r;}`;
  const {trace,events}=inspect(await traceModel(source));
  const recursiveCalls=trace.events.filter(e=>e.action==='call'&&e.callee==='@f'&&e.controlInputs.length);
  assert.equal(recursiveCalls.length,2);assert.notEqual(recursiveCalls[0].activationId,recursiveCalls[1].activationId);
  for(const e of trace.events)for(const id of e.controlInputs)assert.equal(events.get(id).activationId,e.activationId);
});
test('compound assignment keeps calculation, promotion and storage types distinct',async()=>{
  const source=`int main(){unsigned char a=250;a+=10;int b=-3;unsigned int u=2;b+=u;double d=1.5;d+=2.0;int f=3;f+=0.5;return 0;}`;
  const {trace,defs}=inspect(await traceModel(source));
  const calc=code=>trace.events.find(e=>e.kind==='CALC'&&defs.get(e.instructionId).source.expression===code);
  const a=calc('a+=10');assert.equal(defs.get(a.instructionId).calculationType.name,'int');
  assert.equal(defs.get(a.instructionId).storageType.name,'unsigned char');
  assert.deepEqual(a.steps.map(s=>[s.value.cType.name,s.value.decimal]),[['int','250'],['int','260'],['unsigned char','4']]);
  assert.equal(a.steps.filter(s=>s.operator==='+=').length,1);assert.equal(a.value.decimal,'4');
  const b=calc('b+=u');assert.deepEqual(b.steps.map(s=>[s.value.cType.name,s.value.decimal]),
    [['unsigned int','4294967293'],['unsigned int','4294967295'],['int','-1']]);
  assert.ok(b.steps[0].conversion.sameWidth);assert.ok(b.steps[2].conversion.sameWidth);
  const d=calc('d+=2.0');assert.equal(d.value.cType.name,'double');assert.equal(d.value.number,'3.5');
  const f=calc('f+=0.5');assert.equal(defs.get(f.instructionId).calculationType.name,'double');
  assert.equal(f.steps.find(s=>s.operator==='+=').value.number,'3.5');assert.equal(f.value.cType.name,'int');assert.equal(f.value.decimal,'3');
});
