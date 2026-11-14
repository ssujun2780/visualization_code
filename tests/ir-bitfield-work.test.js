import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,expected);
  assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.deepEqual(r.plan.coverage.bitfields.unresolved,[]);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));return {...r,defs,field:e=>defs.get(e.instructionId)?.memberPath?.join('.')};
}
const trees=n=>n?[n,...(n.children??[]).flatMap(trees)]:[];

test('designated bit-field initialization preserves user expressions and separated units',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Small{unsigned a:3;unsigned :0;unsigned b:5;};
struct Outer{int marker;struct Small inner;void *next;};
int calls;unsigned once(void){calls++;return 3;}
int main(void){unsigned x=5;struct Outer v={.marker=9,.inner={.a=(x<<1)&7,.b=once()+2},.next=0};
 printf("%u %u %d\\n",v.inner.a,v.inner.b,calls);return 0;}`,'2 5 1\n');
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@once').length,1);
  assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&trees(r.defs.get(e.instructionId)?.expression).some(n=>n.operator==='<<')));
  assert.deepEqual(r.trace.events.filter(e=>e.kind==='READ'&&e.bitfield).map(e=>e.value.decimal),['2','5']);
});

test('logical bit-field writes and reads keep exact values, C types, bit ranges and independent provenance',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Flags {unsigned head:3;unsigned middle:5;unsigned tail:1;};
int main(void){struct Flags a={3,17,1};
 a.head=6;a.tail=0;
 printf("%u %u %u\\n",(unsigned)a.head,(unsigned)a.middle,(unsigned)a.tail);return 0;}`,'6 17 0\n');
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.bitfield),reads=r.trace.events.filter(e=>e.kind==='READ'&&e.bitfield);
  assert.deepEqual(writes.map(e=>e.value.decimal),['6','0']);assert.deepEqual(writes.map(e=>e.target.bitSize),[3,1]);
  assert.deepEqual(reads.map(e=>e.value.decimal),['6','17','0']);assert.deepEqual(reads.map(e=>e.target.bitOffset),[0,3,8]);
  assert.ok([...writes,...reads].every(e=>e.value.cType.signedness==='unsigned'&&e.value.cType.display.badges.includes('u')));
  assert.equal(reads[0].dataInputs[0],writes[0].eventId);assert.equal(reads[2].dataInputs[0],writes[1].eventId);
  assert.equal(r.trace.events.find(e=>e.eventId===reads[1].dataInputs[0]).action,'copy');
  assert.ok(writes.every(e=>e.storageValue.bits&&e.storageTarget.size===2));
  assert.deepEqual(writes.map(e=>e.inputs[0].value.unsigned),['6','0']);
  assert.equal(r.trace.events.filter(e=>e.kind==='CALC').length,0);
});

test('signed fields, nested records and separated storage units decode their compiler layout',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Small {signed int x:4;unsigned int:0;unsigned int y:5;};
struct Outer {int marker;struct Small inner;};
int main(void){struct Outer a={.marker=99,.inner={.x=-3,.y=19}};
 a.inner.x=-2;a.inner.y=7;
 printf("%d %u %d\\n",a.inner.x,a.inner.y,a.marker);return 0;}`,'-2 7 99\n');
  const read=r.trace.events.filter(e=>e.kind==='READ'&&e.bitfield);
  assert.deepEqual(read.map(e=>e.value.decimal),['-2','7']);
  assert.deepEqual(read.map(r.field),['inner.x','inner.y']);assert.equal(read[0].value.cType.signedness,'signed');
  const signedWrite=r.trace.events.find(e=>e.kind==='WRITE'&&r.field(e)==='inner.x');
  assert.equal(signedWrite.inputs[0].value.decimal,'-2');
  assert.equal(read[0].target.bitOffset,32);assert.equal(read[1].target.bitOffset,64);
});

test('boolean and character bit-field bases preserve their C widths and stored values',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Bits{_Bool flag:1;unsigned char small:3;signed int sign:4;};
int main(void){struct Bits x={0,5,-2};x.flag=4;x.small=7;
 printf("%d %u %d\\n",x.flag,(unsigned)x.small,x.sign);return 0;}`,'1 7 -2\n');
  const reads=r.trace.events.filter(e=>e.kind==='READ'&&e.bitfield);assert.deepEqual(reads.map(e=>e.value.decimal),['1','7','-2']);
  assert.equal(reads[0].value.cType.encoding,'DW_ATE_boolean');assert.equal(reads[1].value.cType.sizeBits,8);
});

test('partial initialization, compound updates, postfix values and side effects remain real source work',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Bits {unsigned small:3;unsigned other:4;};int calls=0;
int once(void){calls++;return 2;}
int main(void){struct Bits a;a.small=3;a.other=5;
 a.small+=once();unsigned old=a.small++;a.other&=3;
 printf("%u %u %u %d\\n",old,a.small,a.other,calls);return 0;}`,'5 6 1 1\n');
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@once').length,1);
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.bitfield);
  assert.deepEqual(writes.map(e=>e.value.decimal),['3','5','5','6','1']);
  assert.equal(writes[1].inputs[0].value.decimal,'5');
  assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&e.operator==='++'));
  assert.ok(r.trace.events.filter(e=>e.kind==='READ'&&e.bitfield).every(e=>e.dataInputs.length>0));
});

test('reading a different uninitialized field is not made valid by a neighboring field write',async()=>{
  const r=await traceModel(`struct Bits{unsigned a:3;unsigned b:5;};int main(void){struct Bits x;x.a=2;return x.b;}`);
  assert.equal(r.trace.status,'fault');assert.ok(r.trace.diagnostics.some(d=>d.code==='uninitialized-read'));
});

test('real shift and mask expressions on the assignment RHS stay visible and run once',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Bits{unsigned x:5;unsigned y:5;};int count=0;int once(void){count++;return 1;}
int main(void){struct Bits a={3,7};
 a.x=(a.y<<once())&15;
 printf("%u %d\\n",a.x,count);return 0;}`,'14 1\n');
  const shift=r.trace.events.filter(e=>e.kind==='CALC'&&trees(r.defs.get(e.instructionId).expression).some(n=>n.operator==='<<'));
  assert.ok(shift.length);assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&e.operator==='&'));
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@once').length,1);
  assert.equal(r.trace.events.filter(e=>e.kind==='WRITE'&&e.bitfield).at(-1).value.decimal,'14');
});

test('token-paste constants retain subexpression locations and unsigned folded operand types',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>
#define JOIN2(a,b) a##b
#define U64(n) JOIN2(n,ULL)
int main(void){uint64_t x[2]={0};
 x[0]|=U64(1)<<3;x[1]|=U64(1)<<63;
 x[0]&=~(U64(1)<<3);
 printf("%016" PRIx64 " %016" PRIx64 "\\n",x[0],x[1]);return 0;}`,'0000000000000000 8000000000000000\n');
  const calcs=r.trace.events.filter(e=>e.kind==='CALC'&&['|=','&='].includes(e.operator));assert.equal(calcs.length,3);
  for(const e of calcs){const right=e.inputs.find(i=>i.value?.literal);
    assert.equal(right.value.cType.signedness,'unsigned');assert.equal(right.value.cType.sizeBits,64);assert.ok(right.value.cType.display.badges.includes('u'));
    const shift=trees(r.defs.get(e.instructionId).expression).find(n=>n.operator==='<<');assert.ok(shift.source);assert.ok(shift.children[0].source);
  }
  assert.equal(calcs[1].inputs[1].value.decimal,'9223372036854775808');
  assert.equal(calcs[2].inputs[1].value.decimal,'18446744073709551607');
  assert.equal(r.plan.sourceMap.stats.compilerMacroTokenPasses,1);
});

test('actual pointer casts and integer conversions remain while access preparation casts are hidden',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdint.h>
struct Bits {unsigned x:3;};
int main(void){struct Bits a={5};void *p=(void*)&a;uintptr_t address=(uintptr_t)p;
 printf("%u %d\\n",(unsigned)a.x,address!=(uintptr_t)0);return 0;}`,'5 1\n');
  assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&r.defs.get(e.instructionId).expression?.kind==='CStyleCastExpr'&&e.value?.type==='i32'));
  const pointerCasts=r.trace.events.filter(e=>e.kind==='CALC'&&e.value?.type==='i8*');
  assert.equal(pointerCasts.length,1);assert.equal(r.defs.get(pointerCasts[0].instructionId).expression.kind,'CStyleCastExpr');
});
