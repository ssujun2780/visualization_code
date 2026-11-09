// Resolve observed provenance without growing the JavaScript call stack or
// expanding each shared path repeatedly. A role is part of an edge's meaning.
export function createObservationResolver({rawToExecution,executions,aliases,aliasRoles,valueForwardings,rawEvents,eventOrder},command){
  const memo=new Map();
  const add=(out,role,id)=>{
    if(!id)return;
    if(!out.has(role))out.set(role,new Set());
    out.get(role).add(id);
  };
  const merge=(out,other)=>{for(const [role,ids]of other??[])for(const id of ids)add(out,role,id);};
  function frame(id,role){
    const output=new Map(),children=[];
    const next=(ids,nextRole=role)=>{for(const child of ids??[])if(child&&child!=='unobserved')children.push({id:child,role:nextRole});};
    const executionId=rawToExecution.get(id),producer=executions.get(executionId);
    let partial;
    if(producer?.kind==='FLOW'&&producer.action==='conditional'&&valueForwardings.has(id)&&role!=='controlInputs'&&executionId!==command.eventId){
      add(output,'controlInputs',executionId);next(valueForwardings.get(id).map(input=>input.observationId));
    }else if(!producer){
      if(aliasRoles.has(id))for(const [inputRole,ids]of Object.entries(aliasRoles.get(id))){
        const nextRole=inputRole==='controlInputs'||role==='controlInputs'?'controlInputs':role==='dataInputs'?inputRole:role;
        next(ids,nextRole);
      }else next(command.kind==='CALC'&&role==='dataInputs'&&valueForwardings.has(id)?
        valueForwardings.get(id).map(input=>input.observationId):aliases.get(id));
    }else if(executionId!==command.eventId){
      if(producer.kind!=='CALC'||eventOrder.get(executionId)<eventOrder.get(command.eventId))add(output,role,executionId);
      else{
        const sample=rawEvents.get(id),step=producer.steps?.find(s=>s.observationIds.includes(id));
        next([...(sample?.dataInputs??[]),...(sample?.addressInputs??[])]);
        partial={role,executionId,observationId:id,sourceNodeId:step?.nodeId??null,value:step?.value??sample?.value,
          evidence:'observed subcalculation before expression completion'};
      }
    }
    return {id,role,key:`${role}:${id}`,output,children,at:0,partial};
  }
  return (id,role,related={})=>{
    if(!id||id==='unobserved')return [];
    const root=`${role}:${id}`,active=new Set(),stack=[];
    const push=f=>{active.add(f.key);stack.push(f);};
    if(!memo.has(root))push(frame(id,role));
    while(stack.length){
      const current=stack.at(-1);
      if(current.at<current.children.length){
        const child=current.children[current.at],key=`${child.role}:${child.id}`;
        if(memo.has(key)){merge(current.output,memo.get(key));current.at++;}
        else if(active.has(key)){
          const error=new Error('관찰 의존성에 순환이 있습니다.');error.code='ir-dependency-cycle';
          error.context={eventId:command.eventId,instructionId:command.instructionId,observationId:child.id,role:child.role};throw error;
        }else push(frame(child.id,child.role));
        continue;
      }
      if(current.partial){
        const list=command.partialCalculationInputs??=[];
        if(!list.some(p=>p.role===current.role&&p.observationId===current.id))
          list.push({...current.partial,inputExecutionIds:[...(current.output.get(current.role)??[])]});
      }
      memo.set(current.key,current.output);active.delete(current.key);stack.pop();
    }
    const output=memo.get(root);
    for(const [other,ids]of output)if(other!==role){const list=related[other]??=[];for(const next of ids)list.push(next);}
    return [...(output.get(role)??[])];
  };
}

export function createAliasResolver(rawToExecution,aliases){
  const memo=new Map();
  return id=>{
    if(!id||id==='unobserved')return [];
    if(memo.has(id))return memo.get(id);
    const seen=new Set(),pending=[id],result=new Set();
    while(pending.length){const next=pending.pop();if(!next||next==='unobserved'||seen.has(next))continue;seen.add(next);
      if(rawToExecution.has(next))result.add(rawToExecution.get(next));
      else if(memo.has(next))for(const value of memo.get(next))result.add(value);
      else {const children=aliases.get(next)??[];for(let i=children.length-1;i>=0;i--)pending.push(children[i]);}
    }
    const values=[...result];memo.set(id,values);return values;
  };
}
