import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {traceModel} from '../../../../scripts/model/index.mjs';
import {compileAndRun} from '../../../../scripts/instrumentation/toolchain.mjs';
import {encodeExecution,decodeExecution} from '../../../../scripts/shared/execution-format.mjs';
import {inferStructures,encodeInference,createInferenceView,validateStructureTrace} from '../../../../scripts/inference/index.mjs';
import {analyzeRecordingWork} from '../../../../scripts/animation/work-analysis.mjs';
import {prepareStructures,PreparedStructures} from '../../../../src/animation/prepared-structures.js';
import {createRecording,Playback,displayScene} from '../../../../src/animation/playback.js';
import {WorldLayout} from '../../../../src/animation/world.js';
import {conditionForEvent} from '../../../../src/animation/conditions.js';
import {dataFlowForEvent,instructionTiming} from '../../../../src/animation/transfers.js';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const out=path.join(root,'test-results/codex_code-results/end_to_end_audit_20261113');
const manifest=JSON.parse(await fs.readFile(path.join(here,'cases.json'),'utf8'));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const id=process.argv[2];
await fs.mkdir(out,{recursive:true});
if(!id||id==='suite'){
 const selected=process.argv.slice(3);
 for(const c of manifest.cases.filter(c=>!selected.length||selected.some(id=>c.id.startsWith(id)))){
  const log=await fs.open(path.join(out,c.id+'.log'),'w');
  const child=spawn(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),c.id],{cwd:root,stdio:['ignore',log.fd,log.fd]});
  const timeout=setTimeout(()=>child.kill(),180000);
  const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timeout);await log.close();
  const r=await fs.readFile(path.join(out,c.id,'report.json'),'utf8').then(JSON.parse).catch(()=>null);
  console.log(JSON.stringify({id:c.id,code,status:r?.status,events:r?.events,issues:r?.checks?.filter(x=>!x.pass).map(x=>x.name),stages:r?.stages?.map(s=>[s.name,Math.round(s.ms),s.error])}));
 }
 process.exit(0);
}
const spec=manifest.cases.find(c=>c.id===id);if(!spec)throw new Error('Unknown case');
const dir=path.join(out,id);await fs.mkdir(dir,{recursive:true});
const save=(name,v)=>fs.writeFile(path.join(dir,name),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
const source=await fs.readFile(path.join(here,spec.file),'utf8');
assert.equal(hash(source),spec.sourceSha256,'source changed after predictions were frozen');
await save('prediction.json',{...spec,recordedBeforeExecution:new Date().toISOString()});
const report={id,sourceSha256:hash(source),started:new Date().toISOString(),checks:[],stages:[]};
const check=(name,expected,actual)=>{const entry={name,pass:JSON.stringify(actual)===JSON.stringify(expected)};if(!entry.pass)Object.assign(entry,{expected,actual});report.checks.push(entry);};
async function stage(name,fn){
 await save('progress.json',{stage:name,at:new Date().toISOString()});
 global.gc?.();const start=performance.now(),before=process.memoryUsage();
 try{const v=await fn();report.stages.push({name,ms:performance.now()-start,heapDelta:process.memoryUsage().heapUsed-before.heapUsed,rss:process.memoryUsage().rss,maxRssKiB:process.resourceUsage().maxRSS});await save('report.json',report);return v;}
 catch(e){report.stages.push({name,ms:performance.now()-start,error:e.stack});check(name+' succeeded',true,false);await save('report.json',report);return null;}
}
let r;
if(process.env.AUDIT_REPLAY==='1'){
 r=decodeExecution(JSON.parse(gunzipSync(await fs.readFile(path.join(dir,'execution.json.gz')))));
}else{
 const native=await stage('native',async()=>{
  const exe=path.join(dir,'original.exe');
  const build=spawnSync('gcc',['-std=c11','-O0','-Wall','-Wextra',path.relative(root,path.join(here,spec.file)),'-o',path.relative(root,exe)],{cwd:root,encoding:'utf8',timeout:20000});
  await save('native-build.txt',(build.stdout??'')+(build.stderr??''));assert.equal(build.status,0);
  const run=spawnSync(exe,[],{input:spec.stdin,encoding:'utf8',timeout:10000});
  await save('native-stdout.txt',run.stdout??'');await save('native-stderr.txt',run.stderr??'');
  assert.equal(run.status,0);assert.equal(run.stdout.replace(/\r\n/g,'\n'),spec.expected.stdout);return run;
 });
 if(!native){report.status='fixture-or-native-failure';await save('report.json',report);process.exit(0);}
 const plain=await stage('plain-wasm',()=>compileAndRun(source,undefined,{stdin:spec.stdin}));
 if(plain){check('plain stdout',spec.expected.stdout,plain.stdout);check('plain exit',0,plain.exitCode);await save('plain-stdout.txt',plain.stdout);}
 r=await stage('model',()=>traceModel(source,{stdin:spec.stdin,filename:spec.file,includeObservations:true,maxEvents:160000,timeoutMs:60000}));
 if(r)await stage('save-execution',async()=>{const packed=JSON.stringify(encodeExecution(r));report.executionStoredBytes=Buffer.byteLength(packed);await fs.writeFile(path.join(dir,'execution.json.gz'),gzipSync(packed));});
}
if(!r){report.status='model-error';await save('report.json',report);process.exit(0);}
report.status=r.trace.status;report.events=r.trace.events.length;report.objects=r.trace.objects.length;report.frames=r.trace.frames.length;
report.diagnostics=r.trace.diagnostics;report.conversionFailure=r.conversionFailure;report.coverage=r.trace.coverage;
await save('stdout.txt',r.stdout);await save('stderr.txt',r.stderr??'');
check('model stdout',spec.expected.stdout,r.stdout);check('model exit',0,r.trace.exitCode);check('completed','completed',r.trace.status);
const original=hash({plan:r.plan,trace:r.trace});
await stage('ir-process',async()=>{
 const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
 const snippets={};
 for(const [tag,expected]of Object.entries(spec.expected.writes??{})){
  const lines=source.split('\n').flatMap((s,i)=>s.includes('@audit '+tag)?[i+1]:[]);
  const events=r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&lines.includes(defs.get(e.instructionId)?.source?.start?.line));
  check('write sequence '+tag,expected,events.map(e=>e.value?.decimal??e.value?.number??null));
  snippets[tag]=r.trace.events.filter(e=>lines.includes(defs.get(e.instructionId)?.source?.start?.line)).map(e=>({event:e,definition:defs.get(e.instructionId)}));
 }
 for(const [name,count]of Object.entries(spec.expected.calls??{}))check('call count '+name,count,r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionName===name).length);
 if(spec.expected.asserts!==undefined)check('assert count',spec.expected.asserts,r.trace.events.filter(e=>e.action==='assert.check').length);
 check('IR gaps',[],r.trace.coverage?.irGaps??[]);
 check('unexplained observations',[],r.trace.coverage?.observationAccounting?.unexplained??[]);
 check('unmapped observations',[],r.plan.coverage?.unmappedObservations??[]);
 report.actions=[...new Set(r.trace.events.map(e=>e.kind+'/'+e.action))].sort();
 await save('process-evidence.json',snippets);
});
let recording,player;
await stage('load-and-replay',async()=>{
 let t=performance.now();recording=createRecording(r.plan,r.trace);report.loadMs=performance.now()-t;
 t=performance.now();player=new Playback(recording);player.seek(r.trace.events.length);report.replayMs=performance.now()-t;
 check('replay cursor',r.trace.events.length,player.cursor);
 check('replay stdout',r.stdout,player.state.outputByChannel.get('stdout')??'');
 check('replay stderr',r.stderr??'',player.state.outputByChannel.get('stderr')??'');
 for(const e of r.trace.events){conditionForEvent(recording,e);dataFlowForEvent(recording,e);instructionTiming(recording,e);}
});
let decoded;
await stage('wire-roundtrip',async()=>{
 const packed=JSON.stringify(encodeExecution({plan:r.plan,trace:r.trace}));report.wireBytes=Buffer.byteLength(packed);
 report.expandedBytes=Buffer.byteLength(JSON.stringify({plan:r.plan,trace:r.trace}));
 decoded=decodeExecution(JSON.parse(packed));
 check('wire identity',original,hash(decoded));
});
let inference;
await stage('inference',async()=>{
 let t=performance.now();inference=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});report.inferenceComputeMs=performance.now()-t;
 t=performance.now();const view=createInferenceView(r,inference);validateStructureTrace(view.plan,view.trace);report.inferenceValidationMs=performance.now()-t;
 report.inference={status:inference.status,structures:inference.structures.length,diagnostics:inference.diagnostics,kinds:[...new Set(inference.structures.map(s=>s.kind))]};
 const summary=inference.structures.map(s=>({id:s.id,kind:s.kind,views:s.views,objectId:s.objectId,root:s.root,roles:s.roles,origin:s.origin,capacity:s.capacity,states:s.states?.length}));
 await save('structures-summary.json',summary);
 t=performance.now();const packed=JSON.stringify(encodeInference(inference));report.inferenceEncodeMs=performance.now()-t;report.inferenceBytes=Buffer.byteLength(packed);
 await fs.writeFile(path.join(dir,'inference.json.gz'),gzipSync(packed));
});
await stage('execution-relations',async()=>{
 const analysis=analyzeRecordingWork(r.plan,r.trace,{ast:r.ast,observations:r.observations,structureInference:inference});
 report.workDiagnostics=analysis.diagnostics;report.relationsDiagnostics=analysis.relations.diagnostics;report.relationsBytes=Buffer.byteLength(JSON.stringify(analysis.relations));
});
let prepared;
await stage('prepare',async()=>{
 const t=performance.now();prepared=prepareStructures(decoded.plan,decoded.trace,inference);report.prepareComputeMs=performance.now()-t;
 report.prepared={tracks:prepared.tracks.length,entries:prepared.tracks.reduce((n,t)=>n+Object.values(t.variants).reduce((s,v)=>s+v.entries.length,0),0),bytes:Buffer.byteLength(JSON.stringify(prepared))};
 await fs.writeFile(path.join(dir,'prepared.json.gz'),gzipSync(JSON.stringify(prepared)));
});
if(recording&&player&&prepared)await stage('geometry-and-history',async()=>{
 const p=new PreparedStructures(prepared),layout=new WorldLayout();layout.resolveType=recording.resolveType;layout.setPrepared(p);
 const points=[0,Math.floor(r.trace.events.length/2),r.trace.events.findLastIndex(e=>e.action==='output')+1,r.trace.events.length,0];
 const summaries=[];
 for(const count of points){
  player.seek(count);const scene=displayScene(recording,player.state),geometry=layout.resolve(scene);
  const live=[];
  for(const [oid,o]of scene.objects)if(o.alive&&!o.awaitingStorage)live.push(oid);
  for(const [oid,box]of geometry.objects){assert.ok(scene.objects.has(oid));assert.ok(Number.isFinite(box.x)&&Number.isFinite(box.y));}
  for(const box of geometry.cells.values()){
   const o=scene.objects.get(box.objectId);assert.ok(o);assert.ok(box.offset>=0&&box.offset+box.size<=o.size);
   const actual=o.renderCells?.find(c=>c.id===box.id);if(actual)assert.deepEqual(box.value,actual.value);
  }
  summaries.push({cursor:count,live,frames:[...scene.frames.values()].filter(f=>f.alive).map(f=>f.id),
    objects:geometry.objects.size,cells:geometry.cells.size,
    views:[...p.tracks.values()].map(t=>{const v=p.at(t.objectId,count-1);return v?{id:t.objectId,view:v.view,relation:v.relation}:null}).filter(Boolean)});
 }
 await save('scene-samples.json',summaries);
});
check('execution not mutated',original,hash({plan:r.plan,trace:r.trace}));
report.finished=new Date().toISOString();await save('report.json',report);
console.log(JSON.stringify({id,events:report.events,failed:report.checks.filter(c=>!c.pass)}));
