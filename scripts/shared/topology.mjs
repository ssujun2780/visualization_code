// Display/type names never participate in this topology test.
export function topology(nodes,references) {
  const ids=new Set(nodes.map(n=>n.id)),edges=references.filter(e=>ids.has(e.from)&&ids.has(e.to));
  const incoming=new Map([...ids].map(id=>[id,0])),outgoing=new Map([...ids].map(id=>[id,[]]));
  for(const e of edges){incoming.set(e.to,incoming.get(e.to)+1);outgoing.get(e.from).push(e.to);}
  const pending=[...ids].filter(id=>incoming.get(id)===0),remaining=new Map(incoming);let visited=0;
  for(let i=0;i<pending.length;i++){visited++;for(const to of outgoing.get(pending[i])){remaining.set(to,remaining.get(to)-1);if(!remaining.get(to))pending.push(to);}}
  const cyclic=visited!==ids.size,singleParent=[...incoming.values()].every(n=>n<=1),singleSuccessor=[...outgoing.values()].every(a=>a.length<=1);
  const views=edges.length?["directed-graph"]:[];
  if(edges.length&&!cyclic&&singleParent)views.push("tree-or-forest");
  if(edges.length&&!cyclic&&singleParent&&singleSuccessor)views.push("linked-chain-or-chains");
  return {nodeCount:ids.size,edgeCount:edges.length,cyclic,roots:[...ids].filter(id=>incoming.get(id)===0),views,
    evidence:["observed object identity","observed reference targets",...(cyclic?["observed cycle"]:["acyclic at this snapshot"])]};
}
