import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.deepEqual(r.plan.coverage.unmappedObservations,[]);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(i=>[i.id,i]));return {...r,defs,events:r.trace.events,calcs:r.trace.events.filter(e=>e.kind==='CALC'),expr:e=>defs.get(e.instructionId)?.source?.expression??''};
}

test('real/integer casts retain source types and observed results, including promotion and narrowing',async()=>{
  const source=`#include <stdio.h>
int main(void){double d=-3.75;int i=(int)d;unsigned u=9;float f=(float)u;double g=f;
float h=(float)(g+0.25);int j=(int)h;double c=(double)7+0.5;
printf("%d %.2f %.2f %d %.2f\\n",i,(double)f,(double)h,j,c);return 0;}`;
  const r=await inspect(source,'-3 9.00 9.25 9 7.50\n'),steps=r.calcs.flatMap(c=>c.steps??[]),pairs=steps.filter(s=>s.conversion).map(s=>[s.conversion.fromType.name,s.conversion.toType.name,s.conversion.explicit]);
  for(const pair of [['double','int',true],['unsigned int','float',true],['float','double',false],['double','float',true],['float','int',true]])assert.ok(pairs.some(p=>JSON.stringify(p)===JSON.stringify(pair)),JSON.stringify({missing:pair,pairs}));
  assert.ok(r.calcs.some(c=>c.evidence.includes('folded')&&c.value.number==='7.5'&&c.value.cType.name==='double'));
  assert.equal(r.plan.sourceMap.stats.compilerTokenMappings,0);
});

test('runtime floating classifiers retain float inputs and one source CALC per expression',async()=>{
  const source=`#include <stdio.h>
#include <math.h>
int main(void){float a[4]={-0.0f,0.0f,NAN,INFINITY};for(int i=0;i<4;i++){
float v=a[i];printf("%d %d %d\\n",signbit(v)!=0,isnan(v)!=0,isinf(v)!=0);}return 0;}`;
  const r=await inspect(source,'1 0 0\n0 0 0\n0 1 0\n0 0 1\n'),cs=r.calcs.filter(c=>/^(?:signbit|isnan|isinf)\(/.test(r.expr(c)));
  assert.equal(cs.length,12);for(const c of cs){assert.equal(c.operator,'!=');assert.equal(c.value.cType.name,'int');assert.equal(c.value.type,'i32');assert.ok(['0','1'].includes(c.value.decimal));assert.ok(c.inputs.some(i=>i.value?.type==='float'));assert.ok(!c.inputs.some(i=>i.value?.signed==='-2147483648'));}
  for(const c of cs.filter(c=>r.expr(c).startsWith('signbit')))assert.equal(c.inputs.length,2);
});

test('nested user macro aliases and folded floating classifiers preserve separate use sites',async()=>{
  const source=`#include <stdio.h>
#include <math.h>
#define ODD_NAME(v) (signbit(v)!=0)
#define OTHER_NAME(v) (isnan(v)!=0)
#define SPECIAL_VALUE NAN
#define FAR_VALUE INFINITY
int main(void){float x=-0.0f,y=0.0f;
printf("%d %d %d %d\\n",ODD_NAME(x),ODD_NAME(y),OTHER_NAME(SPECIAL_VALUE),isinf(FAR_VALUE)!=0);return 0;}`;
  const r=await inspect(source,'1 0 1 1\n'),cs=r.calcs.filter(c=>/^(?:ODD_NAME|OTHER_NAME|isinf)\(/.test(r.expr(c)));
  assert.equal(cs.length,4,JSON.stringify(r.calcs.map(r.expr)));assert.deepEqual(cs.map(c=>c.value.decimal),['1','0','1','1']);
  const folded=cs.filter(c=>c.evidence.includes('folded'));assert.equal(folded.length,2);
  assert.deepEqual(folded.map(c=>c.inputs.find(i=>i.value.category)?.value.category),['nan','infinity']);
  assert.ok(folded.every(c=>c.inputs.filter(i=>i.value.category).every(i=>i.value.bits===undefined)));
  assert.ok(r.plan.sourceMap.stats.compilerTokenMappings>0);
});

test('a builtin consuming a user call result does not repeat the call or expose backend tests',async()=>{
  const source=`#include <stdio.h>
#include <math.h>
#define FLAG(v) (signbit(v)!=0)
int calls=0;
float sample(void){calls++;return -0.0f;}
int main(void){int result=FLAG(sample());printf("%d %d\\n",result,calls);return 0;}`;
  const r=await inspect(source,'1 1\n');assert.equal(r.events.filter(e=>e.action==='call'&&e.callee==='@sample').length,1);
  const cs=r.calcs.filter(c=>r.expr(c)==='FLAG(sample())');assert.equal(cs.length,1);assert.equal(cs[0].value.cType.name,'int');assert.equal(cs[0].value.decimal,'1');
  const call=r.events.find(e=>e.action==='call'&&e.callee==='@sample'),resume=r.events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId);assert.ok(cs[0].dataInputs.includes(resume.eventId));
  assert.ok(cs[0].inputs.some(i=>i.value.type==='float'&&i.value.number==='-0'));
});
