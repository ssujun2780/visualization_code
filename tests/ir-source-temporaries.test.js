import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,expected){
  const plain=await compileAndRun(source),r=await traceModel(source,{includeObservations:true});
  assert.equal(r.stdout,expected);assert.equal(r.stdout,plain.stdout);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  return {...r,defs,events,temporaries:r.trace.objects.filter(o=>defs.get(events.get(o.createdBy)?.instructionId)?.sourceTemporary)};
}

test('compound literal fields and copy retain type, source and actual initializer effects',async()=>{
  const r=await inspect(`#include <stdio.h>
#include <stdlib.h>
typedef struct {int q;int *z;} K;
int calls=0;
int produce(void){return ++calls;}
void fill(K *out,int *p,int skip){
 if(skip)return;
 *out=(K){.q=produce(),.z=p};
}
int main(void){int n=9;K *p=malloc(sizeof*p);fill(p,&n,1);fill(p,&n,0);
 printf("%d %d %d\\n",p->q,*p->z,calls);free(p);return 0;}`,'1 9 1\n');
  assert.equal(r.temporaries.length,1,'unreached literal has no visible source object');
  const temp=r.temporaries[0],begin=r.events.get(temp.createdBy),definition=r.defs.get(begin.instructionId);
  assert.equal(temp.cType.kind,'record');assert.equal(definition.source.line,8);assert.equal(definition.visibility,'source');
  const fieldWrites=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===temp.id);
  assert.deepEqual(fieldWrites.map(e=>r.defs.get(e.instructionId).memberPath),[['q'],['z']]);
  assert.equal(fieldWrites[0].value.cType.name,'int');assert.equal(fieldWrites[1].value.cType.kind,'pointer');
  const copy=r.trace.events.find(e=>e.action==='copy'&&e.sourceObjectId===temp.id);
  assert.ok(copy);assert.equal(copy.target.size,temp.size);
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@produce').length,1);
  assert.ok(r.trace.events.indexOf(copy)>r.trace.events.indexOf(fieldWrites.at(-1)));
  const malloc=r.trace.events.find(e=>e.action==='call'&&e.callee==='@malloc');
  assert.ok(r.trace.events.indexOf(begin)>r.trace.events.indexOf(malloc));
});

test('array and scalar compound literal addresses keep distinct source storage and live writes',async()=>{
  const r=await inspect(`#include <stdio.h>
int main(void){int seed=5;int *a=(int[]){seed,seed+1};int *b=&(int){seed+2};
 a[1]+=*b;*b=3;printf("%d %d %d\\n",a[0],a[1],*b);return 0;}`,'5 13 3\n');
  assert.equal(r.temporaries.length,2);
  const array=r.temporaries.find(o=>o.cType.kind==='array'),scalar=r.temporaries.find(o=>o.cType.name==='int');
  assert.ok(array&&scalar);assert.equal(array.size,8);assert.equal(scalar.size,4);assert.notEqual(array.id,scalar.id);
  for(const o of [array,scalar]){
    assert.ok(o.endedBy);assert.equal(r.defs.get(r.events.get(o.createdBy).instructionId).source.line,2);
    const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===o.id);
    assert.ok(writes.length>0);assert.ok(writes.every(e=>e.value?.cType?.name==='int'));
  }
});
