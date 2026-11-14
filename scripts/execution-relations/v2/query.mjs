import {inputContext,complete,identity,addRange,unique} from './common.mjs';
import {validateV2} from './result.mjs';
import {originsOf} from './provenance.mjs';
import {frameTree} from './regions.mjs';

function upperBound(rows,position,key){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(key(rows[mid])<=position)lo=mid+1;else hi=mid;}return lo;}
function append(map,key,value){const list=map.get(key)??[];list.push(value);map.set(key,list);}
export function createV2Query(plan,trace,result,options={}){
  const c=inputContext(plan,trace,options),metadata=structuredClone(result);validateV2(c,metadata,{verifyOptional:['compilerFacts','structureInference','observationEvidence'].some(k=>options[k]!==undefined)});
  const pos=id=>id===null?-1:c.position(id),rp=r=>pos(r.availableAtExecutionId),byExecution=new Map(),byActivation=new Map(),byObject=new Map(),
    rows=[...metadata.relations].sort((a,b)=>rp(a)-rp(b)),nodes=new Map(metadata.provenance.nodes.map(n=>[n.id,n])),incoming=new Map(),
    tree=frameTree(c,c.trace.events),scopesByFrame=new Map(),ends=new Map(),boundsByFrame=new Map(),changesByRelation=new Map(),objectObservations=new Map(),objectsByFrame=new Map();
  const position=id=>{const p=pos(id);if(p===undefined)throw new RangeError('조회 시점이 실행 기록에 없습니다.');return p;};
  for(const r of rows){append(byExecution,r.availableAtExecutionId,r);for(const id of r.activationIds)append(byActivation,id,r);for(const id of unique(r.participants.map(p=>p.objectId)))append(byObject,id,r);
    if(r.kind==='work-scope-end')ends.set(r.details.workScopeId,rp(r));
    if(r.kind==='bounded-domain')for(const id of r.activationIds)append(boundsByFrame,id,r);
  }
  for(const r of rows)if(r.kind==='work-scope'){
    const frame=r.details.activationId,groups=scopesByFrame.get(frame)??new Map(),key=`${r.details.kind}:${r.details.regionId??''}`;append(groups,key,r);scopesByFrame.set(frame,groups);
  }
  for(const change of metadata.changes)append(changesByRelation,change.relationId,change);
  for(const list of changesByRelation.values())list.sort((a,b)=>pos(a.atExecutionId)-pos(b.atExecutionId));
  for(const edge of metadata.provenance.edges)append(incoming,edge.to,edge);
  const accesses=rows.filter(r=>r.kind==='storage-access'),regionCache=new Map(),residentAt=[],active=new Set(),stack=[];
  for(const object of c.trace.objects)append(objectsByFrame,object.frameId,object);
  for(const e of c.trace.events){if(complete(e)){
    if(e.action==='frame.begin'){active.add(e.activationId);stack.push(e.activationId);}
    if(e.action==='frame.end')active.delete(e.activationId);
    if(e.target?.objectId&&['READ','WRITE'].includes(e.kind))append(objectObservations,e.target.objectId,e);
  }while(stack.length&&!active.has(stack.at(-1)))stack.pop();residentAt.push(stack.at(-1)??null);}
  function alive(frame,p){const f=tree.frames.get(frame);return !!f&&pos(f.begin)<=p&&(!f.end||pos(f.end)>p);}
  function path(frame,p){const out=[],seen=new Set();while(frame&&!seen.has(frame)){seen.add(frame);if(alive(frame,p))out.push(frame);frame=tree.frames.get(frame)?.parent;}return out.reverse();}
  function observed(frame,p){
    if(!frame)return {complete:true,storage:[],counts:{read:0,write:0}};
    let state=regionCache.get(frame);if(!state||state.position>p)state={position:-1,cursor:upperBound(accesses,pos(tree.frames.get(frame).begin)-1,rp),objects:new Map(),counts:{read:0,write:0}};
    let inspected=0,truncated=false;
    // Cache deltas only for the requested scope; other frames do not receive event copies.
    while(state.cursor<accesses.length&&rp(accesses[state.cursor])<=p){if(++inspected>c.limits.maxQueryItems){truncated=true;break;}const r=accesses[state.cursor++];
      if(!tree.descendant(r.activationIds[0],frame))continue;const target=r.participants[0],entry=state.objects.get(target.objectId)??{objectId:target.objectId,readRanges:[],writeRanges:[],directReadRanges:[],directWriteRanges:[],accessCount:0};
      const mode=r.details.mode,key=mode==='read'?'readRanges':'writeRanges',direct=mode==='read'?'directReadRanges':'directWriteRanges';addRange(entry[key],target);if(r.activationIds[0]===frame)addRange(entry[direct],target);entry.accessCount++;state.counts[mode]++;state.objects.set(target.objectId,entry);
    }
    state.position=p;if(!truncated)regionCache.set(frame,state);else regionCache.delete(frame);
    return {complete:!truncated,storage:[...state.objects.values()],counts:state.counts};
  }
  function lastObservation(objectId,p){const list=objectObservations.get(objectId)??[];return list[upperBound(list,p,e=>pos(e.eventId))-1];}
  function reference(e,role,at){const ref=e?.value?.reference;if(!ref)return null;return {role,slotObjectId:e.target?.objectId??null,observationExecutionId:e.eventId,objectId:ref.targetObjectId??null,offset:ref.targetOffset??null,onePast:ref.onePast===true,
    targetLifetime:identity(c,ref.targetObjectId,at)?.lifetime??'unavailable',extent:'reference-only'};}
  function at(id){
    const p=position(id),current=p>=0?c.event(id):null,owner=current?.activationId,liveOwner=alive(owner,p)?owner:residentAt[p]??null,
      livePath=unique([...path(liveOwner,p),...path(residentAt[p],p)]),unresolved=[],workScopes=[],locals=[],references=[];
    for(const frame of livePath)for(const group of scopesByFrame.get(frame)?.values()??[]){const index=upperBound(group,p,rp)-1,r=group[index];if(r&&(ends.get(r.details.id)??Infinity)>p)workScopes.push({...r.details,role:frame===liveOwner?'current':tree.descendant(frame,liveOwner)?'resident-callee':'caller'});}
    const observation=observed(liveOwner,p),regionStorage=observation.storage.map(s=>({...s,...identity(c,s.objectId,id)}));if(!observation.complete)unresolved.push('query-budget');
    const operationRelations=byExecution.get(id)??[],participants=[];
    for(const r of operationRelations)for(const target of r.participants){const info=target.objectId?identity(c,target.objectId,id):null;participants.push({...target,...(info?{storageIdentity:info}:{})});}
    const operands=[];for(const edge of incoming.get(`v:${id}`)??[]){const node=nodes.get(edge.from);if(node&&pos(node.executionId)<=p){operands.push({role:edge.role,path:edge.path,valueRef:{executionId:node.executionId,...(node.observationIds?.length?{observationId:node.observationIds[0]}:{})},provenanceId:node.id});
      const ref=reference(c.event(node.executionId),'operand',id);if(ref)references.push(ref);}}
    for(const object of objectsByFrame.get(liveOwner)??[]){const info=identity(c,object.id,id);if(info?.lifetime!=='live')continue;const last=lastObservation(object.id,p);
      locals.push({...info,name:object.name??null,typeId:object.cType?.id??null,latestObservation:last?{executionId:last.eventId,target:last.target}:null});
      if(last?.target.offset===0&&last.target.size===object.size){const ref=reference(last,'binding',id);if(ref)references.push(ref);}}
    const bounds=[];for(const frame of livePath)for(const r of boundsByFrame.get(frame)??[]){if(rp(r)>p)break;const changes=changesByRelation.get(r.id)??[],index=upperBound(changes,p,x=>pos(x.atExecutionId))-1;if(changes[index]?.action==='activate')bounds.push(r);}
    const history=new Set(),historyCandidates=new Set();let inspected=0,historyTruncated=false;
    const includeHistory=list=>{const stop=upperBound(list,p,rp);for(let i=stop-1;i>=0;i--){if(++inspected>c.limits.maxQueryItems){historyTruncated=true;break;}historyCandidates.add(list[i]);}};
    for(const frame of livePath){includeHistory(byActivation.get(frame)??[]);if(historyTruncated)break;}
    if(!historyTruncated)for(const objectId of unique([...regionStorage.map(s=>s.objectId),...participants.map(s=>s.objectId)])){includeHistory(byObject.get(objectId)??[]);if(historyTruncated)break;}
    for(const r of historyCandidates)if(r.activationIds.some(f=>tree.frames.get(f)?.end&&pos(tree.frames.get(f).end)<=p)||r.participants.some(t=>t.objectId&&identity(c,t.objectId,id)?.lifetime==='ended'))history.add(r.id);
    if(historyTruncated)unresolved.push('history-query-budget');
    const analyzed=pos(metadata.coverage.analyzedThroughExecutionId);if(p>=0&&(analyzed===undefined||p>analyzed))unresolved.push('outside-analyzed-prefix');
    for(const feature of ['accesses','provenance','work']){const prefix=pos(metadata.coverage.stagePrefixes?.[feature]);if(p>=0&&(prefix===undefined||prefix<p))unresolved.push(`${feature}-outside-analyzed-prefix`);}
    unresolved.push(...nodes.get(`v:${id}`)?.unresolved??[]);
    const outputTruncated=metadata.coverage.truncated?.includes('maxRelations')===true;if(outputTruncated)unresolved.push('analysis-output-truncated');
    return structuredClone({schemaVersion:2,scope:c.scope,analysisStatus:metadata.status,executionId:id,
      phase:p<0?'before-start':current.kind==='ERROR'||current.phase==='failed'?'fault':liveOwner?'active':'no-active-frame',
      operation:current?{executionId:id,instructionId:current.instructionId,activationId:owner??null,kind:current.kind,action:current.action,phase:current.phase??'complete',source:c.instruction(current.instructionId)?.source??null,operands}:null,
      calls:{currentActivationId:liveOwner,stack:livePath.map(f=>({activationId:f,parentActivationId:c.frame(f)?.parent??null,functionId:c.frame(f)?.functionId??null,role:f===liveOwner?'current':tree.descendant(f,liveOwner)?'resident-callee':'caller'}))},
      workScopes,locals,references,participants,regions:{basis:'observed-access',extent:current?.kind==='ERROR'?'interrupted':'observed-prefix',complete:observation.complete&&!outputTruncated&&pos(metadata.coverage.stagePrefixes?.accesses)>=p,storage:regionStorage,counts:observation.counts,boundedDomains:bounds},
      transfers:operationRelations.filter(r=>['value-transfer','value-dependency','storage-copy'].includes(r.kind)),structureBindings:operationRelations.filter(r=>r.kind==='structure-access'),
      relations:{operationIds:operationRelations.map(r=>r.id),contextIds:bounds.map(r=>r.id)},historyRefs:[...history],unresolved:unique(unresolved)});
  }
  return Object.freeze({scope:Object.freeze({...c.scope}),status:metadata.status,at,before(id){const p=position(id);return at(p<=0?null:c.trace.events[p-1].eventId);},
    history(id){const p=position(id),stop=upperBound(rows,p,rp);return structuredClone(rows.slice(0,stop));},
    origins(valueRef,{atExecutionId,limit,depth,roles}={}){if(atExecutionId===undefined)throw new TypeError('출처 조회에는 atExecutionId가 필요합니다.');return originsOf(c,{byId:nodes,incoming},valueRef,atExecutionId,{limit,depth,roles});}});
}
