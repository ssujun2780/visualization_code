import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {traceModel} from '../../../../scripts/model/index.mjs';
import {compileAndRun} from '../../../../scripts/instrumentation/toolchain.mjs';
import {writeJSON} from '../../../../scripts/shared/json-output.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const base=path.join(root,'test-results/codex_code-results/human-style-2026-11-06');
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8'));
const expanded=process.argv.includes('--expanded-budget');
const selected=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const traceOptions=expanded?{timeoutMs:55000,maxEvents:200000,maxObservationBytes:67108864}:{timeoutMs:18000,maxEvents:60000,maxObservationBytes:33554432};
await fs.mkdir(base,{recursive:true});
for(const c of suite.cases.filter(c=>!selected.length||selected.includes(c.id))){
 const folder=path.join(base,c.id,...(expanded?['expanded-budget']:[]));await fs.mkdir(folder,{recursive:true});
 if(await fs.stat(path.join(folder,'report.json')).catch(()=>null)){console.log(JSON.stringify({id:c.id,status:'already-recorded'}));continue;}
 const source=await fs.readFile(new URL(c.id+'.c',import.meta.url),'utf8');
 if(crypto.createHash('sha256').update(source).digest('hex')!==c.sha256)throw Error('Prediction and source differ: '+c.id);
 const save=(name,value)=>name.endsWith('.json')?writeJSON(path.join(folder,name),value):fs.writeFile(path.join(folder,name),value??'');
 await save('prediction.json',c);await save('original.c',source);
 const report={id:c.id,title:c.title,started:new Date().toISOString(),traceOptions,checks:[]};
 const check=(name,expected,actual)=>report.checks.push({name,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual)});
 for(const opt of ['O0','O2']){
  const exe=path.join(folder,`native-${opt}.exe`),build=spawnSync('gcc',['-std=c11','-Wall','-Wextra','-pedantic',`-${opt}`,path.relative(root,path.join(folder,'original.c')),'-o',path.relative(root,exe)],{cwd:root,encoding:'utf8',timeout:15000});
  await save(`native-${opt}.build.txt`,(build.stdout??'')+(build.stderr??''));check(`native-${opt} build`,0,build.status);
  if(build.status===0){const run=spawnSync(exe,[],{input:c.stdin,encoding:'utf8',timeout:4000});check(`native-${opt} exit`,c.exitCode,run.status);check(`native-${opt} stdout`,c.stdout,(run.stdout??'').replaceAll('\r\n','\n'));await save(`native-${opt}.stdout.txt`,run.stdout??'');}
 }
 if(report.checks.some(q=>!q.pass)){report.status='fixture-review';report.failed=report.checks.filter(q=>!q.pass);await save('report.json',report);console.log(JSON.stringify(report));continue;}
 try{
  const plain=await compileAndRun(source,undefined,{stdin:c.stdin});check('plain exit',c.exitCode,plain.exitCode);check('plain stdout',c.stdout,plain.stdout);await save('plain.json',plain);
  if(report.checks.some(q=>!q.pass)){report.status='fixture-review';}
  else{
   const r=await traceModel(source,{filename:c.id+'.c',stdin:c.stdin,includeObservations:true,...traceOptions});
   for(const [name,value]of Object.entries({'plan.json':r.plan,'trace.json':r.trace,'raw-plan.json':r.observations?.plan,'raw-trace.json':r.observations?.trace,'source.ast.txt':r.ast,'source.ll':r.llvm,'instrumented.ll':r.instrumentedLLVM,'conversion-failure.json':r.conversionFailure,'conversion-notice.json':r.conversionNotice,'compiler.txt':r.compilerDiagnostics,'stdout.txt':r.stdout,'stderr.txt':r.stderr}))if(value!=null)await save(name,value);
   report.status=r.trace.status;report.events=r.trace.events.length;report.diagnostics=r.trace.diagnostics;
   check('IR status','completed',r.trace.status);check('IR stdout',c.stdout,r.stdout);check('IR exit',c.exitCode,r.trace.exitCode);
   check('IR gaps',[],r.trace.coverage.irGaps??[]);check('raw coverage gaps',[],r.trace.coverage.gaps??[]);check('unexplained',[],r.trace.coverage.observationAccounting?.unexplained??[]);
   const defs=new Map((r.plan?.instructions??[]).map(d=>[d.id,d])),objects=new Map(r.trace.objects.map(o=>[o.id,o]));
   for(const [name,count]of Object.entries(c.checks?.calls??{}))check(`calls:${name}`,count,r.trace.events.filter(e=>e.action==='call'&&(e.resolvedFunctionName??e.callee?.replace(/^@/,''))===name).length+r.trace.frames.filter(f=>f.functionName===name&&f.callbackOfCallExecutionId).length);
   for(const spec of c.checks?.calcCounts??[])check(`calc:${spec.expression}`,spec.count,r.trace.events.filter(e=>e.kind==='CALC'&&defs.get(e.instructionId)?.source?.expression===spec.expression).length);
   for(const spec of c.checks?.calcValues??[])check(`calc-values:${spec.expression}`,spec.values,r.trace.events.filter(e=>e.kind==='CALC'&&defs.get(e.instructionId)?.source?.expression===spec.expression).map(e=>e.value?.decimal??e.value?.number));
   for(const [name,count]of Object.entries(c.checks?.objectCounts??{}))check(`lifetimes:${name}`,count,r.trace.objects.filter(o=>o.name===name).length);
   if(c.checks?.heapObjects!==undefined)check('heap object count',c.checks.heapObjects,r.trace.objects.filter(o=>o.storage==='heap').length);
   if(c.checks?.allHeapEnded)check('all heaps ended',true,r.trace.objects.filter(o=>o.storage==='heap').every(o=>o.lifecycle==='ended'));
   for(const spec of c.checks?.writes??[])check(`writes:${spec.object}`,spec.values,r.trace.events.filter(e=>e.action==='write'&&objects.get(e.target?.objectId)?.name===spec.object).map(e=>e.value?.decimal??e.value?.number));
   const untyped=r.trace.events.filter(e=>['read','write'].includes(e.action)&&defs.get(e.instructionId)?.source&&e.value&&!e.value.cType).map(e=>({id:e.eventId,kind:e.kind,line:defs.get(e.instructionId).source.line,expression:defs.get(e.instructionId).source.expression,value:e.value}));
   const undelivered=(r.trace.resultDeliveries??[]).filter(d=>d.status==='unresolved');
   report.reviewCandidates={untyped,undelivered};
   await save('timeline.json',r.trace.events.map(e=>({id:e.eventId,line:defs.get(e.instructionId)?.source?.line,kind:e.kind,action:e.action,phase:e.phase,expression:defs.get(e.instructionId)?.source?.expression,callee:e.resolvedFunctionName??e.callee,value:e.value,target:e.target,dataInputs:e.dataInputs,addressInputs:e.addressInputs,callExecutionId:e.callExecutionId,endedObjects:e.endedObjects,text:e.text})));
  }
 }catch(error){report.status='exception';report.error=error.stack;await save('exception.txt',error.stack??String(error));}
 report.failed=report.checks.filter(q=>!q.pass);report.finished=new Date().toISOString();await save('report.json',report);
 console.log(JSON.stringify({id:c.id,status:report.status,events:report.events,failed:report.failed,untyped:report.reviewCandidates?.untyped.length,undelivered:report.reviewCandidates?.undelivered.length,diagnostics:report.diagnostics,error:report.error}));
}
