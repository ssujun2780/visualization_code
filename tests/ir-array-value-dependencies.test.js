import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {arrayValueDependencies,validateArrayValueDependencies} from '../scripts/inference/array-value-dependencies.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const before=structuredClone(r.trace),relations=arrayValueDependencies(r.plan,r.trace);
  assert.deepEqual(r.trace,before,'relations cannot change execution or storage');
  const structures=r.trace.structures.filter(s=>s.kind!=='array-work'),work=r.trace.structures.find(s=>s.kind==='array-work');
  validateArrayValueDependencies({...r.trace,structures:[...structures,{...work,computedDependencies:relations}]});
  const object=name=>r.trace.objects.find(o=>o.name===name),
    forTarget=name=>relations.filter(d=>d.target.objectId===object(name)?.id),events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  return {...r,relations,object,forTarget,events};
}
const offsets=relation=>relation.sources.map(s=>s.storage.offset).sort((a,b)=>a-b);

test('rectangular cross-array computations preserve operands and distinguish arithmetic from copies',async()=>{
  const r=await inspect(`int main(void){int input[2][3]={{2,3,5},{7,11,13}},output[2][3]={0};
 output[1][2]=input[0][2]+input[1][0]*2;
 output[0][0]=input[1][2]+0;
 output[0][1]=input[0][0];
 return output[1][2]+output[0][0]+output[0][1];}`,34);
  const values=r.forTarget('output');assert.equal(values.length,2);
  const combined=values.find(d=>d.target.offset===20),unchanged=values.find(d=>d.target.offset===0);
  assert.deepEqual(offsets(combined),[8,12]);assert.deepEqual(offsets(unchanged),[20]);
  assert.ok(values.every(d=>d.status==='supported'&&d.sources.every(s=>s.storage.objectId===r.object('input').id)));
  assert.equal(combined.calculations.length,1,'one source expression remains one CALC');
  assert.equal(unchanged.calculations[0].operator,'+','equal bits do not turn +0 into a copy');
  assert.ok(!values.some(d=>d.target.offset===4));
});

test('selected branches and logical values use only observed reads and keep control causes separate',async()=>{
  const r=await inspect(`int main(void){int select=1,input[3]={5,5,9},output[2]={0};
 output[0]=select?input[0]+2:input[1]+100;
 output[1]=(input[0]<input[2])&&(input[1]!=0);
 return output[0]+output[1];}`,8);
  const [chosen,logical]=r.forTarget('output');
  assert.deepEqual(offsets(chosen),[0]);assert.deepEqual(offsets(logical),[0,4,8]);
  assert.ok(chosen.controlExecutionIds.some(id=>r.events.get(id).action==='conditional'));
  assert.ok(chosen.sources.every(s=>s.storage.objectId!==r.object('select').id));
  assert.ok(!chosen.calculations.some(c=>c.inputs.some(i=>i.value?.literal==='100')));
  assert.equal(logical.calculations.length,1);assert.equal(logical.calculations[0].operator,'&&');
});

test('narrowing and floating arithmetic retain typed inputs and actual source ranges',async()=>{
  const r=await inspect(`int main(void){unsigned input[2]={257,17};unsigned char bytes[2]={0};
 double weights[2]={1.5,2.25},result[1]={0};
 bytes[0]=(unsigned char)input[0];bytes[1]=(unsigned char)input[1];
 result[0]=weights[0]*weights[1];return bytes[0]+bytes[1];}`,18);
  const narrow=r.forTarget('bytes');assert.equal(narrow.length,2);
  assert.ok(narrow.every(d=>d.calculations.some(c=>c.operator==='cast')));
  assert.deepEqual(narrow.map(d=>d.sources[0].storage.size),[4,4]);
  assert.deepEqual(narrow.map(d=>d.target.size),[1,1]);
  const floating=r.forTarget('result')[0];assert.equal(floating.calculations[0].operator,'*');
  assert.deepEqual(offsets(floating),[0,8]);assert.ok(floating.sources.every(s=>s.value.type==='double'));
});

test('read-modify-write stops at the read version instead of expanding prior writers',async()=>{
  const r=await inspect(`int main(void){int cells[2]={3,4};cells[0]+=cells[1]*2;cells[1]=cells[0]-1;return cells[1];}`,10);
  const values=r.forTarget('cells');assert.equal(values.length,2);
  assert.deepEqual(offsets(values[0]),[0,4]);assert.deepEqual(offsets(values[1]),[0]);
  assert.ok(!values[1].calculationExecutionIds.some(id=>values[0].calculationExecutionIds.includes(id)));
  const read=r.events.get(values[1].sources[0].readExecutionId);
  assert.ok(read.dataInputs.includes(values[0].executionId));
});

test('computed wrapper returns follow exact dynamic returns and never treat arguments as results',async()=>{
  const r=await inspect(`int fetch(const int* values,int index){return values[index]*3;}
int wrapper(const int* values,int index){return fetch(values,index);}
int discard(const int* values){(void)values;return 7;}
int main(void){int input[3]={2,4,6},output[3]={0};
 output[0]=wrapper(input,1);output[1]=wrapper(input,2);output[2]=discard(input)+1;
 return output[0]+output[1]+output[2];}`,38);
  const values=r.forTarget('output');assert.equal(values.length,3);
  assert.deepEqual(offsets(values[0]),[4]);assert.deepEqual(offsets(values[1]),[8]);
  assert.equal(values[0].calls.length,2);assert.equal(values[1].calls.length,2);
  assert.notEqual(values[0].sources[0].readExecutionId,values[1].sources[0].readExecutionId);
  assert.deepEqual(values[2].sources,[],'a constant return has no array argument value dependency');
  assert.ok(values.every(d=>d.status==='supported'));
});

test('incomplete producer evidence remains partial and validation rejects invented memory edges',async()=>{
  const r=await inspect('int main(void){int input[2]={2,3},output[1];output[0]=input[0]+input[1];return output[0];}',5);
  const relation=r.forTarget('output')[0],missing=relation.sources[0].readExecutionId,
    altered={...r.trace,events:r.trace.events.filter(e=>e.eventId!==missing)};
  const [partial]=arrayValueDependencies(r.plan,altered);
  assert.equal(partial.status,'partial');assert.ok(partial.unresolved.length);
  const invalid=structuredClone(r.trace),work=invalid.structures.find(s=>s.kind==='array-work');
  work.computedDependencies=structuredClone(r.relations);
  work.computedDependencies[0].sources[0].storage.offset+=4;
  assert.throws(()=>validateArrayValueDependencies(invalid),/저장소가 일치/);
  work.computedDependencies=structuredClone(r.relations);
  const target=work.computedDependencies[0].executionId;
  work.computedDependencies[0].valueEdges.push({sourceExecutionId:target,targetExecutionId:target});
  assert.throws(()=>validateArrayValueDependencies(invalid),/실제 값 입력/);
});
