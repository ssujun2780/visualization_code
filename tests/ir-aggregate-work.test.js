import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
import {materializeMemory} from '../scripts/model/memory-state.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,expected);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  return {...r,events:r.trace.events,defs,line:e=>defs.get(e.instructionId)?.source?.line};
}
function aggregateCalls(r){
  for(const c of r.events.filter(e=>e.action==='call'&&e.arguments?.some(a=>a.kind==='aggregate'))){
    const args=r.events.filter(e=>e.action==='argument'&&e.callExecutionId===c.eventId&&e.value?.kind==='aggregate');
    assert.ok(args.length);for(const a of args){assert.equal(a.value.cType.kind,'record');assert.ok(!a.value.type.endsWith('*'));assert.ok(a.memoryState);}
  }
  for(const v of r.events.filter(e=>e.action==='return.value'&&e.value?.kind==='aggregate')){
    assert.equal(v.target.kind,'return-port');assert.equal(v.value.cType.kind,'record');assert.ok(v.memoryState);
    assert.ok(materializeMemory(v.memoryState).bytes.length===v.value.byteLength);
    const ret=r.events.find(e=>e.action==='return'&&e.activationId===v.activationId),end=r.events.find(e=>e.action==='frame.end'&&e.activationId===v.activationId),
      resume=r.events.find(e=>e.action==='resume'&&e.callExecutionId===v.callExecutionId);
    assert.ok(r.events.indexOf(v)<r.events.indexOf(ret)&&r.events.indexOf(ret)<r.events.indexOf(end)&&r.events.indexOf(end)<r.events.indexOf(resume));
    assert.equal(resume.returnExecutionId,ret.eventId);assert.equal(resume.value.kind,'aggregate');assert.ok(resume.dataInputs.includes(v.eventId));
  }
}

test('renamed and shifted No14 preserves member work, independent values, shared pointer and aggregate return',async()=>{
  let source=await readFile(new URL('../examples/c/blind/No14.c',import.meta.url),'utf8');
  for(const [i,name]of [...new Set(source.match(/\b[A-Za-z]{10}\b/g))].entries())source=source.replaceAll(new RegExp(`\\b${name}\\b`,'g'),`field_${i}`);
  const r=await inspect('\n\n'+source,'3 14 107\n1 107\n');aggregateCalls(r);
  const initialization=r.events.filter(e=>e.kind==='WRITE'&&r.line(e)===13);
  assert.equal(initialization.length,2);assert.deepEqual(initialization.map(e=>r.defs.get(e.instructionId).memberPath.length),[2,1]);
  assert.deepEqual(initialization.map(e=>e.value.cType.kind??e.value.cType.name),['int','pointer']);
  assert.ok(initialization.every(e=>r.defs.get(e.instructionId).expression.kind!=='VarDecl'));
  assert.ok(r.trace.objects.filter(o=>o.frameId==='f2').every(o=>o.cType.kind==='record'));
});

test('member paths follow compiler padding, nested arrays, reordered designators and mixed argument positions',async()=>{
  const source=`#include <stdio.h>
typedef struct { short small; unsigned int large; } Inner;
typedef struct { unsigned char tag; int *pointer; Inner inner; int values[2]; } Packet;
int calls=0;
int once(void){ calls++; return 2; }
Packet change(int delta, Packet copy, Packet *original){
  copy.inner.small += delta; copy.values[1] += delta; *copy.pointer += delta;
  original->inner.large += 1U; return copy;
}
int main(void){int shared=10;Packet a={.values={6,7},.inner={.large=8U,.small=3},.pointer=&shared,.tag=250};
 Packet b=change(once(),a,&a);printf("%d %u %d %d %u %d %d\\n",b.inner.small,a.inner.large,b.values[1],shared,(unsigned)b.tag,a.values[1],calls);return 0;}`;
  const r=await inspect(source,'5 9 9 12 250 7 1\n');aggregateCalls(r);
  const call=r.events.find(e=>e.action==='call'&&e.callee==='@change');
  assert.equal(call.arguments[0].decimal,'2');assert.equal(call.arguments[1].kind,'aggregate');assert.equal(call.arguments[2].cType.kind,'pointer');
  const argument=r.events.find(e=>e.action==='argument'&&e.value?.kind==='aggregate');assert.equal(argument.parameterIndex,1);
  assert.ok(r.events.some(e=>r.defs.get(e.instructionId)?.memberPath?.join('.')==='inner.small'));
  assert.ok(r.events.some(e=>r.defs.get(e.instructionId)?.targetPath?.some(p=>p.kind==='index'&&p.index==='1')));
  assert.equal(r.events.filter(e=>e.action==='call'&&e.callee==='@once').length,1);
});

test('multiple aggregate returns and nested sret forwarding retain the executed return source and each resume',async()=>{
  const source=`#include <stdio.h>
typedef struct {int value; int *pointer;} Box;
int calls=0;
Box choose(Box a,int mode){
 if(mode){a.value+=10;return a;}
 a.value+=20;return a;
}
Box relay(Box a,int mode){calls++;return choose(a,mode);}
int main(void){int n=7;Box a={3,&n};Box b=relay(a,1);Box c=relay(a,0);printf("%d %d %d %d %d\\n",b.value,c.value,*b.pointer,b.pointer==c.pointer,calls);return 0;}`;
  const r=await inspect(source,'13 23 7 1 2\n');aggregateCalls(r);
  const chosen=r.events.filter(e=>e.action==='return.value'&&r.trace.frames.find(f=>f.id===e.activationId)?.functionName==='choose');
  assert.deepEqual(chosen.map(r.line),[5,6]);
  assert.equal(r.events.filter(e=>e.action==='return.value'&&e.value?.kind==='aggregate').length,4);
});

test('explicit memcpy calls, implicit copies and scalar/pointer/void functions keep distinct source behavior',async()=>{
  const source=`#include <stdio.h>
#include <string.h>
typedef struct {int value;int *pointer;} Box;
int *touch(int *p){*p+=1;return p;}
int number(int n){return n+2;}
void idle(void){}
Box copy(Box source){Box other=source;memcpy(&other,&source,sizeof other);return other;}
int main(void){int n=4;Box a={6,&n};Box b=copy(a);int *p=touch(b.pointer);idle();printf("%d %d %d\\n",b.value,*p,number(3));return 0;}`;
  const r=await inspect(source,'6 5 5\n');aggregateCalls(r);
  const explicit=r.events.find(e=>e.action==='call'&&e.callee==='@memcpy');assert.ok(explicit);
  const effect=r.events.find(e=>e.action==='copy'&&e.callExecutionId===explicit.eventId);assert.ok(effect);assert.ok(effect.returnExecutionId);
  for(const name of ['@touch','@number','@idle']){const c=r.events.find(e=>e.action==='call'&&e.callee===name);assert.ok(r.events.some(e=>e.action==='resume'&&e.callExecutionId===c.eventId));}
  const pointer=r.events.find(e=>e.action==='resume'&&e.callExecutionId===r.events.find(e=>e.action==='call'&&e.callee==='@touch').eventId);
  assert.equal(pointer.value.cType.kind,'pointer');assert.ok(pointer.value.reference.dereferenceable);
  const invalid=structuredClone(r.trace),copied=invalid.events.find(e=>e.action==='copy');copied.callExecutionId=invalid.events.find(e=>e.action==='argument').eventId;
  assert.throws(()=>validateIRTrace(r.plan,invalid),/호출 경계/);
});

test('compound-literal record returns observe direct sret stores and select the actual return statement',async()=>{
  const source=`#include <stdio.h>
struct Box {int value;int *pointer;};
struct Box make(int *p,int mode){
 if(mode)return (struct Box){.pointer=p,.value=11};
 return (struct Box){22,p};
}
int main(void){int n=9;struct Box a=make(&n,1);struct Box b=make(&n,0);printf("%d %d %d %d\\n",a.value,b.value,*a.pointer,a.pointer==b.pointer);return 0;}`;
  const r=await inspect(source,'11 22 9 1\n');aggregateCalls(r);
  const values=r.events.filter(e=>e.action==='return.value'&&e.value?.kind==='aggregate');assert.deepEqual(values.map(r.line),[4,5]);
  assert.ok(values.every(e=>e.value.cType.name==='struct Box'));
});

test('by-value and return copies preserve a one-past pointer member origin',async()=>{
  const source=`#include <stdio.h>
typedef struct {int value;int *pointer;} Box;
Box identity(Box x){int *p=x.pointer;printf("%d ",p==x.pointer);return x;}
int main(void){int a[2]={4,5};Box x={3,a+2};Box y=identity(x);printf("%d %d\\n",y.pointer==a+2,(int)(y.pointer-a));return 0;}`;
  const r=await inspect(source,'1 1 2\n');aggregateCalls(r);
  const array=r.trace.objects.find(o=>o.name==='a');
  const pointers=r.events.filter(e=>e.kind==='READ'&&r.defs.get(e.instructionId)?.memberPath?.includes('pointer'));
  assert.ok(pointers.length>=3);for(const p of pointers){assert.equal(p.value.reference.targetObjectId,array.id);assert.equal(p.value.reference.status,'one-past');assert.equal(p.value.reference.dereferenceable,false);}
});
