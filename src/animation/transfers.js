import {conditionForEvent,isConditionFlow} from './conditions.js';
import {inputForEffect} from './effects.js';
import {commandTimeline,timingProgress} from './timing.js';
import {isAttempt} from './faults.js';
import {addressOriginOf} from '../../scripts/shared/address-origin.mjs';

// Recorded reads/writes act on their target in place. Operand tokens remain
// internal provenance and never become visible transport stations.
export function valueEffectForEvent(event) {
  if (isAttempt(event)) return null;
  if (!event || !['READ', 'WRITE'].includes(event.kind)) return null;
  let target;
  if (event.target?.objectId) target = {kind: 'object', id: event.target.objectId, ...(event.target.offset ? {offset: event.target.offset} : {}),
    ...(['copy','fill','write.range','input'].includes(event.action) ? {size: event.target.size} : {})};
  else if (event.action === 'return.value') target = {kind: 'return-port', id: event.activationId};
  else if (event.action === 'input' || event.action === 'output') target = {kind: 'mat', id: `tool:${event.action}`};
  if (!target) return null;
  return {target, value: event.value, kind: event.kind};
}

export function calculationForEvent(recording, event) {
  if (event?.kind === 'CALC') return event;
  if (isConditionFlow(event)) return event;
  if (event?.kind !== 'WRITE') return null;
  return (event.inputs ?? []).map(input => recording?.events?.get(input.executionId)).find(source => source?.kind === 'CALC') ?? null;
}

function sourceEndpoint(recording, id, visited = new Set()) {
  if (visited.has(id)) return null;
  visited.add(id);
  const source = recording.events.get(id);
  if (!source) return null;
  if (source.kind === 'CALC') return {kind: 'device', id: 'alu'};
  if (source.action === 'return.value' || source.action === 'return') return {kind: 'return-port', id: source.activationId};
  if (source.action === 'resume') {
    // Return identities are explicit; equal numbers or variable names are
    // never evidence for a data-flow edge.
    const returned = recording.events.get(source.returnExecutionId);
    if (returned) return {kind: 'return-port', id: returned.activationId};
    const delivery = recording.trace.resultDeliveries?.find(delivery => delivery.resumeExecutionId === source.eventId);
    if (delivery?.sourceExecutionId && delivery.sourceExecutionId !== id) return sourceEndpoint(recording, delivery.sourceExecutionId, visited);
    const frameId = recording.calls?.get(source.callExecutionId)?.frameId;
    if(frameId)return {kind: 'return-port', id: frameId};
    if(inputForEffect(recording,source))return {kind:'mat',id:'tool:input'};
    // An opaque external call has no fictitious stack frame or local return
    // port. Its recorded result belongs to the existing tool workbench.
    return recording.calls.has(source.callExecutionId)?{kind:'mat',id:'tool:workbench'}:null;
  }
  if(source.kind==='READ'&&source.action==='input')return {kind:'mat',id:'tool:input'};
  const objectId = source.target?.objectId ?? (source.action === 'object.begin' ? source.objectId : null);
  return objectId ? {kind: 'object', id: objectId, ...(source.target?.offset ? {offset: source.target.offset} : {})} : null;
}

export function dataFlowForEvent(recording, event) {
  if(event?.action==='object.begin'&&event.copiedFrom?.size>0)return [{
    from:{kind:'object',id:event.copiedFrom.objectId,offset:event.copiedFrom.offset??0,size:event.copiedFrom.size},
    to:{kind:'object',id:event.objectId,offset:0,size:event.copiedFrom.size},role:'retained-storage'}];
  if (!event || !['CALC', 'WRITE'].includes(event.kind) && !isConditionFlow(event)) return [];
  const edges = [];
  const appendInputs = (task, to) => {
    for (const [inputIndex, input] of (task.inputs ?? []).entries()) {
      const address=addressOriginOf(input),ref=input.value?.reference,producer=recording.events.get(input.executionId),
        storageAddress=producer?.action==='object.begin'&&ref?.targetObjectId===producer.objectId;
      // Prefer an observed pointer slot/result when it supplies the base. For
      // &array[index]/&record.member the recorded identity anchors the address;
      // it does not mean the element's contents were read or copied.
      const bases=address?.dataInputs.map(id=>recording.events.get(id)).filter(e=>e?.value?.reference?.targetObjectId||e?.value?.cType?.kind==='pointer')??[];
      const base=address&&bases.length===1?sourceEndpoint(recording,bases[0].eventId):null;
      const from=address||storageAddress?base??
        (ref?.targetObjectId?{kind:'object',id:ref.targetObjectId,offset:ref.targetOffset??0}:null):sourceEndpoint(recording,input.executionId);
      if (from && (from.kind !== to.kind || from.id !== to.id || (from.offset ?? 0) !== (to.offset ?? 0))) edges.push({from, to, value: input.value, producerId: input.executionId, inputIndex,...(address||storageAddress?{role:'address-origin',addressSource:base?'pointer-base':'address-of'}:{})});
    }
  };
  // A consumer uses the completed result. It must not replay its producer's
  // input transfers alongside the outgoing result arrow.
  const completed = event.kind === 'FLOW' && (event.dataInputs ?? []).some(id => recording.events.get(id)?.kind === 'CALC');
  if (event.kind === 'CALC' || event.kind === 'FLOW' && !completed) appendInputs(event, {kind: 'device', id: 'alu'});
  if (event.kind === 'WRITE') {
    const target = valueEffectForEvent(event)?.target;
    if(target&&event.action==='copy'&&event.sourceObjectId) {
      edges.push({from:{kind:'object',id:event.sourceObjectId,offset:event.sourceOffset??0,size:event.sourceSize??event.target.size},to:target,role:'memory-range'});
    } else if(target&&inputForEffect(recording,event)) {
      edges.push({from:{kind:'mat',id:'tool:input'},to:target,role:'input'});
    } else if(target) {
      appendInputs(event,target);
      for(const range of event.readRegions??[])if(range.objectId&&range.size>0) {
        const existing=edges.find(edge=>edge.from.kind==='object'&&edge.from.id===range.objectId&&(edge.from.offset??0)===(range.offset??0));
        if(existing) {
          existing.from={...existing.from,size:Math.max(existing.from.size??0,range.size)};
          existing.role='observed-read';
        } else
          edges.push({from:{kind:'object',id:range.objectId,offset:range.offset??0,size:range.size},to:target,role:'observed-read'});
      }
    }
  }
  return edges;
}

const timelines=new WeakMap();
export function instructionTiming(recording,event) {
  if(!event)return commandTimeline(null,0,false);
  if(!timelines.has(recording))timelines.set(recording,new WeakMap());
  const cache=timelines.get(recording);if(cache.has(event))return cache.get(event);
  const completed=event.kind==='FLOW'&&(event.dataInputs??[]).some(id=>recording.events.get(id)?.kind==='CALC');
  const calculates=event.kind==='CALC'||isConditionFlow(event)&&!completed;
  const timing=commandTimeline(event,dataFlowForEvent(recording,event).length,calculates);
  cache.set(event,timing);return timing;
}

// Pure presentation phases within ONE existing IR event. No events, reads,
// values or execution order are added or changed. Seeking needs no history.
export function transferPresentation(recording, event, progress, {inspection = false} = {}) {
  const edges = dataFlowForEvent(recording, event);
  const timing=instructionTiming(recording,event);
  const position = Math.max(0, Math.min(1, progress));
  const elapsed=position*timing.duration;
  const phase=timing.phases.find(p=>elapsed>=p.start&&elapsed<p.end);
  const transfer=timing.transfers.find(t=>elapsed>=t.start&&elapsed<t.end);
  const active=!inspection&&transfer?{edge:edges[transfer.index],index:transfer.index,opacity:1,phase:phase.kind,
    progress:timingProgress(elapsed,{start:transfer.moveStart,end:transfer.arrival})}:null;
  const fade = 1-timingProgress(elapsed,timing.fade);
  const groupOpacity = inspection ? 1 : fade * fade * (3 - 2 * fade);
  const arrived = edges.map((edge, i) => elapsed>=timing.transfers[i].arrival);
  const calculation = calculationForEvent(recording, event);
  const values = calculation ? conditionForEvent(recording, event)?.inputValues ?? (calculation.inputs ?? []).map(input => input.value).filter(Boolean) : [];
  const used = new Set();
  const inputs = values.map(value => {
    // Preserve operand occurrences, including repeated reads of one object.
    const inputIndex = calculation.inputs?.findIndex((input, index) => !used.has(index) && input.value === value) ?? -1;
    used.add(inputIndex);
    const edgeIndex = edges.findIndex(edge => edge.to.kind === 'device' && edge.inputIndex === inputIndex);
    return {value, arrived: edgeIndex < 0 || arrived[edgeIndex]};
  });
  return {edges, active, inspection, groupOpacity, inputs, arrived: arrived.filter(Boolean).length, total: edges.length,
    phase:phase?.kind??'complete',elapsed,timing,cleanupProgress:timingProgress(elapsed,timing.fade),
    delivered: !edges.length || arrived.every(Boolean),valueReady:!isAttempt(event)&&elapsed>=timing.valueAt,effectReady:!isAttempt(event)&&elapsed>=timing.effectAt,
    resultReady:!isAttempt(event)&&elapsed>=timing.resultAt};
}
