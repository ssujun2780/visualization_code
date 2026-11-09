import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';

const definitions=r=>new Map(r.plan.instructions.map(d=>[d.id,d]));
function completed(r,exit){assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exit);assert.deepEqual(r.trace.coverage.irGaps,[]);}

test('failed compound expressions keep actual inputs and prior work without fabricating a result',async()=>{
  for(const expr of ['(n+4)/z','(n+4)%z','n/(z+0)','(n+4)/0']){
    const r=await traceModel(`int twice(int x){return x*2;}int main(){int n=twice(3),z=0;int good=n+2;int bad=${expr};return bad;}`);
    assert.equal(r.trace.status,'fault');assert.equal(r.trace.diagnostics.at(-1).code,'division-by-zero');
    const defs=definitions(r),good=r.trace.events.find(e=>e.action==='write'&&defs.get(e.instructionId)?.source?.expression?.includes('good='));
    assert.equal(good.value.decimal,'8');
    const failed=r.trace.events.find(e=>e.kind==='CALC'&&e.phase==='failed');assert.ok(failed);assert.equal(failed.value,undefined);
    if(!expr.endsWith('/0'))assert.ok(failed.inputs.some(i=>i.value?.signed==='0'));
    assert.ok(!r.trace.events.some(e=>e.action==='write'&&defs.get(e.instructionId)?.source?.expression?.includes('bad=')));
    assert.deepEqual(r.trace.coverage.irGaps,[]);
  }
});

test('indirect updates retain storage types and distinct prefix/postfix value delivery',async()=>{
  const r=await traceModel(`typedef struct{unsigned char n;} Cell;
int main(){Cell c={250};unsigned char*p=&c.n;int old=(*p)++;int old2=p[0]++;int fresh=++*p;--c.n;return old+old2+fresh+c.n;}`);
  completed(r,1006);const defs=definitions(r);
  const writes=r.trace.events.filter(e=>e.action==='write'&&['(*p)++','p[0]++','++*p','--c.n'].includes(defs.get(e.instructionId)?.source?.expression));
  assert.deepEqual(writes.map(e=>e.value.decimal),['251','252','253','252']);
  assert.ok(writes.every(e=>e.value.cType.name==='unsigned char'&&e.value.cType.display.badges.includes('u')));
});

test('nested callee factories bind distinct call ranges and their real return types',async()=>{
  const r=await traceModel(`typedef int(*Op)(int);int inc(int x){return x+1;}int square(int x){return x*x;}Op choose(int n){return n?square:inc;}
int main(){return choose(choose(0)(0))(3);}`);completed(r,9);
  const defs=definitions(r),calls=r.trace.events.filter(e=>e.action==='call');
  assert.deepEqual(calls.map(e=>e.resolvedFunctionName),['choose','inc','choose','square']);
  assert.deepEqual(calls.map(e=>defs.get(e.instructionId).source.expression),['choose(0)','choose(0)(0)','choose(choose(0)(0))','choose(choose(0)(0))(3)']);
  assert.equal(new Set(calls.map(e=>e.instructionId)).size,4);
  assert.deepEqual(r.trace.events.filter(e=>e.action==='resume').map(e=>e.value.cType.name),['Op','int','Op','int']);
});

test('variable row strides work for three dimensions and retain written index arithmetic',async()=>{
  const r=await traceModel(`int sum(int n,int m,int a[n][m][2]){int s=0;for(int i=0;i<n;i++)for(int j=0;j<m;j++)s+=a[i][j][1];return s;}
int main(){int n=2,m=3;int a[n][m][2];for(int i=0;i<n;i++)for(int j=0;j<m;j++){a[i][j][0]=0;a[i][j][1]=i*m+j;}return sum(n,m,a);}`);
  completed(r,15);const defs=definitions(r);
  assert.ok(r.trace.events.some(e=>e.kind==='CALC'&&defs.get(e.instructionId).source.expression==='i*m+j'));
  assert.ok(r.plan.instructions.filter(d=>d.kind==='CALC').every(d=>d.operator));
  const literal=await traceModel('int main(){int n=2;int a[n][2];a[0][0]=3;a[1][0]=7;int i=1;return a[i*1][0];}');completed(literal,7);
  assert.ok(literal.trace.events.some(e=>e.kind==='CALC'&&definitions(literal).get(e.instructionId).source.expression==='i*1'));
});

test('callee dereference, casts, comma and assignment still select the outer call occurrence',async()=>{
  const r=await traceModel(`typedef int(*Op)(int);int inc(int x){return x+1;}Op choose(int n){return inc;}
int main(){Op p=inc;int a=(*choose(0))(3);int b=((Op)choose(1))(a);int c=(a=2,choose(2))(b);return (p=choose(3))(c);}`);
  completed(r,7);const defs=definitions(r),calls=r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionName==='inc');
  assert.deepEqual(calls.map(e=>defs.get(e.instructionId).source.expression),['(*choose(0))(3)','((Op)choose(1))(a)','(a=2,choose(2))(b)','(p=choose(3))(c)']);
  assert.ok(calls.every(e=>r.trace.events.find(x=>x.action==='resume'&&x.callExecutionId===e.eventId).value.cType.name==='int'));
});

test('quoted UTF8 identifiers bind locals globals functions labels and source ranges',async()=>{
  const r=await traceModel('int 전역=2;int 더하기(int 값){int 합=값+전역;goto 끝;끝:return 합;}int main(){int 값=3;return 더하기(값);}');
  completed(r,5);assert.ok(r.trace.objects.some(o=>o.name==='값'));assert.ok(r.trace.objects.some(o=>o.name==='전역'));
  const call=r.trace.events.find(e=>e.action==='call');assert.equal(call.resolvedFunctionName,'더하기');assert.equal(definitions(r).get(call.instructionId).source.expression,'더하기(값)');
});

test('preparation failures preserve compiler evidence and a source location',async()=>{
  const r=await traceModel('int main(){volatile int x=1;return x;}');
  assert.equal(r.trace.status,'unsupported');assert.ok(r.ast?.includes('VarDecl'));assert.ok(r.llvm?.includes('volatile'));
  assert.equal(r.conversionFailure.stage,'ir-planning');assert.equal(r.trace.diagnostics[0].source.line,1);
  await assert.rejects(compileCToIR('int main(){volatile int x=1;return x;}'),error=>{
    assert.equal(error.stage,'ir-conversion');assert.ok(error.analysis.ast?.includes('VarDecl'));assert.ok(error.analysis.llvm?.includes('volatile'));return true;
  });
});
