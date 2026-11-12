import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parallelArrayStructures,validateParallelArrayStructures} from '../scripts/inference/parallel-array-views.mjs';
const integer={sizeBits:32,signedness:'signed'},value=n=>({decimal:String(n),bits:`0x${BigInt.asUintN(32,BigInt(n)).toString(16)}`,cType:integer}),
  target=(objectId,index)=>({objectId,offset:index*4,size:4}),
  array=(id,capacity)=>({id:`array:${id}`,kind:'array',objectId:id,range:{objectId:id,offset:0,size:capacity*4},
    storageIdentity:`storage:${id}:0:${capacity*4}`,capacity,elementBytes:4,elementType:integer,nodes:[]}),
  read=(id,objectId,index,n,dataInputs=[],addressInputs=[])=>({eventId:id,kind:'READ',action:'read',activationId:'caller',target:target(objectId,index),value:value(n),dataInputs,addressInputs}),
  write=(id,objectId,index,n,dataInputs=[],addressInputs=[])=>({...read(id,objectId,index,n,dataInputs,addressInputs),kind:'WRITE',action:'write'}),
  calc=(id,operator,dataInputs,n)=>({eventId:id,kind:'CALC',action:'expression',activationId:'caller',operator,dataInputs,value:value(n)});
function fixture({capacity=3,metadataCapacity=5,graph=true,second=false}={}){
  const domain=array('links',capacity),metadata=array('weights',metadataCapacity),structures=[domain,metadata],events=[],
    add=e=>(events.push(e),e.eventId);
  for(const id of ['links','weights'])add({eventId:`begin:${id}`,kind:'SPACE',action:'object.begin',objectId:id});
  for(let index=0;index<capacity;index++)add(write(`init:links:${index}`,'links',index,index));
  for(let index=0;index<metadataCapacity;index++)add(write(`init:weights:${index}`,'weights',index,index<2?1:9));
  add(read('origin:0','links',0,0,['init:links:0']));add(read('origin:1','links',1,1,['init:links:1']));
  add(write('save:0','local0',0,0,['origin:0']));add(write('save:1','local1',0,1,['origin:1']));
  add(read('index:0','local0',0,0,['save:0']));add(read('index:1','local1',0,1,['save:1']));
  function aggregate(id,base){
    add(read(`left:${id}`,id,0,base,[`init:${id}:0`],['index:0']));
    add(read(`right:${id}`,id,1,base,[`init:${id}:1`],['index:1']));
    add(calc(`compare:${id}`,'<',[`left:${id}`,`right:${id}`],0));
    if(id==='weights')add(write('link:update','links',1,0,['index:0'],['index:1']));
    add(read(`sum-left:${id}`,id,0,base,[`init:${id}:0`],['index:0']));
    add(read(`sum-right:${id}`,id,1,base,[`init:${id}:1`],['index:1']));
    add(calc(`sum:${id}`,'+=',[`sum-left:${id}`,`sum-right:${id}`],base*2));
    add(write(`update:${id}`,id,0,base*2,[`sum:${id}`],['index:0']));
  }
  aggregate('weights',1);
  if(second){structures.push(array('other',capacity+1));add({eventId:'begin:other',kind:'SPACE',action:'object.begin',objectId:'other'});
    for(let index=0;index<capacity+1;index++)add(write(`init:other:${index}`,'other',index,10));aggregate('other',10);}
  if(graph)structures.push({id:'graph:links',kind:'value-index-graph-candidate',arrayId:domain.id,storageIdentity:domain.storageIdentity,
    states:[{afterExecutionId:'origin:1',alive:true,topology:{complete:false},nodes:[{index:0,value:0},{index:1,value:1}],
      representatives:[{index:0,rootIndex:0},{index:1,rootIndex:1}]},
      {afterExecutionId:'link:update',alive:true,topology:{complete:false},nodes:[{index:0,value:0},{index:1,value:0}],
        representatives:[{index:0,rootIndex:0},{index:1,rootIndex:0}]}]});
  const plan={instructions:[{id:'unused-second',functionId:'later'},{id:'unused-first',functionId:'earlier'}]},
    input={events,objects:structures.filter(s=>s.kind==='array').map(a=>({id:a.objectId,size:a.range.size})),structures,resultDeliveries:[]};
  return {plan,input,build:()=>parallelArrayStructures(plan,input)};
}

test('actual index provenance joins unequal arrays and preserves link-before-sum and retained nonroot values',()=>{
  const f=fixture(),before=JSON.stringify(f.input),[s]=f.build();assert.ok(s);assert.equal(f.build().length,1);
  assert.equal(s.capacity,5);assert.equal(s.indexDomain.capacity,3);assert.equal(s.cardinality,'unconfirmed');
  assert.equal(s.evidenceCounts.comparisons,1);assert.equal(s.evidenceCounts.aggregations,1);
  const interim=s.states.find(x=>x.afterExecutionId==='link:update'),complete=s.states.find(x=>x.afterExecutionId==='update:weights');
  assert.equal(interim.status,'intermediate');assert.deepEqual(interim.pendingAggregationExecutionIds,['update:weights']);
  assert.equal(interim.nodes.find(n=>n.index===0).value,1);assert.equal(interim.nodes.find(n=>n.index===0).knownMemberCount,2);
  assert.equal(interim.nodes.find(n=>n.index===0).cardinalityCorrespondence,'unconfirmed');
  assert.equal(complete.nodes.find(n=>n.index===0).value,2);assert.equal(complete.nodes.find(n=>n.index===0).cardinalityCorrespondence,'observed-count-match');
  assert.equal(complete.nodes.find(n=>n.index===0).countScope,'known-members-only');
  assert.equal(complete.nodes.find(n=>n.index===1).role,'nonrepresentative-retained');assert.equal(complete.nodes.find(n=>n.index===1).value,1);
  assert.equal(complete.nodes.find(n=>n.index===2).knownMemberCount,undefined);assert.equal(JSON.stringify(f.input),before);
  validateParallelArrayStructures({...f.input,structures:[...f.input.structures,s]});
});

test('multiple metadata arrays and changed capacities/function order retain separate generic candidates',()=>{
  const f=fixture({capacity:4,metadataCapacity:6,second:true}),expected=f.build();f.plan.instructions.reverse();
  assert.deepEqual(f.build(),expected);assert.equal(expected.length,2);
  assert.deepEqual(expected.map(s=>s.objectId),['weights','other']);assert.equal(expected[1].states.at(-1).nodes[0].value,20);
  const generic=fixture({graph:false}).build()[0];assert.equal(generic.indexGraphId,undefined);
  assert.ok(generic.states.at(-1).nodes.every(n=>n.role==='unconfirmed'&&n.knownMemberCount===undefined));
});

test('metadata index follows the actual returned array read across a dynamic call',()=>{
  const f=fixture(),at=f.input.events.findIndex(e=>e.eventId==='origin:1'),origin=f.input.events[at];origin.activationId='callee';
  const call={eventId:'call',kind:'FLOW',action:'call',activationId:'caller',inputs:[]},
    returned={eventId:'returned',kind:'WRITE',action:'return.value',activationId:'callee',callExecutionId:'call',dataInputs:['origin:1'],value:value(1)},
    boundary={eventId:'boundary',kind:'FLOW',action:'return',activationId:'callee',callExecutionId:'call'},
    resume={eventId:'resume',kind:'FLOW',action:'resume',activationId:'caller',callExecutionId:'call',returnExecutionId:'boundary',dataInputs:['returned'],value:value(1)};
  f.input.events.splice(at,1,call,origin,returned,boundary,resume);
  f.input.events.find(e=>e.eventId==='save:1').dataInputs=['resume'];
  f.input.resultDeliveries=[{callExecutionId:'call',resumeExecutionId:'resume',returnExecutionId:'boundary',returnValueExecutionId:'returned',callerActivationId:'caller'}];
  const s=f.build()[0];assert.ok(s);assert.ok(s.associations.some(a=>a.sourceReadExecutionId==='origin:1'&&a.index===1));
  f.input.resultDeliveries=[];assert.deepEqual(f.build(),[]);
});

test('equal lengths, ones, a suggestive name, or a single associated access do not establish metadata',()=>{
  const f=fixture({metadataCapacity:3});f.input.structures[1].name='size';
  for(const e of f.input.events)if(e.target?.objectId==='weights')e.addressInputs=[];
  assert.deepEqual(f.build(),[]);
  const onlyOne=fixture();onlyOne.input.events=onlyOne.input.events.filter(e=>!e.eventId.startsWith('sum')&&!e.eventId.startsWith('update:'));
  assert.deepEqual(onlyOne.build(),[]);
});

test('an arithmetic index with an incidentally unchanged result is not preserved provenance',()=>{
  const f=fixture(),at=f.input.events.findIndex(e=>e.eventId==='left:weights');
  f.input.events.splice(at,0,calc('changed:0','+',['index:0'],0),calc('changed:1','+',['index:1'],1));
  for(const e of f.input.events)if(e.target?.objectId==='weights')e.addressInputs=e.addressInputs?.map(id=>id.replace('index:','changed:'));
  assert.deepEqual(f.build(),[]);
});

test('an extra arithmetic step or literal is not simplified into a binary aggregation',()=>{
  for(const changed of [
    {inputs:[{executionId:'sum-left:weights'},{executionId:'sum-right:weights'},{value:value(0)}]},
    {steps:[{operator:'+',inputs:[{executionId:'sum-left:weights'},{executionId:'sum-right:weights'}]},
      {operator:'-',inputs:[{value:value(2)},{value:value(0)}]}]}
  ]){const f=fixture();Object.assign(f.input.events.find(e=>e.eventId==='sum:weights'),changed);assert.deepEqual(f.build(),[]);}
});

test('unknown and recovered partial bytes replace prior metadata without inventing full observations',()=>{
  const f=fixture();f.input.events.push({eventId:'unknown',kind:'WRITE',target:{objectId:'weights',offset:0,size:1},
    memoryState:{byteLength:1,ranges:[{offset:0,length:1,initialization:'unknown'}]}},
    {eventId:'recover',kind:'WRITE',target:{objectId:'weights',offset:0,size:1},value:{bits:'0x03'}},
    {eventId:'end',kind:'SPACE',action:'object.end',objectId:'weights'});
  const s=f.build()[0];assert.equal(s.states.find(x=>x.afterExecutionId==='unknown').nodes[0].value,null);
  assert.equal(s.states.find(x=>x.afterExecutionId==='recover').nodes[0].value,3);assert.equal(s.states.at(-1).status,'ended');
});

test('validator rejects fabricated storage and evidence without treating a retained value as an error',()=>{
  const f=fixture(),s=f.build()[0],trace={...f.input,structures:[...f.input.structures,s]};
  s.associations[0].index=99;assert.throws(()=>validateParallelArrayStructures(trace),/관측 저장/);
});

test('frame end and recorded object lifetime close automatic metadata storage',()=>{
  for(const useEndedBy of [true,false]){
    const f=fixture(),object=f.input.objects.find(o=>o.id==='weights');
    Object.assign(object,{storage:'automatic',frameId:'caller',createdBy:'begin:weights',...(useEndedBy?{endedBy:'frame:end'}:{})});
    f.input.events.push({eventId:'frame:end',kind:'SPACE',action:'frame.end',frameId:'caller'});
    const s=f.build()[0],last=s.states.at(-1);assert.equal(last.afterExecutionId,'frame:end');assert.equal(last.alive,false);
    assert.equal(last.status,'ended');assert.ok(last.nodes.every(n=>n.status==='ended'));
    assert.equal(last.nodes.find(n=>n.index===1).value,1);assert.equal(s.classification,'candidate');assert.equal(s.intent,'unconfirmed');
    validateParallelArrayStructures({...f.input,structures:[...f.input.structures,s]});
  }
});

test('bulk snapshots keep huge metadata arrays sparse and report untracked slots',()=>{
  const f=fixture(),metadata=f.input.structures.find(s=>s.objectId==='weights'),capacity=1_000_000_000;
  metadata.capacity=capacity;metadata.range.size=capacity*4;metadata.storageIdentity=`storage:weights:0:${capacity*4}`;
  f.input.objects.find(o=>o.id==='weights').size=metadata.range.size;
  f.input.events.find(e=>e.eventId==='begin:weights').memoryState={byteLength:metadata.range.size,
    ranges:[{offset:0,length:metadata.range.size,initialization:'initialized',data:{encoding:'fill',byte:0}}]};
  const s=f.build()[0],last=s.states.at(-1);
  assert.ok(s.states.every(state=>state.nodes.length<=5));assert.equal(last.trackedSlotCount,5);
  assert.equal(last.untrackedSlotCount,capacity-5);assert.equal(last.unknownSlotCount,capacity-5);assert.equal(last.status,'partial');
  assert.equal(last.nodes.find(n=>n.index===1).value,1);
  validateParallelArrayStructures({...f.input,structures:[...f.input.structures,s]});
  f.input.events.push({eventId:'bulk:unknown',kind:'WRITE',target:{objectId:'weights',offset:0,size:metadata.range.size}});
  const unknown=f.build()[0].states.at(-1);assert.equal(unknown.nodes.length,5);
  assert.equal(unknown.unknownSlotCount,capacity);assert.ok(unknown.nodes.every(n=>n.value===null));
});
