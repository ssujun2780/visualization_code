// A role may be the inverse of a set of alternatives (a parent of either
// child), rather than the inverse of every field in that set simultaneously.
export function supportedReciprocalRelations(candidate,relations,links,options){
  const {observedRoles,groups,rootAlive,eventId}=options;
  candidate.reciprocalWitnesses??=new Set();candidate.reciprocalContracts??=new Map();
  const pairKey=(e,back)=>`${e.from}:${e.to}:${e.fieldNodeId}:${back}`;
  const confirmed=[];
  for(const r of relations){
    const all=[...r.forwardFieldNodeIds,...r.backwardFieldNodeIds],key=JSON.stringify([r.forwardFieldNodeIds,r.backwardFieldNodeIds]);
    const selected=links.filter(e=>all.includes(e.fieldNodeId)&&e.to&&e.from!==e.to&&options.isAlive(e.from)&&options.isAlive(e.to)&&!options.isTerminal(e.from)&&!options.isTerminal(e.to));
    const forward=new Set(r.forwardFieldNodeIds),opposite=e=>forward.has(e.fieldNodeId)?r.backwardFieldNodeIds:r.forwardFieldNodeIds;
    const missing=selected.filter(e=>!links.some(b=>b.from===e.to&&b.to===e.from&&opposite(e).includes(b.fieldNodeId)));
    // A coincidental pair nominates a relation, not a container invariant.
    const observed=all.every(id=>observedRoles.has(id));
    if(rootAlive&&observed&&selected.length&&!missing.length)
      candidate.reciprocalContracts.set(key,{...r,establishedAtExecutionId:eventId});
    const contract=candidate.reciprocalContracts.get(key);
    if(contract)confirmed.push(contract);
    else if(observed&&all.length===2&&all.every(id=>groups.some(g=>g.fieldNodeIds.length===1&&g.fieldNodeIds[0]===id))&&
      missing.some(e=>opposite(e).some(id=>candidate.reciprocalWitnesses.has(pairKey(e,id)))))
      confirmed.push({...r,evidence:'previously reciprocal links in independently traversed directions'});
    for(const e of selected)for(const id of opposite(e))if(links.some(b=>b.from===e.to&&b.to===e.from&&b.fieldNodeId===id))
      candidate.reciprocalWitnesses.add(pairKey(e,id));
  }
  return confirmed;
}

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
