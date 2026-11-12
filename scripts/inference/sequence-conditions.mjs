// Semantic conditions consume a relation; they do not interpret C storage.
export function sequenceConditions(relation,edges,terminalRoles){
 const conflicts=[];for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(a.from!==b.from)continue;
   for(const x of a.labels??[])if((b.labels??[]).some(y=>x.units.length&&y.units.length&&
     x.units.slice(0,Math.min(x.units.length,y.units.length)).every((v,k)=>v===y.units[k])))conflicts.push([a.id,b.id]);
 }
 const top=relation.topology,tree=!!top&&!top.cyclic&&!top.sharedChildren?.length&&!top.relationConflicts?.length&&top.roots?.length===1,
   labelled=edges.length>0&&edges.every(e=>e.labels?.length&&e.labels.every(l=>l.units?.length)),
   supported=tree&&labelled&&terminalRoles.length>0&&!conflicts.length;
 return {tree:tree?'satisfied-observed':'not-established',labelled:labelled?'satisfied-observed':'incomplete',
   deterministic:conflicts.length?'violated':'satisfied-observed',conflicts,
   sequenceEndMarker:terminalRoles.length?'observed':'unknown',trie:supported?'supported-observed':'not-established',
   scope:'observed relation; unvisited transitions and author intent remain unproven'};
}
