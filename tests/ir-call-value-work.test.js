import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,expected);
  assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const definitions=new Map(r.plan.instructions.map(d=>[d.id,d])),events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  for(const a of r.trace.events.filter(e=>e.action==='argument'))for(const i of a.inputs??[])assert.notEqual(i.executionId,a.eventId);
  return {...r,definitions,events};
}

test('literal, computed, nested, repeated and indirect call arguments retain their actual incoming producers',async()=>{
  const source=`#include <stdio.h>
int calls=0;
int relay(int x){calls++;return x;}
int main(void){int n=5;int a=relay(6);int b=relay(n-1);int c=relay(relay(2));
 int (*fp)(int)=relay;int d=fp(n++);int e=0;for(int i=0;i<2;i++)e+=relay(i+10);
 printf("%d %d %d %d %d %d %d\\n",a,b,c,d,e,n,calls);return 0;}`;
  const r=await inspect(source,'6 4 2 5 21 6 7\n'),args=r.trace.events.filter(e=>e.action==='argument');
  assert.equal(args.length,7);assert.deepEqual(args.map(a=>a.value.decimal),['6','4','2','2','5','10','11']);
  for(const a of args){const c=r.events.get(a.callExecutionId),incoming=c.inputs[a.parameterIndex];assert.ok(incoming);
    assert.equal(a.inputs[0].value.bits,a.value.bits);assert.equal(a.inputs[0].executionId,incoming.executionId);
    if(a.inputs[0].executionId){assert.ok(r.events.has(a.inputs[0].executionId));assert.ok(a.dataInputs.includes(a.inputs[0].executionId));}
  }
  assert.equal(args[0].inputs[0].observationId,null);assert.equal(args[0].inputs[0].executionId,undefined);
  assert.equal(r.events.get(args[1].inputs[0].executionId).kind,'CALC');
  assert.equal(r.events.get(args[3].inputs[0].executionId).action,'resume');
  assert.notEqual(args[5].inputs[0].executionId,args[6].inputs[0].executionId);
  const invalid=structuredClone(r.trace),argument=invalid.events.find(e=>e.action==='argument');argument.inputs[0].executionId=argument.eventId;
  assert.throws(()=>validateIRTrace(r.plan,invalid),/인자 입력/);
});

test('return ports retain typedef, unsigned widths, int64, float, qualified pointer and implicit main types',async()=>{
  const source=`#include <stdio.h>
typedef unsigned short Count;
Count narrow(unsigned int n){if(n)return n;return 0;}
unsigned char byte(unsigned int n){return n;}
long long wide(void){return -9000000000LL;}
float fraction(int mode){if(mode)return 1.25f;return -0.0f;}
const int *selectp(const int *p){return p;}
int main(void){int n=8;Count a=narrow(65537U);Count b=narrow(0);unsigned char c=byte(260U);
 float f=fraction(1);float z=fraction(0);const int *p=selectp(&n);
 printf("%u %u %u %lld %.2f %d %d\\n",(unsigned)a,(unsigned)b,(unsigned)c,wide(),(double)f,z==0.0f,*p);
}`;
  const r=await inspect(source,'1 0 4 -9000000000 1.25 1 8\n'),frames=new Map(r.trace.frames.map(f=>[f.id,f])),returns=r.trace.events.filter(e=>e.action==='return.value'),forFunction=name=>returns.filter(e=>frames.get(e.activationId).functionName===name);
  for(const v of returns){assert.ok(v.value.cType);assert.deepEqual(r.definitions.get(v.instructionId).returnType,v.value.cType);}
  for(const v of forFunction('narrow')){assert.equal(v.value.cType.name,'Count');assert.equal(v.value.cType.sizeBits,16);assert.equal(v.value.cType.signedness,'unsigned');}
  assert.deepEqual(forFunction('narrow').map(e=>e.value.decimal),['1','0']);
  const byte=forFunction('byte')[0];assert.equal(byte.value.cType.sizeBits,8);assert.equal(byte.value.cType.signedness,'unsigned');assert.equal(byte.value.decimal,'4');
  const wide=forFunction('wide')[0];assert.equal(wide.value.cType.sizeBits,64);assert.equal(wide.value.decimal,'-9000000000');
  assert.deepEqual(forFunction('fraction').map(e=>[e.value.type,e.value.cType.name,e.value.number]),[['float','float','1.25'],['float','float','-0']]);
  const pointer=forFunction('selectp')[0];assert.equal(pointer.value.cType.kind,'pointer');assert.ok(pointer.value.cType.pointee.qualifiers.includes('const'));assert.ok(pointer.value.reference.dereferenceable);
  assert.equal(forFunction('main')[0].value.cType.name,'int');assert.equal(forFunction('main')[0].value.decimal,'0');
});

test('scalar argument inputs preserve source positions when mixed with byval and hidden sret',async()=>{
  const source=`#include <stdio.h>
typedef struct{int value;int *pointer;} Box;
Box change(int d,Box x,int *q){x.value+=d;*q+=1;return x;}
int main(void){int n=3;Box a={4,&n};Box b=change(2,a,&n);printf("%d %d %d\\n",b.value,*b.pointer,a.value);return 0;}`;
  const r=await inspect(source,'6 4 4\n'),call=r.trace.events.find(e=>e.action==='call'&&e.callee==='@change'),args=r.trace.events.filter(e=>e.action==='argument'&&e.callExecutionId===call.eventId);
  assert.deepEqual(args.map(a=>a.parameterIndex).sort(),[0,1,2]);assert.equal(call.arguments.length,3);assert.equal(call.arguments[1].kind,'aggregate');
  for(const a of args.filter(a=>a.value.kind!=='aggregate')){const input=a.inputs[0],incoming=call.inputs[a.parameterIndex];assert.equal(input.abiParameterIndex,a.parameterIndex+1);assert.equal(input.executionId,incoming.executionId);assert.equal(input.value.bits,a.value.bits);}
  const aggregate=r.trace.events.find(e=>e.action==='return.value'&&e.value.kind==='aggregate');assert.equal(aggregate.value.cType.kind,'record');assert.equal(r.definitions.get(aggregate.instructionId).returnType.name,'Box');
});

test('library callback parameters retain observed values without inventing incoming producers',async()=>{
  const source=`#include <stdio.h>
#include <stdlib.h>
int compare(const void *a,const void *b){int x=*(const int*)a;int y=*(const int*)b;return (x>y)-(x<y);}
int main(void){int a[3]={3,1,2};qsort(a,3,sizeof a[0],compare);printf("%d %d %d\\n",a[0],a[1],a[2]);return 0;}`;
  const r=await inspect(source,'1 2 3\n'),args=r.trace.events.filter(e=>e.action==='argument');assert.ok(args.length>=2);
  for(const a of args){assert.equal(a.inputs[0].value.address,a.value.address);assert.equal(a.inputs[0].executionId,undefined);assert.match(a.inputs[0].evidence,/caller producer unavailable/);}
  for(const v of r.trace.events.filter(e=>e.action==='return.value'))assert.equal(v.value.cType.name,'int');
});
