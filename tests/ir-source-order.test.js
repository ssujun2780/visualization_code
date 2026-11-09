import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {recordIR} from '../scripts/model/ir-record.mjs';

test('No1 follows declaration, initializer, next declaration in public IR',async()=>{
  const filename='examples/c/blind/No1.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
  const {plan,trace,stdout,observations}=await traceModel(source,{filename,includeObservations:true});
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,0);
  const definitions=new Map(plan.instructions.map(i=>[i.id,i]));
  const locals=trace.objects.filter(o=>o.storage==='automatic');
  const localIds=new Set(locals.map(o=>o.id));
  assert.equal(locals.length,6);assert.ok(locals.every(o=>o.name));
  const sequence=trace.events.filter(e=>['SPACE','READ','WRITE','CALC'].includes(e.kind)&&
    definitions.get(e.instructionId)?.source?.line>=4&&definitions.get(e.instructionId)?.source?.line<=12)
    .map(e=>[definitions.get(e.instructionId).source.line,e.kind,e.value?.decimal??null]);
  assert.deepEqual(sequence,[
    [4,'SPACE',null],[4,'WRITE','10'],[5,'SPACE',null],[5,'WRITE','20'],
    [6,'SPACE',null],[6,'READ','10'],[6,'READ','20'],[6,'CALC','50'],[6,'WRITE','50'],
    [7,'SPACE',null],[7,'READ','10'],[7,'READ','20'],[7,'CALC','60'],[7,'WRITE','60'],
    [8,'SPACE',null],[8,'READ','60'],[8,'CALC','8'],[8,'WRITE','8'],
    [9,'SPACE',null],[9,'READ','60'],[9,'CALC','4'],[9,'WRITE','4'],
    [11,'READ','50'],[11,'READ','60'],[11,'CALC','-10'],[11,'WRITE','-10'],
    [12,'READ','-10'],[12,'READ','8'],[12,'READ','4'],[12,'CALC','-6'],[12,'WRITE','-6']
  ]);
  const writes=trace.events.filter(e=>e.action==='write');assert.equal(writes.length,8);
  assert.equal(writes[0].inputs[0].value.literal,'10');
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  const rawEvents=new Map(observations.trace.events.map(e=>[e.eventId,e]));
  for(const e of trace.events){
    for(const key of ['dataInputs','addressInputs','controlInputs'])for(const id of e[key])assert.ok(positions.get(id)<positions.get(e.eventId));
    if(e.kind==='SPACE'&&e.action==='object.begin'&&localIds.has(e.objectId)){
      assert.equal(rawEvents.get(e.declarationObservationId).action,'declaration');
      assert.equal(rawEvents.get(e.storageObservationId).action,'object.begin');
      assert.equal(rawEvents.get(e.declarationObservationId).objectId,e.objectId);
    }
    if(e.action==='read'&&localIds.has(e.target?.objectId)){
      const prior=writes.filter(w=>w.target.objectId===e.target.objectId&&positions.get(w.eventId)<positions.get(e.eventId)).at(-1);
      assert.ok(e.dataInputs.includes(prior.eventId));assert.equal(e.value.decimal,prior.value.decimal);
    }
  }
  assert.ok(observations.trace.objects.some(o=>o.storage==='automatic'&&!o.name),'raw compiler evidence retained');
  assert.deepEqual(trace.coverage.irGaps,[]);
  assert.deepEqual(new Set(trace.events.at(-1).endedObjects),localIds);
  assert.equal(stdout,'-10 -6 50 60 8 4\n');
  const outputs=trace.events.filter(e=>e.action==='output');
  assert.equal(outputs.length,1);assert.equal(outputs[0].text,stdout);
  const rawOutputs=observations.trace.events.filter(e=>e.action==='output');
  assert.deepEqual(outputs[0].observationIds,rawOutputs.map(e=>e.eventId));
  assert.equal(outputs[0].streamOffset,0);assert.equal(outputs[0].byteLength,Buffer.byteLength(stdout));
  const call=trace.events.find(e=>e.action==='call'&&e.callee==='@printf');
  assert.equal(outputs[0].callExecutionId,call.eventId);
  assert.deepEqual(trace.events.slice(positions.get(call.eventId)).map(e=>e.action),
    ['call','output','resume','return.value','return','frame.end']);
});

test('No2 keeps each expression and printf output at its source statement',async()=>{
  const filename='examples/c/blind/No2.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
  const {plan,trace,stdout,observations}=await traceModel(source,{filename,includeObservations:true});
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,0);assert.deepEqual(trace.coverage.irGaps,[]);
  const definitions=new Map(plan.instructions.map(i=>[i.id,i])),line=e=>definitions.get(e.instructionId)?.source?.line;
  const calcs=trace.events.filter(e=>e.kind==='CALC');
  // Constant-folded C conversions and unary minus are source calculations too
  // (the common folded-calculation path added with the type-query work).
  assert.deepEqual(calcs.map(e=>[line(e),e.value.decimal]),[[5,'250'],[6,'10'],[7,'260'],[8,'4'],[10,'-3'],[12,'4294967295'],[13,'0'],[16,'4'],[19,'1']]);
  for(const at of [5,6,10])assert.equal(definitions.get(calcs.find(e=>line(e)===at).instructionId).evidence,'compiler-folded source calculation');
  for(const at of [13,19]){
    const calc=calcs.find(e=>line(e)===at),comparison=calc.steps.filter(s=>s.operator==='<');
    assert.equal(comparison.length,1);assert.equal(comparison[0].value.cType.name,'int');
    assert.equal(comparison[0].value.type,'i32');assert.equal(comparison[0].observationIds.length,2);
    assert.equal(calc.steps.filter(s=>s.conversion).length,1,'C signedness conversion remains visible');
    assert.equal(calc.steps.find(s=>s.conversion).conversion.sameWidth,true);
  }
  assert.equal(calcs.find(e=>line(e)===12).steps[0].value.decimal,'4294967293');
  assert.equal(calcs.find(e=>line(e)===8).steps[0].conversion.explicit,true);
  const texts=['260\n','4\n','4294967295\n','0\n','1\n','4294967295\n'];
  const outputs=trace.events.filter(e=>e.action==='output');assert.deepEqual(outputs.map(e=>e.text),texts);
  assert.equal(stdout,texts.join(''));
  for(const [i,output] of outputs.entries()){
    assert.equal(line(output),15+i);assert.equal(output.outputOrigin,'delivery-attributed');
    const index=trace.events.indexOf(output),call=trace.events[index-1],resume=trace.events[index+1];
    assert.equal(call.action,'call');assert.equal(resume.action,'resume');
    assert.equal(line(call),15+i);assert.equal(line(resume),15+i);
    assert.equal(output.callExecutionId,call.eventId);assert.equal(resume.callExecutionId,call.eventId);
    assert.equal(resume.value.decimal,String(Buffer.byteLength(texts[i])));
    assert.equal(output.bytesHex,Buffer.from(texts[i]).toString('hex'));
  }
  assert.deepEqual(trace.events.slice(-3).map(e=>e.action),['return.value','return','frame.end']);
  assert.equal(trace.events.at(-1).endedObjects.length,8);
  assert.equal(trace.events.filter(e=>e.action==='read').length,13);
  assert.equal(trace.events.filter(e=>e.action==='write').length,8);
  const deliveries=observations.trace.events.filter(e=>e.action==='output.delivery');
  assert.equal(Buffer.concat(deliveries.map(e=>Buffer.from(e.bytesHex,'hex'))).toString(),stdout);
  assert.equal(deliveries.at(-1).callEventId,null,'libc may still flush after main returns');
  assert.equal(trace.coverage.stdioOutput[0].deliveryPrefixMatches,true);
});

// Small observation fixtures test ordering without introducing more blind C
// examples. Source positions intentionally do not determine execution order.
function fixture(){
  const instructions=[],ops=[],bindings={};
  for(const name of ['a','b']){
    instructions.push({id:'box-'+name,kind:'SPACE',action:'object.begin',source:{line:1}},
      {id:'write-'+name,kind:'WRITE',action:'write',source:{line:1}});
    ops.push({id:'alloc-'+name,action:'object.begin',result:'%'+name,type:'i32'},
      {id:'decl-'+name,action:'source.declaration',pointer:{value:'%'+name}},
      {id:'store-'+name,action:'store',pointer:{value:'%'+name},inputs:[{type:'i32',value:name==='a'?'10':'20'}]});
    bindings['alloc-'+name]={roles:{'SPACE:object.begin':'box-'+name},declarationObservationId:'decl-'+name};
    bindings['decl-'+name]={roles:{'SPACE:declaration':'box-'+name},sourceDeclaration:true};
    bindings['store-'+name]={roles:{WRITE:'write-'+name}};
  }
  const plan={schemaVersion:3,instructions,bindings,processInstructions:{},coverage:{}},observations={instructions:ops};
  const raw={events:[],objects:[],views:[],coverage:{},status:'completed'};
  const add=(instructionId,kind,action,fields={},activationId='f1')=>{
    const e={eventId:'e'+(raw.events.length+1),instructionId,kind,action,activationId,...fields};raw.events.push(e);return e;
  };
  const allocate=(name,id=name,activationId='f1')=>{
    const e=add('alloc-'+name,'SPACE','object.begin',{objectId:id,size:4,storage:'automatic',initialized:false},activationId);
    raw.objects.push({id,name,size:4,storage:'automatic',createdBy:e.eventId});return e;
  };
  const declare=(name,id=name,activationId='f1')=>add('decl-'+name,'SPACE','declaration',{objectId:id},activationId);
  const write=(name,id=name,activationId='f1')=>add('store-'+name,'WRITE',undefined,
    {phase:'commit',target:{objectId:id,offset:0,size:4},value:{type:'i32',signed:name==='a'?'10':'20'}},activationId);
  return {plan,observations,raw,allocate,declare,write,record:()=>recordIR(plan,observations,raw)};
}

test('same-line declarations follow observed entry, not storage or source sorting',()=>{
  const f=fixture();f.allocate('a');f.allocate('b');f.declare('b');f.write('b');f.declare('a');f.write('a');
  const before=JSON.stringify(f.raw),trace=f.record();
  assert.deepEqual(trace.events.map(e=>e.instructionId),['box-b','write-b','box-a','write-a']);
  assert.equal(JSON.stringify(f.raw),before,'normalization must not mutate observations');
});

test('uninitialized declarations appear, but unreached declarations do not',()=>{
  const f=fixture();f.allocate('a');f.allocate('b');f.declare('a');
  const trace=f.record();assert.deepEqual(trace.objects.map(o=>o.name),['a']);
  assert.deepEqual(trace.events.map(e=>e.instructionId),['box-a']);
  assert.equal(trace.events[0].initialized,false);assert.equal(trace.coverage.sourceOrder.unreachedDeclarations,1);
});

test('recursive activations keep their own deferred storage',()=>{
  const f=fixture();f.allocate('a','outer','f1');f.declare('a','outer','f1');
  f.allocate('a','inner','f2');f.declare('a','inner','f2');f.write('a','inner','f2');f.write('a','outer','f1');
  const trace=f.record();
  assert.deepEqual(trace.events.map(e=>[e.kind,e.objectId??e.target.objectId,e.activationId]),[
    ['SPACE','outer','f1'],['SPACE','inner','f2'],['WRITE','inner','f2'],['WRITE','outer','f1']]);
});

test('access after a bypassed declaration is visible with an explicit coverage gap',()=>{
  const f=fixture();f.allocate('a');f.allocate('b');f.write('b');
  const trace=f.record();assert.deepEqual(trace.events.map(e=>e.instructionId),['box-b','write-b']);
  assert.equal(trace.events[0].declarationObservationId,undefined);
  assert.deepEqual(trace.coverage.irGaps,['declaration-boundary-not-observed:b']);
});

test('repeated declaration markers alone do not invent a new object lifetime',()=>{
  const f=fixture();f.allocate('a');f.declare('a');f.write('a');f.declare('a');f.write('a');
  const trace=f.record();assert.equal(trace.events.filter(e=>e.kind==='SPACE').length,1);
  assert.equal(trace.coverage.sourceOrder.declarationReentries.length,1);
});
