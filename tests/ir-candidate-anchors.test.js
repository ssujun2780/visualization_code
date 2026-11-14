import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {inferStructures,createInferenceView,setStructurePresentation,reconnectStructurePresentation,reconnectStructureSetting} from '../scripts/inference/index.mjs';
const clone=structuredClone,cache=new Map();
async function load(name){
 if(cache.has(name))return cache.get(name);
 const raw=await frozenInferenceExecution(name),before=JSON.stringify(raw),
  inference=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});
 assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(JSON.stringify(raw),before);
 const r=createInferenceView(raw,inference);cache.set(name,r);return r;
}
function rename(r){
 const ids=new Map([...r.trace.objects.map(o=>o.id),...r.trace.structures.map(s=>s.id),...r.plan.functions.map(f=>f.id)].map((id,i)=>[id,`opaque-${i}`]));
 function copy(v){if(typeof v==='string')return ids.get(v)??v;if(Array.isArray(v))return v.map(copy);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)]));return v;}
 const next=copy(r);next.trace.runId+='-rerun';return {next,ids};
}
for(const [name,kind,view]of [['full-flag-ring','queue-candidate','queue'],['constant-leaf-range','range-aggregate-candidate','segment-tree'],['pointer-comparator','composite-priority-candidate','min-heap'],['pointer-comparator','index-tree','tree'],['string-key-hash','associative-lookup-candidate','hash-table']])
test(`${kind}: selected candidate reconnects across opaque object, candidate and function IDs`,async()=>{
 const r=await load(name),s=r.trace.structures.find(s=>s.kind===kind);assert.ok(s);
 const prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view}),saved=JSON.stringify(prefs),{next,ids}=rename(r),restored=reconnectStructurePresentation(prefs,next);
 assert.deepEqual(restored.pending,[]);assert.equal(restored.results[0].setting.target.structureId,ids.get(s.id));assert.equal(restored.results[0].setting.view,view);assert.equal(JSON.stringify(prefs),saved);
 const duplicate=clone(next);duplicate.trace.structures.push({...clone(duplicate.trace.structures.find(x=>x.id===ids.get(s.id))),id:'indistinguishable'});
 assert.equal(reconnectStructurePresentation(prefs,duplicate).pending[0].diagnostics[0].code,'ambiguous-candidate');
});
test('same queue storage with exchanged front/back roles is a different candidate, not a fallback',async()=>{
 const r=await load('full-flag-ring'),s=r.trace.structures.find(s=>s.kind==='queue-candidate'),prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'queue'}),{next}=rename(r);
 const q=next.trace.structures.find(x=>x.kind==='queue-candidate'&&x.layout===s.layout);[q.roles.front,q.roles.back]=[q.roles.back,q.roles.front];
 assert.equal(reconnectStructurePresentation(prefs,next).pending[0].diagnostics[0].code,'candidate-not-observed');
});
test('heap policies on the same storage retain the selected comparator declaration',async()=>{
 const r=await load('pointer-comparator'),s=r.trace.structures.find(s=>s.kind==='composite-priority-candidate'),prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'min-heap'}),{next}=rename(r);
 const policy=next.trace.structures.find(x=>x.kind===s.kind),ret=next.trace.events.find(e=>e.eventId===policy.paths[0].returnExecutionId),fn=next.trace.events.find(e=>e.eventId===ret.callExecutionId).resolvedFunctionId;
 next.plan.functions.find(f=>f.id===fn).source.start.byte++;
 assert.equal(reconnectStructurePresentation(prefs,next).pending[0].diagnostics[0].code,'function-not-observed');
});
test('specialized candidate restoration requires observation at the requested event',async()=>{
 const r=await load('constant-leaf-range'),s=r.trace.structures.find(s=>s.kind==='range-aggregate-candidate'),prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'segment-tree'}),{next}=rename(r);
 const p=reconnectStructurePresentation(prefs,{...next,afterExecutionId:next.trace.events[0].eventId});assert.equal(p.pending[0].diagnostics[0].code,'candidate-not-observed');
 assert.equal(reconnectStructurePresentation(prefs,next).pending.length,0);
});
test('actual realloc evidence reconnects a specialized candidate and its manager, but ordinary copies do not',async()=>{
 const r=await load('full-flag-ring'),s=r.trace.structures.find(s=>s.kind==='queue-candidate'),a=r.trace.structures.find(a=>a.id===s.arrayId),t=clone(r.trace),o=t.objects.find(o=>o.id===a.objectId);
 // Synthetic lifetime boundary around an actual inferred queue. Expectations
 // are fixed: replacement succeeds, a byte copy alone must not move selection.
 o.storage='heap';const prefs=setStructurePresentation(null,t,{plan:r.plan,target:{structureId:s.id},view:'queue'}),oldEnd=o.endedBy;
 const end={eventId:'end-replaced',kind:'SPACE',action:'object.end',objectId:o.id,activationId:'boundary',reason:'realloc-replaced'},begin={eventId:'begin-replacement',kind:'SPACE',action:'object.begin',objectId:'new-storage',activationId:'boundary',copiedFrom:{objectId:o.id,offset:0,size:o.size}};
 o.endedBy=end.eventId;t.events.push(end,begin);t.objects.push({...clone(o),id:'new-storage',createdBy:begin.eventId,endedBy:null});
 const na={...clone(a),id:'new-array',objectId:'new-storage',range:{...a.range,objectId:'new-storage'}};t.structures.push(na);
 t.structures.push({...clone(s),id:'new-queue',arrayId:na.id,objectId:na.objectId,range:na.range,discoveredAtExecutionId:begin.eventId,inferredAtExecutionId:begin.eventId});
 const restored=reconnectStructureSetting(t,prefs.overrides[0],{plan:r.plan});assert.equal(restored.status,'connected');assert.equal(restored.setting.target.structureId,'new-queue');
 assert.equal(reconnectStructureSetting(t,prefs.overrides[0],{plan:r.plan,afterExecutionId:end.eventId}).diagnostics[0].code,'replacement-not-observed');
 const copy=clone(t);copy.events.find(e=>e.eventId===end.eventId).reason='free';copy.objects.find(x=>x.id===o.id).endedBy=oldEnd;
 assert.equal(reconnectStructureSetting(copy,prefs.overrides[0],{plan:r.plan}).setting.target.structureId,s.id);
});
