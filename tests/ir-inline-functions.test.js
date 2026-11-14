import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

function completed(r){
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.plan.coverage.unmappedObservations,[]);
}

test('static inline preserves one argument evaluation, independent frames, persistent statics and return delivery',async()=>{
  const r=await traceModel(`#include <stdio.h>
static inline int advance(int input){
 static int visits=0;
 int local=input+ ++visits;
 return local;
}
int main(void){
 int cursor=4;
 int first=advance(cursor++);
 int second=advance(cursor++);
 printf("%d %d %d\\n",cursor,first,second);
 return cursor+first+second-18;
}`);
  completed(r);assert.equal(r.stdout,'6 5 7\n');
  const f=r.plan.functions.find(f=>f.name==='advance');
  assert.equal(f.specifiers.inline,true);assert.equal(f.llvmLinkage,'internal');
  const calls=r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionId===f.id);
  assert.deepEqual(calls.map(e=>e.arguments[0].decimal),['4','5']);
  const frames=r.trace.frames.filter(a=>a.functionId===f.id);assert.equal(frames.length,2);
  assert.ok(frames.every(a=>a.ended));assert.notEqual(frames[0].id,frames[1].id);
  const locals=r.trace.objects.filter(o=>o.name==='local');assert.equal(locals.length,2);
  assert.ok(locals.every(o=>o.lifecycle==='ended'));
  const statics=r.trace.objects.filter(o=>o.name==='visits');assert.equal(statics.length,1);
  assert.equal(statics[0].storage,'static');assert.equal(statics[0].frameId,null);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  for(const call of calls){
    const delivery=r.trace.resultDeliveries.find(d=>d.callExecutionId===call.eventId);
    assert.equal(delivery.status,'delivered');assert.equal(events.get(delivery.consumer.executionId).action,'write');
  }
  for(const end of r.trace.events.filter(e=>e.action==='frame.end'))assert.ok(!end.endedObjects.includes(statics[0].id));
});

test('inline function pointers and recursion retain their function and activation identities',async()=>{
  const r=await traceModel(`static inline int descend(int n){return n?descend(n-1)+1:0;}
int main(void){int (*route)(int)=descend;return route(3)-3;}`);
  completed(r);
  const f=r.plan.functions.find(f=>f.name==='descend'),frames=r.trace.frames.filter(a=>a.functionId===f.id);
  assert.equal(frames.length,4);assert.equal(new Set(frames.map(a=>a.id)).size,4);
  assert.ok(frames.every(a=>a.ended));
  const call=r.trace.events.find(e=>e.action==='call'&&e.indirectTableIndex!==undefined);
  assert.equal(call.functionTarget.functionId,f.id);assert.equal(call.resolvedFunctionId,f.id);
  assert.equal(f.specifiers.inline,true);
});

test('AST redeclaration chains distinguish inline specifiers, emitted definitions and unused declarations',async()=>{
  const r=await traceModel(`extern inline int direct(int n){return n+1;}
inline int prototype(int);
int prototype(int n){return n+2;}
inline int later(int n){return n+3;}
extern int later(int);
static inline int unused(int n){return n+4;}
int main(void){return direct(1)+prototype(1)+later(1)-9;}`);
  completed(r);
  for(const name of ['direct','prototype','later']){
    const f=r.plan.functions.find(f=>f.name===name);
    assert.equal(f.specifiers.inline,true);assert.equal(f.llvmLinkage,'external');
    const chain=r.plan.functionDeclarations.filter(d=>f.declarationNodeIds.includes(d.nodeId));
    assert.equal(new Set(chain.map(d=>d.canonicalDeclarationId)).size,1);
    assert.ok(chain.some(d=>d.isDefinition&&d.nodeId===f.sourceNodeId));
    assert.ok(chain.every(d=>d.source?.editorRange&&d.allocatesFrame===false));
    if(name!=='direct')assert.equal(chain[1].previousDeclarationNodeId,chain[0].nodeId);
  }
  const unused=r.plan.functionDeclarations.find(d=>d.name==='unused');
  assert.equal(unused.isDefinition,true);assert.equal(unused.specifiers.inline,true);assert.equal(unused.functionId,null);
  assert.ok(!r.trace.frames.some(f=>f.functionName==='unused'));
  assert.equal(r.plan.functions.find(f=>f.name==='main').specifiers.inline,false);
});

test('missing external definitions fail before execution with one linked ERROR, for inline and ordinary functions',async()=>{
  for(const [source,name,inline] of [
    ['inline int offset(int n){return n+1;} int main(void){return offset(4);}','offset',true],
    ['int absent(int); int main(void){return absent(4);}','absent',false],
  ]){
    const r=await traceModel(source,{includeObservations:true});
    assert.equal(r.trace.status,'link-error');assert.equal(r.trace.coverage.execution,'not started');
    assert.equal(r.trace.coverage.workContracts.storageLedger,'unavailable');
    assert.deepEqual(r.trace.frames,[]);assert.deepEqual(r.trace.objects,[]);assert.equal(r.stdout,'');
    assert.equal(r.trace.events.length,1);const event=r.trace.events[0];
    assert.equal(event.kind,'ERROR');assert.equal(event.phase,'failed');assert.equal(event.evidence,'linker');
    const diagnostic=r.trace.diagnostics[0];assert.equal(diagnostic.eventId,event.eventId);
    const unresolved=diagnostic.unresolvedImports[0];assert.equal(unresolved.name,name);
    assert.ok(unresolved.source?.editorRange);
    assert.equal(unresolved.reason,inline?'inline-definition-without-external-definition':undefined);
    if(inline){
      const f=r.plan.functions.find(f=>f.id===unresolved.functionId);
      assert.equal(f.specifiers.inline,true);assert.equal(f.llvmLinkage,'available_externally');
      assert.ok(unresolved.help);
    }
    assert.equal(r.observations.trace.events.length,1);
  }
});
