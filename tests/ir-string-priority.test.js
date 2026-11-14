import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace,queryStructureConditions,setStructurePresentation,resolveStructurePresentation,reconnectStructurePresentation,reconnectStructureSetting} from '../scripts/inference/index.mjs';
const out='test-results/string-priority-repro-2026-11-13',memo=new Map();
function source({inline=false,byValue=false,mixed=true,reversed=false,helper=false,dynamic=false}={}){
 const accessor=byValue?'.':'->',first=`a${accessor}label`,second=`b${accessor}label`,cmp=helper?'lex':'strcmp',args=reversed?`${second},${first}`:`${first},${second}`,
 body=mixed?`int result=${cmp}(${args});return result?result:(a${accessor}rank<b${accessor}rank)-(a${accessor}rank>b${accessor}rank);`:`return ${cmp}(${args});`,
 arg=i=>byValue?`store[${i}]`:`store+(${i})`,call=(a,b)=>`compare(${arg(a)},${arg(b)})`;
 return `#include <stdio.h>
#include <string.h>
#include <stdlib.h>
typedef struct {${inline?'char label[8];':'char *label;'} int rank;} Item;
${dynamic?'Item *store;':'Item store[8];'} int used=0;
char w0[8]="pear",w1[8]="apple",w2[8]="apple",w3[8]="melon";
${helper?'int lex(const char*x,const char*y){return strcmp(x,y);}':''}
int compare(${byValue?'Item a,Item b':'const Item*a,const Item*b'}){${body}}
void add(Item item){int cursor=used++;store[cursor]=item;while(cursor>0){int parent=(cursor-1)/2;if(!(0>(${call('cursor','parent')})))break;Item tmp=store[cursor];store[cursor]=store[parent];store[parent]=tmp;cursor=parent;}}
void observe(void){int checks=0;for(int i=0;i<used;i++)for(int j=0;j<used;j++)if(${call('i','j')}<0)checks++;printf("%d\\n",checks);}
int main(void){${dynamic?'int pad=0;scanf("%d",&pad);void *extra=pad?malloc(12):NULL;store=malloc(8*sizeof(Item));if(!store)return 1;':''}
${inline?'add((Item){"pear",1});add((Item){"apple",5});add((Item){"apple",9});add((Item){"melon",2});':'add((Item){w0,1});add((Item){w1,5});add((Item){w2,9});add((Item){w3,2});'}
observe();puts("P");${inline?'strcpy(store[0].label,':'strcpy(store[0].label,'}"${reversed?'aaa':'zzz'}");puts("Q");
${dynamic?'store=realloc(store,10*sizeof(Item));if(!store)return 1;observe();puts("R");free(store);free(extra);':''}return 0;}`;
}
async function load(name,code,expected,stdin=''){
 const key=name+stdin;if(memo.has(key))return memo.get(key);
 await mkdir(out,{recursive:true});await writeFile(`${out}/${name}.c`,code);await writeFile(`${out}/${name}.expected.json`,JSON.stringify(expected,null,2));
 const raw=await traceModel(code,{filename:name+'.c',stdin,includeObservations:true});await writeFile(`${out}/${name}-${stdin.trim()||'0'}.execution.json`,JSON.stringify(raw));
 assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,expected.stdout);
 const saved=JSON.stringify(raw),inference=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});
 await writeFile(`${out}/${name}-${stdin.trim()||'0'}.inference.json`,JSON.stringify(inference));assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(JSON.stringify(raw),saved);
 const r=createInferenceView(raw,inference);validateStructureTrace(r.plan,r.trace);memo.set(key,r);return r;
}
const pos=(r,id)=>r.trace.events.findIndex(e=>e.eventId===id),mark=(r,label)=>r.trace.events.find(e=>e.text===label+'\n').eventId,
 state=(r,s,label)=>s.states.findLast(st=>pos(r,st.afterExecutionId)<=pos(r,mark(r,label))),
 candidate=r=>{const fn=r.plan.functions.find(f=>f.name==='compare');return r.trace.structures.find(s=>s.kind==='composite-priority-candidate'&&s.paths.some(p=>r.trace.events.find(e=>e.eventId===r.trace.events.find(e=>e.eventId===p.returnExecutionId)?.callExecutionId)?.resolvedFunctionId===fn?.id)&&state(r,s,'P')?.nodes.length===4&&state(r,s,'P')?.keyOrder);};
for(const [name,options]of [['pointer-mixed',{}],['inline-mixed',{inline:true}],['inline-value',{inline:true,byValue:true}],['pointer-helper',{helper:true}],['reversed-string',{reversed:true}],['string-only',{mixed:false}]])test(`${name}: actual bytes and current storage determine heap order`,async()=>{
 const expected={stdout:`${options.mixed===false?5:6}\nP\nQ\n`,directions:options.mixed===false?[1]:[options.reversed?-1:1,-1],P:'satisfied',Q:'violated'},r=await load(name,source(options),expected),s=candidate(r);assert.ok(s,'string comparison policy and heap members');
 assert.deepEqual(state(r,s,'P').keyOrder.map(k=>k.direction),expected.directions);assert.equal(state(r,s,'P').min,expected.P);assert.equal(state(r,s,'Q').min,expected.Q);
 const f=state(r,s,'P').components.findIndex(f=>f.domain==='nul-terminated-bytes');assert.ok(f>=0);assert.equal(String.fromCharCode(...state(r,s,'P').nodes[0].values[f].value),options.reversed?'pear':'apple');
 const prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'min-heap',afterExecutionId:mark(r,'P')});
 for(const label of ['P','Q']){const view=resolveStructurePresentation(r.trace,{target:{structureId:s.id},preferences:prefs,afterExecutionId:mark(r,label),plan:r.plan});assert.equal(view.view,'min-heap');assert.equal(view.mode,'manual');assert.equal(view.expectationCheck.assessment,label==='P'?'satisfied-observed':'contradicted');}
 for(const st of s.states)assert.ok(st.evidenceExecutionIds.every(id=>pos(r,id)<=pos(r,st.afterExecutionId)));
 const bad=structuredClone(r.trace),p=bad.structures.find(x=>x.id===s.id).paths.flatMap(p=>p.comparisons).find(p=>p.kind==='string-comparison');p.operands[0].byteRange.offset++;
 assert.throws(()=>validateStructureTrace(r.plan,bad),/문자열 비교 실제/);
});
test('string policy, user condition, realloc and another execution reconnect together',async()=>{
 const code=source({dynamic:true}),expected={stdout:'6\nP\nQ\n6\nR\n'},a=await load('dynamic',code,expected,'0\n'),b=await load('dynamic',code,expected,'1\n'),s=candidate(a);assert.ok(s);
 const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:s.id},view:'min-heap',afterExecutionId:mark(a,'P')}),moved=reconnectStructureSetting(a.trace,prefs.overrides[0],{plan:a.plan,afterExecutionId:mark(a,'R')});assert.equal(moved.status,'connected',JSON.stringify(moved.diagnostics));assert.notEqual(moved.setting.target.structureId,s.id);
 assert.equal(queryStructureConditions(a.trace,{candidateId:moved.setting.target.structureId,expected:'min-heap',afterExecutionId:mark(a,'R')}).assessment,'contradicted');
 const relocated=a.trace.structures.find(x=>x.id===moved.setting.target.structureId),proof=state(a,relocated,'R').layoutEvidence;assert.equal(proof.relocationExecutionIds.length,2);
 const bad=structuredClone(a.trace);bad.events.find(e=>e.eventId===proof.relocationExecutionIds[0]).reason='free';
 assert.throws(()=>validateStructureTrace(a.plan,bad),/재할당 출처/,'ordinary copy must not establish realloc lineage');
 const restored=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace,afterExecutionId:mark(b,'P')});assert.deepEqual(restored.pending,[]);assert.equal(restored.results[0].setting.expected,'min-heap');
 const view=resolveStructurePresentation(b.trace,{target:restored.results[0].setting.target,preferences:restored.preferences,plan:b.plan,afterExecutionId:mark(b,'Q')});assert.equal(view.view,'min-heap');assert.equal(view.expectationCheck.assessment,'contradicted');
 const limited=inferStructures(a.plan,a.trace,{limits:{maxStates:2}});assert.equal(limited.status,'partial');
 assert.ok(limited.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(limited.diagnostics));
 const lt=createInferenceView(a,limited).trace,ls=lt.structures.find(x=>x.id===s.id);assert.ok(ls?.coverage?.omittedStates>0);assert.ok(ls.states.length<=2);
 validateStructureTrace(a.plan,lt);assert.equal(queryStructureConditions(lt,{candidateId:s.id,expected:'min-heap',afterExecutionId:mark(a,'P')}).assessment,'incomplete');
 const proofTree=lt.structures.find(x=>x.kind==='index-tree'&&x.proofStates?.length);assert.ok(proofTree,'retained dependent states need exact index checkpoints');
 const missing=structuredClone(lt);delete missing.structures.find(x=>x.id===proofTree.id).proofStates;assert.throws(()=>validateStructureTrace(a.plan,missing),/정확한 시점 근거/);
});
test('ended pointees, NULL and unterminated inline keys cannot retain a satisfied condition',async()=>{
 const code=source().replace('strcpy(store[0].label,"zzz");puts("Q");','char *word=malloc(8);if(!word)return 1;strcpy(word,"apple");store[0].label=word;puts("Q");free(word);puts("R");store[0].label=NULL;puts("S");'),
  r=await load('string-lifetime',code,{stdout:'6\nP\nQ\nR\nS\n'}),s=candidate(r);assert.ok(s);
 assert.equal(state(r,s,'Q').min,'satisfied');for(const label of ['R','S']){assert.equal(state(r,s,label).min,'unknown');assert.equal(state(r,s,label).nodes[0].values[0],null);}
 const inline=source({inline:true}).replace('strcpy(store[0].label,"zzz")',"memset(store[0].label,'x',sizeof store[0].label)"),v=await load('unterminated-inline',inline,{stdout:'6\nP\nQ\n'}),t=candidate(v);assert.ok(t);assert.equal(state(v,t,'Q').min,'unknown');
});
test('strcmp magnitude arithmetic and a same-named user function cannot establish string order',async()=>{
 for(const [name,code,stdout]of [
  ['magnitude',`#include <stdio.h>\n#include <string.h>\ntypedef struct{char key[4];} E;E a[2]={{"aa"},{"ab"}};int cmp(E*x,E*y){return strcmp(x->key,y->key)+1;}int main(void){printf("%d\\n",cmp(a,a+1)<0);return 0;}`,'0\n'],
  ['user-function',`#include <stdio.h>\ntypedef struct{char*key;} E;E a[2]={{"aa"},{"ab"}};int strcmp(const char*x,const char*y){return x==y?0:1;}int cmp(E*x,E*y){return strcmp(x->key,y->key);}int main(void){printf("%d\\n",cmp(a,a+1));return 0;}`,'1\n']]){
  const r=await load(name,code,{stdout});assert.ok(r.trace.structures.filter(s=>s.kind==='composite-priority-candidate').every(s=>!s.components.some(f=>f.domain==='nul-terminated-bytes')));
 }
});
