// Temporal interchange for consumers. Coalesce only equal identities/ranges;
// shared nodes keep independent bindings for every structure and role.
export function buildStructureStorageBindings(trace,structures){
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),objects=new Map(trace.objects.map(o=>[o.id,o])),result=[];
 for(const s of structures){const active=new Map(),gap=s.coverage?.historyGapFromExecutionId,
   states=[...s.states??[],...[gap,...(s.coverage?.historyGaps??[]).map(g=>g.fromExecutionId)].filter(Boolean).map(id=>({afterExecutionId:id,historyGap:true}))].sort((a,b)=>pos.get(a.afterExecutionId??a.executionId)-pos.get(b.afterExecutionId??b.executionId));
  for(const state of states){const id=state.afterExecutionId??state.executionId,at=pos.get(id);if(at===undefined)continue;
   const ids=state.topology?.reachableNodeIds??state.memberNodeIds,
    array=structures.find(a=>a.id===(s.arrayId??s.containerId)&&a.kind==='array'),
    indices=state.ringOrder?.indices??(state.logicalOrder?Array.from({length:state.logicalOrder.length},(_,i)=>state.logicalOrder.start+i*(state.logicalOrder.stride??1)):[]),
    ordered=array?indices.filter(i=>Number.isSafeInteger(i)&&i>=0&&i<array.capacity).map(index=>({id:`${s.id}:element:${index}`,range:{objectId:array.objectId,offset:array.range.offset+index*array.elementBytes,size:array.elementBytes}})):[],
    pool=state.nodes??state.entries??(ids?(s.logicalNodes??[]).filter(n=>ids.includes(n.id)):ordered),current=new Map();
   if(!state.historyGap&&state.alive!==false&&state.active!==false&&state.rootAlive!==false&&state.storageAlive!==false&&state.status!=='ended')for(const n of pool){
    const ranges=[n.range??n.record??(n.objectId?{objectId:n.objectId,offset:n.offset,size:n.size}:null),...(n.parts??[]).map(p=>p.range)].filter(Boolean),elementId=n.id??(Number.isSafeInteger(n.index)?`${s.id}:element:${n.index}`:null);
    for(const r of ranges){const o=objects.get(r.objectId);if(!elementId||!o||pos.get(o.createdBy)>at||pos.get(o.endedBy)<=at||!Number.isSafeInteger(r.offset)||!Number.isSafeInteger(r.size)||r.offset<0||r.size<=0||r.offset+r.size>o.size)continue;
     const k=JSON.stringify([elementId,r.objectId,r.offset,r.size]);current.set(k,{...r,structureId:s.id,elementId,availableAtExecutionId:id,invalidatedAtExecutionId:o.endedBy??null});
    }
   }
   for(const [k,b]of active)if(!current.has(k)){if(!b.invalidatedAtExecutionId||at<pos.get(b.invalidatedAtExecutionId))b.invalidatedAtExecutionId=id;active.delete(k);}
   for(const [k,b]of current)if(!active.has(k)){active.set(k,b);result.push(b);}
  }
 }
 return result;
}
