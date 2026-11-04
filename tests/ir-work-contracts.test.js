import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';
import {inspectWorkTrace} from '../scripts/model/work-contracts.mjs';

let result;
before(async()=>{
  result=await traceModel(`#include <stdio.h>
#include <stdlib.h>
int twice(int n){return n*2;}
int main(void){int values[2]={3,8};int *p=calloc(2,sizeof *p);
 if(!p)return 1;p[0]=twice(values[0]);printf("%d\\n",p[0]);free(p);return 0;}`);
  assert.equal(result.trace.status,'completed',JSON.stringify(result.trace.diagnostics));
  assert.equal(result.stdout,'6\n');assert.deepEqual(inspectWorkTrace(result.plan,result.trace),[]);
});
function reject(change,code){
  const trace=structuredClone(result.trace);change(trace);
  assert.ok(inspectWorkTrace(result.plan,trace).some(i=>i.code===code),code);
  assert.throws(()=>validateIRTrace(result.plan,trace));
}
test('scalar access and storage bounds are mandatory, including missing payloads',()=>{
  reject(t=>delete t.events.find(e=>e.action==='read').value,'memory-value');
  reject(t=>delete t.events.find(e=>e.action==='write').target,'memory-target');
  reject(t=>{t.events.find(e=>e.action==='write').target.offset=100000;},'memory-range');
});
test('copy snapshots and output bytes cannot silently disappear',()=>{
  reject(t=>delete t.events.find(e=>e.action==='copy').memoryState,'memory-snapshot-shape');
  reject(t=>{t.events.find(e=>e.action==='copy').memoryState.ranges[0].length--;},'memory-snapshot-completeness');
  reject(t=>delete t.events.find(e=>e.action==='output').bytesHex,'output-bytes');
});
test('object/frame lifetime and all dependency roles share a common validation boundary',()=>{
  reject(t=>{t.objects.find(o=>o.storage==='heap').endedBy=t.events.find(e=>e.action==='read').eventId;},'object-end');
  reject(t=>{t.events.find(e=>e.action==='frame.end').frameId='missing-frame';},'frame-identity');
  for(const key of ['dataInputs','addressInputs','controlInputs','calleeInputs'])reject(t=>{
    t.events.find(e=>e.action==='read')[key].push(t.events.at(-1).eventId);
  },'work-dependency-order');
});
