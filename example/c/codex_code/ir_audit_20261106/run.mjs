import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {traceModel} from '../../../../scripts/model/index.mjs';
import {compileAndRun} from '../../../../scripts/instrumentation/toolchain.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const base=path.join(root,'test-results/ir-audit-2026-11-06');
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8'));
const selected=process.argv.slice(2);
await fs.mkdir(base,{recursive:true});
for(const c of suite.cases.filter(c=>!selected.length||selected.includes(c.id))){
 const folder=path.join(base,c.id);await fs.mkdir(folder,{recursive:true});
 if(await fs.stat(path.join(folder,'report.json')).catch(()=>null)){
  const archive=path.join(folder,'attempts',String(Date.now()));await fs.mkdir(archive,{recursive:true});
  for(const file of await fs.readdir(folder,{withFileTypes:true}))if(file.isFile())await fs.copyFile(path.join(folder,file.name),path.join(archive,file.name));
 }
 const save=(name,value)=>fs.writeFile(path.join(folder,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
 const source=await fs.readFile(new URL(`${c.id}.c`,import.meta.url),'utf8');
 if(crypto.createHash('sha256').update(source).digest('hex')!==c.sha256)throw Error('Prediction/source mismatch');
 await save('prediction.json',c);await save('original.c',source);
 const report={id:c.id,started:new Date().toISOString(),checks:[]};
 const check=(name,expected,actual)=>report.checks.push({name,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual)});
 for(const level of ['O0','O2']){
  const exe=path.join(folder,`native-${level}.exe`);
  const build=spawnSync('gcc',['-std=c11','-Wall','-Wextra','-pedantic',`-${level}`,path.relative(root,path.join(folder,'original.c')),'-o',path.relative(root,exe)],{cwd:root,encoding:'utf8',timeout:15000});
  await save(`native-${level}.build.txt`,`${build.stdout??''}${build.stderr??''}`);
  check(`native-${level} build`,0,build.status);
  if(build.status===0){const run=spawnSync(exe,[],{input:c.stdin??'',encoding:'utf8',timeout:5000});check(`native-${level} exit`,0,run.status);check(`native-${level} stdout`,c.stdout,(run.stdout??'').replace(/\r\n/g,'\n'));await save(`native-${level}.stdout.txt`,run.stdout??'');}
 }
 if(report.checks.some(x=>!x.pass)){report.status='fixture-review';await save('report.json',report);console.log(JSON.stringify(report));continue;}
 try{
  const plain=await compileAndRun(source,undefined,{stdin:c.stdin??''});check('plain stdout',c.stdout,plain.stdout);check('plain exit',0,plain.exitCode);await save('plain.json',plain);
  const r=await traceModel(source,{stdin:c.stdin??'',filename:c.id+'.c',includeObservations:true,maxEvents:40000,timeoutMs:20000});
  for(const [name,value]of Object.entries({'plan.json':r.plan,'trace.json':r.trace,'raw-plan.json':r.observations?.plan,'raw-trace.json':r.observations?.trace,'source.ast.txt':r.ast,'source.ll':r.llvm,'instrumented.ll':r.instrumentedLLVM,'conversion-failure.json':r.conversionFailure,'stdout.txt':r.stdout,'stderr.txt':r.stderr,'compiler.txt':r.compilerDiagnostics}))if(value!=null)await save(name,value);
  report.status=r.trace.status;report.events=r.trace.events.length;report.diagnostics=r.trace.diagnostics;report.coverage=r.trace.coverage;
  check('IR status','completed',r.trace.status);check('IR stdout',c.stdout,r.stdout);check('IR exit',0,r.trace.exitCode);
  if(c.stderr!=null)check('IR stderr',c.stderr,r.stderr);
  check('IR gaps',[],r.trace.coverage.irGaps??[]);check('unexplained',[],r.trace.coverage.observationAccounting?.unexplained??[]);
  const defs=new Map((r.plan?.instructions??[]).map(x=>[x.id,x]));
  for(const [name,count]of Object.entries(c.checks?.calls??{})){
   const direct=r.trace.events.filter(e=>e.action==='call'&&(e.resolvedFunctionName??e.callee?.replace(/^@/,''))===name).length;
   const callbacks=r.trace.frames.filter(f=>f.functionName===name&&f.callbackOfCallEventId).length;
   check(`calls:${name}`,count,direct+callbacks);
  }
  for(const [tag,values]of Object.entries(c.checks?.writes??{})){
   const lines=source.split('\n').map((s,i)=>/@write:([A-Za-z0-9_]+)/.exec(s)?.[1]===tag?i+1:0).filter(Boolean);
   check(`writes:${tag}`,values,r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&lines.includes(defs.get(e.instructionId)?.source?.line)).map(e=>e.value?.decimal??e.value?.number??null));
  }
  await save('timeline.json',r.trace.events.map(e=>({id:e.eventId,instructionId:e.instructionId,line:defs.get(e.instructionId)?.source?.line,kind:e.kind,action:e.action,operator:e.operator,callee:e.resolvedFunctionName??e.callee,value:e.value,target:e.target,dataInputs:e.dataInputs,controlInputs:e.controlInputs,source:defs.get(e.instructionId)?.expression,condition:e.condition,selected:e.selected,text:e.text})));
 }catch(error){report.status='exception';report.error=error.stack;await save('exception.txt',error.stack??String(error));}
 report.finished=new Date().toISOString();report.failed=report.checks.filter(x=>!x.pass);await save('report.json',report);
 console.log(JSON.stringify({id:c.id,status:report.status,events:report.events,failed:report.failed,error:report.error,diagnostics:report.diagnostics}));
}
