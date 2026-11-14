// Presentation adapter only. Ancestors supply storage identities/ranges at
// their paused event, never historical values or a second execution state.
export function createWorkContextQuery(trace,query,{callerLimit=32,cacheLimit=64}={}){
  const events=trace.events,order=new Map(),byFrame=new Map(),cache=new Map();
  events.forEach((e,index)=>{order.set(e.eventId,index);if(e.activationId){const list=byFrame.get(e.activationId)??[];list.push(index);byFrame.set(e.activationId,list);}});
  function callers(context,position){
    const stack=(context.calls?.stack??[]).filter(f=>f.role==='caller'),selected=stack.slice(-callerLimit),storage=[];
    for(const frame of selected){
      const indices=byFrame.get(frame.activationId)??[];let lo=0,hi=indices.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(indices[mid]<=position)lo=mid+1;else hi=mid;}
      if(!lo)continue;
      const id=events[indices[lo-1]].eventId;
      let item=cache.get(id);
      if(!item){const c=query.at(id);item={activationId:frame.activationId,throughExecutionId:id,storage:c.regions?.storage??[],unresolved:c.unresolved??[]};
        cache.set(id,item);while(cache.size>cacheLimit)cache.delete(cache.keys().next().value);}
      storage.push(item);
    }
    return {storage,omitted:Math.max(0,stack.length-selected.length)};
  }
  return {at(id){const position=order.get(id),before=query.before(id),after=query.at(id);
    return {before,after,callers:{before:callers(before,position-1),after:callers(after,position)}};
  }};
}
