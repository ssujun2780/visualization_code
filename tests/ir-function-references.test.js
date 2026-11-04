import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {FunctionReferences,isFunctionPointer} from '../scripts/model/function-references.mjs';
import {ModelRecorder} from '../scripts/model/recorder.mjs';

test('compiler function identities survive globals, changing aliases, record/array copies and recursive calls',async()=>{
  const source=`typedef int (*Route)(int);
int ulven(int n){return n+10;}
int narsk(int n){return n*2;}
int velor(int n){return n?velor(n-1)+1:0;}
Route choose(int n){return n?ulven:narsk;}
Route initial=narsk;
struct Parcel {Route entries[2];};
int main(void){
 struct Parcel a={{ulven,narsk}},b=a;
 Route p=initial; int total=p(4);
 p=b.entries[0]; total+=p(5);
 b.entries[1]=ulven; total+=b.entries[1](6);
 p=narsk; total+=p(7);
 b.entries[0]=velor; total+=b.entries[0](3);
 p=choose(1); total+=p(1);
 Route empty=0;
 return total-67;
}`;
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.gaps,[]);
  const functions=new Map(r.plan.functions.map(f=>[f.name,f.id])),calls=r.trace.events.filter(e=>e.action==='call'&&e.indirectTableIndex!==undefined);
  assert.deepEqual(calls.map(c=>c.resolvedFunctionName),['narsk','ulven','ulven','narsk','velor','ulven']);
  for(const call of calls){
    assert.equal(call.resolvedFunctionId,functions.get(call.resolvedFunctionName));
    assert.equal(call.functionTarget.kind,'function');assert.equal(call.functionTarget.status,'resolved');
    assert.equal(call.functionTarget.tableIndex,call.indirectTableIndex);
    assert.equal(call.calleeInputs.length,1);
    const read=r.trace.events.find(e=>e.eventId===call.calleeInputs[0]);
    assert.equal(read.kind,'READ');assert.equal(read.value.reference.functionId,call.resolvedFunctionId);
    assert.ok(call.dataInputs.includes(read.eventId));assert.equal(call.arguments.length,1);assert.equal(call.inputs.length,1);
    const resume=r.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId);
    assert.ok(resume);assert.ok(resume.dataInputs.length);
  }
  const refs=r.trace.references.filter(ref=>ref.kind==='function');assert.ok(refs.length>=8);
  for(const ref of refs){
    assert.ok(!('targetObjectId' in ref));assert.ok(!('address' in ref));
    if(ref.tableIndex)assert.equal(ref.functionId,functions.get(ref.functionName));else assert.equal(ref.status,'null');
  }
  const values=r.trace.events.filter(e=>e.value?.reference?.kind==='function').map(e=>e.value);
  assert.ok(values.length);for(const value of values)assert.ok(!('address' in value));
  assert.ok(!r.plan.instructions.some(i=>i.action==='function.address'));
  assert.ok(!r.observations.trace.events.some(e=>e.action==='function.address'));
  assert.deepEqual(r.plan.coverage.unmappedObservations,[]);
});

test('void and unbraced statement calls discard returns while conditions and value consumers use them',async()=>{
  const source=`// Return-consumption contexts.
int sample(int n){return n;}
void mark(void){}
int main(void){
 if(1) mark();
 if(1) sample(1); else sample(2);
 int i=0;
 while(i++<1) sample(3);
 do sample(4); while(0);
 for(i=0;i<1;i++) sample(5);
 if(sample(1)) mark();
 while(sample(0)) mark();
 do mark(); while(sample(0));
 for(sample(6);sample(0);sample(7)) mark();
 int value=sample(8);
 (void)sample(9);
 sample(10),sample(11);
 value+=sample(12);
 return value-20;
}`;
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  const calls=r.trace.events.filter(e=>e.action==='call'),defs=new Map(r.plan.instructions.map(i=>[i.id,i]));
  const expected=new Map([[5,'discarded'],[6,'discarded'],[8,'discarded'],[9,'discarded'],[10,'discarded'],
    [11,'used'],[12,'used'],[13,'used'],[15,'used'],[16,'discarded'],[17,'discarded'],[18,'used']]);
  for(const call of calls){
    if(call.callee==='@mark'){assert.equal(call.returnDisposition,'discarded');assert.equal(call.returnType.kind,'void');continue;}
    const line=defs.get(call.instructionId).source.start.line;
    if(line===14)assert.equal(call.returnDisposition,call.arguments[0].signed==='0'?'used':'discarded');
    else assert.equal(call.returnDisposition,expected.get(line),`line ${line}`);
  }
  // The unexecuted for-increment is still classified from its AST slot.
  const increment=r.plan.instructions.find(i=>i.action==='call'&&i.source?.expression==='sample(7)');
  assert.ok(increment);assert.equal(increment.callProjection.returnDisposition,'discarded');
});

test('unknown table slots stay unresolved even when their bits equal a live data address',()=>{
  const references=new FunctionReferences();
  assert.equal(references.target(0).status,'null');assert.equal(references.target(42).status,'unresolved');
  references.register(42,{functionId:'fn7',functionName:'renamed'});assert.equal(references.target(42).functionId,'fn7');
  references.register(42,{functionId:'fn8',functionName:'other'});assert.equal(references.target(42).status,'unresolved');
  assert.ok(isFunctionPointer('i32 (i32)*'));assert.ok(!isFunctionPointer('i32 (i32)**'));
  const recorder=new ModelRecorder({instructions:[]},{layout:()=>({size:4})});
  recorder.objects.push({id:'o1',address:42,size:8,lifecycle:'alive'});
  const reference=recorder.pointerTarget(42,'i32 (i32)*');
  assert.equal(reference.kind,'function');assert.equal(reference.status,'unresolved');assert.ok(!('targetObjectId' in reference));
});
