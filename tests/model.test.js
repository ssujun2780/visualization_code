import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {traceModel as traceSourceModel} from '../scripts/model/index.mjs';
import {traceWithInference} from '../scripts/pipeline/trace-with-inference.mjs';
import {compileAndRun} from "../scripts/instrumentation/toolchain.mjs";
import {materializeMemory} from "../scripts/model/memory-state.mjs";

// These backend assertions deliberately inspect raw LLVM observations. The
// public animation IR contract is tested separately in ir-*.test.js.
async function traceModel(source,{inferRelations=false,...options}={}){
  const r=await (inferRelations?traceWithInference:traceSourceModel)(source,{...options,includeObservations:true});
  return r.observations?.plan?{...r,plan:r.observations.plan,trace:r.observations.trace}:r;
}

async function checked(source,options={}) {
  const baseline=await compileAndRun(source,undefined,{stdin:options.stdin??""});
  const result=await traceModel(source,options);
  assert.equal(result.trace.status,"completed",JSON.stringify(result.trace.diagnostics));
  assert.equal(result.stdout,baseline.stdout);assert.equal(result.trace.exitCode,baseline.exitCode);
  const ids=new Set(result.trace.events.map(e=>e.eventId));
  assert.equal(ids.size,result.trace.events.length);
  for(const e of result.trace.events)for(const id of [...(e.dataInputs??[]),...(e.addressInputs??[]),...(e.controlInputs??[])])assert.ok(ids.has(id),`missing event ${id}`);
  assert.ok(result.trace.frames.every(f=>f.ended));assert.doesNotThrow(()=>JSON.stringify(result));
  return result;
}

test("general model records source, integer dependencies and actual values",async()=>{
  const r=await checked("/* 한글 주석 */\nint main(void){int a=10,b=20;int c=a+b*2;return c;}",{filename:"한글/입력.c"});
  const c=r.trace.objects.find(o=>o.name==="c"),write=r.trace.events.findLast(e=>e.kind==="WRITE"&&e.phase==="commit"&&e.target.objectId===c.id);
  assert.equal(write.value.signed,"50");assert.equal(r.trace.exitCode,50);
  assert.ok(r.trace.events.some(e=>e.kind==="CALC"&&e.source.file==="한글/입력.c"));
  assert.ok(r.plan.types.some(t=>t.name==="int"));assert.ok(!r.plan.instructions.some(o=>o.expected));
});

test("the supplied signedness case retains C types, u badges and same-width conversion provenance",async()=>{
  const source=await readFile(new URL("../examples/c/blind/No2.c",import.meta.url),"utf8");
  const r=await checked(source,{filename:"examples/c/blind/No2.c"});
  assert.equal(r.stdout,"260\n4\n4294967295\n0\n1\n4294967295\n");
  const conversions=r.trace.events.filter(e=>e.conversion?.bitsUnchanged);
  assert.equal(conversions.length,3);
  const unsigned=conversions.filter(e=>e.conversion.toType.signedness==="unsigned");
  assert.equal(unsigned.length,2);
  for(const event of unsigned){
    assert.equal(event.kind,"CALC");assert.equal(event.action,"convert");assert.equal(event.conversion.fromValue.decimal,"-3");
    assert.equal(event.value.decimal,"4294967293");assert.equal(event.value.bits,event.conversion.fromValue.bits);
    assert.equal(event.value.cType.sizeBits,32);assert.deepEqual(event.value.cType.display.badges,["u"]);
    const read=r.trace.events.find(e=>e.eventId===event.dataInputs[0]);assert.equal(read.kind,"READ");assert.equal(read.value.cType.signedness,"signed");
    assert.ok(r.trace.events.some(e=>e.kind==="CALC"&&e.dataInputs.includes(event.eventId)));
  }
  const reverse=conversions.find(e=>e.conversion.toType.signedness==="signed");
  assert.equal(reverse.conversion.explicit,true);assert.deepEqual(reverse.value.cType.display.badges,[]);
  assert.equal(r.plan.coverage.cConversions.unobserved.length,0);
  const u8=r.trace.objects.find(o=>o.name==="kLRdfmDIYU"),u32=r.trace.objects.find(o=>o.name==="iPAWfhRExu");
  assert.equal(u8.cType.encoding,"DW_ATE_unsigned_char");assert.equal(u32.cType.encoding,"DW_ATE_unsigned");
  const write=id=>r.trace.events.findLast(e=>e.kind==="WRITE"&&e.phase==="commit"&&e.target?.objectId===id);
  assert.equal(write(u8.id).value.decimal,"250");assert.equal(write(u32.id).value.decimal,"4294967295");
  const comparisons=r.trace.events.filter(e=>e.predicate);assert.deepEqual(comparisons.map(e=>e.value.decimal),["0","1"]);
  assert.ok(r.trace.events.filter(e=>e.action==="call.begin").at(-1).arguments.some(a=>a.decimal==="4294967295"&&a.cType.signedness==="unsigned"));
});

test("the supplied constant-left logical expressions record skipped operands without executing them",async()=>{
  const filename="examples/c/blind/No5.c",source=await readFile(new URL(`../${filename}`,import.meta.url),"utf8");
  const r=await checked(source,{filename});
  assert.equal(r.stdout,"0 0\n1 0\n1 1\n1 2\n1 2 1\n0 2 0\n");
  const skips=r.trace.events.filter(e=>e.action==="short-circuit");
  assert.deepEqual(skips.map(e=>({kind:e.kind,line:e.source.line,operator:e.operator,left:e.left.truth,right:e.right.evaluation,reason:e.reason})),[
    {kind:"FLOW",line:7,operator:"&&",left:false,right:"skipped",reason:"and-left-false"},
    {kind:"FLOW",line:10,operator:"||",left:true,right:"skipped",reason:"or-left-true"}]);
  for(const event of skips){
    assert.equal(event.source.file,filename);assert.equal(event.right.source.expression,"++xeMToGnyMF");
    assert.equal(event.right.value,undefined);assert.equal(event.timing,"before-consumer");
    const consumer=r.trace.events.find(e=>e.instructionId===event.anchorInstructionId&&e.phase==="commit");
    assert.equal(consumer.kind,"WRITE");assert.ok(consumer.controlInputs.includes(event.eventId));
    assert.equal(consumer.value.bits,event.observedConsumerValue.bits);
  }
  assert.equal(r.trace.events.filter(e=>[7,10].includes(e.source?.line)&&["READ","CALC"].includes(e.kind)&&e.action!=='convert').length,0);
  assert.equal(r.trace.events.filter(e=>e.kind==="READ"&&e.phase==="commit").length,20);
  for(const [name,expected]of [["xeMToGnyMF",["0","1","2"]],["YAHkdhNSvH",["0","1","0"]]]){
    const object=r.trace.objects.find(o=>o.name===name);
    assert.deepEqual(r.trace.events.filter(e=>e.kind==="WRITE"&&e.phase==="commit"&&e.target?.objectId===object.id).map(e=>e.value.decimal),expected);
  }
  assert.equal(r.plan.coverage.shortCircuits.foldedSkips,2);assert.equal(r.plan.coverage.shortCircuits.inserted,2);
  assert.equal(r.plan.coverage.shortCircuits.unobserved.length,0);
  assert.deepEqual(r.plan.coverage.shortCircuits.expressions.filter(e=>[13,16].includes(e.source.line)).map(e=>e.right.evaluation),["required","required"]);
});

test("the supplied partial/designated array initializers can be replayed before any reads",async()=>{
  const filename="examples/c/blind/No8.c",source=await readFile(new URL(`../${filename}`,import.meta.url),"utf8"),r=await checked(source,{filename});
  assert.equal(r.stdout,"3 6 0 0 0\n0 10 0 20 0\n3 16 0 20 0\n99 6 0 0 0\n3 16 0 20 0\n3 20 0 20 0\n");
  const arrays=["zQggcFlRXJ","yrvZEcPOhc","IgwDDUJzFS"].map(name=>r.trace.objects.find(o=>o.name===name));
  const ints=state=>{assert.ok(state.known.every(b=>b===1));const view=new DataView(state.bytes.buffer,state.bytes.byteOffset,state.bytes.byteLength);return [0,4,8,12,16].map(i=>view.getInt32(i,true));};
  const initial=[[3,6,0,0,0],[0,10,0,20,0]];
  for(const [index,array]of arrays.slice(0,2).entries()){
    const copy=r.trace.events.find(e=>e.action==="copy"&&e.target.objectId===array.id),src=r.trace.objects.find(o=>o.id===copy.sourceObjectId),srcBegin=r.trace.events.find(e=>e.eventId===src.createdBy);
    assert.deepEqual(ints(materializeMemory(srcBegin.memoryState)),initial[index]);
    assert.deepEqual(ints(materializeMemory(copy.memoryState)),initial[index]);
    assert.ok(r.trace.events.indexOf(copy)<r.trace.events.findIndex(e=>e.kind==="READ"&&e.target?.objectId===array.id));
  }
  const uninitialized=r.trace.events.find(e=>e.eventId===arrays[2].createdBy);assert.equal(uninitialized.initialized,false);assert.equal(uninitialized.memoryState,undefined);
  // Reconstruct using only creation and WRITE payloads; never use future READs.
  const state=new Map();
  for(const event of r.trace.events){
    if(event.action==="object.begin")state.set(event.objectId,{bytes:new Uint8Array(event.size),known:new Uint8Array(event.size)});
    const id=event.action==="object.begin"?event.objectId:event.target?.objectId,target=state.get(id);if(!target)continue;
    const offset=event.action==="object.begin"?0:event.target.offset??0;
    if(event.memoryState){const decoded=materializeMemory(event.memoryState);target.bytes.set(decoded.bytes,offset);target.known.set(decoded.known,offset);}
    else if(event.kind==="WRITE"&&event.phase==="commit"&&!event.value.truncated){const bytes=Buffer.from(event.value.bytesHex,"hex");target.bytes.set(bytes,offset);target.known.fill(1,offset,offset+bytes.length);}
  }
  assert.deepEqual(arrays.map(o=>ints(state.get(o.id))),[[99,6,0,0,0],[3,16,0,20,0],[3,20,0,20,0]]);
  assert.equal(r.trace.events.filter(e=>e.kind==="READ"&&e.phase==="commit").length,219);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);assert.equal(r.trace.coverage.memorySnapshots.omittedInitializedBytes,0);
});

test("the supplied string case replays library writes and their provenance without future reads",async()=>{
  const filename="examples/c/blind/No9.c",source=await readFile(new URL(`../${filename}`,import.meta.url),"utf8"),r=await checked(source,{filename});
  assert.equal(r.stdout,"12 3\n4 3\nAbc abcde\n6 2\npq0rs0\npq-rs 5\nabcde +abcde\n");
  const strings=r.trace.events.filter(e=>e.libraryFunction),[copy,append]=strings,ids=new Map(r.trace.events.map(e=>[e.eventId,e]));
  assert.deepEqual(strings.map(e=>({function:e.libraryFunction,kind:e.kind,action:e.action,offset:e.target.offset,size:e.target.size,sourceSize:e.sourceSize})),[
    {function:"strcpy",kind:"WRITE",action:"copy",offset:0,size:4,sourceSize:4},
    {function:"strcat",kind:"WRITE",action:"copy",offset:3,size:3,sourceSize:3}]);
  assert.equal(copy.target.objectId,append.target.objectId);assert.ok(append.dataInputs.includes(copy.eventId));
  assert.deepEqual(append.readRegions.map(s=>({role:s.role,size:s.size})),[{role:"source",size:3},{role:"destination-scan",size:4}]);
  for(const [event,bytes,nul]of [[copy,[97,98,99,0],3],[append,[100,101,0],2]]){
    assert.deepEqual([...materializeMemory(event.memoryState).bytes],bytes);
    assert.deepEqual([...materializeMemory(event.previousMemoryState).bytes],bytes.map(()=>0));
    assert.ok(event.includesNullTerminator);assert.equal(event.terminatorOffset,nul);assert.equal(event.paddingSize,0);
    assert.equal(ids.get(event.callEventId).action,"call.begin");assert.equal(ids.get(event.returnEventId).action,"call.end");
    assert.ok(event.dataInputs.length);assert.ok(event.memoryState.complete);
  }
  // Observe only creation and WRITE payloads; capture state at each library boundary.
  const state=new Map(),atString=[];
  for(const event of r.trace.events){
    if(event.action==="object.begin")state.set(event.objectId,{bytes:new Uint8Array(event.size),known:new Uint8Array(event.size)});
    if(event.action!=="object.begin"&&event.kind!=="WRITE")continue;
    const target=state.get(event.objectId??event.target?.objectId);if(!target)continue;
    const offset=event.action==="object.begin"?0:event.target.offset??0;
    if(event.memoryState){const decoded=materializeMemory(event.memoryState);target.bytes.set(decoded.bytes,offset);target.known.set(decoded.known,offset);}
    else if(event.phase==="commit"&&event.value?.bytesHex&&!event.value.truncated){const bytes=Buffer.from(event.value.bytesHex,"hex");target.bytes.set(bytes,offset);target.known.fill(1,offset,offset+bytes.length);}
    if(event.libraryFunction)atString.push([...target.bytes]);
  }
  assert.deepEqual(atString,[[97,98,99,0,0,0,0,0,0,0,0,0],[97,98,99,100,101,0,0,0,0,0,0,0]]);
  const names=["vPBERxySfE","VhPTLabjXh","mQjExnOqJe","GBDIZPfKlO"],actual=names.map(n=>state.get(r.trace.objects.find(o=>o.name===n).id));
  assert.deepEqual(actual.map(s=>[...s.bytes]),[
    [65,98,99,0,0,0,0,0,0,0,0,0],[97,98,99,100,101,0,0,0,0,0,0,0],
    [112,113,45,114,115,0],[43,97,98,99,100,101,0,0,0,0,0,0]]);
  assert.ok(actual.every(s=>s.known.every(b=>b===1)));
  const moved=r.trace.events.filter(e=>e.action==="copy"&&e.target?.objectId===r.trace.objects.find(o=>o.name===names[3]).id);
  assert.ok(moved.every(e=>e.memoryState.complete));assert.ok(moved[0].dataInputs.includes(copy.eventId));assert.ok(moved[0].dataInputs.includes(append.eventId));
  assert.ok(moved[1].dataInputs.includes(moved[0].eventId));
  assert.equal(r.trace.events.filter(e=>e.kind==="READ"&&e.phase==="commit").length,34);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);assert.ok(!r.trace.coverage.gaps.includes("external-effects:strcat"));
});

test("short circuit, ternary, loops, switch and jumps preserve C control flow",async()=>{
  const r=await checked(`#include <stdio.h>
  int main(void){int s=0,b=0;for(int i=0;i<8;i++){if(i==2)continue;if(i==6)break;s+=i;}
  int a=0;int x=a&&++b;int y=1||++b;int z=a?++b:4;
  int k=2;do{s++;}while(--k);while(k<2)k++;
  switch(k){case 2:s+=3;case 3:s+=4;break;default:s=0;}goto done;s=999;done:printf("%d %d %d %d %d\\n",s,b,x,y,z);return 0;}`);
  assert.equal(r.stdout,"22 0 0 1 4\n");
  assert.ok(r.trace.events.some(e=>e.action==="switch"));
});

test("recursion and function pointer calls link caller arguments and returned values",async()=>{
  const r=await checked(`#include <stdio.h>
  int f(int n){return n<2?n:f(n-1)+f(n-2);}int main(void){int(*p)(int)=f;printf("%d\\n",p(7));return 0;}`);
  assert.equal(r.stdout,"13\n");assert.ok(r.trace.frames.filter(f=>f.functionName==="f").length>10);
  assert.ok(r.trace.events.some(e=>e.action==="call.begin"&&e.indirectAddress));
  assert.ok(r.trace.events.some(e=>e.action==="call.end"&&e.dataInputs.length));
});

test("structures passed and returned by value are observed through their ABI copies",async()=>{
  const r=await checked(`#include <stdio.h>
  typedef struct{int a,b;}P;P f(P p){p.a+=p.b;return p;}int main(void){P p={3,4};P q=f(p);printf("%d %d\\n",p.a,q.a);return 0;}`);
  assert.equal(r.stdout,"3 7\n");assert.ok(r.trace.views.some(v=>v.kind==="record"));
});

test("pointer cycles and arrays are proposed from actual layout and connections",async()=>{
  const r=await checked(`#include <stdio.h>
  #include <stdlib.h>
  struct A{int n;struct A*p;};int main(void){struct A*q=calloc(2,sizeof *q);q[0].p=&q[1];q[1].p=q;q[1].n=7;int a[2][3]={{1,2,3},{4,5,6}};printf("%d %d\\n",q->p->n,a[1][2]);free(q);return 0;}`,{inferRelations:true});
  assert.equal(r.stdout,"7 6\n");assert.ok(r.inference.structures.some(s=>s.kind==='record-graph-candidate'&&s.cyclic&&s.edgeCount===2));
  assert.ok(r.trace.views.some(v=>v.kind==="array"&&v.count===2&&v.elementType==="[3 x i32]"));
});

test("full C identifier and record renaming does not change topology inference",async()=>{
  const make=(t,p,f)=>`#include <stdlib.h>\nstruct ${t}{struct ${t}*${f};};int main(void){struct ${t}*${p}=calloc(2,sizeof *${p});${p}[0].${f}=&${p}[1];${p}[1].${f}=${p};free(${p});return 0;}`;
  const a=await checked(make("Tree","grid","array"),{inferRelations:true}),b=await checked(make("Array","graph","node"),{inferRelations:true});
  const shape=r=>r.inference.structures.filter(s=>s.kind==='record-graph-candidate').map(s=>({nodes:s.nodeCount,edges:s.edgeCount,cyclic:s.cyclic,views:s.views}));
  assert.ok(shape(a).length);assert.ok(shape(b).length);
  assert.deepEqual(shape(a),shape(b));
});

test("malloc, calloc, realloc, copies and fills preserve output and allocation identity",async()=>{
  const r=await checked(`#include <stdio.h>
  #include <stdlib.h>
  #include <string.h>
  int main(void){int*p=malloc(2*sizeof *p);p[0]=3;p[1]=4;int*q=calloc(3,sizeof *q);memcpy(q,p,2*sizeof *p);q=realloc(q,4*sizeof *q);q[3]=8;memmove(q+1,q,2*sizeof *q);char s[5];memset(s,'x',4);s[4]=0;printf("%d %d %d %s\\n",q[0],q[2],q[3],s);free(p);free(q);return 0;}`);
  assert.equal(r.stdout,"3 4 8 xxxx\n");assert.ok(r.trace.events.some(e=>e.reason==="realloc-replaced"));
  assert.ok(r.trace.objects.filter(o=>o.storage==="heap").every(o=>o.lifecycle==="ended"));
});

test("stdin delivery and actual successful assignment writes are distinct",async()=>{
  const r=await checked(`#include <stdio.h>
  int main(void){int n;char s[8];if(scanf("%d %7s",&n,s)!=2)return 1;printf("%d:%s\\n",n,s);return 0;}`,{stdin:"3 가나\n"});
  assert.equal(r.stdout,"3:가나\n");const input=r.trace.events.find(e=>e.kind==='READ'&&e.action==='input');assert.ok(input);
  const writes=r.trace.events.filter(e=>e.action==='write.range');assert.equal(writes.length,2);
  for(const write of writes)assert.ok(write.dataInputs.includes(input.eventId));
  const failed=await checked('#include <stdio.h>\nint main(void){int n;if(scanf("%d",&n)!=1)return 2;return n;}',{stdin:"x"});
  assert.ok(failed.trace.events.some(e=>e.kind==='READ'&&e.action==='input'));
  assert.equal(failed.trace.events.filter(e=>e.action==='write.range').length,0);
});

test("64-bit integers, unsigned wrap, floating-point and static zero initialization remain C values",async()=>{
  const r=await checked(`#include <stdio.h>
  static int g;int f(void){static int k;k++;return k;}int main(void){long long n=9007199254740993LL;unsigned u=4294967295U;u++;double d=1.5;float z=-0.0f;printf("%lld %u %.1f %d %d %d %.1f\\n",n,u,d*2,g,f(),f(),z);return 0;}`);
  assert.ok(r.trace.events.some(e=>e.value?.signed==="9007199254740993"));
  assert.ok(r.trace.events.some(e=>e.value?.number==="-0"));
  assert.ok(r.trace.objects.filter(o=>o.storage==="static").every(o=>o.lifecycle==="alive"));
});

test("runtime faults produce one ERROR and stop before the offending operation",async()=>{
  const programs=[
    ["int main(void){int a;return a+1;}","uninitialized-read"],
    ["int f(int x){return 10/x;}int main(void){return f(0);}","division-by-zero"],
    ["int main(void){int a=2147483647;return a+1;}","signed-overflow"],
    ["int main(void){int*p=0;return *p;}","null-access"],
    ["int main(void){int a[2]={1,2};int i=2;return a[i];}","object-bounds"],
    ['#include <stdlib.h>\nint main(void){int*p=malloc(4);*p=3;free(p);return *p;}',"use-after-lifetime"],
    ['#include <stdlib.h>\nint main(void){int*p=malloc(4);free(p);free(p);return 0;}',"invalid-free"],
    ["int main(void){int n=32;return 1<<n;}","invalid-shift"],
  ];
  for(const [source,code]of programs){const r=await traceModel(source);assert.equal(r.trace.status,"fault",JSON.stringify(r.trace.diagnostics));
    assert.equal(r.trace.diagnostics[0].code,code);assert.equal(r.trace.events.filter(e=>e.kind==="ERROR").length,1);assert.doesNotThrow(()=>JSON.stringify(r));}
});

test("uninitialized byte copies retain the uninitialized state",async()=>{
  const r=await traceModel('#include <string.h>\nint main(void){int a,b;memcpy(&b,&a,sizeof b);return b;}');
  assert.equal(r.trace.status,"fault");assert.equal(r.trace.diagnostics[0].code,"uninitialized-read");
});

test("unmodeled library effects are disclosed and invalid/unsupported C never starts",async()=>{
  const gap=await checked('#include <stdlib.h>\nint main(void){srand(3);return 0;}');assert.ok(gap.trace.coverage.linkedMemory.stores>0);
  assert.match(gap.trace.coverage.libraryInternals,/library arithmetic and source frames are not instrumented/);
  const unsupported=await traceModel("int main(void){volatile int n=3;return n;}");assert.equal(unsupported.trace.status,"unsupported");assert.equal(unsupported.trace.objects.length,0);
  const invalid=await traceModel("int main(void){int n=;}");assert.equal(invalid.trace.status,"compile-error");assert.equal(invalid.trace.events.length,1);
});

test("event limit and worker deadline stop infinite execution with a partial trace",async()=>{
  const source="int main(void){for(;;){}}";
  const limited=await traceModel(source,{maxEvents:30});assert.equal(limited.trace.status,"limited");assert.equal(limited.trace.diagnostics[0].code,"trace-limit");
  const timed=await traceModel(source,{timeoutMs:100,maxEvents:1000000});assert.equal(timed.trace.status,"limited");assert.equal(timed.trace.diagnostics[0].code,"time-limit");
});

test("the same automatic path observes the unchanged 900-line C11 regex program",async()=>{
  const source=await readFile(new URL("../examples/c/regex_equivalence.c",import.meta.url),"utf8");
  // Large end-to-end fixture: supply separate recording and inference budgets.
  // The default 16 MiB / 25 s stop this case; limit behavior is tested separately.
  const r=await checked(source,{stdin:"ab\na(b|c)\n",maxEvents:200000,maxObservationBytes:64*1024*1024,timeoutMs:40000,inferenceTimeoutMs:120000,inferRelations:true});
  assert.equal(r.stdout,'NOT EQUIVALENT\nWITNESS "ac"\nLENGTH 2\nACCEPTED_BY 2\n');
  assert.ok(r.plan.instructions.length>1000);assert.ok(r.trace.events.length>10000);
  assert.ok(r.trace.events.some(e=>e.action==="call.begin"&&e.indirectAddress));
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  assert.ok(r.inference.structures.some(s=>s.kind==='record-graph-candidate'&&s.edgeCount>0));
});
