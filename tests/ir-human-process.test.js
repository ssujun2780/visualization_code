import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
const done=(r,stdout)=>{assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);};
const defs=r=>new Map(r.plan.instructions.map(d=>[d.id,d]));

test('return source survives aggregate storage, VLA cleanup and shared void epilogues',async()=>{
 const source=`#include <stdio.h>
typedef struct{int x,y;} Pair;
Pair build(int n){Pair local={n,n+1};Pair copy=local;return copy;}
int sum(int n){int buffer[n];int answer=0;for(int i=0;i<n;i++){buffer[i]=i;answer+=buffer[i];}return answer;}
void set(int*p,int n){if(n<0)return;*p=n;}
int main(void){int value=7;set(&value,-1);set(&value,2);Pair result=build(value);printf("%d %d %d\\n",result.x,result.y,sum(4));return 0;}`;
 const r=await traceModel(source);done(r,'2 3 6\n');const d=defs(r),frames=new Map(r.trace.frames.map(f=>[f.id,f]));
 const returns=r.trace.events.filter(e=>e.action==='return');
 for(const name of ['build','sum'])assert.match(d.get(returns.find(e=>frames.get(e.activationId).functionName===name).instructionId).source.expression,/^return /);
 const early=returns.filter(e=>frames.get(e.activationId).functionName==='set');assert.equal(d.get(early[0].instructionId).source.expression,'return');
 assert.notEqual(early[0].instructionId,early[1].instructionId);
 assert.equal(r.trace.coverage.unboundSourceWork.filter(x=>x.kind==='ReturnStmt').length,0);
});

test('macro-local declarations bind distinct expansion identities on the same source line',async()=>{
 const r=await traceModel(`#include <stdio.h>
#define EXCHANGE(a,b) do{int saved=(a);(a)=(b);(b)=saved;}while(0)
int main(void){int a=3,b=8;EXCHANGE(a,b);EXCHANGE(a,b);printf("%d %d\\n",a,b);return 0;}`);done(r,'3 8\n');
 assert.equal(r.trace.objects.filter(o=>o.name==='saved').length,2);
 assert.deepEqual(r.trace.coverage.unboundSourceWork.filter(x=>x.kind==='VarDecl'),[]);
 const d=defs(r),ids=r.trace.events.filter(e=>e.action==='object.begin'&&r.trace.objects.find(o=>o.id===e.objectId)?.name==='saved').map(e=>d.get(e.instructionId).declarationId);
 assert.equal(new Set(ids).size,2);assert.ok(ids.every(Boolean));
});

test('variadic payload reads carry requested C types independently of va_list cursor loads',async()=>{
 const r=await traceModel(`#include <stdio.h>
#include <stdarg.h>
void show(int marker,...){va_list first,second;va_start(first,marker);va_copy(second,first);int x=va_arg(first,int);double y=va_arg(first,double);unsigned long long z=va_arg(first,unsigned long long);int q=va_arg(second,int);va_end(first);va_end(second);printf("%d %.1f %llu %d\\n",x,y,z,q);}
int main(void){show(0,-3,2.5,9ULL);return 0;}`);done(r,'-3 2.5 9 -3\n');
 const d=defs(r),reads=r.trace.events.filter(e=>e.action==='read'&&d.get(e.instructionId)?.expression?.kind==='VAArgExpr');
 assert.deepEqual(reads.map(e=>e.value.cType.name),['int','double','unsigned long long','int']);
 assert.equal(reads[2].value.cType.signedness,'unsigned');assert.ok(reads.every(e=>d.get(e.instructionId).source.expression.startsWith('va_arg(')));
});

test('declared opaque pointers retain their C type without invented layout',async()=>{
 const r=await traceModel(`#include <stdio.h>
struct Handle;
int main(void){struct Handle*p=0;FILE*f=stdout;fputs(p?"bad":"ok",f);return 0;}`);done(r,'ok');
 const reads=r.trace.events.filter(e=>e.action==='read'&&e.value?.address);
 assert.ok(reads.some(e=>e.value.cType?.pointee?.incomplete));
 assert.ok(reads.every(e=>e.value.cType));
});

test('buffered and unbuffered input retain byte and pushback origins without duplicate arrivals',async()=>{
 for(const buffering of ['', 'setvbuf(stdin,NULL,_IONBF,0);']){
  const r=await traceModel(`#include <stdio.h>
int main(void){${buffering}int sum=0;for(int i=0;i<3;i++){int c=getchar();ungetc(c,stdin);int again=getchar();sum+=again-'0';}printf("%d\\n",sum);return 0;}`,{stdin:'123\n'});done(r,'6\n');
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),reads=r.trace.events.filter(e=>e.action==='input');
  const arrivals=reads.filter(e=>e.inputStage==='arrival'),buffer=reads.filter(e=>e.inputStage==='buffer-read');
  assert.ok(arrivals.length);assert.equal(buffer.length,3,'only reads of original host bytes are stream reads');
  assert.equal(arrivals.map(e=>e.bytesHex).join(''),buffering?'313233':'3132330a');
  const resumes=r.trace.events.filter(e=>e.action==='resume'&&events.get(e.callExecutionId)?.callee==='@getchar');
  assert.equal(resumes.length,6);assert.ok(resumes.every(e=>e.dataInputs.some(id=>events.get(id)?.inputStage==='buffer-read')||
    e.libraryReadRegions?.some(p=>p.dataInputs.some(id=>events.get(id)?.callee==='@ungetc'))));
  assert.deepEqual(resumes.map(e=>e.value.decimal),['49','49','50','50','51','51']);
  const pushed=resumes.filter((_,i)=>i%2);
  assert.ok(pushed.every(e=>e.libraryReadRegions?.some(p=>p.writerAccessSize===1&&p.dataInputs.some(id=>events.get(id)?.callee==='@ungetc'))));
  assert.ok(resumes.filter((_,i)=>!(i%2)).every(e=>e.dataInputs.some(id=>events.get(id)?.inputStage==='buffer-read')));
 }
});

test('folded pure library expressions keep compiler evidence without invented calls',async()=>{
 const r=await traceModel(`#include <stdio.h>
#include <string.h>
int touches=0;int bump(void){touches++;return 1;}
int main(void){const char word[]="abcd";int total=0;for(int i=0;i<(int)strlen(word);i++){int same=strcmp("aa","aa");total+=same+bump();}printf("%d %d\\n",total,touches);return 0;}`);done(r,'4 4\n');
 assert.deepEqual(r.trace.coverage.unboundSourceWork.filter(x=>x.kind==='CallExpr'),[]);
 assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@bump').length,4);
 assert.equal(r.trace.events.filter(e=>e.action==='call'&&['@strlen','@strcmp'].includes(e.callee)).length,0);
 const d=defs(r),compares=r.trace.events.filter(e=>e.kind==='CALC'&&d.get(e.instructionId)?.source?.expression==='i<(int)strlen(word)');
 assert.equal(compares.length,5);assert.ok(compares.every(e=>e.inputs.some(i=>i.foldedExpression&&i.value.decimal==='4')));
 const folded=r.trace.events.filter(e=>e.kind==='CALC'&&d.get(e.instructionId)?.source?.expression==='strcmp("aa","aa")');
 assert.equal(folded.length,4);assert.ok(folded.every(e=>e.value.decimal==='0'&&/compiler-folded/.test(e.evidence)));
});

test('buffered line writes and formatted reads keep input origins across repeated calls',async()=>{
 const r=await traceModel(`#include <stdio.h>
int main(void){char text[16];int total=0;for(int i=0;i<2;i++){int n=0;if(!fgets(text,sizeof text,stdin))return 1;if(sscanf(text,"%d",&n)!=1)return 2;total+=n;}printf("%d\\n",total);return 0;}`,{stdin:'12\n34\n'});done(r,'46\n');
 const events=new Map(r.trace.events.map(e=>[e.eventId,e]));
 const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='input');assert.equal(writes.length,2);
 assert.ok(writes.every(e=>e.dataInputs.some(id=>events.get(id)?.inputStage==='buffer-read')));
 const arrivals=r.trace.events.filter(e=>e.inputStage==='arrival');assert.equal(arrivals.map(e=>e.bytesHex).join(''),'31320a33340a');
 const seen=new Set();for(const e of r.trace.events){for(const id of e.dataInputs)assert.ok(seen.has(id),`${e.eventId} -> ${id}`);seen.add(e.eventId);}
});

test('folded calls retain floating operands and full spaced string literals',async()=>{
 const r=await traceModel(`#include <stdio.h>
#include <string.h>
#include <math.h>
int main(void){double x=2.5;double y=x+(double)strlen("ab");double z=sqrt(16.0);int n=strlen("two words");printf("%.1f %d %.1f\\n",y,n,z);return 0;}`);done(r,'4.5 9 4.0\n');
 const d=defs(r),add=r.trace.events.find(e=>e.kind==='CALC'&&d.get(e.instructionId)?.source.expression==='x+(double)strlen("ab")');
 assert.ok(add.inputs.some(i=>i.foldedExpression&&i.value.cType.name==='double'));
 assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@sqrt').length,1,'LLVM sqrt call remains observed work');
 const length=r.trace.events.find(e=>e.kind==='CALC'&&d.get(e.instructionId)?.source.expression==='strlen("two words")');
 assert.ok(length.inputs.some(i=>i.value.literal==='"two words"'));
 assert.deepEqual(r.trace.coverage.unboundSourceWork.filter(x=>x.kind==='CallExpr'),[]);
});

test('literal pushback retains its writer without pretending new host input arrived',async()=>{
 for(const buffering of ['', 'setvbuf(stdin,NULL,_IONBF,0);']){
  const r=await traceModel(`#include <stdio.h>
int main(void){${buffering}ungetc('Q',stdin);int first=getchar();int next=getchar();printf("%c%c\\n",first,next);return 0;}`,{stdin:'x'});done(r,'Qx\n');
  const events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  const resumes=r.trace.events.filter(e=>e.action==='resume'&&events.get(e.callExecutionId)?.callee==='@getchar');
  assert.equal(resumes[0].value.decimal,'81');
  assert.ok(resumes[0].libraryReadRegions?.some(r=>r.dataInputs.some(id=>events.get(id)?.callee==='@ungetc')));
  assert.equal(r.trace.events.filter(e=>e.inputStage==='arrival').map(e=>e.bytesHex).join(''),'78');
  assert.ok(!r.trace.events.some(e=>e.inputStage==='arrival'&&e.callExecutionId===resumes[0].callExecutionId));
 }
});
