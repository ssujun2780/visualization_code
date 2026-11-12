import {topology} from '../shared/topology.mjs';

// A stored successor can be viewed as a parent only when every observed node
// reaches a recorded termination. Raw edges keep their original direction.
export function parentRelationTopology(nodes,edges){
  if(!nodes.length)return null;
  const ids=new Set(nodes.map(n=>n.id)),byNode=new Map(nodes.map(n=>[n.id,edges.filter(e=>e.from===n.id)]));
  if([...byNode.values()].some(a=>a.length!==1||!['observed','observed-termination'].includes(a[0].status)))return null;
  const roots=edges.filter(e=>e.status==='observed-termination').map(e=>e.from);
  if(!roots.length)return null;
  for(const n of nodes){const seen=new Set();let id=n.id;
    while(true){if(seen.has(id)||!ids.has(id))return null;seen.add(id);const e=byNode.get(id)[0];
      if(e.status==='observed-termination')break;id=e.to;}
  }
  const reverse=edges.filter(e=>e.status==='observed').map(e=>({...e,from:e.to,to:e.from}));
  return {...topology(nodes,reverse),roots,complete:true,status:'observed',direction:'parent-to-child-view',
    storedDirection:'child-to-successor',maxChildren:Math.max(0,...nodes.map(n=>reverse.filter(e=>e.from===n.id).length)),
    sharedChildren:[],views:['parent-forest-candidate'],intent:'unconfirmed'};
}
