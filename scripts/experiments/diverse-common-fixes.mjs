// Focused replay of frozen audit inputs. Expectations were specified before
// running this verifier; original recordings/reports are never overwritten.
import fs from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {decodeExecution} from '../shared/execution-format.mjs';
import {inferStructures,decodeInference,encodeInference,createInferenceView,validateStructureTrace} from '../inference/index.mjs';
import {analyzeRecordingWork} from '../animation/work-analysis.mjs';
import {prepareStructures,PreparedStructures} from '../../src/animation/prepared-structures.js';
import {encodePreparedStructures,decodePreparedStructures} from '../../src/animation/prepared-format.js';
import {createRecording,Playback} from '../../src/animation/playback.js';
import {recommendStructureViews} from '../inference/structure-presentation.mjs';
const id=process.argv[2],base='test-results/codex_code-results/end_to_end_audit_20261113/'+id,
 out='test-results/diverse-common-fixes/'+id;
await fs.mkdir(out,{recursive:true});
const load=async file=>JSON.parse(gunzipSync(await fs.readFile(base+'/'+file+'.json.gz'))),
 hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),
 r=decodeExecution(await load('execution')),before=hash({plan:r.plan,trace:r.trace}),report={id,events:r.trace.events.length,checks:[],metrics:{}};
const check=(name,fn)=>{try{fn();report.checks.push({name,passed:true});}catch(e){report.checks.push({name,passed:false,message:e.message});}};
const timed=(name,fn)=>{global.gc?.();const start=performance.now(),v=fn();report.metrics[name+'Ms']=performance.now()-start;return v;};
try{
 const inf=timed('inference',()=>inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace})),
   view=createInferenceView(r,inf);
 report.inference={status:inf.status,diagnostics:inf.diagnostics};
 check('independent inference contracts',()=>validateStructureTrace(view.plan,view.trace));
 check('all numeric evidence finite',()=>{const seen=new Set(),walk=v=>{if(typeof v==='number')assert.ok(Number.isFinite(v));if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);Object.values(v).forEach(walk);}};walk(inf);});
 check('full playback',()=>timed('playback',()=>new Playback(createRecording(r.plan,r.trace)).seek(r.trace.events.length)));
 const prepared=timed('prepare',()=>prepareStructures(r.plan,r.trace,inf)),
   encoded=timed('encodePrepared',()=>encodePreparedStructures(prepared)),wire=JSON.stringify(encoded);
 report.metrics.preparedExpandedBytes=Buffer.byteLength(JSON.stringify(prepared));report.metrics.preparedWireBytes=Buffer.byteLength(wire);
 report.metrics.preparedEntries=prepared.tracks.reduce((n,t)=>n+Object.values(t.variants).reduce((n,v)=>n+v.entries.length,0),0);
 check('every prepared version survives transport',()=>assert.deepEqual(decodePreparedStructures(JSON.parse(wire)),prepared));
 check('all prepared boundary queries survive transport',()=>{
   const a=new PreparedStructures(prepared),b=new PreparedStructures(JSON.parse(wire));
   for(const t of prepared.tracks)for(const choice of Object.keys(t.variants)){
     a.setView(t.objectId,choice);b.setView(t.objectId,choice);
     for(const e of t.variants[choice].entries)assert.deepEqual(b.at(t.objectId,e.index),a.at(t.objectId,e.index));
   }
 });
 const positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
 report.recommendations=prepared.tracks.map(t=>({objectId:t.objectId,name:r.trace.objects.find(o=>o.id===t.objectId)?.name,view:t.variants.auto.view,
   alternatives:t.variants.auto.recommendations.map(c=>({view:c.view,status:c.status,coverage:c.coverage}))}));
 if(id.startsWith('12_'))check('BFS distance array is not a queue',()=>assert.notEqual(report.recommendations.find(t=>t.name==='dist')?.view,'queue'));
 if(id.startsWith('13_'))check('inverse parent roles preserve a selectable full tree',()=>{
   assert.ok(report.recommendations.some(t=>['tree','binary-tree','bst'].includes(t.view)&&t.alternatives.some(a=>a.coverage?.auxiliaryInverseRoles)));
 });
 if(id.startsWith('14_'))check('integer child slots connect sequence evidence',()=>{
   const seq=inf.structures.filter(s=>s.kind==='sequence-lookup-candidate');
   assert.ok(seq.some(s=>s.states.some(st=>st.nodes.length===6&&st.edges.length===5&&st.conditions.trie==='supported-observed')));
 });
 if(id.startsWith('18_'))check('matrix proof variants do not duplicate physical edges',()=>{
   const s=inf.structures.find(s=>s.kind==='observed-traversal-graph-candidate'&&s.evidence.some(p=>p.kind==='matrix-operand-pair'));
   assert.ok(s);
   const st=s.states.findLast(st=>st.edges.some(e=>e.status==='observed')),edges=st.edges.filter(e=>e.status==='observed');
   report.matrix={nodes:st.nodes.length,edges:edges.length,pairs:new Set(edges.map(e=>e.fromIndex+':'+e.toIndex)).size};
   assert.equal(edges.length,21);assert.equal(report.matrix.pairs,21);
 });
 if(/^(05_|15_|19_|20_|21_)/.test(id)){
   const work=timed('work',()=>analyzeRecordingWork(r.plan,r.trace,{ast:r.ast,observations:r.observations,structureInference:inf}));
   report.work={status:work.relations?.status??work.status,diagnostics:work.relations?.diagnostics??work.diagnostics};
   check('work analysis has no failed stage',()=>assert.ok(!['failed','not-implemented'].includes(report.work.status)));
   check('typed arrays have temporal bindings',()=>assert.ok(!report.work.diagnostics?.some(d=>d.code==='missing-structure-binding-time')));
   await fs.writeFile(out+'/work.json.gz',gzipSync(JSON.stringify(work)));
 }
 await fs.writeFile(out+'/inference.json.gz',gzipSync(JSON.stringify(encodeInference(inf))));
 await fs.writeFile(out+'/prepared.json.gz',gzipSync(wire));
 check('input plan and execution remain byte-identical',()=>assert.equal(hash({plan:r.plan,trace:r.trace}),before));
 report.metrics.maxRssKiB=process.resourceUsage().maxRSS;
}catch(e){report.checks.push({name:'pipeline',passed:false,message:e.stack});}
await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({id,failed:report.checks.filter(c=>!c.passed),metrics:report.metrics}));
if(report.checks.some(c=>!c.passed))process.exitCode=1;
