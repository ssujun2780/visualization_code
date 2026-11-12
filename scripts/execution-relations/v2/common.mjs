import {sha256} from './sha256.mjs';
import {createRelationContext} from '../context.mjs';

export const complete=e=>!!e&&(!e.phase||e.phase==='complete');
export const unique=items=>[...new Set(items.filter(x=>x!==undefined&&x!==null))];
export const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'invalid-relation-evidence'});};
export function digest(value){
  const hash=sha256(),todo=[{value}],ancestors=new Set();
  while(todo.length){const item=todo.pop();if(item.text!==undefined){hash.update(item.text);if(item.exit)ancestors.delete(item.exit);continue;}
    const v=item.value;
    if(v&&typeof v==='object'){check(!ancestors.has(v),'분석 기록은 순환 없는 JSON 데이터여야 합니다.');ancestors.add(v);}
    if(Array.isArray(v)){hash.update('[');todo.push({text:']',exit:v});for(let i=v.length-1;i>=0;i--){todo.push({value:v[i]??null});if(i)todo.push({text:','});}}
    else if(v&&typeof v==='object'){const keys=Object.keys(v).filter(k=>v[k]!==undefined).sort();hash.update('{');todo.push({text:'}',exit:v});
      for(let i=keys.length-1;i>=0;i--){const k=keys[i];todo.push({value:v[k]},{text:':'},{text:JSON.stringify(k)});if(i)todo.push({text:','});}}
    else{check(v==null||['string','boolean','number'].includes(typeof v)&&!(typeof v==='number'&&!Number.isFinite(v)),'분석 기록에 JSON 이외의 값이 있습니다.');hash.update(JSON.stringify(v??null));}
  }
  return hash.digest('hex');
}
function frozenCopy(input){const copy=structuredClone(input),todo=[copy];while(todo.length){const v=todo.pop();if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const item of Object.values(v))todo.push(item);}}return copy;}
export const defaults=Object.freeze({maxEvents:1000000,maxRelations:500000,maxProvenanceEdges:2000000,maxOriginDepth:256,maxQueryItems:20000,maxDomainElements:10000,timeMs:25000});
export function limitsFor(input={}){check(input&&typeof input==='object','분석 예산은 객체여야 합니다.');const out={...defaults};
  for(const [key,value]of Object.entries(input)){check(key in defaults&&Number.isSafeInteger(value)&&value>0,`잘못된 분석 예산: ${key}`);out[key]=value;}return out;}
export function inputContext(plan,trace,options={}){
  const base=createRelationContext(plan,trace,{structureInference:options.structureInference});
  const compilerFacts=frozenCopy(options.compilerFacts??null),observationEvidence=frozenCopy(options.observationEvidence??null);
  for(const [name,data]of [['compilerFacts',compilerFacts],['observationEvidence',observationEvidence]])if(data){
    check(data.schemaVersion===1&&data.scope?.programId===base.scope.programId,`${name} 프로그램/스키마가 일치하지 않습니다.`);
    if(name==='observationEvidence')check(data.scope.runId===base.scope.runId,'보조 관찰에는 같은 실행 식별자가 필요합니다.');
    if(data.scope.runId!==undefined)check(data.scope.runId===base.scope.runId,`${name} 실행 식별자가 일치하지 않습니다.`);
    if(data.sourceDigest!==undefined)check(data.sourceDigest===digest(base.plan.sourceMap?.snapshot??base.plan.source),`${name} 소스 스냅샷이 일치하지 않습니다.`);
  }
  const positions=new Map(base.trace.events.map((e,i)=>[e.eventId,i])),observations=new Map(),observationOwners=new Map(),instructionNodes=new Set();
  const registerObservation=(id,spec)=>{const owners=observationOwners.get(id)??[];if(!owners.some(p=>p.event===spec.event&&p.step===spec.step))owners.push(spec);observationOwners.set(id,owners);if(!observations.has(id))observations.set(id,spec);};
  for(const i of base.plan.instructions){const todo=[i.expression];if(i.sourceNodeId)instructionNodes.add(i.sourceNodeId);
    while(todo.length){const n=todo.pop();if(!n)continue;if(n.nodeId)instructionNodes.add(n.nodeId);if(n.id)instructionNodes.add(n.id);for(const child of n.children??[])todo.push(child);}}
  for(const e of base.trace.events){let order=0;
    for(const id of e.observationIds??[])registerObservation(id,{event:e,order:order++});
    for(const s of e.steps??[])for(const id of unique([s.observationId,...s.observationIds??[]]))registerObservation(id,{event:e,step:s,order:order++});
  }
  if(observationEvidence)for(const binding of observationEvidence.bindings??[]){
    check(typeof binding.observationId==='string'&&base.event(binding.executionId),'보조 관찰의 정규 사건 대응이 없습니다.');
    const existing=observationOwners.get(binding.observationId);check(!existing||existing.some(o=>o.event.eventId===binding.executionId),'보조 관찰 대응이 충돌합니다.');
    check(binding.order===undefined||Number.isSafeInteger(binding.order)&&binding.order>=0,'보조 관찰 순서가 잘못되었습니다.');
    registerObservation(binding.observationId,{event:base.event(binding.executionId),order:binding.order??0});
  }
  const observationFor=(ref,atExecutionId)=>{const id=typeof ref==='string'?ref:ref?.observationId,explicit=typeof ref==='object'?ref.executionId:null,at=atExecutionId===undefined?Infinity:positions.get(atExecutionId),
      list=(observationOwners.get(id)??[]).filter(x=>(!explicit||x.event.eventId===explicit)&&positions.get(x.event.eventId)<=at),events=unique(list.map(x=>x.event.eventId));
    if(events.length!==1)return null;const steps=list.filter(x=>x.step);return steps.length===1?steps[0]:list.find(x=>!x.step)??(steps.length===1?steps[0]:null);};
  const resolveRef=(ref,atExecutionId)=>{
    const explicit=typeof ref==='string'?base.event(ref):ref&&base.event(ref.executionId),at=atExecutionId===undefined?Infinity:positions.get(atExecutionId);
    if(explicit){if(positions.get(explicit.eventId)>at)return null;
      if(typeof ref==='object'&&observationOwners.has(ref.observationId)&&!observationOwners.get(ref.observationId).some(x=>x.event===explicit))return null;return explicit;}
    return observationFor(ref,atExecutionId)?.event??null;
  };
  return Object.freeze({...base,compilerFacts,observationEvidence,positions,observations,observationOwners,observationFor,instructionNodes,resolveRef,limits:limitsFor(options.limits)});
}
export function snapshotOf(c){return {inputDigests:{plan:digest(c.plan),trace:digest(c.trace),structureInference:digest(c.structureInference??null),compilerFacts:digest(c.compilerFacts),observationEvidence:digest(c.observationEvidence)},
  eventCount:c.trace.events.length,lastExecutionId:c.trace.events.at(-1)?.eventId??null,recordingStatus:c.trace.status??null};}
export function storage(c,target,event,{historical=false}={}){
  const o=c.object(target?.objectId),p=c.position(event?.eventId);if(!o||p===undefined)return null;
  const start=c.position(o.createdBy),end=c.position(o.endedBy);
  if(start===undefined||start>p||!historical&&end!==undefined&&end<=p)return null;
  if(!Number.isSafeInteger(target.offset)||target.offset<0||!Number.isSafeInteger(target.size)||target.size<=0||target.offset+target.size>o.size)return null;
  return {kind:'storage',objectId:o.id,createdBy:o.createdBy,offset:target.offset,size:target.size};
}
export function port(event){if(event.target?.kind?.endsWith('-port'))return {...event.target,kind:'port',portKind:event.target.kind,executionId:event.eventId};
  if(['input','output'].includes(event.action))return {kind:'port',portKind:event.action,channel:event.channel??null,executionId:event.eventId};return null;}
export function union(rows){const out=[];for(const r of rows.map(({offset,size})=>({offset,size})).sort((a,b)=>a.offset-b.offset)){
  const prev=out.at(-1);if(prev&&r.offset<=prev.offset+prev.size)prev.size=Math.max(prev.offset+prev.size,r.offset+r.size)-prev.offset;else out.push(r);}return out;}
// Mutable only inside a query's private accumulator. Returned views are detached.
export function addRange(rows,range){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].offset+rows[mid].size<range.offset)lo=mid+1;else hi=mid;}
  const start=lo;let offset=range.offset,end=range.offset+range.size;while(lo<rows.length&&rows[lo].offset<=end){offset=Math.min(offset,rows[lo].offset);end=Math.max(end,rows[lo].offset+rows[lo].size);lo++;}
  rows.splice(start,lo-start,{offset,size:end-offset});return rows;}
export function overlapBounds(rows,range){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].offset+rows[mid].size<=range.offset)lo=mid+1;else hi=mid;}
  let end=lo;while(end<rows.length&&rows[end].offset<range.offset+range.size)end++;return [lo,end];}
export function intersects(a,b){return a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;}
export function identity(c,id,at){const o=c.object(id),p=at===null?-1:c.position(at);if(!o||p===undefined)return null;
  const begin=c.position(o.createdBy),end=c.position(o.endedBy);if(begin===undefined||begin>p)return null;
  return {objectId:id,createdBy:o.createdBy,storage:o.storage??null,frameId:o.frameId??null,declarationId:o.declarationId??null,createdInActivationId:c.event(o.createdBy)?.activationId??null,size:o.size,
    lifetime:end!==undefined&&end<=p?'ended':'live',...(end!==undefined&&end<=p?{endedBy:o.endedBy}:{})};}
export function output(c){return {schemaVersion:2,scope:{...c.scope},snapshot:snapshotOf(c),status:'completed',capabilities:{},relations:[],changes:[],provenance:{nodes:[],edges:[]},coverage:{eventCount:c.trace.events.length,analyzedEventCount:0,stagePrefixes:{},truncated:[]},diagnostics:[]};}
export function collector(c,result){const start=Date.now(),seen=new Set(),reported=new Set();let counter=0,expired=false;
  const issue=(code,details={})=>{const key=JSON.stringify([code,details]);if(reported.has(key))return;reported.add(key);if(result.diagnostics.length>=c.limits.maxQueryItems){result.coverage.omittedDiagnosticCount=(result.coverage.omittedDiagnosticCount??0)+1;return;}result.diagnostics.push({code,stage:'execution-relations',...details});};
  const truncate=(reason,at)=>{result.status='partial';if(!result.coverage.truncated.includes(reason))result.coverage.truncated.push(reason);issue('analysis-budget-exceeded',{reason,atExecutionId:at??null});};
  return {issue,truncate,progress(stage,event){result.coverage.stagePrefixes[stage]=event.eventId;},get expired(){return expired;},tick(at){if(expired)return false;if(++counter%128===0&&Date.now()-start>c.limits.timeMs){truncate('timeMs',at);expired=true;return false;}return true;},
    relation(kind,event,participants=[],details={},evidence=[event.eventId],extra={}){
      if(result.relations.length>=c.limits.maxRelations){truncate('maxRelations',event.eventId);return null;}
      // IDs depend on this fact, never on the number of future facts in another pass.
      const id=extra.id??`r:${kind}:${event.eventId}:${digest({participants,details,extra}).slice(0,24)}`;check(!seen.has(id),'관계 식별자가 중복되었습니다.');seen.add(id);
      const relation=structuredClone({id,kind,status:'supported',availableAtExecutionId:event.eventId,activationIds:unique([event.activationId]),workScopeIds:[],participants,
        evidence:{executionIds:unique(evidence),planNodeIds:[],relationIds:[]},details,...extra});result.relations.push(relation);return relation;
    }};
}
