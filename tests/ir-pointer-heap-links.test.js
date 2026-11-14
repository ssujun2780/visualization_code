import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace,queryStructureConditions,setStructurePresentation,reconnectStructurePresentation,reconnectStructureSetting} from '../scripts/inference/index.mjs';
const dir='test-results/candidate-heap-links-2026-11-12',memo=new Map();
function source({base=0,degree=2,address=false,helper=false,dynamic=false}={}){
 const ptr=i=>address?`&store[${i}]`:`store+(${i})`,compare=(a,b)=>`${helper?'relay':'precedes'}(${ptr(a)},${ptr(b)})`;
 const offset=1-(degree-1)*base;
 return `#include <stdio.h>
#include <stdlib.h>
typedef struct {int key; int tie;} Item;
${dynamic?'Item *store;':'Item store[10];'} int used=${base};
int precedes(const Item *a,const Item *b){if(a->key!=b->key)return a->key<b->key;return a->tie>b->tie;}
${helper?'int relay(const Item*a,const Item*b){return precedes(a,b);}':''}
void insert(Item item){int cursor=used++;store[cursor]=item;while(cursor>${base}){int ancestor=(cursor-(${offset}))/${degree};if(!${compare('cursor','ancestor')})break;Item tmp=store[cursor];store[cursor]=store[ancestor];store[ancestor]=tmp;cursor=ancestor;}}
Item remove_one(void){Item result=store[${base}];store[${base}]=store[--used];int cursor=${base};while(cursor*${degree}+(${offset})<used){int child=cursor*${degree}+(${offset});int first=child;for(int j=1;j<${degree}&&first+j<used;j++){if(${compare('first+j','child')})child=first+j;}if(!${compare('child','cursor')})break;Item tmp=store[cursor];store[cursor]=store[child];store[child]=tmp;cursor=child;}return result;}
int main(void){${dynamic?'int extra=0;scanf("%d",&extra);void *padding=extra?malloc(16):NULL;store=malloc(sizeof(Item)*10);if(!store)return 1;':''}
insert((Item){4,1});insert((Item){2,5});insert((Item){3,7});insert((Item){2,9});puts("P");
store[${base}].key=99;puts("Q");store[${base}].key=2;
${dynamic?'store=realloc(store,sizeof(Item)*12);if(!store)return 1;':''}
while(used>${base}){Item x=remove_one();printf("%d:%d ",x.key,x.tie);}puts("");${dynamic?'free(store);free(padding);':''}return 0;}
`;
}
async function inspect(name,code,input='',members=[[2,9],[2,5],[3,7],[4,1]]){
 const key=name+input;if(memo.has(key))return memo.get(key);await mkdir(dir,{recursive:true});
 const expected={stdout:'P\nQ\n2:9 2:5 3:7 4:1 \n',P:members,Q:'violated',endCount:0};
 await writeFile(`${dir}/${name}.c`,code);await writeFile(`${dir}/${name}.expected.json`,JSON.stringify(expected,null,2));
 const raw=await traceModel(code,{filename:`${name}.c`,stdin:input,includeObservations:true});assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,expected.stdout);
 await writeFile(`${dir}/${name}-${input.trim()||'0'}.execution.json`,JSON.stringify(raw));
 const before=JSON.stringify(raw),inference=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});
 await writeFile(`${dir}/${name}-${input.trim()||'0'}.inference.json`,JSON.stringify(inference));assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(JSON.stringify(raw),before);
 const r=createInferenceView(raw,inference);validateStructureTrace(r.plan,r.trace);memo.set(key,r);return r;
}
const pos=(r,id)=>r.trace.events.findIndex(e=>e.eventId===id),mark=(r,label)=>r.trace.events.find(e=>e.text===label+'\n').eventId;
const stateAt=(r,s,id)=>s.states.findLast(st=>pos(r,st.afterExecutionId)<=pos(r,id));
for(const [name,options]of [['pointer-offset',{}],['one-based-address',{base:1,address:true}],['nested-comparator',{helper:true}],['ternary-one-based',{base:1,degree:3}]])
test(`${name}: actual heap members, lexicographic order, transient violation and empty state`,async()=>{
 const members=options.degree===3?[[2,9],[4,1],[3,7],[2,5]]:[[2,9],[2,5],[3,7],[4,1]],r=await inspect(name,source(options),'',members),s=r.trace.structures.find(s=>s.kind==='composite-priority-candidate'&&s.states.some(st=>st.nodes.length===4));assert.ok(s,'comparator must connect to observed heap storage');
 const p=stateAt(r,s,mark(r,'P')),q=stateAt(r,s,mark(r,'Q')),base=options.base??0;
 assert.deepEqual(p.nodes.map(n=>n.values.map(v=>typeof v==='object'?Number(v.decimal):Number(v))),members);assert.equal(p.min,'satisfied');assert.equal(q.min,'violated');
 assert.deepEqual(p.nodes.map(n=>n.index),[base,base+1,base+2,base+3]);assert.deepEqual(p.edges,[{parent:base,child:base+1},{parent:base,child:base+2},{parent:options.degree===3?base:base+1,child:base+3}]);
 assert.equal(s.states.at(-1).activeRange.count,0);assert.equal(s.states.at(-1).nodes.length,0);
 assert.equal(queryStructureConditions(r.trace,{candidateId:s.id,afterExecutionId:mark(r,'P'),expected:'min-heap'}).assessment,'satisfied-observed');
 assert.equal(queryStructureConditions(r.trace,{candidateId:s.id,afterExecutionId:mark(r,'Q'),expected:'min-heap'}).assessment,'contradicted');
 const corrupt=structuredClone(r.trace),bad=corrupt.structures.find(x=>x.id===s.id).states.find(st=>st.nodes.length===4);bad.edges[0].parent=base+2;assert.throws(()=>validateStructureTrace(r.plan,corrupt),/부모 자식/);
 const wrongSource=structuredClone(r.trace),tree=wrongSource.structures.find(x=>x.id===p.indexStructureId),derived=tree.formulaEvidence.flatMap(f=>f.derivedAccesses??[])[0];assert.ok(derived);derived.range.offset+=tree.elementBytes;
 assert.throws(()=>validateStructureTrace(r.plan,wrongSource),/주소 출처/);
 const first=s.states.find(st=>st.indexStructureId);assert.ok(first.evidenceExecutionIds.every(id=>pos(r,id)<=pos(r,first.afterExecutionId)));assert.ok(s.states.filter(st=>pos(r,st.afterExecutionId)<pos(r,first.afterExecutionId)).every(st=>!st.nodes.length));
});
test('dynamic heap reruns preserve the selected policy despite unrelated allocations',async()=>{
 const code=source({dynamic:true}),a=await inspect('dynamic-comparator',code,'0\n'),b=await inspect('dynamic-comparator',code,'1\n'),s=a.trace.structures.find(s=>s.kind==='composite-priority-candidate'&&stateAt(a,s,mark(a,'P'))?.nodes.length===4);assert.ok(s);
 const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:s.id},view:'min-heap',afterExecutionId:mark(a,'P')}),restored=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace,afterExecutionId:mark(b,'P')});assert.deepEqual(restored.pending,[]);
 const dest=b.trace.structures.find(s=>s.id===restored.results[0].setting.target.structureId);assert.equal(stateAt(b,dest,mark(b,'P')).min,'satisfied');assert.equal(stateAt(b,dest,mark(b,'Q')).min,'violated');
 const afterResize=a.trace.events.find(e=>e.text==='2:9 ').eventId,following=reconnectStructureSetting(a.trace,prefs.overrides[0],{plan:a.plan,afterExecutionId:afterResize});assert.equal(following.status,'connected');
 const replacement=a.trace.structures.find(x=>x.id===following.setting.target.structureId);assert.notEqual(replacement.arrayId,s.arrayId);
 // The tie branch never executes after this realloc. Restore identity without
 // copying the old complete key policy into the new, incomplete evidence.
 assert.equal(stateAt(a,replacement,afterResize).keyOrder,null);assert.equal(stateAt(a,replacement,afterResize).min,'unknown');
 assert.equal(reconnectStructureSetting(a.trace,prefs.overrides[0],{plan:a.plan,afterExecutionId:mark(a,'P')}).setting.target.structureId,s.id);
});
test('unused index formulas and a standalone comparator do not invent heap members',async()=>{
 const code=`#include <stdio.h>
typedef struct{int key,tie;} E;E a[4]={{1,8},{2,7},{3,6},{4,5}};
int cmp(const E*x,const E*y){if(x->key!=y->key)return x->key<y->key;return x->tie>y->tie;}
int main(void){int i=3,p=(i-1)/2;printf("%d %d\\n",p,cmp(a,a+1));return 0;}`;
 const raw=await traceModel(code,{includeObservations:true});assert.equal(raw.trace.status,'completed');const inf=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});assert.equal(inf.status,'completed');
 const policies=inf.structures.filter(s=>s.kind==='composite-priority-candidate');assert.ok(policies.length);assert.ok(policies.every(s=>s.states.every(st=>st.nodes.length===0&&st.min==='unknown')));
});
