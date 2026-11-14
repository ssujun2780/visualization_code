import {complete,unique} from './common.mjs';

export function callLinks(c,events,emit){
  const pending=new Map(),byFrame=new Map(),byCall=new Map(),unresolved=new Set();
  for(const e of events){if(!emit.tick(e.eventId))break;emit.progress('call-links',e);if(!complete(e))continue;
    if(e.kind==='FLOW'&&e.action==='call'){const stack=pending.get(e.activationId)??[];stack.push(e);pending.set(e.activationId,stack);}
    if(e.action==='frame.begin'){
      const frame=c.frame(e.activationId),call=pending.get(frame?.parent)?.at(-1);
      if(frame?.parent&&call?.resolvedFunctionId===frame.functionId){const link={call,entry:e,frame};byFrame.set(frame.id,link);byCall.set(call.eventId,link);
        emit.relation('activation-call',e,[{kind:'activation',role:'caller',activationId:frame.parent},{kind:'activation',role:'callee',activationId:frame.id}],
          {callExecutionId:call.eventId,entryExecutionId:e.eventId},[call.eventId,e.eventId],{activationIds:[frame.parent,frame.id]});
      }else if(frame?.parent)unresolved.add(e.eventId);
    }
    if(e.action==='argument'){
      const link=byFrame.get(e.activationId);
      if(!link||link.call.eventId!==e.callExecutionId||!Number.isInteger(e.parameterIndex)||e.parameterIndex<0)unresolved.add(e.eventId);
      else emit.relation('argument-transfer',e,[],{callExecutionId:link.call.eventId,parameterIndex:e.parameterIndex,argumentExecutionId:e.eventId},[link.call.eventId,link.entry.eventId,e.eventId]);
    }
    if(e.action==='return.value'&&e.callExecutionId){const link=byFrame.get(e.activationId);if(!link||link.call.eventId!==e.callExecutionId)unresolved.add(e.eventId);}
    if(e.action==='resume'){
      const call=c.event(e.callExecutionId),stack=pending.get(e.activationId)??[],index=stack.findIndex(p=>p.eventId===e.callExecutionId);
      if(index>=0)stack.splice(index,1);
      if(!call||call.action!=='call'||call.activationId!==e.activationId)unresolved.add(e.eventId);
      const returns=unique(e.dataInputs??[]).map(id=>c.event(id)).filter(x=>x?.action==='return.value');
      for(const returned of returns){const link=byFrame.get(returned.activationId);
        if(!link||link.call.eventId!==e.callExecutionId)unresolved.add(e.eventId);
        else emit.relation('return-transfer',e,[{kind:'port',role:'return-source',portKind:'return-port',activationId:returned.activationId,executionId:returned.eventId}],
          {callExecutionId:call.eventId,returnExecutionId:returned.eventId,resumeExecutionId:e.eventId},[call.eventId,returned.eventId,e.eventId]);}
    }
  }
  for(const executionId of unresolved)emit.issue('unresolved-call-transfer',{executionId});
  return {byFrame,byCall,unresolved};
}
