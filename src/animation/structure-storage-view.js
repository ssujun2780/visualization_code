import {queryStorageReferences} from '../../scripts/inference/storage-relations.mjs';

// Only compiler range containment is indexed. Discovery, retirement, role
// filtering and reachability are still taken from each requested snapshot.
function containmentIndex(graph){
  const records=new Map(),prefixEnds=new Map(),candidates=new Map();
  for(const n of graph.nodes)if(n.kind==='record'){const list=records.get(n.range.objectId)??[];list.push(n);records.set(n.range.objectId,list);}
  for(const list of records.values()){list.sort((a,b)=>a.range.offset-b.range.offset);let end=0;for(const n of list){end=Math.max(end,n.range.offset+n.range.size);prefixEnds.set(n.id,end);}}
  for(const n of graph.nodes){
    const list=records.get(n.range.objectId)??[],containers=[];let lo=0,hi=list.length;
    if(n.kind==='storage-range'){while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid].range.offset<=n.range.offset)lo=mid+1;else hi=mid;}
      for(let i=lo-1;i>=0&&prefixEnds.get(list[i].id)>=n.range.offset+n.range.size;i--)if(list[i].range.offset+list[i].range.size>=n.range.offset+n.range.size)containers.push(list[i]);containers.sort((a,b)=>a.range.size-b.range.size);}
    candidates.set(n.id,containers);
  }
  return candidates;
}
export function createStorageReferenceView(){
  // Explicit immutable query session: one range index per graph, not a cache
  // of every temporal snapshot/root combination.
  const graphs=new WeakMap();
  return (graph,trace,target,at,roleIds)=>{
    let query=graphs.get(graph);if(!query){query=scopedQueries(graph);graphs.set(graph,query);}
    const selected=query(target);
    return storageReferenceView(selected.graph,trace,target,at,roleIds,selected.index);
  };
}
function scopedQueries(graph){
  const byNode=new Map(graph.nodes.map(n=>[n.id,n.range.objectId])),outgoing=new Map(),queries=new Map();
  for(const c of graph.changes)for(const e of c.upsertEdges){
    const from=byNode.get(e.from)??e.source?.objectId,to=byNode.get(e.to)??e.target?.objectId;
    if(from&&to){if(!outgoing.has(from))outgoing.set(from,new Set());outgoing.get(from).add(to);}
  }
  return target=>{
    const all=target.structureId===graph.id,roots=[...new Set([target.objectId,...target.objectIds??[],...(target.ranges??[]).map(r=>r.objectId)].filter(Boolean))].sort(),key=all?'*':JSON.stringify(roots);
    let query=queries.get(key);if(query)return query;
    const objects=new Set(roots);
    // The union only overestimates which storage may be reachable. Actual
    // edges/discovery/endings are still queried at the requested event.
    for(const id of objects)for(const to of outgoing.get(id)??[])objects.add(to);
    const scoped=all?graph:{...graph,nodes:graph.nodes.filter(n=>objects.has(n.range.objectId)),changes:graph.changes.map(c=>({...c,
      upsertEdges:c.upsertEdges.filter(e=>objects.has(byNode.get(e.from)??e.source?.objectId)),
      endedObjectIds:c.endedObjectIds.filter(id=>objects.has(id))})).filter(c=>c.upsertEdges.length||c.endedObjectIds.length)};
    query={graph:scoped,index:containmentIndex(scoped)};queries.set(key,query);
    // Root selections can be arbitrary UI ranges; do not retain unbounded
    // derived histories. Eviction changes cost only, never query semantics.
    if(queries.size>64)queries.delete(queries.keys().next().value);
    return query;
  };
}
// Display containment, not new data-structure inference: a recorded field port
// belongs inside its unique recorded containing struct. Preserve edge IDs.
export function storageReferenceView(graph,trace,target,at,roleIds,index=containmentIndex(graph)){
  const snapshot=queryStorageReferences(graph,trace,{afterExecutionId:at,roleIds,view:'graph',resolvePresentation:false,includeTopology:false}),byId=new Map(snapshot.nodes.map(n=>[n.id,n])),owner=new Map();
  for(const n of snapshot.nodes){
    const containers=(index.get(n.id)??[]).filter(r=>byId.has(r.id));
    owner.set(n.id,n.kind==='storage-range'&&containers.length&&(containers.length===1||containers[0].range.size<containers[1].range.size)?containers[0].id:n.id);
  }
  const ids=new Set(owner.values()),nodes=[...ids].map(id=>byId.get(id)),objectIds=new Set([target.objectId,...target.objectIds??[]].filter(Boolean)),ranges=target.ranges??[],
    seeds=nodes.filter(n=>objectIds.has(n.range.objectId)||ranges.some(r=>r.objectId===n.range.objectId&&r.offset<n.range.offset+n.range.size&&n.range.offset<r.offset+r.size));
  if(target.structureId===graph.id)seeds.push(...nodes);
  const mapped=snapshot.edges.map(e=>({...e,from:owner.get(e.from)??e.from,to:owner.get(e.to)??e.to})),selected=new Set(seeds.map(n=>n.id)),pending=[...selected],outgoing=new Map();
  for(const e of mapped){const list=outgoing.get(e.from)??[];list.push(e);outgoing.set(e.from,list);}
  for(let i=0;i<pending.length;i++)for(const e of outgoing.get(pending[i])??[])if(e.status==='in-bounds'&&ids.has(e.to)&&!selected.has(e.to)){selected.add(e.to);pending.push(e.to);}
  if(!selected.size)return null;
  const edges=mapped.filter(e=>selected.has(e.from)&&selected.has(e.to)&&e.status==='in-bounds'),incoming=new Set(edges.map(e=>e.to));
  return {id:graph.id,sourceStructureId:graph.id,selectedCandidateId:graph.id,sourceKind:graph.kind,afterExecutionId:at,alive:true,complete:false,historyGap:false,
    nodes:nodes.filter(n=>selected.has(n.id)).map(n=>({id:n.id,range:{...n.range}})),edges:edges.map(e=>({id:e.id,from:e.from,to:e.to,roleId:e.roleId,storedEdgeIds:[e.id]})),
    terminals:mapped.filter(e=>selected.has(e.from)&&e.status!=='in-bounds').map(e=>({from:e.from,to:e.to,kind:e.status==='null'?'null':e.status,roleId:e.roleId})),rootNodeIds:[...selected].filter(id=>!incoming.has(id)),roleIds:[...new Set(edges.map(e=>e.roleId))]};
}
