import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,validateStructureTrace,queryManagementRoles,queryStructureConditions,setStructurePresentation,reconnectStructurePresentation} from '../scripts/inference/index.mjs';
import {evaluateIntegerExpression} from '../scripts/inference/integer-expression.mjs';
const dir='test-results/inference-semantic-extensions-2026-11-13',memo=new Map(),hash=x=>createHash('sha256').update(x).digest('hex');
async function run(name,code,stdout,options={}){
 const {inferenceStatus='completed',...traceOptions}=options;
 if(memo.has(name))return memo.get(name);await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(`${dir}/${name}.c`,code);await fs.writeFile(`${dir}/${name}.expected.json`,JSON.stringify({sourceHash:hash(code),stdout},null,2));
 const raw=await traceModel(code,{filename:name+'.c',...traceOptions});await fs.writeFile(`${dir}/${name}.execution.json`,JSON.stringify(raw));assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,stdout);
 const before=hash(JSON.stringify(raw)),start=performance.now(),inference=inferStructures(raw.plan,raw.trace),elapsed=performance.now()-start;
 await fs.writeFile(`${dir}/${name}.inference.json`,JSON.stringify(inference));await fs.writeFile(`${dir}/${name}.metrics.json`,JSON.stringify({events:raw.trace.events.length,milliseconds:elapsed,outputBytes:JSON.stringify(inference).length,rss:process.memoryUsage().rss},null,2));
 assert.equal(inference.status,inferenceStatus,JSON.stringify(inference.diagnostics));assert.ok(inference.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(inference.diagnostics));assert.equal(hash(JSON.stringify(raw)),before);
 const r=createInferenceView(raw,inference);validateStructureTrace(r.plan,r.trace);memo.set(name,r);return r;
}
const pos=(r,id)=>r.trace.events.findIndex(e=>e.eventId===id),mark=(r,s)=>r.trace.events.find(e=>e.text===s+'\n')?.eventId,
 state=(r,s,label)=>s.states.findLast(st=>pos(r,st.afterExecutionId)<=pos(r,mark(r,label))),
 candidate=r=>r.trace.structures.find(s=>s.kind==='pointer-priority-candidate'&&s.comparisonPolicy?.functionId===r.plan.functions.find(f=>f.name==='order')?.id);
function heap({mode='prefix',byValue=false,n=4,pooled=false}={}){
 const numeric=mode==='mod',access=byValue?'.':'->',arg=x=>byValue?'*'+x:x;
 const expression=numeric?`((a${access}key%10)>(b${access}key%10))-((a${access}key%10)<(b${access}key%10))`:`${mode==='prefix'?'strncmp':'memcmp'}(a${access}key,b${access}key,${mode==='prefix'?2:3})`;
 return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct E{${byValue?'int tie;':''}${numeric?'int key;':'char key[4];'}${byValue?'':'int tie;'}struct E *lo,*hi;}E;
int order(${byValue?'E a,E b':'const E*a,const E*b'}){int d=${expression};return d?d:(a${access}tie<b${access}tie)-(a${access}tie>b${access}tie);}
E* join(E*a,E*b){if(!a)return b;if(!b)return a;if(order(${arg('b')},${arg('a')})<0){E*t=a;a=b;b=t;}a->hi=join(a->hi,b);E*t=a->lo;a->lo=a->hi;a->hi=t;return a;}
int main(void){E*root=0;E*pool[${n}];${pooled?`E*arena=calloc(${n},sizeof(E));if(!arena)return 1;`:''}int key[4]={14,22,32,43},rank[4]={1,5,9,2};char names[4][4]={{'a','z','A',0},{'a','a','Z',0},{'a','a','Q',0},{'a','m','B',0}};
${mode==='binary'?"names[0][1]=names[1][1]=names[2][1]=names[3][1]=0;names[0][2]='z';names[1][2]=names[2][2]='b';names[3][2]=(char)255;":''}
for(int i=0;i<${n};i++){E*p=${pooled?'arena+i':'calloc(1,sizeof(E))'};if(!p)return 1;pool[i]=p;${numeric?'p->key=key[i%4];':'memcpy(p->key,names[i%4],4);'}p->tie=rank[i%4];root=join(root,p);}
for(int i=0;i<4;i++)for(int j=0;j<4;j++){int z=order(${arg('pool[i]')},${arg('pool[j]')});if(i==j&&z!=0)return 2;}printf("%d\\n",root->tie);puts("P");
${numeric?'root->key=19;':"root->key[0]='z';"}puts("Q");${pooled?'free(arena);':`for(int i=0;i<${n};i++)free(pool[i]);`}root=0;puts("Z");return 0;}`;
}
for(const [name,options]of [['prefix',{}],['binary',{mode:'binary'}],['modulo',{mode:'mod'}],['modulo-value',{mode:'mod',byValue:true}]])test(`${name}: explicit comparison domain, exact members, changed key and lifetime`,async()=>{
 const r=await run(name,heap(options),'9\nP\nQ\nZ\n'),s=candidate(r);assert.ok(s,'comparator must reach the linked heap');
 const p=state(r,s,'P');assert.equal(p.nodes.length,4);assert.equal(p.priorityEdges.length,3);assert.equal(p.min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');assert.equal(state(r,s,'Z').nodes.length,0);
 assert.deepEqual(p.keyOrder.map(c=>c.direction),[1,-1]);const key=p.keyOrder[0],slot=p.components.findIndex(c=>c.id===key.id);assert.equal(key.domain,options.mode==='mod'?'transformed-integer':options.mode==='binary'?'fixed-bytes':'bounded-string-bytes');
 if(options.mode==='mod')assert.deepEqual(p.nodes.map(n=>n.values[slot]).sort(),['2','2','3','4']);else assert.equal(key.byteLimit,options.mode==='binary'?3:2);
 const bad=structuredClone(r.trace),ps=bad.structures.find(x=>x.id===s.id);ps.states.find(st=>st.nodes.length).nodes[0].values[0]='forged';assert.throws(()=>validateStructureTrace(r.plan,bad));
});
test('a typed derived key may use multiple fields of the same record',async()=>{
 // (14*2+1)%7=1, (22*2+5)%7=0, (27*2+9)%7=0,
 // (43*2+2)%7=4: the distinct tie fields exercise both tie directions.
 const code=heap({mode:'mod'}).replaceAll('a->key%10','(a->key*2+a->tie)%7').replaceAll('b->key%10','(b->key*2+b->tie)%7').replace('14,22,32,43','14,22,27,43').replace('root->key=19;','root->key=21;');
 const r=await run('multi-field-key-complete',code,'9\nP\nQ\nZ\n'),s=candidate(r);assert.ok(s);const p=state(r,s,'P'),key=p.keyOrder[0],slot=p.components.findIndex(c=>c.id===key.id);
 assert.equal(key.domain,'transformed-integer');assert.deepEqual(p.nodes.map(n=>n.values[slot]).sort(),['0','0','1','4']);assert.equal(p.min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');
});
test('bounded string comparison stops at an observed NUL before the bound',async()=>{
 const code=heap().replace('for(int i=0;i<4;i++){E*p=',"names[1][1]=names[2][1]=0;for(int i=0;i<4;i++){E*p=");
 const r=await run('prefix-nul-complete',code,'9\nP\nQ\nZ\n'),s=candidate(r);assert.ok(s);const p=state(r,s,'P'),slot=p.components.findIndex(c=>c.id===p.keyOrder[0].id);
 assert.ok(p.nodes.every(n=>n.values[slot].kind==='bytes'));assert.deepEqual(p.nodes.map(n=>n.values[slot].value.join(',')).sort(),['97','97','97,109','97,122']);assert.equal(p.min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');
});
test('unobserved primary or tie directions remain incomplete in new key domains',async()=>{
 const sources=[['multi-field-key',heap({mode:'mod'}).replaceAll('a->key%10','(a->key*2+a->tie)%7').replaceAll('b->key%10','(b->key*2+b->tie)%7').replace('root->key=19;','root->key=20;'),'5\nP\nQ\nZ\n'],
 ['prefix-nul',heap().replace('for(int i=0;i<4;i++){E*p=',"names[0][1]=names[1][1]=names[2][1]=names[3][1]=0;for(int i=0;i<4;i++){E*p="),'9\nP\nQ\nZ\n']];
 for(const [name,source,stdout]of sources){const r=await run(name,source,stdout),s=candidate(r);assert.ok(s);assert.equal(state(r,s,'P').keyOrder,null);assert.equal(state(r,s,'P').min,'unknown');}
});
const affine=(reverse=false,partial=false)=>`#include <stdio.h>
int v[4]={1,2,3,4},sum[8],mult[8],plus[8];
void build(int k,int l,int r){mult[k]=1;if(r-l==1){sum[k]=v[l];return;}int m=(l+r)/2;build(k*2,l,m);build(k*2+1,m,r);sum[k]=sum[k*2]+sum[k*2+1];}
void apply(int k,int a,int b,int length){sum[k]=${reverse?'b*length+a*sum[k]':'sum[k]*a+b*length'};mult[k]=${reverse?'a*mult[k]':'mult[k]*a'};plus[k]=${reverse?'b+a*plus[k]':'plus[k]*a+b'};}
void push(int k){int a=mult[k],b=plus[k];apply(k*2,a,b,2);${partial?'':'apply(k*2+1,a,b,2);'}${reverse?'plus[k]=0;mult[k]=1;':'mult[k]=1;plus[k]=0;'}}
int main(void){build(1,0,4);apply(1,2,3,4);apply(1,3,1,4);puts("A");push(1);puts("B");printf("%d %d %d %d %d\\n",sum[1],sum[2],sum[3],mult[1],plus[1]);return 0;}`;
for(const reverse of [false,true])test(`affine ${reverse?'reordered':'direct'}: two-tag composition and complete push use recorded versions`,async()=>{
 const r=await run('affine-'+reverse,affine(reverse),'A\nB\n100 38 62 1 0\n'),s=r.trace.structures.find(s=>s.tagSchema==='affine-pair');assert.ok(s,'paired affine tags must be recognized');
 const a=state(r,s,'A').nodes.find(n=>n.index===1),b=state(r,s,'B').nodes.find(n=>n.index===1);assert.deepEqual(a.pending,{multiply:6,add:10});assert.deepEqual(b.pending,{multiply:1,add:0});
 assert.equal(s.propagations.length,1);assert.deepEqual(s.propagations[0].childIndices,[2,3]);assert.ok(s.applications.every(p=>p.composition==='new-after-old'));
 const copy=structuredClone(r.trace);copy.structures.find(x=>x.id===s.id).propagations[0].childIndices.pop();assert.throws(()=>validateStructureTrace(r.plan,copy));
 const limited=inferStructures(r.plan,r.trace,{limits:{maxStates:2}});assert.ok(limited.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(limited.diagnostics));
});
test('half propagation is not a complete affine push',async()=>{const r=await run('affine-partial',affine(false,true),'A\nB\n100 38 7 1 0\n'),s=r.trace.structures.find(s=>s.tagSchema==='affine-pair');assert.ok(s);assert.equal(s.propagations.length,0);});
test('different parent tag versions cannot prove one complete affine push',async()=>{
 const code=affine().replace('apply(k*2+1,a,b,2);','mult[k]++;apply(k*2+1,mult[k],b,2);');
 const r=await run('affine-version-mismatch',code,'A\nB\n100 38 69 1 0\n'),s=r.trace.structures.find(s=>s.tagSchema==='affine-pair');assert.ok(s);assert.equal(s.propagations.length,0);
});
test('affine tag helpers and redundant local copies preserve the composition source',async()=>{
 const code=affine().replace('void apply(int k,int a,int b,int length){','void tm(int k,int a){int old=mult[k];mult[k]=old*a;} void ta(int k,int a,int b){int old=plus[k];plus[k]=old*a+b;} void apply(int k,int a,int b,int length){')
 .replace('mult[k]=mult[k]*a;plus[k]=plus[k]*a+b;','tm(k,a);ta(k,a,b);');
 const r=await run('affine-helpers',code,'A\nB\n100 38 62 1 0\n'),s=r.trace.structures.find(s=>s.tagSchema==='affine-pair');assert.ok(s);assert.deepEqual(state(r,s,'A').nodes.find(n=>n.index===1).pending,{multiply:6,add:10});assert.equal(s.propagations.length,1);
});
test('repeated affine helper calls cannot cross-pair writes from different updates',async()=>{
 const code=affine().replace('void push(int k){','void batch(int a,int b){apply(1,a,b,4);apply(1,a,b,4);} void push(int k){').replace('apply(1,2,3,4);apply(1,3,1,4);','batch(2,3);');
 const r=await run('affine-repeated',code,'A\nB\n76 30 46 1 0\n'),s=r.trace.structures.find(s=>s.tagSchema==='affine-pair');assert.ok(s);
 assert.equal(s.applications.filter(a=>a.index===1).length,2);assert.deepEqual(state(r,s,'A').nodes.find(n=>n.index===1).pending,{multiply:4,add:9});assert.equal(s.propagations.length,1);
});
const colors=(r=23,b=17,restore=true)=>`#include <stdio.h>
typedef struct T{int label,paint;struct T *l,*r;}T;
T a[3]={{2,${b},0,0},{1,${r},0,0},{3,${r},0,0}};T*root=a;
void flip(T*p){if(p->l->paint==${r}&&p->r->paint==${r}){p->l->paint=${b};p->r->paint=${b};p->paint=${r};}${restore?`root->paint=${b};`:''}}
int walk(T*p){return p?walk(p->l)+1+walk(p->r):0;}
int main(void){root->l=a+1;root->r=a+2;flip(root);printf("%d\\n",walk(root));puts("P");root->paint=${r};puts("Q");return 0;}`;
for(const [r,b]of [[23,17],[5,99]])test(`colour encoding ${r}/${b}: evidence first, later violations do not change meaning`,async()=>{
 const x=await run('color-'+r,colors(r,b),'3\nP\nQ\n'),roles=queryManagementRoles(x.trace,{afterExecutionId:mark(x,'P')}),role=roles.find(s=>s.role==='color');assert.ok(role?.suggestedMapping,'root restoration and observed rules must support an encoding');
 assert.equal(role.suggestedMapping.redValue,String(r));assert.equal(role.suggestedMapping.blackValue,String(b));assert.equal(role.mapping,null,'declaration meaning remains unasserted');
 assert.deepEqual(queryManagementRoles(x.trace,{afterExecutionId:mark(x,'Q')}).find(s=>s.role==='color').suggestedMapping,role.suggestedMapping);
 const limited=inferStructures(x.plan,x.trace,{limits:{maxStates:2}});assert.ok(limited.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(limited.diagnostics));
 const target={objectId:x.trace.objects.find(o=>o.name==='root').id},q=queryStructureConditions(x.trace,{target,expected:'red-black-rules',afterExecutionId:mark(x,'Q')});
 assert.ok(q.warnings.some(w=>w.code==='red-black-root-color'));
 assert.ok(q.candidates.some(c=>c.properties.color?.origin==='inferred-hypothesis'&&c.assessment==='contradicted'));
 const explicit=queryStructureConditions(x.trace,{target,expected:'red-black-rules',afterExecutionId:mark(x,'Q'),bindings:{color:{...role.binding,redValue:b,blackValue:r}}});
 assert.ok(explicit.candidates.length);assert.ok(explicit.candidates.every(c=>c.properties.color?.origin==='user'&&c.properties.color.blackValue===String(r)));
});
test('coupled states without root restoration leave colour encoding uncertain',async()=>{const x=await run('color-uncertain',colors(23,17,false),'3\nP\nQ\n');assert.ok(queryManagementRoles(x.trace,{afterExecutionId:mark(x,'P')}).filter(s=>s.role==='color').every(s=>s.suggestedMapping===null));});
test('typed derived keys respect remainder, unsigned wrap, overflow and zero division',()=>{
 const signed={sizeBits:32,signedness:'signed'},unsigned={sizeBits:8,signedness:'unsigned'},lit=(v,type=signed)=>({kind:'literal',value:String(v),type}),op=(operator,args,type=signed)=>({kind:'operation',operator,args,type});
 assert.equal(evaluateIntegerExpression(op('%',[lit(-22),lit(10)]),()=>null),'-2');assert.equal(evaluateIntegerExpression(op('+',[lit(250,unsigned),lit(10,unsigned)],unsigned),()=>null),'4');
 assert.equal(evaluateIntegerExpression(op('+',[lit(2147483647),lit(1)]),()=>null),null);assert.equal(evaluateIntegerExpression(op('/',[lit(1),lit(0)]),()=>null),null);
});
test('pooled records preserve both array storage and the selected linked structure',async()=>{
 const r=await run('pooled',heap({mode:'mod',pooled:true}),'9\nP\nQ\nZ\n'),s=candidate(r);assert.ok(s);const p=state(r,s,'P');assert.equal(p.nodes.length,4);assert.equal(new Set(p.nodes.map(n=>n.range.objectId)).size,1);assert.equal(p.min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');
 const size=p.nodes[0].range.size;assert.deepEqual(p.nodes.map(n=>n.range.offset).sort((a,b)=>a-b),[0,size,size*2,size*3]);assert.ok(r.trace.structures.some(a=>a.kind==='array'&&a.objectId===p.nodes[0].range.objectId&&a.capacity===4));
});
test('comparison length is a real contract; dynamic bounds cannot become a frozen key',async()=>{
 const code=heap().replace('int d=strncmp(a->key,b->key,2);','int bound=a->tie; if(bound>3)bound=3; int d=strncmp(a->key,b->key,bound);');
 // The existing C outcomes must first be derived separately: lengths 1,2,3
 // do not define one symmetric key order. No complete prefix policy is valid.
 const r=await run('dynamic-bound',code,'9\nP\nQ\nZ\n');assert.ok(r.trace.structures.filter(s=>s.comparisonPolicy).every(s=>!s.components.some(c=>c.domain==='bounded-string-bytes')));
});
test('a pair-dependent comparison cannot be replaced by independent transformed keys',async()=>{
 const code=`#include <stdio.h>
typedef struct{int a;}E;
int cmp(E x,E y){return ((x.a+y.a)&1)?x.a<y.a:x.a>y.a;}
int main(void){E p[3]={{1},{2},{3}};printf("%d%d%d%d\\n",cmp(p[0],p[1]),cmp(p[1],p[0]),cmp(p[0],p[2]),cmp(p[2],p[0]));return 0;}`;
 const r=await run('pair-dependent',code,'1001\n');assert.equal(r.trace.structures.filter(s=>s.kind==='composite-priority-candidate').length,0);
});
test('linked transformed keys grow, reconnect and keep input events unchanged',async()=>{
 // 32 nodes generate over 256 activation-local pointer roots. The existing
 // projection/history budgets apply, but the selected live heap must remain
 // complete. This is not permission to lose members or to accept failures.
 for(const n of [8,16,32]){const r=await run('scale-'+n,heap({mode:'mod',n}),'9\nP\nQ\nZ\n',{inferenceStatus:n===32?'partial':'completed'}),s=candidate(r);assert.ok(s);assert.equal(state(r,s,'P').nodes.length,n);assert.equal(state(r,s,'P').priorityEdges.length,n-1);assert.equal(state(r,s,'P').min,'satisfied');assert.equal(state(r,s,'Q').min,'violated');assert.equal(s.coverage.omittedStates,0);memo.delete('scale-'+n);global.gc?.();}
 const a=await run('rerun-a',heap({mode:'mod'}),'9\nP\nQ\nZ\n',{filename:'rerun.c'}),b=await run('rerun-b',heap({mode:'mod'}),'9\nP\nQ\nZ\n',{filename:'rerun.c'}),s=candidate(a);
 const prefs=setStructurePresentation(null,a.trace,{target:{structureId:s.id},plan:a.plan,view:'min-heap',afterExecutionId:mark(a,'P')}),result=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace,afterExecutionId:mark(b,'P')});assert.deepEqual(result.pending,[]);
});
