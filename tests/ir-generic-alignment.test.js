import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
import {validateIRPlan} from '../scripts/model/ir-schema.mjs';

const flatten=(n,out=[])=>{if(!n)return out;out.push(n);for(const c of n.children??[])flatten(c,out);return out;};
async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);assert.deepEqual(r.plan.coverage.unmappedObservations,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);const defs=new Map(r.plan.instructions.map(i=>[i.id,i]));
  for(const s of r.plan.compileTimeSelections){assert.equal(s.stage,'compile-time');assert.equal(s.control.evaluation,'unevaluated');assert.equal(s.associations.filter(a=>a.selected).length,1);assert.ok(s.associations[s.selectedAssociationIndex].selected);}
  return {...r,defs,events:r.trace.events,calcs:r.trace.events.filter(e=>e.kind==='CALC')};
}

test('generic type aliases, lvalue conversion, pointer association and default do not evaluate controls',async()=>{
  const source=`#include <stdio.h>
typedef int Number;int calls=0;int bump(void){calls++;return 9;}
int main(void){int n=2;Number a=3;const int c=5;
int x=_Generic(++n,int:n+10,default:-1);
int y=_Generic(bump(),double:22,default:33);
int z=_Generic(c,int:1,default:0);int w=_Generic(&a,int*:44,default:0);
printf("%d %d %d %d %d %d\\n",n,x,y,z,w,calls);return 0;}`;
  const r=await inspect(source,'2 12 33 1 44 0\n');assert.equal(r.events.filter(e=>e.action==='call'&&e.callee==='@bump').length,0);
  assert.equal(r.calcs.filter(c=>['++','--'].includes(c.operator)).length,0);assert.equal(r.events.filter(e=>e.action==='branch').length,0);
  assert.deepEqual(r.plan.compileTimeSelections.map(s=>s.selectedType),['int','default','int','int *']);
  const sourceTrees=r.plan.instructions.flatMap(i=>flatten(i.expression)),generic=sourceTrees.find(n=>n.kind==='GenericSelectionExpr');assert.ok(generic);
  assert.ok(generic.children.some(n=>n.kind==='GenericAssociation'&&n.selected));assert.ok(generic.children[0].evaluationState==='unevaluated');
  const invalid=structuredClone(r.plan);invalid.compileTimeSelections[0].selectedAssociationIndex=99;assert.throws(()=>validateIRPlan(invalid),/컴파일 시 타입 선택/);
});

test('generic dispatch macro evaluates its actual argument once and preserves nested selections',async()=>{
  const source=`#include <stdio.h>
int fi(int x){return x+1;}double fd(double x){return x+0.5;}
#define CHOOSE(x) _Generic((x),int:fi,double:fd)(x)
int main(void){int n=3;int a=CHOOSE(n++);double b=CHOOSE(2.0);
int z=_Generic(n,int:_Generic((float)0,int:-2,default:8),default:-3);
printf("%d %.1f %d %d\\n",a,b,n,z);return 0;}`;
  const r=await inspect(source,'4 2.5 4 8\n');
  for(const name of ['@fi','@fd']){const c=r.events.find(e=>e.action==='call'&&e.callee===name);assert.ok(c);assert.ok(r.defs.get(c.instructionId).selection);assert.equal(r.events.filter(e=>e.action==='call'&&e.callee===name).length,1);}
  const object=r.trace.objects.find(o=>o.name==='n'),writes=r.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===object.id);assert.deepEqual(writes.map(e=>e.value.decimal),['3','4']);
  assert.equal(r.plan.compileTimeSelections.length,4);assert.ok(!r.calcs.some(c=>['-2','-3'].includes(c.value?.decimal)));
});

test('alignment uses target scalar and compiler record layouts including packed and explicit alignment',async()=>{
  const source=`#include <stdio.h>
#include <stddef.h>
typedef struct{char c;int i;} Plain;
typedef struct __attribute__((packed)){char c;int i;} Packed;
typedef struct __attribute__((aligned(32))){char c;} Wide;
typedef union{char c;double d;} Choice;
typedef int AlignedInt __attribute__((aligned(16)));
int main(void){printf("%u %u %u %u %u %u %u %u\\n",(unsigned)_Alignof(char),(unsigned)_Alignof(int[3]),(unsigned)_Alignof(Plain),(unsigned)_Alignof(Packed),(unsigned)_Alignof(Wide),(unsigned)_Alignof(Choice),(unsigned)_Alignof(AlignedInt),(unsigned)_Alignof(max_align_t));
printf("%d\\n",_Alignof(Packed)<=_Alignof(Plain));return 0;}`;
  const r=await inspect(source,'1 4 4 1 32 8 16 16\n1\n');assert.deepEqual(r.plan.coverage.compilerTypeQueries.unresolved,[]);
  const queries=r.plan.instructions.flatMap(i=>[...flatten(i.expression),...(i.arguments??[]).flatMap(a=>flatten(a))]).filter(n=>n.alignof),values=new Map(queries.map(n=>[n.alignof.queriedType.replace(/\s+(?=\[)/g,''),n.alignof.byteAlignment]));
  for(const [name,value]of [['char',1],['int[3]',4],['Plain',4],['Packed',1],['Wide',32],['Choice',8],['AlignedInt',16],['max_align_t',16]])assert.equal(values.get(name),value,name);
  const comparison=r.calcs.find(c=>c.operator==='<=');assert.ok(comparison);assert.equal(comparison.value.decimal,'1');assert.match(comparison.evidence,/fold/i);
  assert.deepEqual(comparison.inputs.map(i=>i.value.decimal),['1','4']);assert.equal(r.trace.objects.filter(o=>o.storage==='automatic').length,0);
});

test('alignment macros keep source ranges and compile-only generic metadata has no execution',async()=>{
  const source=`#include <stdio.h>
#include <stddef.h>
#define REQUIREMENT(T) _Alignof(T)
int main(void){int n=1;int v=_Generic(++n,int:2,default:3);printf("%d %d %d\\n",n,v,REQUIREMENT(int)<=REQUIREMENT(max_align_t));return 0;}`;
  const r=await inspect(source,'1 2 1\n'),comparison=r.calcs.find(c=>c.operator==='<=');assert.ok(comparison);
  const range=r.defs.get(comparison.instructionId).source;assert.ok(range.expression.startsWith('REQUIREMENT(int)'));assert.deepEqual(comparison.inputs.map(i=>i.value.decimal),['4','16']);
  const compiled=await compileCToIR(source);assert.equal(compiled.trace,undefined);assert.equal(compiled.plan.compileTimeSelections.length,1);assert.equal(compiled.plan.compileTimeSelections[0].selectedType,'int');
});

test('alignment typedef attributes respect declaration visibility when an alias is shadowed',async()=>{
  const source=`#include <stdio.h>
typedef int Item __attribute__((aligned(8)));
int main(void){unsigned before=_Alignof(Item);
typedef int Item __attribute__((aligned(32)));
unsigned after=_Alignof(Item);printf("%u %u\\n",before,after);return 0;}`;
  const r=await inspect(source,'8 32\n');
  for(const [name,expected]of [['before',8],['after',32]]){
    const object=r.trace.objects.find(o=>o.name===name),write=r.events.find(e=>e.kind==='WRITE'&&e.target?.objectId===object.id),query=flatten(r.defs.get(write.instructionId).expression).find(n=>n.alignof);
    assert.equal(query.alignof.byteAlignment,expected);assert.equal(write.value.decimal,String(expected));
  }
});
