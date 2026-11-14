import fs from 'node:fs/promises';
import {traceModel} from '../../../../scripts/model/index.mjs';
const base=new URL('../../../../test-results/ir-audit-2026-11-06/faults/',import.meta.url);
const cases=[
 ['partial_expression','#include <stdio.h>\nint twice(int n){return n*2;}\nint main(void){int left=twice(3);int zero=0;puts("before");int result=(left+4)/zero;printf("%d\\n",result);return 0;}','division-by-zero'],
 ['string_destination','#include <stdio.h>\n#include <string.h>\nint main(void){char src[]="abc";char dst[2];puts("before");strcpy(dst,src);puts("after");return 0;}','object-bounds'],
 ['null_dereference','#include <stdio.h>\nint main(void){int *p=0;puts("before");int result=*p;printf("%d\\n",result);return 0;}','null-dereference'],
 ['partial_remainder','#include <stdio.h>\nint main(void){int left=6,zero=0;puts("before");int result=(left+4)%zero;printf("%d\\n",result);return 0;}','division-by-zero'],
 ['partial_denominator','#include <stdio.h>\nint main(void){int left=6,zero=0;puts("before");int result=left/(zero+0);printf("%d\\n",result);return 0;}','division-by-zero'],
 ['partial_literal_control','#include <stdio.h>\nint main(void){int left=6;puts("before");int result=(left+4)/0;printf("%d\\n",result);return 0;}','division-by-zero']
];
for(const [id,source,code]of cases){
 if(process.argv.length>2&&!process.argv.slice(2).includes(id))continue;
 const folder=new URL(id+'/',base);await fs.mkdir(folder,{recursive:true});const save=(n,x)=>fs.writeFile(new URL(n,folder),typeof x==='string'?x:JSON.stringify(x,null,2)+'\n');
 await save('original.c',source);await save('prediction.json',{status:'fault',code,stdout:'before\n',process:'Intentional fault, never run natively. Preserve completed work before error, no final write/result or after output.',at:new Date().toISOString()});
 const r=await traceModel(source,{includeObservations:true});await save('trace.json',r.trace);await save('plan.json',r.plan);await save('raw.json',r.observations);await save('stdout.txt',r.stdout??'');if(r.conversionFailure)await save('conversion-failure.json',r.conversionFailure);
 const d=new Map(r.plan.instructions.map(x=>[x.id,x]));const compact=r.trace.events.map(e=>({id:e.eventId,kind:e.kind,action:e.action,phase:e.phase,expression:d.get(e.instructionId)?.source?.expression,value:e.value,diagnostic:e.diagnostic}));await save('timeline.json',compact);
 console.log(JSON.stringify({id,status:r.trace.status,stdout:r.stdout,diagnostics:r.trace.diagnostics,last:compact.slice(-3)}));
}
