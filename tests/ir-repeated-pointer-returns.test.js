import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);return r;
}
test('each invocation of the same pointer-returning call site uses that invocation allocation',async()=>{
  const r=await inspect(`#include <stdlib.h>
static int *make(void){return malloc(2*sizeof(int));}
int main(void){int *slots[3];for(int i=0;i<3;i++){slots[i]=make();if(!slots[i])return 2;slots[i][0]=i+4;}
int result=slots[0][0]+slots[1][0]+slots[2][0];for(int i=0;i<3;i++)free(slots[i]);return result-15;}`);
  const resumes=r.trace.events.filter(e=>e.action==='resume'&&r.plan.instructions.find(i=>i.id===e.instructionId)?.callee==='@make');
  assert.equal(resumes.length,3);
  assert.equal(new Set(resumes.map(e=>e.value.reference.targetObjectId)).size,3);
  assert.ok(resumes.every(e=>e.value.reference.status==='in-bounds'&&e.value.reference.targetOffset===0));
});
test('repeated pointer returns preserve each one-past origin and clear the previous origin on null',async()=>{
  const r=await inspect(`static int *end(int which,int *a,int *b){if(which==2)return 0;if(which)return b+3;return a+2;}
int main(void){int a[2]={0},b[3]={0};int *p=0;
for(int i=0;i<3;i++)p=end(i,a,b);return p!=0;}`);
  const events=r.trace.events.filter(e=>e.action==='resume'&&r.plan.instructions.find(i=>i.id===e.instructionId)?.callee==='@end');
  assert.equal(events.length,3);
  assert.deepEqual(events.map(e=>e.value.reference.status),['one-past','one-past','null']);
  const objects=new Map(r.trace.objects.map(o=>[o.id,o]));
  assert.deepEqual(events.slice(0,2).map(e=>objects.get(e.value.reference.targetObjectId).name),['a','b']);
  assert.equal(events[2].value.reference.targetObjectId,null);
});
