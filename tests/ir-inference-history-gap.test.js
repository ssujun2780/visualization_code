import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,querySequenceLookup,queryAssociativeLookup,queryStructureRelations,queryStructureConditions,recommendStructureViews,setStructurePresentation,resolveStructurePresentation,validateStructureTrace} from '../scripts/inference/index.mjs';
import {sequenceLookupStructures} from '../scripts/inference/sequence-lookup-views.mjs';
import {associativeStructures} from '../scripts/inference/associative-views.mjs';
import {stateHistoryCoverage,appendStateSnapshot,stateHistoryGapAt,structureStateAt,validateStateHistory} from '../scripts/inference/state-history.mjs';

// Source-defined observations, independent of inferred labels and implementation limits.
const cases=[
 {kind:'sequence-lookup-candidate',view:'trie',build:sequenceLookupStructures,query:querySequenceLookup,stdout:'A 1\nB 0\nC 1\n',source:String.raw`#include <stdio.h>
typedef struct N{struct N*c[2];int end;}N;N a[3];
int has(const char*s){N*p=a;while(*s){int k=*s-'0';if(!p->c[k])return 0;p=p->c[k];s++;}return p->end;}
int main(void){a[0].c[0]=a+1;a[1].c[1]=a+2;a[2].end=1;printf("A %d\n",has("01"));a[2].end=0;printf("B %d\n",has("01"));a[2].end=1;printf("C %d\n",has("01"));return 0;}`},
 {kind:'associative-lookup-candidate',view:'hash-table',build:associativeStructures,query:queryAssociativeLookup,stdout:'A 7\nB 9\nC 11\n',source:String.raw`#include <stdio.h>
int keys[4]={-1,-1,-1,-1},values[4];
void put(int k,int v){unsigned i=(unsigned)k%4;while(keys[i]!=-1&&keys[i]!=k)i=(i+1)%4;keys[i]=k;values[i]=v;}
int get(int k){unsigned i=(unsigned)k%4;while(keys[i]!=-1){if(keys[i]==k)return values[i];i=(i+1)%4;}return -1;}
int main(void){put(1,7);printf("A %d\n",get(1));put(1,9);printf("B %d\n",get(1));put(1,11);printf("C %d\n",get(1));return 0;}`}
];
cases[0].name='pointer-input trie';
cases[1].name='integer hash';
cases.push({...cases[0],name:'indexed-input trie',source:String.raw`#include <stdio.h>
typedef struct N{int noise;struct N*c[3];int end;}N;N a[9];int extent=3;
void add(const char*s){N*p=a+2;for(int j=0;s[j];j++){int k=s[j]-'0';if(!p->c[k])p->c[k]=a+extent++;p=p->c[k];p->noise=99;}p->end=1;}
int has(const char*s){N*p=a+2;for(int j=0;s[j];j++){int k=s[j]-'0';if(!p->c[k])return 0;p=p->c[k];}return p->end;}
int main(void){add("01");printf("A %d\n",has("01"));a[4].end=0;printf("B %d\n",has("01"));a[4].end=1;printf("C %d\n",has("01"));return 0;}`});
before(async()=>{for(const c of cases){const raw=await traceModel(c.source,{filename:'history.c',includeObservations:true});
 assert.equal(raw.trace.status,'completed');assert.equal(raw.stdout,c.stdout);
 const original=structuredClone(raw),inference=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations.plan,observedTrace:raw.observations.trace});
 assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.deepEqual(raw,original);
 Object.assign(c,createInferenceView(raw,inference));c.original=structuredClone({plan:c.plan,trace:c.trace});
 c.candidate=c.trace.structures.find(s=>s.kind===c.kind);assert.ok(c.candidate,c.kind);
 c.pos=new Map(c.trace.events.map((e,i)=>[e.eventId,i]));c.output=tag=>c.trace.events.find(e=>e.action==='output'&&e.text.startsWith(tag)).eventId;
}});
function limited(c,maxStates){const s=c.build(c.plan,c.trace,{maxStates}).find(s=>s.id===c.candidate.id);assert.ok(s);
 const trace={...c.trace,structures:c.trace.structures.map(x=>x.id===s.id?s:x)};
 validateStructureTrace(c.plan,trace);return {s,trace};}
for(const c of cases)test(`${c.name}: omitted intermediate states are unavailable to queries, conditions and recommendations`,()=>{
 const {s,trace}=limited(c,2),at=c.output('B'),target={structureId:s.id};
 const q=c.query(trace,{candidateId:s.id,afterExecutionId:at});
 assert.equal(q.state?.historyGap,true,'a discarded state must not reuse an old success');
 assert.equal(q.state.status,'incomplete');assert.equal(q.historyGap,true);
 assert.ok(!recommendStructureViews(trace,{target,afterExecutionId:at}).some(r=>r.view===c.view));
 if(c.kind==='sequence-lookup-candidate'){
  const relations=queryStructureRelations(trace,{candidateId:s.id,afterExecutionId:at}).relations;
  assert.ok(relations.length);assert.ok(relations.every(r=>r.historyGap&&!r.complete));
  assert.equal(queryStructureConditions(trace,{target,expected:'tree',afterExecutionId:at}).assessment,'incomplete');
  const preferences=setStructurePresentation(null,trace,{target,view:'tree'}),manual=resolveStructurePresentation(trace,{target,afterExecutionId:at,preferences});
  assert.equal(manual.mode,'manual');assert.equal(manual.view,'tree');assert.equal(manual.expectationCheck.assessment,'incomplete');
 }
 assert.deepEqual({plan:c.plan,trace:c.trace},c.original);
});
for(const c of cases)test(`${c.name}: retained prefix and complete latest snapshot stay usable, including a one-slot budget`,()=>{
 const first=c.pos.get(c.output('A')),prefix=c.candidate.states.filter(st=>c.pos.get(st.afterExecutionId)<=first).length;
 for(const budget of [1,2,prefix+1,c.candidate.states.length+1]){
  const {s,trace}=limited(c,budget),last=s.states.at(-1),target={structureId:s.id},query=id=>c.query(trace,{candidateId:s.id,afterExecutionId:id});
  assert.ok(s.states.length<=budget);assert.equal(query(last.afterExecutionId).historyGap,false);
  assert.deepEqual(query(last.afterExecutionId).state,last);
  assert.ok(recommendStructureViews(trace,{target,afterExecutionId:last.afterExecutionId}).some(r=>r.view===c.view),'a newly observed full state restores the recommendation');
  if(budget===1){assert.equal(query(c.output('B')).historyGap,true);assert.equal(query(c.output('B')).state,null);}
  if(budget>=prefix+1){assert.equal(query(c.output('A')).historyGap,false);assert.ok(!query(c.output('A')).state.historyGap);}
  const before=c.trace.events[c.pos.get(s.discoveredAtExecutionId)-1].eventId;assert.equal(query(before),null);
  assert.throws(()=>query('missing-event'),RangeError);
  // Queries must not lend callers mutable state from the saved inference.
  const q=query(last.afterExecutionId);q.state.status='caller-change';assert.notEqual(last.status,'caller-change');
 }
});
test('pointer-input trie: label evidence must support recommendation even without a history limit',()=>{
 const c=cases[0],target={structureId:c.candidate.id};
 assert.ok(recommendStructureViews(c.trace,{target}).some(r=>r.view==='trie'),'the observed input path should support a trie recommendation');
});
test('history intervals preserve exact boundaries and reject malformed coverage',()=>{
 const positions=new Map(['created','first','idle-a','second','idle-b','lost-a','idle-c','lost-b','idle-d','latest','idle-e'].map((id,i)=>[id,i])),
  candidate={states:[],coverage:stateHistoryCoverage(3)};
 for(const id of ['first','second','lost-a','lost-b','latest'])appendStateSnapshot(candidate.states,{afterExecutionId:id,status:'observed'},candidate.coverage);
 assert.deepEqual(candidate.states.map(s=>s.afterExecutionId),['first','second','latest']);
 assert.equal(candidate.coverage.omittedStates,2);assert.equal(candidate.coverage.historyGapFromExecutionId,'lost-a');
 for(const id of ['first','idle-a','second','idle-b','latest','idle-e'])assert.equal(stateHistoryGapAt(candidate,positions,positions.get(id)),false,id);
 for(const id of ['lost-a','idle-c','lost-b','idle-d'])assert.equal(structureStateAt(candidate,positions,positions.get(id)).historyGap,true,id);
 validateStateHistory(candidate,positions);
 for(const change of [{omittedStates:-1},{historyGapFromExecutionId:'latest'},{historyGapFromExecutionId:'first'},{historyGapFromExecutionId:'unknown'},{maxStates:2}]){
  assert.throws(()=>validateStateHistory({...candidate,coverage:{...candidate.coverage,...change}},positions),/생략 구간/);
 }
 for(const limit of [0,-1,1.5,NaN])assert.throws(()=>stateHistoryCoverage(limit),RangeError);
});
