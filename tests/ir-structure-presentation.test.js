import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recommendStructureViews,resolveStructurePresentation,setStructurePresentation,clearStructurePresentation,queryStorageReferences} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
const target={objectId:'o1'};
const fixture=()=>({programId:'P',runId:'R',objects:[{id:'o1',size:32,createdBy:'e1'},{id:'o2',size:32,createdBy:'e1'}],
 events:[{eventId:'e1'},{eventId:'e2'},{eventId:'e3'},{eventId:'e4'}],structures:[{
 id:'c1',kind:'extension-candidate',objectId:'o1',presentationCandidates:[
 {view:'bst',supportingExecutionIds:['e1','e2'],expected:'bst-order'},
 {view:'tree',supportingExecutionIds:['e1']},{view:'grid',supportingExecutionIds:['e1']},
 {view:'graph',supportingExecutionIds:['e1']},{view:'array',supportingExecutionIds:['e1']},
 {view:'linked-list',supportingExecutionIds:['e1']},{view:'min-heap',supportingExecutionIds:['e4'],expected:'heap-order'}]},
 {id:'c2',kind:'extension-candidate',objectId:'o1',presentationCandidates:[{view:'bst',supportingExecutionIds:['e1'],roleIds:['left','right'],expected:'bst-order'}]},
 {id:'unrelated',kind:'extension-candidate',objectId:'o2',presentationCandidates:[{view:'deque',supportingExecutionIds:['e1','e2','e3']}]}]});
const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;};
test('recommendations cap five distinct views, retain alternatives, and stay deterministic',()=>{
 const trace=freeze(fixture()),r=recommendStructureViews(trace,{target,afterExecutionId:'e3'});
 assert.equal(r.length,5);assert.equal(new Set(r.map(c=>c.view)).size,5);assert.equal(r[0].view,'bst');assert.equal(r[0].alternatives.length,2);
 assert.deepEqual(r.map(c=>c.rank),[1,2,3,4,5]);assert.ok(!r.some(c=>['deque','min-heap'].includes(c.view)));
 const reversed={...trace,structures:[...trace.structures].reverse()};assert.deepEqual(recommendStructureViews(reversed,{target,afterExecutionId:'e3'}),r);
 assert.ok(r.every(c=>c.intent==='unconfirmed'&&!('probability' in c)));
});
test('few/unknown/contradicted candidates never get padded to five',()=>{
 const trace=fixture();trace.structures[0].presentationCandidates=[{view:'tree',supportingExecutionIds:['e1'],contradictingExecutionIds:['e3']},{view:'invented',supportingExecutionIds:['missing']}];trace.structures.splice(1);
 assert.equal(recommendStructureViews(trace,{target,afterExecutionId:'e2'}).length,1);
 assert.deepEqual(recommendStructureViews(trace,{target,afterExecutionId:'e3'}),[]);
 assert.equal(resolveStructurePresentation(trace,{target}).view,'boxes');
});
test('user tree wins over BST/heap and stays fixed across new inference and serialization',()=>{
 const trace=freeze(fixture()),preferences=freeze(setStructurePresentation(undefined,trace,{target,view:'tree'}));
 let p=resolveStructurePresentation(trace,{target,preferences});assert.equal(p.view,'tree');assert.equal(p.mode,'manual');assert.equal(p.expected,'tree');assert.equal(p.inferredCandidateId,null);
 assert.ok(!p.contractPolicy.includes('bst'));assert.ok(p.recommendations.some(c=>c.view==='bst'));
 const changed={...trace,structures:[{id:'h',objectId:'o1',presentationCandidates:[{view:'max-heap',supportingExecutionIds:['e4'],expected:'heap-order'}]}]};
 p=resolveStructurePresentation(changed,{target,preferences:JSON.parse(JSON.stringify(preferences))});assert.equal(p.view,'tree');assert.equal(p.expected,'tree');assert.equal(p.recommendations[0].view,'max-heap');
 const empty=resolveStructurePresentation({...trace,structures:[]},{target,preferences});assert.equal(empty.view,'tree');assert.deepEqual(empty.recommendations,[]);
});
test('reset removes only the selected override and run/slot/object identities do not bleed',()=>{
 const trace=fixture();let p=setStructurePresentation(undefined,trace,{target,view:'tree'});
 p=setStructurePresentation(p,trace,{target:{objectId:'o2'},view:'array'});p=setStructurePresentation(p,trace,{target,slot:'secondary',view:'grid'});
 const cleared=clearStructurePresentation(p,trace,{target});assert.equal(p.overrides.length,3);assert.equal(cleared.overrides.length,2);
 assert.equal(resolveStructurePresentation(trace,{target,preferences:cleared}).mode,'auto');
 assert.equal(resolveStructurePresentation(trace,{target,slot:'secondary',preferences:cleared}).view,'grid');
 assert.equal(resolveStructurePresentation({...trace,runId:'another'},{target,preferences:p}).mode,'auto');
 assert.equal(resolveStructurePresentation(trace,{target:{objectId:'o2'},preferences:cleared}).view,'array');
 assert.equal(setStructurePresentation(p,trace,{target,view:'auto'}).overrides.length,2);
});
test('arbitrary custom views and equivalent range selections preserve explicit roles',()=>{
 const trace=fixture(),p=setStructurePresentation(null,trace,{target:{objectIds:['o2','o1','o1']},view:'custom:my-container',roleIds:['r2','r1','r1'],expected:'custom:rule'}),
 resolved=resolveStructurePresentation(trace,{target:{ranges:[{objectId:'o1',offset:0,size:32},{objectId:'o2',offset:0,size:32}]},preferences:p});
 assert.equal(resolved.view,'custom:my-container');assert.deepEqual(resolved.roleIds,['r1','r2']);assert.equal(resolved.expected,'custom:rule');
 assert.throws(()=>setStructurePresentation(p,trace,{target:{ranges:[{objectId:'o1',offset:20,size:30}]},view:'tree'}),RangeError);
 assert.throws(()=>recommendStructureViews(trace,{target,afterExecutionId:'missing'}),RangeError);
});
test('structure-target locks survive disappearance of the inferred candidate',()=>{
 const trace=fixture(),target={structureId:'c1'},p=setStructurePresentation(null,trace,{target,view:'custom:thing'}),changed={...trace,structures:[]};
 assert.equal(resolveStructurePresentation(changed,{target,preferences:p}).view,'custom:thing');
 assert.equal(clearStructurePresentation(p,changed,{target}).overrides.length,0);
});
test('subobject selection does not borrow another field view or override',()=>{
 const trace=fixture();trace.structures=[{id:'one',objectId:'o1',range:{objectId:'o1',offset:0,size:8},presentationCandidates:[{view:'tree',supportingExecutionIds:['e1']}]},
 {id:'two',objectId:'o1',range:{objectId:'o1',offset:16,size:8},presentationCandidates:[{view:'queue',supportingExecutionIds:['e1','e2']}]}];
 const first={ranges:[{objectId:'o1',offset:0,size:8}]},second={ranges:[{objectId:'o1',offset:16,size:8}]};
 assert.deepEqual(recommendStructureViews(trace,{target:first}).map(c=>c.view),['tree']);
 const p=setStructurePresentation(null,trace,{target:first,view:'grid'});assert.equal(resolveStructurePresentation(trace,{target:second,preferences:p}).view,'queue');
});
async function run(source){const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);return r;}
test('actual C arrays and pointer trees supply recommendations without claiming BST',async()=>{
 const r=await run('typedef struct N{int v;struct N*l,*r;}N;int f(N*p){return p?p->v+f(p->l)+f(p->r):0;}int main(void){N n[3]={{2,0,0},{7,0,0},{1,0,0}};n[0].l=&n[1];n[0].r=&n[2];int a[2][3]={{0}};return f(n)!=10||a[0][0];}');
 const g=r.trace.structures.find(s=>s.kind==='linked-structure'&&s.states.some(st=>st.topology.nodeCount===3&&st.topology.status==='tree')),
   state=g.states.findLast(st=>st.rootAlive&&st.topology.status==='tree'&&st.topology.nodeCount===3),
   suggestions=recommendStructureViews(r.trace,{target:{structureId:g.id},afterExecutionId:state.afterExecutionId});
 assert.ok(suggestions.some(c=>c.view==='tree'));assert.ok(!suggestions.some(c=>c.view==='bst'||c.view.endsWith('-heap')));
 const a=r.trace.objects.find(o=>o.name==='a'),grid=recommendStructureViews(r.trace,{target:{objectId:a.id}});assert.ok(grid.some(c=>c.view==='grid'));
 const before=JSON.stringify(r.trace),prefs=setStructurePresentation(null,r.trace,{target:{structureId:g.id},view:'array'});
 assert.equal(resolveStructurePresentation(r.trace,{target:{structureId:g.id},preferences:prefs,afterExecutionId:state.afterExecutionId}).view,'array');assert.equal(JSON.stringify(r.trace),before);
});
test('storage query honors pinned generic tree, reports actual cycle, and reset restores auto',async()=>{
 const r=await run('typedef struct N{int v;struct N*link;}N;int main(void){N a={1,0},b={2,0};N*p=&a;a.link=&b;int z=p->link->v;b.link=&a;return z!=2;}'),
   g=r.trace.structures.find(s=>s.kind==='storage-reference-graph'),edge=g.changes.flatMap(c=>c.upsertEdges).findLast(e=>e.roleId.startsWith('field:')&&e.target),
   target={structureId:g.id},roles=[edge.roleId],prefs=setStructurePresentation(null,r.trace,{target,view:'tree',roleIds:roles}),before=JSON.stringify(r.trace),
   q=queryStorageReferences(g,r.trace,{afterExecutionId:edge.lastObservationExecutionId,preferences:prefs,view:'bst',expected:'bst-order'});
 assert.equal(q.presentation.view,'tree');assert.equal(q.presentation.expected,'tree');assert.equal(q.presentation.locked,true);assert.ok(q.presentation.warnings.some(w=>w.code==='cycle'));
 assert.equal(q.presentation.assessment,'contradicted');assert.ok(q.topology.cyclic);assert.equal(JSON.stringify(r.trace),before);
 const reset=queryStorageReferences(g,r.trace,{afterExecutionId:edge.lastObservationExecutionId,preferences:clearStructurePresentation(prefs,r.trace,{target})});assert.equal(reset.presentation.mode,'auto');
});
