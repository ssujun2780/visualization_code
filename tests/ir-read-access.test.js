import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,stdout){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.equal(r.stdout,plain.stdout);assert.equal(r.trace.exitCode,plain.exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const definitions=new Map(r.plan.instructions.map(i=>[i.id,i])),objects=new Map(r.trace.objects.map(o=>[o.id,o]));
  return {...r,definitions,reads:r.trace.events.filter(e=>e.kind==='READ'),
    name:e=>objects.get(e.target?.objectId)?.name,definition:e=>definitions.get(e.instructionId)};
}
function assertRead(r,event,signedness,bits){
  assert.ok(event);assert.equal(event.value.cType.signedness,signedness);assert.equal(event.value.cType.sizeBits,bits);
  assert.equal(r.definition(event).cType.signedness,signedness);assert.equal(r.definition(event).cType.sizeBits,bits);
  assert.deepEqual(event.value.cType.display.badges,signedness==='unsigned'?['u']:[]);
}
function assertOldIndex(r,cursor,element){
  const after=r.trace.events.slice(r.trace.events.indexOf(cursor)+1),
    increment=after.find(e=>e.kind==='CALC'&&e.operator==='++'),write=after.find(e=>e.kind==='WRITE'&&e.target?.objectId===cursor.target.objectId);
  assert.ok(increment);assert.ok(write);assert.ok(r.trace.events.indexOf(increment)<r.trace.events.indexOf(write));
  assert.ok(r.trace.events.indexOf(write)<r.trace.events.indexOf(element));
  const dependencies=new Set(),byId=new Map(r.trace.events.map(e=>[e.eventId,e])),pending=[...element.addressInputs];
  while(pending.length){const id=pending.pop();if(dependencies.has(id))continue;dependencies.add(id);pending.push(...(byId.get(id)?.dataInputs??[]));}
  assert.ok(dependencies.has(cursor.eventId));assert.ok(!dependencies.has(increment.eventId));
  assert.notEqual(cursor.instructionId,element.instructionId);
}

for(const reverse of [false,true])test(`postfix cursor reads retain declarations and signedness with ${reverse?'reordered':'original'} expressions`,async()=>{
  const first='int x=items[u++].left;',second='unsigned y=items[s++].right;';
  const r=await inspect(`#include <stddef.h>
#include <stdio.h>
typedef struct {int left;unsigned right;} Entry;
int main(void){Entry items[2]={{-7,4000000001U},{-9,4000000002U}};size_t u=0;int s=0;
${reverse?second+first:first+second}
printf("%zu %d %d %u\\n",u,s,x,y);return 0;}`,'1 1 -7 4000000001\n');
  for(const [cursorName,fieldName,signedness,fieldSignedness]of [['u','left','unsigned','signed'],['s','right','signed','unsigned']]){
    const cursor=r.reads.find(e=>r.name(e)===cursorName),element=r.reads.find(e=>r.definition(e).memberPath?.includes(fieldName));
    assertRead(r,cursor,signedness,32);assertRead(r,element,fieldSignedness,32);assertOldIndex(r,cursor,element);
    assert.equal(r.definition(cursor).expression.kind,'UnaryOperator');assert.equal(r.definition(cursor).expression.position,'postfix');
    assert.equal(r.definition(cursor).memberPath,undefined);
    assert.equal(r.definition(element).expression.children[0].kind,'MemberExpr');
  }
});

test('nested subscript and member cursor reads keep distinct storage paths and old indices',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Cell{int value;};struct Row{struct Cell cells[2];};struct Cursor{unsigned next;};
int main(void){struct Row rows[2]={{{{11},{12}}},{{{21},{22}}}};struct Cursor state={0};
unsigned indices[2]={1,0};unsigned char inside=0;
int answer=rows[indices[state.next++]].cells[inside++].value;
printf("%d %u %u\\n",answer,state.next,(unsigned)inside);return 0;}`,'21 1 1\n');
  const cursor=r.reads.find(e=>r.name(e)==='state'),inner=r.reads.find(e=>r.name(e)==='inside'),
    index=r.reads.find(e=>r.name(e)==='indices'),element=r.reads.find(e=>r.name(e)==='rows');
  assertRead(r,cursor,'unsigned',32);assertRead(r,inner,'unsigned',8);assertRead(r,index,'unsigned',32);assertRead(r,element,'signed',32);
  assert.deepEqual(r.definition(cursor).memberPath,['next']);assert.deepEqual(r.definition(element).memberPath,['cells','value']);
  assertOldIndex(r,cursor,index);assertOldIndex(r,inner,element);
  assert.equal(element.target.offset,8);assert.equal(element.value.decimal,'21');
  assert.equal(r.reads.filter(e=>r.name(e)==='rows').length,1);
  const addressWidth=r.observations.plan.instructions.find(o=>o.opcode==='zext'&&o.type==='i32'&&o.inputs?.[0]?.type==='i8'&&
    r.observations.plan.instructions.some(use=>use.action==='address'&&use.inputs.some(input=>input.value===o.result)));
  assert.ok(addressWidth);assert.equal(addressWidth.conversion,undefined);
  assert.equal(r.plan.bindings[addressWidth.id].administrative,true,'GEP-only width adaptation has no separate C calculation');
  assert.ok(!r.trace.events.some(e=>e.kind==='CALC'&&r.definition(e).source?.expression==='rows'));
});

test('temporary pointers and pointer arrays preserve stored unsigned values before signed conversion',async()=>{
  const r=await inspect(`#include <stdio.h>
struct Cell{unsigned value;};
int take(struct Cell *temporary,unsigned *cursor){return (int)temporary[(*cursor)++].value;}
int main(void){struct Cell values[2]={{2147483648U},{17U}};struct Cell *choices[1]={values};
unsigned slot=0;unsigned cursor=0;struct Cell *temporary=choices[slot++];
int answer=take(temporary,&cursor);
printf("%d %u %u\\n",answer,slot,cursor);return 0;}`,'-2147483648 1 1\n');
  const cursor=r.reads.find(e=>r.name(e)==='cursor'&&e.value.type==='i32'),element=r.reads.find(e=>r.name(e)==='values');
  assertRead(r,cursor,'unsigned',32);assertRead(r,element,'unsigned',32);assertOldIndex(r,cursor,element);
  assert.equal(element.value.decimal,'2147483648');assert.equal(element.target.offset,0);
  const conversion=r.trace.events.filter(e=>e.kind==='CALC').flatMap(e=>e.steps??[e]).find(e=>e.conversion?.toType?.signedness==='signed');
  assert.ok(conversion);assert.equal(conversion.value.decimal,'-2147483648');
  assert.equal(r.reads.filter(e=>r.name(e)==='values').length,1);
});
