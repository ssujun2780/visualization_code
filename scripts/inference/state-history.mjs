// Bounded full snapshots: retain a prefix and the newest snapshot. Missing
// intermediate states are intervals, not a property of the newest snapshot.
export function stateHistoryCoverage(maxStates){
  if(!Number.isSafeInteger(maxStates)||maxStates<1)throw new RangeError('상태 기록 한도는 양의 정수여야 합니다.');
  return {maxStates,omittedStates:0,historyGapFromExecutionId:null};
}
export function appendStateSnapshot(states,snapshot,coverage){
  coverage.firstStateExecutionId??=snapshot.afterExecutionId??snapshot.executionId;
  const id=snapshot.afterExecutionId??snapshot.executionId,previous=states.at(-1);
  if(previous&&(previous.afterExecutionId??previous.executionId)===id){states[states.length-1]=snapshot;return;}
  if(states.length<coverage.maxStates){states.push(snapshot);return;}
  coverage.historyGapFromExecutionId??=states.at(-1).afterExecutionId??states.at(-1).executionId;
  coverage.omittedStates++;
  states[states.length-1]=snapshot;
}
export function stateHistoryGapAt(candidate,positions,at){
  const start=positions.get(candidate.coverage?.historyGapFromExecutionId),
    end=positions.get(candidate.states?.at(-1)?.afterExecutionId??candidate.states?.at(-1)?.executionId);
  if(start!==undefined&&end!==undefined&&at>=start&&at<end)return true;
  if(candidate.coverage?.historyGaps?.some(g=>positions.get(g.fromExecutionId)<=at&&at<(positions.get(g.toExecutionId)??Infinity)))return true;
  // Legacy results stopped recording without an explicit interval.
  return !Object.hasOwn(candidate.coverage??{},'historyGapFromExecutionId')&&
    !!(candidate.coverage?.omittedStates||candidate.coverage?.truncated)&&end!==undefined&&at>end;
}
export function structureStateAt(candidate,positions,at,objects=[]){
  const state=candidate.states?.findLast(s=>positions.has(s.afterExecutionId??s.executionId)&&positions.get(s.afterExecutionId??s.executionId)<=at)??null;
  if(!state)return null;
  const gap=state.historyGap||stateHistoryGapAt(candidate,positions,at);
  const evidenceGap=Object.entries(state).some(([k,v])=>/^omitted/.test(k)&&typeof v==='number'&&v>0);
  const anchored=[candidate.root?.objectId,candidate.range?.objectId,candidate.objectId].filter(Boolean),
    ended=objects.filter(o=>positions.get(o.endedBy)<=at&&positions.get(o.endedBy)>positions.get(state.afterExecutionId??state.executionId)),
    rootEnded=ended.some(o=>anchored.includes(o.id)),
    members=new Set((state.nodes??state.entries??[]).flatMap(n=>[n.range?.objectId,n.record?.objectId,n.objectId,...(n.parts??[]).map(p=>p.range?.objectId)])),
    memberEnded=ended.filter(o=>members.has(o.id));
  if(rootEnded)return {...state,alive:false,active:false,rootAlive:false,storageAlive:false,status:'ended',historyGap:!!gap};
  if(gap||evidenceGap||memberEnded.length)return {...state,status:'incomplete',historyGap:!!gap,...(evidenceGap?{evidenceGap:true}:{}),...(memberEnded.length?{lifetimeGap:true,endedObjectIds:memberEnded.map(o=>o.id)}:{})};
  return state;
}
export function appendCandidateState(candidate,snapshot,maxStates=2048){
  candidate.coverage??=stateHistoryCoverage(maxStates);
  appendStateSnapshot(candidate.states,snapshot,candidate.coverage);
}
// Also bounds stateful adapters that do not need a streaming collector.
export function boundStructureHistory(candidate,maxStates=2048){
  if(!candidate.states?.length)return candidate;
  const limit=Math.min(maxStates,candidate.coverage?.maxStates??maxStates);
  if(candidate.states.length<=limit)return candidate;
  const coverage={...candidate.coverage,...stateHistoryCoverage(limit)},states=[];
  for(const state of candidate.states)appendStateSnapshot(states,state,coverage);
  coverage.omittedStates+=candidate.coverage?.omittedStates??0;
  coverage.firstStateExecutionId=candidate.coverage?.firstStateExecutionId??coverage.firstStateExecutionId;
  return {...candidate,states,coverage};
}
export function validateStateHistory(candidate,positions){
  const c=candidate.coverage;
  // Older stored overlays have no interval metadata; keep their schema valid.
  if(!c||!Object.hasOwn(c,'historyGapFromExecutionId'))return;
  const states=candidate.states,from=positions.get(c.historyGapFromExecutionId),last=positions.get(states.at(-1)?.afterExecutionId??states.at(-1)?.executionId);
  if(!Number.isSafeInteger(c.maxStates)||c.maxStates<1||states.length>c.maxStates||
     !Number.isSafeInteger(c.omittedStates)||c.omittedStates<0||
     (c.omittedStates===0?c.historyGapFromExecutionId!==null:
       states.length!==c.maxStates||from===undefined||last===undefined||from>=last||
       states.slice(0,-1).some(s=>positions.get(s.afterExecutionId??s.executionId)>=from)))
    throw new Error('추론 상태 이력의 생략 구간 또는 기록 한도가 올바르지 않습니다.');
  for(const g of c.historyGaps??[])if(!positions.has(g.fromExecutionId)||g.toExecutionId!==null&&(!positions.has(g.toExecutionId)||positions.get(g.toExecutionId)<=positions.get(g.fromExecutionId)))
    throw new Error('추론 상태 이력의 생략 구간이 올바르지 않습니다.');
}
