// Bind real observations to source IR. No C expression is evaluated here.
import {validateIRTrace} from './ir-schema.mjs';
import {outputEvents} from './output-events.mjs';
import {createControlTracker} from './control-flow.mjs';
import {createEvaluationTracker,cResult} from './evaluation.mjs';
import {bitfieldValue} from './bitfields.mjs';
import {createGuardTracker} from './guard-conditions.mjs';
import {assertionObservation} from './assertions.mjs';
import {buildResultDeliveries} from './result-delivery.mjs';
import {orderReturnCleanup,remapExecutionReferences} from './return-sequence.mjs';
import {resolvedCoverage} from './coverage-resolution.mjs';
import {attachConversionConsumers} from './conversion-consumers.mjs';
import {createObservationResolver,createAliasResolver} from './observation-dependencies.mjs';
const unique=list=>[...new Set(list.filter(Boolean))];
const sourceBoolean=(value,spec)=>{const bit=BigInt(value.bits)!==0n,source=spec.invert?!bit:bit;
  return cResult({...value,bits:source?'0x1':'0x0',evidence:'AST truth mapped from observed LLVM boolean',
    truthEvidence:{backendBits:value.bits,backendType:value.type,inverted:spec.invert}},spec.cType,true);};
const references=['dataInputs','addressInputs','controlInputs','calleeInputs'];
const copyFields=['target','value','memoryState','previousMemoryState','sourceAddress','sourceObjectId','sourceOffset','sourceSize','storageAlias','returnStorage',
  'readRegions','includesNullTerminator','terminatorOffset','paddingSize','byte','storage','initialized','size','address','reason',
  'frameId','objectId','name','parameterIndex','condition','backendCondition','selected','channel','text','bytesHex','byteLength','streamOffset','diagnostic',
  'left','right','operator','predicate','conversion','initializationEvidence','uncertainRegions','copiedFrom','observedConsumerValue','outputOrigin','selection',
  'evaluation','helpMarker','reservationObservationId','deliveryObservationId','deliveryOffset','attribution',
  'bitfield','storageTarget','storageValue','storageDataInputs','nestedEvaluations','assertion','selectedOutcome',
  'functionTarget','resolvedFunctionId','resolvedFunctionName','resolvedFunctionEvidence','indirectTableIndex'];

export function recordIR(plan,observations,raw) {
  const instructions=new Map(plan.instructions.map(i=>[i.id,i])),ops=new Map(observations.instructions.map(o=>[o.id,o])),rawEvents=new Map(raw.events.map(e=>[e.eventId,e])),
    definitions=new Map(),rawToExecution=new Map(),aliases=new Map(),aliasRoles=new Map(),events=[],executions=new Map(),attempts=new Map(),gaps=new Set(),
    pendingArguments=new Map(),cleanup=new Map(),calls=new Map(),callBySite=new Map(),activeCalls=[],frameCalls=new Map(),
    pendingStorage=new Map(),storageEvents=new Map(),hiddenObjects=new Set(),declarationReentries=[],returnSources=new Map(),foldedResults=new Map(),
    valueForwardings=new Map(),observedValues=new Map();
  const control=createControlTracker(plan,ops);
  for(const gap of plan.controlFlow?.gaps??[])gaps.add(`${gap.reason}:${gap.functionId}`);
  let pending=null;const suspended=[],callCalculations=new Map();
  const binding=e=>plan.bindings[e.instructionId]??null;
  const role=(e,b=binding(e))=>b?.returnSites?.[returnSources.get(definitionKey(e.activationId,e.instructionId))]?.[`${e.kind}:${e.action??''}`]??
    b?.roles[`${e.kind}:${e.action??''}`]??b?.roles[e.kind]??plan.processInstructions[`${e.kind}:${e.action??''}`]??null;
  const definitionKey=(frame,result)=>`${frame??'process'}:${result}`;
  const operandValue=(operand,frame)=>{
    if(!operand)return null;
    const producer=definitions.get(definitionKey(frame,operand.value));
    if(producer)return {value:producer.value??null,observationId:producer.eventId};
    const integer=/^i(\d+)$/.exec(operand.type),literal=operand.value==='true'?'1':operand.value==='false'?'0':operand.value;
    if(integer&&/^-?\d+$/.test(literal)){
      const width=Number(integer[1]),bits=BigInt.asUintN(width,BigInt(literal));
      const value={type:operand.type,bits:`0x${bits.toString(16).padStart(Math.ceil(width/4),'0')}`,unsigned:bits.toString(),signed:BigInt.asIntN(width,bits).toString(),literal:operand.value,evidence:'compiler operand'};
      return {value:operand.cType?cResult(value,operand.cType):value,...(operand.nodeId?{nodeId:operand.nodeId}:{}),observationId:null};
    }
    return {value:{type:operand.type,literal:operand.value,evidence:'compiler operand'},observationId:null};
  };
  const evaluationTracker=createEvaluationTracker(plan,operandValue);
  const guardTracker=createGuardTracker(plan);
  const expressionNodes=new Map();
  function expressionContains(group,instructionId,activationId){
    if(activationId!==group.activationId)return false;
    let nodes=expressionNodes.get(group.instructionId);
    if(!nodes){
      nodes=new Set();const root=instructions.get(group.instructionId),stack=[root?.expression];
      if(root?.sourceNodeId)nodes.add(root.sourceNodeId);
      while(stack.length){const n=stack.pop();if(!n)continue;if(n.nodeId)nodes.add(n.nodeId);stack.push(...n.children??[]);}
      expressionNodes.set(group.instructionId,nodes);
    }
    return nodes.has(instructions.get(instructionId)?.sourceNodeId);
  }
  const belongsToPendingExpression=(e,instructionId=role(e))=>expressionContains(pending,instructionId,e.activationId);
  function activateGroup(instructionId,activationId){
    while(pending&&(pending.instructionId!==instructionId||pending.activationId!==activationId)){
      // A child calculation may be needed to obtain an address before the
      // enclosing expression can read its next operand. Suspend that parent;
      // completing its partial truth would invent a second source operation.
      if(expressionContains(pending,instructionId,activationId)){suspended.push(pending);pending=null;break;}
      flushCurrent();pending=suspended.pop()??null;
    }
    pending??={instructionId,activationId,events:[],inputs:new Map()};
  }
  function finishBeforeRead(e){
    while(pending){
      const ids=new Set(pending.events.map(s=>s.eventId));
      if(belongsToPendingExpression(e)&&!(e.addressInputs??[]).some(id=>ids.has(id)))break;
      flushCurrent();pending=suspended.pop()??null;
    }
  }
  function holdForCall(e){
    while(pending){
      if(belongsToPendingExpression(e)){
        callCalculations.set(e.eventId,{pending,suspended:suspended.splice(0)});pending=null;return;
      }
      // Argument calculations have to complete before the call. A surrounding
      // consumer, if any, can wait for the observed return without emitting a
      // second, prematurely completed copy of that source expression.
      flushCurrent();pending=suspended.pop()??null;
    }
  }
  function restoreCall(id){
    const saved=callCalculations.get(id);if(!saved)return;
    callCalculations.delete(id);pending=saved.pending;suspended.push(...saved.suspended);
  }
  function finishHeldCalls(phase){
    for(const id of [...callCalculations.keys()].reverse()){restoreCall(id);flushPending(phase);}
  }
  const runtimeInputs=(e,op)=>binding(e)?.sourceOperands??(e.selectedInput?
    (op.action==='select'?(binding(e)?.evaluation?.role==='selection'?[op.inputs[0]]:[op.inputs[0],e.selectedInput]):[e.selectedInput]):op?.inputs??[]);
  const inputValue=(input,e,op,index)=>{
    const result=operandValue(input,e.activationId),spec=plan.bindings[op?.id]?.inputTypes?.[index];
    if(result?.value&&spec&&(!result.observationId||!result.value.cType)){
      // PHI/select may carry observed bits without the C display type. Apply
      // integer interpretation only to integers; float bits and pointers must
      // retain their actual representation and captured value.
      const integer=['signed','unsigned'].includes(spec.cType?.signedness),value=
        result.value.bits&&(!result.observationId||integer)?cResult(result.value,spec.cType):{...result.value,cType:spec.cType};
      return {...result,nodeId:spec.nodeId,...(spec.foldedExpression?{foldedExpression:spec.foldedExpression}:{}),value:{...value,evidence:result.observationId?
        'observed operand value + AST operand type':'compiler operand bits + AST operand type'}};
    }
    return result;
  };
  // Value forwarding is intentionally separate from causal aliases: a prior
  // branch controls an observation but is not an operand evaluated this time.
  function expandValueInput(input,seen=new Set()){
    if(!input?.observationId||seen.has(input.observationId)||!valueForwardings.has(input.observationId))return input?[input]:[];
    seen.add(input.observationId);
    return valueForwardings.get(input.observationId).flatMap(next=>expandValueInput(next,new Set(seen)));
  }
  function callValueInput(input,seen=new Set()){
    if(!input?.observationId||seen.has(input.observationId))return input;
    const producer=ops.get(rawEvents.get(input.observationId)?.instructionId),forwarded=valueForwardings.get(input.observationId);
    // One source argument carries one observed value. A private GEP computes
    // that address; its base and indices are causes, not additional arguments.
    if(producer?.action==='address'||forwarded?.length!==1)return input;
    seen.add(input.observationId);return callValueInput(forwarded[0],seen);
  }
  const observationInputs=id=>expandValueInput({observationId:id,value:observedValues.get(id)?.value??rawEvents.get(id)?.value});
  function calculationInputs(e,op){
    const inputs=runtimeInputs(e,op).flatMap((input,index)=>expandValueInput(inputValue(input,e,op,index)));
    if(e.action==='short-circuit'&&e.left?.nodeId){
      const stack=[instructions.get(role(e))?.expression];
      while(stack.length){const n=stack.pop();if(!n)continue;
        if(n.nodeId===e.left.nodeId&&n.literal!==undefined){inputs.push({nodeId:n.nodeId,observationId:null,
          value:{literal:n.literal,cType:n.cType,evidence:'compiler AST literal at observed short-circuit consumer'}});break;}
        stack.push(...n.children??[]);
      }
    }
    const evaluation=e.evaluation;
    if(evaluation?.kind==='logical')for(const id of unique([evaluation.decisionObservationId,...evaluation.decisionObservationIds??[]]))
      inputs.push(...observationInputs(id));
    return inputs;
  }
  function begin(instructionId,e){
    const instruction=instructions.get(instructionId);
    if(!instruction){gaps.add(`unbound-event:${e.kind}:${e.action??''}`);return null;}
    const command={schemaVersion:3,eventId:`x${events.length+1}`,executionId:`x${events.length+1}`,instructionId,
      activationId:e.activationId??null,kind:instruction.kind,action:instruction.action,phase:'complete',
      observationIds:[],dataInputs:[],addressInputs:[],controlInputs:[],calleeInputs:[],evidence:e.evidence??'observed'};
    events.push(command);executions.set(command.eventId,command);return command;
  }
  function attach(command,e){
    if(!command)return;
    control.claim(command,e);
    command.observationIds.push(e.eventId);rawToExecution.set(e.eventId,command.eventId);
    for(const key of references)command[key].push(...(e[key]??[]));
    for(const key of copyFields)if(e[key]!==undefined)command[key]=key==='copiedFrom'?structuredClone(e[key]):e[key];
    // Public CALC labels follow the source definition on both grouped and
    // single-observation paths. LLVM opcodes stay in the raw observations.
    const definition=instructions.get(command.instructionId);
    if(['CALC','FLOW'].includes(command.kind)&&definition?.operator!=null)command.operator=definition.operator;
    if(e.readRegions)command.readRegions=e.readRegions.map(r=>({...r,dataInputs:[...(r.dataInputs??[])]}));
    if(e.inputStage)command.inputStage=e.inputStage;
    if(e.streamReadRegions)command.streamReadRegions=e.streamReadRegions.map(r=>({...r,dataInputs:[...r.dataInputs]}));
    if(e.libraryReadRegions)command.libraryReadRegions=e.libraryReadRegions.map(r=>({...r,dataInputs:[...r.dataInputs]}));
    if(e.callEventId)command.callObservationId=e.callEventId;
    if(e.returnEventId)command.returnObservationId=e.returnEventId;
    if(e.bufferWriterCallEventId)command.bufferWriterCallObservationId=e.bufferWriterCallEventId;
    if(e.callbackOfCallEventId)command.callbackOfCallObservationId=e.callbackOfCallEventId;
    if(e.action==='call.begin'){
      const op=ops.get(e.instructionId);command.callee=definition?.callee??e.callee;command.backendCallee=e.callee;
      const projection=binding(e)?.callProjection;
      command.arguments=projection?projection.arguments.map(a=>e.arguments[a.abiIndex]):e.arguments?.filter((_,index)=>!op?.args[index]?.sret);
      if(projection?.hiddenArguments.length||projection?.status==='unresolved')command.backendArguments=e.arguments;
      if(projection){command.argumentMappingStatus=projection.status;command.returnType=projection.returnType;command.returnDisposition=projection.returnDisposition;}
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
  function flushCurrent(phase='complete'){
    if(!pending)return;const p=pending;pending=null;const command=begin(p.instructionId,p.events[0]);if(!command)return;
    const steps=new Map();command.steps=[];
    for(const e of p.events){
      const b=binding(e),previous=steps.get(b?.materializesObservationId);
      if(previous){previous.value=e.value;previous.observationIds.push(e.eventId);
        if(b.numeric)previous.distance={...previous.distance,elementDistance:e.value.decimal};}
      else{
        const step={observationId:e.eventId,observationIds:[e.eventId],nodeId:e.guardResult?instructions.get(p.instructionId).evaluationNodeId:binding(e)?.expressionNodeId??null,
          operator:e.guardResult?instructions.get(p.instructionId).operator:binding(e)?.sourceOperator??null,value:e.value,conversion:e.conversion,inputs:p.inputs.get(e.eventId)};
        if(b?.sourceBuiltin)step.builtin=b.sourceBuiltin;
        if(b.numeric){step.distance={...b.numeric,byteDistance:e.value.signed,elementDistance:b.numericRole==='result'?e.value.decimal:null};
          if(b.numericRole==='byte-distance')step.value={evidence:'source result pending'};}
        command.steps.push(step);steps.set(e.instructionId,step);
      }
    }
    for(const e of p.events)attach(command,e);command.phase=phase;
    const evaluationNode=instructions.get(p.instructionId)?.evaluationNodeId,
      evaluated=new Map(p.events.flatMap(e=>[e.evaluation,...e.nestedEvaluations??[]].filter(Boolean).map(v=>[v.nodeId,v])));
    if(evaluated.size){
      if(evaluationNode&&evaluated.has(evaluationNode))command.evaluation=evaluated.get(evaluationNode);else delete command.evaluation;
      command.nestedEvaluations=[...evaluated.values()].filter(v=>v.nodeId!==evaluationNode);
    }
    const help=new Map(p.events.filter(e=>e.helpMarker).map(e=>[e.helpMarker.evaluationNodeId,e.helpMarker]));
    if(help.size){command.helpMarkers=[...help.values()];command.helpMarker=help.get(evaluationNode)??command.helpMarkers[0];}
    command.operator=instructions.get(p.instructionId)?.operator??null;delete command.conversion;delete command.predicate;
    const distance=command.steps.find(s=>s.distance&&s.nodeId===instructions.get(p.instructionId)?.expression?.nodeId);
    if(distance){command.distance=distance.distance;command.value=distance.value;}
    const inside=new Set(p.events.map(e=>e.eventId));
    command.inputs=[...command.steps.flatMap(s=>(s.inputs??[]).filter(input=>!(s.builtin&&!s.builtin.hasLiteralArguments&&input.observationId===null))),...p.attemptedInputs??[]]
      .filter(input=>!inside.has(input.observationId));
    if(p.attemptedInputs)command.dataInputs.push(...command.inputs.map(input=>input.observationId).filter(Boolean));
    // A short-circuit PHI can select a constant even though its decision used
    // an observed operand. Keep those actual inputs as value dependencies too.
    if([...evaluated.values()].some(e=>e.kind==='logical'))
      command.dataInputs.push(...command.inputs.map(input=>input.observationId).filter(Boolean));
    if(phase!=='complete')delete command.value;
  }
  function flushPending(phase='complete'){
    do{flushCurrent(phase);pending=suspended.pop()??null;}while(pending);
  }
  function remember(e,op){
    const result=op?.action==='function.argument'?op.parameter.value:op?.result;
    if(result&&(e.phase==='commit'||e.kind==='CALC'||e.action==='argument'||e.action==='call.end'||e.action==='object.begin'))
      definitions.set(definitionKey(e.activationId,result),e.action==='object.begin'?{...e,value:{type:`${op.type}*`,address:e.address,evidence:'observed storage address'}}:e);
  }
  function bindArgumentInput(command,argument){
    const definition=instructions.get(command.instructionId),context=calls.get(argument.callEventId),
      incoming=context?.inputs?.find(input=>input.abiParameterIndex===definition?.abiParameterIndex);
    command.inputs=[incoming?{...incoming}:{value:argument.value,observationId:null,
      parameterIndex:definition?.parameterIndex??null,evidence:'observed argument; caller producer unavailable'}];
  }
  function emitSingle(e,instructionId=role(e)){
    const command=begin(instructionId,e);if(!command)return null;
    const attempt=attempts.get(definitionKey(e.activationId,e.instructionId));
    if(attempt){attach(command,attempt);attempts.delete(definitionKey(e.activationId,e.instructionId));}
    attach(command,e);
    const op=ops.get(e.instructionId);
    if(e.action==='call.begin'){
      let index=0;
      command.inputs=(e.arguments??[]).flatMap((value,abiParameterIndex)=>{
        const operand=op?.args?.[abiParameterIndex];if(operand?.sret)return [];
        const projection=binding(e)?.callProjection,slot=projection?.arguments.find(a=>a.abiIndex===abiParameterIndex);
        if(projection&&!slot)return [];
        const parameterIndex=slot?.sourceIndex??index++,input={...(operand?operandValue(operand,e.activationId):{}),value};
        const forwarded=callValueInput(input),producer=ops.get(rawEvents.get(forwarded?.observationId)?.instructionId);
        if(producer?.action==='address'&&plan.bindings[producer.id]?.administrative){
          command.addressInputs.push(input.observationId);
          command.dataInputs=command.dataInputs.filter(id=>id!==input.observationId);
        }
        return [{...forwarded,value:{...forwarded?.value,...value},parameterIndex,abiParameterIndex}];
      });
    }else command.inputs=e.kind==='CALC'||command.kind==='CALC'?calculationInputs(e,op):
      runtimeInputs(e,op).flatMap((input,index)=>expandValueInput(inputValue(input,e,op,index)));
    if(command.action==='return.value')command.inputs=command.inputs.map(input=>input.value&&!input.value.cType&&op?.cType?
      {...input,value:input.value.bits?cResult(input.value,op.cType):{...input.value,cType:op.cType}}:input);
    if(binding(e)?.bitfield&&e.kind==='WRITE')for(const input of command.inputs){
      if(!input.observationId&&!input.nodeId){input.backendValue=input.value;input.value=e.value;input.kind='stored-field-value';}
    }
    if(op?.action==='call'&&e.action!=='call.begin'){
      const call=calls.get(e.callEventId)??callBySite.get(definitionKey(e.activationId,e.instructionId));
      if(call){command.inputs=call.inputs?.map(input=>({...input}))??call.event.arguments?.map((value,index)=>({...operandValue(op.args[index],e.activationId),value,abiParameterIndex:index})).filter(input=>!op.args[input.abiParameterIndex]?.sret);
        command.callObservationId??=call.event.eventId;
        const memoryArguments=instructions.get(instructionId)?.memoryArguments??[],accesses=[];
        // Match compiler member paths to captured pointer arguments and the
        // actual effect address. Aliased union arguments remain candidates;
        // their shared address alone never selects a member.
        for(const [role,address]of [['target',e.target?.address],['source',e.sourceAddress]]){
          if(address==null)continue;
          for(const info of memoryArguments){
            const argument=call.event.arguments?.[info.abiParameterIndex];
            if(argument?.address!=null&&BigInt(argument.address)===BigInt(address))accesses.push({...info,role,address,evidence:'compiler member path + observed call argument and effect address'});
          }
        }
        if(accesses.length)command.memoryAccesses=accesses;
        const destinations=accesses.filter(a=>a.role==='target');
        if(destinations.length===1){command.memberPath=destinations[0].memberPath;command.targetPath=destinations[0].targetPath;}
      }
    }
    for(const folded of foldedResults.get(e.eventId)??[]){
      const index=folded.consumer.kind==='argument'?folded.consumer.sourceIndex:0;
      if(command.inputs?.[index])command.inputs[index]={...command.inputs[index],executionId:folded.executionId};
    }
    if(e.action==='copy')command.inputs=[{kind:'memory-range',objectId:e.sourceObjectId??null,address:e.sourceAddress??null,
      offset:e.sourceOffset??null,size:e.sourceSize??e.target?.size??null}];
    if(e.action==='fill')command.inputs=[{value:{type:'i8',unsigned:String(e.byte),bits:`0x${e.byte.toString(16).padStart(2,'0')}`,evidence:'library API byte'}}];
    if(e.action==='argument'){
      bindArgumentInput(command,e);
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
  function emitFolded(e,b){
    const results=[];
    for(const spec of b.foldedCalculations??[]){
      const observed=spec.consumer.kind==='argument'?e.arguments?.[spec.consumer.index]:e.value;
      if(!observed?.bits){gaps.add(`folded-result-unobserved:${spec.instructionId}`);continue;}
      const command=begin(spec.instructionId,e),definition=instructions.get(spec.instructionId);if(!command)continue;
      control.claim(command,e);command.observationIds.push(e.eventId);command.evidence='compiler-folded source calculation at observed consumer';
      command.value=spec.cType.encoding==='DW_ATE_float'?{...observed,cType:spec.cType}:cResult(observed,spec.cType);command.operator=definition.operator;command.inputs=spec.inputs;
      command.controlInputs=[...(e.controlInputs??[])];
      // A folded result observes the whole expression, not a binary operation
      // on flattened leaves. Preserve the compiler tree without inventing
      // intermediate execution values (or asking the animator to parse C).
      command.foldedExpression={nodeId:spec.nodeId,expression:definition.expression,inputs:spec.inputs,
        value:command.value,intermediateValues:'not-observed',evidence:command.evidence};
      command.steps=[{nodeId:spec.nodeId,kind:'folded-expression',operator:'expression',expression:definition.expression,
        value:command.value,inputs:spec.inputs,observationIds:[e.eventId],evidence:command.evidence}];
      const token=`folded:${e.eventId}:${spec.instructionId}`;rawToExecution.set(token,command.eventId);
      results.push({executionId:command.eventId,token,consumer:spec.consumer});
    }
    foldedResults.set(e.eventId,results);return results.map(r=>r.token);
  }
  function finishCall(e){
    const command=emitSingle(e);
    const context=calls.get(e.callEventId);
    if(command){command.callObservationId=e.callEventId;
      const projection=binding(e)?.callProjection;
      if(projection){
        command.returnType=projection.returnType;command.returnDisposition=projection.returnDisposition;
        if(projection.returnFromArgument!==undefined){
          const value=context?.event.arguments?.[projection.returnFromArgument];
          if(value){command.backendValue=command.value;command.value={...value,cType:projection.returnType,evidence:projection.returnEvidence};}
        }
      }
      if(context?.returned)command.returnObservationId=context.returned.eventId;
      if(context?.returnValue){
        if(context.returnValue.value?.kind==='aggregate')command.value=context.returnValue.value;
        command.dataInputs.push(context.returnValue.eventId);
        if(context.returnValue.memoryState)command.memoryState=context.returnValue.memoryState;
      }
    }
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
      }else if(binding(storage)?.sourceTemporary){
        command.evidence='observed compound literal storage first used by source work';
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
    const typedObservation=observation.kind==='FLOW'&&b?.sourceCondition&&observation.condition?.bits?
      {...observation,backendCondition:observation.condition,condition:sourceBoolean(observation.condition,b.sourceCondition)}:
      observation.kind==='CALC'&&b?.sourceBoolean&&observation.value?.bits?
      {...observation,value:sourceBoolean(observation.value,b.sourceBoolean)}:
      observation.kind==='CALC'&&b?.numericRole==='result'?
      {...observation,value:cResult(observation.value,b.resultType)}:
      op?.cBoolean&&op.cType&&observation.value?.type==='i1'?
      {...observation,value:cResult(observation.value,op.cType,true)}:observation;
    let e=assertionObservation(evaluationTracker.decorate(control.decorate(typedObservation),op,b),b);
    observedValues.set(e.eventId,e);
    if(b?.administrative&&(e.kind==='CALC'||e.action==='branch')){
      const operands=b.evaluation?.role==='truth-test'?runtimeInputs(e,op).slice(0,1):
        e.selectedInput?[e.selectedInput]:runtimeInputs(e,op);
      valueForwardings.set(e.eventId,operands.map((input,index)=>inputValue(input,e,op,index)));
    }
    if(op?.opcode==='select'&&b?.evaluation?.role==='selection'&&e.selectedInput){
      // A public selection FLOW records the decision, while the same LLVM
      // observation forwards an arm value. Consumers must not use FLOW as data.
      const index=e.evaluation?.conditionTruth?1:2;
      valueForwardings.set(e.eventId,[inputValue(e.selectedInput,e,op,index)]);
    }
    if(b?.administrative&&e.phase==='commit'&&op?.action==='store'){
      const sourceNodeId=b.sourceMapping?.astNodeIds?.[0]??null;
      valueForwardings.set(e.eventId,runtimeInputs(e,op).map((input,index)=>({
        ...inputValue(input,e,op,index),sourceNodeId,source:op.source,evidence:'compiler-private store operand'})));
    }
    if(b?.administrative&&e.phase==='commit'&&op?.action==='load'&&e.dataInputs?.length===1){
      const writer=observedValues.get(e.dataInputs[0]);
      // Only forward a complete scalar write to the same hidden range. Partial
      // or mixed-writer loads keep their observed value and separate causes.
      if(writer?.kind==='WRITE'&&valueForwardings.has(writer.eventId)&&writer.target?.objectId===e.target?.objectId&&
        writer.target?.offset===e.target?.offset&&writer.target?.size===e.target?.size)
        valueForwardings.set(e.eventId,[{observationId:writer.eventId,value:e.value}]);
    }
    const guardResult=guardTracker.observe(e,b);
    if(b?.bitfield&&['READ','WRITE'].includes(e.kind)){
      const spec=b.bitfield;
      e={...e,storageTarget:e.target,storageValue:e.value,storageDataInputs:e.dataInputs,
        target:{...e.target,bitOffset:e.target?.offset==null?null:e.target.offset*8+spec.shift,bitSize:spec.width},
        value:bitfieldValue(e.value,spec),bitfield:spec};
      if(e.kind==='READ')e.dataInputs=e.bitfieldDataInputs??e.dataInputs;
      else e.dataInputs=runtimeInputs(e,op).map(input=>definitions.get(definitionKey(e.activationId,input.value))?.eventId).filter(Boolean);
    }
    const key=definitionKey(e.activationId,e.instructionId);
    if(e.phase!=='attempt')for(const site of b?.returnSourceFor??[])
      returnSources.set(definitionKey(e.activationId,site.returnObservationId),site.sourceNodeId);
    if(b?.foldedCalculations&&(e.action==='call.begin'||e.phase==='commit'||e.action==='return.value')){
      flushPending();const tokens=emitFolded(e,b);if(tokens.length)e={...e,dataInputs:[...(e.dataInputs??[]),...tokens]};
    }
    if(b?.foldedResults){
      const ids=e.controlInputs.filter(id=>b.foldedResults.includes(rawEvents.get(id)?.instructionId));
      e.dataInputs=unique([...(e.dataInputs??[]),...ids]);
    }
    if(e.action==='object.begin'){
      storageEvents.set(e.objectId,e);
      if(b?.hiddenStorage)hiddenObjects.add(e.objectId);
      if(b?.declarationObservationId||b?.sourceTemporary){pendingStorage.set(e.objectId,e);remember(e,op);continue;}
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
    if(e.phase==='attempt'){
      // A fault in the next expression must not mark an already completed
      // previous calculation as failed. Preserve same-expression faults.
      if(e.kind==='READ'&&pending&&!b?.administrative)finishBeforeRead(e);
      attempts.set(key,e);continue;
    }
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
      while(pending&&b?.failedInstructionId&&!belongsToPendingExpression(e,b.failedInstructionId)){
        flushCurrent();pending=suspended.pop()??null;
      }
      // A checked operation can fail before its result observation is emitted.
      // Its operands have nevertheless already been obtained. Preserve those
      // values without inventing a completed operation or evaluating C again.
      if(pending&&op?.kind==='CALC'&&b?.failedInstructionId&&belongsToPendingExpression(e,b.failedInstructionId))
        pending.attemptedInputs=calculationInputs(e,op);
      const hadPending=!!pending||callCalculations.size>0;flushPending('failed');finishHeldCalls('failed');
      for(const attempt of [...attempts.values()]){
        attempts.delete(definitionKey(attempt.activationId,attempt.instructionId));
        const failed=emitSingle(attempt);if(failed){failed.phase=raw.status==='fault'?'failed':'incomplete';delete failed.value;}
      }
      flushArguments();
      const error=emitSingle(e,plan.processInstructions['ERROR:fault']);if(error&&hadPending)error.failedExecutionId=events.at(-2)?.eventId??null;
      continue;
    }
    if(guardResult&&!guardResult.unresolved){
      const g=guardResult,spec=g.spec;
      activateGroup(spec.calcInstructionId,e.activationId);
      const value=cResult({type:'i1',bits:(spec.resultIsCondition?g.conditionTruth:g.truth)?'0x1':'0x0'},spec.cType,true),
        helpMarker=g.evaluation.right==='skipped'?{kind:'logical-short-circuit',status:'stub',reason:g.evaluation.reason,
          evaluationNodeId:spec.nodeId,highlight:spec.source,skippedSource:spec.rightSource}:undefined;
      const sample={...e,kind:'CALC',action:'expression',guardResult:true,value,evaluation:g.evaluation,
        nestedEvaluations:g.nestedEvaluations,dataInputs:g.inputs,...(helpMarker?{helpMarker}:{}),evidence:'observed condition edges + AST logical structure'};
      pending.events.push(sample);pending.inputs.set(sample.eventId,g.inputs.flatMap(observationInputs));
      flushPending();const calc=events.at(-1),token=`guard-result:${e.eventId}`;rawToExecution.set(token,calc.eventId);
      let flowEvent={...e,backendCondition:e.backendCondition??e.condition,
        condition:cResult({bits:g.conditionTruth?'0x1':'0x0'},spec.cType,true),dataInputs:[token],evaluation:g.evaluation};
      if(spec.conditionalNodeId)flowEvent=evaluationTracker.completeConditional(flowEvent,spec.conditionalNodeId,g.conditionTruth);
      const branch=emitSingle(flowEvent,spec.flowInstructionId);
      branch.selectedOutcome=g.conditionTruth?'true':'false';
      branch.nestedEvaluations=spec.conditionalNodeId?[g.evaluation,...g.nestedEvaluations]:g.nestedEvaluations;
      if(spec.assertion){branch.assertion={...spec.assertion,result:g.conditionTruth?'passed':'failed'};branch.selectedOutcome=branch.assertion.result;}
      continue;
    }
    if(guardResult?.unresolved)gaps.add(`logical-condition-result-unobserved:${guardResult.spec.nodeId}`);
    if(b?.administrative){
      if(op?.action==='branch'&&!b.guardDecision&&
        instructions.get(pending?.instructionId)?.sourceNodeId!==b.continueExpressionNodeId)flushPending();
      const attempt=attempts.get(key);if(attempt)aliases.set(attempt.eventId,[e.eventId]);
      attempts.delete(key);
      // Selected PHI inputs and no-op casts retain their dependencies, not a
      // fictitious independent calculation animation.
      const values=unique([...(e.dataInputs??[]),...runtimeInputs(e,op).map(input=>definitions.get(definitionKey(e.activationId,input.value))?.eventId)]);
      aliases.set(e.eventId,values);
      aliasRoles.set(e.eventId,{dataInputs:values,addressInputs:e.addressInputs??[],controlInputs:e.controlInputs??[],calleeInputs:e.calleeInputs??[]});
      remember(e,op);continue;
    }
    if(e.kind==='CALC'&&b?.group){
      activateGroup(b.group,e.activationId);
      pending.inputs.set(e.eventId,calculationInputs(e,op));
      pending.events.push(e);remember(e,op);continue;
    }
    if(e.kind==='READ'&&pending){
      // Reads may interleave with subcalculations of the same expression.
      // An unrelated read starts new source work even when its address does
      // not depend on the completed value. Do not sort by source line: two
      // expressions can share a line, and loops reuse the same source nodes.
      finishBeforeRead(e);
    }else if(e.action==='call.begin')holdForCall(e);else flushPending();
    if(e.kind==='WRITE'&&e.action==='output'){
      emitOutput(e,ordered[index-1]);
    }else if(e.action==='call.begin'){
      const command=emitSingle(e),context={event:e,inputs:command?.inputs??[],returned:null};calls.set(e.eventId,context);callBySite.set(key,context);activeCalls.push(context);
    }else if(e.action==='call.end'){
      finishCall(e);
      const context=calls.get(e.callEventId);
      const at=activeCalls.indexOf(context);if(at!==-1)activeCalls.splice(at,1);
    }else if(e.action==='frame.begin'){
      const context=activeCalls.at(-1);if(context&&context.event.activationId!==e.activationId&&!e.callbackOfCallEventId)frameCalls.set(e.activationId,context);
      emitSingle(e);
    }else if(e.action==='return.value'){
      const context=frameCalls.get(e.activationId),command=emitSingle(e);
      if(context){context.returnValue=e;if(command)command.callObservationId=context.event.eventId;}
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
          command.dataInputs=[...(argument.dataInputs??[])];command.callObservationId=argument.callEventId;bindArgumentInput(command,argument);}
        pendingArguments.delete(argumentKey);
      }else emitSingle(e);
    }else if(e.action==='object.begin'&&b?.byValueArgument){
      emitSingle(e);const argument=pendingArguments.get(key),argumentId=b.roles['WRITE:argument'];
      if(argument){const command=emitSingle(argument,argumentId);if(command){command.target={objectId:e.objectId,address:e.address,offset:0,size:e.size};
        command.value={kind:'aggregate',type:op.parameter.type.slice(0,-1),cType:instructions.get(argumentId)?.cType??op.cType,
          byteLength:e.size,evidence:'observed by-value memory'};command.abiValue=argument.value;command.memoryState=e.memoryState;command.copiedFrom=structuredClone(e.copiedFrom);
        command.inputs=e.copiedFrom?[{kind:'memory-range',...e.copiedFrom}]:[];
        command.dataInputs=[...argument.dataInputs??[]];
        const sourceCall=executions.get(rawToExecution.get(argument.callEventId));
        if(sourceCall){const value={...command.value,memoryState:e.memoryState,copiedFrom:structuredClone(e.copiedFrom)};
          const previous=sourceCall.inputs[command.parameterIndex];
          if(previous?.observationId){sourceCall.addressInputs.push(previous.observationId);sourceCall.dataInputs=sourceCall.dataInputs.filter(id=>id!==previous.observationId);}
          sourceCall.dataInputs.push(...command.dataInputs);
          sourceCall.arguments[command.parameterIndex]=value;sourceCall.inputs[command.parameterIndex]={kind:'memory-range',...e.copiedFrom,
            observationId:e.copiedFrom?.valueObservationId??null,value,parameterIndex:command.parameterIndex};}
      }
        pendingArguments.delete(key);}
    }else emitSingle(e);
    remember(e,op);
    if(e.action==='call.end')restoreCall(e.callEventId);
  }
  flushPending(raw.status==='completed'?'complete':'incomplete');
  finishHeldCalls('incomplete');
  flushArguments();
  for(const attempt of [...attempts.values()]){
    attempts.delete(definitionKey(attempt.activationId,attempt.instructionId));
    const command=emitSingle(attempt);if(command){command.phase=raw.status==='fault'?'failed':'incomplete';delete command.value;}
  }
  const resolve=createAliasResolver(rawToExecution,aliases);
  const eventOrder=new Map(events.map((e,index)=>[e.eventId,index]));
  const boundary=(id,actions)=>{const direct=rawToExecution.get(id),e=executions.get(direct);return e?.kind==='FLOW'&&actions.includes(e.action)?direct:null;};
  for(const command of events){
    const dependency=createObservationResolver({rawToExecution,executions,aliases,aliasRoles,valueForwardings,rawEvents,eventOrder},command);
    const related={};
    for(const key of references)command[key]=unique(command[key].flatMap(id=>dependency(id,key,related))).filter(id=>id!==command.eventId);
    for(const key of references)command[key]=unique([...command[key],...related[key]??[]]).filter(id=>id!==command.eventId);
    if(command.storageDataInputs)command.storageDataInputs=unique(command.storageDataInputs.flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
    for(const range of [command.copiedFrom,...command.inputs??[],...command.arguments?.map(a=>a.copiedFrom)??[]].filter(Boolean)){
      if(range.valueObservationId)range.valueExecutionId=resolve(range.valueObservationId)[0]??null;
      if(range.kind==='memory-range'||range===command.copiedFrom||range.valueObservationId)range.dataInputs=unique((range.dataInputs??[]).flatMap(id=>executions.has(id)?[id]:resolve(id)));
    }
    if(command.callObservationId)command.callExecutionId=boundary(command.callObservationId,['call']);
    if(command.returnObservationId)command.returnExecutionId=boundary(command.returnObservationId,['return','resume']);
    if(command.bufferWriterCallObservationId)command.bufferWriterCallExecutionId=boundary(command.bufferWriterCallObservationId,['call']);
    if(command.callbackOfCallObservationId)command.callbackOfCallExecutionId=boundary(command.callbackOfCallObservationId,['call']);
    if(command.callObservationId&&calls.get(command.callObservationId)?.hidden){
      command.backendCallObservationId=command.callObservationId;command.backendReturnObservationId=command.returnObservationId??null;
      const context=frameCalls.get(command.activationId);
      command.callObservationId=context?.event.eventId??null;command.returnObservationId=context?.returned?.eventId??null;
      command.callExecutionId=boundary(command.callObservationId,['call']);command.returnExecutionId=boundary(command.returnObservationId,['return','resume']);
    }
    for(const input of command.inputs??[])if(input.observationId){input.executionId=resolve(input.observationId)[0]??null;
      const privateOp=ops.get(rawEvents.get(input.observationId)?.instructionId),producer=executions.get(input.executionId);
      if(privateOp?.action==='address'&&plan.bindings[privateOp.id]?.administrative){
        // The hidden address has no public value-producing event. Do not name
        // its first base/index dependency as if it had produced this address.
        input.executionId=null;const related={};
        command.addressInputs=unique([...command.addressInputs,...dependency(input.observationId,'addressInputs',related)]);
        command.controlInputs=unique([...command.controlInputs,...related.controlInputs??[]]);
      }
      if(command.kind==='CALC'&&!rawToExecution.has(input.observationId)&&privateOp?.opcode==='bitcast'&&(producer?.value?.bits||producer?.value?.address)){
        input.backendValue=input.value;input.value=producer.value;
      }
    }
    if(command.kind==='CALC'){const seen=new Set();command.inputs=(command.inputs??[]).filter(input=>{
      if(!input.executionId)return true;if(seen.has(input.executionId))return false;seen.add(input.executionId);return true;
    });}
    for(const item of [command.evaluation,...command.inputEvaluations??[],...command.nestedEvaluations??[]].filter(Boolean)){
      if(item.decisionObservationId)item.decisionExecutionIds=resolve(item.decisionObservationId);
      if(item.decisionObservationIds)item.decisionExecutionIds=unique(item.decisionObservationIds.flatMap(id=>resolve(id)));
      if(item.resultObservationId)item.resultExecutionIds=unique(observationInputs(item.resultObservationId)
        .flatMap(input=>input.observationId?resolve(input.observationId):[]));
    }
    for(const step of command.steps??[])for(const input of step.inputs??[])if(input.observationId)input.executionId=resolve(input.observationId)[0]??null;
    for(const region of command.readRegions??[])if(region.dataInputs)region.dataInputs=unique(region.dataInputs.flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
    for(const region of [...command.streamReadRegions??[],...command.libraryReadRegions??[]])region.dataInputs=unique(region.dataInputs.flatMap(id=>resolve(id))).filter(id=>id!==command.eventId);
  }
  const executionIds=orderReturnCleanup(events,buildResultDeliveries(plan,{events}),plan);
  remapExecutionReferences(control.transitions,executionIds);
  for(const [id,executionId]of rawToExecution)rawToExecution.set(id,executionIds.get(executionId)??executionId);
  executions.clear();for(const e of events)executions.set(e.eventId,e);
  const projectedResolve=createAliasResolver(rawToExecution,aliases),ref=id=>projectedResolve(id)[0]??null;
  const represented=new Set(events.flatMap(e=>e.observationIds)),deferred=new Set([...pendingStorage.values()].map(e=>e.eventId)),
    accounting={total:raw.events.length,represented:0,forwarded:0,administrative:0,deferredStorage:0,unexplained:[]};
  for(const e of raw.events){
    if(represented.has(e.eventId)||rawToExecution.has(e.eventId))accounting.represented++;
    else if(aliases.has(e.eventId)){if(resolve(e.eventId).length)accounting.forwarded++;else accounting.administrative++;}
    else if(deferred.has(e.eventId))accounting.deferredStorage++;
    else accounting.unexplained.push({eventId:e.eventId,instructionId:e.instructionId,kind:e.kind,action:e.action});
  }
  if(accounting.unexplained.length)gaps.add('observations-without-disposition');
  const flowTransitions=control.transitions.map(t=>({...t,controlInputs:unique(t.controlInputs.flatMap(id=>projectedResolve(id)))}));
  const excluded=new Set([...hiddenObjects,...pendingStorage.keys()]),
    views=(raw.views??[]).filter(v=>!excluded.has(v.objectId)),viewIds=new Set(views.map(v=>v.id));
  const objects=(raw.objects??[]).filter(o=>!excluded.has(o.id)).map(o=>({...o,createdBy:ref(o.createdBy),endedBy:ref(o.endedBy),
    runtimeLifetime:{createdAtObservationId:o.createdBy,endedAtObservationId:o.endedBy??null},
    ...(o.valueProducedBy?{valueProducedBy:ref(o.valueProducedBy)}:{}),
    ...(o.storageEvidence?.callEventId?{storageEvidence:{...o.storageEvidence,callEventId:undefined,
      callObservationId:o.storageEvidence.callEventId,callExecutionId:boundary(o.storageEvidence.callEventId,['call'])}}:{}),
    initializationRanges:o.initializationRanges?.map(r=>({...r,writer:r.writer==='unobserved'?r.writer:ref(r.writer)})),
    bitInitializationRanges:o.bitInitializationRanges?.map(r=>({...r,writer:r.writer==='unobserved'?r.writer:ref(r.writer)}))}));
  const resultDeliveries=buildResultDeliveries(plan,{events});
  attachConversionConsumers(plan,events);
  const trace={schemaVersion:3,programId:plan.programId,runId:raw.runId,backend:raw.backend,status:raw.status,exitCode:raw.exitCode,
    events,flowTransitions,objects,resultDeliveries,
    frames:(raw.frames??[]).map(f=>{const {callbackOfCallEventId,...frame}=f;return {...frame,...(callbackOfCallEventId?{
      callbackOfCallObservationId:callbackOfCallEventId,callbackOfCallExecutionId:boundary(callbackOfCallEventId,['call'])}: {})};}),
    views,references:(raw.references??[]).filter(r=>!excluded.has(r.objectId)&&!excluded.has(r.targetObjectId)).map(r=>({...r,eventId:ref(r.eventId)})),
    structures:[],
    diagnostics:(raw.diagnostics??[]).map(d=>({...d,eventId:ref(d.eventId)})),
    coverage:{...plan.coverage,...raw.coverage,...resolvedCoverage(plan,{events}),irEvents:events.length,observationEvents:raw.events.length,irGaps:[...gaps],
      observationAccounting:accounting,pendingCleanup:[...cleanup.values()].flat().map(e=>e.objectId),
      sourceOrder:{automaticBoxes:'observed declaration entry; no sorting by source line',
        hiddenCompilerObjects:hiddenObjects.size,unreachedDeclarations:pendingStorage.size,
        declarationReentries,lifetime:plan.coverage.lifetime??'lifetime information not supplied'},
      stdioOutput:outputCoverage,
      controlFlow:{method:'observed edges with postdominator regions per activation',
        pendingTransitions:flowTransitions.filter(t=>!t.beforeExecutionId).map(t=>t.id)},
      seek:'not implemented; IR and state effects are recorded for a future consumer',animation:'stub'}};
  try{return validateIRTrace(plan,trace);}
  catch(error){
    const failed=executions.get(error.eventId);
    if(failed)error.context={instructionId:failed.instructionId,source:instructions.get(failed.instructionId)?.source,...error.context};
    throw error;
  }
}
