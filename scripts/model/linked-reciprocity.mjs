// A role may be the inverse of a set of alternatives (a parent of either
// child), rather than the inverse of every field in that set simultaneously.
export function reciprocalIssues(edges,relations,{reached,isAlive,isTerminal}){
  const issues=[],seen=new Set();
  for(const relation of relations)for(const [fromFields,toFields]of [
    [relation.forwardFieldNodeIds,relation.backwardFieldNodeIds],
    [relation.backwardFieldNodeIds,relation.forwardFieldNodeIds],
  ])for(const edge of edges){
    if(!fromFields.includes(edge.fieldNodeId)||!edge.to||!reached.has(edge.from)||
      isTerminal(edge.from)||isTerminal(edge.to)||!isAlive(edge.from)||!isAlive(edge.to))continue;
    const back=edges.filter(e=>e.from===edge.to&&toFields.includes(e.fieldNodeId));
    if(back.some(e=>e.to===edge.from)||back.length<toFields.length||back.some(e=>['unknown','unresolved'].includes(e.status)))continue;
    const key=`${edge.from}:${edge.to}:${edge.fieldNodeId}:${toFields.join(',')}`;if(seen.has(key))continue;seen.add(key);
    issues.push({kind:'reciprocal-mismatch',from:edge.from,to:edge.to,fieldNodeId:edge.fieldNodeId,
      oppositeFieldNodeIds:toFields.slice(),...(toFields.length===1?{oppositeFieldNodeId:toFields[0]}:{}),
      actualTargets:back.map(e=>({fieldNodeId:e.fieldNodeId,to:e.to,status:e.status,lastWrite:e.lastWrite})),
      evidenceExecutionIds:[...new Set([edge.lastWrite,...back.map(e=>e.lastWrite)].filter(Boolean))],
      evidence:'observed target has no reverse edge in the supported opposite role set'});
  }
  return issues;
}

export function annotateReciprocalEpisodes(states,events){
  const active=new Map(),episodes=[],order=new Map(events.map((e,index)=>[e.eventId,index])),
    boundaries=events.filter(e=>e.kind==='FLOW'&&['return','resume'].includes(e.action));
  for(const state of states){
    const current=new Set();
    for(const issue of state.inconsistencies){
      const key=`${issue.from}:${issue.to}:${issue.fieldNodeId}:${issue.oppositeFieldNodeIds.join(',')}`;current.add(key);
      let episode=active.get(key);
      if(!episode){episode={id:`reciprocal-warning:${episodes.length+1}`,kind:issue.kind,from:issue.from,to:issue.to,
        fieldNodeId:issue.fieldNodeId,oppositeFieldNodeIds:issue.oppositeFieldNodeIds.slice(),firstExecutionId:state.afterExecutionId,
        lastExecutionId:state.afterExecutionId,status:'active',evidenceExecutionIds:[]};active.set(key,episode);episodes.push(episode);}
      episode.lastExecutionId=state.afterExecutionId;
      episode.evidenceExecutionIds=[...new Set([...episode.evidenceExecutionIds,...issue.evidenceExecutionIds])];
      issue.episodeId=episode.id;
    }
    for(const [key,episode]of active)if(!current.has(key)){
      const alive=state.activeMembers.includes(episode.from)&&state.activeMembers.includes(episode.to),
        back=state.edges.some(e=>e.from===episode.to&&episode.oppositeFieldNodeIds.includes(e.fieldNodeId)&&e.to===episode.from),
        forward=state.edges.find(e=>e.from===episode.from&&e.fieldNodeId===episode.fieldNodeId),
        repaired=alive&&(back||forward&&forward.to!==episode.to);
      episode.status=repaired?'transient-resolved':!state.rootAlive||!alive?'unresolved-at-end':'out-of-scope';
      episode.closedAtExecutionId=state.afterExecutionId;
      if(repaired)episode.resolvedAtExecutionId=state.afterExecutionId;
      active.delete(key);
    }
  }
  for(const episode of episodes){
    const first=order.get(episode.firstExecutionId),end=order.get(episode.closedAtExecutionId)??events.length;
    episode.observedAtBoundaryExecutionIds=boundaries.filter(e=>order.get(e.eventId)>=first&&order.get(e.eventId)<end).map(e=>e.eventId);
  }
  return episodes;
}
