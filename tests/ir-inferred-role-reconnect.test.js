import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {testExecution} from './helpers/test-execution.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {coindexedRecordStructures} from '../scripts/inference/coindexed-record-views.mjs';
import {inferStructures,createInferenceView,recommendStructureViews,setStructurePresentation,resolveStructurePresentation,
  reconnectStructurePresentation,reconnectStructureSetting,defineStructureRelation,queryStorageReferences} from '../scripts/inference/index.mjs';
const dir=new URL('../test-results/inferred-role-reconnect-2026-11-12/',import.meta.url),clone=x=>structuredClone(x);
const field=(offset,size=4)=>({kind:'field',offset,size});
const equalSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
const at=(t,label)=>{const e=t.events.find(e=>e.text===label+'\n');assert.ok(e,`missing marker ${label}`);return e.eventId;};
const pos=(t,id)=>t.events.findIndex(e=>e.eventId===id);
const object=(t,name)=>{const o=t.objects.find(o=>o.name===name);assert.ok(o,`missing declaration ${name}`);return o;};
function pointee(t,name,when){const o=object(t,name),p=pos(t,when),writes=t.events.filter((e,i)=>i<=p&&e.kind==='WRITE'&&e.target?.objectId===o.id&&e.value?.reference?.targetObjectId);
 assert.ok(writes.length,`missing pointer assignment ${name}`);return writes.at(-1).value.reference.targetObjectId;}
function array(t,id,bytes){const candidates=t.structures.filter(s=>s.kind==='array'&&s.range?.objectId===id&&s.range.offset===0&&s.range.size===bytes);
 assert.equal(candidates.length,1,`expected one physical array for ${id}`);return candidates[0];}
function source(kind){
 const pointer=kind==='pointer',record=kind==='record',table=kind==='table';
 const globals=pointer?'typedef struct N{int key;struct N*a,*b;}N;':record?'typedef struct N{int key,a,b;}N;N*data;':table?'int(*data)[3];':'int*data,*aa,*bb;';
 const walk=pointer?'int sum(N*p){if(!p)return 0;return p->key+sum(p->a)+sum(p->b);}':
  record?'int sum(int p){if(p<0)return 0;return data[p].key+sum(data[p].a)+sum(data[p].b);}':
  table?'int sum(int p){if(p<0)return 0;return data[p][0]+sum(data[p][1])+sum(data[p][2]);}':
  'int sum(int p){if(p<0)return 0;return data[p]+sum(aa[p])+sum(bb[p]);}';
 const allocate=pointer?'N*data=calloc(3,sizeof(N));':record?'data=calloc(3,sizeof(N));':table?'data=calloc(3,sizeof(*data));':'data=calloc(3,sizeof(int));aa=calloc(3,sizeof(int));bb=calloc(3,sizeof(int));';
 const init=pointer?'data[0].key=10;data[1].key=5;data[2].key=15;data[0].a=&data[1];data[0].b=&data[2];N*root=data;':
  record?'data[0]=(N){10,1,2};data[1]=(N){5,-1,-1};data[2]=(N){15,-1,-1};int root=0;':
  table?'data[0][0]=10;data[1][0]=5;data[2][0]=15;data[0][1]=1;data[0][2]=2;data[1][1]=data[1][2]=data[2][1]=data[2][2]=-1;int root=0;':
  'data[0]=10;data[1]=5;data[2]=15;aa[0]=1;aa[1]=aa[2]=-1;bb[0]=2;bb[1]=bb[2]=-1;int root=0;';
 const resize=pointer?'N*tmp=realloc(data,5*sizeof(N));if(!tmp)return 2;data=tmp;data[0].a=&data[1];data[0].b=&data[2];root=data;':
  record?'N*tmp=realloc(data,5*sizeof(N));if(!tmp)return 2;data=tmp;':
  table?'int(*tmp)[3]=realloc(data,5*sizeof(*data));if(!tmp)return 2;data=tmp;':
  'int*tmp=realloc(data,5*sizeof(int));if(!tmp)return 2;data=tmp;tmp=realloc(aa,5*sizeof(int));if(!tmp)return 2;aa=tmp;tmp=realloc(bb,5*sizeof(int));if(!tmp)return 2;bb=tmp;';
 const change=pointer||record?'data[1].key=50;':table?'data[1][0]=50;':'data[1]=50;';
 return `#include <stdio.h>\n#include <stdlib.h>\n${globals}\n${walk}\nint main(void){int flag=0;scanf("%d",&flag);int*scratch=0;if(flag)scratch=calloc(2,sizeof(int));${allocate}
 if(!data${kind==='split'?'||!aa||!bb':''})return 1;${init}
 printf("%d\\n",sum(root));puts("A");${resize}printf("%d\\n",sum(root));puts("B");${change}printf("%d\\n",sum(root));puts("C");
 free(data);${kind==='split'?'free(aa);free(bb);':''}free(scratch);return 0;}`;
}
const cache=new Map();
test('coindex witnesses expire with storage, including ordinary free/reuse; a dead READ cannot witness a new group',()=>{
 const E=(id,kind,extra={})=>({eventId:id,kind,phase:'complete',...extra}),
  events=[E('e0','SPACE'),E('e1','SPACE'),E('e2','READ',{target:{objectId:'old',offset:0,size:4}}),E('e3','WRITE',{target:{objectId:'live',offset:0,size:4}}),
   E('e4','SPACE',{action:'object.end',objectId:'old'}),E('e5','SPACE'),E('e6','WRITE',{target:{objectId:'live',offset:0,size:4}}),E('e7','WRITE',{target:{objectId:'new',offset:0,size:4}}),E('e8','READ',{target:{objectId:'live',offset:0,size:4}})],
  objects=[{id:'old',size:4,address:100,createdBy:'e0',endedBy:'e4'},{id:'live',size:4,address:200,createdBy:'e1'},{id:'new',size:4,address:100,createdBy:'e5'}],
  arrays=objects.map(o=>({id:`array-${o.id}`,kind:'array',objectId:o.id,range:{objectId:o.id,offset:0,size:4},elementBytes:4,capacity:1})),
  accesses=events.filter(e=>e.target).map(e=>({executionId:e.eventId,target:{arrayId:`array-${e.target.objectId}`,index:0,elementOffset:0,size:4}})),
  context={events,objects,structures:[...arrays,{kind:'array-work',accesses},{kind:'storage-dependencies',coindexed:[{origin:'shared-observed-index',accessExecutionIds:accesses.map(a=>a.executionId)}],relations:[]}]},before=JSON.stringify(context),actual=coindexedRecordStructures({},context);
 assert.deepEqual(actual.map(s=>[s.arrays.map(a=>a.range.objectId).sort(),s.discoveredAtExecutionId]),[[['live','old'],'e3'],[['live','new'],'e8']]);
 assert.ok(actual[1].evidence.every(p=>!p.accessExecutionIds.includes('e2')));assert.equal(JSON.stringify(context),before);
 const independent=clone(context);independent.structures.at(-1).coindexed=accesses.map(a=>({origin:`different:${a.executionId}`,accessExecutionIds:[a.executionId]}));
 assert.deepEqual(coindexedRecordStructures({},independent),[]);
});
async function prepare(kind){
 if(cache.has(kind))return cache.get(kind);
 const pending=(async()=>{await mkdir(dir,{recursive:true});const code=source(kind);
  const prediction={stdout:'30\nA\n30\nB\n75\nC\n',indices:[[0,1],[0,2]],reachable:3,conditions:{A:'satisfied-observed',B:'satisfied-observed',C:'contradicted'}};
  if(process.env.ROLE_RECONNECT_SAVED==='1')assert.equal(await readFile(new URL(`${kind}.c`,dir),'utf8'),code,'saved execution must use the identical source');
  await writeFile(new URL(`${kind}.c`,dir),code);await writeFile(new URL(`${kind}.expected.json`,dir),JSON.stringify(prediction,null,2));
  const runs=[];for(const input of ['0','1']){
   const execution=await testExecution({source:code,options:{filename:`role-${kind}.c`,stdin:input+'\n'},expected:{sourceHash:createHash('sha256').update(code).digest('hex'),stdout:prediction.stdout},file:fileURLToPath(new URL(`${kind}-${input}.cache.json`,dir)),reuse:process.env.ROLE_RECONNECT_SAVED==='1'});assert.equal(execution.trace.status,'completed',JSON.stringify(execution.trace.diagnostics));assert.equal(execution.stdout,prediction.stdout);
   const before=JSON.stringify(execution),inference=inferStructures(execution.plan,execution.trace),view=createInferenceView(execution,inference);
   assert.equal(JSON.stringify(execution),before);assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));
   await writeFile(new URL(`${kind}-${input}.json`,dir),JSON.stringify({plan:execution.plan,trace:execution.trace,inference,stdout:execution.stdout}));runs.push(view);
  }return runs;
 })();cache.set(kind,pending);return pending;
}
function selection(execution,kind,label='A'){
 const {plan,trace:t}=execution,when=at(t,label),root=object(t,'root'),dataId=pointee(t,'data',when),heap=t.objects.find(o=>o.id===dataId),a=array(t,dataId,heap.size);
 let roles,keySource;
 if(kind==='pointer'){
  const bp=plan.typeBlueprints.find(b=>b.name==='N'),fields=['a','b'].map(name=>bp.fields.find(f=>f.name===name));assert.ok(fields.every(Boolean));roles=fields.map(f=>f.nodeId);keySource=field(0);
 }else if(kind==='record'){
  const bp=plan.typeBlueprints.find(b=>b.name==='N'),ids=['a','b'].map(name=>bp.fields.find(f=>f.name===name).nodeId),s=t.structures.find(s=>s.kind==='record-index-graph-candidate'&&s.containerId===a.id);assert.ok(s,'record relation absent');
  roles=ids.map(id=>{const r=s.relations.find(r=>r.field?.fieldNodeId===id);assert.ok(r,'record index role absent');return r.id;});keySource=field(0);
 }else if(kind==='split'){
  roles=['aa','bb'].map(name=>{const id=pointee(t,name,when);return array(t,id,t.objects.find(o=>o.id===id).size).id;});keySource={kind:'array',objectId:dataId,offset:0,size:4,stride:4,count:3};
 }else{
  const s=t.structures.find(s=>s.kind==='table-row-graph-candidate'&&s.containerId===a.id);assert.ok(s,'table relation absent');
  roles=[1,2].map(column=>{const edges=s.states.filter(st=>pos(t,st.afterExecutionId)<=pos(t,when)).flatMap(st=>st.edges).filter(e=>e.column===column);assert.ok(edges.length);return edges[0].roleId;});keySource=field(0);
 }
 const candidates=t.structures.filter(s=>s.kind===(kind==='pointer'?'linked-structure':'rooted-index-structure')&&s.root?.objectId===root.id&&
  (kind==='pointer'?roles.every(id=>s.roles.some(r=>r.fieldNodeId===id)):equalSet(s.roleIds,roles))&&
  s.states.some(st=>pos(t,st.afterExecutionId)<=pos(t,when)&&st.topology?.nodeCount===3&&st.topology?.edgeCount===2&&!st.topology.cyclic&&st.topology.rootNodeId));
 assert.equal(candidates.length,1,`one full rooted relation expected (${kind}/${label})`);
 const target={structureId:candidates[0].id},recommendations=recommendStructureViews(t,{target,afterExecutionId:when});assert.ok(recommendations.some(c=>c.view==='tree'));
 const conditionRules={order:{components:[{source:keySource}],roles:[{roleId:roles[0],direction:'less',duplicates:'exclude'},{roleId:roles[1],direction:'greater',duplicates:'exclude'}]},
  conditions:[{id:'custom:arity',requires:['tree'],rules:[{kind:'degree',direction:'out',max:2,roleIds:roles}]},
   {id:'custom:reciprocal',rules:[{kind:'reciprocal',forwardRoleId:roles[0],reverseRoleId:roles[1]}]}]};
 return {target,roles,conditionRules,afterExecutionId:when,plan};
}
const save=(x,kind)=>{const s=selection(x,kind);return setStructurePresentation(null,x.trace,{...s,roleIds:s.roles,view:'tree',expected:'bst-order'});};
function verify(x,prefs,target,label){
 const v=resolveStructurePresentation(x.trace,{target,preferences:prefs,afterExecutionId:at(x.trace,label),plan:x.plan});
 assert.equal(v.reconnection?.status,'connected',JSON.stringify(v.reconnection));assert.equal(v.mode,'manual');assert.equal(v.expectationCheck.assessment,label==='C'?'contradicted':'satisfied-observed');
 const rs=v.relationView.relations;assert.equal(rs.length,1);const r=rs[0];assert.equal(r.nodes.length,3);assert.equal(r.edges.length,2);
 assert.equal(r.rootNodeIds.length,1);assert.equal(new Set(r.edges.map(e=>e.to)).size,2);assert.ok(r.edges.every(e=>e.from===r.rootNodeIds[0]));
 const root=r.nodes.find(n=>n.id===r.rootNodeIds[0]),base=root.range.offset,stride=root.range.size;
 assert.deepEqual(r.edges.map(e=>(r.nodes.find(n=>n.id===e.to).range.offset-base)/stride).sort((a,b)=>a-b),[1,2]);
 return v;
}
for(const kind of ['pointer','split','record','table'])test(`actual C ${kind}: recommendation, chosen roles, conditions, realloc, rerun and rewind`,async()=>{
 const [a,b]=await prepare(kind),prefs=save(a,kind),selected=selection(a,kind),before=JSON.stringify({a,b,prefs});
 for(const label of ['A','B','C','A'])verify(a,prefs,selected.target,label);
 const restored=reconnectStructurePresentation(JSON.parse(JSON.stringify(prefs)),{plan:b.plan,trace:b.trace,afterExecutionId:at(b.trace,'A')});
 assert.deepEqual(restored.pending,[]);assert.equal(restored.results[0].roleMappings.length,2);
 const dest=selection(b,kind);for(const label of ['A','B','C','A'])verify(b,restored.preferences,dest.target,label);
 assert.equal(JSON.stringify({a,b,prefs}),before);
 await writeFile(new URL(`${kind}.comparison.json`,dir),JSON.stringify({expected:{nodes:3,children:[1,2],A:'satisfied-observed',B:'satisfied-observed',C:'contradicted'},actual:['A','B','C'].map(label=>{const v=verify(b,restored.preferences,dest.target,label);return {label,assessment:v.expectationCheck.assessment,roleMappings:v.reconnection.roleMappings};}),restored:restored.results[0].roleMappings},null,2));
});

function renameCompilerIds(value){if(typeof value==='string')return value.replace(/ast\d+|debug:\d+/g,id=>`remapped_${id}`);
 if(Array.isArray(value))return value.map(renameCompilerIds);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[renameCompilerIds(k),renameCompilerIds(v)]));return value;}
test('opaque compiler IDs can change; both selected roles and every condition role reference follow the declarations',async()=>{
 const [a,b]=await prepare('pointer'),prefs=save(a,'pointer'),next=renameCompilerIds(b),r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'A')});
 assert.deepEqual(r.pending,[]);const s=r.results[0].setting,expected=selection(next,'pointer').roles;
 assert.ok(equalSet(s.roleIds,expected));assert.deepEqual(s.conditionRules.order.roles.map(r=>r.roleId),expected);assert.deepEqual(s.conditionRules.conditions[0].rules[0].roleIds,expected);
 assert.equal(s.conditionRules.conditions[1].rules[0].forwardRoleId,expected[0]);assert.equal(s.conditionRules.conditions[1].rules[0].reverseRoleId,expected[1]);assert.equal(r.results[0].fieldMappings.length,2);
 verify(next,r.preferences,selection(next,'pointer').target,'A');
});
test('wrong field offsets, missing roles and future discoveries preserve the original setting without partial binding',async()=>{
 const [a,b]=await prepare('pointer'),prefs=save(a,'pointer'),old=JSON.stringify(prefs);
 for(const mode of ['offset','missing','future']){
  const next=clone(b),id=selection(next,'pointer').roles[0];for(const s of next.trace.structures.filter(s=>s.kind==='linked-structure')){
   if(mode==='offset')for(const r of s.roles)if(r.fieldNodeId===id)r.offset+=1;
   if(mode==='missing')s.roles=s.roles.filter(r=>r.fieldNodeId!==id);
   if(mode==='future')s.discoveredAtExecutionId=at(next.trace,'C');
  }
  const r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'A')});assert.equal(r.pending.length,1,mode);
  assert.equal(r.pending[0].diagnostics[0].code,'role-not-observed',mode);assert.deepEqual(r.pending[0].source,prefs.overrides[0]);assert.equal(r.preferences.overrides.length,1);
  if(mode==='future')assert.equal(reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'C')}).pending.length,0);
 }assert.equal(JSON.stringify(prefs),old);
});
test('duplicate array role interpretations are ambiguous; equal values in unrelated arrays are not substitute roles',async()=>{
 const [a,b]=await prepare('split'),prefs=save(a,'split'),next=clone(b),selected=selection(next,'split'),id=selected.roles[0],arr=next.trace.structures.find(s=>s.id===id),alias={...clone(arr),id:'alternative-role-id'};
 next.trace.structures.push(alias,{id:'alternative-proof',kind:'value-index-graph-candidate',arrayId:alias.id,discoveredAtExecutionId:selected.afterExecutionId});
 const r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:selected.afterExecutionId});assert.equal(r.pending[0].diagnostics[0].code,'ambiguous-role');
 const missing=clone(b);missing.trace.structures=missing.trace.structures.filter(s=>s.id!==id);
 assert.equal(reconnectStructurePresentation(prefs,{plan:missing.plan,trace:missing.trace,afterExecutionId:selected.afterExecutionId}).pending.length,1);
});
test('an AST-like user role name remains a user role when an explicit relation is supplied',async()=>{
 const [a,b]=await prepare('pointer'),selected=selection(a,'pointer'),role=selected.roles[0],root=object(a.trace,'root'),record=root.cType.pointee,
  relationBinding=defineStructureRelation(a.trace,{nodes:{kind:'records',recordTypeId:record.recordTypeId},roots:[{kind:'pointer',source:{kind:'slot',objectId:root.id,size:4}}],links:[{id:role,kind:'pointer',source:field(4)}]}),
  prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{objectId:root.id},view:'tree',roleIds:[role],relationBinding}),next=renameCompilerIds(b),r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'A')});
 assert.deepEqual(r.pending,[]);assert.deepEqual(r.results[0].setting.roleIds,[role]);assert.equal(r.results[0].setting.relationBinding.links[0].id,role);assert.deepEqual(r.results[0].roleMappings,[]);
});
test('raw storage-graph consumers use restored field roles and never report a missing selection as a valid empty tree',async()=>{
 const [a,b]=await prepare('pointer'),when=at(a.trace,'A'),graph=a.trace.structures.find(s=>s.kind==='storage-reference-graph'),fields=selection(a,'pointer').roles,
  roles=fields.map(id=>{const edges=graph.changes.flatMap(c=>c.upsertEdges).filter(e=>e.rolePath?.some(p=>p.fieldNodeId===id));assert.ok(edges.length);return edges[0].roleId;}),
  prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:graph.id},view:'tree',roleIds:roles,afterExecutionId:when}),next=renameCompilerIds(b),
  r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'A')});assert.deepEqual(r.pending,[]);
 const g=next.trace.structures.find(s=>s.kind==='storage-reference-graph'),q=queryStorageReferences(g,next.trace,{preferences:r.preferences,afterExecutionId:at(next.trace,'B')});
 assert.equal(q.nodes.length,3);assert.equal(q.topology.edgeCount,2);assert.equal(q.presentation.assessment,'satisfied-observed-topology');
 const missing=r.results[0].setting.roleIds[0];for(const c of g.changes)c.upsertEdges=c.upsertEdges.filter(e=>e.roleId!==missing);
 const blocked=queryStorageReferences(g,next.trace,{preferences:r.preferences,afterExecutionId:at(next.trace,'B')});
 assert.equal(blocked.relationAvailable,false);assert.equal(blocked.presentation.assessment,'incomplete');assert.equal(blocked.topology,null);assert.deepEqual(blocked.edges,[]);
});
test('pointer-array member slots keep separate relative offsets when AST IDs change',async()=>{
 const code=`#include <stdio.h>\ntypedef struct N{int value;struct N*child[2];}N;
 int sum(N*p){return p?p->value+sum(p->child[0])+sum(p->child[1]):0;}
 int main(void){N a[3]={{10,{0,0}},{5,{0,0}},{15,{0,0}}};a[0].child[0]=a+1;a[0].child[1]=a+2;printf("%d\\n",sum(a));puts("A");return 0;}`;
 const execution=await traceModel(code,{filename:'pointer-member-slots.c'});assert.equal(execution.trace.status,'completed');assert.equal(execution.stdout,'30\nA\n');
 const a=createInferenceView(execution,inferStructures(execution.plan,execution.trace)),bp=a.plan.typeBlueprints.find(b=>b.name==='N'),member=bp.fields.find(f=>f.name==='child').nodeId,
  graph=a.trace.structures.find(s=>s.kind==='storage-reference-graph'),edges=graph.changes.flatMap(c=>c.upsertEdges).filter(e=>e.rolePath?.some(p=>p.fieldNodeId===member)),
  // Select the inferred traversal roles, not an untyped initialization view
  // that happens to mention the member before the record owner is observed.
  roles=[...new Set(graph.roleProjections.flatMap(p=>p.roleIds).filter(id=>edges.some(e=>e.roleId===id)))];
 await mkdir(dir,{recursive:true});await writeFile(new URL('pointer-member-slots-evidence.json',dir),JSON.stringify({plan:execution.plan,trace:execution.trace,graph,member}));
 assert.equal(roles.length,2);const prefs=setStructurePresentation(null,a.trace,{plan:a.plan,target:{structureId:graph.id},view:'tree',roleIds:roles,afterExecutionId:at(a.trace,'A')}),
  descriptors=Object.values(prefs.overrides[0].reconnectAnchor.roles).map(r=>r.descriptor.field.offset).sort((a,b)=>a-b);assert.deepEqual(descriptors,[4,8]);
 const next=renameCompilerIds(a);next.trace.runId+='-rerun';const r=reconnectStructurePresentation(prefs,{plan:next.plan,trace:next.trace,afterExecutionId:at(next.trace,'A')});assert.deepEqual(r.pending,[]);
 assert.equal(r.results[0].fieldMappings.length,1);assert.equal(r.results[0].roleMappings.length,2);
 const q=queryStorageReferences(next.trace.structures.find(s=>s.kind==='storage-reference-graph'),next.trace,{preferences:r.preferences,afterExecutionId:at(next.trace,'A')});assert.equal(q.nodes.length,3);assert.equal(q.topology.edgeCount,2);
 await writeFile(new URL('pointer-member-slots.json',dir),JSON.stringify({plan:execution.plan,trace:execution.trace,inference:a.inference,roles:r.results[0].roleMappings}));
});
