import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createObservationResolver,createAliasResolver} from '../scripts/model/observation-dependencies.mjs';

function context(){return {rawToExecution:new Map([['read','x1']]),executions:new Map([['x1',{eventId:'x1',kind:'READ'}]]),
  aliases:new Map(),aliasRoles:new Map(),valueForwardings:new Map(),rawEvents:new Map(),eventOrder:new Map([['x1',0],['x2',1]])};}
const command=()=>({eventId:'x2',instructionId:'i2',kind:'CALC'});

test('deep shared provenance resolves once per node and role without recursion',()=>{
  const c=context();let previous='read';
  for(let i=0;i<12000;i++){const id=`e${i}`;c.aliases.set(id,[previous,previous]);previous=id;}
  const resolve=createObservationResolver(c,command());
  assert.deepEqual(resolve(previous,'dataInputs'),['x1']);
  assert.deepEqual(createAliasResolver(c.rawToExecution,c.aliases)(previous),['x1']);
});

test('hidden operations keep data, address and controlling branches distinct',()=>{
  const c=context();c.rawToExecution.set('index','x3');c.executions.set('x3',{kind:'READ'});
  c.rawToExecution.set('branch','x4');c.executions.set('x4',{kind:'FLOW',action:'branch'});
  c.aliasRoles.set('hidden',{dataInputs:['read','read'],addressInputs:['index'],controlInputs:['branch']});
  const related={},resolve=createObservationResolver(c,command());
  assert.deepEqual(resolve('hidden','dataInputs',related),['x1']);
  assert.deepEqual(related,{addressInputs:['x3'],controlInputs:['x4']});
  const next={};assert.deepEqual(resolve('hidden','controlInputs',next),['x1','x3','x4']);assert.deepEqual(next,{});
});

test('an unfinished CALC contributes observed operands and explicit partial evidence',()=>{
  const c=context(),use=command();
  c.rawToExecution.set('part','x5');c.executions.set('x5',{kind:'CALC',steps:[{observationIds:['part'],nodeId:'n5',value:{decimal:'1'}}]});
  c.eventOrder.set('x5',5);c.rawEvents.set('part',{dataInputs:['read'],addressInputs:[]});
  const resolve=createObservationResolver(c,use);
  assert.deepEqual(resolve('part','controlInputs'),['x1']);
  assert.deepEqual(use.partialCalculationInputs[0].inputExecutionIds,['x1']);
  assert.equal(use.partialCalculationInputs[0].executionId,'x5');
  resolve('part','controlInputs');assert.equal(use.partialCalculationInputs.length,1);
});

test('a broken causal cycle is diagnosed instead of discarded or recursively expanded',()=>{
  const c=context();c.aliases.set('a',['b']);c.aliases.set('b',['a']);
  assert.throws(()=>createObservationResolver(c,command())('a','dataInputs'),e=>e.code==='ir-dependency-cycle'&&e.context.instructionId==='i2');
});
