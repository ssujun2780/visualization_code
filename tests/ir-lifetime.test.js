import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';

function inspect(result){
  const {plan,trace}=result,defs=new Map(plan.instructions.map(i=>[i.id,i])),events=new Map(trace.events.map(e=>[e.eventId,e]));
  return {...result,defs,events,line:e=>defs.get(e.instructionId)?.source?.line,
    at:id=>trace.events.findIndex(e=>e.eventId===id),named:name=>trace.objects.filter(o=>o.name===name)};
}

test('No7 ends block locals at their braces while keeping static state and frame cleanup',async()=>{
  const filename='examples/c/blind/No7.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
  const r=inspect(await traceModel(source,{filename,includeObservations:true}));
  const {trace,line,events,at}=r;
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,0);
  assert.equal(r.stdout,'10\n20\n31\n20\n10\n1 1\n2 1\n1 2 10\n');
  const objectAt=declarationLine=>trace.objects.find(o=>line(events.get(o.createdBy))===declarationLine);
  for(const [declaration,closing,next]of [[23,26,28],[19,29,31]]){
    const o=objectAt(declaration),end=events.get(o.endedBy);
    assert.equal(end.action,'object.end');assert.equal(end.reason,'scope-exit');assert.equal(line(end),closing);
    assert.ok(at(end.eventId)<at(trace.events.find(e=>e.action==='read'&&line(e)===next).eventId));
    assert.ok(!trace.events.some(e=>e.endedObjects?.includes(o.id)),'no repeated cleanup at main return');
    assert.ok(r.defs.get(end.instructionId).scopeId);assert.ok(r.defs.get(end.instructionId).declarationId);
  }
  const persistent=objectAt(6),locals=r.named('UXQJYSLGln');
  assert.equal(persistent.storage,'static');assert.equal(persistent.endedBy,null);
  assert.deepEqual(trace.events.filter(e=>e.action==='write'&&e.target?.objectId===persistent.id).map(e=>e.value.decimal),['1','2']);
  assert.equal(locals.length,2);assert.notEqual(locals[0].frameId,locals[1].frameId);
  for(const o of locals){assert.equal(events.get(o.endedBy).action,'frame.end');assert.deepEqual(events.get(o.endedBy).endedObjects,[o.id]);}
  assert.deepEqual(new Set(trace.events.at(-1).endedObjects),new Set([objectAt(33).id,objectAt(34).id]));
  assert.equal(trace.events.filter(e=>e.kind==='CALC').length,5);
  assert.deepEqual(trace.coverage.irGaps,[]);assert.deepEqual(trace.coverage.pendingCleanup,[]);
  assert.deepEqual(r.plan.coverage.unmappedObservations,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const raw=new Map(r.observations.trace.events.map(e=>[e.eventId,e]));
  for(const e of trace.events.filter(e=>e.action==='object.begin'&&e.storage==='automatic')){
    assert.equal(raw.get(e.reservationObservationId).action,'storage.reserve');
    assert.equal(raw.get(e.reservationObservationId).address,e.address);
  }
});

test('loop reentry creates fresh objects and continue/break end only exited scopes',async()=>{
  const r=inspect(await traceModel(`#include <stdio.h>
int main(void){
 int total=0;
 for(int i=0;i<4;i++){
  int v=i+10;
  if(i==0)continue;
  {int w=v;total+=w;if(i==2)break;}
 }
 printf("%d\\n",total);return 0;
}`));
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'23\n');
  const vs=r.named('v'),ws=r.named('w');assert.equal(vs.length,3);assert.equal(ws.length,2);
  assert.equal(new Set(vs.map(o=>o.id)).size,3);assert.equal(new Set(vs.map(o=>o.address)).size,1);
  assert.deepEqual(vs.map(o=>r.trace.events.find(e=>e.action==='write'&&e.target?.objectId===o.id).value.decimal),['10','11','12']);
  for(const o of [...vs,...ws,...r.named('i')]){
    const end=r.events.get(o.endedBy);assert.equal(end.action,'object.end');
    assert.ok(r.at(end.eventId)<r.at(r.trace.events.find(e=>e.action==='call'&&e.callee==='@printf').eventId));
  }
  for(let i=1;i<vs.length;i++)assert.ok(r.at(vs[i-1].endedBy)<r.at(vs[i].createdBy));
  assert.deepEqual(r.trace.coverage.sourceOrder.declarationReentries,[]);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
});

test('goto exits nested scopes; nested return cleanup is grouped without losing the value',async()=>{
  const r=inspect(await traceModel(`#include <stdio.h>
int f(int n){
 int root=1;
 {int outer=10;{int inner=20;if(n)return root+outer+inner;goto done;}}
done: return root;
}
int main(void){int a=f(1);int b=f(0);printf("%d %d\\n",a,b);return 0;}`));
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'31 1\n');
  const frames=r.trace.frames.filter(f=>f.functionName==='f');assert.equal(frames.length,2);
  const early=r.trace.objects.filter(o=>o.frameId===frames[0].id);
  for(const o of early)assert.equal(r.events.get(o.endedBy).action,'frame.end');
  for(const name of ['outer','inner']){
    const o=r.named(name).find(o=>o.frameId===frames[1].id);
    assert.equal(r.events.get(o.endedBy).action,'object.end');
    const later=r.trace.events.find(e=>e.activationId===frames[1].id&&e.action==='read'&&r.line(e)===5);
    assert.ok(r.at(o.endedBy)<r.at(later.eventId));
  }
  assert.deepEqual(r.trace.coverage.irGaps,[]);
});

test('prototypes allocate no frames; recursive frames end while static and returned heap survive',async()=>{
  const source=`#include <stdlib.h>
int *f(int);
int main(void){int *p=f(2);int result=*p;free(p);return result;}
int *f(int n){static int count=0;count++;if(n)return f(n-1);int *p=malloc(sizeof(int));*p=count;return p;}`;
  const compiled=await compileCToIR(source);assert.ok(compiled.plan.functions.length===2);
  const r=inspect(await traceModel(source));
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,3);
  const calls=r.trace.frames.filter(f=>f.functionName==='f');assert.equal(calls.length,3);
  assert.equal(r.named('count').length,1);assert.equal(r.named('count')[0].endedBy,null);
  const heap=r.trace.objects.find(o=>o.storage==='heap');assert.ok(heap);assert.equal(heap.frameId,null);
  const heapEnd=r.events.get(heap.endedBy);assert.equal(r.defs.get(heapEnd.instructionId).callee,'@free');
  for(const f of calls){const end=r.trace.events.find(e=>e.action==='frame.end'&&e.activationId===f.id);assert.ok(r.at(end.eventId)<r.at(heapEnd.eventId));assert.ok(!end.endedObjects.includes(heap.id));}
});

test('a pointer into an ended block faults before a read can be presented as valid',async()=>{
  const r=inspect(await traceModel('int main(void){int *p;{int x=7;p=&x;}return *p;}'));
  assert.equal(r.trace.status,'fault');assert.equal(r.trace.diagnostics[0].code,'use-after-lifetime');
  const [x]=r.named('x');assert.equal(r.events.get(x.endedBy).action,'object.end');
  const fault=r.trace.events.find(e=>e.kind==='ERROR');assert.ok(r.at(x.endedBy)<r.at(fault.eventId));
  assert.ok(!r.trace.events.some(e=>e.action==='read'&&e.target?.objectId===x.id));
});

test('a new loop lifetime cannot inherit the previous iteration initialization',async()=>{
  const r=inspect(await traceModel('int main(void){int sum=0;for(int i=0;i<2;i++){int value;if(i==0)value=9;sum+=value;}return sum;}'));
  assert.equal(r.trace.status,'fault');assert.equal(r.trace.diagnostics[0].code,'uninitialized-read');
  const values=r.named('value');assert.equal(values.length,2);assert.notEqual(values[0].id,values[1].id);
  assert.equal(values[0].address,values[1].address);assert.ok(r.at(values[0].endedBy)<r.at(values[1].createdBy));
  assert.equal(r.events.get(values[1].createdBy).initialized,false);
});
