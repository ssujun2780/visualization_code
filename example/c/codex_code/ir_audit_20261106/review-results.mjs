import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8')),base=new URL('../../../../test-results/ir-audit-2026-11-06/',import.meta.url),results=[],anomalies=[];
for(const spec of suite.cases){
 const folder=new URL(spec.id+'/',base),report=JSON.parse(await fs.readFile(new URL('report.json',folder),'utf8'));
 const plan=await fs.readFile(new URL('plan.json',folder),'utf8').then(JSON.parse).catch(()=>null),trace=await fs.readFile(new URL('trace.json',folder),'utf8').then(JSON.parse).catch(()=>null);
 const checked=[];const check=(name,expected,actual)=>checked.push({name,expected,actual,pass:JSON.stringify(expected)===JSON.stringify(actual)});
 if(plan&&trace){
  const defs=new Map(plan.instructions.map(d=>[d.id,d]));
  for(const [tag,expected]of Object.entries(spec.checks?.writes??{})){
   const lines=spec.source.split('\n').map((s,i)=>/@write:([A-Za-z0-9_]+)/.exec(s)?.[1]===tag?i+1:0).filter(Boolean);
   const actual=trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'&&lines.includes(defs.get(e.instructionId)?.source?.line)).map(e=>e.value?.decimal??e.value?.number??null);
   check('exact-tag-writes:'+tag,expected,actual);
  }
  for(const [name,count]of Object.entries(spec.checks?.calls??{})){
   const calls=trace.events.filter(e=>e.action==='call'&&(e.resolvedFunctionName??e.callee?.replace(/^@/,''))===name).length;
   const callbacks=trace.frames.filter(f=>f.functionName===name&&f.callbackOfCallEventId).length;
   check('observed-invocations:'+name,count,calls+callbacks);
  }
  for(const e of trace.events){const d=defs.get(e.instructionId);
   if(['read','write'].includes(e.action)&&!e.value?.cType&&d?.expression?.cType)anomalies.push({case:spec.id,category:'missing-access-ctype',event:e.eventId,kind:e.kind,expression:d.source?.expression,astType:d.expression.cType.name,recordedValue:e.value});
   if(e.action==='resume'&&/^(?:i\d+|float|double)$/.test(e.value?.type??'')&&e.value?.cType?.kind==='pointer')anomalies.push({case:spec.id,category:'scalar-return-labelled-pointer',event:e.eventId,expression:d.source?.expression,value:e.value});
   if(e.action==='call'&&e.callee?.startsWith('@')&&e.backendCallee?.startsWith('%'))anomalies.push({case:spec.id,category:'indirect-call-labelled-direct',event:e.eventId,expression:d.source?.expression,callee:e.callee,actual:e.resolvedFunctionName,backendCallee:e.backendCallee,instructionId:e.instructionId});
  }
 }
 const baseChecks=report.checks.filter(c=>!c.name.startsWith('writes:')&&!c.name.startsWith('calls:'));
 results.push({id:spec.id,status:report.status,events:report.events,expectedStdout:spec.stdout,baseFailures:baseChecks.filter(c=>!c.pass),processChecks:checked,diagnostics:report.diagnostics});
}
const summary={startKnown:'2026-11-06T01:38:42Z',generatedAt:new Date().toISOString(),scope:'IR only; no data structure inference review or implementation edits',caseCount:results.length,statuses:results.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{}),results};
await fs.writeFile(new URL('summary.json',base),JSON.stringify(summary,null,2)+'\n');await fs.writeFile(new URL('process-anomalies.json',base),JSON.stringify(anomalies,null,2)+'\n');
console.log(JSON.stringify({statuses:summary.statuses,processFailures:results.filter(r=>r.processChecks.some(c=>!c.pass)).map(r=>r.id),anomalies:anomalies.reduce((a,x)=>(a[x.category]=(a[x.category]??0)+1,a),{})}));
// Record current implementation hashes without changing any implementation file.
const paths=['scripts/model','scripts/instrumentation'],snapshot=[];
for(const dir of paths)for(const name of await fs.readdir(new URL('../../../../'+dir+'/',import.meta.url))){if(!name.endsWith('.mjs'))continue;const relative=dir+'/'+name,b=await fs.readFile(new URL('../../../../'+relative,import.meta.url));snapshot.push({path:relative,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
await fs.writeFile(new URL('model-snapshot.json',base),JSON.stringify({at:new Date().toISOString(),files:snapshot},null,2)+'\n');
