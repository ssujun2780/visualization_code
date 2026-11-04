import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

test('macro comparisons bind unsigned literal bit patterns to the actual source operands',async()=>{
  const r=await traceModel(`#include <assert.h>
#include <limits.h>
#define MATCH(a,b) ((a)==(b))
struct Item { unsigned key; };
int main(void){struct Item items[2]={{7},{UINT_MAX}};int cursor=1;
unsigned long long wide=ULLONG_MAX;
assert(items[cursor].key == UINT_MAX);
int same=MATCH(wide,ULLONG_MAX);
int different=MATCH(items[0].key,UINT_MAX);
assert(same);assert(!different);return 0;}`,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const comparisons=r.trace.events.filter(e=>e.kind==='CALC'&&e.operator==='==');
  assert.deepEqual(comparisons.map(e=>e.value.decimal),['1','1','0']);
  for(const e of comparisons){
    assert.ok(e.inputs.some(i=>i.executionId&&r.trace.events.find(x=>x.eventId===i.executionId)?.kind==='READ'));
    assert.ok(e.inputs.some(i=>i.value&&['4294967295','18446744073709551615'].includes(i.value.decimal??i.value.unsigned)));
  }
});
