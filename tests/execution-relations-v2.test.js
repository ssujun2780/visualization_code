import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {inferExecutionRelations,inferExecutionRelationsAsync,createExecutionWorkQuery,createExecutionRelationQuery,validateExecutionRelations} from '../scripts/execution-relations/index.mjs';

const int={kind:'integer',name:'int',sizeBits:32,signedness:'signed'};
const number=n=>({type:'i32',decimal:String(n),signed:String(n),bits:`0x${BigInt.asUintN(32,BigInt(n)).toString(16).padStart(8,'0')}`,cType:int});
function fixture(){
  const plan={schemaVersion:3,programId:'independent-record-contract',instructions:[],functions:[{id:'fn1'},{id:'fn2'}],types:[],declarations:[],scopes:[],bindings:{}},
    trace={schemaVersion:3,programId:plan.programId,runId:'record-1',status:'completed',events:[],objects:[],frames:[{id:'f1',parent:null,functionId:'fn1',functionName:'opaque'}]};
  const emit=(kind,action,extra={})=>{const n=trace.events.length+1,id=`x${n}`,instructionId=`i${n}`;
    plan.instructions.push({id:instructionId,kind,action,sourceNodeId:`n${n}`,functionId:extra.activationId==='f2'?'fn2':'fn1'});
    const e={schemaVersion:3,eventId:id,executionId:id,instructionId,activationId:'f1',kind,action,phase:'complete',dataInputs:[],addressInputs:[],controlInputs:[],calleeInputs:[],...extra};trace.events.push(e);return e;};
  emit('SPACE','frame.begin');
  const object=(id,size,{storage='heap',frameId,cType={kind:'array',sizeBits:size*8}}={})=>{
    const begin=emit('SPACE','object.begin',{objectId:id,activationId:frameId??'f1'});const o={id,name:`random-${id}`,size,storage,cType,createdBy:begin.eventId,...(frameId?{frameId}:{})};trace.objects.push(o);return o;};
  const write=(o,offset,size,value,inputs=[],extra={})=>emit('WRITE','write',{target:{objectId:o.id,offset,size},value,inputs:inputs.length?inputs.map(e=>({executionId:e.eventId})):value?.decimal!==undefined?[{value:{...value,literal:value.decimal}}]:[],dataInputs:inputs.map(e=>e.eventId),...extra});
  const read=(o,offset,size,value,extra={})=>emit('READ','read',{target:{objectId:o.id,offset,size},value,...extra});
  return {plan,trace,emit,object,write,read};
}
const analyze=(f,options={})=>{const r=inferExecutionRelations(f.plan,f.trace,{outputSchemaVersion:2,...options});assert.notEqual(r.status,'failed',JSON.stringify(r.diagnostics));return r;};
const query=(f,r,options={})=>createExecutionWorkQuery(f.plan,f.trace,r,{schemaVersion:2,...options});

test('actual sparse ranges and calculation provenance are distinct from identity copies and future writes',()=>{
  const f=fixture(),a=f.object('a',48),b=f.object('b',48),t=f.object('t',4,{storage:'stack',frameId:'f1',cType:int});
  const initial=f.write(a,8,4,number(7)),other=f.write(a,32,4,number(7));
  const r0=f.read(a,8,4,number(7)),save=f.write(t,0,4,number(7),[r0]),rt=f.read(t,0,4,number(7)),r1=f.read(a,32,4,number(7));
  const calc=f.emit('CALC','expression',{operator:'+',inputs:[{executionId:rt.eventId},{executionId:r1.eventId}],dataInputs:[rt.eventId,r1.eventId],value:number(14)});
  const store=f.write(b,16,4,number(14),[calc]),future=f.write(a,8,4,number(99));
  const before=JSON.stringify(f),result=analyze(f),q=query(f,result),view=q.at(store.eventId);
  assert.deepEqual(view.regions.storage.find(o=>o.objectId==='a').readRanges,[{offset:8,size:4},{offset:32,size:4}]);
  assert.ok(result.relations.some(r=>r.kind==='storage-copy'&&r.details.writeExecutionId===save.eventId));
  assert.ok(!result.relations.some(r=>r.kind==='storage-copy'&&r.details.writeExecutionId===store.eventId));
  const origins=q.origins({executionId:store.eventId},{atExecutionId:store.eventId}),ids=new Set(origins.nodes.map(n=>n.executionId));
  for(const e of [initial,other,r0,save,rt,r1,calc,store])assert.ok(ids.has(e.eventId),e.eventId);
  assert.ok(!ids.has(future.eventId));assert.ok(origins.complete);assert.equal(JSON.stringify(f),before);
  assert.equal(q.before(store.eventId).operation.executionId,calc.eventId);
  assert.equal(q.at(null).phase,'before-start');
  assert.ok(q.at(calc.eventId).operation.operands.some(o=>o.valueRef.executionId===rt.eventId));
  assert.ok(!q.at(calc.eventId).operation.operands.some(o=>o.valueRef.executionId===initial.eventId));
});

test('partial writes retain untouched byte producers; overlapping range-copy reads precede the write',()=>{
  const f=fixture(),a=f.object('a',16),first=f.write(a,0,8,number(0)),partial=f.write(a,0,4,number(1)),read=f.read(a,0,8,number(1));
  const copy=f.emit('WRITE','copy',{target:{objectId:'a',offset:4,size:8},sourceObjectId:'a',sourceOffset:0,sourceSize:8});
  const result=analyze(f),q=query(f,result),edges=result.provenance.edges.filter(e=>e.to===`v:${read.eventId}`&&e.path==='memory');
  assert.deepEqual(edges.map(e=>[e.from,e.range.offset,e.range.size]).sort(),[[`v:${first.eventId}`,4,4],[`v:${partial.eventId}`,0,4]].sort());
  const lineage=q.origins(copy.eventId,{atExecutionId:copy.eventId});assert.ok(lineage.complete);assert.ok(!lineage.edges.some(e=>e.from===e.to));
  assert.ok(result.relations.some(r=>r.kind==='storage-copy'&&r.details.writeExecutionId===copy.eventId));
});

test('reference transfer does not read its pointee, and failed attempts do not become accesses',()=>{
  const f=fixture(),a=f.object('a',80),p=f.object('p',8,{storage:'stack',frameId:'f1',cType:{kind:'pointer',sizeBits:64}});
  const put=f.write(p,0,8,{reference:{targetObjectId:'a',targetOffset:80,onePast:true}}),attempt=f.emit('READ','read',{phase:'failed',target:{objectId:'a',offset:80,size:4}});
  const result=analyze(f),q=query(f,result);
  assert.ok(result.relations.some(r=>r.kind==='reference-observation'&&r.details.extent==='reference-only'&&r.details.reference.onePast));
  assert.ok(!result.relations.some(r=>r.kind==='storage-access'&&r.participants.some(p=>p.objectId==='a')));
  assert.equal(q.at(attempt.eventId).phase,'fault');assert.equal(q.at(put.eventId).regions.storage.some(p=>p.objectId==='a'),false);
});

test('captured values survive source lifetime end and address reuse does not merge identities',()=>{
  const f=fixture(),a=f.object('old',4),dst=f.object('dst',4);f.write(a,0,4,number(3));const read=f.read(a,0,4,number(3));
  const end=f.emit('SPACE','object.end',{objectId:a.id,endedObjects:[a.id]});a.endedBy=end.eventId;
  const fresh=f.object('fresh',4);a.address=fresh.address=4096;f.write(fresh,0,4,number(3));const out=f.write(dst,0,4,number(3),[read]);
  const result=analyze(f),q=query(f,result),copy=result.relations.find(r=>r.kind==='storage-copy'&&r.details.writeExecutionId===out.eventId);
  assert.equal(copy.participants[0].objectId,'old');assert.ok(!q.origins(out.eventId,{atExecutionId:out.eventId}).nodes.some(n=>f.trace.events.find(e=>e.eventId===n.executionId)?.target?.objectId==='fresh'));
  const source=q.at(out.eventId).participants.find(p=>p.objectId==='old');assert.equal(source.storageIdentity.lifetime,'ended');
});

test('affine bounds require compiler facts, remain separate from observed accesses and invalidate on bound writes',()=>{
  const f=fixture(),a=f.object('a',80),p=f.object('p',8,{storage:'stack',frameId:'f1'}),u=f.object('u',4,{storage:'stack',frameId:'f1',cType:int}),v=f.object('v',4,{storage:'stack',frameId:'f1',cType:int});
  const base=f.write(p,0,8,{reference:{targetObjectId:'a',targetOffset:0}}),lower=f.write(u,0,4,number(1)),upper=f.write(v,0,4,number(8));
  const entry=f.emit('FLOW','branch'),access=f.read(a,12,4,number(0)),change=f.write(v,0,4,number(2));
  const compilerFacts={schemaVersion:1,scope:{programId:f.plan.programId},domains:[{id:'domain',proofKind:'affine-loop',functionId:'fn1',
    entryInstructionIds:[entry.instructionId],accessInstructionIds:[access.instructionId],sourceNodeIds:[`n${f.trace.events.indexOf(entry)+1}`],
    base:{instructionId:base.instructionId},lower:{instructionId:lower.instructionId},upper:{instructionId:upper.instructionId},step:'2',comparison:'<',indexType:int,elementSizeBytes:4}]};
  const missing=analyze(f);assert.equal(missing.capabilities.bounds.status,'unavailable');
  const result=analyze(f,{compilerFacts}),q=query(f,result),bounded=q.at(entry.eventId).regions.boundedDomains;
  assert.equal(bounded.length,1);assert.deepEqual(bounded[0].participants[0].ranges,[{offset:4,size:4},{offset:12,size:4},{offset:20,size:4},{offset:28,size:4}]);
  assert.equal(q.at(access.eventId).regions.storage.find(o=>o.objectId==='a').readRanges.length,1);
  assert.equal(q.at(change.eventId).regions.boundedDomains.length,0);assert.equal(q.before(change.eventId).regions.boundedDomains.length,1);
  assert.ok(!JSON.stringify(q.at(entry.eventId)).includes('bound-binding-write'));
  assert.equal(validateExecutionRelations(f.plan,f.trace,result,{compilerFacts}),result);
});

test('possible unsigned wrapping does not yield a supposedly bounded terminating range',()=>{
  const f=fixture(),a=f.object('a',1024),p=f.object('p',8),u=f.object('u',4),v=f.object('v',4);
  const base=f.write(p,0,8,{reference:{targetObjectId:'a',targetOffset:0}}),low=f.write(u,0,4,number(250)),high=f.write(v,0,4,number(255)),entry=f.emit('FLOW','branch'),access=f.read(a,1000,4,number(0));
  const compilerFacts={schemaVersion:1,scope:{programId:f.plan.programId},domains:[{id:'bounds',proofKind:'affine-loop',entryInstructionIds:[entry.instructionId],accessInstructionIds:[access.instructionId],sourceNodeIds:[f.plan.instructions.at(-1).sourceNodeId],base:{instructionId:base.instructionId},lower:{instructionId:low.instructionId},upper:{instructionId:high.instructionId},indexType:{sizeBits:8,signedness:'unsigned'},step:'10',comparison:'<',elementSizeBytes:4}]};
  const result=analyze(f,{compilerFacts});assert.equal(result.relations.some(r=>r.kind==='bounded-domain'),false);assert.ok(result.diagnostics.some(d=>d.code==='domain-overflow-not-excluded'));
});

test('work scopes do not expose future end points and structure views retain separate matching bindings',()=>{
  const f=fixture(),a=f.object('a',16),w=f.write(a,0,4,number(4)),read=f.read(a,0,4,number(4));f.emit('SPACE','frame.end');
  const structureInference={schemaVersion:1,scope:{programId:f.plan.programId,runId:f.trace.runId},storageBindings:[
    {id:'node',structureId:'graph',elementId:'vertex',objectId:'a',offset:0,size:4,availableAtExecutionId:w.eventId},
    {id:'cell',structureId:'grid',elementId:'cell',objectId:'a',offset:0,size:4,availableAtExecutionId:read.eventId}]};
  const result=analyze(f,{structureInference}),q=query(f,result);
  assert.equal(q.at(read.eventId).structureBindings.length,2);assert.equal(q.at(w.eventId).structureBindings.length,1);
  assert.ok(q.at(w.eventId).workScopes.every(s=>!('endedAtExecutionId'in s)));assert.equal(q.at(f.trace.events.at(-1).eventId).workScopes.length,0);
});

test('snapshots, invalid evidence, budgets and detached queries are enforced without changing IR',()=>{
  const f=fixture(),a=f.object('a',16);f.write(a,0,4,number(2));const read=f.read(a,0,4,number(2)),write=f.write(a,4,4,number(2),[read]);
  const original=structuredClone({plan:f.plan,trace:f.trace}),result=analyze(f),q=query(f,result),first=q.at(write.eventId);
  first.regions.storage[0].readRanges.length=0;result.relations.length=0;assert.ok(q.at(write.eventId).regions.storage[0].readRanges.length);
  const intact=analyze(f),changed=structuredClone(f.trace);changed.events.at(-1).value=number(9);assert.throws(()=>createExecutionWorkQuery(f.plan,changed,intact,{schemaVersion:2}),/스냅샷/);
  const invalid=structuredClone(intact);invalid.relations[0].evidence.executionIds=['missing'];assert.throws(()=>validateExecutionRelations(f.plan,f.trace,invalid));
  const bounded=analyze(f,{limits:{maxEvents:3}});assert.equal(bounded.status,'partial');assert.ok(query(f,bounded).at(write.eventId).unresolved.includes('outside-analyzed-prefix'));
  const limited=query(f,intact,{limits:{maxOriginDepth:1}}).origins(write.eventId,{atExecutionId:write.eventId});assert.equal(limited.complete,false);
  assert.deepEqual({plan:f.plan,trace:f.trace},original);assert.equal(Object.isFrozen(f.trace),false);
});

test('saved independent arithmetic and call IR supports sync/worker/query paths with v1 kept as default',async()=>{
  for(const filename of ['animation-demo.json','animation-functions.json']){
    const f=JSON.parse(await readFile(new URL(`../public/${filename}`,import.meta.url),'utf8')),original=JSON.stringify(f);
    const legacy=inferExecutionRelations(f.plan,f.trace);assert.equal(legacy.schemaVersion,1);
    const result=analyze(f);assert.deepEqual(await inferExecutionRelationsAsync(f.plan,f.trace,{outputSchemaVersion:2}),result);
    const q=query(f,result),history=createExecutionRelationQuery(f.plan,f.trace,result);
    assert.deepEqual(history.at(null),[]);assert.equal(q.at(f.trace.events.at(-1).eventId).phase,'no-active-frame');
    assert.equal(JSON.stringify(f),original);
  }
});

test('display names never classify algorithms or alter observed relationships',()=>{
  const f=fixture(),a=f.object('a',16),b=f.object('b',16);f.write(a,0,4,number(5));const r=f.read(a,0,4,number(5));f.write(b,0,4,number(5),[r]);
  const first=analyze(f),g=structuredClone({plan:f.plan,trace:f.trace});for(const o of g.trace.objects)o.name='same';for(const frame of g.trace.frames)frame.functionName='merge_sort';
  const second=analyze(g);assert.deepEqual(first.relations,second.relations);assert.deepEqual(first.provenance,second.provenance);
});

test('address and control operands do not become payload origins',()=>{
  const f=fixture(),a=f.object('a',16),index=f.object('index',4,{storage:'stack',frameId:'f1',cType:int}),out=f.object('out',4);
  const iw=f.write(index,0,4,number(0));f.write(a,0,4,number(8));f.write(a,4,4,number(6));
  const idx=f.read(index,0,4,number(0)),left=f.read(a,0,4,number(8),{inputs:[{executionId:idx.eventId}],addressInputs:[idx.eventId]}),right=f.read(a,4,4,number(6));
  const predicate=f.emit('CALC','expression',{operator:'>',value:number(1),inputs:[{executionId:left.eventId},{executionId:right.eventId}],dataInputs:[left.eventId,right.eventId]});
  const selected=f.write(out,0,4,number(8),[left],{controlInputs:[predicate.eventId]});
  const result=analyze(f),q=query(f,result),origins=q.origins(selected.eventId,{atExecutionId:selected.eventId});
  assert.ok(origins.nodes.some(n=>n.executionId===left.eventId));
  for(const e of [idx,iw,predicate,right])assert.ok(!origins.nodes.some(n=>n.executionId===e.eventId),e.eventId);
  assert.ok(q.origins(selected.eventId,{atExecutionId:selected.eventId,roles:['value','control','address']}).nodes.some(n=>n.executionId===right.eventId));
});

test('equal-width numeric conversions and bit-preserving integer casts are not conflated',()=>{
  const f=fixture(),a=f.object('a',4),floating=f.object('floating',4),unsigned=f.object('unsigned',4);f.write(a,0,4,number(0));const r=f.read(a,0,4,number(0));
  const cast=(toType,value)=>{const event=f.emit('CALC','expression',{operator:'cast',inputs:[{executionId:r.eventId}],dataInputs:[r.eventId],value});
    const definition=f.plan.instructions.at(-1);definition.expression={nodeId:definition.sourceNodeId,kind:'CStyleCastExpr',children:[]};
    event.steps=[{observationId:`step:${event.eventId}`,nodeId:definition.sourceNodeId,operator:'cast',conversion:{fromType:int,toType},inputs:[{executionId:r.eventId}]}];return event;};
  const floatType={kind:'floating',sizeBits:32,encoding:'DW_ATE_float'},float=cast(floatType,{bits:'0x00000000',cType:floatType}),fw=f.write(floating,0,4,float.value,[float]);
  const uint={...int,signedness:'unsigned'},uc=cast(uint,{...number(0),cType:uint}),uw=f.write(unsigned,0,4,uc.value,[uc]);
  const result=analyze(f);
  assert.ok(!result.relations.some(x=>x.kind==='storage-copy'&&x.details.writeExecutionId===fw.eventId));
  assert.ok(result.relations.some(x=>x.kind==='storage-copy'&&x.details.writeExecutionId===uw.eventId));
});

test('argument/return provenance follows the actual return, not copied call arguments at resume',()=>{
  const f=fixture(),a=f.object('a',4),dst=f.object('dst',4);f.write(a,0,4,number(9));const r=f.read(a,0,4,number(9));
  const call=f.emit('FLOW','call',{resolvedFunctionId:'fn2',inputs:[{executionId:r.eventId}],dataInputs:[r.eventId]});
  f.trace.frames.push({id:'f2',parent:'f1',functionId:'fn2',functionName:'unrelated-label'});f.emit('SPACE','frame.begin',{activationId:'f2'});
  const param=f.object('param',4,{storage:'stack',frameId:'f2',cType:int});f.write(param,0,4,number(9),[r],{activationId:'f2',action:'argument',parameterIndex:0,callExecutionId:call.eventId});
  const returned=f.emit('WRITE','return.value',{activationId:'f2',callExecutionId:call.eventId,target:{kind:'return-port',activationId:'f2'},value:number(0),inputs:[{value:{...number(0),literal:'0'}}]});
  const resume=f.emit('FLOW','resume',{callExecutionId:call.eventId,inputs:[{executionId:r.eventId}],dataInputs:[returned.eventId],value:number(0)}),stored=f.write(dst,0,4,number(0),[resume]);
  const end=f.emit('SPACE','frame.end',{activationId:'f2',endedObjects:[param.id]});param.endedBy=end.eventId;
  const result=analyze(f),q=query(f,result),origins=q.origins(stored.eventId,{atExecutionId:stored.eventId});
  assert.ok(origins.nodes.some(n=>n.executionId===returned.eventId));assert.ok(!origins.nodes.some(n=>n.executionId===r.eventId));
  assert.ok(result.relations.some(x=>x.kind==='argument-transfer'));assert.ok(result.relations.some(x=>x.kind==='return-transfer'));
  assert.ok(q.at(stored.eventId).calls.stack.some(frame=>frame.activationId==='f2'&&frame.role==='resident-callee'));
  assert.ok(!q.at(end.eventId).calls.stack.some(frame=>frame.activationId==='f2'));
});

test('explicit compiler body-entry regions share iteration rules across for/while/do and do not merge iterations',()=>{
  const f=fixture(),a=f.object('a',8);f.write(a,0,4,number(2));const first=f.read(a,0,4,number(2)),write=f.write(a,4,4,number(2),[first]);
  const second=f.read(a,0,4,number(2));f.plan.instructions.pop();second.instructionId=first.instructionId;
  const exit=f.emit('FLOW','branch'),root=f.plan.instructions.find(i=>i.id===first.instructionId).sourceNodeId;
  for(const syntax of ['ForStmt','WhileStmt','DoStmt']){
    const compilerFacts={schemaVersion:1,scope:{programId:f.plan.programId},expressionOwners:[{instructionId:first.instructionId,nodeId:root},{instructionId:write.instructionId,nodeId:root}],
      regions:[{id:'body',kind:'loop',syntax,entryInstructionIds:[first.instructionId],exitInstructionIds:[exit.instructionId],memberInstructionIds:[first.instructionId,write.instructionId]}]};
    const result=analyze(f,{compilerFacts}),q=query(f,result);
    assert.equal(q.at(write.eventId).workScopes.find(s=>s.kind==='iteration').iteration,1);
    assert.equal(q.at(second.eventId).workScopes.find(s=>s.kind==='iteration').iteration,2);
    assert.ok(!q.at(exit.eventId).workScopes.some(s=>s.kind==='iteration'));
  }
});

test('malformed optional proof fails only its dependent capability and future references remain unresolved',()=>{
  const f=fixture(),a=f.object('a',8);f.write(a,0,4,number(1));const read=f.read(a,0,4,number(1)),write=f.write(a,4,4,number(1),[read]);
  read.addressInputs=[write.eventId];
  const result=analyze(f,{compilerFacts:{schemaVersion:1,scope:{programId:f.plan.programId},domains:[{id:'broken'}]}});
  assert.equal(result.status,'partial');assert.equal(result.capabilities.bounds.status,'failed');assert.equal(result.capabilities.accesses.status,'completed');
  const q=query(f,result);assert.ok(q.at(read.eventId).unresolved.includes('unresolved-address'));
  assert.ok(!q.origins(read.eventId,{atExecutionId:read.eventId,roles:['address']}).nodes.some(n=>n.executionId===write.eventId));
});

test('native time-stamped graph nodes and declared array projections bind without importing the inference engine',()=>{
  const f=fixture(),a=f.object('a',16);f.write(a,4,4,number(4));const read=f.read(a,4,4,number(4));
  const structureInference={schemaVersion:1,scope:{programId:f.plan.programId,runId:f.trace.runId},structures:[
    {id:'graph',kind:'storage-reference-graph',nodes:[{id:'vertex',range:{objectId:'a',offset:4,size:4},discoveredAtExecutionId:read.eventId}]},
    {id:'array',kind:'array',range:{objectId:'a',offset:0,size:16},elementBytes:4}]};
  const result=analyze(f,{structureInference}),view=query(f,result).at(read.eventId);
  assert.equal(view.structureBindings.length,2);assert.ok(view.structureBindings.some(r=>r.participants[0].elementId==='array:element:1'));
});

test('scope indexing handles deep calls without recursive traversal or copied descendant events',t=>{
  const f=fixture(),depth=1200;let parent='f1';
  for(let i=0;i<depth;i++){f.emit('FLOW','call',{activationId:parent,resolvedFunctionId:'fn2'});const id=`deep-${i}`;f.trace.frames.push({id,parent,functionId:'fn2'});f.emit('SPACE','frame.begin',{activationId:id});parent=id;}
  const leaf=f.emit('CALC','expression',{activationId:parent,operator:'+',inputs:[{value:{...number(1),literal:'1'}},{value:{...number(2),literal:'2'}}],value:number(3)});
  for(let i=depth-1;i>=0;i--)f.emit('SPACE','frame.end',{activationId:`deep-${i}`});
  const start=performance.now(),result=analyze(f),q=query(f,result),view=q.at(leaf.eventId);
  assert.equal(view.calls.stack.length,depth+1);assert.equal(view.calls.currentActivationId,parent);assert.ok(view.workScopes.length>=depth+1);
  t.diagnostic(`${f.trace.events.length} events / ${result.relations.length} relations / build+query ${(performance.now()-start).toFixed(1)} ms`);
});

test('versioned transfer chains identify a duplicate-value cycle and a non-copy overwrite breaks that cycle',()=>{
  function run(overwrite){const f=fixture(),a=f.object('a',8),tmp=f.object('tmp',4,{storage:'stack',frameId:'f1',cType:int});
    f.write(a,0,4,number(5));f.write(a,4,4,number(5));const ra=f.read(a,0,4,number(5)),save=f.write(tmp,0,4,number(5),[ra]);
    const rb=f.read(a,4,4,number(5)),first=f.write(a,0,4,number(5),[rb]);if(overwrite)f.write(a,0,4,number(99));
    const rt=f.read(tmp,0,4,number(5)),last=f.write(a,4,4,number(5),[rt]);return {f,save,first,last};}
  const normal=run(false),r=analyze(normal.f),cycles=r.relations.filter(x=>x.kind==='transfer-cycle');
  assert.equal(cycles.length,1);assert.deepEqual(new Set(cycles[0].details.transferIds.map(id=>r.relations.find(x=>x.id===id).details.writeExecutionId)),new Set([normal.first.eventId,normal.last.eventId]));
  assert.ok(r.relations.some(x=>x.kind==='transfer-dependency'));assert.ok(r.relations.some(x=>x.kind==='fan-out-transfer'));
  const changed=run(true);assert.ok(!analyze(changed.f).relations.some(x=>x.kind==='transfer-cycle'));
});

test('serialized-output and query budgets report incomplete metadata without fabricated scope references',()=>{
  const f=fixture(),a=f.object('a',16);f.write(a,0,4,number(1));const r=f.read(a,0,4,number(1)),last=f.write(a,4,4,number(1),[r]);
  for(const limits of [{maxRelations:1},{maxProvenanceEdges:1}]){
    const result=analyze(f,{limits});assert.equal(result.status,'partial');assert.ok(result.coverage.truncated.length);validateExecutionRelations(f.plan,f.trace,result);
  }
  const small=analyze(f,{limits:{maxRelations:1}});assert.equal(query(f,small).at(last.eventId).regions.complete,false);
  const result=analyze(f),q=query(f,result,{limits:{maxQueryItems:1}}),view=q.at(last.eventId);
  assert.equal(view.regions.complete,false);assert.ok(view.unresolved.includes('query-budget'));
  const before=query(f,result).at(r.eventId),prefix={...f.trace,events:f.trace.events.slice(0,f.trace.events.indexOf(r)+1),status:'partial'},prefixResult=inferExecutionRelations(f.plan,prefix,{outputSchemaVersion:2});
  assert.deepEqual(createExecutionWorkQuery(f.plan,prefix,prefixResult,{schemaVersion:2}).at(r.eventId),before);
});

test('v2 CLI only writes its separate artifact and leaves saved canonical IR and v1 results intact',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'relations-v2-'));t.after(async()=>{
    const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('relations-v2-'));await rm(target,{recursive:true,force:true});
  });
  const sample=JSON.parse(await readFile(new URL('../public/animation-functions.json',import.meta.url),'utf8')),plan=JSON.stringify(sample.plan),trace=JSON.stringify(sample.trace),legacy=JSON.stringify(inferExecutionRelations(sample.plan,sample.trace));
  await Promise.all([writeFile(join(directory,'plan.json'),plan),writeFile(join(directory,'trace.json'),trace),writeFile(join(directory,'execution-relations.json'),legacy)]);
  await promisify(execFile)(process.execPath,['scripts/infer-execution-relations.mjs',directory,'--schema-version','2'],{cwd:process.cwd()});
  const result=JSON.parse(await readFile(join(directory,'execution-relations-v2.json'),'utf8'));assert.equal(result.schemaVersion,2);assert.equal(result.status,'completed');
  assert.equal(await readFile(join(directory,'plan.json'),'utf8'),plan);assert.equal(await readFile(join(directory,'trace.json'),'utf8'),trace);assert.equal(await readFile(join(directory,'execution-relations.json'),'utf8'),legacy);
  assert.deepEqual((await readdir(directory)).sort(),['execution-relations-v2.json','execution-relations.json','plan.json','trace.json']);
});

test('shared private observation IDs are resolved by canonical execution and causal prefix',()=>{
  const f=fixture(),a=f.object('a',8);f.write(a,0,4,number(3));const read=f.read(a,0,4,number(3));
  read.observationIds=['shared'];
  const calc=f.emit('CALC','expression',{operator:'+',inputs:[{executionId:read.eventId,observationId:'shared'},{value:{...number(1),literal:'1'}}],dataInputs:[read.eventId],value:number(4)});
  const future=f.emit('CALC','expression',{operator:'cast',inputs:[{executionId:read.eventId}],dataInputs:[read.eventId],value:number(3),observationIds:['shared'],
    steps:[{observationId:'shared',nodeId:null,operator:'cast',conversion:{fromType:int,toType:{...int,signedness:'unsigned'}},inputs:[{executionId:read.eventId}]}]});
  const full=analyze(f),q=query(f,full),prefix={...f.trace,events:f.trace.events.slice(0,f.trace.events.indexOf(calc)+1)},r=inferExecutionRelations(f.plan,prefix,{outputSchemaVersion:2});
  assert.equal(r.status,'completed');assert.deepEqual(createExecutionWorkQuery(f.plan,prefix,r,{schemaVersion:2}).at(calc.eventId),q.at(calc.eventId));
  assert.ok(q.origins(calc.eventId,{atExecutionId:calc.eventId}).nodes.some(n=>n.executionId===read.eventId));
  assert.ok(!q.origins(calc.eventId,{atExecutionId:calc.eventId}).nodes.some(n=>n.executionId===future.eventId));
});

test('explicit initialization snapshots supply producers without fabricating WRITE events or using final object state',()=>{
  const f=fixture(),a=f.object('a',8,{storage:'static',cType:{kind:'array',sizeBits:64}}),begin=f.trace.events.find(e=>e.eventId===a.createdBy);
  begin.memoryState={format:'memory-ranges-v1',byteLength:8,ranges:[{offset:0,length:4,initialization:'initialized',data:{encoding:'fill',byte:0}},{offset:4,length:4,initialization:'uninitialized'}]};
  const known=f.read(a,0,4,number(0)),unknown=f.read(a,4,4,number(7));a.initializationRanges=[{offset:0,length:8,writer:'invented-final-state'}];
  const result=analyze(f),q=query(f,result),origin=q.origins(known.eventId,{atExecutionId:known.eventId});
  assert.ok(origin.complete);assert.ok(origin.nodes.some(n=>n.executionId===begin.eventId&&n.transform==='initialization'));
  assert.ok(q.origins(unknown.eventId,{atExecutionId:unknown.eventId}).unresolved.includes('uninitialized-source'));
  assert.ok(!result.relations.some(r=>r.kind==='storage-access'&&r.availableAtExecutionId===begin.eventId));
});

test('all causal prefixes preserve multiple-source and work relationships',()=>{
  const f=fixture(),a=f.object('a',12),b=f.object('b',12);for(let i=0;i<3;i++)f.write(a,i*4,4,number(i));
  for(let i=0;i<3;i++){const r=f.read(a,i*4,4,number(i));f.write(b,i*4,4,number(i),[r]);}f.emit('SPACE','frame.end');
  const full=analyze(f),q=query(f,full);
  for(let p=0;p<f.trace.events.length;p++){const prefix={...f.trace,events:f.trace.events.slice(0,p+1),status:'partial'},r=inferExecutionRelations(f.plan,prefix,{outputSchemaVersion:2});
    assert.equal(r.status,'completed');assert.deepEqual(createExecutionWorkQuery(f.plan,prefix,r,{schemaVersion:2}).at(prefix.events.at(-1).eventId),q.at(prefix.events.at(-1).eventId));}
});

test('cyclic non-JSON input fails in the analyzer and empty analysis failures remain queryable',()=>{
  const f=fixture();f.plan.extra=f.plan;const failed=inferExecutionRelations(f.plan,f.trace,{outputSchemaVersion:2});assert.equal(failed.status,'failed');assert.match(failed.diagnostics[0].message,/JSON/);
  delete f.plan.extra;assert.doesNotThrow(()=>validateExecutionRelations(f.plan,f.trace,failed));assert.equal(query(f,failed).at(f.trace.events[0].eventId).analysisStatus,'failed');
});

test('auxiliary observations must belong to the same run and failed accesses retain attempt metadata only',()=>{
  const f=fixture(),a=f.object('a',4),failedRead=f.emit('READ','read',{phase:'failed',target:{objectId:a.id,offset:4,size:4}});
  const wrong=inferExecutionRelations(f.plan,f.trace,{outputSchemaVersion:2,observationEvidence:{schemaVersion:1,scope:{programId:f.plan.programId},bindings:[]}});assert.equal(wrong.status,'failed');
  const result=analyze(f),view=query(f,result).at(failedRead.eventId);
  assert.ok(result.relations.some(r=>r.kind==='access-attempt'&&r.details.targetExecutionId===failedRead.eventId));
  assert.ok(!result.relations.some(r=>r.kind==='storage-access'&&r.availableAtExecutionId===failedRead.eventId));assert.equal(view.phase,'fault');
});

test('sparse storage scales through ordered producer spans and cached prefix queries',t=>{
  for(const count of [100,1000]){
    const f=fixture(),a=f.object('a',count*8),b=f.object('b',count*8);for(let i=0;i<count;i++)f.write(a,i*8,4,number(i));
    for(let i=0;i<count;i++){const r=f.read(a,i*8,4,number(i));f.write(b,i*8,4,number(i),[r]);}
    const start=performance.now(),result=analyze(f),q=query(f,result),view=q.at(f.trace.events.at(-1).eventId),elapsed=performance.now()-start;
    assert.equal(view.regions.storage.find(s=>s.objectId===a.id).readRanges.length,count);
    assert.equal(view.regions.storage.find(s=>s.objectId===b.id).writeRanges.length,count);
    assert.deepEqual(q.at(f.trace.events.at(-1).eventId).regions,view.regions);
    t.diagnostic(`${count} sparse entries / ${f.trace.events.length} events / ${result.relations.length} relations / build+query ${elapsed.toFixed(1)} ms`);
  }
});
