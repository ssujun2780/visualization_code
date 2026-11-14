import {createValueFlow} from './observed-value-flow.mjs';
const sameSlot=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset===b.offset&&a.size===b.size;
// Observe one cursor update across exact call/return deliveries. This is not a
// function-wide return summary and never aliases every argument of a call.
export function returnedLinkRecurrences(plan,trace,fieldOf){
 if(!trace?.resultDeliveries?.length)return [];
 const events=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),defs=new Map(plan.instructions.map(d=>[d.id,d])),
  objects=new Map(trace.objects.map(o=>[o.id,o])),decls=new Map(plan.declarations.map(d=>[d.id,d])),flow=trace.valueFlow??createValueFlow(plan,trace),out=new Map();
 for(const write of trace.events){
  if(write.kind!=='WRITE'||write.action!=='write'||write.phase==='failed'||write.value?.cType?.kind!=='pointer')continue;
  const object=objects.get(write.target?.objectId),declaration=decls.get(defs.get(events.get(object?.createdBy)?.instructionId)?.declarationId);
  if(declaration?.cType?.kind!=='pointer'||write.target.offset!==0||write.target.size!==object.size)continue;
  const chain=flow.chain(write.eventId),resumes=chain.filter(e=>e.action==='resume');if(!resumes.length)continue;
  for(const read of flow.reads(write.eventId)){
  const field=fieldOf(defs.get(read.instructionId)?.expression);if(!field||!read.target)continue;
  const baseReads=(read.addressInputs??[]).flatMap(id=>flow.reads(id)),cursor=baseReads.find(e=>sameSlot(e.target,write.target)&&e.activationId===write.activationId),ref=cursor?.value?.reference;
  if(!cursor||ref?.status!=='in-bounds'||read.target.objectId!==ref.targetObjectId||read.target.offset!==(ref.targetOffset??0)+field.offset||read.target.size!==field.size)continue;
  const callInstructionIds=[...new Set(resumes.map(e=>events.get(e.callExecutionId)?.instructionId).filter(Boolean))],key=`${declaration.id}:${field.fieldNodeId}`;
  let row=out.get(key);if(!row){row={cursorDeclarationId:declaration.id,fieldNodeId:field.fieldNodeId,callInstructionIds:[],evidence:'observed cursor/link read and identity-preserving call-result delivery',returnWitnesses:[]};out.set(key,row);}
  row.callInstructionIds=[...new Set([...row.callInstructionIds,...callInstructionIds])];
  const evidenceExecutionIds=[...new Set([cursor.eventId,read.eventId,write.eventId,...chain.filter(e=>['resume','return.value'].includes(e.action)).flatMap(e=>[e.eventId,e.callExecutionId]),...baseReads.map(e=>e.eventId)].filter(Boolean))].sort((a,b)=>positions.get(a)-positions.get(b));
  row.returnWitnesses.push({afterExecutionId:write.eventId,cursorObjectId:object.id,cursorReadExecutionId:cursor.eventId,fieldReadExecutionId:read.eventId,writeExecutionId:write.eventId,callExecutionIds:resumes.map(e=>e.callExecutionId),evidenceExecutionIds});
  }
 }
 return [...out.values()];
}
