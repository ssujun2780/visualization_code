// Directed reachability is evaluated against one observed memory state. This
// classifies topology only; it does not infer search ordering or an algorithm.
export function rootedConnectivity(start,{nodes,roles,relation,isAlive,rootStatus='unknown',isTerminal=()=>false,includeRootBoundary=false}){
  const reached=new Set(),ended=new Set(),edges=[],unknown=[],terminalNodes=new Set(),rootTerminal=!!start&&!!nodes.get(start)&&isAlive(nodes.get(start))&&isTerminal(nodes.get(start));
  if(rootTerminal)terminalNodes.add(start);
  const queue=start&&(!rootTerminal||includeRootBoundary)?[start]:[];
  for(let index=0;index<queue.length;index++){
    const id=queue[index];if(reached.has(id)||ended.has(id))continue;
    const node=nodes.get(id);if(!node){unknown.push({from:id,status:'unresolved-node'});continue;}
    if(!isAlive(node)){ended.add(id);continue;}reached.add(id);
    for(const role of roles){
      const edge=relation(node,role);
      if(!edge){unknown.push({from:id,fieldNodeId:role.fieldNodeId,status:'unobserved-slot'});continue;}
      if(edge.to&&isTerminal(nodes.get(edge.to))&&isAlive(nodes.get(edge.to))){
        terminalNodes.add(edge.to);edges.push({...edge,termination:'sentinel'});continue;
      }
      edges.push(edge);
      if(edge.to){queue.push(edge.to);if(!['in-bounds','ended-target'].includes(edge.status))unknown.push({from:id,fieldNodeId:role.fieldNodeId,status:edge.status});}
      else if(edge.status!=='null')unknown.push({from:id,fieldNodeId:role.fieldNodeId,status:edge.status});
    }
  }
  const incoming=new Map([...reached].map(id=>[id,[]])),outgoing=new Map([...reached].map(id=>[id,[]]));
  for(const edge of edges)if(edge.termination!=='sentinel'&&reached.has(edge.to)){incoming.get(edge.to).push(edge);outgoing.get(edge.from).push(edge);}
  const remaining=new Map([...incoming].map(([id,list])=>[id,list.length])),pending=[...reached].filter(id=>remaining.get(id)===0);
  for(let index=0;index<pending.length;index++)for(const edge of outgoing.get(pending[index])){
    remaining.set(edge.to,remaining.get(edge.to)-1);if(remaining.get(edge.to)===0)pending.push(edge.to);
  }
  const cyclic=pending.length!==reached.size,sharedChildren=[...incoming].filter(([,list])=>list.length>1).map(([id,list])=>({nodeId:id,incoming: list})),
    complete=!!start&&!unknown.length&&!ended.size&&rootStatus==='in-bounds',
    empty=!start&&rootStatus==='null'||rootTerminal&&!includeRootBoundary,tree=complete&&!empty&&!cyclic&&!sharedChildren.length,
    maxChildren=[...outgoing.values()].reduce((maximum,list)=>Math.max(maximum,list.length),0);
  return {rootNodeId:start??null,rootStatus:rootTerminal&&!includeRootBoundary?'sentinel':rootStatus,reachableNodeIds:[...reached],endedTargetNodeIds:[...ended],terminalNodeIds:[...terminalNodes],edges,
    nodeCount:reached.size,edgeCount:[...outgoing.values()].reduce((sum,list)=>sum+list.length,0),cyclic,sharedChildren,
    unknownRelations:unknown,maxChildren,status:empty?'empty':!complete?'partial':cyclic||sharedChildren.length?'graph':'tree',
    views:[...(reached.size?['rooted-directed-graph']:[]),...(tree?['rooted-tree-candidate']:[]),
      ...(tree&&roles.length===2?['binary-tree-candidate']:[])],
    ordering:{status:'unknown',reason:'link topology alone does not establish a key role or subtree ordering'}};
}
