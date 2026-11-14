import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {traceWithInference as traceModel} from '../../../scripts/pipeline/trace-with-inference.mjs';
import {compileAndRun} from '../../../scripts/instrumentation/toolchain.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const suite=JSON.parse(await fs.readFile(new URL('./cases.json',import.meta.url),'utf8'));
const [caseId,inputId]=process.argv.slice(2),spec=suite.cases.find(c=>c.id===caseId),input=spec.inputs.find(i=>i.id===inputId);
const folder=path.join(root,'test-results/codex_code-results',caseId,inputId);await fs.mkdir(folder,{recursive:true});
if(await fs.stat(path.join(folder,'report.json')).catch(()=>null)){
 const archive=path.join(folder,'attempts',String(Date.now()));await fs.mkdir(archive,{recursive:true});
 for(const item of await fs.readdir(folder,{withFileTypes:true}))if(item.isFile())await fs.copyFile(path.join(folder,item.name),path.join(archive,item.name));
}
const sourcePath=path.join(root,'example/c/codex_code',spec.file),source=await fs.readFile(sourcePath,'utf8');
const save=(name,value)=>fs.writeFile(path.join(folder,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const started=new Date().toISOString(),prediction={createdAt:started,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),...input,
  intent:spec.intent,style:spec.style,representation:spec.representation,processPrediction:spec.processPrediction};
// This file is committed to disk before compiling/running either oracle or model.
await save('prediction.json',prediction);await save('original.c',source);await save('stdin.txt',input.stdin);
const report={id:caseId,inputId,started,sourceSha256:prediction.sourceSha256,native:[],checks:[],inference:{},issues:[]};
for(const level of ['O0','O2']){
  const exe=path.join(folder,`native-${level}.exe`),build=spawnSync('gcc',['-std=c11','-pedantic','-Wall','-Wextra','-Werror',`-${level}`,path.relative(root,sourcePath),'-o',path.relative(root,exe)],{cwd:root,encoding:'utf8',timeout:15000});
  await save(`native-${level}.build.txt`,(build.stdout??'')+(build.stderr??''));
  if(build.status!==0){report.native.push({level,build:build.status,error:build.error?.message});continue;}
  const run=spawnSync(exe,[],{input:input.stdin,encoding:'utf8',timeout:10000});
  await save(`native-${level}.stdout.txt`,run.stdout??'');await save(`native-${level}.stderr.txt`,run.stderr??'');
  report.native.push({level,build:0,exitCode:run.status,stdout:run.stdout,agrees:run.status===0&&run.stdout?.replace(/\r\n/g,'\n')===input.stdout,newlinePolicy:'Windows CRLF normalized only for cross-platform comparison; raw output retained',error:run.error?.message});
}
// Instrumentation is not a correctness oracle for its own input program.
if(report.native.some(n=>!n.agrees)){
 report.status='fixture-needs-review';report.issues.push('Native C did not match the prior independent prediction. Do not attribute to model.');
 await save('report.json',report);console.log(JSON.stringify(report));process.exit(0);
}
try{
 const plain=await compileAndRun(source,undefined,{stdin:input.stdin});
 report.plainWasm={exitCode:plain.exitCode,stdout:plain.stdout,agrees:plain.exitCode===0&&plain.stdout===input.stdout};
 await save('plain-wasm.stdout.txt',plain.stdout);await save('plain-wasm.diagnostics.txt',plain.compilerDiagnostics??'');
 const r=await traceModel(source,{stdin:input.stdin,filename:`example/c/codex_code/${spec.file}`,includeObservations:true,maxEvents:160000,timeoutMs:30000});
 for(const [name,value]of Object.entries({'plan.json':r.plan,'trace.json':r.trace,'original.ast.txt':r.ast,'original.ll':r.llvm,'instrumented.ll':r.instrumentedLLVM,
   'observations.plan.json':r.observations?.plan,'observations.trace.json':r.observations?.trace,'stdout.txt':r.stdout,'diagnostics.txt':r.compilerDiagnostics}))if(value!=null)await save(name,value);
 report.status=r.trace.status;report.events=r.trace.events.length;report.objects=r.trace.objects.length;report.frames=r.trace.frames.length;
 report.diagnostics=r.trace.diagnostics;report.coverage=r.trace.coverage;
 const check=(name,expected,actual)=>report.checks.push({name,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual)});
 check('status','completed',r.trace.status);check('exitCode',0,r.trace.exitCode);check('stdout',input.stdout,r.stdout);
 if(r.plan){
  const defs=new Map(r.plan.instructions.map(i=>[i.id,i])),objects=new Map(r.trace.objects.map(o=>[o.id,o]));
  for(const [tag,expected]of Object.entries(input.writes??{})){
    const lines=source.split('\n').map((s,i)=>s.includes(`@trace:${tag}`)?i+1:null).filter(Boolean);
    const events=r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&lines.includes(defs.get(e.instructionId)?.source?.start?.line));
    check(`write-sequence:${tag}`,expected,events.map(e=>e.value?.decimal??e.value?.number??null));
    await save(`writes-${tag}.json`,events);
  }
  for(const [name,expected]of Object.entries(input.calls??{}))check(`calls:${name}`,expected,r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionName===name).length);
  check('IR gaps',[],r.trace.coverage.irGaps??[]);check('unexplained observations',[],r.trace.coverage.observationAccounting?.unexplained??[]);
  check('unmapped observations',[],r.plan.coverage.unmappedObservations??[]);
  const summaries=r.inference.structures.map(s=>({id:s.id,kind:s.kind,views:s.views,origin:s.origin,
    objectId:s.objectId,objectName:objects.get(s.objectId)?.name,root:s.root,roles:s.roles,capacity:s.capacity,dimensions:s.dimensions,
    nodeCount:s.logicalNodes?.length??s.nodes?.length,edgeCount:s.edges?.length,rootStructureIds:s.rootStructureIds,
    maxStateEdges:Math.max(0,...(s.states??[]).map(x=>x.edges?.length??0)),
    maxStateNodes:Math.max(0,...(s.states??[]).map(x=>x.nodes?.length??x.reachableNodeCount??0)),
    topologies:[...new Set((s.states??[]).map(x=>JSON.stringify(x.topology)).filter(Boolean))].map(x=>JSON.parse(x)),
    stateCount:s.states?.length,latestValidState:s.latestValidState,
    rootAliveStates:(s.states??[]).filter(x=>x.rootAlive).length}));
  await save('structures-summary.json',summaries);
  report.inference={intent:spec.intent,kinds:[...new Set(summaries.map(s=>s.kind))],views:[...new Set(summaries.flatMap(s=>s.views??[]))],
    candidates:summaries.length,expectedCandidates:spec.inferenceHints??[],review:'candidate presence is not proof of author intent; review roles and history separately'};
  report.inference.hints=(spec.inferenceHints??[]).map(h=>({hint:h,found:summaries.some(s=>s.kind===h||s.views?.includes(h))}));
  report.inference.unexpected=(spec.forbidInference??[]).filter(h=>summaries.some(s=>s.kind===h||s.views?.includes(h)));
  report.failedChecks=report.checks.filter(c=>!c.pass);
  report.processAssessment=report.failedChecks.length?'mismatch':'checked-process-matches';
 }
}catch(error){report.status='tool-or-model-exception';report.error=error.stack??String(error);await save('exception.txt',report.error);}
report.finished=new Date().toISOString();await save('report.json',report);
console.log(JSON.stringify({id:caseId,inputId,status:report.status,events:report.events,failed:report.failedChecks?.map(c=>c.name),error:report.error,inference:report.inference}));
