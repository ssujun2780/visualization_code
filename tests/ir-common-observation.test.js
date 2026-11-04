import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
import {materializeMemory} from '../scripts/model/memory-state.mjs';

const bytesFor=(t,channel='stdout')=>Buffer.concat(t.events.filter(e=>e.action==='output'&&e.channel===channel)
  .sort((a,b)=>a.streamOffset-b.streamOffset).map(e=>Buffer.from(e.bytesHex,'hex')));
const inspect=r=>({...r,defs:new Map(r.plan.instructions.map(d=>[d.id,d])),events:r.trace.events});
function conserved(r){assert.equal(r.trace.status,'completed');assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);assert.ok(r.trace.coverage.linkedMemory.loads>0);
  for(const c of r.trace.coverage.stdioOutput)assert.equal(c.unattributedDeliveryBytes,0);
}
async function baseline(source,stdin=''){
  const plain=await compileAndRun(source,null,{stdin}),r=inspect(await traceModel(source,{stdin,includeObservations:true}));
  assert.equal(r.stdout,plain.stdout);assert.equal(r.stderr,plain.stderr);assert.equal(r.trace.exitCode,plain.exitCode);conserved(r);
  assert.equal(bytesFor(r.trace).toString(),plain.stdout);assert.equal(bytesFor(r.trace,'stderr').toString(),plain.stderr);return r;
}

test('No1-No9 preserve process under identifier renaming, line shifts and comment changes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../examples/c/example-cases.json',import.meta.url),'utf8'));
  for(let n=1;n<=9;n++){
    const source=await readFile(new URL(`../examples/c/blind/No${n}.c`,import.meta.url),'utf8'),mapping=new Map();
    const renamed='/* source mapping variation */\n\n'+source.replace(/\b[A-Za-z]{10}\b/g,t=>{if(!mapping.has(t))mapping.set(t,`renamed_${mapping.size}_value`);return mapping.get(t);});
    const a=await traceModel(source),b=await traceModel(renamed);conserved(a);conserved(b);
    assert.equal(a.stdout,manifest.examples.find(e=>e.number===n).cases[0].stdout,`No${n}`);assert.equal(b.stdout,a.stdout);
    const shape=r=>r.trace.events.map(e=>[e.kind,e.action,e.operator??null,e.value?.decimal??e.value?.number??null,e.target?.offset??null,
      e.target?.size??null,e.text??null,e.dataInputs,e.addressInputs,e.controlInputs]);
    assert.deepEqual(shape(b),shape(a),`No${n}: actual process must not depend on names or line numbers`);
  }
});

test('unlisted formatting, parsing and string search use actual library reads/writes',async()=>{
  const r=await baseline(`#include <stdio.h>
#include <string.h>
int main(){char a[32]={0};int x=0;
 int n=snprintf(a,sizeof a,"%s:%d","abc",17);
 int count=sscanf(a,"abc:%d",&x);
 char *p=strchr(a,':');
 printf("%s %d %d %d %c\\n",a,n,x,count,*p);return 0;}`);
  assert.equal(r.stdout,'abc:17 6 17 1 :\n');
  const output=r.events.find(e=>e.action==='output'),writes=r.events.filter(e=>e.action==='write.range');
  assert.ok(writes.length>=2);for(const w of writes){assert.ok(w.callExecutionId);assert.ok(w.returnExecutionId);assert.ok(materializeMemory(w.memoryState).known.every(Boolean));}
  assert.ok(output.dataInputs.some(id=>writes.some(e=>e.eventId===id)));
  const search=r.events.find(e=>e.action==='call'&&e.callee==='@strchr');
  const result=r.events.find(e=>e.action==='resume'&&e.callExecutionId===search.eventId);
  assert.ok(result.readRegions.length);assert.ok(result.dataInputs.some(id=>writes.some(e=>e.eventId===id)));
});

test('mixed output functions, user wrappers and function pointers preserve all bytes and calls',async()=>{
  const r=await baseline(`#include <stdio.h>
#include <unistd.h>
#include <sys/uio.h>
int relay(int (*f)(int),int c){return f(c);}
int main(){setvbuf(stdout,0,_IONBF,0);relay(putchar,'A');puts("B");fputs("C",stdout);
 fwrite("D\\0E",1,3,stdout);fputc('F',stdout);write(1,"G",1);
 struct iovec parts[2]={{"HI",2},{"J",1}};writev(1,parts,2);fprintf(stderr,"K");return 0;}`);
  assert.equal(r.stdout,'AB\nCD\0EFGHIJ');assert.equal(r.stderr,'K');
  for(const out of r.events.filter(e=>e.action==='output')){assert.ok(out.callExecutionId);assert.ok(out.deliveryObservationId);}
});

test('changed arithmetic values and dynamic string operands preserve native results and observed origins',async()=>{
  for(const [a,b]of [[-13,8],[37,-4],[0,19]]){
    const r=await baseline(`#include <stdio.h>\nint main(){int a=${a},b=${b};int c=a+b*2;int d=(a+b)*2;int e=d/7;int f=d%7;a=c-d;b=a+e-f;printf("%d %d %d %d %d %d\\n",a,b,c,d,e,f);return 0;}`);
    const c=a+b*2,d=(a+b)*2,e=Math.trunc(d/7),f=d%7,first=c-d;
    assert.equal(r.stdout,`${first} ${first+e-f} ${c} ${d} ${e} ${f}\n`);
  }
  for(const [a,b]of [['uv','xyz'],['','1234'],['가','Z']]){
    const r=await baseline(`#include <stdio.h>\n#include <string.h>\nvoid join(char*d,const char*s,const char*t){strcpy(d,s);strcat(d,t);}\nint main(){char a[24]="${a}",b[12]="${b}",d[48]={0};char*p=b;join(d,a,p);printf("%s %zu\\n",d,strlen(d));return 0;}`);
    assert.equal(r.stdout,`${a+b} ${Buffer.byteLength(a+b)}\n`);
    const out=r.events.find(e=>e.action==='output');assert.ok(out.dataInputs.some(id=>r.events.some(e=>e.eventId===id&&e.action==='copy')));
  }
});

test('buffered and direct writes keep actual delivery order without guessed source placement',async()=>{
  const r=await baseline(`#include <stdio.h>
#include <unistd.h>
int main(){setvbuf(stdout,0,_IOFBF,128);putchar('A');write(1,"B",1);fflush(stdout);return 0;}`);
  assert.equal(r.stdout,'BA');assert.equal(r.events.filter(e=>e.action==='output').map(e=>e.text).join(''),'BA');
  assert.ok(r.trace.coverage.irGaps.includes('output-delivery-order:stdout'));
});

test('direct input populates tracked memory and connects input to subsequent output',async()=>{
  const r=await baseline(`#include <stdio.h>
#include <unistd.h>
int main(){char b[4]={0};int n=(int)read(0,b,3);fwrite(b,1,(size_t)n,stdout);return 0;}`,'XYZ');
  assert.equal(r.stdout,'XYZ');const input=r.events.find(e=>e.action==='input'),write=r.events.find(e=>e.action==='write.range'),out=r.events.find(e=>e.action==='output');
  assert.ok(input);assert.ok(write.dataInputs.includes(input.eventId));assert.ok(out.dataInputs.includes(write.eventId));
});

test('writing a formatted user buffer belongs to the output call, with the formatter retained as its data origin',async()=>{
  const r=await baseline('#include <stdio.h>\n#include <unistd.h>\nint main(){char b[8];snprintf(b,sizeof b,"%s","abc");write(1,b,3);return 0;}');
  const output=r.events.find(e=>e.action==='output'),write=r.events.find(e=>e.action==='write.range');
  assert.equal(r.events.find(e=>e.eventId===output.callExecutionId).callee,'@write');
  assert.equal(r.events.find(e=>e.eventId===write.callExecutionId).callee,'@snprintf');
  assert.ok(output.dataInputs.includes(write.eventId));
});

test('opaque sorting writes are visible before source callbacks and callbacks do not borrow qsort arguments',async()=>{
  const r=await baseline('#include <stdio.h>\n#include <stdlib.h>\nint cmp(const void*a,const void*b){return *(const int*)a-*(const int*)b;}\nint main(){int a[]={8,6,4,2,7,5,3,1};qsort(a,8,sizeof*a,cmp);for(int i=0;i<8;i++)printf("%d ",a[i]);return 0;}');
  assert.equal(r.stdout,'1 2 3 4 5 6 7 8 ');
  const call=r.events.find(e=>e.action==='call'&&e.callee==='@qsort'),resume=r.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId);
  assert.ok(resume);const frames=r.events.filter(e=>e.callbackOfCallExecutionId===call.eventId);assert.ok(frames.length>1);
  const frameIds=new Set(frames.map(e=>e.activationId)),writes=r.events.filter(e=>e.action==='write.range');
  assert.ok(writes.some(e=>!e.returnExecutionId));
  assert.ok(r.events.some(e=>frameIds.has(e.activationId)&&e.kind==='READ'&&e.dataInputs.some(id=>writes.some(w=>w.eventId===id))));
  for(const e of r.events.filter(e=>frameIds.has(e.activationId)&&e.action==='argument')){assert.ok(!e.callExecutionId);assert.deepEqual(e.dataInputs,[]);}
});

test('scalar memory hooks preserve i64/f32/f64 values and library field writes',async()=>{
  const r=await baseline(`#include <stdio.h>
int main(){long long a=-1234567890123LL;float b=1.25f;double c=-2.5;
 sscanf("123 3.5 -7.25","%lld %f %lf",&a,&b,&c);
 printf("%lld %.2f %.2f\\n",a,(double)b,c);return 0;}`);
  assert.equal(r.stdout,'123 3.50 -7.25\n');assert.equal(r.events.filter(e=>e.action==='write.range').length,3);
});

test('pointer metadata preserves const placement, typedefs and multiple indirections',async()=>{
  const r=inspect(await traceModel('typedef unsigned char Byte;\nint main(){Byte a[2]={1,2};const Byte *p=a;Byte *const q=a;const Byte **pp=&p;return **pp+*q;}'));
  conserved(r);assert.equal(r.trace.exitCode,2);const type=name=>r.trace.objects.find(o=>o.name===name).cType;
  assert.equal(type('p').kind,'pointer');assert.equal(type('p').sizeBits,32);assert.deepEqual(type('p').qualifiers,[]);
  assert.ok(type('p').pointee.qualifiers.includes('const'));assert.equal(type('p').pointee.sizeBits,8);assert.equal(type('p').pointee.signedness,'unsigned');
  assert.ok(type('q').qualifiers.includes('const'));assert.ok(!type('q').pointee.qualifiers?.includes('const'));
  assert.equal(type('pp').pointee.kind,'pointer');assert.ok(type('pp').pointee.pointee.qualifiers.includes('const'));
});

test('promotions bind to their own AST and remain within one pure comparison',async()=>{
  for(const type of ['char','unsigned char','short','unsigned short']){
    const r=inspect(await traceModel(`int main(){${type} a[2]={1,2};int i=1;\n return a[i] == 2;}`));conserved(r);assert.equal(r.trace.exitCode,1);
    const calc=r.events.filter(e=>e.kind==='CALC');assert.equal(calc.length,1,type);assert.equal(calc[0].operator,'==');
    const nodes=new Map();const walk=n=>{if(n){nodes.set(n.nodeId,n);n.children?.forEach(walk);}};walk(r.defs.get(calc[0].instructionId).expression);
    const promotion=calc[0].steps.find(s=>s.conversion);assert.ok(promotion);assert.equal(nodes.get(promotion.nodeId).cast,'IntegralCast');
  }
});
