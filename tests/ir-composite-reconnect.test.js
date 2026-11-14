import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {inferStructures,createInferenceView,setStructurePresentation,reconnectStructurePresentation,reconnectStructureSetting} from '../scripts/inference/index.mjs';
const memo=new Map(),clone=structuredClone;
async function load(name){
 if(memo.has(name))return memo.get(name);
 const raw=await frozenInferenceExecution(name);
 const before=JSON.stringify(raw),inf=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});
 assert.equal(inf.status,'completed',JSON.stringify(inf.diagnostics));assert.equal(JSON.stringify(raw),before);
 const result=createInferenceView(raw,inf);memo.set(name,result);return result;
}
function renamed(r){
 const map=new Map([...r.trace.objects,...r.trace.structures,...r.plan.functions].map((x,i)=>[x.id,`opaque-${i}`]));
 const copy=x=>typeof x==='string'?map.get(x)??x:Array.isArray(x)?x.map(copy):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,copy(v)])):x;
 const next=copy(r);next.trace.runId+='-other';return {next,map};
}
for(const [name,kind]of [['range-lazy','deferred-update-candidate'],['persistent-tree','shared-substructure-candidate'],['selected-edges','partition-selection-candidate'],['pointer-selected-records','partition-selection-candidate']]){
 test(`${name}: compound identity survives opaque IDs but not ambiguity or pre-discovery`,async()=>{
  const r=await load(name),s=r.trace.structures.find(s=>s.kind===kind);assert.ok(s);
  const prefs=setStructurePresentation(null,r.trace,{plan:r.plan,target:{structureId:s.id},view:'graph'}),saved=JSON.stringify(prefs),{next,map}=renamed(r);
  assert.ok(prefs.overrides[0].reconnectAnchor);const restored=reconnectStructurePresentation(prefs,next);assert.deepEqual(restored.pending,[]);assert.equal(restored.results[0].setting.target.structureId,map.get(s.id));assert.equal(JSON.stringify(prefs),saved);
  const duplicate=clone(next);duplicate.trace.structures.push({...clone(duplicate.trace.structures.find(x=>x.id===map.get(s.id))),id:'duplicate'});
  assert.equal(reconnectStructurePresentation(prefs,duplicate).pending[0].diagnostics[0].code,'ambiguous-candidate');
  assert.ok(reconnectStructurePresentation(prefs,{...next,afterExecutionId:next.trace.events[0].eventId}).pending.length);
  assert.equal(reconnectStructureSetting(r.trace,prefs.overrides[0],{plan:r.plan,afterExecutionId:r.trace.events[0].eventId}).status,'reconnect-needed');
  if(kind==='shared-substructure-candidate'){
   const changed=clone(next),item=changed.trace.structures.find(x=>x.id===map.get(s.id));item.states=item.states.map(st=>({...st,pairs:[]}));
   assert.deepEqual(reconnectStructurePresentation(prefs,changed).pending,[],'current pairs are contents of the global sharing collection');
  }else{
   const missing=clone(next),item=missing.trace.structures.find(x=>x.id===map.get(s.id));missing.trace.structures=missing.trace.structures.filter(x=>x.id!==(item.aggregateId??item.partitionId));
   assert.equal(reconnectStructurePresentation(prefs,missing).pending[0].diagnostics[0].code,'candidate-not-observed');
   const future=clone(next),child=future.trace.structures.find(x=>x.id===(item.aggregateId??item.partitionId));child.discoveredAtExecutionId=future.trace.events.at(-1).eventId;
   assert.equal(reconnectStructurePresentation(prefs,{...future,afterExecutionId:future.trace.events.at(-2).eventId}).pending[0].diagnostics[0].code,'candidate-not-observed');
   const wrong=clone(next),q=wrong.trace.structures.find(x=>x.id===map.get(s.id));
   if(q.sourceArrayId)[q.sourceArrayId,q.targetArrayId]=[q.targetArrayId,q.sourceArrayId];else q.aggregateId=q.id;
   assert.equal(reconnectStructurePresentation(prefs,wrong).pending[0].diagnostics[0].code,'candidate-not-observed');
  }
 });
}
test('compound realloc follows every constituent and does not treat an ordinary copy as replacement',async()=>{
 const r=await load('range-lazy'),t=clone(r.trace),s=t.structures.find(s=>s.kind==='deferred-update-candidate'),agg=t.structures.find(x=>x.id===s.aggregateId),arrays=[...new Set([s.tagArrayId,agg.arrayId])].map(id=>t.structures.find(x=>x.id===id));
 for(const a of arrays)t.objects.find(o=>o.id===a.objectId).storage='heap';
 const prefs=setStructurePresentation(null,t,{plan:r.plan,target:{structureId:s.id},view:'graph'}),maps=new Map();
 for(const a of arrays){const o=t.objects.find(o=>o.id===a.objectId),id=`replacement-${o.id}`,end=`end-${o.id}`,begin=`begin-${o.id}`;o.endedBy=end;
  t.events.push({eventId:end,kind:'SPACE',action:'object.end',objectId:o.id,activationId:'resize',reason:'realloc-replaced'}, {eventId:begin,kind:'SPACE',action:'object.begin',objectId:id,activationId:'resize',copiedFrom:{objectId:o.id,offset:0,size:o.size}});
  t.objects.push({...clone(o),id,createdBy:begin,endedBy:null});maps.set(o.id,id);maps.set(a.id,`replacement-${a.id}`);
 }
 const copy=x=>typeof x==='string'?maps.get(x)??x:Array.isArray(x)?x.map(copy):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,copy(v)])):x;
 maps.set(agg.id,`replacement-${agg.id}`);maps.set(s.id,'replacement-candidate');
 const at=t.events.at(-1).eventId;for(const old of [...arrays,agg,s])t.structures.push({...copy(old),discoveredAtExecutionId:at,inferredAtExecutionId:at});
 const restored=reconnectStructureSetting(t,prefs.overrides[0],{plan:r.plan});assert.equal(restored.status,'connected',JSON.stringify(restored.diagnostics));assert.equal(restored.setting.target.structureId,'replacement-candidate');
 const copyOnly=clone(t);for(const e of copyOnly.events)if(e.reason==='realloc-replaced')e.reason='free';
 assert.equal(reconnectStructureSetting(copyOnly,prefs.overrides[0],{plan:r.plan}).setting.target.structureId,s.id);
});
