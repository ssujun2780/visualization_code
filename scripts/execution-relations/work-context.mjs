import {createRelationContext} from './context.mjs';
import {validateRelationResult} from './result.mjs';
import {recordIndex,complete,range,accessLayout,union,unique} from './records.mjs';

// Queries describe the boundary AFTER the selected canonical event. All
// indexes contain references/byte ranges, never a second memory/value machine.
function upperBound(rows,position,key){
  let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(key(rows[mid])<=position)lo=mid+1;else hi=mid;}
  return lo;
}
export function createExecutionWorkQuery(plan,trace,result){
  const context=createRelationContext(plan,trace),metadata=structuredClone(result);
  validateRelationResult(context,metadata);
  const {byFrame,argumentsByFrame}=recordIndex(context),position=e=>context.position(e.eventId),
    observations=new Map(),internalObservations=new Map(),localObjects=new Map(),byActivation=new Map(),
    focusAt=[],active=[],subtreeAccesses=new Map(),prefixCache=new Map();
  for(const object of context.trace.objects){
    const list=localObjects.get(object.frameId)??[];list.push(object);localObjects.set(object.frameId,list);
  }
  for(const event of context.trace.events){
    for(const id of event.observationIds??[])internalObservations.set(id,event);
    for(const step of event.steps??[])for(const id of unique([step.observationId,...step.observationIds??[]].filter(Boolean)))internalObservations.set(id,event);
    if(complete(event)&&event.target?.objectId){
      const list=observations.get(event.target.objectId)??[];list.push(event);observations.set(event.target.objectId,list);
    }
    if(complete(event)&&event.action==='frame.begin')active.push(event.activationId);
    if(complete(event)&&event.action==='frame.end'){
      const index=active.lastIndexOf(event.activationId);if(index>=0)active.splice(index,1);
    }
    focusAt.push(active.at(-1)??null);
  }
  for(const f of byFrame.values())subtreeAccesses.set(f.frame.id,[...f.accesses]);
  // Children enter later than their parents. Folding references bottom-up
  // avoids recursive JavaScript calls and does not copy observation values.
  const reverseFrames=[...byFrame.values()].sort((a,b)=>(position(b.begin??{})??-1)-(position(a.begin??{})??-1));
  for(const f of reverseFrames)if(f.call){const parent=byFrame.get(f.frame.parent);subtreeAccesses.get(parent.frame.id).push(...subtreeAccesses.get(f.frame.id));}
  for(const rows of subtreeAccesses.values())rows.sort((a,b)=>position(a.event)-position(b.event));
  for(const r of metadata.relations)for(const id of r.activationIds){
    const rows=byActivation.get(id)??[];rows.push(r);byActivation.set(id,rows);
  }
  for(const rows of byActivation.values())rows.sort((a,b)=>context.position(a.availableAtExecutionId)-context.position(b.availableAtExecutionId));

  function frameAlive(id,at){
    const f=byFrame.get(id),begin=position(f?.begin??{}),end=position(f?.end??{});
    return begin!==undefined&&begin<=at&&(end===undefined||end>at);
  }
  function lifetime(id,at){
    const object=context.object(id),begin=context.position(object?.createdBy),end=context.position(object?.endedBy);
    return begin===undefined||begin>at?'unavailable':end!==undefined&&end<=at?'ended':'live';
  }
  function objectInfo(id,at){
    const o=context.object(id),state=lifetime(id,at);if(!o||state==='unavailable')return null;
    return {objectId:o.id,name:o.name??null,storage:o.storage,frameId:o.frameId??null,size:o.size,typeId:o.cType?.id??null,
      lifetime:state,createdAtExecutionId:o.createdBy,...(state==='ended'?{endedAtExecutionId:o.endedBy}:{})};
  }
  function frameInfo(id,at){
    const f=byFrame.get(id);if(!f?.begin||position(f.begin)>at)return null;
    const alive=frameAlive(id,at);
    return {activationId:id,functionId:f.frame.functionId,functionName:f.frame.functionName,parentActivationId:f.frame.parent??null,
      entryExecutionId:f.begin.eventId,state:alive?'live':'ended',...(!alive&&f.end?{endedAtExecutionId:f.end.eventId}:{})};
  }
  function lastObservation(id,at){
    const rows=observations.get(id)??[];return rows[upperBound(rows,at,position)-1]??null;
  }
  const eventRef=e=>({executionId:e.eventId,instructionId:e.instructionId,activationId:e.activationId??null,kind:e.kind,action:e.action,
    source:context.instruction(e.instructionId)?.source??null});
  function referenceFrom(event,at,slotObjectId=null){
    const ref=event?.value?.reference;if(!ref)return null;
    const state=lifetime(ref.targetObjectId,at);
    return {slotObjectId,observationExecutionId:event.eventId,objectId:state==='unavailable'?null:ref.targetObjectId??null,offset:ref.targetOffset??null,
      onePast:ref.onePast===true,recordedStatus:ref.status??'unknown',targetLifetime:lifetime(ref.targetObjectId,at),extent:'reference-only'};
  }
  function prefixes(id,at){
    const rows=subtreeAccesses.get(id)??[],stop=upperBound(rows,at,a=>position(a.event));
    let cached=prefixCache.get(id);
    if(!cached||cached.stop>stop){cached={stop:0,objects:new Map()};prefixCache.set(id,cached);}
    while(cached.stop<stop){
      const a=rows[cached.stop++],entry=cached.objects.get(a.target.objectId)??{readRanges:[],writeRanges:[],accessCount:0};
      const key=a.mode==='read'?'readRanges':'writeRanges';entry[key]=union([...entry[key],a.target]);entry.accessCount++;
      entry.lastAccessExecutionId=a.event.eventId;cached.objects.set(a.target.objectId,entry);
    }
    return cached.objects;
  }
  function at(executionId){
    const at=executionId===null?-1:context.position(executionId);
    if(at===undefined)throw new RangeError('조회 시점이 실행 기록에 없습니다.');
    const view={schemaVersion:1,scope:context.scope,analysisStatus:metadata.status,executionId,phase:'before-start',operation:null,
      calls:{currentActivationId:null,stack:[]},locals:[],storage:[],references:[],
      relations:{operationIds:[],contextIds:[],historyIds:[]},history:{activations:[],storage:[],dependencies:[]}};
    if(at<0)return structuredClone(view);
    const current=context.event(executionId),resident=focusAt[at],focus=frameAlive(current.activationId,at)?current.activationId:resident,stack=[],seenFrames=new Set();
    for(let id=resident;id&&!seenFrames.has(id)&&frameAlive(id,at);id=context.frame(id)?.parent){seenFrames.add(id);stack.unshift(id);}
    view.phase=current.kind==='ERROR'&&current.phase==='fault'?'fault':focus?'active':'no-active-frame';
    const focusDepth=stack.indexOf(focus);
    view.calls={currentActivationId:focus,stack:stack.map((id,index)=>({...frameInfo(id,at),role:id===focus?'current':index<focusDepth?'caller':'resident-callee'}))};
    const selected=new Map(),historicStorage=new Map(),usedEvents=new Set(),dependencyFrames=new Set(),focusRanges=new Map(),refs=new Map();
    function includeObject(id,historical=false){
      const info=objectInfo(id,at);if(!info)return;
      if(historical||info.lifetime!=='live')historicStorage.set(id,info);else selected.set(id,info);
    }
    function includeReference(ref,role='operand'){
      if(!ref)return;ref={...ref,role};refs.set(`${role}:${ref.slotObjectId??''}:${ref.observationExecutionId}`,ref);
      if(ref.objectId)includeObject(ref.objectId,ref.targetLifetime!=='live');
    }
    function observedAccess(event,target,role,historical){
      const actual=range(context,target,event);if(!actual)return;
      includeObject(actual.objectId,historical);
      if(historical)return;
      const rows=focusRanges.get(actual.objectId)??[];
      rows.push({...actual,role,executionId:event.eventId,layout:accessLayout(context,event,actual)});focusRanges.set(actual.objectId,rows);
    }
    // Stop at READ value observations. Its dataInputs are old memory writers,
    // not additional current operands. Address producers still supply indices.
    const todo=[current],seenEvents=new Set();
    while(todo.length){
      const event=todo.pop();if(!event||seenEvents.has(event.eventId)||position(event)>at)continue;seenEvents.add(event.eventId);
      const historical=!!event.activationId&&!frameAlive(event.activationId,at)||
        !!event.target?.objectId&&lifetime(event.target.objectId,at)!=='live';
      if(event.activationId)dependencyFrames.add(event.activationId);
      if(historical)view.history.dependencies.push(eventRef(event));else usedEvents.add(event.eventId);
      if(complete(event)&&['READ','WRITE'].includes(event.kind))observedAccess(event,event.target,event.kind==='READ'?'read':'write',historical);
      if(complete(event)&&event.kind==='WRITE'&&event.action==='copy')observedAccess(event,
        {objectId:event.sourceObjectId,offset:event.sourceOffset,size:event.sourceSize},'copy-source',historical);
      if(complete(event)&&!historical)includeReference(referenceFrom(event,at,event.target?.objectId??null));
      const ids=event.kind==='READ'?[...(event.addressInputs??[])]:[
        ...event.dataInputs??[],...event.addressInputs??[],...event.calleeInputs??[],
        ...(event.inputs??[]).map(i=>i.executionId),...(event.steps??[]).flatMap(s=>(s.inputs??[]).map(i=>i.executionId))];
      for(const id of unique(ids.filter(Boolean))){const producer=context.event(id);if(complete(producer)&&position(producer)<position(event))todo.push(producer);}
    }
    for(const object of localObjects.get(focus)??[]){
      if(lifetime(object.id,at)!=='live')continue;
      const last=lastObservation(object.id,at);
      const argument=(argumentsByFrame.get(focus)??[]).find(e=>e.target?.objectId===object.id&&position(e)<=at);
      view.locals.push({...objectInfo(object.id,at),inOperation:focusRanges.has(object.id),
        parameter:argument?{index:argument.parameterIndex,callExecutionId:argument.callExecutionId??null,argumentExecutionId:argument.eventId}:null,
        latestObservation:last?{...eventRef(last),target:last.target}:null});
      // A later overwrite without a recorded reference must invalidate the
      // previous pointer binding; never fall back to the entry argument.
      if(last?.target?.offset===0&&last.target.size===object.size)includeReference(referenceFrom(last,at,object.id),'binding');
    }
    const observed=focus?prefixes(focus,at):new Map();
    for(const id of observed.keys())includeObject(id);
    // Local scalar boxes already live in locals. A single shared identity is
    // used when a local array or a dereferenced local also needs a range view.
    for(const [id,info]of selected){
      const object=context.object(id),rows=focusRanges.get(id)??[],prefix=observed.get(id);
      if(info.frameId===focus&&object.cType?.kind!=='array'&&!prefix&&!rows.some(r=>r.layout))continue;
      view.storage.push({...info,focusRanges:rows,observed:{activationId:focus,scope:'subtree',extent:'observed-prefix',
        readRanges:prefix?.readRanges??[],writeRanges:prefix?.writeRanges??[],accessCount:prefix?.accessCount??0,
        lastAccessExecutionId:prefix?.lastAccessExecutionId??null}});
    }
    view.references=[...refs.values()];
    const relatedFrames=new Set(stack);
    for(const id of stack)for(const child of byFrame.get(id)?.children??[]){
      if(child.end&&position(child.end)<=at){relatedFrames.add(child.frame.id);view.history.activations.push(frameInfo(child.frame.id,at));}
    }
    for(const id of dependencyFrames){relatedFrames.add(id);if(!frameAlive(id,at)){
      const info=frameInfo(id,at);if(info&&!view.history.activations.some(f=>f.activationId===id))view.history.activations.push(info);
    }}
    for(const id of current.endedObjects??[])includeObject(id,true);
    const candidates=new Map();
    for(const id of relatedFrames){const rows=byActivation.get(id)??[],stop=upperBound(rows,at,r=>context.position(r.availableAtExecutionId));
      for(let i=0;i<stop;i++)candidates.set(rows[i].id,rows[i]);}
    for(const r of candidates.values()){
      const onOperation=r.kind==='storage-access'&&usedEvents.has(r.accessExecutionId)||r.kind==='storage-copy'&&r.writeExecutionId===current.eventId;
      const live=r.activationIds.every(id=>frameAlive(id,at))&&r.participants.every(p=>lifetime(p.objectId,at)==='live');
      const binding=r.kind==='pointer-argument'&&view.references.some(ref=>ref.role==='binding'&&ref.slotObjectId===r.participants[0]?.objectId&&
        ref.objectId===r.reference.objectId&&ref.offset===r.reference.offset);
      if(onOperation)view.relations.operationIds.push(r.id);
      else if(live&&(r.kind==='activation-call'||binding||r.kind==='activation-range'))view.relations.contextIds.push(r.id);
      else if(r.participants.some(p=>selected.has(p.objectId)||historicStorage.has(p.objectId))||
        r.kind==='activation-call'&&relatedFrames.has(r.calleeActivationId))view.relations.historyIds.push(r.id);
    }
    view.history.storage=[...historicStorage.values()];
    function operand(input){
      const byExecution=context.event(input.executionId),byObservation=internalObservations.get(input.observationId),producer=byExecution??byObservation;
      const base={...(input.parameterIndex!==undefined?{parameterIndex:input.parameterIndex}:{}),...(input.source?{source:input.source}:{})};
      if(input.executionId||input.observationId){
        if(!producer||position(producer)>at||byExecution&&byObservation&&byExecution!==byObservation)
          return {...base,kind:'observation',availability:'unavailable',executionId:null,observationId:null};
        return {...base,kind:'observation',availability:producer===current?'internal':'recorded',executionId:producer.eventId,observationId:byObservation?input.observationId:null};
      }
      if(input.kind==='memory-range')return {...base,kind:'memory-range',objectId:input.objectId,offset:input.offset,size:input.size,targetLifetime:lifetime(input.objectId,at)};
      return {...base,kind:'immediate',value:input.value??null};
    }
    const edges=[];
    for(const [key,role]of [['dataInputs','value'],['addressInputs','address'],['controlInputs','control'],['calleeInputs','callee']])
      for(const id of current[key]??[]){const event=context.event(id);edges.push({role,executionId:event&&position(event)<=at?id:null,availability:event&&position(event)<=at?'recorded':'unavailable'});}
    view.operation={...eventRef(current),phase:current.phase??'complete',operator:current.operator??context.instruction(current.instructionId)?.operator??null,
      operands:(current.inputs??[]).map(operand),edges,resultExecutionId:complete(current)&&current.value!==undefined?current.eventId:null,
      steps:(current.steps??[]).map(s=>({observationIds:unique([s.observationId,...s.observationIds??[]].filter(Boolean)),nodeId:s.nodeId??null,
        operator:s.operator??null,operands:(s.inputs??[]).map(operand)}))};
    return structuredClone(view);
  }
  return Object.freeze({scope:context.scope,status:metadata.status,at});
}
