// Bind real observations to source IR. No C expression is evaluated here.
import {validateIRTrace} from './ir-schema.mjs';
import {topology} from './structure.mjs';
import {outputEvents} from './output-events.mjs';
import {createControlTracker} from './control-flow.mjs';
import {createEvaluationTracker,cResult} from './evaluation.mjs';
const unique=list=>[...new Set(list.filter(Boolean))];
const references=['dataInputs','addressInputs','controlInputs'];
const copyFields=['target','value','memoryState','previousMemoryState','sourceAddress','sourceObjectId','sourceOffset','sourceSize',
  'readRegions','includesNullTerminator','terminatorOffset','paddingSize','byte','storage','initialized','size','address','reason',
  'frameId','objectId','name','parameterIndex','condition','selected','channel','text','bytesHex','byteLength','streamOffset','diagnostic',
  'left','right','operator','predicate','conversion','initializationEvidence','uncertainRegions','copiedFrom','observedConsumerValue','outputOrigin','selection',
  'evaluation','helpMarker','reservationObservationId','deliveryObservationId','deliveryOffset','attribution'];

export function recordIR(plan,observations,raw) {
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ops=new Map(observations.instructions.map(o=>[o.id,o])),rawEvents=new Map(raw.events.map(e=>[e.eventId,e])),
    definitions=new Map(),rawToExecution=new Map(),aliases=new Map(),events=[],attempts=new Map(),gaps=new Set(),
    pendingArguments=new Map(),cleanup=new Map(),calls=new Map(),callBySite=new Map(),activeCalls=[],frameCalls=new Map(),
    pendingStorage=new Map(),storageEvents=new Map(),hiddenObjects=new Set(),declarationReentries=[];
  const control=createControlTracker(plan,ops);
  for(const gap of plan.controlFlow?.gaps??[])gaps.add(`${gap.reason}:${gap.functionId}`);
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
  const evaluationTracker=createEvaluationTracker(plan,operandValue);
  const runtimeInputs=(e,op)=>e.selectedInput?(op.action==='select'?[op.inputs[0],e.selectedInput]:[e.selectedInput]):op?.inputs??[];
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
    control.claim(command,e);
    command.observationIds.push(e.eventId);rawToExecution.set(e.eventId,command.eventId);
    for(const key of references)command[key].push(...(e[key]??[]));
    for(const key of copyFields)if(e[key]!==undefined)command[key]=e[key];
    // Public CALC labels follow the source definition on both grouped and
    // single-observation paths. LLVM opcodes stay in the raw observations.
    const definition=instructions.get(command.instructionId);
    if(command.kind==='CALC'&&definition?.operator!=null)command.operator=definition.operator;
    if(e.readRegions)command.readRegions=e.readRegions.map(r=>({...r,dataInputs:[...(r.dataInputs??[])]}));
    if(e.callEventId)command.callObservationId=e.callEventId;
    if(e.returnEventId)command.returnObservationId=e.returnEventId;
    if(e.bufferWriterCallEventId)command.bufferWriterCallObservationId=e.bufferWriterCallEventId;
    if(e.callbackOfCallEventId)command.callbackOfCallObservationId=e.callbackOfCallEventId;
    if(e.action==='call.begin'){
      const op=ops.get(e.instructionId);command.callee=definition?.callee??e.callee;command.backendCallee=e.callee;
      command.arguments=e.arguments?.filter((_,index)=>!op?.args[index]?.sret);
    }
    if(e.indirectAddress)command.indirectAddress=e.indirectAddress;
    // Value forwarding carries selection metadata to the consuming operation;
    // it does not create a second calculation for LLVM PHI/select.
    for(const input of runtimeInputs(e,ops.get(e.instructionId))){
      const producer=definitions.get(definitionKey(e.activationId,input.value));
      if(producer?.evaluation&&producer.evaluation.nodeId!==instructions.get(command.instructionId)?.evaluationNodeId){
        const item={...producer.evaluation,resultObservationId:producer.eventId};
        if(!(command.inputEvaluations??=[]).some(x=>x.resultObservationId===item.resultObservationId))command.inputEvaluations.push(item);
      }
    }
  }
  function flushPending(phase='complete'){
    if(!pending)return;const p=pending;pending=null;const command=begin(p.instructionId,p.events[0]);if(!command)return;
    const steps=new Map();command.steps=[];
    for(const e of p.events){
      const b=binding(e),previous=steps.get(b?.materializesObservationId);
      if(previous){previous.value=e.value;previous.observationIds.push(e.eventId);
        if(b.numeric)previous.distance={...previous.distance,elementDistance:e.value.decimal};}
      else{
        const step={observationId:e.eventId,observationIds:[e.eventId],nodeId:binding(e)?.expressionNodeId??null,
          operator:binding(e)?.sourceOperator??null,value:e.value,conversion:e.conversion,inputs:p.inputs.get(e.eventId)};
        if(b.numeric){step.distance={...b.numeric,byteDistance:e.value.signed,elementDistance:b.numericRole==='result'?e.value.decimal:null};
          if(b.numericRole==='byte-distance')step.value={evidence:'source result pending'};}
        command.steps.push(step);steps.set(e.instructionId,step);
      }
    }
    for(const e of p.events)attach(command,e);command.phase=phase;
    command.operator=instructions.get(p.instructionId)?.operator??null;delete command.conversion;delete command.predicate;
    const distance=command.steps.find(s=>s.distance&&s.nodeId===instructions.get(p.instructionId)?.expression?.nodeId);
    if(distance){command.distance=distance.distance;command.value=distance.value;}
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
      runtimeInputs(e,op).map(input=>operandValue(input,e.activationId));
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
  function emitOutput(e,previousObservation){
    const previous=events.at(-1);
    // A source call produces one output action even when WASI delivers its
    // text in chunks. Never cross a call, stream, offset gap or intervening
    // observation; an unknown output owner is not grounds for merging.
    const contiguous=previousObservation?.kind==='WRITE'&&previousObservation.action==='output'&&
      e.callEventId&&calls.has(e.callEventId)&&previousObservation.callEventId===e.callEventId&&
      previousObservation.activationId===e.activationId&&previousObservation.channel===e.channel&&
      Number.isSafeInteger(previousObservation.streamOffset)&&Number.isSafeInteger(previousObservation.byteLength)&&
      Number.isSafeInteger(e.streamOffset)&&Number.isSafeInteger(e.byteLength)&&
      e.streamOffset===previousObservation.streamOffset+previousObservation.byteLength;
    if(contiguous&&previous?.kind==='WRITE'&&previous.action==='output'&&
      previous.callObservationId===e.callEventId&&typeof previous.text==='string'&&typeof e.text==='string'){
      const bytesHex=typeof previous.bytesHex==='string'&&typeof e.bytesHex==='string'?previous.bytesHex+e.bytesHex:null;
      const text=bytesHex!==null?Buffer.from(bytesHex,'hex').toString('utf8'):previous.text+e.text,
        streamOffset=previous.streamOffset,byteLength=previous.byteLength+e.byteLength;
      attach(previous,e);
      Object.assign(previous,{text,streamOffset,byteLength});
      if(bytesHex!==null)previous.bytesHex=bytesHex;else delete previous.bytesHex;
      return previous;
    }
    return emitSingle(e);
  }
  function flushArguments(){
    for(const argument of pendingArguments.values()){
      const command=emitSingle(argument);if(command){command.phase='incomplete';command.reason='parameter storage binding not reached';}
    }
    pendingArguments.clear();
  }
  function revealStorage(objectId,marker=null){
    const storage=pendingStorage.get(objectId);if(!storage)return null;
    flushPending();pendingStorage.delete(objectId);
    const command=emitSingle(storage);
    if(command){
      command.storageObservationId=storage.eventId;
      if(storage.reservationObservationId)command.observationIds.unshift(storage.reservationObservationId);
      if(marker){
        attach(command,marker);command.declarationObservationId=marker.eventId;
        command.evidence='observed source declaration with observed storage';
      }else{
        command.evidence='observed storage first exposed by source work';
        gaps.add(`declaration-boundary-not-observed:${objectId}`);
      }
    }
    return command;
  }
  // Memory/allocation API summaries are observed at return but belong inside
  // the call. Stream output already has its actual delivery position; do not
  // move it across a return or user function-body observations.
  // Source output creation and physical delivery are separate observations.
  // Reconcile whole byte streams as evidence only, never split a delivery by
  // format strings/newlines or move it to guessed source calls.
  const {events:observed,coverage:outputCoverage}=outputEvents(raw,aliases,gaps);
  const ordered=[];
  for(let at=0;at<observed.length;at++){
    const e=observed[at];
    if(e.action==='call.end'){
      const effects=[];let next=at+1;
      while(next<observed.length){const effect=observed[next];
        if(effect.instructionId!==e.instructionId||effect.activationId!==e.activationId||!['WRITE','SPACE'].includes(effect.kind)||effect.action==='output')break;
        effects.push(effect);next++;
      }
      ordered.push(...effects,e);at=next-1;
    }else ordered.push(e);
  }
  // Scope cleanup can branch through a compiler-generated dispatch before a
  // return. Group only on the actually observed return path, with no intervening
  // public source work. Raw object ends still retain their exact lifetime point.
  const returnCleanup=new Set(),nextWork=new Map();
  for(let i=ordered.length-1;i>=0;i--){
    const e=ordered[i];if(binding(e)?.administrative||e.phase==='attempt')continue;
    if(e.action==='object.end'){
      if(['return.value','return','frame.end'].includes(nextWork.get(e.activationId)))returnCleanup.add(e.eventId);
    }else nextWork.set(e.activationId,e.action??e.kind);
  }
  for(const [index,observation] of ordered.entries()){
    const op=ops.get(observation.instructionId),b=binding(observation);
    // A C comparison yields int 0/1 even when LLVM keeps only an i1. Preserve
    // that raw i1 in observations; expose the C value and width to animation.
    const typedObservation=observation.kind==='CALC'&&b?.numericRole==='result'?
      {...observation,value:cResult(observation.value,b.resultType)}:
      op?.cBoolean&&op.cType&&observation.value?.type==='i1'?
      {...observation,value:cResult(observation.value,op.cType,true)}:observation;
    const e=evaluationTracker.decorate(control.decorate(typedObservation),op,b),key=definitionKey(e.activationId,e.instructionId);
    if(b?.foldedResults){
      const ids=e.controlInputs.filter(id=>b.foldedResults.includes(rawEvents.get(id)?.instructionId));
      e.dataInputs=unique([...(e.dataInputs??[]),...ids]);
    }
    if(e.action==='object.begin'){
      storageEvents.set(e.objectId,e);
      if(b?.hiddenStorage)hiddenObjects.add(e.objectId);
      if(b?.declarationObservationId){pendingStorage.set(e.objectId,e);remember(e,op);continue;}
    }
    if(b?.sourceDeclaration&&e.action==='declaration'){
      if(!revealStorage(e.objectId,e)){
        const storage=storageEvents.get(e.objectId);
        aliases.set(e.eventId,storage?[storage.eventId]:[]);
        declarationReentries.push({objectId:e.objectId,observationId:e.eventId,activationId:e.activationId});
      }
      continue;
    }
    if(e.action==='object.end'&&(hiddenObjects.has(e.objectId)||pendingStorage.has(e.objectId))){aliases.set(e.eventId,[]);continue;}
    // A jump can bypass a declaration and still reach a use. Expose only the
    // storage actually needed by that use, without claiming declaration entry.
    if(!b?.administrative){
      for(const id of [e.target?.objectId,e.sourceObjectId])if(id)revealStorage(id);
      for(const input of [...(op?.inputs??[]),op?.pointer].filter(Boolean)){
        const producer=definitions.get(definitionKey(e.activationId,input.value));
        if(producer?.action==='object.begin')revealStorage(producer.objectId);
      }
    }
    if(e.phase==='attempt'){attempts.set(key,e);continue;}
    if(b?.hiddenParameter){aliases.set(e.eventId,e.dataInputs??[]);remember(e,op);continue;}
    if(b?.suppressCallBoundary&&['call.begin','call.end'].includes(e.action)){
      if(e.action==='call.begin'){const context={event:e,hidden:true};calls.set(e.eventId,context);callBySite.set(key,context);}
      aliases.set(e.eventId,e.dataInputs??[]);remember(e,op);continue;
    }
    if(e.action==='argument'&&(b?.parameterStoreObservationId||b?.byValueArgument)){
      pendingArguments.set(key,e);remember(e,op);continue;
    }
    if(e.kind==='SPACE'&&e.action==='object.end'&&(['function-return','process-exit'].includes(e.reason)||returnCleanup.has(e.eventId))){
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
      const attempt=attempts.get(key);if(attempt)aliases.set(attempt.eventId,[e.eventId]);
      attempts.delete(key);
      // Selected PHI inputs and no-op casts retain their dependencies, not a
      // fictitious independent calculation animation.
      aliases.set(e.eventId,unique([...(e.dataInputs??[]),...(e.addressInputs??[]),...(e.controlInputs??[]),...runtimeInputs(e,op).map(input=>definitions.get(definitionKey(e.activationId,input.value))?.eventId)]));remember(e,op);continue;
    }
    if(e.kind==='CALC'&&b?.group){
      if(pending&&(pending.instructionId!==b.group||pending.activationId!==e.activationId))flushPending();
      pending??={instructionId:b.group,activationId:e.activationId,events:[],inputs:new Map()};
      pending.inputs.set(e.eventId,runtimeInputs(e,op).map(input=>operandValue(input,e.activationId)));
      pending.events.push(e);remember(e,op);continue;
    }
    if(e.kind==='READ'&&pending){
      const pendingIds=new Set(pending.events.map(s=>s.eventId));
      if((e.addressInputs??[]).some(id=>pendingIds.has(id)))flushPending();
    }else flushPending();
    if(e.kind==='WRITE'&&e.action==='output'){
      emitOutput(e,ordered[index-1]);
    }else if(e.action==='call.begin'){
      emitSingle(e);const context={event:e,returned:null};calls.set(e.eventId,context);callBySite.set(key,context);activeCalls.push(context);
    }else if(e.action==='call.end'){
      const context=calls.get(e.callEventId);
      if(context?.returned)aliases.set(e.eventId,unique([...(e.dataInputs??[]),context.returned.eventId]));
      else finishCall(e);
      const at=activeCalls.indexOf(context);if(at!==-1)activeCalls.splice(at,1);
    }else if(e.action==='frame.begin'){
      const context=activeCalls.at(-1);if(context&&context.event.activationId!==e.activationId&&!e.callbackOfCallEventId)frameCalls.set(e.activationId,context);
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
    if(command.bufferWriterCallObservationId)command.bufferWriterCallExecutionId=resolve(command.bufferWriterCallObservationId)[0]??null;
    if(command.callbackOfCallObservationId)command.callbackOfCallExecutionId=resolve(command.callbackOfCallObservationId)[0]??null;
    for(const input of command.inputs??[])if(input.observationId)input.executionId=resolve(input.observationId)[0]??null;
    for(const item of [command.evaluation,...command.inputEvaluations??[]].filter(Boolean)){
      if(item.decisionObservationId)item.decisionExecutionIds=resolve(item.decisionObservationId);
      if(item.resultObservationId)item.resultExecutionIds=resolve(item.resultObservationId);
    }
    for(const step of command.steps??[])for(const input of step.inputs??[])if(input.observationId)input.executionId=resolve(input.observationId)[0]??null;
    for(const region of command.readRegions??[])if(region.dataInputs)region.dataInputs=unique(region.dataInputs.flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
  }
  const ref=id=>resolve(id)[0]??null;
  const represented=new Set(events.flatMap(e=>e.observationIds)),deferred=new Set([...pendingStorage.values()].map(e=>e.eventId)),
    accounting={total:raw.events.length,represented:0,forwarded:0,administrative:0,deferredStorage:0,unexplained:[]};
  for(const e of raw.events){
    if(represented.has(e.eventId)||rawToExecution.has(e.eventId))accounting.represented++;
    else if(aliases.has(e.eventId)){if(resolve(e.eventId).length)accounting.forwarded++;else accounting.administrative++;}
    else if(deferred.has(e.eventId))accounting.deferredStorage++;
    else accounting.unexplained.push({eventId:e.eventId,instructionId:e.instructionId,kind:e.kind,action:e.action});
  }
  if(accounting.unexplained.length)gaps.add('observations-without-disposition');
  const flowTransitions=control.transitions.map(t=>({...t,controlInputs:unique(t.controlInputs.flatMap(id=>resolve(id)))}));
  const excluded=new Set([...hiddenObjects,...pendingStorage.keys()]),
    views=(raw.views??[]).filter(v=>!excluded.has(v.objectId)),viewIds=new Set(views.map(v=>v.id));
  return validateIRTrace(plan,{schemaVersion:3,programId:plan.programId,runId:raw.runId,backend:raw.backend,status:raw.status,exitCode:raw.exitCode,
    events,flowTransitions,objects:(raw.objects??[]).filter(o=>!excluded.has(o.id)).map(o=>({...o,createdBy:ref(o.createdBy),endedBy:ref(o.endedBy),
      initializationRanges:o.initializationRanges?.map(r=>({...r,writer:r.writer==='unobserved'?r.writer:ref(r.writer)}))})),
    frames:raw.frames??[],views,references:(raw.references??[]).filter(r=>!excluded.has(r.objectId)&&!excluded.has(r.targetObjectId)).map(r=>({...r,eventId:ref(r.eventId)})),
    structures:(raw.structures??[]).map(s=>{const nodes=s.nodes.filter(id=>viewIds.has(id)),edges=s.edges.filter(e=>viewIds.has(e.from)&&viewIds.has(e.to));
      return {...s,nodes,edges,...topology(nodes.map(id=>({id})),edges)};}).filter(s=>s.nodes.length),
    diagnostics:(raw.diagnostics??[]).map(d=>({...d,eventId:ref(d.eventId)})),
    coverage:{...plan.coverage,...raw.coverage,irEvents:events.length,observationEvents:raw.events.length,irGaps:[...gaps],
      observationAccounting:accounting,pendingCleanup:[...cleanup.values()].flat().map(e=>e.objectId),
      sourceOrder:{automaticBoxes:'observed declaration entry; no sorting by source line',
        hiddenCompilerObjects:hiddenObjects.size,unreachedDeclarations:pendingStorage.size,
        declarationReentries,lifetime:plan.coverage.lifetime??'lifetime information not supplied'},
      stdioOutput:outputCoverage,
      controlFlow:{method:'observed edges with postdominator regions per activation',
        pendingTransitions:flowTransitions.filter(t=>!t.beforeExecutionId).map(t=>t.id)},
      seek:'not implemented; IR and state effects are recorded for a future consumer',animation:'stub'}});
}
