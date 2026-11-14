import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceModel} from '../scripts/model/index.mjs';
import {analyzeRecordingWork} from '../scripts/animation/work-analysis.mjs';
import {createV2Query} from '../scripts/execution-relations/v2/query.mjs';
import {digest} from '../scripts/execution-relations/v2/common.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {currentWorkView} from '../src/animation/work-context.js';
import {createWorkContextQuery} from '../src/animation/work-query-context.js';
import {workEvidence} from '../src/animation/work-evidence.js';

test('evidence distinguishes missing provenance, query failure, loading and unknown codes',()=>{
  const operation={executionId:'prior',source:{line:5,expression:'perform(values)'}};
  const view={status:'completed',unresolved:['unresolved-value-operand'],evidenceOperation:operation};
  const partial=workEvidence(view);assert.equal(partial.state,'partial');assert.match(partial.summary,/출처/);
  assert.equal(partial.operation,operation);assert.match(partial.details[0].message,/생산 사건/);
  assert.equal(workEvidence({...view,unresolved:[]}),null);
  assert.equal(workEvidence({...view,status:'loading',unresolved:[]}).state,'loading');
  assert.equal(workEvidence(view,{status:'조회 시간 제한',available:false}).state,'unavailable');
  const unknown=workEvidence({...view,unresolved:['future-reason']});assert.equal(unknown.details[0].code,'future-reason');assert.match(unknown.details[0].message,/원문/);
});

test('caller adapter uses only each live caller prefix and caches paused contexts',()=>{
  const trace={events:[{eventId:'one',activationId:'root'},{eventId:'two',activationId:'child'},{eventId:'three',activationId:'child'},{eventId:'future',activationId:'root'}]};
  const root={calls:{stack:[{activationId:'root',role:'current'}]},regions:{storage:[{objectId:'original',writeRanges:[{offset:0,size:4}]}]}},child={calls:{stack:[{activationId:'root',role:'caller'},{activationId:'child',role:'current'}]},regions:{storage:[]}};
  let queried=[];const base={before:id=>id==='two'?root:child,at:id=>{queried.push(id);return id==='one'?root:child;}};
  const query=createWorkContextQuery(trace,base),result=query.at('two');assert.equal(result.callers.after.storage[0].throughExecutionId,'one');
  assert.equal(result.callers.before.storage.length,0);query.at('three');assert.equal(queried.filter(id=>id==='one').length,1);assert.ok(!queried.includes('future'));
});

test('recursive calls retain original arrays, current partial writes and seek boundaries', {timeout:60000},async()=>{
  // Frozen expectation: two main-owned arrays survive every nested entry;
  // destination[1] changes from 0 to 8 only at the leaf write. No new arrays.
  const source=`void dispatch(int *source,int *destination,int depth){
    if(depth)dispatch(source,destination,depth-1);
    else destination[1]=source[0]+5;
  }
  int main(void){int first[4]={3,6,1,8};int second[4]={0};dispatch(first,second,2);return 0;}`;
  const raw=await traceModel(source,{includeObservations:true});assert.equal(raw.trace.status,'completed');
  const fingerprint=digest({plan:raw.plan,trace:raw.trace}),a=analyzeRecordingWork(raw.plan,raw.trace,{ast:raw.ast,observations:raw.observations});
  const query=createWorkContextQuery(raw.trace,createV2Query(raw.plan,raw.trace,a.relations,{compilerFacts:a.compilerFacts,structureInference:a.structureInference})),r=createRecording(raw.plan,raw.trace),p=new Playback(r);
  const first=raw.trace.objects.find(o=>o.name==='first'),second=raw.trace.objects.find(o=>o.name==='second'),main=first.frameId;
  const entries=raw.trace.events.map((e,i)=>({e,i})).filter(({e})=>e.action==='enter'&&e.activationId!==main);assert.equal(entries.length,3);
  for(const {e,i}of entries){p.seek(i);const view=currentWorkView(p,query.at(e.eventId));
    for(const object of [first,second]){const card=view.cards.find(c=>c.id===object.id);assert.ok(card);assert.equal(card.owner,'STACK · main');assert.ok(card.contexts.some(c=>c.kind==='caller'));assert.ok(!card.active.length);}
    assert.deepEqual(view.cards.find(c=>c.id===second.id).cells.map(c=>c.text),['0','0','0','0']);
  }
  const depth=raw.trace.objects.find(o=>o.frameId===entries[0].e.activationId&&o.name==='depth'),argument=raw.trace.events.findIndex(e=>e.action==='argument'&&e.target?.objectId===depth.id);
  p.seek(argument);const noQuery=currentWorkView(p);assert.ok(noQuery.cards.find(c=>c.id===first.id));assert.ok(noQuery.cards.find(c=>c.id===second.id));
  assert.ok(noQuery.cards.find(c=>c.id===first.id).contexts.some(c=>c.kind==='reference'));assert.equal(noQuery.cards.find(c=>c.id===first.id).region,undefined);
  const writeIndex=raw.trace.events.findIndex(e=>e.kind==='WRITE'&&e.target?.objectId===second.id&&e.activationId!==main);assert.ok(writeIndex>0);
  p.seek(writeIndex);const context=query.at(p.event.eventId),before=currentWorkView(p,context);p.progress=.99;const after=currentWorkView(p,context);
  assert.equal(before.evidenceOperation.executionId,raw.trace.events[writeIndex-1].eventId);assert.equal(after.evidenceOperation.executionId,p.event.eventId);
  assert.equal(before.cards.find(c=>c.id===second.id).cells[1].text,'0');assert.equal(after.cards.find(c=>c.id===second.id).cells[1].text,'8');
  // Current recorded pointer references also work without the optional query.
  const fallback=currentWorkView(p);assert.ok(fallback.cards.find(c=>c.id===first.id));assert.ok(fallback.cards.find(c=>c.id===second.id));
  p.seek(entries[0].i);assert.deepEqual(currentWorkView(p,query.at(p.event.eventId)).cards.find(c=>c.id===second.id).cells.map(c=>c.text),['0','0','0','0']);
  p.seek(raw.trace.events.length);assert.ok(!currentWorkView(p,query.at(raw.trace.events.at(-1).eventId)).cards.some(c=>c.id===first.id||c.id===second.id));
  assert.equal(digest({plan:raw.plan,trace:raw.trace}),fingerprint);
});
