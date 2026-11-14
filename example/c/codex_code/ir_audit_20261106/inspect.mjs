import fs from 'node:fs/promises';
const [id,...rest]=process.argv.slice(2),root=new URL('../../../../test-results/ir-audit-2026-11-06/',import.meta.url);
const plan=JSON.parse(await fs.readFile(new URL(id+'/plan.json',root),'utf8')),trace=JSON.parse(await fs.readFile(new URL(id+'/trace.json',root),'utf8'));
const defs=new Map(plan.instructions.map(d=>[d.id,d])),objects=new Map(trace.objects.map(o=>[o.id,o]));
const val=v=>v?.decimal??v?.number??(v?.address?{address:v.address,reference:v.reference}:v?.kind?{kind:v.kind,type:v.cType?.name}:v);
for(const e of trace.events){const d=defs.get(e.instructionId),line=d?.source?.line??d?.source?.start?.line;
 if(rest.length&&!rest.includes(String(line))&&!rest.includes(e.kind)&&!rest.includes(e.action))continue;
 console.log(JSON.stringify({id:e.eventId,line,kind:e.kind,action:e.action,op:e.operator,expr:d?.source?.expression,
 value:val(e.value),type:e.value?.cType?.name,condition:e.condition,target:e.target?{...e.target,name:objects.get(e.target.objectId)?.name}:undefined,
 input:e.inputs?.map(x=>({kind:x.kind,role:x.role,event:x.eventId??x.executionId,value:val(x.value)})),data:e.dataInputs,control:e.controlInputs,
 callee:e.resolvedFunctionName??e.callee,text:e.text,channel:e.channel,frame:e.activationId,returnTo:e.delivery,selection:e.selection}));
}
