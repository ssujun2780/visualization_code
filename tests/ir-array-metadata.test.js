import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateIRPlan,validateIRTrace} from '../scripts/model/ir-schema.mjs';

const inspect=r=>({...r,defs:new Map(r.plan.instructions.map(i=>[i.id,i]))});
const sha256=s=>createHash('sha256').update(s).digest('hex');
const intType=t=>{
  assert.ok(t);assert.equal(t.name,'int');assert.equal(t.sizeBits,32);
  assert.equal(t.signedness,'signed');assert.deepEqual(t.display,{label:'int',badges:[]});
};

test('No8 array types, stores and comparisons preserve the observed source process',async()=>{
  const file='examples/c/blind/No8.c',source=await readFile(new URL('../'+file,import.meta.url),'utf8');
  const baseline=new URL('../test-results/no8-source-process-2026-11-02/',import.meta.url);
  const sourceHash=sha256(source),expectedStdout='3 6 0 0 0\n0 10 0 20 0\n3 16 0 20 0\n99 6 0 0 0\n3 16 0 20 0\n3 20 0 20 0\n';
  const report=process.env.NO8_REPORT_DIR;
  if(report){await mkdir(report,{recursive:true});await writeFile(report+'/before.json',JSON.stringify({sourceSha256:sha256(source),
    expectedStdout,expectedEvents:610,expectedCalcs:124,
    correction:'Ternary condition CALC plus selected-value forwarding is intentional; the earlier whole-ternary-CALC expectation is withdrawn.'},null,2),{flag:'wx'});}
  const r=inspect(await traceModel(source,{filename:file,includeObservations:true})),{trace,plan,defs}=r;
  if(report){
    for(const [f,v]of Object.entries({'plan.json':plan,'trace.json':trace,'observations.plan.json':r.observations.plan,'observations.trace.json':r.observations.trace}))await writeFile(report+'/'+f,JSON.stringify(v,null,2));
    await writeFile(report+'/stdout.txt',r.stdout);
  }
  validateIRPlan(plan);validateIRTrace(plan,trace);
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,0);assert.equal(r.stdout,expectedStdout);
  assert.equal(trace.events.length,610);assert.equal(trace.events.filter(e=>e.kind==='CALC').length,124);
  for(const d of plan.declarations.slice(0,3)){
    const o=trace.objects.find(o=>o.name===d.name&&o.storage==='automatic');assert.ok(o);
    const begin=trace.events.find(e=>e.action==='object.begin'&&e.objectId===o.id);
    for(const t of [d.cType,o.cType,defs.get(begin.instructionId).cType]){
      assert.equal(t.kind,'array');assert.equal(t.name,'int[5]');assert.equal(t.count,5);
      assert.deepEqual(t.dimensions,[5]);assert.equal(t.sizeBits,160);assert.equal(t.signedness,null);
      assert.deepEqual(t.display,{label:'int[5]',badges:[]});intType(t.elementType);
    }
  }
  const line=e=>defs.get(e.instructionId)?.source?.line;
  const stores=trace.events.filter(e=>e.action==='write'&&[17,20,21,28,31].includes(line(e)));
  assert.equal(stores.length,13);
  assert.deepEqual(stores.map(e=>e.value.decimal),['3','16','0','20','0','99','-5','3','16','0','20','0','20']);
  for(const e of stores){intType(e.value.cType);intType(defs.get(e.instructionId).cType);}
  const comparisons=trace.events.filter(e=>e.kind==='CALC'&&e.operator==='==');
  assert.equal(comparisons.length,30);
  assert.deepEqual(comparisons.map(e=>e.value.decimal),Array(6).fill(['0','0','0','0','1']).flat());
  for(const e of comparisons){intType(e.value.cType);assert.equal(e.value.type,'i32');assert.equal(e.steps.length,1);}
  const calls=trace.events.filter(e=>e.action==='call'&&e.callee==='@printf');
  assert.equal(calls.length,30);
  assert.deepEqual(calls.map(e=>e.arguments[2].decimal),Array(6).fill(['32','32','32','32','10']).flat());
  for(const e of calls){assert.equal(e.inputEvaluations.length,1);assert.ok(e.inputEvaluations[0].selected);assert.ok(e.inputEvaluations[0].skipped);}
  if(report){
    const old=JSON.parse(await readFile(new URL('trace.json',baseline),'utf8'));
    const sequence=t=>t.events.map(e=>({kind:e.kind,action:e.action,operator:e.operator,target:e.target,
      data:e.dataInputs,address:e.addressInputs,control:e.controlInputs,text:e.text,ended:e.endedObjects}));
    assert.deepEqual(sequence(trace),sequence(old),'metadata repairs must not change memory work, dependency order or lifetime');
  }
  assert.ok(r.observations.trace.events.some(e=>e.value?.type==='i1'),'raw LLVM values remain available');
  assert.equal(sha256(await readFile(new URL('../'+file,import.meta.url),'utf8')),sourceHash);
  if(report)await writeFile(report+'/verification.json',JSON.stringify({passed:true,sourceSha256:sha256(source),events:610,calcs:124,
    arrayTypes:3,typedElementStores:13,typedComparisons:30,conditionalCalls:30,processUnchanged:true,
    stdout:r.stdout,coverage:trace.coverage,sourceMapStats:plan.sourceMap?.stats},null,2));
});

test('nested arrays and typedefs retain dimensions, element widths and unsigned badges',async()=>{
  const r=inspect(await traceModel('typedef unsigned short Row[3];\nint main(){Row grid[2]={{1,2,3},{4,5,6}};\n grid[1][2]=65535;\n return grid[0][0];}'));
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,1);
  const t=r.trace.objects.find(o=>o.name==='grid').cType;
  assert.equal(t.kind,'array');assert.deepEqual(t.dimensions,[2,3]);assert.equal(t.sizeBits,96);
  assert.equal(t.elementType.count,3);assert.equal(t.elementType.sizeBits,48);
  assert.equal(t.elementType.elementType.sizeBits,16);assert.equal(t.elementType.elementType.signedness,'unsigned');
  assert.deepEqual(t.display,{label:'Row[2]',badges:['u']});
  const declared=r.plan.declarations.find(d=>d.name==='grid').cType;
  assert.equal(declared.sizeBits,96);assert.deepEqual(declared.dimensions,[2,3]);
  const store=r.trace.events.find(e=>e.action==='write'&&r.defs.get(e.instructionId)?.source?.line===3);
  assert.equal(store.value.decimal,'65535');assert.equal(store.value.cType.sizeBits,16);assert.equal(store.value.cType.signedness,'unsigned');
});

test('ordinary member and pointer stores keep target types without repeating postfix indices',async()=>{
  const r=inspect(await traceModel(`typedef struct {unsigned char v; float f;} Cell;
int main(){Cell a[2]={{0,0},{0,0}};int i=0;
 a[i++].v=255;
 unsigned char *p=&a[1].v;
 *p=254;
 a[0].f=1.5;
 return i;}`));
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,1);
  const writes=l=>r.trace.events.filter(e=>e.action==='write'&&r.defs.get(e.instructionId)?.source?.line===l);
  const index=writes(3).find(e=>r.trace.objects.find(o=>o.id===e.target.objectId)?.name==='i');
  intType(index.value.cType);assert.equal(index.value.decimal,'1');
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='++').length,1);
  for(const [l,decimal]of [[3,'255'],[5,'254']]){
    const e=writes(l).at(-1);assert.equal(e.value.decimal,decimal);assert.equal(e.value.cType.name,'unsigned char');
    assert.equal(e.value.cType.sizeBits,8);assert.deepEqual(e.value.cType.display.badges,['u']);
  }
  const f=writes(6)[0];assert.equal(f.value.cType.name,'float');assert.equal(f.value.cType.sizeBits,32);assert.equal(f.value.number,'1.5');
});

test('source comparison casts to 64 bits remain visible, including unused explicit casts',async()=>{
  const r=inspect(await traceModel(`int main(){int a=1,b=2;
 unsigned long long c=(unsigned long long)(a<b);
 (unsigned long long)(a>b);
 return (int)c;}`,{includeObservations:true}));
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,1);
  for(const line of [2,3]){
    const casts=r.trace.events.filter(e=>e.kind==='CALC'&&r.defs.get(e.instructionId)?.source?.line===line)
      .flatMap(e=>e.steps??[e]).filter(s=>s.conversion?.explicit&&s.conversion.toType.sizeBits===64);
    assert.equal(casts.length,1);assert.equal(casts[0].value.type,'i64');assert.equal(casts[0].value.cType.signedness,'unsigned');
  }
});
