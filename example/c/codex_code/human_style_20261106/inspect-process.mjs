import fs from 'node:fs/promises';
const base=new URL('../../../../test-results/codex_code-results/human-style-2026-11-06/',import.meta.url);
const reports=[];
for(const directory of await fs.readdir(base,{withFileTypes:true})){
 if(!directory.isDirectory())continue;
 let dir=new URL(directory.name+'/',base);
 if(await fs.stat(new URL('expanded-budget/trace.json',dir)).catch(()=>null))dir=new URL('expanded-budget/',dir);
 let trace,plan;try{trace=JSON.parse(await fs.readFile(new URL('trace.json',dir),'utf8'));plan=JSON.parse(await fs.readFile(new URL('plan.json',dir),'utf8'));}catch{continue;}
 const events=new Map(trace.events.map((e,i)=>[e.eventId,{e,i}])),objects=new Map(trace.objects.map(o=>[o.id,o])),defs=new Map(plan.instructions.map(d=>[d.id,d]));
 const findings=[];
 function record(kind,e,detail){findings.push({kind,id:e.eventId,line:defs.get(e.instructionId)?.source?.line,expression:defs.get(e.instructionId)?.source?.expression,...detail});}
 for(const [i,e]of trace.events.entries()){
  for(const type of ['dataInputs','addressInputs','controlInputs','calleeInputs'])for(const input of e[type]??[]){const producer=events.get(input);if(!producer||producer.i>=i)record('dependency-order',e,{type,input,producerIndex:producer?.i});}
  if(e.target?.objectId&&['READ','WRITE'].includes(e.kind)){
   const o=objects.get(e.target.objectId),birth=events.get(o?.createdBy)?.i,end=events.get(o?.endedBy)?.i;
   if(!o)record('unknown-target',e,{target:e.target});
   else if(birth!==undefined&&birth>i)record('before-birth',e,{objectId:o.id,birth:o.createdBy});
   else if(end!==undefined&&end<i)record('after-end',e,{objectId:o.id,end:o.endedBy});
   if(o&&e.target.offset!=null&&e.target.size!=null&&o.size!=null&&(e.target.offset<0||e.target.offset+e.target.size>o.size))record('target-range',e,{objectId:o.id,target:e.target,size:o.size});
  }
  if(e.kind==='CALC'&&!e.value&&e.phase!=='attempt')record('calc-no-result',e,{});
 }
 const report={id:directory.name,findings,outputEvents:trace.events.filter(e=>e.action==='output').map(e=>({id:e.eventId,line:defs.get(e.instructionId)?.source?.line,expression:defs.get(e.instructionId)?.source?.expression,text:e.text,bytes:e.bytes})),coverage:{unboundSourceWork:trace.coverage.unboundSourceWork,foldedCalculations:trace.coverage.foldedCalculations,pendingCleanup:trace.coverage.pendingCleanup,sourceOrder:trace.coverage.sourceOrder}};
 reports.push(report);await fs.writeFile(new URL('process-audit.json',dir),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({id:report.id,findings:findings.length,sample:findings.slice(0,4)}));
}
await fs.writeFile(new URL('process-audit.json',base),JSON.stringify(reports,null,2)+'\n');
