import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recordIR} from '../scripts/model/ir-record.mjs';

// Observation fixtures exercise output boundaries without adding blind C cases.
function fixture(){
  const plan={schemaVersion:3,instructions:[
    {id:'call',kind:'FLOW',action:'call'}, {id:'resume',kind:'FLOW',action:'resume'},
    {id:'output',kind:'WRITE',action:'output'}, {id:'error',kind:'ERROR',action:'fault'}
  ],bindings:{printf:{roles:{'FLOW:call.begin':'call','FLOW:call.end':'resume'}}},
    processInstructions:{'WRITE:output':'output','ERROR:fault':'error'},coverage:{}};
  const observations={instructions:[{id:'printf',action:'call',callee:'@printf',args:[],inputs:[],result:'%result'}]};
  const raw={events:[],status:'completed',coverage:{}},offsets={stdout:0,stderr:0};
  let callEventId=null;
  const add=(kind,action,fields={})=>{
    const e={eventId:'e'+(raw.events.length+1),instructionId:'printf',activationId:'f1',kind,action,...fields};
    raw.events.push(e);return e;
  };
  return {raw,
    call:()=>{const e=add('FLOW','call.begin',{callee:'@printf',arguments:[]});callEventId=e.eventId;return e;},
    output:(text,fields={})=>{
      const channel=fields.channel??'stdout',byteLength=Buffer.byteLength(text),streamOffset=offsets[channel];
      const e=add('WRITE','output',{text,channel,byteLength,streamOffset,callEventId,...fields});
      offsets[channel]=e.streamOffset+e.byteLength;return e;
    },
    resume:fields=>add('FLOW','call.end',{callEventId,value:{signed:'0'},...fields}),
    error:()=>{raw.status='fault';return add('ERROR','fault',{instructionId:null,diagnostic:{code:'test-stop'}});},
    record:()=>recordIR(plan,observations,raw)};
}

test('one output action preserves Unicode, newline, NUL, bytes and all observation references',()=>{
  const f=fixture();f.call();const a=f.output('안녕'),b=f.output('\0하세요'),c=f.output('\n');
  f.resume({dataInputs:[c.eventId]});const before=JSON.stringify(f.raw),trace=f.record();
  assert.deepEqual(trace.events.map(e=>e.action),['call','output','resume']);
  const output=trace.events[1];assert.equal(output.text,'안녕\0하세요\n');
  assert.equal(output.byteLength,Buffer.byteLength(output.text));assert.equal(output.streamOffset,0);
  assert.deepEqual(output.observationIds,[a.eventId,b.eventId,c.eventId]);
  assert.equal(output.callExecutionId,trace.events[0].eventId);
  assert.deepEqual(trace.events[2].dataInputs,[output.eventId]);
  assert.equal(JSON.stringify(f.raw),before,'original stream observations remain unchanged');
});

test('separate executions of the same printf site stay separate',()=>{
  const f=fixture();f.call();f.output('A');f.output('\n');f.resume();
  f.call();f.output('B');f.output('\n');f.resume();const trace=f.record();
  assert.deepEqual(trace.events.map(e=>e.action),['call','output','resume','call','output','resume']);
  const outputs=trace.events.filter(e=>e.action==='output');assert.deepEqual(outputs.map(e=>e.text),['A\n','B\n']);
  assert.notEqual(outputs[0].callExecutionId,outputs[1].callExecutionId);
  assert.deepEqual(outputs.map(e=>e.streamOffset),[0,2]);
});

test('different streams, offset gaps, activations and unknown ownership are not merged',()=>{
  for(const fields of [{channel:'stderr'},{streamOffset:10},{activationId:'f2'},{callEventId:null},{callEventId:'unknown'}]){
    const f=fixture();f.call();f.output('A');f.output('B',fields);f.resume();
    assert.deepEqual(f.record().events.filter(e=>e.action==='output').map(e=>e.text),['A','B'],JSON.stringify(fields));
  }
  const f=fixture();f.output('A');f.output('B');
  assert.equal(f.record().events.length,2,'two unattributed chunks must not imply a source call');
});

test('intervening work and failures retain their positions and actual output prefix',()=>{
  const f=fixture();f.call();f.output('A');f.output('B');f.resume();f.output('C');
  assert.deepEqual(f.record().events.map(e=>e.action),['call','output','resume','output']);
  const failed=fixture();failed.call();failed.output('partial');failed.output(' text');failed.error();
  const trace=failed.record();assert.equal(trace.status,'fault');
  assert.deepEqual(trace.events.map(e=>e.action),['call','output','fault']);
  assert.equal(trace.events[1].text,'partial text');
});

test('stdio bytes stay inside their call while physical delivery remains raw evidence',()=>{
  const f=fixture();f.call();
  // UTF-8 can be split between library writes, so merge bytes before decoding.
  const bytes=Buffer.from('한\n');
  const a=f.output('',{outputOrigin:'stdio',bytesHex:bytes.subarray(0,1).toString('hex'),byteLength:1});
  f.raw.events.push({eventId:'delivery1',kind:'WRITE',action:'output.delivery',channel:'stdout',bytesHex:bytes.toString('hex')});
  const b=f.output('',{outputOrigin:'stdio',bytesHex:bytes.subarray(1).toString('hex'),byteLength:bytes.length-1});
  f.resume();const before=JSON.stringify(f.raw),trace=f.record();
  assert.deepEqual(trace.events.map(e=>e.action),['call','output','resume']);
  assert.equal(trace.events[1].text,'한\n');assert.equal(trace.events[1].bytesHex,bytes.toString('hex'));
  assert.deepEqual(trace.events[1].observationIds,[a.eventId,b.eventId]);
  assert.deepEqual(trace.coverage.irGaps,[]);assert.equal(trace.coverage.stdioOutput[0].deliveryPrefixMatches,true);
  assert.equal(JSON.stringify(f.raw),before);
});

test('delivery-only output is preserved and mixed unobserved writes report a gap',()=>{
  const delivery={eventId:'delivery',kind:'WRITE',action:'output.delivery',channel:'stdout',text:'AB',bytesHex:'4142',byteLength:2,streamOffset:0};
  const only=fixture();only.raw.events.push(delivery);
  assert.equal(only.record().events[0].text,'AB');
  assert.equal(only.record().events[0].outputOrigin,'delivery-only');
  const mixed=fixture();mixed.call();mixed.output('A',{outputOrigin:'stdio',bytesHex:'41'});mixed.resume();mixed.raw.events.push(delivery);
  const trace=mixed.record();assert.deepEqual(trace.coverage.irGaps,['unattributed-stdio-delivery:stdout']);
  assert.equal(trace.coverage.stdioOutput[0].deliveryPrefixMatches,false);
  const outputs=trace.events.filter(e=>e.action==='output');
  assert.deepEqual(outputs.map(e=>e.text),['A','B'],'retain the unmatched delivered suffix');
  assert.equal(outputs[1].callExecutionId,undefined,'do not invent ownership for the extra bytes');
});

test('unbound observations are disclosed rather than silently counted as processed',()=>{
  const f=fixture();f.call();f.resume();
  f.raw.events.push({eventId:'lost',instructionId:'missing',kind:'READ',phase:'commit',value:{signed:'4'}});
  const trace=f.record();assert.ok(trace.coverage.irGaps.includes('observations-without-disposition'));
  assert.deepEqual(trace.coverage.observationAccounting.unexplained.map(e=>e.eventId),['lost']);
});
