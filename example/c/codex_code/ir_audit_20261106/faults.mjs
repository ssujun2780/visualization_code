import fs from 'node:fs/promises';
import {traceModel} from '../../../../scripts/model/index.mjs';
const base=new URL('../../../../test-results/ir-audit-2026-11-06/faults/',import.meta.url);await fs.mkdir(base,{recursive:true});
const cases=[
 ['compile_error','int main(void){int x=2 return x;}','compile-error',null],
 ['uninitialized','#include <stdio.h>\nint main(void){puts("before");int x;int y=x+2;printf("%d\\n",y);return 0;}','fault','uninitialized-read'],
 ['array_bounds','#include <stdio.h>\nint main(void){int a[2]={1,2};puts("before");int i=2;int y=a[i];printf("%d\\n",y);return 0;}','fault','out-of-bounds'],
 ['use_after_free','#include <stdio.h>\n#include <stdlib.h>\nint main(void){int *p=malloc(sizeof *p);if(!p)return 1;*p=7;puts("before");free(p);printf("%d\\n",*p);return 0;}','fault','use-after-free'],
 ['scope_end','#include <stdio.h>\nint main(void){int *p;{int x=7;p=&x;}puts("before");printf("%d\\n",*p);return 0;}','fault','use-after-lifetime'],
 ['divide_zero','#include <stdio.h>\nint main(void){int a=8,b=0;puts("before");int c=a/b;printf("%d\\n",c);return 0;}','fault','division-by-zero'],
 ['overflow','#include <stdio.h>\n#include <limits.h>\nint main(void){int a=INT_MAX;puts("before");int c=a+1;printf("%d\\n",c);return 0;}','fault','signed-overflow'],
 ['short_circuit_safe','#include <stdio.h>\nint main(void){int *p=0;int ok=p&&*p;printf("%d\\n",ok);return 0;}','completed',null],
 ['event_limit','#include <stdio.h>\nint main(void){puts("before");unsigned n=0;for(;;)n++;}','limited',null,{maxEvents:300}],
 ['worker_timeout','#include <stdio.h>\nint main(void){puts("before");unsigned n=0;for(;;)n++;}','limited',null,{maxEvents:1000000,timeoutMs:2000}]
];
const summary=[];
for(const [id,source,status,code,options={}]of cases){
 const folder=new URL(id+'/',base);await fs.mkdir(folder,{recursive:true});
 const save=(name,x)=>fs.writeFile(new URL(name,folder),typeof x==='string'?x:JSON.stringify(x,null,2)+'\n');
 await save('original.c',source);await save('prediction.json',{status,code,process:'Intentional fault: NOT a valid-program correctness fixture. Preserve prior output/work and end at fault; do not execute native undefined behavior.',options,createdAt:new Date().toISOString()});
 try{
  const r=await traceModel(source,{includeObservations:true,maxEvents:30000,timeoutMs:10000,...options});
  await save('trace.json',r.trace);if(r.plan)await save('plan.json',r.plan);if(r.observations)await save('raw.json',r.observations);await save('stdout.txt',r.stdout??'');
  if(r.conversionFailure)await save('conversion-failure.json',r.conversionFailure);
  const item={id,expectedStatus:status,status:r.trace.status,expectedCode:code,diagnostics:r.trace.diagnostics,stdout:r.stdout,events:r.trace.events.length,last:r.trace.events.at(-1),coverage:r.trace.coverage};
  await save('report.json',item);summary.push(item);console.log(JSON.stringify({id,status:r.trace.status,diagnostics:r.trace.diagnostics,stdout:r.stdout,events:r.trace.events.length}));
 }catch(e){const item={id,error:e.stack};await save('report.json',item);summary.push(item);console.log(JSON.stringify(item));}
}
await fs.writeFile(new URL('summary.json',base),JSON.stringify(summary,null,2)+'\n');
