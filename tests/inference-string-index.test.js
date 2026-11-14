import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStringComparisonReader} from '../scripts/inference/string-comparison.mjs';

function fixture({callee='@strcmp',bound,byte=65}={}){
 const type={kind:'array',sizeBits:32,elementType:{sizeBits:8}},argument={nodeId:'array',cType:type,children:[{nodeId:'b'},{nodeId:'c'}]},
  plan={instructions:[{id:'compare',external:true,arguments:[argument,argument]},{id:'ib',sourceNodeId:'b'},{id:'ic',sourceNodeId:'c'}]},
  read=(eventId,instructionId,activationId='f')=>({eventId,instructionId,activationId,kind:'READ'}),
  call={eventId:'call',instructionId:'compare',activationId:'f',callee,inputs:[0,1].map(parameterIndex=>({parameterIndex,value:{address:'1000',cType:{kind:'pointer'}}}))},
  resume={eventId:'resume',action:'resume',callExecutionId:'call',activationId:'f',readRegions:[{objectId:'bytes',address:1000,offset:0,size:4}]};
 if(bound)call.inputs.push({parameterIndex:2,...bound});
 const trace={events:[read('first-c','ic'),read('b','ib'),read('latest-c','ic'),read('recursive-b','ib','nested'),call,read('future-b','ib'),resume]},
  flow={reads:()=>[]},memory={pos:new Map(trace.events.map((e,i)=>[e.eventId,i])),snapshot:()=>({}),bytesKey:(_policy,range)=>({range:{...range,size:2},payload:[byte,0]})};
 return {plan,trace,flow,memory,resume,call};
}
test('indexed inline operands keep latest prior reads in first-observation order and exact activation',()=>{
 const f=fixture(),original=JSON.stringify({plan:f.plan,trace:f.trace}),read=createStringComparisonReader(f.plan,f.trace,f.flow,f.memory),result=read(f.resume);
 for(const arg of result.args){assert.deepEqual(arg.event.addressInputs,['latest-c','b']);assert.deepEqual(arg.event.keyPayload,[65,0]);assert.equal(arg.event.stringKey.storage,'inline');}
 assert.equal(result.comparison.callExecutionId,'call');assert.equal(result.comparison.returnExecutionId,'resume');
 assert.equal(read(f.resume),result);assert.equal(JSON.stringify({plan:f.plan,trace:f.trace}),original);
});
test('string indexes and cached failures are isolated to each inference run',()=>{
 const a=fixture({callee:'@unrelated'}),b=fixture({byte:90});
 assert.equal(createStringComparisonReader(a.plan,a.trace,a.flow,a.memory)(a.resume),null);
 const result=createStringComparisonReader(b.plan,b.trace,b.flow,b.memory)(b.resume);assert.deepEqual(result.args[0].event.keyPayload,[90,0]);
 const c=fixture({byte:66});assert.deepEqual(createStringComparisonReader(c.plan,c.trace,c.flow,c.memory)(c.resume).args[0].event.keyPayload,[66,0]);
});
test('indexed string reads preserve external-call and constant-bound evidence requirements',()=>{
 const accepted=fixture({callee:'@strncmp',bound:{value:{literal:2}}});
 assert.equal(createStringComparisonReader(accepted.plan,accepted.trace,accepted.flow,accepted.memory)(accepted.resume).comparison.byteLimit,2);
 const dynamic=fixture({callee:'@memcmp',bound:{executionId:'b',value:{literal:2}}});
 assert.equal(createStringComparisonReader(dynamic.plan,dynamic.trace,dynamic.flow,dynamic.memory)(dynamic.resume),null);
 const internal=fixture();internal.call.resolvedFunctionId='user-function';
 assert.equal(createStringComparisonReader(internal.plan,internal.trace,internal.flow,internal.memory)(internal.resume),null);
});
