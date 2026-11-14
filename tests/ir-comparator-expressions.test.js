import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace} from '../scripts/inference/index.mjs';
import {comparatorUses} from '../scripts/inference/comparator-result.mjs';
import {createValueFlow} from '../scripts/inference/observed-value-flow.mjs';
import {addressIndexAccesses} from '../scripts/inference/address-index-evidence.mjs';
import {observedArrayPrefixes} from '../scripts/inference/observed-array-prefix.mjs';
const dir='test-results/composite-reconnect-comparators-2026-11-13';
const forms={
 'ternary-boolean':'return a->key != b->key ? a->key < b->key : a->tie > b->tie;',
 'ternary-sign':'return a->key != b->key ? (a->key>b->key)-(a->key<b->key) : (a->tie<b->tie)-(a->tie>b->tie);',
 'constant-branches':'if(a->key<b->key)return -7; if(a->key>b->key)return 9; if(a->tie>b->tie)return -7; if(a->tie<b->tie)return 9; return 0;',
 'logical-boolean':'return a->key<b->key || (a->key==b->key && a->tie>b->tie);'
};
function source(form,{reverse=false,helper=false,probe=true,byValue=false}={}){
 const bool=form.endsWith('boolean'),arg=a=>byValue?`*(${a})`:a,call=(a,b)=>`${helper?'relay':'compare'}(${arg(a)},${arg(b)})`,predicate=(a,b)=>bool?call(a,b):reverse?`${call(a,b)}>0`:`0>${call(a,b)}`;
 return `#include <stdio.h>
typedef struct { int key; int tie; } Item;
Item store[8];int used=0;
int compare(${byValue?'Item a,Item b':'const Item*a,const Item*b'}){${byValue?forms[form].replaceAll('->','.'):forms[form]}}
${helper?'int relay(const Item*a,const Item*b){int saved=compare(a,b);return saved;}':''}
void insert(Item item){int cursor=used++;store[cursor]=item;while(cursor>0){int parent=(cursor-1)/2;if(!(${predicate('store+cursor','store+parent')}))break;Item tmp=store[cursor];store[cursor]=store[parent];store[parent]=tmp;cursor=parent;}}
int main(void){insert((Item){4,1});insert((Item){2,5});insert((Item){3,7});insert((Item){2,9});
${probe?`int checks=0;for(int i=0;i<used;i++)for(int j=0;j<used;j++){if(${predicate('store+i','store+j')})checks++;}printf("%d\\n",checks);`:''}
puts("P");store[0].key=${reverse?-99:99};puts("Q");return 0;}`;
}
async function run(name,code,expected){
 await mkdir(dir,{recursive:true});await writeFile(`${dir}/${name}.c`,code);await writeFile(`${dir}/${name}.expected.json`,JSON.stringify(expected,null,2));
 const raw=await traceModel(code,{filename:`${name}.c`,includeObservations:true});await writeFile(`${dir}/${name}.execution.json`,JSON.stringify(raw));
 assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,expected.stdout);
 const before=JSON.stringify(raw),inf=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});await writeFile(`${dir}/${name}.inference.json`,JSON.stringify(inf));
 assert.equal(inf.status,'completed',JSON.stringify(inf.diagnostics));assert.equal(JSON.stringify(raw),before);
 const r=createInferenceView(raw,inf);validateStructureTrace(r.plan,r.trace);return r;
}
const pos=(r,id)=>r.trace.events.findIndex(e=>e.eventId===id),at=(r,s,label)=>s.states.findLast(st=>pos(r,st.afterExecutionId)<=pos(r,r.trace.events.find(e=>e.text===label+'\n').eventId));
for(const [form,options]of [['ternary-boolean',{}],['ternary-sign',{}],['constant-branches',{}],['logical-boolean',{}],['ternary-sign',{helper:true}],['ternary-sign',{reverse:true}],['ternary-boolean',{byValue:true}]]){
 const name=form+(options.helper?'-helper':'')+(options.reverse?'-reversed':'')+(options.byValue?'-value-copy':'');
 test(`${name}: source order, ties, actual heap membership, no future evidence`,async()=>{
  const expected={stdout:'6\nP\nQ\n',order:options.reverse?[-1,1]:[1,-1],P:'satisfied',Q:'violated'},r=await run(name,source(form,options),expected),candidates=r.trace.structures.filter(s=>s.kind==='composite-priority-candidate');
  const s=candidates.find(s=>at(r,s,'P')?.keyOrder?.length===2&&at(r,s,'P').nodes.length===4);assert.ok(s,'complete observed comparator must connect to actual heap');
  const p=at(r,s,'P'),q=at(r,s,'Q');assert.deepEqual(p.keyOrder.map(f=>f.direction),expected.order);assert.equal(p.min,expected.P);assert.equal(q.min,expected.Q);
  assert.deepEqual(p.nodes.map(n=>n.index),[0,1,2,3]);assert.deepEqual(p.edges,[{parent:0,child:1},{parent:0,child:2},{parent:1,child:3}]);
  for(const candidate of candidates)for(const st of candidate.states)assert.ok(st.evidenceExecutionIds.every(id=>pos(r,id)<=pos(r,st.afterExecutionId)),'future comparison evidence');
  if(form==='ternary-boolean'&&!options.byValue){
   const array=r.trace.structures.find(x=>x.id===s.arrayId),flow=createValueFlow(r.plan,r.trace),accesses=addressIndexAccesses(r.plan,r.trace,r.trace.structures.find(x=>x.kind==='array-work').accesses),context={events:r.trace.events,valueFlow:flow},
    prefix=observedArrayPrefixes(r.plan,context,array,{accesses});assert.equal(prefix.at(r.trace.events.find(e=>e.text==='P\n').eventId).count,4);
   assert.equal(prefix.at(r.trace.events[0].eventId),null);
   assert.equal(observedArrayPrefixes(r.plan,context,array,{accesses:accesses.filter(a=>a.target.index!==3)}).proofs.length,0,'missing last member cannot complete a scan');
   assert.equal(observedArrayPrefixes(r.plan,context,array,{accesses:accesses.map(a=>({...a,sourceNodeIds:[]}))}).proofs.length,0,'numeric indices without source provenance are insufficient');
  }
  if(options.byValue){
   const array=r.trace.structures.find(x=>x.id===s.arrayId),events=structuredClone(r.trace.events);
   for(const e of events)if(e.action==='argument'&&e.copiedFrom?.objectId===array.objectId)e.copiedFrom.offset+=array.elementBytes;
   const flow=createValueFlow(r.plan,{events});assert.equal(observedArrayPrefixes(r.plan,{events,valueFlow:flow},array).proofs.length,0,'copy origin must match the actual call input');
  }
  if(!form.endsWith('boolean')){
   const path=s.paths[0];assert.ok(pos(r,path.afterExecutionId)>pos(r,path.returnExecutionId));assert.equal(s.returnConvention,options.reverse?'>':'<');
   const bad=structuredClone(r.trace),p=bad.structures.find(x=>x.id===s.id).paths[0];p.interpretation.operandIndex=1-p.interpretation.operandIndex;assert.throws(()=>validateStructureTrace(r.plan,bad),/반환 실제 소비/);
  }
 });
}
test('missing tie branch and sign-changing conversion stay incomplete',async()=>{
 const code=`#include <stdio.h>
typedef struct{int key,tie;} Item;Item a[2]={{1,2},{3,4}};
int compare(const Item*x,const Item*y){return x->key!=y->key ? (x->key>y->key)-(x->key<y->key):(x->tie>y->tie)-(x->tie<y->tie);}
int main(void){int result=compare(a,a+1);printf("%d %d\\n",result<0,(unsigned)result<0U);return 0;}`;
 const r=await run('partial-and-cast',code,{stdout:'1 0\n'}),s=r.trace.structures.filter(s=>s.kind==='composite-priority-candidate');assert.ok(s.length);assert.ok(s.every(s=>s.states.every(st=>st.keyOrder===null&&st.min==='unknown')));
});
test('equal numeric results, changed results and narrowing do not establish caller convention',()=>{
 const ret={eventId:'ret',action:'return.value',activationId:'callee'},other={...ret,eventId:'other'},cast={eventId:'cast',kind:'CALC',steps:[{conversion:{fromType:{sizeBits:32,signedness:'signed'},toType:{sizeBits:8,signedness:'unsigned'}}}]},
 events=[ret,other,cast,...['ret','other','changed','cast'].map((id,i)=>({eventId:`use${i}`,activationId:'caller',steps:[{nodeId:`node${i}`,operator:'<',inputs:[{executionId:id},{value:{decimal:'0'}}]}]}))],c={events,pos:new Map(events.map((e,i)=>[e.eventId,i])),chain:id=>id==='ret'?[ret]:id==='other'?[other]:id==='cast'?[cast,ret]:[]};
 assert.deepEqual(comparatorUses(c,ret),[{operator:'<',executionId:'use0',sourceNodeId:'node0',operandIndex:0}]);
});
test('positive samples do not prove signed-key casts preserve ordering over their domain',async()=>{
 const code=`#include <stdio.h>
typedef struct{int key;} Item;Item a[2]={{1},{3}};
int compare(const Item*x,const Item*y){return (unsigned)x->key<(unsigned)y->key;}
int main(void){printf("%d\\n",compare(a,a+1));return 0;}`;
 const r=await run('signed-key-cast',code,{stdout:'1\n'});
 assert.ok(r.trace.structures.filter(s=>s.kind==='composite-priority-candidate').every(s=>s.states.every(st=>!st.keyOrder)));
});
