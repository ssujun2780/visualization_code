import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
// Structural labels distinguish source operands; they never use observed values to select a node.
function targetLabel(input){
  const n=unwrap(input);if(!n)return null;
  if(n.kind==='DeclRefExpr')return n.referencedName;
  if(n.kind==='IntegerLiteral')return n.literal;
  if(n.kind==='MemberExpr')return `${targetLabel(n.children[0])}.${n.memberName}`;
  if(n.kind==='ArraySubscriptExpr')return `${targetLabel(n.children[0])}[${targetLabel(n.children[1])}]`;
  if(n.kind==='UnaryOperator'&&n.operator==='&')return targetLabel(n.children[0]);
  if(n.kind==='UnaryOperator'&&n.operator==='*')return `*${targetLabel(n.children[0])}`;
  if(n.kind==='CallExpr')return `${targetLabel(n.children[0])}(${n.children.slice(1).map(targetLabel).join(',')})`;
  if(n.kind==='BinaryOperator')return `${targetLabel(n.children[0])}${n.operator}${targetLabel(n.children[1])}`;
  return null;
}
async function inspect(source,exitCode=0){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.ok(r.trace.events.every(e=>['SPACE','READ','CALC','WRITE','FLOW'].includes(e.kind)));
  for(const event of r.trace.events.filter(e=>e.kind==='CALC'))
    for(const op of [event.operator,...(event.steps??[]).map(s=>s.operator)])
      assert.ok(!['read','cast','readcast','getelementptr','load'].includes(op),`invented source operator: ${op}`);
  return {...r,nodes:new Map(r.plan.instructions.flatMap(d=>walk(d.expression)).map(n=>[n.nodeId,n])),
    object:name=>r.trace.objects.find(o=>o.name===name&&o.storage==='automatic')??r.trace.objects.find(o=>o.name===name&&o.storage==='static')};
}
function pointerWrite(r,name,objectName,offset){
  const box=r.object(name),target=r.object(objectName);assert.ok(box&&target);
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===box.id);
  assert.equal(writes.length,1);
  assert.equal(writes[0].value.reference.targetObjectId,target.id);
  assert.equal(writes[0].value.reference.targetOffset,offset);
  return writes[0];
}
function checkAddressBindings(r,expected,required=Object.keys(expected)){
  const seen=new Set();
  for(const op of r.observations.plan.instructions.filter(o=>o.opcode==='getelementptr')){
    const binding=op.addressBinding;if(!binding)continue;
    assert.equal(binding.status,'resolved');assert.equal(op.semanticNodeId,binding.nodeId);
    const node=r.nodes.get(binding.nodeId);assert.ok(node,`missing selected address node ${binding.nodeId}`);
    const label=targetLabel(node),target=expected[label];
    assert.ok(target,`unexpected selected address target ${label}`);
    const object=r.object(target[0]);assert.ok(object);
    const observations=r.observations.trace.events.filter(e=>e.instructionId===op.id&&e.action==='address');
    for(const observation of observations){
      assert.equal(observation.value.reference?.targetObjectId,object.id,`${op.id}: ${label} object`);
      assert.equal(observation.value.reference?.targetOffset,target[1],`${op.id}: ${label} offset`);
      seen.add(label);
    }
    const publicBinding=r.plan.bindings[op.id];
    if(publicBinding.roles.CALC)assert.equal(publicBinding.expressionNodeId,binding.nodeId);
  }
  for(const label of required)assert.ok(seen.has(label),`no observed GEP bound to ${label}`);
}

test('assert field addresses retain distinct same-type fields and owning objects',async()=>{
  const r=await inspect(`#include <assert.h>
struct Pair {int first;int second;};
int main(void){struct Pair left={11,23},right={37,41};
int *a=&left.first,*b=&left.second,*c=&right.second;
assert(a == &left.first);assert(b == &left.second);assert(c == &right.second);
assert(a != b);assert(b != c);return 0;}`);
  pointerWrite(r,'a','left',0);pointerWrite(r,'b','left',4);pointerWrite(r,'c','right',4);
  checkAddressBindings(r,{'left.first':['left',0],'left.second':['left',4],'right.second':['right',4]});
  const equality=r.trace.events.filter(e=>e.kind==='CALC').flatMap(e=>e.steps??[]).filter(s=>s.operator==='==');
  assert.equal(equality.length,3);assert.ok(equality.every(s=>s.value.decimal==='1'));
});

test('repeated address macros distinguish equal-valued operands by field and declaration identity',async()=>{
  const r=await inspect(`#define LOCATE(value) (&(value))
#define MATCH(a,b) ((a)==(b))
struct Entry{int low;int high;};
int main(void){struct Entry oak={9,9},elm={9,9};
int *p=LOCATE(oak.high),*q=LOCATE(elm.low),*r=LOCATE(oak.low);
int same=MATCH(p,LOCATE(oak.high));
int other=MATCH(p,LOCATE(elm.high));
return same+other;}`,1);
  pointerWrite(r,'p','oak',4);pointerWrite(r,'q','elm',0);pointerWrite(r,'r','oak',0);
  checkAddressBindings(r,{'oak.high':['oak',4],'elm.low':['elm',0],'oak.low':['oak',0],'elm.high':['elm',4]});
  const equality=r.trace.events.filter(e=>e.kind==='CALC').flatMap(e=>e.steps??[]).filter(s=>s.operator==='==');
  assert.deepEqual(equality.map(s=>s.value.decimal),['1','0']);
});

test('nested record and array addresses bind each GEP to its own intermediate subobject',async()=>{
  const r=await inspect(`struct Layer{int cells[3];};
struct Box{int tag;struct Layer parts[2];};
int main(void){struct Box box={0};
int *last=&box.parts[1].cells[2];
int *early=&box.parts[0].cells[1];
*last=31;*early=7;return *last+*early;}`,38);
  pointerWrite(r,'last','box',24);pointerWrite(r,'early','box',8);
  checkAddressBindings(r,{
    'box.parts':['box',4],
    'box.parts[1]':['box',16],'box.parts[1].cells':['box',16],'box.parts[1].cells[2]':['box',24],
    'box.parts[0]':['box',4],'box.parts[0].cells':['box',4],'box.parts[0].cells[1]':['box',8],
  });
});

test('pointer addition and subtraction retain source operators and scaled target offsets',async()=>{
  const r=await inspect(`int main(void){int cells[8]={0};int stride=5;
int *first=cells;int *later=first+stride;int *back=later-2;
*back=19;return *back;}`,19);
  pointerWrite(r,'first','cells',0);pointerWrite(r,'later','cells',20);pointerWrite(r,'back','cells',12);
  checkAddressBindings(r,{'first+stride':['cells',20],'later-2':['cells',12]});
  const arithmetic=r.trace.events.filter(e=>e.kind==='CALC'&&['+','-'].includes(e.operator));
  assert.deepEqual(arithmetic.map(e=>e.operator),['+','-']);
  assert.deepEqual(arithmetic.map(e=>e.value.reference.targetOffset),[20,12]);
});

test('one field-address macro binds a global record and a single evaluated pointer-return call',async()=>{
  const r=await inspect(`#define FIELD(record) (&((record).second))
struct Record{int first;int second;};
struct Record global={17,29};int calls=0;
struct Record *choose(void){calls++;return &global;}
int main(void){int *direct=FIELD(global);int *via=FIELD(*choose());
int equal=direct==via;int read=*via;return equal+read+calls;}`,31);
  const direct=pointerWrite(r,'direct','global',4);pointerWrite(r,'via','global',4);
  const directDefinition=r.plan.instructions.find(d=>d.id===direct.instructionId);
  assert.ok(walk(directDefinition.expression).some(n=>n.operator==='&'&&targetLabel(n)==='global.second'));
  // The global field address is an LLVM constant-expression operand, not a separate GEP event.
  checkAddressBindings(r,{'global.second':['global',4],'*choose().second':['global',4]},['*choose().second']);
  assert.equal(r.trace.events.filter(e=>e.kind==='FLOW'&&e.action==='call'&&e.callee==='@choose').length,1);
  const selected=r.observations.plan.instructions.filter(o=>o.addressBinding)
    .map(o=>r.nodes.get(o.addressBinding.nodeId)).filter(n=>targetLabel(n)?.endsWith('.second'));
  assert.equal(new Set(selected.map(n=>n.nodeId)).size,1);
});
