import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace,queryStructureConditions,setStructurePresentation,resolveStructurePresentation,reconnectStructurePresentation} from '../scripts/inference/index.mjs';
const dir='test-results/pointer-policy-cache-2026-11-13',memo=new Map();
function source({numeric=false,inline=false,byValue=false,helper=false,siblings=false,reverse=false,detach=false}={}){
 const access=byValue?'.':'->',word=reverse?`b${access}tag,a${access}tag`:`a${access}tag,b${access}tag`,compare=numeric?`(a${access}tag>b${access}tag)-(a${access}tag<b${access}tag)`:`${helper?'lex':'strcmp'}(${word})`,arg=x=>byValue?`*${x}`:x;
 return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct Node {${byValue?'int rank;':''}${numeric?'int tag;':inline?'char tag[12];':'char *tag;'}${byValue?'':'int rank;'} struct Node *left,*right;} Node;
Node *root;Node *pool[4];char words[4][12]={"plum","apricot","apricot","kiwi"};int ranks[4]={1,5,9,2},keys[4]={4,2,2,3};
${helper?'int lex(const char*a,const char*b){return strcmp(a,b);}void attach(Node*a,Node*b){a->right=b;}':''}
int compare(${byValue?'Node a,Node b':'const Node*a,const Node*b'}){int z=${compare};return z?z:(a${access}rank<b${access}rank)-(a${access}rank>b${access}rank);}
Node* meld(Node*x,Node*y){if(!x)return y;if(!y)return x;if(compare(${arg('y')},${arg('x')})<0){Node*t=x;x=y;y=t;}
${siblings?'y->right=x->left;x->left=y;':`${helper?'attach(x,meld(x->right,y));':'x->right=meld(x->right,y);'}Node*t=x->left;x->left=x->right;x->right=t;`}return x;}
int main(void){int pad=0;scanf("%d",&pad);void*extra=pad?malloc(7):NULL;
for(int i=0;i<4;i++){pool[i]=calloc(1,sizeof(Node));if(!pool[i])return 1;${numeric?'pool[i]->tag=keys[i];':inline?'strcpy(pool[i]->tag,words[i]);':'pool[i]->tag=words[i];'}pool[i]->rank=ranks[i];root=meld(root,pool[i]);}
int checks=0;for(int i=0;i<4;i++)for(int j=0;j<4;j++)if(compare(${arg('pool[i]')},${arg('pool[j]')})<0)checks++;printf("%d\\n",checks);puts("P");
${numeric?'root->tag=99;':`strcpy(root->tag,"${reverse?'aaa':'zzz'}");`}puts("Q");
${detach?'Node*saved=root;root=meld(root->left,root->right);puts("D");for(int i=0;i<4;i++)if(pool[i]==saved)pool[i]=NULL;free(saved);puts("E");for(int i=0;i<4;i++)free(pool[i]);':'for(int i=0;i<4;i++)free(pool[i]);'}root=NULL;puts("Z");free(extra);return 0;}`;
}
async function run(name,code,stdout='6\nP\nQ\nZ\n',stdin='0\n'){
 const k=name+stdin;if(memo.has(k))return memo.get(k);await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/${name}.c`,code);await fs.writeFile(`${dir}/${name}.expected.json`,JSON.stringify({stdout,P:'satisfied',Q:'violated',nodes:4,edges:3},null,2));
 const raw=await traceModel(code,{filename:name+'.c',stdin,includeObservations:true});await fs.writeFile(`${dir}/${name}-${stdin.trim()}.execution.json`,JSON.stringify(raw));assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,stdout);
 const before=JSON.stringify(raw),inf=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations.plan,observedTrace:raw.observations.trace});await fs.writeFile(`${dir}/${name}-${stdin.trim()}.inference.json`,JSON.stringify(inf));assert.equal(inf.status,'completed',JSON.stringify(inf.diagnostics));assert.equal(JSON.stringify(raw),before);
 const r=createInferenceView(raw,inf);validateStructureTrace(r.plan,r.trace);memo.set(k,r);return r;
}
const pos=(r,id)=>r.trace.events.findIndex(e=>e.eventId===id),mark=(r,m)=>r.trace.events.find(e=>e.text===m+'\n').eventId,state=(r,s,m)=>s.states.findLast(st=>pos(r,st.afterExecutionId)<=pos(r,mark(r,m))),
 select=r=>r.trace.structures.find(s=>s.kind==='pointer-priority-candidate'&&s.comparisonPolicy?.functionId===r.plan.functions.find(f=>f.name==='compare')?.id&&r.trace.objects.find(o=>o.id===s.root.objectId)?.name==='root');
for(const [name,opt]of [['numeric', {numeric:true}],['string-pointer',{}],['string-value',{inline:true,byValue:true}],['string-helper',{inline:true,helper:true}],['string-helper-reverse',{inline:true,helper:true,reverse:true}],['string-sibling',{siblings:true}],['string-reverse',{reverse:true}]])test(`${name}: shared policy uses actual linked members, keys, order and lifetime`,async()=>{
 const r=await run(name,source(opt)),s=select(r);assert.ok(s,'observed comparator and link writes must connect to root');const p=state(r,s,'P');
 assert.equal(p.nodes.length,4);assert.equal(p.priorityEdges.length,3);assert.equal(p.min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');assert.equal(state(r,s,'Z').nodes.length,0);
 assert.deepEqual(p.keyOrder.map(k=>k.direction),[opt.reverse?-1:1,-1]);
 assert.deepEqual(new Set(p.nodes.map(n=>n.range.objectId)),new Set(r.trace.objects.filter(o=>o.storage==='heap'&&o.size===r.plan.types.find(t=>t.id===s.typeId)?.sizeBits/8).map(o=>o.id)));
 for(const st of s.states)assert.ok(st.evidenceExecutionIds.every(id=>pos(r,id)<=pos(r,st.afterExecutionId)));
 const prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'min-heap',afterExecutionId:mark(r,'P')}),v=resolveStructurePresentation(r.trace,{plan:r.plan,target:{structureId:s.id},preferences:prefs,afterExecutionId:mark(r,'Q')});assert.equal(v.mode,'manual');assert.equal(v.expectationCheck.assessment,'contradicted');
 const corrupt=structuredClone(r.trace);corrupt.structures.find(x=>x.id===s.id).proofs[0].linkWrites[0].offset++;assert.throws(()=>validateStructureTrace(r.plan,corrupt),/연결 변경 근거/);
});
test('linked policy selection reconnects on rerun; detached nodes and bounded history remain distinct',async()=>{
 const code=source({detach:true}),stdout='6\nP\nQ\nD\nE\nZ\n',a=await run('detach',code,stdout),b=await run('detach',code,stdout,'1\n'),s=select(a);assert.ok(s);
 for(const m of ['D','E']){assert.equal(state(a,s,m).nodes.length,3);assert.equal(state(a,s,m).min,'satisfied');}
 const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:s.id},view:'min-heap',afterExecutionId:mark(a,'P')}),restored=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace,afterExecutionId:mark(b,'P')});assert.deepEqual(restored.pending,[]);
 const view=resolveStructurePresentation(b.trace,{plan:b.plan,target:restored.results[0].setting.target,preferences:restored.preferences,afterExecutionId:mark(b,'Q')});assert.equal(view.expectationCheck.assessment,'contradicted');
 const other=structuredClone(b);select(other).comparisonPolicy.returnConvention='different-comparison-contract';
 assert.equal(reconnectStructurePresentation(prefs,{plan:other.plan,trace:other.trace,afterExecutionId:mark(other,'P')}).pending.length,1,'same root with a different comparison contract must not silently reconnect');
 const limited=inferStructures(a.plan,a.trace,{limits:{maxStates:2}});assert.equal(limited.status,'partial');assert.ok(limited.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(limited.diagnostics));
 const lt=createInferenceView(a,limited).trace;assert.equal(queryStructureConditions(lt,{candidateId:s.id,expected:'min-heap',afterExecutionId:mark(a,'P')}).assessment,'incomplete');validateStructureTrace(a.plan,lt);
});
test('printed comparison and incomplete tie policy do not invent a verified linked heap',async()=>{
 const code=source().replace('if(compare(y,x)<0)','if(1)').replace('if(compare(pool[i],pool[j])<0)checks++','if(i<j)checks++').replace('int checks=0;','printf("%d\\n",compare(pool[0],pool[1])<0);int checks=0;'),r=await run('unused-comparator',code,'0\n6\nP\nQ\nZ\n');assert.equal(r.trace.structures.filter(s=>s.comparisonPolicy).length,0);
 const partial=source().replace('for(int i=0;i<4;i++)for(int j=0;j<4;j++)if(compare(pool[i],pool[j])<0)checks++;','checks=6;').replace('{"plum","apricot","apricot","kiwi"}','{"plum","apricot","banana","kiwi"}'),p=await run('partial-policy',partial),s=select(p);assert.ok(s);assert.equal(state(p,s,'P').keyOrder,null);assert.equal(state(p,s,'P').min,'unknown');
});
