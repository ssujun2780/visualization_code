import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,exitCode){
  const r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,exitCode);
  assert.deepEqual(r.plan.controlFlow.gaps,[]);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  return {...r,labels:new Map(r.plan.controlFlow.labels.map(l=>[l.id,l])),selects:r.trace.events.filter(e=>e.action==='switch')};
}

test('shared enum case labels retain separate compiler declarations and selected source labels',async()=>{
  const r=await inspect(`enum Flag{QUIET=4,WORK=9,STOP=12};
int route(enum Flag flag){int result=0;switch(flag){
case QUIET:
case STOP:result=3;break;
case WORK:result=7;break;
}return result;}
int main(void){return route(QUIET)+route(STOP)+route(WORK);}`,13);
  assert.deepEqual(r.selects.map(e=>e.selection.value),['4','12','9']);
  assert.deepEqual(r.selects.map(e=>r.labels.get(e.selection.labelId).source.line),[3,4,5]);
  assert.notEqual(r.selects[0].selection.labelId,r.selects[1].selection.labelId);
  assert.deepEqual(r.selects[0].selection.labelIds,r.selects[1].selection.labelIds);
  assert.equal(r.selects[0].selection.labelIds.length,2);assert.deepEqual(r.trace.flowTransitions,[]);
  for(const event of r.selects)assert.equal(r.labels.get(event.selection.labelId).value,event.selection.value);
});

test('negative enum labels converted to an unsigned switch match LLVM bit patterns without conflating shared cases',async()=>{
  const r=await inspect(`enum Mode{BELOW=-1,STILL=2,ABOVE=5};
int route(enum Mode mode){switch((unsigned int)mode){
case BELOW:
case ABOVE:return 8;
default:return 1;
}}
int main(void){return route(BELOW)+route(ABOVE)+route(STILL);}`,17);
  assert.deepEqual(r.selects.map(e=>e.selection.kind),['case','case','default']);
  assert.deepEqual(r.selects.slice(0,2).map(e=>e.selection.value),['-1','5']);
  assert.deepEqual(r.selects.map(e=>r.labels.get(e.selection.labelId).source.line),[3,4,5]);
  assert.equal(r.selects[0].condition.unsigned,'4294967295');
  assert.notEqual(r.selects[0].selection.labelId,r.selects[1].selection.labelId);
  assert.deepEqual(r.selects[0].selection.labelIds,r.selects[1].selection.labelIds);
});
