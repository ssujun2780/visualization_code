// Follow existing value edges only. Equal numbers never create an edge, and
// call arguments, address dependencies and controlling branches are not results.
const unique=values=>[...new Set(values)];
const complete=e=>e&&(!e.phase||e.phase==='complete');
const memory=e=>!!e?.target?.objectId&&Number.isSafeInteger(e.target.offset)&&e.target.offset>=0&&
  Number.isSafeInteger(e.target.size)&&e.target.size>0;
const width=v=>v?.cType?.sizeBits??Number(/^i(\d+)$/.exec(v?.type??'')?.[1]);
const family=v=>v?.cType?.kind==='pointer'||v?.address!==undefined?'pointer':
  ['signed','unsigned'].includes(v?.cType?.signedness)||/^i\d+$/.test(v?.type??'')?'integer':
  /float/.test(v?.cType?.encoding??'')||['float','double'].includes(v?.type)?'float':null;
function integer(v){
  const value=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);
  try{return value===undefined?null:BigInt(value);}catch{return null;}
}
function preserved(from,to){
  if(!from||!to||!width(from)||!width(to)||width(to)<width(from)||family(from)!==family(to))return false;
  if(family(from)==='integer'){const a=integer(from),b=integer(to);return a!==null&&b!==null&&a===b;}
  if(!['pointer','float'].includes(family(from))||width(from)!==width(to))return false;
  const a=from.address??from.bits,b=to.address??to.bits;
  return a!==undefined&&b!==undefined&&a===b;
}

export function createValueFlow(plan,{events,resultDeliveries=[]}){
  const byEvent=new Map(events.map(e=>[e.eventId,e])),positions=new Map(events.map((e,i)=>[e.eventId,i])),
    definitions=new Map((plan.instructions??[]).map(d=>[d.id,d])),returns=new Map(),previous=new Map(),observations=new Map();
  for(const event of events){
    for(const id of event.observationIds??[])observations.set(id,{event,step:null,index:null});
    for(const [index,step]of (event.steps??[]).entries())for(const id of unique([step.observationId,...step.observationIds??[]].filter(Boolean)))
      observations.set(id,{event,step,index});
  }
  const before=(a,b)=>!!a&&!!b&&positions.get(a.eventId)<positions.get(b.eventId);
  // Reuse exact dynamic call identities; recursive invocations of one source
  // call site must never borrow another activation's return or arguments.
  for(const delivery of resultDeliveries){
    const call=byEvent.get(delivery.callExecutionId),resume=byEvent.get(delivery.resumeExecutionId),
      boundary=byEvent.get(delivery.returnExecutionId),returned=byEvent.get(delivery.returnValueExecutionId);
    if(![call,resume,boundary,returned].every(complete)||call.kind!=='FLOW'||call.action!=='call'||
      resume.kind!=='FLOW'||resume.action!=='resume'||boundary.kind!=='FLOW'||boundary.action!=='return'||
      returned.kind!=='WRITE'||returned.action!=='return.value'||
      resume.callExecutionId!==call.eventId||returned.callExecutionId!==call.eventId||boundary.callExecutionId!==call.eventId||
      resume.returnExecutionId!==boundary.eventId||call.activationId!==resume.activationId||
      delivery.callerActivationId!==call.activationId||returned.activationId!==boundary.activationId||
      !resume.dataInputs?.includes(returned.eventId)||!before(call,returned)||!before(returned,boundary)||!before(boundary,resume)||
      !preserved(returned.value,resume.value))continue;
    returns.set(resume.eventId,returned);
  }
  function predecessor(e){
    if(previous.has(e.eventId))return previous.get(e.eventId);
    let result=null;
    if(e.kind==='FLOW')result=e.action==='resume'?returns.get(e.eventId)??null:null;
    else{
      const ids=unique(e.dataInputs??[]),input=ids.length===1?byEvent.get(ids[0]):null;
      if(complete(input)&&before(input,e)&&preserved(input.value,e.value)){
        if(e.kind==='READ'&&memory(e)&&input.kind==='WRITE'&&memory(input)&&
          e.target.objectId===input.target.objectId&&e.target.offset===input.target.offset&&e.target.size===input.target.size)result=input;
        if(e.kind==='WRITE'&&['write','return.value','argument'].includes(e.action)){
          if(e.action==='argument'){
            const call=byEvent.get(e.callExecutionId),index=e.parameterIndex??definitions.get(e.instructionId)?.parameterIndex;
            if(complete(call)&&call.kind==='FLOW'&&call.action==='call'&&before(input,call)&&before(call,e)&&
              input.activationId===call.activationId&&call.inputs?.some(i=>i.parameterIndex===index&&i.executionId===input.eventId))result=input;
          }else if(input.activationId===e.activationId)result=input;
        }
        if(e.kind==='CALC'&&input.activationId===e.activationId){
          const operator=e.operator??definitions.get(e.instructionId)?.operator,
            steps=e.steps??[],conversions=[e.conversion,...steps.map(s=>s.conversion)].filter(Boolean);
          // Narrowing remains a transformation even when this sample happens
          // to fit. Any arithmetic step also ends identity provenance.
          if((!operator||operator==='cast')&&steps.every(s=>!s.operator||s.operator==='cast')&&
            conversions.every(c=>c.fromType?.sizeBits<=c.toType?.sizeBits)&&
            steps.every(s=>!s.conversion||preserved(s.conversion.fromValue??input.value,s.value)))result=input;
        }
      }
    }
    previous.set(e.eventId,result);return result;
  }
  function follow(id,all){
    const result=[],seen=new Set();let e=byEvent.get(id);
    while(complete(e)&&!seen.has(e.eventId)){
      seen.add(e.eventId);
      if(e.kind==='READ'&&memory(e)){result.push(e);if(!all)break;}
      e=predecessor(e);
    }
    return result;
  }
  function sourceReadOperand(input,consumer,consumerStep=null,seen=new Set()){
    if(!input||!complete(consumer)||!positions.has(consumer.eventId))return null;
    const observed=input.observationId?observations.get(input.observationId):null,
      event=observed?.event??byEvent.get(input.executionId);
    if(!complete(event)||input.executionId&&input.executionId!==event.eventId||
      event.activationId!==consumer.activationId)return null;
    const key=`${event.eventId}:${input.observationId??''}`;
    if(seen.has(key))return null;seen.add(key);
    if(observed?.step){
      const {step,index}=observed,consumerIndex=consumerStep?(consumer.steps??[]).indexOf(consumerStep):-1;
      if(event===consumer?consumerIndex<0||index>=consumerIndex:!before(event,consumer))return null;
      const operands=step.inputs??[],conversion=step.conversion;
      // Match the precise internal producer, never another same-valued operand
      // in the containing CALC. Arithmetic and narrowing are transformations.
      if(operands.length!==1||step.operator&&step.operator!=='cast'||
        conversion&&(!(conversion.fromType?.sizeBits<=conversion.toType?.sizeBits)||
          !preserved(conversion.fromValue??operands[0].value,step.value))||
        !preserved(operands[0].value,step.value)||input.value&&!preserved(step.value,input.value))return null;
      return sourceReadOperand(operands[0],event,step,seen);
    }
    // Unknown or absent internal observations cannot disambiguate a self edge.
    if(!before(event,consumer)||input.value&&!preserved(event.value,input.value))return null;
    return follow(event.eventId,false)[0]??null;
  }
  return {sourceRead:id=>follow(id,false)[0]??null,reads:id=>follow(id,true),sourceReadOperand};
}
