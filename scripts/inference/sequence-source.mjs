// Normalize an existing relation for sequence evidence. This does not infer
// unvisited links or promote unknown integer slots to null pointers.
export function sequenceSource(source){
  if(source?.kind!=='record-index-graph-candidate')return source;
  return {...source,mode:'sparse-children',roleIds:source.relations.map(r=>r.id),
    states:source.states.map(state=>({...state,alive:state.active!==false,
      nodes:state.nodes.filter(n=>n.record).map(n=>({...n,range:n.record})),
      edges:state.edges.filter(e=>e.status==='observed'&&e.to).map(e=>({...e,roleId:e.relationId})),
      unresolvedEdges:state.edges.filter(e=>e.status!=='observed'&&e.status!=='observed-termination')}))};
}
