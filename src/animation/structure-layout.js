const trees=new Set(['tree','binary-tree','forest','bst','avl','red-black','trie','min-heap','max-heap','segment-tree','fenwick-tree','range-aggregate','disjoint-set','b-tree','b-plus-tree','2-3-4-tree']);
export const treePresentation=view=>trees.has(view);
export const multiKeyPresentation=view=>['b-tree','b-plus-tree','2-3-4-tree'].includes(view);
export const roundPresentation=view=>trees.has(view)&&!multiKeyPresentation(view)||['graph','dag'].includes(view);
export function circularPresentation(shape){
  if(typeof shape.circular==='boolean')return shape.circular;
  const s=shape.semantic??shape.relation?.semantic??{};
  if(shape.variant==='circular'||s.circular===true||s.variant==='circular')return true;
  // A modulus in a generic physical-index mapping does not imply a ring.
  // Consume explicit queue layout or already observed wrapped addressing.
  return ['queue','deque','circular-queue'].includes(shape.view)&&(['ring','flag-ring'].includes(shape.descriptor?.layout??s.layout)||s.currentAccess?.moduloCapacity===true);
}
function graphLayers(nodes,edges,previous){
  if(!nodes.length||nodes.length>40)return null;
  const ids=new Set(nodes.map(n=>n.id)),incoming=new Set(),adjacent=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges)if(ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to){adjacent.get(e.from).push(e.to);adjacent.get(e.to).push(e.from);incoming.add(e.to);}
  const levels=new Map();
  for(const root of [...nodes.filter(n=>!incoming.has(n.id)),...nodes])if(!levels.has(root.id)){
    const queue=[root.id];levels.set(root.id,0);for(let i=0;i<queue.length;i++)for(const n of adjacent.get(queue[i]))if(!levels.has(n)){levels.set(n,levels.get(queue[i])+1);queue.push(n);}
  }
  if(Math.max(...levels.values())>6)return null;
  const rows=new Map();for(const n of nodes){const row=rows.get(levels.get(n.id))??[];row.push(n.id);rows.set(levels.get(n.id),row);}
  const widest=Math.max(...[...rows.values()].map(r=>r.length)),positions=new Map();
  for(const [level,row]of rows)row.forEach((id,i)=>{let point=previous.get(id)??{x:20+level*156,y:i*120+(widest-row.length)*60};while([...positions.values()].some(p=>Math.abs(p.x-point.x)<80&&Math.abs(p.y-point.y)<80))point={x:point.x,y:point.y+120};positions.set(id,point);});
  return positions;
}
export function layoutStructure(shape,previous=new Map()){
  const nodes=shape.nodes??[],edges=shape.edges??[],view=shape.view,positions=new Map(),w=64,h=54,dx=112,dy=116,ids=new Set(nodes.map(n=>n.id));
  const semantic=shape.semantic??shape.relation?.semantic??{},ring=circularPresentation(shape),layered=shape.view==='graph'?graphLayers(nodes,edges,previous):null;let ringGeometry;
  if(ring){
    const capacity=shape.capacity??semantic.capacity??semantic.logicalOrder?.modulus??nodes.length,n=Math.max(1,Math.min(capacity,128)),radius=Math.max(100,n*dx/(Math.PI*2));
    const byIndex=new Map(nodes.map((node,i)=>[node.id,capacity>128?i:Number.isInteger(node.index)?node.index:i]));ringGeometry={x:24+radius,y:40+radius,radius};
    for(const node of nodes){const angle=-Math.PI/2+2*Math.PI*byIndex.get(node.id)/n;positions.set(node.id,{x:24+radius+Math.cos(angle)*radius,y:40+radius+Math.sin(angle)*radius});}
  }else if(layered){for(const [id,p]of layered)positions.set(id,p);
  }else if(trees.has(view)||view==='dag'){
    // Follow supplied parent/child relationships only. Cycles/shared children
    // remain edges; they never cause a fabricated or repaired tree.
    const layoutEdges=view==='disjoint-set'?edges.map(e=>({...e,from:e.to,to:e.from})):edges,
      incoming=new Set(layoutEdges.filter(e=>e.from!==e.to).map(e=>e.to)),children=new Map(),levels=new Map(),roots=[...new Set([...(shape.roots??[]),...nodes.filter(n=>!incoming.has(n.id)).map(n=>n.id)])].filter(id=>ids.has(id));
    for(const e of layoutEdges)if(e.from!==e.to&&ids.has(e.from)&&ids.has(e.to)){const list=children.get(e.from)??[];list.push(e.to);children.set(e.from,list);}
    // DSU snapshots can carry parent indexes without a separate edge list.
    if(view==='disjoint-set')for(const n of nodes)if(n.parent!==undefined&&n.parent!==n.index&&!edges.some(e=>e.from===n.id||e.to===n.id)){
      const p=nodes.find(p=>p.id===n.parent||p.index===n.parent);if(p){incoming.add(n.id);const list=children.get(p.id)??[];list.push(n.id);children.set(p.id,list);}}
    if(view==='disjoint-set'){roots.length=0;roots.push(...nodes.filter(n=>!incoming.has(n.id)).map(n=>n.id));}
    if(view==='dag'){
      const indegree=new Map(nodes.map(n=>[n.id,0]));for(const list of children.values())for(const id of list)indegree.set(id,indegree.get(id)+1);
      const queue=nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id);for(const id of queue)levels.set(id,0);
      for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])??[]){levels.set(child,Math.max(levels.get(child)??0,levels.get(queue[i])+1));indegree.set(child,indegree.get(child)-1);if(indegree.get(child)===0)queue.push(child);}
      const unresolved=Math.max(0,...levels.values())+1;for(const n of nodes)if(!queue.includes(n.id))levels.set(n.id,unresolved);
      const rows=new Map();for(const n of nodes){const row=rows.get(levels.get(n.id))??[];row.push(n.id);rows.set(levels.get(n.id),row);}
      const widest=Math.max(1,...[...rows.values()].map(r=>r.length));for(const [level,row]of rows)row.forEach((id,i)=>positions.set(id,{x:20+(widest-row.length)*dx/2+i*dx,y:42+level*dy}));
    }else{
      const visited=new Set();let leaf=0;
      const place=(id,depth)=>{if(visited.has(id))return positions.get(id)?.x;visited.add(id);const branches=[];
        for(const child of children.get(id)??[]){const x=place(child,depth+1);if(x!==undefined)branches.push(x);}
        let x=branches.length?(Math.min(...branches)+Math.max(...branches))/2:20+leaf++*dx,y=42+depth*dy;
        while([...positions.values()].some(p=>p.y===y&&Math.abs(p.x-x)<dx*.8))x+=dx;
        positions.set(id,{x,y});return x;
      };
      for(const id of [...roots,...nodes.map(n=>n.id)])if(!visited.has(id)){place(id,0);leaf++;}
    }
  }else if(view==='stack'){
    nodes.forEach((n,i)=>positions.set(n.id,{x:32,y:42+(nodes.length-1-i)*92}));
  }else if(view==='grid'||view==='hash-table'){
    const groups=new Map(),columns=Math.max(1,shape.columns??4);
    for(const [i,n]of nodes.entries()){const key=view==='hash-table'?n.bucket??'미확인':Math.floor((n.index??i)/columns),row=groups.get(key)??[];row.push(n);groups.set(key,row);}
    [...groups].forEach(([group,row],r)=>row.forEach((n,c)=>positions.set(n.id,{x:24+c*dx,y:48+r*100,group})));
  }else if(['array','dynamic-array','queue','deque','linked-list','string'].includes(view)){
    let ordered=nodes;
    if(view==='linked-list'){
      const visited=new Set(),byId=new Map(nodes.map(n=>[n.id,n])),list=[];
      for(const root of [...(shape.roots??[]),...nodes.map(n=>n.id)]){let id=root;while(byId.has(id)&&!visited.has(id)){visited.add(id);list.push(byId.get(id));id=edges.find(e=>e.from===id&&!visited.has(e.to))?.to;}}ordered=list;
    }
    ordered.forEach((n,i)=>positions.set(n.id,{x:24+i*dx,y:48}));
  }else{
    const radius=150,step=radius*2+160,used=[];
    for(const n of nodes)if(previous.has(n.id)){const p=previous.get(n.id);positions.set(n.id,p);used.push(p);}
    let slot=0;for(const n of nodes)if(!positions.has(n.id)){
      let p;do{const group=Math.floor(slot/8),angle=(slot%8)*Math.PI/4;p={x:30+radius+(group%3)*step+Math.cos(angle)*radius,y:45+radius+Math.floor(group/3)*step+Math.sin(angle)*radius};slot++;}while(used.some(q=>Math.abs(q.x-p.x)<w+10&&Math.abs(q.y-p.y)<h+10));
      positions.set(n.id,p);used.push(p);
    }
  }
  return {positions,w,h,ring:ringGeometry,width:Math.max(220,...[...positions.values()].map(p=>p.x+w+34)),height:Math.max(140,...[...positions.values()].map(p=>p.y+h+38))};
}
