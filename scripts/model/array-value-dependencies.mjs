// Project observed value computations onto existing array storage. Reads are
// leaves: previous writers, addresses and controlling branches are not operands.
import {createValueFlow} from './observed-value-flow.mjs';

const unique=values=>[...new Set(values)];
const complete=e=>e&&(!e.phase||e.phase==='complete');
const span=t=>({objectId:t.objectId,offset:t.offset,size:t.size});
const memory=(target,objects)=>{
  const object=objects.get(target?.objectId);
  return object&&Number.isSafeInteger(target.offset)&&Number.isSafeInteger(target.size)&&
    target.offset>=0&&target.size>0&&target.offset+target.size<=object.size;
};
const operands=e=>unique([...(e.dataInputs??[]),...(e.inputs??[]).map(i=>i.executionId).filter(id=>id&&id!==e.eventId)]);

export function arrayValueDependencies(plan,{events,objects,structures=[],resultDeliveries=[],valueFlow,location}){
  const byEvent=new Map(events.map(e=>[e.eventId,e])),order=new Map(events.map((e,i)=>[e.eventId,i])),
    byObject=new Map(objects.map(o=>[o.id,o])),defs=new Map((plan.instructions??[]).map(d=>[d.id,d])),
    arrays=structures.filter(s=>s.kind==='array'),returns=new Map(),relations=[];
  const before=(a,b)=>!!a&&!!b&&order.get(a.eventId)<order.get(b.eventId),
    sameActivation=(a,b)=>a.activationId===b.activationId;
  const locate=location??(target=>{
    if(!memory(target,byObject))return null;
    const array=arrays.filter(a=>a.objectId===target.objectId&&target.offset>=a.range.offset&&
      target.offset+target.size<=a.range.offset+a.range.size).sort((a,b)=>a.range.size-b.range.size)[0];
    return {...span(target),...(array?{arrayId:array.id,index:Math.floor((target.offset-array.range.offset)/array.elementBytes),
      elementOffset:(target.offset-array.range.offset)%array.elementBytes,elementBytes:array.elementBytes}:{})};
  });
  const flow=valueFlow??createValueFlow(plan,{events,resultDeliveries});
  for(const delivery of resultDeliveries){
    const call=byEvent.get(delivery.callExecutionId),resume=byEvent.get(delivery.resumeExecutionId),
      boundary=byEvent.get(delivery.returnExecutionId),returned=byEvent.get(delivery.returnValueExecutionId);
    if(![call,resume,boundary,returned].every(complete)||call.action!=='call'||resume.action!=='resume'||
      boundary.action!=='return'||returned.action!=='return.value'||resume.callExecutionId!==call.eventId||
      returned.callExecutionId!==call.eventId||boundary.callExecutionId!==call.eventId||
      resume.returnExecutionId!==boundary.eventId||!sameActivation(call,resume)||!sameActivation(returned,boundary)||
      delivery.callerActivationId!==call.activationId||!resume.dataInputs?.includes(returned.eventId)||
      !before(call,returned)||!before(returned,boundary)||!before(boundary,resume))continue;
    returns.set(resume.eventId,{returned,call,boundary});
  }
  for(const write of events){
    if(!complete(write)||write.kind!=='WRITE'||write.action!=='write'||!memory(write.target,byObject))continue;
    // A value-preserving copy (including a proven widening) keeps the existing
    // transfer contract. Arithmetic such as +0 is never an identity transfer.
    if(flow.sourceRead(write.eventId))continue;
    const target=locate(write.target),sources=new Map(),calculations=new Map(),edges=[],controls=new Set(),
      unknown=[],seen=new Set(),calls=new Map();
    const fail=(executionId,reason)=>unknown.push({executionId,reason});
    const visit=(event,consumer)=>{
      if(!complete(event)||!before(event,consumer)){fail(event?.eventId??null,'missing, incomplete or nonpreceding value producer');return;}
      const crossing=consumer.kind==='FLOW'&&consumer.action==='resume'&&returns.get(consumer.eventId)?.returned===event;
      if(!sameActivation(event,consumer)&&!crossing){fail(event.eventId,'unverified cross-activation value edge');return;}
      edges.push({sourceExecutionId:event.eventId,targetExecutionId:consumer.eventId});
      if(seen.has(event.eventId))return;seen.add(event.eventId);
      for(const id of event.controlInputs??[])if(before(byEvent.get(id),event))controls.add(id);
      if(event.kind==='READ'){
        if(!memory(event.target,byObject)){fail(event.eventId,'read does not identify an observed memory range');return;}
        sources.set(event.eventId,{readExecutionId:event.eventId,storage:locate(event.target),value:event.value});return;
      }
      if(event.kind==='FLOW'){
        const delivery=returns.get(event.eventId);
        if(event.action!=='resume'||!delivery){fail(event.eventId,'no observed user return for this value');return;}
        calls.set(event.eventId,{callExecutionId:delivery.call.eventId,resumeExecutionId:event.eventId,
          returnExecutionId:delivery.boundary.eventId,returnValueExecutionId:delivery.returned.eventId});
        visit(delivery.returned,event);return;
      }
      if(event.kind==='CALC'){
        calculations.set(event.eventId,{executionId:event.eventId,operator:event.operator??defs.get(event.instructionId)?.operator??null,
          value:event.value,inputs:(event.inputs??[]).map(i=>({executionId:i.executionId??null,observationId:i.observationId??null,
            nodeId:i.nodeId??null,value:i.value})),
          stepNodeIds:unique((event.steps??[]).map(s=>s.nodeId).filter(Boolean))});
      }else if(event.kind!=='WRITE'||!['write','return.value','argument'].includes(event.action)){
        fail(event.eventId,'unsupported value producer kind');return;
      }
      const inputs=operands(event);
      if(!inputs.length&&!event.value)fail(event.eventId,'unobserved produced value');
      for(const id of inputs)visit(byEvent.get(id),event);
    };
    for(const id of write.controlInputs??[])if(before(byEvent.get(id),write))controls.add(id);
    for(const id of operands(write))visit(byEvent.get(id),write);
    if(!calculations.size||!target?.arrayId&&![...sources.values()].some(s=>s.storage?.arrayId))continue;
    const sorted=items=>items.sort((a,b)=>order.get(a.executionId??a.readExecutionId)-order.get(b.executionId??b.readExecutionId));
    relations.push({id:`computed:${write.eventId}`,executionId:write.eventId,activationId:write.activationId,
      target,value:write.value,sources:sorted([...sources.values()]),calculations:sorted([...calculations.values()]),
      calculationExecutionIds:[...calculations.keys()].sort((a,b)=>order.get(a)-order.get(b)),
      valueEdges:edges.sort((a,b)=>order.get(a.targetExecutionId)-order.get(b.targetExecutionId)||order.get(a.sourceExecutionId)-order.get(b.sourceExecutionId)),
      controlExecutionIds:[...controls].sort((a,b)=>order.get(a)-order.get(b)),calls:[...calls.values()],
      status:unknown.length?'partial':'supported',unresolved:unknown,
      evidence:'recorded value operands and exact call-return edges; memory READ boundaries',
      semantics:'computed-value',isReference:false});
  }
  return relations;
}

export function validateArrayValueDependencies(trace){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),order=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    objects=new Map(trace.objects.map(o=>[o.id,o]));
  const fail=message=>{throw new Error(`배열 계산 의존 관계: ${message}`);};
  for(const work of trace.structures??[]){if(work.kind!=='array-work')continue;
    const transfers=new Set((work.transfers??[]).map(t=>t.executionId));
    for(const relation of work.computedDependencies??[]){
      const write=events.get(relation.executionId);
      if(!complete(write)||write.kind!=='WRITE'||write.action!=='write'||!memory(relation.target,objects)||
        JSON.stringify(span(write.target))!==JSON.stringify(span(relation.target)))fail('저장 사건과 목적지가 일치하지 않습니다.');
      if(JSON.stringify(relation.value)!==JSON.stringify(write.value))fail('저장값이 관측값과 다릅니다.');
      if(transfers.has(write.eventId)||relation.semantics!=='computed-value'||relation.isReference!==false)fail('계산과 단순 복사가 혼합됐습니다.');
      const calculations=relation.calculations??[];
      if(!calculations.length||JSON.stringify(relation.calculationExecutionIds)!==JSON.stringify(calculations.map(c=>c.executionId)))fail('계산 사건 목록이 일치하지 않습니다.');
      for(const calc of calculations){const event=events.get(calc.executionId);
        if(!complete(event)||event.kind!=='CALC'||order.get(event.eventId)>=order.get(write.eventId)||
          JSON.stringify(calc.value)!==JSON.stringify(event.value))fail('관측된 선행 계산이 아닙니다.');}
      for(const source of relation.sources??[]){const read=events.get(source.readExecutionId);
        if(!complete(read)||read.kind!=='READ'||!memory(source.storage,objects)||
          JSON.stringify(span(read.target))!==JSON.stringify(span(source.storage))||order.get(read.eventId)>=order.get(write.eventId)||
          JSON.stringify(source.value)!==JSON.stringify(read.value))fail('관측된 선행 읽기와 저장소가 일치하지 않습니다.');}
      const predecessors=new Map();
      for(const edge of relation.valueEdges??[]){
        const source=events.get(edge.sourceExecutionId),target=events.get(edge.targetExecutionId);
        if(!complete(source)||!complete(target)||order.get(source.eventId)>=order.get(target.eventId)||
          target.kind==='READ'||order.get(target.eventId)>order.get(write.eventId)||!operands(target).includes(source.eventId))fail('실제 값 입력이 아닌 간선입니다.');
        if(!predecessors.has(target.eventId))predecessors.set(target.eventId,[]);
        predecessors.get(target.eventId).push(source.eventId);
      }
      const reached=new Set(),pending=[write.eventId];while(pending.length){const id=pending.pop();if(reached.has(id))continue;
        reached.add(id);pending.push(...predecessors.get(id)??[]);}
      if([...(relation.sources??[]).map(s=>s.readExecutionId),...relation.calculationExecutionIds,
        ...(relation.valueEdges??[]).flatMap(e=>[e.sourceExecutionId,e.targetExecutionId])].some(id=>!reached.has(id)))fail('목적지에 연결되지 않은 값 근거입니다.');
      const actualControls=new Set([...reached].flatMap(id=>events.get(id)?.controlInputs??[]));
      for(const id of relation.controlExecutionIds??[])if(!actualControls.has(id)||!events.has(id)||order.get(id)>=order.get(write.eventId))fail('관측된 분기 원인이 아닙니다.');
      if(relation.status!==((relation.unresolved??[]).length?'partial':'supported'))fail('미확정 근거와 상태가 일치하지 않습니다.');
    }
  }
  return trace;
}
