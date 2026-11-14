import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {traceModel} from '../scripts/model/index.mjs';
import {writeJSON} from '../scripts/shared/json-output.mjs';
import {inferExecutionRelations,createExecutionRelationQuery,validateExecutionRelations} from '../scripts/execution-relations/index.mjs';

const meetingPath='examples/c/walkthrough/meeting_selection_fixed.c';
const meetingSource=await readFile(meetingPath,'utf8');
// Independent source oracle, fixed before compiler/model execution. Half-open
// byte ranges below use the target ABI's observed 8-byte meeting record.
const expected=Object.freeze({sortActivations:7,combineActivations:3,parentChildCalls:10,leafActivationsWithoutArrayAccess:4,
  elementBytes:8,finalSourceIndices:[1,3,2,0],rootRange:[0,32],childRanges:[[0,16],[16,32]],
  combineRanges:[[0,16],[16,32],[0,32]],arrayFieldCopies:32,
  temporaryDestinationSourceIndices:[[1,0],[3,2],[1,3,2,0]],copyBackDestinationSourceIndices:[[0,1],[2,3],[0,1,2,3]]});
const stdin='4\n5 7\n1 2\n3 5\n2 3\n';
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const ofKind=(result,kind)=>result.relations.filter(r=>r.kind===kind);
const span=r=>[r.offset,r.offset+r.size];
const frame=(trace,name)=>trace.frames.filter(f=>f.functionName===name);
function copiesFor(result,source,destination){return ofKind(result,'storage-copy').filter(r=>r.participants[0].objectId===source&&r.participants[1].objectId===destination);}
async function execute(label,source,input,prediction){
  const directory=join('test-results/execution-relations',label);await mkdir(directory,{recursive:true});
  await writeJSON(join(directory,'prediction.json'),{sourceHash:digest(source),stdin:input,expected:prediction,status:'frozen-before-execution'});
  const generated=await traceModel(source,{filename:label+'.c',stdin:input,maxEvents:30000});
  assert.equal(generated.trace?.status,'completed',generated.stderr);assert.equal(generated.trace.exitCode,0);
  const before=digest({plan:generated.plan,trace:generated.trace}),start=performance.now(),result=inferExecutionRelations(generated.plan,generated.trace),elapsedMs=performance.now()-start;
  await Promise.all([writeFile(join(directory,'original.c'),source),writeJSON(join(directory,'plan.json'),generated.plan),
    writeJSON(join(directory,'trace.json'),generated.trace),writeJSON(join(directory,'execution-relations.json'),result)]);
  assert.equal(result.status,'completed',JSON.stringify(result.diagnostics));assert.equal(digest({plan:generated.plan,trace:generated.trace}),before);
  validateExecutionRelations(generated.plan,generated.trace,result);
  return {...generated,result,directory,elapsedMs};
}
function verifyMeeting({plan,trace,result},names){
  const sorts=frame(trace,names.sort),combines=frame(trace,names.combine),main=frame(trace,names.main)[0];
  assert.equal(sorts.length,expected.sortActivations);assert.equal(combines.length,expected.combineActivations);
  const calls=ofKind(result,'activation-call');assert.equal(calls.length,expected.parentChildCalls);
  for(const f of [...sorts,...combines])assert.ok(calls.some(r=>r.calleeActivationId===f.id&&r.callerActivationId===f.parent));
  const heap=trace.objects.filter(o=>o.storage==='heap');assert.equal(heap.length,2);
  const [source,destination]=heap.map(o=>o.id),root=sorts.find(f=>f.parent===main.id);
  const summaries=ofKind(result,'activation-range'),summary=(f,id,scope)=>summaries.find(r=>r.activationIds[0]===f.id&&r.objectId===id&&r.scope===scope);
  assert.deepEqual(summary(root,source,'subtree').ranges.map(span),[expected.rootRange]);
  assert.equal(summary(root,source,'direct'),undefined);
  const children=sorts.filter(f=>f.parent===root.id);
  assert.deepEqual(children.map(f=>summary(f,source,'subtree').ranges.map(span)),expected.childRanges.map(r=>[r]));
  assert.deepEqual(combines.map(f=>summary(f,source,'direct').ranges.map(span)),expected.combineRanges.map(r=>[r]));
  const leaves=sorts.filter(f=>!trace.frames.some(child=>child.parent===f.id));assert.equal(leaves.length,expected.leafActivationsWithoutArrayAccess);
  for(const f of leaves){
    assert.equal(summary(f,source,'subtree'),undefined);
    assert.equal(ofKind(result,'pointer-argument').filter(r=>r.activationIds.includes(f.id)&&r.reference.objectId===source).length,1);
  }
  const toBuffer=copiesFor(result,source,destination),back=copiesFor(result,destination,source);
  assert.equal(toBuffer.length+back.length,expected.arrayFieldCopies);
  function elementMappings(copies,f,side){
    const rows=copies.filter(r=>r.activationIds[0]===f.id);
    // Every record remains two distinct writes, preserving intermediate states.
    assert.equal(rows.length%2,0);
    for(let i=0;i<rows.length;i+=2){
      assert.notEqual(rows[i].writeExecutionId,rows[i+1].writeExecutionId);
      assert.equal(rows[i].destinationLayout.elementOffset,rows[i+1].destinationLayout.elementOffset);
      assert.deepEqual([rows[i].destinationLayout.memberOffset,rows[i+1].destinationLayout.memberOffset],[0,4]);
      assert.equal(rows[i].sourceLayout.elementSizeBytes,expected.elementBytes);
    }
    return rows.filter((_,i)=>i%2===0).map(r=>r[side].elementOffset/expected.elementBytes);
  }
  // The frozen prediction describes original input identities, not current
  // source indices after earlier copy-backs. Replay only inferred byte-copy
  // edges to recover those identities, never use equal numeric field values.
  const identities=new Map(heap.map(o=>[o.id,new Map()])),originalByFrame=new Map(combines.map(f=>[f.id,[]]));
  for(let offset=0;offset<heap[0].size;offset++)identities.get(source).set(offset,offset);
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
  for(const copy of [...toBuffer,...back].sort((a,b)=>positions.get(a.writeExecutionId)-positions.get(b.writeExecutionId))){
    const [s,d]=copy.participants,from=identities.get(s.objectId),to=identities.get(d.objectId),snapshot=[];
    for(let byte=0;byte<s.size;byte++)snapshot.push(from.get(s.offset+byte));
    if(s.objectId===source&&copy.destinationLayout.memberOffset===0)originalByFrame.get(copy.activationIds[0]).push(snapshot[0]/expected.elementBytes);
    for(let byte=0;byte<d.size;byte++)to.set(d.offset+byte,snapshot[byte]);
  }
  assert.deepEqual(combines.map(f=>originalByFrame.get(f.id)),expected.temporaryDestinationSourceIndices);
  assert.deepEqual(combines.map(f=>elementMappings(back,f,'sourceLayout')),expected.copyBackDestinationSourceIndices);
  assert.deepEqual(originalByFrame.get(combines.at(-1).id),expected.finalSourceIndices);
  const sequences=ofKind(result,'copy-sequence').filter(r=>r.sourceObjectId===source&&r.destinationObjectId===destination);
  assert.equal(sequences.length,3);assert.deepEqual(sequences.map(r=>r.transferIds.length),[4,4,8]);
  assert.deepEqual(ofKind(result,'copy-sequence').filter(r=>r.sourceObjectId===destination&&r.destinationObjectId===source).map(r=>r.transferIds.length),[4,4,8]);
  const disjoint=ofKind(result,'range-relation').find(r=>r.objectId===source&&r.leftActivationId===children[0].id&&r.rightActivationId===children[1].id);
  assert.equal(disjoint?.relationship,'disjoint');
  const query=createExecutionRelationQuery(plan,trace,result),copy=toBuffer[0],writeIndex=trace.events.findIndex(e=>e.eventId===copy.writeExecutionId);
  assert.ok(!query.at(trace.events[writeIndex-1].eventId).some(r=>r.id===copy.id));assert.ok(query.at(copy.writeExecutionId).some(r=>r.id===copy.id));
  assert.ok(!query.at(copy.writeExecutionId).some(r=>r.id===summary(root,source,'subtree').id));
  return {parentChildCalls:calls.length,sortActivations:sorts.length,combineActivations:combines.length,
    rootRange:summary(root,source,'subtree').ranges.map(span),childRanges:children.map(f=>summary(f,source,'subtree').ranges.map(span)),
    fieldCopies:toBuffer.length+back.length,copySequences:sequences.map(r=>({activationId:r.activationIds[0],transfers:r.transferIds.length,sourceRuns:r.sourceRuns})),
    finalReadIndices:elementMappings(toBuffer,combines.at(-1),'sourceLayout'),
    finalSourceIndices:originalByFrame.get(combines.at(-1).id),unaccessedLeaves:leaves.length};
}

test('meeting merge-sort: independently predicted ranges, field provenance, recursive calls and availability match actual inference',async()=>{
  const run=await execute('meeting',meetingSource,stdin,expected),actual=verifyMeeting(run,{sort:'merge_sort',combine:'merge',main:'main'});
  await writeJSON(join(run.directory,'comparison.json'),{expected,actual,elapsedMs:run.elapsedMs,events:run.trace.events.length,relations:run.result.relations.length,status:'matched'});
  // Prefix analysis must not borrow final object state or future frames/ranges.
  const call=ofKind(run.result,'activation-call').find(r=>r.calleeActivationId===run.trace.frames[1].id),end=run.trace.events.findIndex(e=>e.eventId===call.entryExecutionId);
  const prefix={...run.trace,events:run.trace.events.slice(0,end+1)},r=inferExecutionRelations(run.plan,prefix);
  assert.equal(r.status,'completed');assert.equal(ofKind(r,'activation-call').length,1);
  assert.ok(!ofKind(r,'activation-range').some(r=>r.activationIds.includes(call.calleeActivationId)));
  // Equal numeric values and address/control dependencies cannot supply a copy.
  const copies=ofKind(run.result,'storage-copy').filter(r=>r.mechanism==='read-write-provenance'),first=copies.find(r=>r.participants.every(p=>run.trace.objects.find(o=>o.id===p.objectId)?.storage==='heap'));
  const changed=structuredClone(run.trace),write=changed.events.find(e=>e.eventId===first.writeExecutionId);write.dataInputs=[...write.dataInputs,...write.addressInputs];
  assert.ok(!ofKind(inferExecutionRelations(run.plan,changed),'storage-copy').some(r=>r.writeExecutionId===write.eventId));
  const malformed=structuredClone(run.result);malformed.relations.find(r=>r.kind==='copy-sequence').transferIds.reverse();
  assert.throws(()=>validateExecutionRelations(run.plan,run.trace,malformed));
});

test('the same recursive/record rules survive complete user-identifier renaming',async()=>{
  const names={meeting_time:'Rk',meeting:'zP',sorted_meeting:'aQ',start:'jS',end:'xE',merge_sort:'hU',merge:'kW',left:'uJ',mid:'gL',right:'cM',whatIsTime:'eV',current_meeting:'bK',last_meeting:'mA'};
  const source=meetingSource.replace(/\b[A-Za-z_]\w*\b/g,word=>names[word]??word);
  const run=await execute('renamed-meeting',source,stdin,expected),actual=verifyMeeting(run,{sort:'hU',combine:'kW',main:'main'});
  await writeJSON(join(run.directory,'comparison.json'),{expected,actual,elapsedMs:run.elapsedMs,status:'matched'});
});

test('sparse iterative copies, partial aliases, overlap and deliberately mixed record fields preserve actual storage facts',async()=>{
  const source=await readFile('examples/c/execution-relations/array-relations.c','utf8');
  const prediction={firstReadRanges:[[0,4],[8,12],[16,20]],secondReadRanges:[[4,8],[12,16]],unusedAccesses:0,
    copiesPerSparseCall:[3,2],mixedRecordSourceElementOffsets:[0,12],memmoveBytes:12,sameWidthCopies:1,narrowingCopies:0,noArgumentCalls:1};
  const run=await execute('array-relations',source,'',prediction),{plan,trace,result}=run;
  const sparse=frame(trace,'sparse'),summaries=ofKind(result,'activation-range'),main=frame(trace,'main')[0];
  const original=trace.objects.find(o=>o.frameId===main.id&&o.name==='original'),other=trace.objects.find(o=>o.frameId===main.id&&o.name==='other');
  for(const [i,f]of sparse.entries()){
    const r=summaries.find(r=>r.activationIds[0]===f.id&&r.scope==='direct'&&r.objectId===original.id);
    assert.deepEqual(r.readRanges.map(span),i===0?prediction.firstReadRanges:prediction.secondReadRanges);
    assert.equal(copiesFor(result,original.id,other.id).filter(r=>r.activationIds[0]===f.id).length,prediction.copiesPerSparseCall[i]);
  }
  const overlap=ofKind(result,'range-relation').find(r=>r.objectId===other.id&&r.leftActivationId===sparse[0].id&&r.rightActivationId===frame(trace,'touch')[0].id);
  // Successive sibling matching is per storage, so sparse[1] intervenes here.
  assert.equal(overlap,undefined);
  const partial=ofKind(result,'pointer-argument').find(r=>r.activationIds.at(-1)===sparse[1].id&&r.reference.objectId===original.id);
  assert.equal(partial.reference.offset,4);
  const inactive=frame(trace,'unused')[0];assert.ok(!summaries.some(r=>r.activationIds[0]===inactive.id&&r.objectId===original.id));
  const copies=ofKind(result,'storage-copy'),definition=e=>plan.instructions.find(i=>i.id===e.instructionId);
  const transformed=trace.events.filter(e=>e.kind==='WRITE'&&['original[3] + zero','other[5] = 9'].some(text=>definition(e)?.source?.expression?.includes(text)));
  assert.equal(transformed.length,2);
  for(const e of transformed)
    assert.ok(!copies.some(r=>r.writeExecutionId===e.eventId));
  const mixed=trace.objects.find(o=>o.name==='mixed'),mixedCopies=copies.filter(r=>r.participants[1].objectId===mixed.id&&r.sourceLayout);
  assert.deepEqual(mixedCopies.map(r=>r.sourceLayout.elementOffset),prediction.mixedRecordSourceElementOffsets);
  const move=copies.find(r=>r.mechanism==='recorded-memory-copy'&&r.participants.every(p=>p.objectId===other.id));
  assert.deepEqual(move.participants.map(p=>[p.offset,p.size]),[[0,12],[4,12]]);
  const named=name=>trace.objects.find(o=>o.frameId===main.id&&o.name===name);
  assert.equal(copiesFor(result,original.id,named('wide').id).length,prediction.sameWidthCopies);
  assert.equal(copiesFor(result,original.id,named('narrow').id).length,prediction.narrowingCopies);
  assert.ok(copiesFor(result,named('temporary').id,other.id).length===1);
  const noArgument=ofKind(result,'activation-call').filter(r=>r.calleeActivationId===frame(trace,'token')[0].id);
  assert.equal(noArgument.length,prediction.noArgumentCalls);assert.deepEqual(noArgument[0].participants,[]);
  const changed=structuredClone(trace),read=changed.events.find(e=>e.eventId===mixedCopies[0].readExecutionId),old=changed.objects.find(o=>o.id===read.target.objectId);
  // Same address, new allocation identity born after the read: no valid source.
  changed.objects.push({...old,id:'future-allocation',createdBy:mixedCopies[0].writeExecutionId,endedBy:null});read.target.objectId='future-allocation';
  const reuse=inferExecutionRelations(plan,changed);assert.equal(reuse.status,'completed');
  assert.ok(!ofKind(reuse,'storage-copy').some(r=>r.writeExecutionId===mixedCopies[0].writeExecutionId));
  await writeJSON(join(run.directory,'comparison.json'),{expected:prediction,status:'matched',elapsedMs:run.elapsedMs,
    actual:{readRanges:sparse.map(f=>summaries.find(r=>r.activationIds[0]===f.id&&r.scope==='direct'&&r.objectId===original.id).readRanges.map(span)),
      mixedSourceOffsets:mixedCopies.map(r=>r.sourceLayout.elementOffset),memmove:move.participants}});
});
