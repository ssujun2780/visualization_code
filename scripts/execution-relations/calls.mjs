import {recordIndex,range,relation} from './records.mjs';

export function inferCalls(context){
  const {calls,argumentsByFrame}=recordIndex(context),out=[];
  for(const {parent,child,call,begin} of calls){
    out.push(relation(`call:${child.frame.id}`,'activation-call',begin.eventId,[parent.frame.id,child.frame.id],[],[call.eventId,begin.eventId],
      {callerActivationId:parent.frame.id,calleeActivationId:child.frame.id,callExecutionId:call.eventId,entryExecutionId:begin.eventId}));
    for(const event of argumentsByFrame.get(child.frame.id)??[]){
      const ref=event.value?.reference,slot=range(context,event.target,event),object=context.object(ref?.targetObjectId);
      if(event.callExecutionId!==call.eventId||!slot||!object||!Number.isInteger(event.parameterIndex)||
        !Number.isSafeInteger(ref.targetOffset)||ref.targetOffset<0||ref.targetOffset>object.size||
        context.position(object.createdBy)>context.position(event.eventId)||context.position(object.createdBy)===undefined||
        context.position(object.endedBy)!==undefined&&context.position(object.endedBy)<=context.position(event.eventId))continue;
      const size=(event.value?.cType?.pointee?.sizeBits??0)/8;
      out.push(relation(`argument:${event.eventId}`,'pointer-argument',event.eventId,[parent.frame.id,child.frame.id],
        [{role:'parameter-slot',...slot}],[call.eventId,begin.eventId,event.eventId],{
          callExecutionId:call.eventId,parameterIndex:event.parameterIndex,
          reference:{objectId:object.id,offset:ref.targetOffset,onePast:ref.onePast===true},
          elementSizeBytes:Number.isSafeInteger(size)&&size>0?size:null,
          extent:'reference-only' // Passing a pointer does not prove any access.
        }));
    }
  }
  return out;
}
