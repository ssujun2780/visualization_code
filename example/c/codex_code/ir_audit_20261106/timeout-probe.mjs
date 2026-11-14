import fs from 'node:fs/promises';
import {traceModel} from '../../../../scripts/model/index.mjs';
const timeoutMs=Number(process.argv[2]??1200),maxEvents=Number(process.argv[3]??1000000);
const flush=process.argv[4]==='flush';
const source='#include <stdio.h>\nint main(void){puts("before");'+(flush?'fflush(stdout);':'')+'unsigned n=0;for(;;)n++;}';
const started=Date.now();const r=await traceModel(source,{includeObservations:true,timeoutMs,maxEvents});
const summarize=e=>({id:e.eventId,kind:e.kind,action:e.action,keys:Object.keys(e),bytes:JSON.stringify(e).length,
 parts:Object.fromEntries(Object.entries(e).map(([k,v])=>[k,JSON.stringify(v)?.length??0]))});
const events=r.trace.events,indices=[0,1,2,10,100,1000,5000,10000,events.length-2,events.length-1].filter((x,i,a)=>x<events.length&&a.indexOf(x)===i);
let estimate=0;const samples=[];
for(let i=0;i<events.length;i+=Math.max(1,Math.floor(events.length/20))){const e=events[i],bytes=JSON.stringify(e).length;samples.push({index:i,id:e.eventId,bytes,data:e.dataInputs?.length,observations:e.observationIds?.length,steps:e.steps?.length});estimate+=bytes;}
const sizes=Object.fromEntries(Object.entries(r.trace).map(([k,v])=>{if(k==='events')return[k,{count:v.length}];try{return[k,{count:Array.isArray(v)?v.length:undefined,bytes:JSON.stringify(v).length}];}catch(e){return[k,{error:e.message}];}}));
const result={started:new Date(started).toISOString(),elapsedMs:Date.now()-started,timeoutMs,maxEvents,flush,source,status:r.trace.status,stdout:r.stdout,events:events.length,rawEvents:r.observations?.trace?.events.length,diagnostics:r.trace.diagnostics,sampled:samples,estimatedEventBytes:estimate/samples.length*events.length,detail:indices.map(i=>summarize(events[i])),outputEvents:events.filter(e=>e.action==='output').map(e=>({id:e.eventId,text:e.text})),transportedOutput:r.observations?.trace?.events.filter(e=>e.action?.startsWith('output')).map(e=>({id:e.eventId,action:e.action,text:e.text,bytesHex:e.bytesHex})),sizes};
await fs.writeFile(new URL(`../../../../test-results/ir-audit-2026-11-06/timeout-${timeoutMs}-${maxEvents}${flush?'-flush':''}.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,detail:undefined,sampled:undefined}));
