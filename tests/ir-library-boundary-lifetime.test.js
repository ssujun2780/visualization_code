import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

test('user functions sharing library names retain only their observed source effects',async()=>{
  const source=`static void *malloc(unsigned long n){static int v=4;return &v;}
static void free(void *p){*(int*)p+=1;}
static void *realloc(void*p,unsigned long n){*(int*)p+=(int)n;return p;}
static void *memset(void*p,int c,unsigned long n){*(int*)p=c+(int)n;return p;}
static char *strcpy(char*d,const char*s){d[0]=s[0]+1;return d;}
int main(void){int x=0;char a='a',b=0;int*q=malloc(1);memset(&x,3,2);free(&x);realloc(&x,2);strcpy(&b,&a);return x+*q+b;}`;
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,110);
  const names=new Set(['@malloc','@free','@realloc','@memset','@strcpy']);
  const calls=r.observations.plan.instructions.filter(o=>o.action==='call'&&names.has(o.callee));
  assert.equal(calls.length,5);assert.ok(calls.every(c=>c.external===false));
  assert.ok(!r.trace.objects.some(o=>o.storage==='heap'));assert.ok(!r.trace.events.some(e=>['copy','fill'].includes(e.action)));
  assert.ok(!r.trace.events.some(e=>e.reason==='free'||e.reason==='realloc-replaced'));
  const call=r.trace.events.find(e=>e.action==='call'&&e.callee==='@malloc');
  const pointer=r.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId).value.reference;
  assert.equal(r.trace.objects.find(o=>o.id===pointer.targetObjectId).storage,'static');
  assert.deepEqual(r.trace.coverage.irGaps,[]);
});

test('VLA stack restoration ends block lifetime before a stale pointer read',async()=>{
  const r=await traceModel('int f(int n){int*p;{int a[n];a[0]=7;p=a;}return *p;}int main(void){return f(2);}',{includeObservations:true});
  assert.equal(r.trace.status,'fault');assert.equal(r.trace.diagnostics[0].code,'use-after-lifetime');
  const object=r.trace.objects.find(o=>o.name==='a'),end=r.trace.events.find(e=>e.eventId===object.endedBy);
  assert.ok(end);assert.equal(end.kind,'SPACE');assert.equal(end.action,'object.end');
  assert.ok(!r.trace.events.some(e=>e.kind==='READ'&&e.target?.objectId===object.id));
});

test('nested VLA lifetimes survive valid reads and close on loops, break and early return',async()=>{
  const cases=[
    ['int f(int n){int a[n];a[0]=3;{int b[n+1];b[0]=5;a[0]+=b[0];}return a[0];}int main(void){return f(2);}',8,2],
    ['int f(int n){int sum=0;for(int i=0;i<4;i++){int a[n+i];a[0]=i+1;{int b[n];b[0]=a[0]+10;sum+=b[0];}if(i==1)continue;if(i==2)break;}return sum;}int main(void){return f(2);}',36,6],
    ['int f(int n){int a[n];a[0]=7;{int b[n+1];b[0]=9;return a[0]+b[0];}}int main(void){return f(2);}',16,2]
  ];
  for(const [source,exitCode,count]of cases){
    const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
    const arrays=r.trace.objects.filter(o=>['a','b'].includes(o.name));assert.equal(arrays.length,count);
    assert.equal(new Set(arrays.map(o=>o.id)).size,count);
    for(const o of arrays){assert.equal(o.lifecycle,'ended');assert.ok(r.trace.events.some(e=>e.eventId===o.endedBy&&e.kind==='SPACE'));}
    assert.deepEqual(r.trace.coverage.irGaps,[]);
  }
});
