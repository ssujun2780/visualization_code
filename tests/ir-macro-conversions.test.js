import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.plan.coverage.unmappedObservations,[]);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const nodes=new Map(),visit=n=>{if(!n)return;nodes.set(n.nodeId,n);for(const c of n.children??[])visit(c);};
  for(const i of r.plan.instructions)visit(i.expression);
  const conversions=r.observations.plan.instructions.filter(o=>o.conversion);
  for(const o of conversions.filter(o=>o.semanticNodeId)){
    const n=nodes.get(o.semanticNodeId);assert.ok(n,`missing cast ${o.id}`);
    assert.ok(['IntegralCast','FloatingToIntegral','IntegralToFloating','FloatingCast','IntegralToBoolean','FloatingToBoolean','PointerToBoolean'].includes(n.cast));
    assert.equal(r.plan.bindings[o.id].expressionNodeId,o.semanticNodeId);
    assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&(e.steps?.some(s=>s.nodeId===o.semanticNodeId&&s.conversion)||
      e.conversion&&r.plan.instructions.find(i=>i.id===e.instructionId)?.sourceNodeId===o.semanticNodeId)),o.id);
  }
  return {...r,nodes,conversions};
}

test('macro character promotions bind array, pointer and repeated arguments to their scalar READs',async()=>{
  for(const [macro,digits,expected] of [['DECODE','57','5 7 10\n'],['Kestrel','28','2 8 4\n']]){
    const r=await inspect(`#include <stdio.h>
#define ${macro}(v) ((v)-'0')
#define REPEAT(v) (${macro}(v)+${macro}(v))
int main(void){char text[]="${digits}";char *p=text;
 int first=${macro}(p[0]); int second=${macro}(text[1]);
 int twice=REPEAT(*p);
 printf("%d %d %d\\n",first,second,twice);return 0;}`,expected);
    const casts=r.conversions.filter(o=>o.conversion.fromType.name==='char'&&o.conversion.toType.name==='int');
    assert.equal(casts.length,4);assert.equal(new Set(casts.map(o=>o.semanticNodeId)).size,4);
    const descendants=n=>[n.nodeId,...n.children.flatMap(descendants)];
    for(const cast of casts){
      const read=r.observations.plan.instructions.find(o=>o.functionId===cast.functionId&&o.result===cast.inputs[0].value);
      assert.equal(read.action,'load');assert.equal(read.type,'i8');
      assert.ok(descendants(r.nodes.get(cast.semanticNodeId)).includes(read.semanticNodeId));
      assert.ok(r.plan.sourceMap.macroExpansions.some(m=>m.nodeId===cast.semanticNodeId&&m.tokenRange));
    }
    assert.equal(r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='-').length,2);
    const repeated=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='+');assert.equal(repeated.length,1);
    assert.equal(repeated[0].steps.filter(s=>s.conversion).length,2);
    assert.equal(r.trace.frames.length,1,'macro expansion does not create function frames');
  }
});

test('macro numeric casts preserve signed and unsigned extensions, truncation and both floating directions',async()=>{
  const r=await inspect(`#include <stdio.h>
#define AS(T,v) ((T)(v))
int main(void){int n=-3;unsigned u=260;float low=1.25f;double wide=2.75;
 double d=AS(double,n)+AS(double,u)+AS(double,low);
 float f=AS(float,wide);unsigned a=AS(unsigned,wide);int b=AS(int,wide);
 unsigned char byte=AS(unsigned char,u);long long s=AS(long long,n);unsigned long long w=AS(unsigned long long,u);
 printf("%.2f %.2f %u %d %u %lld %llu\\n",d,(double)f,a,b,(unsigned)byte,s,w);return 0;}`,
  '258.25 2.75 2 2 4 -3 260\n');
  const codes=new Set(r.conversions.map(o=>o.opcode));
  for(const opcode of ['sext','zext','trunc','fpext','fptrunc','sitofp','uitofp','fptosi','fptoui'])assert.ok(codes.has(opcode),opcode);
});

test('macro arithmetic results retain same-width signedness casts and distinct repeated sites',async()=>{
  const r=await inspect(`#include <stdio.h>
#define UP(v) ((unsigned)((v)+1))
#define SIGN(v) ((int)(v))
int main(void){int n=-3;unsigned u=UP(n);int s=SIGN(u);int ok=UP(n)>0U;
 printf("%u %d %d\\n",u,s,ok);return 0;}`,'4294967294 -2 1\n');
  const casts=r.conversions.filter(o=>o.opcode==='c.integral-cast');assert.equal(casts.length,3);
  assert.equal(new Set(casts.map(o=>o.semanticNodeId)).size,3);
  assert.ok(casts.every(o=>o.conversion.bitsUnchanged&&o.conversion.sameWidth));
  assert.deepEqual(r.plan.coverage.cConversions.unobserved,[]);
});

test('comparison-to-unsigned casts consume the C int result, in macros and ordinary expressions',async()=>{
  const r=await inspect(`#include <stdio.h>
#define UNSIGN(v) ((unsigned)(v))
int main(void){int a=2,b=3;unsigned yes=UNSIGN(a<b);unsigned no=(unsigned)(a>b);
 printf("%u %u\\n",yes,no);return 0;}`,'1 0\n');
  const casts=r.conversions.filter(o=>o.opcode==='c.integral-cast');assert.equal(casts.length,2);
  for(const c of casts){
    const producer=r.observations.plan.instructions.find(o=>o.result===c.inputs[0].value&&o.functionId===c.functionId&&o.id!==c.id);
    assert.equal(producer.opcode,'zext');assert.equal(producer.type,'i32');assert.equal(c.inputs[0].type,'i32');
  }
});

test('macro spelling and equivalent expanded expressions produce the same observable work sequence',async()=>{
  const definitions=`#define DIGIT(v) ((v)-'0')
#define BOTH(a,b) (DIGIT(a)+DIGIT(b))
#define UP(v) ((unsigned)((v)+1))
`;
  const body=`static int combine(const char *s){int n=BOTH(s[0],s[1]);unsigned m=UP(n);return (int)m;}
int main(void){char text[]="57";return combine(text)-13;}`;
  const expanded=body.replace('BOTH(s[0],s[1])',"(((s[0])-'0')+((s[1])-'0'))").replace('UP(n)','((unsigned)((n)+1))');
  const macro=await inspect(definitions+body,''),plain=await inspect(expanded,'');
  const value=v=>v?.decimal??v?.number??null;
  const work=r=>r.trace.events.map(e=>({kind:e.kind,action:e.action,phase:e.phase,operator:e.operator,
    value:value(e.value),steps:e.steps?.map(s=>({operator:s.operator,value:value(s.value),
      conversion:s.conversion&&[s.conversion.fromType.name,s.conversion.toType.name]}))}));
  assert.deepEqual(work(macro),work(plain));
});

test('macro bool arrays and pointer truth conversions do not confuse storage adapters with C casts',async()=>{
  const r=await inspect(`#include <stdio.h>
#define AS(T,v) ((T)(v))
int main(void){_Bool flags[1]={1};int n=-4;double d=0.5;int *p=&n;
 int a=AS(int,flags[0]);_Bool b=AS(_Bool,n),c=AS(_Bool,d),e=AS(_Bool,p);
 printf("%d %d %d %d\\n",a,(int)b,(int)c,(int)e);return 0;}`,'1 1 1 1\n');
  assert.equal(r.conversions.filter(o=>o.conversion.toType.encoding==='DW_ATE_boolean').length,3);
  assert.equal(r.conversions.filter(o=>o.conversion.fromType.encoding==='DW_ATE_boolean').length,4);
});

test('macro calls, postincrement and swap temporaries preserve their actual work and lifetimes',async()=>{
  const r=await inspect(`#include <stdio.h>
#define DECODE(v) ((v)-'0')
#define REPEAT(v) (DECODE(v)+DECODE(v))
#define EXCHANGE(T,a,b) do {T temporary=(a);(a)=(b);(b)=temporary;} while(0)
int calls=0;
char sample(void){calls++;return '4';}
int main(void){char text[]="57";char *cursor=text;
 int a=DECODE(*cursor++);int b=REPEAT(sample());unsigned char first=3,second=8;
 EXCHANGE(unsigned char,first,second);
 printf("%d %d %d %c %u %u\\n",a,b,calls,*cursor,(unsigned)first,(unsigned)second);return 0;}`,'5 8 2 7 8 3\n');
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionName==='sample').length,2);
  assert.deepEqual(r.trace.frames.map(f=>f.functionName),['main','sample','sample']);
  const temp=r.trace.objects.filter(o=>o.name==='temporary');assert.equal(temp.length,1);assert.equal(temp[0].lifecycle,'ended');
  const end=r.trace.events.find(e=>e.eventId===temp[0].endedBy);assert.equal(end.action,'object.end');
});

test('faulting macro stops at its invocation after preceding work, without inventing a macro call',async()=>{
  const source=`#include <stdio.h>
#define QUOTIENT(a,b) ((a)/((b)-'0'))
int main(void){char *p="0";puts("before");int x=QUOTIENT(9,*p);puts("after");return x;}`;
  const r=await traceModel(source);assert.equal(r.trace.status,'fault');assert.equal(r.stdout,'before\n');
  const error=r.trace.events.at(-1);assert.equal(error.kind,'ERROR');assert.equal(error.diagnostic.code,'division-by-zero');
  const failed=r.plan.instructions.find(i=>i.id===error.failedInstructionId);
  assert.equal(failed.kind,'CALC');assert.equal(failed.source.expression,'QUOTIENT(9,*p)');
  assert.deepEqual(r.trace.frames.map(f=>f.functionName),['main']);
  assert.ok(!r.trace.events.some(e=>e.action==='frame.end'));
});
