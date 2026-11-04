import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
test('memory intrinsic calls expose three C arguments and contract returns with original ABI evidence',async()=>{
  const source=`#include <stdio.h>
#include <string.h>
int main(void){char a[8]="ab",b[8]={0};void *x=memcpy(b,a,3);void *y=memmove(a,b,3);void *z=memset(b,'q',2);
 b[2]=0;(void)memcpy(a,b,3);printf("%s %s %d %d %d\\n",a,b,x==b,y==a,z==b);return 0;}`;
  const plain=await compileAndRun(source),r=await traceModel(source);
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'qq qq 1 1 1\n');assert.equal(r.stdout,plain.stdout);
  assert.deepEqual(r.plan.coverage.callABI.unresolved,[]);
  const calls=r.trace.events.filter(e=>e.action==='call'&&['@memcpy','@memmove','@memset'].includes(e.callee));assert.equal(calls.length,4);
  for(const c of calls){assert.equal(c.arguments.length,3);assert.equal(c.inputs.length,3);
    const resume=r.trace.events.find(e=>e.action==='resume'&&e.callExecutionId===c.eventId);
    assert.equal(resume.returnType.kind,'pointer');assert.ok(resume.value.type.endsWith('*'));assert.equal(resume.value.address,c.arguments[0].address);
    if(c.backendCallee.startsWith('@llvm.')){assert.equal(c.backendArguments.length,4);assert.equal(resume.backendValue.type,'void');}
  }
  assert.deepEqual(calls.map(c=>c.returnDisposition),['used','used','used','discarded']);
});
test('void qualifiers remain distinct on pointees and on pointers, including typedefs',async()=>{
  const source=`typedef const void CV;int f(const void *p){return *(const int*)p;}
int main(void){int n=7;const void *p=&n;void *const q=&n;CV *r=p;return f(r)-7;}`;
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  const p=r.plan.declarations.find(d=>d.name==='p'&&d.functionName==='main').cType,q=r.plan.declarations.find(d=>d.name==='q').cType,
    alias=r.plan.declarations.find(d=>d.name==='r').cType;
  assert.equal(p.pointee.kind,'void');assert.ok(p.pointee.qualifiers.includes('const'));assert.ok(!p.qualifiers.includes('const'));
  assert.ok(q.qualifiers.includes('const'));assert.equal(q.pointee.kind,'void');assert.ok(!q.pointee.qualifiers.includes('const'));
  assert.ok(alias.pointee.qualifiers.includes('const'));
});
test('compile-only ABI projection retains source slots without manufacturing executions',async()=>{
  const r=await compileCToIR('#include <string.h>\nvoid f(char*a,const char*b){memcpy(a,b,3);}\nint main(void){return 0;}');
  const call=r.plan.instructions.find(d=>d.action==='call'&&d.callee==='@memcpy');
  assert.equal(call.callProjection.sourceArgumentCount,3);assert.equal(call.callProjection.hiddenArguments.at(-1).role,'volatile-flag');
  assert.equal(call.callProjection.returnDisposition,'discarded');assert.equal(call.callProjection.returnType.kind,'pointer');
});
