// Bind real observations to source IR. No C expression is evaluated here.
import {validateIRTrace} from './ir-schema.mjs';
const unique=list=>[...new Set(list.filter(Boolean))];
const references=['dataInputs','addressInputs','controlInputs'];
const copyFields=['target','value','memoryState','previousMemoryState','sourceAddress','sourceObjectId','sourceOffset','sourceSize',
  'readRegions','includesNullTerminator','terminatorOffset','paddingSize','byte','storage','initialized','size','address','reason',
  'frameId','objectId','name','parameterIndex','condition','selected','channel','text','bytesHex','byteLength','streamOffset','diagnostic',
  'left','right','operator','predicate','conversion','initializationEvidence','uncertainRegions','copiedFrom','observedConsumerValue'];

export function recordIR(plan,observations,raw) {
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ops=new Map(observations.instructions.map(o=>[o.id,o])),
    definitions=new Map(),rawToExecution=new Map(),aliases=new Map(),events=[],attempts=new Map(),gaps=new Set(),
    pendingArguments=new Map(),cleanup=new Map(),calls=new Map(),callBySite=new Map(),activeCalls=[],frameCalls=new Map();
  let pending=null;
  const binding=e=>plan.bindings[e.instructionId]??null;
  const role=(e,b=binding(e))=>b?.roles[`${e.kind}:${e.action??''}`]??b?.roles[e.kind]??plan.processInstructions[`${e.kind}:${e.action??''}`]??null;
  const definitionKey=(frame,result)=>`${frame??'process'}:${result}`;
  const operandValue=(operand,frame)=>{
    if(!operand)return null;
    const producer=definitions.get(definitionKey(frame,operand.value));
    if(producer)return {value:producer.value??null,observationId:producer.eventId};
    const integer=/^i(\d+)$/.exec(operand.type),literal=operand.value==='true'?'1':operand.value==='false'?'0':operand.value;
    if(integer&&/^-?\d+$/.test(literal)){
      const width=Number(integer[1]),bits=BigInt.asUintN(width,BigInt(literal));
      return {value:{type:operand.type,bits:`0x${bits.toString(16).padStart(Math.ceil(width/4),'0')}`,unsigned:bits.toString(),signed:BigInt.asIntN(width,bits).toString(),literal:operand.value,evidence:'compiler operand'},observationId:null};
    }
    return {value:{type:operand.type,literal:operand.value,evidence:'compiler operand'},observationId:null};
  };
  function begin(instructionId,e){
    const instruction=instructions.get(instructionId);
    if(!instruction){gaps.add(`unbound-event:${e.kind}:${e.action??''}`);return null;}
    const command={schemaVersion:3,eventId:`x${events.length+1}`,executionId:`x${events.length+1}`,instructionId,
      activationId:e.activationId??null,kind:instruction.kind,action:instruction.action,phase:'complete',
      observationIds:[],dataInputs:[],addressInputs:[],controlInputs:[],evidence:e.evidence??'observed'};
    events.push(command);return command;
  }
  function attach(command,e){
    if(!command)return;
    command.observationIds.push(e.eventId);rawToExecution.set(e.eventId,command.eventId);
    for(const key of references)command[key].push(...(e[key]??[]));
    for(const key of copyFields)if(e[key]!==undefined)command[key]=e[key];
    if(e.readRegions)command.readRegions=e.readRegions.map(r=>({...r,dataInputs:[...(r.dataInputs??[])]}));
    if(e.callEventId)command.callObservationId=e.callEventId;
    if(e.returnEventId)command.returnObservationId=e.returnEventId;
    if(e.action==='call.begin'){
      const op=ops.get(e.instructionId);command.callee=e.callee;
      command.arguments=e.arguments?.filter((_,index)=>!op?.args[index]?.sret);
    }
    if(e.indirectAddress)command.indirectAddress=e.indirectAddress;
  }
  function flushPending(phase='complete'){
    if(!pending)return;const p=pending;pending=null;const command=begin(p.instructionId,p.events[0]);if(!command)return;
    command.steps=p.events.map(e=>({observationId:e.eventId,nodeId:binding(e)?.expressionNodeId??null,operator:binding(e)?.sourceOperator??null,
      value:e.value,conversion:e.conversion,inputs:p.inputs.get(e.eventId)}));
    for(const e of p.events)attach(command,e);command.phase=phase;
    command.operator=instructions.get(p.instructionId)?.operator??null;delete command.conversion;delete command.predicate;
    const inside=new Set(p.events.map(e=>e.eventId));
    command.inputs=command.steps.flatMap(s=>s.inputs??[]).filter(input=>!inside.has(input.observationId));
    if(phase!=='complete')delete command.value;
  }
  function remember(e,op){
    const result=op?.action==='function.argument'?op.parameter.value:op?.result;
    if(result&&(e.phase==='commit'||e.kind==='CALC'||e.action==='argument'||e.action==='call.end'||e.action==='object.begin'))
      definitions.set(definitionKey(e.activationId,result),e.action==='object.begin'?{...e,value:{type:`${op.type}*`,address:e.address,evidence:'observed storage address'}}:e);
  }
  function emitSingle(e,instructionId=role(e)){
    const command=begin(instructionId,e);if(!command)return null;
    const attempt=attempts.get(definitionKey(e.activationId,e.instructionId));
    if(attempt){attach(command,attempt);attempts.delete(definitionKey(e.activationId,e.instructionId));}
    attach(command,e);
    const op=ops.get(e.instructionId);
    command.inputs=e.action==='call.begin'?command.arguments?.map((value,index)=>({value,parameterIndex:index})):
      (op?.inputs??[]).map(input=>operandValue(input,e.activationId));
    if(op?.action==='call'&&e.action!=='call.begin'){
      const call=calls.get(e.callEventId)??callBySite.get(definitionKey(e.activationId,e.instructionId));
      if(call)command.inputs=call.event.arguments?.map((value,index)=>({...operandValue(op.args[index],e.activationId),value,abiParameterIndex:index})).filter(input=>!op.args[input.abiParameterIndex]?.sret);
    }
    if(e.action==='copy')command.inputs=[{kind:'memory-range',objectId:e.sourceObjectId??null,address:e.sourceAddress??null,
      offset:e.sourceOffset??null,size:e.sourceSize??e.target?.size??null}];
    if(e.action==='fill')command.inputs=[{value:{type:'i8',unsigned:String(e.byte),bits:`0x${e.byte.toString(16).padStart(2,'0')}`,evidence:'library API byte'}}];
    if(e.action==='argument'){
      command.parameterIndex=instructions.get(instructionId)?.parameterIndex??null;
      command.target={kind:'parameter-port',activationId:e.activationId,parameterIndex:command.parameterIndex,
        declarationId:instructions.get(instructionId)?.declarationId??null};
    }
    if(e.action==='return.value')command.target={kind:'return-port',activationId:e.activationId};
    if(e.action==='frame.begin')command.parameters=instructions.get(instructionId)?.parameters??[];
    if(e.kind==='ERROR'){
      command.phase='failed';command.failedInstructionId=binding(e)?.failedInstructionId??null;
      command.failedObservationId=e.instructionId??null;
    }
    return command;
  }
  function finishCall(e){
    const command=emitSingle(e);
    if(command)command.callObservationId=e.callEventId;
  }
  function flushArguments(){
    for(const argument of pendingArguments.values()){
      const command=emitSingle(argument);if(command){command.phase='incomplete';command.reason='parameter storage binding not reached';}
    }
    pendingArguments.clear();
  }
  // API effects are observed at return, but belong inside the call. Reorder only
  // the contiguous boundary summary; user function-body observations stay put.
  const ordered=[];
  for(let at=0;at<raw.events.length;at++){
    const e=raw.events[at];
    if(e.action==='call.end'){
      const effects=[];let next=at+1;
      while(next<raw.events.length){const effect=raw.events[next];
        if(effect.instructionId!==e.instructionId||effect.activationId!==e.activationId||!['WRITE','SPACE'].includes(effect.kind))break;
        effects.push(effect);next++;
      }
      ordered.push(...effects,e);at=next-1;
    }else ordered.push(e);
  }
  for(const e of ordered){
    const op=ops.get(e.instructionId),b=binding(e),key=definitionKey(e.activationId,e.instructionId);
    if(e.phase==='attempt'){attempts.set(key,e);continue;}
    if(b?.hiddenParameter){aliases.set(e.eventId,e.dataInputs??[]);remember(e,op);continue;}
    if(b?.suppressCallBoundary&&['call.begin','call.end'].includes(e.action)){
      if(e.action==='call.begin'){const context={event:e,hidden:true};calls.set(e.eventId,context);callBySite.set(key,context);}
      aliases.set(e.eventId,e.dataInputs??[]);remember(e,op);continue;
    }
    if(e.action==='argument'&&(b?.parameterStoreObservationId||b?.byValueArgument)){
      pendingArguments.set(key,e);remember(e,op);continue;
    }
    if(e.kind==='SPACE'&&e.action==='object.end'&&['function-return','process-exit'].includes(e.reason)){
      flushPending();let list=cleanup.get(e.activationId);if(!list)cleanup.set(e.activationId,list=[]);list.push(e);continue;
    }
    if(e.kind==='ERROR'){
      const hadPending=!!pending;flushPending('failed');
      for(const attempt of [...attempts.values()]){
        attempts.delete(definitionKey(attempt.activationId,attempt.instructionId));
        const failed=emitSingle(attempt);if(failed){failed.phase=raw.status==='fault'?'failed':'incomplete';delete failed.value;}
      }
      flushArguments();
      const error=emitSingle(e,plan.processInstructions['ERROR:fault']);if(error&&hadPending)error.failedExecutionId=events.at(-2)?.eventId??null;
      continue;
    }
    if(b?.administrative){
      if(op?.action==='branch')flushPending();
      attempts.delete(key);
      // Selected PHI inputs and no-op casts retain their dependencies, not a
      // fictitious independent calculation animation.
      aliases.set(e.eventId,unique([...(e.dataInputs??[]),...(e.addressInputs??[]),...(op?.inputs??[]).map(input=>definitions.get(definitionKey(e.activationId,input.value))?.eventId)]));remember(e,op);continue;
    }
    if(e.kind==='CALC'&&b?.group){
      if(pending&&(pending.instructionId!==b.group||pending.activationId!==e.activationId))flushPending();
      pending??={instructionId:b.group,activationId:e.activationId,events:[],inputs:new Map()};
      pending.inputs.set(e.eventId,(op?.inputs??[]).map(input=>operandValue(input,e.activationId)));
      pending.events.push(e);remember(e,op);continue;
    }
    if(e.kind==='READ'&&pending){
      const pendingIds=new Set(pending.events.map(s=>s.eventId));
      if((e.addressInputs??[]).some(id=>pendingIds.has(id)))flushPending();
    }else flushPending();
    if(e.action==='call.begin'){
      emitSingle(e);const context={event:e,returned:null};calls.set(e.eventId,context);callBySite.set(key,context);activeCalls.push(context);
    }else if(e.action==='call.end'){
      const context=calls.get(e.callEventId);
      if(context?.returned)aliases.set(e.eventId,unique([...(e.dataInputs??[]),context.returned.eventId]));
      else finishCall(e);
      const at=activeCalls.indexOf(context);if(at!==-1)activeCalls.splice(at,1);
    }else if(e.action==='frame.begin'){
      const context=activeCalls.at(-1);if(context&&context.event.activationId!==e.activationId)frameCalls.set(e.activationId,context);
      emitSingle(e);
    }else if(e.action==='return'){
      const context=frameCalls.get(e.activationId),command=emitSingle(e);
      if(context){context.returned=e;if(command)command.callObservationId=context.event.eventId;}
    }else if(e.action==='frame.end'){
      const command=emitSingle(e),ended=cleanup.get(e.activationId)??[];
      if(command){command.endedObjects=ended.map(end=>end.objectId);for(const end of ended){command.observationIds.push(end.eventId);rawToExecution.set(end.eventId,command.eventId);}}
      cleanup.delete(e.activationId);
    }else if(b?.parameterArgumentObservationId&&e.kind==='WRITE'){
      const argumentKey=definitionKey(e.activationId,b.parameterArgumentObservationId),argument=pendingArguments.get(argumentKey);
      if(argument){
        const argumentId=plan.bindings[b.parameterArgumentObservationId].roles['WRITE:argument'],command=emitSingle(e,argumentId);
        if(command){attach(command,argument);command.target=e.target;command.value=e.value;command.parameterIndex=instructions.get(argumentId)?.parameterIndex??null;
          command.dataInputs=[...(argument.dataInputs??[])];command.callObservationId=argument.callEventId;}
        pendingArguments.delete(argumentKey);
      }else emitSingle(e);
    }else if(e.action==='object.begin'&&b?.byValueArgument){
      emitSingle(e);const argument=pendingArguments.get(key),argumentId=b.roles['WRITE:argument'];
      if(argument){const command=emitSingle(argument,argumentId);if(command){command.target={objectId:e.objectId,address:e.address,offset:0,size:e.size};
        command.value={type:op.parameter.type,evidence:'aggregate memory'};command.memoryState=e.memoryState;command.copiedFrom=e.copiedFrom;}
        pendingArguments.delete(key);}
    }else emitSingle(e);
    remember(e,op);
  }
  flushPending(raw.status==='completed'?'complete':'incomplete');
  flushArguments();
  for(const attempt of [...attempts.values()]){
    attempts.delete(definitionKey(attempt.activationId,attempt.instructionId));
    const command=emitSingle(attempt);if(command){command.phase=raw.status==='fault'?'failed':'incomplete';delete command.value;}
  }
  function resolve(id,seen=new Set()){
    if(!id||id==='unobserved'||seen.has(id))return [];seen.add(id);
    if(rawToExecution.has(id))return [rawToExecution.get(id)];
    return (aliases.get(id)??[]).flatMap(next=>resolve(next,new Set(seen)));
  }
  for(const command of events){
    for(const key of references)command[key]=unique(command[key].flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
    if(command.callObservationId)command.callExecutionId=resolve(command.callObservationId)[0]??null;
    if(command.returnObservationId)command.returnExecutionId=resolve(command.returnObservationId)[0]??null;
    for(const input of command.inputs??[])if(input.observationId)input.executionId=resolve(input.observationId)[0]??null;
    for(const step of command.steps??[])for(const input of step.inputs??[])if(input.observationId)input.executionId=resolve(input.observationId)[0]??null;
    for(const region of command.readRegions??[])if(region.dataInputs)region.dataInputs=unique(region.dataInputs.flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
  }
  const ref=id=>resolve(id)[0]??null;
  return validateIRTrace(plan,{schemaVersion:3,programId:plan.programId,runId:raw.runId,backend:raw.backend,status:raw.status,exitCode:raw.exitCode,
    events,objects:(raw.objects??[]).map(o=>({...o,createdBy:ref(o.createdBy),endedBy:ref(o.endedBy),
      initializationRanges:o.initializationRanges?.map(r=>({...r,writer:r.writer==='unobserved'?r.writer:ref(r.writer)}))})),
    frames:raw.frames??[],views:raw.views??[],references:(raw.references??[]).map(r=>({...r,eventId:ref(r.eventId)})),structures:raw.structures??[],
    diagnostics:(raw.diagnostics??[]).map(d=>({...d,eventId:ref(d.eventId)})),
    coverage:{...raw.coverage,...plan.coverage,irEvents:events.length,observationEvents:raw.events.length,irGaps:[...gaps],
      pendingCleanup:[...cleanup.values()].flat().map(e=>e.objectId),
      seek:'not implemented; IR and state effects are recorded for a future consumer',animation:'stub'}});
}
