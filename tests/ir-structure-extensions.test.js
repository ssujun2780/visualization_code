import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {extensionCases} from './fixtures/structure-extensions.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,queryInferredSemantics,queryManagementRoles,validateStructureTrace,recommendStructureViews,setStructurePresentation,resolveStructurePresentation,queryStructureConditions} from '../scripts/inference/index.mjs';
const dir='test-results/structure-extensions-2026-11-12',cache=new Map(),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function load(id,source,stdout){
 if(cache.has(id))return cache.get(id);const c=extensionCases.find(c=>c.id===id);source??=c.source;stdout??=c.stdout;
 let r;try{const expected=JSON.parse(await fs.readFile(`${dir}/expected.json`)).find(c=>c.id===id)??JSON.parse(await fs.readFile(`${dir}/${id}.expected.json`));if(expected?.sourceHash===hash(source))r=JSON.parse(await fs.readFile(`${dir}/${id}.execution.json`));}catch{}
 const sourceDir='example/c/codex_code/structure_extensions_20261112';await fs.mkdir(sourceDir,{recursive:true});await fs.writeFile(`${sourceDir}/${id}.c`,source);
 if(!r){await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/${id}.expected.json`,JSON.stringify({sourceHash:hash(source),stdout},null,2));r=await traceModel(source,{filename:`${id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${id}.execution.json`,JSON.stringify(r));}
 assert.equal(r.trace.status,'completed',id);assert.equal(r.stdout,stdout,id);const before=hash(JSON.stringify(r)),i=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});
 assert.equal(i.status,'completed',JSON.stringify(i.diagnostics));assert.equal(hash(JSON.stringify(r)),before,'inference changed IR');await fs.writeFile(`${dir}/${id}.inference.json`,JSON.stringify(i));const view=createInferenceView(r,i),result={...view,inference:i};cache.set(id,result);return result;
}
const of=(r,k)=>r.trace.structures.filter(s=>s.kind===k),last=s=>s.states.at(-1),nval=n=>Number(n.value?.decimal),
 normalGroups=s=>last(s).groups.map(g=>g.members.map(id=>last(s).nodes.find(n=>n.id===id).range.offset/12));
test('all thirteen frozen source predictions execute normally; input IR and temporal evidence stay unchanged',async()=>{
 for(const c of extensionCases){const r=await load(c.id);for(const s of r.trace.structures.filter(s=>['pointer-partition-candidate','pointer-priority-candidate','composite-priority-candidate','management-role-candidate','shared-substructure-candidate','deferred-update-candidate','partition-selection-candidate'].includes(s.kind))){assert.equal(queryInferredSemantics(s,r.trace,{afterExecutionId:r.trace.events[0].eventId}),null);validateStructureTrace(r.plan,r.trace);}}
});
test('pointer DSU: independent member identities, self termination, three merges and one compression',async()=>{
 const r=await load('pointer-partition'),[s]=of(r,'pointer-partition-candidate');assert.ok(s);assert.deepEqual(normalGroups(s),[[0,1,2,3],[4]]);assert.equal(last(s).status,'supported-observed');
 assert.deepEqual(s.operations.map(p=>p.kind),['merge','merge','merge','compress']);assert.deepEqual(s.operations.at(-1).previousPath.map(id=>last(s).nodes.find(n=>n.id===id).range.offset/12),[3,2,0]);
 const roles=queryManagementRoles(r.trace);assert.deepEqual(roles.map(r=>[r.role,r.binding.offset]),[['rank',8]]);
 assert.ok(recommendStructureViews(r.trace,{target:{structureId:s.id}}).some(c=>c.view==='disjoint-set'));
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.at(-1).groups[0].members.pop();assert.throws(()=>validateStructureTrace(r.plan,bad),/구성원/);
});
test('pointer heap follows live root; removed nodes remain stored but leave heap membership',async()=>{
 const r=await load('pointer-heap'),s=of(r,'pointer-priority-candidate').find(s=>r.trace.objects.find(o=>o.id===s.root.objectId)?.storage==='static');assert.ok(s);
 const full=s.states.findLast(st=>st.nodes.length===4&&st.min==='satisfied');assert.ok(full);assert.equal(full.max,'violated');assert.deepEqual(full.nodes.map(n=>n.value).sort((a,b)=>a-b),[2,2,4,7]);assert.equal(last(s).nodes.length,0);
 assert.ok(recommendStructureViews(r.trace,{target:{structureId:s.id},afterExecutionId:full.afterExecutionId}).some(c=>c.view==='min-heap'));
});
test('composite comparator: ascending first field, descending tie field, exact by-value argument origin',async()=>{
 const r=await load('composite-heap'),[s]=of(r,'composite-priority-candidate');assert.ok(s);assert.deepEqual(last(s).keyOrder.map(f=>[f.offset,f.direction]),[[0,1],[4,-1]]);
 const full=s.states.findLast(st=>st.nodes.length===4&&st.keyOrder?.length===2&&st.min==='satisfied');assert.ok(full);assert.deepEqual(full.nodes[0].values,[2,9]);assert.equal(last(s).nodes.length,0);
 assert.ok(s.paths.flatMap(p=>p.comparisons).every(p=>p.operands.every(o=>o.copyExecutionIds.length)));
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).paths[0].comparisons[0].operands[0].range.offset+=4;assert.throws(()=>validateStructureTrace(r.plan,bad),/복합키/);
});
test('management roles need operations: distinguish height/cache, colour/flag, and unrelated same-valued fields',async()=>{
 const h=await load('height-role'),color=await load('color-role'),negative=await load('role-negative');
 assert.deepEqual(queryManagementRoles(h.trace).map(p=>[p.role,p.binding.offset]),[['height',4]]);
 assert.deepEqual(queryManagementRoles(color.trace).map(p=>[p.role,p.binding.offset,p.mapping]),[['color',4,null]]);
 assert.deepEqual(queryManagementRoles(negative.trace),[]);assert.deepEqual(queryManagementRoles(h.trace,{afterExecutionId:h.trace.events[0].eventId}),[]);
 const type=queryManagementRoles(h.trace)[0].binding.recordTypeId,auto=queryStructureConditions(h.trace,{target:{objectId:'o1'},expected:'avl-balance'});
 assert.ok(auto.candidates.some(c=>c.roleSuggestions.some(r=>r.role==='height')));
 assert.ok(auto.candidates.some(c=>c.relation.nodes.length===3&&c.properties.height?.origin==='inferred'&&c.checks.some(x=>x.storedHeightCheck?.status==='satisfied-observed')));
 const explicit=queryStructureConditions(h.trace,{target:{objectId:'o1'},expected:'avl-balance',bindings:{height:{kind:'record',recordTypeId:type,offset:8,size:4,leafHeight:1}}});
 assert.ok(explicit.candidates.every(c=>c.properties.height.origin==='user'));
 assert.ok(explicit.warnings.some(w=>w.code==='stored-height-mismatch'));
});
test('min/max coverage keeps both operands through call/return and inline conditionals',async()=>{
 for(const [id,kind,value]of [['range-min','min',-7],['range-max-inline','max',8]]){const r=await load(id),[s]=of(r,'range-aggregate-candidate'),st=last(s),root=st.nodes.find(n=>n.index===1);assert.equal(st.view,'segment-tree');assert.equal(st.status,'supported-observed');assert.deepEqual([root.coverage.start,root.coverage.end],[0,4]);assert.equal(nval(root),value);assert.deepEqual(root.children.map(c=>c.index).sort(),[2,3]);assert.deepEqual(root.selectionEvidence.map(p=>p.kind),[kind]);}
});
test('deferred propagation keeps real stale leaves, topology, tags, delta source and clear ordering',async()=>{
 const r=await load('range-lazy'),[s]=of(r,'deferred-update-candidate'),[a]=of(r,'range-aggregate-candidate');assert.ok(s);assert.equal(s.applications.length,5);assert.deepEqual(s.propagations.map(p=>[p.index,p.childIndices]),[[1,[2,3]],[3,[6,7]]]);
 const initial=queryInferredSemantics(a,r.trace,{afterExecutionId:s.applications[0].afterExecutionId});assert.equal(nval(initial.nodes.find(n=>n.index===1)),30);assert.equal(nval(initial.nodes.find(n=>n.index===2)),3);assert.equal(nval(initial.nodes.find(n=>n.index===3)),7);
 assert.equal(initial.view,'segment-tree');assert.equal(initial.status,'transformed-aggregate');assert.deepEqual(initial.nodes.find(n=>n.index===1).topologyChildren.map(c=>c.index),[2,3]);
 assert.deepEqual(last(s).nodes.map(n=>[n.index,n.pending]),[[1,0],[2,5],[3,0],[6,5],[7,5]]);assert.equal(last(s).status,'observed-propagation');assert.equal(nval(last(a).nodes.find(n=>n.index===7)),9);
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.at(-1).nodes[0].pending=99;assert.throws(()=>validateStructureTrace(r.plan,bad),/지연값/);
 const broken=structuredClone(r.trace);broken.structures.find(x=>x.id===a.id).states.at(-1).nodes.find(n=>n.index===1).topologyChildren.pop();assert.throws(()=>validateStructureTrace(r.plan,broken),/구조/);
});
test('persistent update shares exact nodes; independent equal-shaped trees do not',async()=>{
 const r=await load('persistent-tree'),[s]=of(r,'shared-substructure-candidate'),pair=last(s).pairs.find(p=>p.rootSlots.every(r=>r.objectId==='o3'||r.objectId==='o4'));assert.ok(pair);
 assert.deepEqual(pair.sharedNodeIds.map(id=>Number(id.split(':')[2])).sort((a,b)=>a-b),[24,48,60,72]);assert.deepEqual(pair.exclusiveNodeIds.map(ids=>ids.length),[3,3]);
 assert.equal(of(await load('independent-trees'),'shared-substructure-candidate').length,0);
 const bad=structuredClone(r.trace);bad.structures.find(x=>x.id===s.id).states.at(-1).pairs[0].sharedNodeIds.pop();assert.throws(()=>validateStructureTrace(r.plan,bad),/공유/);
});
test('selected edges preserve source records and actual component-controlled copies; equal copies are not enough',async()=>{
 const r=await load('selected-edges'),[s]=of(r,'partition-selection-candidate');assert.ok(s);assert.deepEqual(s.selections.map(p=>[p.sourceIndex,p.targetIndex]),[[0,0],[1,1],[2,2]]);
 for(const p of s.selections)assert.deepEqual(p.endpointReadExecutionIds.map(id=>r.trace.events.find(e=>e.eventId===id).target.offset-p.sourceRange.offset).sort(),[0,4]);
 assert.equal(of(await load('equal-copy-negative'),'partition-selection-candidate').length,0);
});
test('same common paths handle reversed priority, different colour codes, field renaming and indirect allocation',async()=>{
 const original=id=>extensionCases.find(c=>c.id===id).source;
 const heap=await load('composite-reversed',original('composite-heap').replace('x.k<y.k','x.k>y.k').replace('x.t>y.t','x.t<y.t'),'4:1 3:7 2:5 2:9 ');
 assert.deepEqual(last(of(heap,'composite-priority-candidate')[0]).keyOrder.map(f=>[f.offset,f.direction]),[[0,-1],[4,1]]);
 const colour=await load('colour-renamed',original('color-role').replaceAll('17','101').replaceAll('23','203').replaceAll(/\bc\b/g,'status'),'101 101 101 ');
 assert.deepEqual(queryManagementRoles(colour.trace).map(r=>[r.role,r.binding.offset,r.mapping]),[['color',4,null]]);
 const pointer=await load('pointer-dynamic',original('pointer-partition').replace('#include <stdio.h>','#include <stdio.h>\n#include <stdlib.h>').replace('N a[5];','N *a;').replace('int main(void){','int main(void){a=calloc(5,sizeof *a);if(!a)return 0;'),'0 0 0 0 4 ');
 assert.deepEqual(normalGroups(of(pointer,'pointer-partition-candidate')[0]),[[0,1,2,3],[4]]);
});
test('user override remains first and recommendation list stays bounded',async()=>{
 const r=await load('pointer-partition'),[s]=of(r,'pointer-partition-candidate'),target={structureId:s.id};let prefs=setStructurePresentation(null,r.trace,{target,view:'graph'});
 assert.equal(resolveStructurePresentation(r.trace,{target,preferences:prefs}).source,'user');assert.equal(resolveStructurePresentation(r.trace,{target,preferences:prefs}).view,'graph');assert.ok(recommendStructureViews(r.trace,{target}).length<=5);
});
test('separate rank/size arrays require representative provenance and ignore an unrelated counter',async()=>{
 const source=String.raw`#include <stdio.h>
int p[4],r[4],s[4],other[4];
int f(int x){return p[x]==x?x:(p[x]=f(p[x]));}
void join(int x,int y){x=f(x);y=f(y);if(x==y)return;if(r[x]<r[y]){int t=x;x=y;y=t;}p[y]=x;s[x]+=s[y];if(r[x]==r[y])r[x]++;other[x]++;}
int main(void){for(int i=0;i<4;i++){p[i]=i;s[i]=1;}join(0,1);join(2,3);join(0,2);printf("%d %d %d ",s[0],r[0],other[0]);return 0;}`;
 const r=await load('array-management',source,'4 2 2 '),roles=queryManagementRoles(r.trace),objectName=id=>r.trace.objects.find(o=>o.id===of(r,'array').find(a=>a.id===id).objectId).name;
 assert.deepEqual(roles.map(p=>[p.role,objectName(p.binding.arrayId)]).sort(),[['component-size','s'],['rank','r']]);
});
test('non-lexicographic policies are left unknown; coupled updates alone do not assert propagation',async()=>{
 const source=extensionCases.find(c=>c.id==='composite-heap').source.replace('if(x.k!=y.k)return x.k<y.k;return x.t>y.t;','if((x.k%2)!=(y.k%2))return (x.k%2)<(y.k%2);if(x.k!=y.k)return x.k<y.k;return x.t>y.t;');
 const r=await load('parity-priority',source,'2:9 2:5 4:1 3:7 ');assert.equal(of(r,'composite-priority-candidate').length,0);
 const base=extensionCases.find(c=>c.id==='range-lazy').source.replace('push(1,0,4);push(3,2,4);',''),lazy=await load('unpropagated-update',base,'30 5 4 '),[s]=of(lazy,'deferred-update-candidate');assert.ok(s);assert.equal(s.propagations.length,0);assert.equal(last(s).status,'coupled-update-candidate');
});
test('pointer key comparisons preserve unsigned values above signed int range',async()=>{
 const source=extensionCases.find(c=>c.id==='pointer-heap').source.replace('int value;','unsigned value;').replace('{4,0,0}','{4294967295u,0,0}').replace('"%d "','"%u "');
 const r=await load('pointer-unsigned',source,'2 2 7 4294967295 '),s=of(r,'pointer-priority-candidate').find(s=>r.trace.objects.find(o=>o.id===s.root.objectId)?.storage==='static');
 assert.ok(s.states.some(st=>st.nodes.length===4&&st.min==='satisfied'&&st.nodes.some(n=>n.value===4294967295)));assert.equal(s.key.signedness,'unsigned');
});
