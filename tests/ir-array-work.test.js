import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {bindArrayWork,arrayWorkStructures} from '../scripts/model/array-work.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const before={objects:r.trace.objects.length,events:r.trace.events.length};
  bindArrayWork(r.plan);const [work]=arrayWorkStructures(r.plan,r.trace);assert.ok(work);
  assert.deepEqual(r.trace.structures.find(s=>s.kind==='array-work'),work);
  assert.deepEqual({objects:r.trace.objects.length,events:r.trace.events.length},before);
  for(const a of work.arrays){const existing=r.trace.structures.find(s=>s.id===a.arrayId);assert.ok(existing);assert.deepEqual(a.range,existing.range);}
  return {...r,work};
}

test('record copies keep storage lifetimes, whole-record transfers, and comparison operands',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {short tag;int weight;int payload;} Packet;
int main(void){Packet cloud[4]={{2,8,21},{5,3,34},{7,8,55},{9,1,89}};
for(int index=1;index<3;index++){Packet held=cloud[index];cloud[index]=cloud[0];cloud[0]=held;
if(held.weight>cloud[3].weight)printf("%d ",held.payload);}
printf("%d %d\\n",cloud[0].tag,cloud[1].tag);return 0;}`,'34 55 7 2\n');
  const {work:w,trace:t}=r;assert.equal(w.temporaries.length,2);
  for(const held of w.temporaries){
    assert.equal(held.semantics,'copied-value');assert.equal(held.isReference,false);assert.ok(held.endedBy);
    assert.ok(held.source.arrayId);assert.notEqual(held.source.objectId,held.target.objectId);
    assert.equal(held.comparisonExecutionIds.length,1);assert.ok(held.useExecutionIds.length>=2);
    assert.ok(!t.structures.some(s=>s.kind==='array'&&s.objectId===held.objectId));
  }
  const moves=w.transfers.filter(t=>t.source.arrayId&&t.target.arrayId);assert.equal(moves.length,2);
  assert.ok(moves.every(t=>t.mode==='range-copy'&&t.wholeElement&&t.size===12));
  assert.equal(w.comparisons.length,2);assert.ok(w.comparisons.every(c=>c.operands.some(o=>o.role==='copied-comparison-operand')));
  assert.ok(w.accesses.some(a=>a.cursors.length));
});

test('reordered parameters carry two array spans through recursion and retain every field write',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {int second;int first;} Cell;
void carry(Cell* destination,int stop,Cell* origin,int begin,int split){
for(int left=begin;left<split;left++){destination[left].first=origin[left].first;destination[left].second=origin[left].second;}
for(int right=split;right<stop;right++){destination[right].first=origin[right].first;destination[right].second=origin[right].second;}
for(int out=begin;out<stop;out++){origin[out].second=destination[out].second;origin[out].first=destination[out].first;}}
void relay(int stop,Cell* destination,int begin,Cell* origin){if(stop-begin<2)return;
int split=begin+(stop-begin)/2;relay(split,destination,begin,origin);relay(stop,destination,split,origin);carry(destination,stop,origin,begin,split);}
int main(void){Cell origin[4]={{9,2},{3,8},{6,4},{1,7}},destination[4];relay(4,destination,0,origin);
printf("%d %d\\n",origin[0].first,origin[3].second);return 0;}`,'2 1\n');
  const w=r.work,between=w.transfers.filter(t=>t.source.arrayId&&t.target.arrayId&&t.source.arrayId!==t.target.arrayId);
  assert.equal(w.arrays.length,2);assert.equal(between.length,32);
  assert.ok(between.every(t=>t.mode==='value-copy'&&!t.wholeElement&&t.size===4&&t.readExecutionId));
  const copies=w.activations.filter(a=>a.transferRuns.some(run=>run.sourceArrayId&&run.targetArrayId));assert.equal(copies.length,3);
  for(const a of copies){assert.equal(a.transferRuns.length,2);assert.equal(a.arrayIds.length,2);
    assert.equal(a.transferRuns[0].sourceArrayId,a.transferRuns[1].targetArrayId);
    assert.equal(a.transferRuns[0].targetArrayId,a.transferRuns[1].sourceArrayId);
    assert.ok(a.ranges.some(x=>x.status==='supported'&&x.end-x.start>=2));}
  const recursive=r.plan.functions.find(f=>f.name==='relay');
  const spans=w.activations.filter(a=>a.functionId===recursive.id).map(a=>a.ranges.filter(r=>r.status==='supported').map(r=>[r.start,r.end]));
  assert.equal(spans.length,7);for(const expected of [[0,4],[0,2],[0,1],[1,2],[2,4],[2,3],[3,4]])assert.ok(spans.some(rs=>rs.some(r=>JSON.stringify(r)===JSON.stringify(expected))));
});

test('copied scalar comparisons and pointer-based exchange preserve equal writes and empty recursive spans',async()=>{
  const r=await inspect(`#include <stdio.h>
int order(const int*a,const int*b){return (*a<*b)-(*a>*b);}
void rotate(int* destination,int* source){int box=*destination;*destination=*source;*source=box;}
void sweep(int* sequence,unsigned first,unsigned last){if(last-first<2)return;
int held=sequence[last-1];for(unsigned next=first;next+1<last;next++){(void)order(&held,&sequence[next]);}
rotate(&sequence[first],&sequence[last-1]);sweep(sequence,first,first);sweep(sequence,first+1,last);}
int main(void){int sequence[4]={7,1,9,7};sweep(sequence,0,4);printf("%d %d %d %d\\n",sequence[0],sequence[1],sequence[2],sequence[3]);return 0;}`,'7 7 1 9\n');
  const w=r.work,compared=w.temporaries.filter(t=>t.comparisonExecutionIds.length);
  assert.equal(compared.length,3);assert.equal(w.comparisons.length,12);
  for(const t of compared){assert.equal(t.isReference,false);assert.notEqual(t.objectId,t.origin.objectId);}
  const swap=r.plan.functions.find(f=>f.name==='rotate'),swaps=w.activations.filter(a=>a.functionId===swap.id);
  assert.equal(swaps.length,3);assert.ok(swaps.every(a=>a.transferIds.length===3));
  const equalWrites=w.transfers.filter(t=>swaps[0].transferIds.includes(t.id)&&t.target.arrayId);
  assert.equal(equalWrites.length,2);assert.notEqual(equalWrites[0].target.offset,equalWrites[1].target.offset);
  assert.equal(r.trace.events.find(e=>e.eventId===equalWrites[0].executionId).value.decimal,r.trace.events.find(e=>e.eventId===equalWrites[1].executionId).value.decimal);
  const fn=r.plan.functions.find(f=>f.name==='sweep'),groups=w.activations.filter(a=>a.functionId===fn.id);
  assert.equal(groups.length,7);
  for(const expected of [[0,4],[0,0],[1,4],[1,1],[2,4],[2,2],[3,4]])assert.ok(groups.some(a=>a.ranges.some(r=>r.start===expected[0]&&r.end===expected[1]&&r.status==='supported')));
  assert.ok(w.accesses.some(a=>a.sourceNodeIds.length===0&&a.status==='partial')); // Observed dereference helper remains usable without inventing an index AST.
});

test('changing bounds and incompatible comparison candidates retain uncertainty',async()=>{
  const r=await inspect(`#include <stdio.h>
void paint(int* memory,int start,int stop){for(int cursor=start;cursor<stop;cursor++){if(cursor<1)memory[3]=9;memory[cursor]=cursor+4;stop=2;}}
int main(void){int memory[4]={0};paint(memory,0,4);printf("%d %d\\n",memory[1],memory[2]);return 0;}`,'5 0\n');
  const ranges=r.work.activations.flatMap(a=>a.ranges);assert.ok(ranges.some(x=>x.status==='partial'&&x.bounds.to==='changing-bound'&&x.end===null));
  assert.ok(ranges.some(x=>x.status==='contradicted'&&x.contradictingExecutionIds.length));
  assert.ok(r.work.accesses.some(x=>x.direction==='write'));
  // Remove bound observations from this actual trace; the overlay must not
  // recover a value by running its source expression or reading a snapshot.
  const role=r.plan.structureBindings.arrayWork.ranges.find(x=>x.to.declarationId),parameterObjects=r.trace.objects.filter(o=>r.trace.events.some(e=>e.eventId===o.createdBy&&r.plan.instructions.find(d=>d.id===e.instructionId)?.declarationId===role.to.declarationId));
  const ids=new Set(parameterObjects.map(o=>o.id));
  const altered={...r.trace,events:r.trace.events.map(e=>ids.has(e.target?.objectId)?{...e,value:undefined}:e)};
  const [partial]=arrayWorkStructures(r.plan,altered);assert.ok(partial.activations.flatMap(a=>a.ranges).some(x=>x.bounds.to==='unavailable'&&x.status==='partial'));
});

test('returning an embedded array value preserves the return port without inventing memory storage',async()=>{
  const r=await inspect(`#include <stdio.h>
typedef struct {char tag;int cells[3];unsigned count;} Crate;
void append(Crate* box,int value){box->cells[box->count++]=value;}
int take(Crate* box){return box->cells[--box->count];}
int main(void){Crate box={0};append(&box,9);printf("%d\\n",take(&box));return 0;}`,'9\n');
  const returns=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.kind==='return-port'&&e.dataInputs.some(id=>r.work.accesses.some(a=>a.executionId===id&&a.direction==='read')));
  assert.equal(returns.length,1);assert.ok(!r.work.transfers.some(t=>t.executionId===returns[0].eventId));
  for(const t of r.work.transfers)for(const endpoint of [t.source,t.target]){
    const object=r.trace.objects.find(o=>o.id===endpoint.objectId);assert.ok(object);
    assert.ok(endpoint.offset>=0&&endpoint.size>=0&&endpoint.offset+endpoint.size<=object.size);
  }
});
