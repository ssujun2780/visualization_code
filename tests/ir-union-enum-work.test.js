import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
import {materializeMemory} from '../scripts/model/memory-state.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,expected);
  assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  return {...r,defs,path:e=>defs.get(e.instructionId)?.memberPath??e.memberPath,
    line:e=>defs.get(e.instructionId)?.source?.line};
}
function trees(n){return n?[n,...(n.children??[]).flatMap(trees)]:[];}

test('same-typed union fields retain exact paths, non-first initialization and independent copies',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <string.h>
typedef union {int first;int second;double wide;char bytes[16];} Data;
typedef struct {int tag;Data data;} Item;
int calls=0;int once(void){calls++;return 13;}
void set(Item *p){p->data.second=once();}
int main(void){Item a={.tag=0,.data={.second=9}};Item b=a;
 b.data.first=5;set(&a);b.tag=2;strcpy(b.data.bytes,"ok");
 printf("%d %s %d\\n",a.data.second,b.data.bytes,calls);return 0;}`,'13 ok 1\n');
  const a=r.trace.objects.find(o=>o.name==='a'),b=r.trace.objects.find(o=>o.name==='b');
  assert.notEqual(a.address,b.address);
  const init=r.plan.declarations.find(d=>d.name==='a').initialization;
  assert.deepEqual(init.unionSelections.map(s=>s.memberPath),[['data','second']]);
  const copied=r.trace.events.find(e=>e.action==='copy'&&e.target.objectId===b.id);
  assert.equal(copied.sourceObjectId,a.id);
  const first=r.trace.events.find(e=>e.kind==='WRITE'&&r.path(e)?.join('.')==='data.first');
  const second=r.trace.events.find(e=>e.kind==='WRITE'&&r.path(e)?.join('.')==='data.second');
  assert.ok(first);assert.ok(second);assert.equal(first.target.offset,second.target.offset);
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@once').length,1);
  const call=r.trace.events.find(e=>e.action==='call'&&e.callee==='@strcpy'),write=r.trace.events.find(e=>e.action==='copy'&&e.callExecutionId===call.eventId);
  assert.deepEqual(write.memberPath,['data','bytes']);assert.equal(write.target.size,3);
  assert.deepEqual([...materializeMemory(write.memoryState).bytes],[111,107,0]);
  const member=trees(r.defs.get(call.instructionId).arguments[0]).find(n=>n.memberName==='bytes');
  assert.equal(member.cType.count,16);assert.ok(member.fieldNodeId);assert.deepEqual(member.memberPath,['data','bytes']);
  assert.equal(r.trace.events.filter(e=>e.kind==='WRITE'&&r.line(e)===8&&r.path(e)?.join('.')==='data.second').length,0);
});

test('nested unions in arrays preserve selected fields, element paths and scalar initialization order',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef union {int left;int right;} Small;
typedef union {Small cells[2];double wide;} Large;
int main(void){Large a={.cells={{.right=4},{.left=7}}};
 a.cells[1].right=8;printf("%d %d\\n",a.cells[0].right,a.cells[1].right);return 0;}`,'4 8\n');
  const s=r.plan.declarations.find(d=>d.name==='a').initialization.unionSelections;
  assert.deepEqual(s.map(s=>s.memberName),['cells','right','left']);
  assert.deepEqual(s.map(s=>s.offsetBits),[0,0,32]);
  assert.deepEqual(s[2].targetPath.filter(p=>p.kind==='index').map(p=>p.index),['1']);
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&r.path(e)?.join('.')==='cells.right');
  assert.ok(writes.length);assert.equal(writes.at(-1).target.offset,4);
  assert.ok(r.defs.get(writes.at(-1).instructionId).targetPath.some(p=>p.kind==='index'&&p.index==='1'));
});

test('enum descriptors retain compiler values, aliases, underlying types and constant references',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef enum {LOW=-7,ALSO_LOW=-7,NEXT=-6,STOP=12} Code;
enum Big {SMALL=1U,HIGH=4000000000U};
int main(void){const Code a=LOW;enum Big b=HIGH;
 printf("%d %u\\n",(int)a,(unsigned)b);return 0;}`,'-7 4000000000\n');
  const a=r.plan.declarations.find(d=>d.name==='a').cType,b=r.plan.declarations.find(d=>d.name==='b').cType;
  assert.equal(a.kind,'enum');assert.equal(a.underlyingType.signedness,'signed');assert.equal(a.signedness,'signed');
  assert.deepEqual(a.enumerators.map(e=>[e.name,e.value]),[['LOW','-7'],['ALSO_LOW','-7'],['NEXT','-6'],['STOP','12']]);
  assert.equal(b.kind,'enum');assert.equal(b.signedness,'unsigned');assert.ok(b.display.badges.includes('u'));
  assert.equal(b.enumerators.find(e=>e.name==='HIGH').value,'4000000000');
  const constants=r.plan.instructions.flatMap(d=>trees(d.expression)).filter(n=>n.enumConstant);
  assert.ok(constants.some(n=>n.enumConstant.name==='LOW'&&n.enumConstant.value==='-7'));
  assert.ok(constants.some(n=>n.enumConstant.name==='HIGH'&&n.enumConstant.value==='4000000000'));
});

test('scoped enums and 64-bit enumerators use compiler identity without guessing same-name values',async()=>{
  const r=await inspect(`#include <stdio.h>
enum Size {BIG=18446744073709551615ULL};
int main(void){enum Size big=BIG;(void)big;enum {SAME=-2,NEXT=-1} outer=SAME;printf("%d ",outer);
 {enum {SAME=9,NEXT=10} inner=SAME;printf("%d\\n",inner);}return 0;}`,'-2 9\n');
  const references=r.plan.instructions.flatMap(d=>trees(d.expression)).filter(n=>n.enumConstant?.name==='SAME');
  assert.deepEqual([...new Set(references.map(n=>n.enumConstant.value))].sort(),['-2','9']);
  assert.equal(new Set(references.map(n=>n.enumConstant.enumTypeId)).size,2);
  const big=r.plan.types.find(t=>t.tag==='DW_TAG_enumeration_type'&&t.enumerators?.some(e=>e.name==='BIG'));
  assert.equal(big.enumerators[0].value,'18446744073709551615');assert.equal(big.sizeBits,64);
});

test('overlapping member arguments preserve ambiguous candidates and tag writes do not alter union storage',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <string.h>
union U {char first[8];char second[8];};
int main(void){union U u={.first="abc"};int tag=1;tag=2;
 memmove(u.second,u.first,4);printf("%s %d\\n",u.second,tag);return 0;}`,'abc 2\n');
  const call=r.trace.events.find(e=>e.action==='call'&&e.callee==='@memmove'),write=r.trace.events.find(e=>e.action==='copy'&&e.callExecutionId===call.eventId);
  assert.deepEqual(write.memoryAccesses.filter(a=>a.role==='target').map(a=>a.memberPath),[['second'],['first']]);
  assert.equal(write.memberPath,undefined);
  const u=r.trace.objects.find(o=>o.name==='u');
  assert.equal(r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===u.id&&r.line(e)===4).length,1);
});

test('compile-only metadata resolves union choices and enum constants without execution',async()=>{
  const r=await compileCToIR(`enum Mode {OFF=-1,ON=5};union U {int x;int y;};
int main(void){enum Mode mode=ON;union U a={.y=mode};return a.y;}`);
  const a=r.plan.declarations.find(d=>d.name==='a');assert.deepEqual(a.initialization.unionSelections[0].memberPath,['y']);
  assert.equal(r.plan.types.find(t=>t.tag==='DW_TAG_enumeration_type').enumerators.find(e=>e.name==='ON').value,'5');
  assert.ok(r.plan.instructions.some(d=>d.memberPath?.[0]==='y'));
});

test('an enum omitted by compiler debug info keeps its AST declaration and an explicit unresolved status',async()=>{
  const r=await compileCToIR(`enum Mode {OFF=-1,ON=5};union U {int x;int y;};
int main(void){union U a={.y=ON};return a.y;}`);
  const declaration=r.plan.enumDeclarations.find(e=>e.constants.some(c=>c.name==='ON'));
  assert.ok(declaration);assert.deepEqual(declaration.constants.map(c=>c.name),['OFF','ON']);
  if(declaration.status==='unresolved'){
    assert.ok(r.plan.coverage.compilerEnums.unresolved.some(e=>e.nodeId===declaration.nodeId));
    assert.ok(declaration.constants.every(c=>c.value===undefined));
  }else assert.equal(declaration.constants.find(c=>c.name==='ON').value,'5');
});
