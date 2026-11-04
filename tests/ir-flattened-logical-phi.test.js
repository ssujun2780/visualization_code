import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const definitions=new Map(r.plan.instructions.map(i=>[i.id,i])),positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of r.trace.events)for(const input of e.inputs??[])if(input.executionId)
    assert.ok(positions.get(input.executionId)<positions.get(e.eventId));
  return {...r,definitions,positions};
}

test('a flattened loop condition completes after its last actual read on every iteration',async()=>{
  const r=await inspect(`int scan(const char *s,int n){int i=0;
    while(i<n && s[i]!='|' && s[i]!=')')i++;return i;}
    int main(void){return scan("ab",2)+scan("a|c",3)+scan("a)c",3)-4;}`);
  const root=r.plan.evaluations.find(e=>e.left.nodeId===r.plan.evaluations[1]?.nodeId),
    results=r.trace.events.filter(e=>e.kind==='CALC'&&e.evaluation?.nodeId===root.nodeId);
  assert.deepEqual(results.map(e=>e.value.decimal),['1','1','0','1','0','1','0']);
  assert.deepEqual(results.map(e=>e.evaluation.right),['evaluated','evaluated','skipped','evaluated','skipped','evaluated','evaluated']);
  assert.ok(results.every(e=>e.evaluation.selectedPredecessor));
  const consumed=new Set();
  for(const result of results){
    for(const input of result.inputs.filter(i=>i.executionId)){
      assert.ok(!consumed.has(input.executionId),'a later iteration must not consume earlier READ values');
      consumed.add(input.executionId);
    }
  }
  const phi=r.observations.plan.instructions.find(o=>o.opcode==='phi'&&o.incoming.length>2);
  assert.equal(r.plan.bindings[phi.id].evaluation.nodeId,root.nodeId);
});

async function scalarCases(expression,cases,expectedReads,values,right){
  const calls=cases.map(args=>`pick(${args.join(',')});`).join('');
  const r=await inspect(`int pick(int a,int b,int c){while(${expression})return 1;return 0;}
    int main(void){${calls}return 0;}`);
  const frames=r.trace.frames.filter(f=>f.functionName==='pick'),results=[];
  for(const [index,frame]of frames.entries()){
    const events=r.trace.events.filter(e=>e.activationId===frame.id),reads=events.filter(e=>e.kind==='READ');
    assert.deepEqual(reads.map(e=>r.definitions.get(e.instructionId).source.expression),expectedReads[index]);
    const result=events.find(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');assert.ok(result);results.push(result);
    for(const read of reads)assert.ok(result.inputs.some(input=>input.executionId===read.eventId),'every evaluated scalar operand must remain an input');
    assert.equal(events.find(e=>e.action==='return.value').value.decimal,String(values[index]));
  }
  assert.deepEqual(results.map(e=>Number(e.value.decimal)),values);
  assert.deepEqual(results.map(e=>e.evaluation.right),right);
}

test('flattened AND and OR preserve every scalar operand and each early exit',async()=>{
  await scalarCases('a&&b&&c',[[0,1,1],[1,0,1],[1,1,0],[1,1,1]],
    [['a'],['a','b'],['a','b','c'],['a','b','c']],[0,0,0,1],['skipped','skipped','evaluated','evaluated']);
  await scalarCases('a||b||c',[[1,0,0],[0,2,0],[0,0,3],[0,0,0]],
    [['a'],['a','b'],['a','b','c'],['a','b','c']],[1,1,1,0],['skipped','skipped','evaluated','evaluated']);
});

test('mixed logical operators use the enclosing owner without evaluating skipped operands',async()=>{
  await scalarCases('(a||b)&&c',[[1,0,1],[0,0,1],[0,2,0],[0,2,1]],
    [['a','c'],['a','b'],['a','b','c'],['a','b','c']],[1,0,0,1],['evaluated','skipped','evaluated','evaluated']);
  await scalarCases('(a&&b)||c',[[0,1,1],[1,0,0],[1,2,0],[1,2,1]],
    [['a','c'],['a','b','c'],['a','b'],['a','b']],[1,0,1,1],['evaluated','evaluated','skipped','skipped']);
});
