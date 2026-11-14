import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {defineStructureRelation,queryStructureRelations,queryStructureConditions,createStructureRelationInput,
  defineStructureConditionRules,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {inferExecutionRelations,validateExecutionRelations,createExecutionWorkQuery} from '../scripts/execution-relations/index.mjs';
const artifact=new URL('../test-results/user-relations-extension-2026-11-12/',import.meta.url);
const int={sizeBits:32,signedness:'signed',kind:'integer'};
function fixture(){
 const t={programId:'declarative',runId:'one',events:[],objects:[],structures:[]};
 const event=e=>{const eventId=`e${t.events.length}`;t.events.push({eventId,phase:'complete',...e});return eventId;};
 const alloc=(size,cType=null)=>{const id=`o${t.objects.length}`,createdBy=event({kind:'SPACE',action:'object.begin',objectId:id});t.objects.push({id,size,cType,createdBy,endedBy:null});return id;};
 const write=(id,offset,n,size=4,extra={})=>event({kind:'WRITE',action:'write',target:{objectId:id,offset,size},value:{bits:`0x${BigInt.asUintN(8*size,BigInt(n)).toString(16)}`,cType:int,...extra}});
 const array=values=>{const id=alloc(values.length*4,{kind:'array',elementType:int,count:values.length});values.forEach((n,i)=>write(id,4*i,n));return id;};
 const mark=()=>event({kind:'FLOW',action:'mark'}),end=id=>{const e=event({kind:'SPACE',action:'object.end',objectId:id});t.objects.find(o=>o.id===id).endedBy=e;return e;};
 return {t,event,alloc,write,array,mark,end};
}
const query=(t,b,at,options={})=>queryStructureRelations(t,{relationBinding:b,afterExecutionId:at,...options}).relations[0];
const check=(t,b,at,expected='tree',conditionRules=null)=>queryStructureConditions(t,{relationBinding:b,afterExecutionId:at,expected,conditionRules});
const pairs=r=>r.edges.map(e=>[r.nodes.find(n=>n.id===e.from).index,r.nodes.find(n=>n.id===e.to).index]);
const slot=id=>({kind:'slot',objectId:id,size:4});
const field=(offset,size=4)=>({kind:'field',offset,size});
const col=(id,offset=0,stride=4,count)=>({kind:'array',objectId:id,offset,stride,size:4,...count===undefined?{}:{count}});

function csr(){
 const f=fixture(),data=f.array([10,20,30,40]),offsets=f.array([0,2,3,3,3]),dst=f.array([1,2,3]),
   b=defineStructureRelation(f.t,{nodes:{kind:'array',objectId:data},roots:[{kind:'index',value:0}],links:[{id:'branch',kind:'index',source:{kind:'span',
     storage:col(dst),start:col(offsets,0,4,4),end:col(offsets,4,4,4)}}]});
 return {...f,data,offsets,dst,b};
}
test('unresolved pointer origins stay incomplete in both adjacency adapters',()=>{
 const f=fixture(),data=f.array([7]),heads=f.array([0]),entry=f.array([0,0]);
 f.write(heads,0,888,4,{reference:{status:'unknown'}});
 for(const source of [
   {kind:'span',storage:{kind:'indirect',pointer:col(heads),size:4},count:1},
   {kind:'chain',entries:{kind:'array',objectId:entry,size:8},head:{kind:'pointer',source:col(heads)},next:{kind:'pointer',source:field(4)},item:field(0)}
 ]){const b=defineStructureRelation(f.t,{nodes:{kind:'array',objectId:data},roots:[{kind:'index',value:0}],links:[{id:'x',kind:'index',source}]});
   const actual=check(f.t,b,f.mark());assert.equal(actual.assessment,'incomplete');assert.deepEqual(actual.warnings,[]);}
});
test('CSR and counted spans preserve individual identities, unused capacity, parallel edges and bad bounds',()=>{
 const f=csr(),A=f.mark();assert.deepEqual(pairs(query(f.t,f.b,A)),[[0,1],[0,2],[1,3]]);assert.equal(check(f.t,f.b,A).assessment,'satisfied-observed');
 f.write(f.dst,4,1);const B=f.mark(),parallel=query(f.t,f.b,B);assert.equal(parallel.edges.filter(e=>e.from===parallel.rootNodeIds[0]).length,2);
 assert.ok(check(f.t,f.b,B).warnings.some(w=>w.code==='multiple-parents'));
 f.write(f.offsets,4,9);const C=f.mark();assert.ok(check(f.t,f.b,C).warnings.some(w=>w.code==='relation-span-out-of-range'));
 assert.deepEqual(pairs(query(f.t,f.b,A)),[[0,1],[0,2],[1,3]]);
 const counts=f.array([2,1,0,0]),b=defineStructureRelation(f.t,{...f.b,links:[{...f.b.links[0],source:{kind:'span',storage:col(f.dst),start:col(f.offsets,0,4,4),count:col(counts)}}]});
 f.write(f.offsets,4,2);f.write(f.dst,4,2);assert.deepEqual(pairs(query(f.t,b,f.mark())),[[0,1],[0,2],[1,3]]);
 assert.equal(query(f.t,b,f.mark(),{relationLimits:{maxEdges:3}}).complete,false);
});

test('index adjacency lists distinguish graph cycles, container cycles, missing next and sentinels',()=>{
 const f=fixture(),data=f.array([7,8,9]),heads=f.array([1,-4,-4]),entries=f.array([2,-4,1,0]),
   b=defineStructureRelation(f.t,{nodes:{kind:'array',objectId:data},roots:[{kind:'index',value:0}],links:[{id:'out',kind:'index',source:{kind:'chain',
     entries:{kind:'array',objectId:entries,size:8,stride:8,count:2},head:{kind:'index',source:col(heads),nullValues:[-4]},
     next:{kind:'index',source:field(4),nullValues:[-4]},item:field(0)}}]});
 const A=f.mark(),r=query(f.t,b,A);assert.deepEqual(pairs(r),[[0,1],[0,2]]);assert.equal(check(f.t,b,A).assessment,'satisfied-observed');
 assert.ok(r.nodes[0].parts.some(p=>p.range.objectId===entries));
 f.write(entries,4,1);const B=f.mark();assert.ok(check(f.t,b,B).warnings.some(w=>w.code==='relation-container-cycle'));
 f.write(entries,4,-4);f.write(entries,0,0);const C=f.mark();assert.ok(check(f.t,b,C).warnings.some(w=>w.code==='relation-cycle'));
 f.event({kind:'WRITE',target:{objectId:entries,offset:12,size:4},initializationEvidence:'unobserved'});assert.equal(check(f.t,b,f.mark()).assessment,'incomplete');
});

test('explicit order checks ancestor bounds, duplicate policy and compound descending keys without inferring intention',()=>{
 const f=fixture(),keys=f.array([10,5,15,8]),lo=f.array([1,-1,-1,-1]),hi=f.array([2,3,-1,-1]),
   b=defineStructureRelation(f.t,{nodes:{kind:'array',objectId:keys},roots:[{kind:'index',value:0}],links:[
     {id:'small',kind:'index',source:col(lo),nullValues:[-1]},{id:'big',kind:'index',source:col(hi),nullValues:[-1]}]}),
   rules={order:{components:[{source:field(0)}],roles:[{roleId:'small',direction:'less',duplicates:'exclude'},{roleId:'big',direction:'greater',duplicates:'exclude'}]}};
 const A=f.mark();assert.equal(check(f.t,b,A,'bst-order').assessment,'not-checkable');assert.equal(check(f.t,b,A,'bst-order',rules).assessment,'satisfied-observed');
 f.write(keys,12,12);const B=f.mark(),bad=check(f.t,b,B,'bst-order',rules);assert.ok(bad.warnings.some(w=>w.code==='bst-ancestor-order'));
 assert.equal(check(f.t,b,B,'tree',rules).assessment,'satisfied-observed');assert.equal(bad.candidates[0].orderOrigin,'user');
 f.write(keys,12,10);const C=f.mark();assert.equal(check(f.t,b,C,'bst-order',rules).assessment,'contradicted');
 const allow=structuredClone(rules);allow.order.roles[0].duplicates='allow';assert.equal(check(f.t,b,C,'bst-order',allow).assessment,'satisfied-observed');
 const secondary=f.array([0,0,0,9]),composite=structuredClone(allow);composite.order.components.push({source:col(secondary),direction:-1});
 assert.equal(check(f.t,b,C,'bst-order',composite).assessment,'incomplete');
 assert.equal(check(f.t,b,f.mark(),'bst-order',composite).assessment,'satisfied-observed');
 const target={objectId:keys},preferences=JSON.parse(JSON.stringify(setStructurePresentation(null,f.t,{target,view:'bst',relationBinding:b,conditionRules:rules})));
 assert.equal(resolveStructurePresentation(f.t,{target,preferences,afterExecutionId:B}).expectationCheck.assessment,'contradicted');
});

test('custom conditions compose degree, priority, root property and reciprocal relationships',()=>{
 const f=fixture(),data=f.array([20,10,5]),next=f.array([1,2,-1]),back=f.array([-1,0,1]),
   b=defineStructureRelation(f.t,{nodes:{kind:'array',objectId:data},links:[{id:'f',kind:'index',source:col(next),nullValues:[-1]},{id:'b',kind:'index',source:col(back),nullValues:[-1]}]}),
   rules={properties:{weight:{source:field(0)}},conditions:[
     {id:'custom:links',requires:['graph'],rules:[{kind:'reciprocal',forwardRoleId:'f',reverseRoleId:'b'},{kind:'degree',direction:'out',roleIds:['f'],max:1}]},
     {id:'custom:queue-priority',requires:['custom:links'],rules:[{kind:'edge-order',property:'weight',operator:'>=',roleIds:['f']},{kind:'value',property:'weight',operator:'>',value:0}]}]};
 const A=f.mark(),normalized=JSON.parse(JSON.stringify(defineStructureConditionRules(f.t,rules)));
 assert.equal(check(f.t,b,A,'custom:queue-priority',normalized).assessment,'satisfied-observed');
 f.write(data,8,15);const B=f.mark();assert.ok(check(f.t,b,B,'custom:queue-priority',normalized).warnings.some(w=>w.code==='user-edge-order'));
 f.write(back,4,-1);const C=f.mark();assert.ok(check(f.t,b,C,'custom:queue-priority',normalized).warnings.some(w=>w.code==='user-reciprocal-link'));
 assert.throws(()=>defineStructureConditionRules(f.t,{conditions:[{id:'custom:a',requires:['custom:b'],rules:[{kind:'degree'}]},{id:'custom:b',requires:['custom:a'],rules:[{kind:'degree'}]}]}),/순환/);
 assert.throws(()=>defineStructureConditionRules(f.t,{conditions:[{id:'tree',rules:[{kind:'degree'}]}]}),/custom:/);
 const unknown={conditions:[{id:'custom:x',requires:['missing-rule'],rules:[{kind:'degree'}]}]};assert.equal(check(f.t,b,A,'custom:x',unknown).assessment,'not-checkable');
});

test('temporal storage input closes intervals on detach/reentry, bounds history and never changes its inputs',()=>{
 const f=csr(),A=f.mark();f.write(f.dst,4,1);const B=f.mark();f.write(f.dst,4,2);const C=f.mark();f.end(f.data);
 const before=JSON.stringify(f.t),normal=createStructureRelationInput(f.t,{relations:[f.b]}),positions=new Map(f.t.events.map((e,i)=>[e.eventId,i]));
 const active=(input,id,index)=>input.storageBindings.filter(b=>b.objectId===f.data&&b.offset===index*4&&positions.get(b.availableAtExecutionId)<=positions.get(id)&&
   (!b.invalidatedAtExecutionId||positions.get(b.invalidatedAtExecutionId)>positions.get(id)));
 assert.equal(active(normal,A,2).length,1);assert.equal(active(normal,B,2).length,0);assert.equal(active(normal,C,2).length,1);
 for(const maxStates of [1,2]){const r=createStructureRelationInput(f.t,{relations:[f.b],maxStates});assert.equal(r.status,'partial');assert.equal(active(r,B,2).length,0);assert.ok(r.diagnostics.some(d=>d.code==='user-relation-state-limit'));}
 const capped=createStructureRelationInput(f.t,{relations:[f.b],maxQueries:2});assert.equal(capped.status,'partial');assert.equal(active(capped,A,2).length,0);
 assert.equal(JSON.stringify(f.t),before);assert.throws(()=>createStructureRelationInput(f.t,{structureInference:{scope:{programId:'other',runId:'one'}}}),/다른 실행/);
});

async function run(name,source,stdout){
 const r=await traceModel(source,{filename:`${name}.c`});await mkdir(artifact,{recursive:true});await writeFile(new URL(`${name}.c`,artifact),source);
 await writeFile(new URL(`${name}.execution.json`,artifact),JSON.stringify(r));assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);return r;
}
const object=(t,name)=>t.objects.find(o=>o.name===name),mark=(t,s)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(s)).eventId;

test('actual C: CSR manual relation reaches the independent execution-relation analyzer and query',async()=>{
 const r=await run('csr-work',`#include <stdio.h>
int main(void){int v[4]={5,8,13,21};int rows[5]={0,2,3,3,3};int targets[3]={1,2,3};int total=0;
 puts("A");for(int i=0;i<4;i++)for(int k=rows[i];k<rows[i+1];k++)total+=v[targets[k]];
 printf("%d\\n",total);return 0;}`,'A\n42\n'),t=r.trace,b=defineStructureRelation(t,{nodes:{kind:'array',objectId:object(t,'v').id},roots:[{kind:'index',value:0}],links:[
   {id:'out',kind:'index',source:{kind:'span',storage:col(object(t,'targets').id),start:col(object(t,'rows').id,0,4,4),end:col(object(t,'rows').id,4,4,4)}}]});
 const before=JSON.stringify(r),input=createStructureRelationInput(t,{relations:[b]}),work=inferExecutionRelations(r.plan,t,{outputSchemaVersion:2,structureInference:input});
 assert.notEqual(work.status,'failed',JSON.stringify(work.diagnostics));validateExecutionRelations(r.plan,t,work,{structureInference:input});
 const accesses=work.relations.filter(e=>e.kind==='structure-access');assert.ok(accesses.length>0);
 assert.equal(work.capabilities.structures.status,'completed');
 for(const access of accesses){const storage=access.participants.find(p=>p.kind==='storage'),m=access.details.matchedRange;
   assert.equal(access.details.mappingOrigin,'user');
   assert.equal(m.objectId,storage.objectId);assert.ok(m.offset>=storage.offset&&m.offset+m.size<=storage.offset+storage.size);}
 assert.ok(accesses.some(e=>e.participants.some(p=>p.objectId===object(t,'targets').id)));assert.ok(accesses.some(e=>e.participants.some(p=>p.objectId===object(t,'v').id)));
 const q=createExecutionWorkQuery(r.plan,t,work,{schemaVersion:2,structureInference:input});assert.ok(q.at(mark(t,'42')));
 const forged=structuredClone(work);forged.relations.find(e=>e.kind==='structure-access').details.matchedRange.size=99999;
 assert.throws(()=>validateExecutionRelations(r.plan,t,forged,{structureInference:input}),/교집합/);
 assert.equal(JSON.stringify(r),before);assert.deepEqual(pairs(query(t,b,mark(t,'A'))),[[0,1],[0,2],[1,3]]);
 await writeFile(new URL('csr-work.results.json',artifact),JSON.stringify({expectedEdges:[[0,1],[0,2],[1,3]],input,work}));
});

test('record identity is counted once at an exact node budget, and typed conditions handle empty/unordered data',()=>{
 const f=fixture(),rt={kind:'record',recordTypeId:'R',sizeBits:64,members:[]},pt={kind:'pointer',pointee:rt,sizeBits:32},
   pool=f.alloc(16,{kind:'array',count:2,elementType:rt}),root=f.alloc(4,pt);
 f.write(root,0,100,4,{cType:pt,reference:{status:'in-bounds',targetObjectId:pool,targetOffset:0}});
 f.write(pool,4,108,4,{cType:pt,reference:{status:'in-bounds',targetObjectId:pool,targetOffset:8}});
 f.write(pool,12,0,4,{cType:pt,reference:{status:'null'}});
 const b=defineStructureRelation(f.t,{nodes:{kind:'records',recordTypeId:'R'},roots:[{kind:'pointer',source:slot(root)}],links:[{id:'next',kind:'pointer',source:field(4)}]});
 assert.equal(query(f.t,b,f.mark(),{relationLimits:{maxNodes:2}}).complete,true);
 const g=fixture(),data=g.array([0,0,0]),lo=g.array([1,-1,-1]),hi=g.array([2,-1,-1]),
   tree=defineStructureRelation(g.t,{nodes:{kind:'array',objectId:data},roots:[{kind:'index',value:0}],links:[{id:'L',kind:'index',source:col(lo),nullValues:[-1]},{id:'R',kind:'index',source:col(hi),nullValues:[-1]}]}),
   rules={order:{components:[{source:field(0),domain:'float'}],roles:[{roleId:'L',direction:'less',duplicates:'exclude'},{roleId:'R',direction:'greater',duplicates:'exclude'}]}};
 const floats=[2.5,1.25,9];for(let i=0;i<3;i++){const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,floats[i],true);g.write(data,i*4,v.getUint32(0,true));}
 assert.equal(check(g.t,tree,g.mark(),'bst-order',rules).assessment,'satisfied-observed');
 g.write(data,4,0x7fc00000);assert.equal(check(g.t,tree,g.mark(),'bst-order',rules).assessment,'incomplete');
 const empty=defineStructureRelation(g.t,{...tree,roots:[]});assert.equal(check(g.t,empty,g.mark(),'bst-order',rules).assessment,'satisfied-observed');
});

test('actual C: explicit mixed float/string key policy checks recorded field values and later pointer rebinding',async()=>{
 const {trace:t}=await run('manual-mixed-keys',`#include <stdio.h>
typedef struct N{double key;char*label;int low,high;}N;
int main(void){N a[3]={{2.5,0,1,2},{2.5,0,-1,-1},{8.5,0,-1,-1}};
 a[0].label="beta";a[1].label="alpha";a[2].label="gamma";puts("A");a[1].label="zeta";puts("B");return 0;}`,'A\nB\n');
 const a=object(t,'a'),m=n=>a.cType.elementType.members.find(m=>m.name===n),b=defineStructureRelation(t,{nodes:{kind:'array',objectId:a.id},roots:[{kind:'index',value:0}],links:
   ['low','high'].map(n=>({id:n,kind:'index',source:field(m(n).offsetBits/8,m(n).sizeBits/8),nullValues:[-1]}))}),
   conditionRules={order:{components:[{source:field(m('key').offsetBits/8,m('key').sizeBits/8),domain:'float'},
     {source:field(m('label').offsetBits/8,m('label').sizeBits/8),domain:'string',storage:'pointer'}],
     roles:[{roleId:'low',direction:'less',duplicates:'exclude'},{roleId:'high',direction:'greater',duplicates:'exclude'}]}};
 assert.equal(check(t,b,mark(t,'A'),'bst-order',conditionRules).assessment,'satisfied-observed');
 assert.equal(check(t,b,mark(t,'B'),'bst-order',conditionRules).assessment,'contradicted');
 assert.equal(check(t,b,mark(t,'A'),'bst-order',conditionRules).assessment,'satisfied-observed');
});

test('actual C: node-owned adjacency pointers track reallocation and zero length without invented links',async()=>{
 const {trace:t}=await run('indirect-spans',`#include <stdio.h>
#include <stdlib.h>
typedef struct V{int value;int n;int*edge;}V;
int main(void){V v[3]={{7,0,0},{8,0,0},{9,0,0}};v[0].edge=malloc(2*sizeof(int));if(!v[0].edge)return 1;
 v[0].edge[0]=1;v[0].edge[1]=2;v[0].n=2;puts("A");
 int*p=realloc(v[0].edge,3*sizeof(int));if(!p){free(v[0].edge);return 1;}v[0].edge=p;v[0].edge[2]=1;v[0].n=3;puts("B");
 free(v[0].edge);v[0].edge=0;v[0].n=0;puts("C");return 0;}`,'A\nB\nC\n');
 const v=object(t,'v'),members=v.cType.elementType.members,m=n=>members.find(m=>m.name===n),b=defineStructureRelation(t,{nodes:{kind:'array',objectId:v.id},roots:[{kind:'index',value:0}],links:[
   {id:'out',kind:'index',source:{kind:'span',storage:{kind:'indirect',pointer:field(m('edge').offsetBits/8,m('edge').sizeBits/8),size:4},count:field(m('n').offsetBits/8)}}]});
 assert.deepEqual(pairs(query(t,b,mark(t,'A'))),[[0,1],[0,2]]);assert.deepEqual(pairs(query(t,b,mark(t,'B'))),[[0,1],[0,2],[0,1]]);
 assert.equal(query(t,b,mark(t,'C')).edges.length,0);assert.equal(check(t,b,mark(t,'C')).assessment,'satisfied-observed');
 assert.deepEqual(pairs(query(t,b,mark(t,'A'))),[[0,1],[0,2]]);
});

test('actual C: linked adjacency entries stay distinct from graph nodes and preserve NULL termination',async()=>{
 const {trace:t}=await run('linked-adjacency',`#include <stdio.h>
#include <stdlib.h>
typedef struct E{int dest;struct E*next;}E;
int main(void){int values[3]={4,5,6};E*a=calloc(1,sizeof(E)),*b=calloc(1,sizeof(E));if(!a||!b)return 1;
 a->dest=1;b->dest=2;a->next=b;E*head[3]={0,0,0};head[0]=a;puts("A");
 a->next=0;puts("B");free(b);free(a);return 0;}`,'A\nB\n');
 const heads=object(t,'head'),rt=heads.cType.elementType.pointee,member=n=>rt.members.find(m=>m.name===n),b=defineStructureRelation(t,{nodes:{kind:'array',objectId:object(t,'values').id},roots:[{kind:'index',value:0}],links:[
   {id:'out',kind:'index',source:{kind:'chain',entries:{kind:'records',recordTypeId:rt.recordTypeId},head:{kind:'pointer',source:col(heads.id)},
     next:{kind:'pointer',source:field(member('next').offsetBits/8,member('next').sizeBits/8)},item:field(member('dest').offsetBits/8)}}]});
 assert.deepEqual(pairs(query(t,b,mark(t,'A'))),[[0,1],[0,2]]);assert.deepEqual(pairs(query(t,b,mark(t,'B'))),[[0,1]]);
 assert.equal(check(t,b,mark(t,'A')).assessment,'satisfied-observed');assert.ok(query(t,b,mark(t,'A')).edges.every(e=>e.evidenceExecutionIds.length>1));
});
