import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {traceModel} from '../scripts/model/index.mjs';
import {inferExecutionRelations,createExecutionWorkQuery} from '../scripts/execution-relations/index.mjs';

// Source-derived expectations fixed before querying the implementation. The
// first merge compares end[0]=7 to end[1]=2, then copies element 1's start.
const expected={comparisonReads:[[4,4],[12,4]],firstCopyReads:[[4,12]],firstCopyWrites:[[0,4]],
  indices:{i:'0',j:'1',k:'0'},path:['main','merge_sort','merge_sort','merge'],previousRootChildren:2};
const source=await readFile('examples/c/walkthrough/meeting_selection_fixed.c','utf8');
const sourceHash=createHash('sha256').update(source).digest('hex');
// Reuse this task's saved canonical recording; on a clean checkout generate
// only this one focused fixture. This does not rerun the example collection.
let recording,recordingOrigin='saved';
try{
  const directory='test-results/execution-relations/meeting/';
  const [original,plan,trace]=await Promise.all(['original.c','plan.json','trace.json'].map(name=>readFile(directory+name,'utf8')));
  if(createHash('sha256').update(original).digest('hex')!==sourceHash)throw new Error('fixture source changed');
  recording={plan:JSON.parse(plan),trace:JSON.parse(trace)};
}catch{recordingOrigin='generated-focused-fixture';recording=await traceModel(source,{filename:'meeting-context.c',stdin:'4\n5 7\n1 2\n3 5\n2 3\n',maxEvents:30000});}
assert.equal(recording.trace.status,'completed');
const {plan,trace}=recording,metadata=inferExecutionRelations(plan,trace),query=createExecutionWorkQuery(plan,trace,metadata),
  first=trace.frames.find(f=>f.functionName==='merge'),merges=trace.frames.filter(f=>f.functionName==='merge'),
  heap=trace.objects.filter(o=>o.storage==='heap'),src=heap[0].id,dst=heap[1].id,
  comparison=trace.events.find(e=>e.activationId===first.id&&e.kind==='CALC'&&e.operator==='<'&&
    e.inputs?.length===2&&e.inputs.every(i=>trace.events.find(p=>p.eventId===i.executionId)?.target?.objectId===src)),
  firstCopy=metadata.relations.find(r=>r.kind==='storage-copy'&&r.activationIds[0]===first.id&&r.participants[1].objectId===dst),
  ref=id=>trace.events.find(e=>e.eventId===id),ranges=rows=>rows.map(({offset,size})=>[offset,size]);

test('current comparison groups real operand ranges, live call path, scalar observations and exact source location',()=>{
  const view=query.at(comparison.eventId);
  assert.deepEqual(view.calls.stack.map(f=>f.functionName),expected.path);
  assert.equal(view.calls.currentActivationId,first.id);assert.equal(view.operation.executionId,comparison.eventId);
  assert.equal(view.operation.operator,'<');assert.deepEqual(view.operation.source,plan.instructions.find(i=>i.id===comparison.instructionId).source);
  assert.deepEqual(ranges(view.storage.find(s=>s.objectId===src).observed.readRanges),expected.comparisonReads);
  assert.deepEqual(view.operation.operands.map(i=>i.executionId),comparison.inputs.map(i=>i.executionId));
  for(const [name,value]of Object.entries(expected.indices)){
    const local=view.locals.find(o=>o.name===name);assert.ok(local);assert.equal(local.frameId,first.id);
    assert.equal(ref(local.latestObservation.executionId).value.decimal,value);
    assert.equal(local.lifetime,'live');assert.ok(!('initializationRanges'in local));assert.ok(!('endedAtExecutionId'in local));
  }
  assert.ok(view.references.filter(r=>r.role==='binding').some(r=>r.objectId===dst&&r.extent==='reference-only'));
  assert.equal(view.locals.find(o=>o.name==='left').parameter.index,1);
  assert.equal(view.locals.find(o=>o.name==='i').parameter,null);assert.equal(view.locals.find(o=>o.name==='i').inOperation,true);
  assert.deepEqual(view.history.dependencies,[]);
  assert.ok(view.relations.operationIds.length>0);
});

test('first field copy preserves the partial destination range without borrowing future writes or final call summaries',()=>{
  const view=query.at(firstCopy.writeExecutionId),from=view.storage.find(s=>s.objectId===src),to=view.storage.find(s=>s.objectId===dst);
  assert.deepEqual(ranges(from.observed.readRanges),expected.firstCopyReads);assert.deepEqual(ranges(to.observed.writeRanges),expected.firstCopyWrites);
  assert.ok(view.relations.operationIds.includes(firstCopy.id));
  assert.ok(to.focusRanges.some(r=>r.role==='write'&&r.offset===0&&r.size===4));
  assert.ok(from.focusRanges.some(r=>r.role==='read'&&r.offset===8&&r.size===4));
  const future=metadata.relations.find(r=>r.kind==='activation-range'&&r.activationIds[0]===first.id&&r.objectId===dst);
  assert.ok(!Object.values(view.relations).flat().includes(future.id));
  const futureFrame=merges[1];assert.ok(!view.calls.stack.some(f=>f.activationId===futureFrame.id));
  assert.ok(!view.history.activations.some(f=>f.activationId===futureFrame.id));
});

test('frame cleanup and final merge keep completed calls in history, not in the live stack or local boxes',()=>{
  const end=trace.events.find(e=>e.activationId===first.id&&e.action==='frame.end'),after=query.at(end.eventId);
  assert.equal(after.calls.currentActivationId,first.parent);assert.ok(after.history.activations.some(f=>f.activationId===first.id&&f.state==='ended'));
  assert.ok(!after.locals.some(o=>o.frameId===first.id));
  assert.ok(after.history.storage.some(o=>o.frameId===first.id&&o.lifetime==='ended'));
  const finalCopy=metadata.relations.find(r=>r.kind==='storage-copy'&&r.activationIds[0]===merges[2].id&&r.participants[1].objectId===dst),
    view=query.at(finalCopy.writeExecutionId),root=trace.frames.find(f=>f.functionName==='merge_sort'&&f.parent===trace.frames[0].id),
    siblings=trace.frames.filter(f=>f.functionName==='merge_sort'&&f.parent===root.id);
  assert.equal(siblings.length,expected.previousRootChildren);
  for(const f of siblings){
    assert.ok(view.history.activations.some(old=>old.activationId===f.id));assert.ok(!view.calls.stack.some(now=>now.activationId===f.id));
    const summary=metadata.relations.find(r=>r.kind==='activation-range'&&r.activationIds[0]===f.id&&r.objectId===src&&r.scope==='subtree');
    assert.ok(view.relations.historyIds.includes(summary.id));
  }
  assert.ok(view.locals.every(o=>o.frameId===merges[2].id));
});

test('free, random seeking, detached results and final snapshot changes cannot revive storage or leak future state',()=>{
  const original=JSON.stringify({plan,trace,metadata}),before=query.at(comparison.eventId),freed=query.at(heap[0].endedBy);
  assert.ok(!freed.storage.some(s=>s.objectId===src));assert.ok(freed.history.storage.some(s=>s.objectId===src&&s.lifetime==='ended'));
  assert.ok(freed.references.some(r=>r.objectId===src&&r.targetLifetime==='ended'));
  assert.deepEqual(query.at(comparison.eventId),before);
  const changed=query.at(comparison.eventId);changed.storage[0].observed.readRanges.length=0;changed.locals[0].name='changed';
  assert.deepEqual(query.at(comparison.eventId),before);assert.equal(JSON.stringify({plan,trace,metadata}),original);
  const finalChanged=structuredClone(trace);
  for(const o of finalChanged.objects){o.lifecycle='invented final state';o.initializationRanges=[{writer:trace.events.at(-1).eventId}];}
  for(const f of finalChanged.frames){f.ended=false;f.block='unrelated final block';}
  assert.deepEqual(createExecutionWorkQuery(plan,finalChanged,metadata).at(comparison.eventId),before);
  const initial=query.at(null);assert.equal(initial.phase,'before-start');assert.deepEqual(initial.calls.stack,[]);assert.deepEqual(initial.storage,[]);
  assert.throws(()=>query.at('not-a-recorded-event'),RangeError);
});

test('full-record and prefix-record queries agree before future evidence; unresolved producer references remain explicit',()=>{
  const stop=trace.events.indexOf(comparison),prefix={...trace,events:trace.events.slice(0,stop+1)},
    subset={...metadata,relations:metadata.relations.filter(r=>trace.events.findIndex(e=>e.eventId===r.availableAtExecutionId)<=stop)};
  assert.deepEqual(createExecutionWorkQuery(plan,prefix,subset).at(comparison.eventId),query.at(comparison.eventId));
  const altered=structuredClone(trace),event=altered.events[stop],future=trace.events.slice(stop+1).find(e=>e.kind==='READ');
  event.dataInputs.push(future.eventId);event.inputs.push({executionId:future.eventId,value:{decimal:'secret future value'}});
  const view=createExecutionWorkQuery(plan,altered,metadata).at(comparison.eventId);
  assert.deepEqual(view.operation.operands.at(-1),{kind:'observation',availability:'unavailable',executionId:null,observationId:null});
  assert.ok(!JSON.stringify(view).includes('secret future value'));
});

test('changing all display names and removing source-expression text leaves work identities and dependency grouping unchanged',()=>{
  const p=structuredClone(plan),t=structuredClone(trace);
  for(const i of p.instructions)if(i.source)delete i.source.expression;
  for(const o of t.objects)o.name='same-display-name';for(const f of t.frames)f.functionName='same-display-name';
  const shape=v=>({calls:v.calls.stack.map(f=>[f.activationId,f.role]),current:v.calls.currentActivationId,
    locals:v.locals.map(o=>[o.objectId,o.parameter,o.inOperation,o.latestObservation?.executionId]),
    storage:v.storage.map(o=>[o.objectId,o.observed]),references:v.references,relations:v.relations});
  assert.deepEqual(shape(createExecutionWorkQuery(p,t,metadata).at(firstCopy.writeExecutionId)),shape(query.at(firstCopy.writeExecutionId)));
});

test('pointer reassignment, unknown overwrite and one-past values do not retain an old argument binding',()=>{
  const changedPlan=structuredClone(plan),changedTrace=structuredClone(trace),slot=trace.objects.find(o=>o.frameId===first.id&&o.name==='meeting'),
    insert=changedTrace.events.findIndex(e=>e.eventId===firstCopy.writeExecutionId)+1;
  const extra=[['changed-pointer','write',{reference:{targetObjectId:dst,targetOffset:8,status:'in-bounds'}}],
    ['unknown-pointer','fill',null],['one-past-pointer','write',{reference:{targetObjectId:dst,targetOffset:heap[1].size,onePast:true,status:'one-past'}}]];
  for(const [id,action,value]of extra)changedPlan.instructions.push({id:'i-'+id,kind:'WRITE',action});
  changedTrace.events.splice(insert,0,...extra.map(([eventId,action,value])=>({eventId,instructionId:'i-'+eventId,activationId:first.id,
    kind:'WRITE',action,phase:'complete',dataInputs:[],inputs:[],target:{objectId:slot.id,offset:0,size:slot.size},...(value?{value}:{})})));
  const q=createExecutionWorkQuery(changedPlan,changedTrace,metadata),updated=q.at('changed-pointer'),unknown=q.at('unknown-pointer'),onePast=q.at('one-past-pointer'),
    originalBinding=metadata.relations.find(r=>r.kind==='pointer-argument'&&r.participants[0].objectId===slot.id);
  assert.deepEqual(updated.references.filter(r=>r.slotObjectId===slot.id&&r.role==='binding').map(r=>[r.objectId,r.offset]),[[dst,8]]);
  assert.ok(!updated.relations.contextIds.includes(originalBinding.id));assert.ok(updated.relations.historyIds.includes(originalBinding.id));
  assert.ok(!unknown.references.some(r=>r.slotObjectId===slot.id&&r.role==='binding'));
  const ref=onePast.references.find(r=>r.slotObjectId===slot.id&&r.role==='binding');
  assert.equal(ref.onePast,true);assert.equal(ref.extent,'reference-only');assert.equal(ref.offset,heap[1].size);
  assert.ok(!onePast.storage.find(o=>o.objectId===dst).focusRanges.length);
});

function returnFixture(){
  const rows=[['root','SPACE','frame.begin','m'],['call','FLOW','call','m'],['entry','SPACE','frame.begin','q'],
    ['allocated','SPACE','object.begin','q'],['saved','WRITE','write','q'],['read','READ','read','q'],
    ['returned-value','WRITE','return.value','q'],['return','FLOW','return','q'],['clean','SPACE','frame.end','q'],
    ['resume','FLOW','resume','m'],['reused','SPACE','object.begin','m'],['attempt','WRITE','write','m'],['fault','ERROR','fault','m']];
  const instructions=rows.map(([id,kind,action])=>({id:'i-'+id,kind,action,source:{file:'opaque.c',line:1,column:1}}));
  const events=rows.map(([eventId,kind,action,activationId])=>({eventId,instructionId:'i-'+eventId,kind,action,activationId,phase:'complete',dataInputs:[],inputs:[]}));
  const e=id=>events.find(e=>e.eventId===id),value={type:'i32',bits:'0x00000008',decimal:'8'};
  Object.assign(e('call'),{resolvedFunctionId:'fn-q'});
  for(const id of ['saved','read'])Object.assign(e(id),{target:{objectId:'old',offset:0,size:4},value});
  e('read').dataInputs=['saved'];Object.assign(e('returned-value'),{value,dataInputs:['read']});
  Object.assign(e('clean'),{endedObjects:['old']});Object.assign(e('resume'),{value,dataInputs:['returned-value'],callExecutionId:'call'});
  Object.assign(e('attempt'),{phase:'attempt',target:{objectId:'new',offset:0,size:4},value});e('fault').phase='fault';
  return {plan:{schemaVersion:3,programId:'opaque',instructions},trace:{schemaVersion:3,programId:'opaque',runId:'single',events,
    frames:[{id:'m',functionId:'fn-m',functionName:'same',parent:null},{id:'q',functionId:'fn-q',functionName:'same',parent:'m'}],
    objects:[{id:'old',name:'opaque',size:4,address:128,storage:'automatic',frameId:'q',createdBy:'allocated',endedBy:'clean'},
      {id:'new',name:'opaque',size:4,address:128,storage:'automatic',frameId:'m',createdBy:'reused',endedBy:null}]}};
}
test('returned values retain dead-frame provenance, reused addresses stay separate, and attempts/faults invent no completed writes',()=>{
  const {plan,trace}=returnFixture(),result=inferExecutionRelations(plan,trace),q=createExecutionWorkQuery(plan,trace,result),resume=q.at('resume');
  assert.equal(result.status,'completed');assert.equal(resume.calls.currentActivationId,'m');assert.equal(resume.operation.resultExecutionId,'resume');
  assert.ok(resume.history.dependencies.some(e=>e.executionId==='read'));
  assert.deepEqual(resume.history.storage.map(o=>o.objectId),['old']);assert.deepEqual(resume.locals,[]);assert.deepEqual(resume.storage,[]);
  const reuse=q.at('reused');assert.deepEqual(reuse.locals.map(o=>o.objectId),['new']);assert.equal(reuse.locals[0].latestObservation,null);
  const attempt=q.at('attempt');assert.equal(attempt.operation.resultExecutionId,null);assert.equal(attempt.locals[0].latestObservation,null);
  const fault=q.at('fault');assert.equal(fault.phase,'fault');assert.equal(fault.calls.currentActivationId,'m');
  assert.ok(!fault.history.storage.some(o=>o.objectId==='new'));
  assert.throws(()=>createExecutionWorkQuery(plan,trace,{...result,scope:{...result.scope,runId:'another'}}));
  const failed={...result,status:'failed',relations:[],diagnostics:[{code:'test-analysis-failed'}]};
  assert.equal(createExecutionWorkQuery(plan,trace,failed).at('resume').analysisStatus,'failed');
});

test('a recorded caller-side return delivery can coexist with a still-live callee without changing execution order',()=>{
  const {plan,trace}=returnFixture();
  const allocated={eventId:'receiver',instructionId:'i-receiver',kind:'SPACE',action:'object.begin',phase:'complete',activationId:'m',inputs:[],dataInputs:[]},
    delivered={eventId:'delivered',instructionId:'i-delivered',kind:'WRITE',action:'write',phase:'complete',activationId:'m',inputs:[],dataInputs:['returned-value'],
      target:{objectId:'output',offset:0,size:4},value:{type:'i32',bits:'0x00000008',decimal:'8'}};
  for(const e of [allocated,delivered])plan.instructions.push({id:e.instructionId,kind:e.kind,action:e.action});
  trace.events.splice(1,0,allocated);trace.events.splice(trace.events.findIndex(e=>e.eventId==='clean'),0,delivered);
  trace.objects.push({id:'output',name:'answer',storage:'automatic',frameId:'m',size:4,createdBy:'receiver',endedBy:null});
  const q=createExecutionWorkQuery(plan,trace,inferExecutionRelations(plan,trace)),view=q.at('delivered');
  assert.equal(view.calls.currentActivationId,'m');assert.deepEqual(view.calls.stack.map(f=>[f.activationId,f.role]),[['m','current'],['q','resident-callee']]);
  assert.equal(view.locals.find(o=>o.objectId==='output').latestObservation.executionId,'delivered');
  assert.ok(view.storage.some(o=>o.objectId==='old'&&o.lifetime==='live'));assert.ok(!view.history.activations.some(f=>f.activationId==='q'));
  assert.ok(q.at('clean').history.activations.some(f=>f.activationId==='q'));
});

test('save source-grounded work-context samples for review without changing the source recording',async()=>{
  const directory='test-results/execution-relations/work-context';await mkdir(directory,{recursive:true});
  const samples={sourceHash,recordingOrigin,expected,comparison:query.at(comparison.eventId),firstCopy:query.at(firstCopy.writeExecutionId),
    afterCleanup:query.at(trace.events.find(e=>e.activationId===first.id&&e.action==='frame.end').eventId)};
  await writeFile(directory+'/comparison.json',JSON.stringify(samples,null,2)+'\n');
});
