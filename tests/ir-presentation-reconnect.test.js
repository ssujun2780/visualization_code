import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {defineStructureRelation,setStructurePresentation,clearStructurePresentation,resolveStructurePresentation,reconnectStructurePresentation,
  reconnectStructureSetting} from '../scripts/inference/index.mjs';
const int={kind:'integer',name:'int',sizeBits:32,signedness:'signed'},col=id=>({kind:'array',objectId:id,size:4,stride:4,count:3});
const artifact=new URL('../test-results/presentation-reconnect-2026-11-12/',import.meta.url);
const source=n=>({file:'unit.c',start:{byte:n},end:{byte:n+1}});
function fixture(prefix='a'){
 const trace={programId:'program',runId:prefix,objects:[],events:[],structures:[],frames:[{id:'f',functionId:'fn',parent:null}]},
   plan={programId:'program',source:{file:'unit.c',sha256:'same-source'},functions:[{id:'fn',source:source(0)}],instructions:[],declarations:[],types:[]};
 const event=e=>{const eventId=`${prefix}e${trace.events.length}`;trace.events.push({eventId,phase:'complete',activationId:'f',...e});return eventId;};
 event({kind:'SPACE',action:'frame.begin',frameId:'f'});
 const alloc=(site,values,storage='heap',address=4000)=>{
  const id=`${prefix}o${trace.objects.length}`,instructionId=`i${plan.instructions.length}`,declarationId=`d${plan.declarations.length}`;
  plan.instructions.push({id:instructionId,source:source(site),sourceNodeId:`ast${site}`,callee:storage==='heap'?'@calloc':undefined,declarationId:storage==='heap'?undefined:declarationId});
  const cType={kind:'array',sizeBits:values.length*32,count:values.length,elementType:int};
  if(storage!=='heap')plan.declarations.push({id:declarationId,kind:'VarDecl',source:source(site),cType});
  const createdBy=event({kind:'SPACE',action:'object.begin',storage,objectId:id,instructionId,size:values.length*4});
  trace.objects.push({id,createdBy,endedBy:null,cType,size:values.length*4,storage,frameId:'f',address,name:'sameName'});
  values.forEach((n,i)=>write(id,i*4,n));return id;
 };
 const write=(id,offset,n)=>event({kind:'WRITE',action:'write',target:{objectId:id,offset,size:4},value:{bits:`0x${BigInt.asUintN(32,BigInt(n)).toString(16)}`,cType:int}});
 const end=(id,reason='free')=>{const e=event({kind:'SPACE',action:'object.end',objectId:id,reason});trace.objects.find(o=>o.id===id).endedBy=e;return e;};
 const resize=(old,values,address=9000)=>{
  const oldObject=trace.objects.find(o=>o.id===old);end(old,'realloc-replaced');
  const id=alloc(80,values,'heap',address),begin=trace.events.find(e=>e.objectId===id&&e.action==='object.begin');
  begin.copiedFrom={objectId:old,offset:0,size:Math.min(oldObject.size,values.length*4)};return id;
 };
 const nodes=alloc(10,[7,8,9]),links=alloc(20,[1,2,-1]),properties=alloc(30,[4,5,6]),mark=()=>event({kind:'FLOW',action:'mark'});
 const relationBinding=defineStructureRelation(trace,{nodes:col(nodes),roots:[{kind:'index',value:0}],links:[{id:'hop',kind:'index',source:col(links),nullValues:[-1]}]}),
   conditionRules={properties:{p:{source:col(properties)}},conditions:[{id:'custom:positive',requires:['chain'],rules:[{kind:'value',property:'p',operator:'>',value:0}]}]};
 const save=()=>setStructurePresentation(null,trace,{plan,target:{objectId:nodes},view:'linked-list',expected:'custom:positive',relationBinding,conditionRules});
 return {trace,plan,nodes,links,properties,mark,save,resize,event,end,write,alloc};
}
const pairs=r=>r.edges.map(e=>[r.nodes.find(n=>n.id===e.from).index,r.nodes.find(n=>n.id===e.to).index]);
const view=(f,prefs,at,target=f.nodes)=>resolveStructurePresentation(f.trace,{target:{objectId:target},preferences:prefs,afterExecutionId:at,plan:f.plan});

test('realloc moves all relationships/properties atomically, preserves fixed ranges, and rewinds by event',()=>{
 const f=fixture(),prefs=f.save(),before=JSON.stringify({f,prefs}),A=f.mark();
 const n=f.resize(f.nodes,[7,8,9,0,0]),l=f.resize(f.links,[1,2,-1,0]),p=f.resize(f.properties,[4,-5,6,0]),B=f.mark();
 const x=view(f,prefs,B,n);assert.equal(x.mode,'manual');assert.equal(x.reconnection.status,'connected');
 assert.deepEqual(x.target.ranges,[{objectId:n,offset:0,size:20}]);
 assert.deepEqual(pairs(x.relationView.relations[0]),[[0,1],[1,2]]);assert.equal(x.expectationCheck.assessment,'contradicted');
 assert.deepEqual(new Map(x.reconnection.objectMappings.map(m=>[m.from,m.to])),new Map([[f.nodes,n],[f.links,l],[f.properties,p]]));
 assert.equal(x.relationView.relations[0].nodes.length,3); // added capacity is not automatically a new node
 const y=view(f,prefs,A);assert.equal(y.expectationCheck.assessment,'satisfied-observed');assert.equal(y.relationView.relations[0].nodes[0].range.objectId,f.nodes);
 const snap=JSON.stringify(f.trace);view(f,prefs,B);assert.equal(JSON.stringify(f.trace),snap);assert.equal(JSON.stringify(prefs),JSON.parse(before).prefs?JSON.stringify(JSON.parse(before).prefs):'');
});
test('same-address realloc is still a new identity; an intermediate replacement boundary is pending',()=>{
 const f=fixture(),prefs=f.save(),n=f.resize(f.nodes,[7,8,9],4000),end=f.trace.objects.find(o=>o.id===f.nodes).endedBy;
 assert.equal(view(f,prefs,end).reconnection.diagnostics[0].code,'replacement-not-observed');
 assert.equal(view(f,prefs,f.mark(),n).relationView.relations[0].nodes[0].range.objectId,n);
});
test('shrink of only a condition column blocks the entire setting without changing its rules',()=>{
 const f=fixture(),prefs=f.save(),snapshot=JSON.stringify(prefs),n=f.resize(f.nodes,[7,8,9,0]);f.resize(f.properties,[4]);
 const v=view(f,prefs,f.mark());assert.equal(v.reconnection.status,'reconnect-needed');assert.equal(v.reconnection.diagnostics[0].code,'mapped-range-out-of-bounds');
 assert.equal(v.locked,true);assert.equal(v.view,'linked-list');assert.equal(v.relationView,undefined);assert.equal(v.expectationCheck,undefined);assert.equal(JSON.stringify(prefs),snapshot);
 const clicked=view(f,prefs,f.mark(),n);assert.equal(clicked.locked,true);assert.equal(clicked.reconnection.status,'reconnect-needed');assert.equal(clicked.relationView,undefined);
 assert.equal(clearStructurePresentation(prefs,f.trace,{target:{objectId:n}}).overrides.length,0);
});
test('reset and replacement on the current realloc target affect only the selected slot',()=>{
 const f=fixture();let prefs=f.save();prefs=setStructurePresentation(prefs,f.trace,{target:{objectId:f.nodes},view:'array',slot:'secondary'});
 const n=f.resize(f.nodes,[7,8,9,0]),at=f.mark();
 const reset=setStructurePresentation(prefs,f.trace,{target:{objectId:n},view:'auto',afterExecutionId:at});
 assert.equal(reset.overrides.length,1);assert.equal(reset.overrides[0].slot,'secondary');
 const changed=setStructurePresentation(prefs,f.trace,{target:{objectId:n},view:'graph',expected:null,afterExecutionId:at});
 assert.equal(changed.overrides.length,2);assert.equal(view(f,changed,at,n).view,'graph');assert.equal(view(f,changed,at,n).reconnection.status,'connected');
});
test('failed realloc, ordinary copy, and address reuse do not resurrect the old storage',()=>{
 const f=fixture(),prefs=f.save();f.event({kind:'FLOW',action:'resume',value:{bits:'0x0'}});
 assert.equal(view(f,prefs,f.mark()).relationView.relations[0].nodes[0].range.objectId,f.nodes);
 const unrelated=f.alloc(99,[7,8,9]);f.trace.events.find(e=>e.objectId===unrelated&&e.action==='object.begin').copiedFrom={objectId:f.nodes,offset:0,size:12};
 assert.equal(view(f,prefs,f.mark()).relationView.relations[0].nodes[0].range.objectId,f.nodes);
 f.end(f.nodes);f.alloc(100,[7,8,9],'heap',4000);const v=view(f,prefs,f.mark());
 assert.equal(v.relationView.relations[0].alive,false);assert.equal(v.reconnection.objectMappings.find(m=>m.from===f.nodes).to,f.nodes);
});
test('rerun uses compiler anchors despite changed IDs and names, and preserves serialized conditions',()=>{
 const a=fixture('old'),prefs=JSON.parse(JSON.stringify(a.save())),b=fixture('new');b.trace.objects.forEach(o=>o.name='differentName');
 const original=JSON.stringify({a:a.trace,b:b.trace,prefs});
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.equal(r.pending.length,0);
 const v=view(b,r.preferences,b.mark());assert.deepEqual(pairs(v.relationView.relations[0]),[[0,1],[1,2]]);assert.equal(v.expectationCheck.assessment,'satisfied-observed');
 const expectedRules=structuredClone(prefs.overrides[0].conditionRules);expectedRules.properties.p.source.objectId=b.properties;
 assert.deepEqual(r.results[0].setting.conditionRules,expectedRules);
 const retry=reconnectStructurePresentation(r.preferences,{plan:b.plan,trace:b.trace,sourceScope:{programId:a.trace.programId,runId:a.trace.runId}});
 assert.equal(retry.pending.length,0);assert.equal(retry.preferences.overrides.length,2);
 assert.equal(JSON.stringify(prefs),JSON.stringify(JSON.parse(original).prefs));
});
test('source/layout changes, missing objects and duplicate source or target allocations remain pending',()=>{
 for(const kind of ['source','layout','missing','duplicate-source','duplicate-target']){
  const a=fixture('old'),b=fixture('new');if(kind==='duplicate-source')a.alloc(10,[1,2,3]);const prefs=a.save();
  if(kind==='source')b.plan.source.sha256='changed';if(kind==='layout')b.plan.types.push({kind:'Basic',name:'int',sizeBits:16});
  if(kind==='missing')b.trace.objects=b.trace.objects.filter(o=>o.id!==b.properties);if(kind==='duplicate-target')b.alloc(10,[1,2,3]);
  const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.equal(r.results[0].status,'reconnect-needed',kind);assert.equal(r.preferences.overrides.length,1);
  assert.deepEqual(r.pending[0].source,prefs.overrides[0]);assert.equal(view(b,r.preferences,b.mark()).pendingReconnections.length,1);
 }
});
test('new-run input without a compiler anchor never binds by reused object IDs',()=>{
 const a=fixture(),prefs=a.save(),b=fixture();b.trace.runId='other';delete prefs.overrides[0].reconnectAnchor;
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.equal(r.pending[0].diagnostics[0].code,'compiler-anchor-missing');
 assert.equal(reconnectStructureSetting(b.trace,prefs.overrides[0],{rerun:false}).diagnostics[0].code,'scope-mismatch');
});
test('competing old-run preferences stay pending instead of first-wins, and existing user choices win',()=>{
 const a=fixture('a'),b=fixture('b'),c=fixture('c'),prefs={schemaVersion:1,overrides:[...a.save().overrides,...b.save().overrides]};
 const r=reconnectStructurePresentation(prefs,{plan:c.plan,trace:c.trace});assert.equal(r.pending.length,2);assert.equal(r.preferences.overrides.length,2);
 const combined={schemaVersion:1,overrides:[...a.save().overrides,...c.save().overrides]};
 const conflict=reconnectStructurePresentation(combined,{plan:c.plan,trace:c.trace});assert.equal(conflict.pending[0].diagnostics[0].code,'conflicting-user-settings');
});
test('nested span/chain, roots and legacy condition-array candidates all rebind',()=>{
 const a=fixture('a'),b=fixture('b');
 for(const f of [a,b])f.trace.structures.push({id:`array-${f.trace.runId}`,kind:'array',objectId:f.properties,range:{objectId:f.properties,offset:0,size:12},capacity:3,elementBytes:4});
 const binding=defineStructureRelation(a.trace,{nodes:col(a.nodes),roots:[{kind:'index',source:{kind:'slot',objectId:a.links,offset:0,size:4}}],links:[
  {id:'span',kind:'index',nullValues:[-1],source:{kind:'span',storage:col(a.links),start:0,count:{kind:'slot',objectId:a.nodes,offset:0,size:4}}},
  {id:'chain',kind:'index',nullValues:[-1],source:{kind:'chain',entries:col(a.links),head:{kind:'index',source:col(a.links),nullValues:[-1]},next:{kind:'index',source:{kind:'field',offset:0,size:4},nullValues:[-1]},item:{kind:'field',offset:0,size:4}}}
 ]});
 const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{objectId:a.nodes},view:'graph',relationBinding:binding,conditionBindings:{key:{kind:'array',arrayId:'array-a'}}});
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.equal(r.pending.length,0);
 const s=r.results[0].setting;assert.equal(s.relationBinding.links[0].source.storage.objectId,b.links);assert.equal(s.relationBinding.links[1].source.entries.objectId,b.links);
 assert.equal(s.relationBinding.roots[0].source.objectId,b.links);assert.equal(s.conditionBindings.key.arrayId,'array-b');
});
test('record templates and legacy record conditions move by compiler field layout, not type IDs',()=>{
 const a=fixture('a'),b=fixture('b');
 for(const f of [a,b]){const id=`record-${f.trace.runId}`;f.plan.types=[{id,kind:'Composite',name:'N',sizeBits:96,offsetBits:0,source:{line:1},elements:['member']},
  {id:'member',kind:'Derived',name:'hop',sizeBits:32,offsetBits:0,baseType:'pointer'},
  {id:'pointer',kind:'Derived',tag:'DW_TAG_pointer_type',sizeBits:32,baseType:id}];
  f.trace.objects[0].cType={kind:'record',name:'N',sizeBits:96,recordTypeId:id,members:[{name:'hop',typeId:'pointer',offsetBits:0,sizeBits:32}]};}
 const relationBinding=defineStructureRelation(a.trace,{nodes:{kind:'records',recordTypeId:'record-a'},links:[{id:'hop',kind:'pointer',source:{kind:'field',offset:0,size:4}}]}),
  prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{objectId:a.nodes},view:'tree',relationBinding,conditionBindings:{key:{kind:'record',recordTypeId:'record-a',offset:4,size:4}}});
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.deepEqual(r.pending,[]);
 assert.equal(r.results[0].setting.relationBinding.nodes.recordTypeId,'record-b');assert.equal(r.results[0].setting.conditionBindings.key.recordTypeId,'record-b');
});
test('compound comparison components rebind with their relations and preserve ordering directions',()=>{
 const a=fixture('a'),b=fixture('b'),loA=a.alloc(40,[-1,-1,-1]),loB=b.alloc(40,[-1,-1,-1]);
 const relationBinding=defineStructureRelation(a.trace,{nodes:col(a.nodes),roots:[{kind:'index',value:0}],links:[
  {id:'lo',kind:'index',source:col(loA),nullValues:[-1]},{id:'hi',kind:'index',source:col(a.links),nullValues:[-1]}]}),
  conditionRules={order:{components:[{source:col(a.nodes),direction:1},{source:col(a.properties),direction:-1}],roles:[
   {roleId:'lo',direction:'less',duplicates:'exclude'},{roleId:'hi',direction:'greater',duplicates:'exclude'}]}},
  prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{objectId:a.nodes},view:'bst',relationBinding,conditionRules});
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.deepEqual(r.pending,[]);
 assert.deepEqual(r.results[0].setting.conditionRules.order.components.map(x=>[x.source.objectId,x.direction]),[[b.nodes,1],[b.properties,-1]]);
 assert.equal(r.results[0].setting.relationBinding.links[0].source.objectId,loB);
 assert.equal(view(b,r.preferences,b.mark()).expectationCheck.assessment,'satisfied-observed');
});
test('automatic declarations and rooted candidate identities restore by physical anchors',()=>{
 const a=fixture('a'),b=fixture('b'),aa=a.alloc(40,[1,2,3],'automatic'),bb=b.alloc(40,[1,2,3],'automatic');
 for(const [f,id]of [[a,aa],[b,bb]])f.trace.structures.push({id:`root-${f.trace.runId}`,kind:'rooted-index-structure',root:{kind:'index-slot',objectId:id,offset:0,size:4}});
 const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:'root-a'},view:'custom-root',expected:null});
 const r=reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace});assert.deepEqual(r.pending,[]);assert.equal(r.results[0].setting.target.structureId,'root-b');
 const v=resolveStructurePresentation(b.trace,{target:{structureId:'root-b'},preferences:r.preferences});assert.equal(v.mode,'manual');
 // More than one candidate on the SAME root is not resolved by a new ID/name.
 b.trace.structures.push({...b.trace.structures[0],id:'alternate'});
 assert.equal(reconnectStructurePresentation(prefs,{plan:b.plan,trace:b.trace}).pending[0].diagnostics[0].code,'ambiguous-candidate');
});

const program=`#include <stdio.h>
#include <stdlib.h>
static int*storage(int count){return calloc(count,sizeof(int));}
int main(void){int flag=0;scanf("%d",&flag);int*extra=0;if(flag)extra=calloc(2,sizeof(int));
 int*nodes=storage(3);int*links=storage(3);int*marks=storage(3);
 if(!nodes||!links||!marks){free(nodes);free(links);free(marks);free(extra);return 1;}
 nodes[0]=7;nodes[1]=8;nodes[2]=9;links[0]=1;links[1]=2;links[2]=-1;marks[0]=4;marks[1]=5;marks[2]=6;puts("A");
 int*next=realloc(nodes,5*sizeof(int));if(!next){free(nodes);free(links);free(marks);free(extra);return 1;}nodes=next;
 marks[1]=-5;puts("B");free(nodes);free(links);free(marks);free(extra);return 0;}`;
test('actual C executions: changed allocation count, realloc and condition change match source predictions',async()=>{
 await mkdir(artifact,{recursive:true});await writeFile(new URL('reconnect.c',artifact),program);
 const runs=[];for(const input of ['0','1']){const r=await traceModel(program,{filename:'reconnect.c',stdin:input+'\n'});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,'A\nB\n');
  await writeFile(new URL(`run-${input}.json`,artifact),JSON.stringify({plan:r.plan,trace:r.trace,stdout:r.stdout}));runs.push(r);}
 const [a,b]=runs,at=(t,s)=>t.events.find(e=>e.text===s+'\n').eventId,
  pointee=(t,name)=>{const o=t.objects.find(o=>o.name===name);return t.events.find(e=>e.kind==='WRITE'&&e.target?.objectId===o.id&&e.value?.reference?.targetObjectId)?.value.reference.targetObjectId;},
  node=pointee(a.trace,'nodes'),links=pointee(a.trace,'links'),marks=pointee(a.trace,'marks'),
  binding=defineStructureRelation(a.trace,{nodes:col(node),roots:[{kind:'index',value:0}],links:[{id:'hop',kind:'index',source:col(links),nullValues:[-1]}]}),
  prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{objectId:node},view:'linked-list',relationBinding:binding,expected:'custom:positive',conditionRules:{properties:{p:{source:col(marks)}},conditions:[{id:'custom:positive',requires:['chain'],rules:[{kind:'value',property:'p',operator:'>',value:0}]}]}});
 const atA=resolveStructurePresentation(a.trace,{target:{objectId:node},preferences:prefs,afterExecutionId:at(a.trace,'A')});
 const atB=resolveStructurePresentation(a.trace,{target:{objectId:node},preferences:prefs,afterExecutionId:at(a.trace,'B')});
 assert.equal(atA.expectationCheck.assessment,'satisfied-observed');assert.equal(atB.expectationCheck.assessment,'contradicted');assert.deepEqual(pairs(atB.relationView.relations[0]),[[0,1],[1,2]]);
 const r=reconnectStructurePresentation(JSON.parse(JSON.stringify(prefs)),{plan:b.plan,trace:b.trace,afterExecutionId:at(b.trace,'A')});assert.deepEqual(r.pending,[]);
 const v=resolveStructurePresentation(b.trace,{target:{objectId:pointee(b.trace,'nodes')},preferences:r.preferences,afterExecutionId:at(b.trace,'B')});
 assert.equal(v.expectationCheck.assessment,'contradicted');assert.deepEqual(pairs(v.relationView.relations[0]),[[0,1],[1,2]]);
 await writeFile(new URL('comparison.json',artifact),JSON.stringify({predicted:{edges:[[0,1],[1,2]],A:'satisfied-observed',B:'contradicted'},actual:{A:atA.expectationCheck.assessment,B:atB.expectationCheck.assessment,edges:pairs(v.relationView.relations[0]),reconnection:r.results.map(x=>({status:x.status,objects:x.objectMappings}))}},null,2));
});
