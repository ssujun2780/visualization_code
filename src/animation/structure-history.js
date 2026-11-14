import {layoutStructure,treePresentation} from './structure-layout.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const nodeState=n=>typeof n?.state==='string'&&['unvisited','discovered','active','visited','settled','queued','rejected'].includes(n.state)?n.state:
  n?.settled===true?'settled':n?.visited===true?'visited':n?.frontier===true?'queued':n?.visited===false?'unvisited':undefined;
const ranges=n=>n?.ranges??[];
const properties=n=>({color:n.color,height:n.height,state:nodeState(n),coverage:n.coverage,keyRanges:n.keyRanges??(n.keyRange?[n.keyRange]:undefined)});
const edgeKey=e=>e.id??JSON.stringify([e.from,e.to,e.roleId]);

// Differences of supplied facts, not an algorithm recogniser. Every change
// retains the source boundary, logical identity and original byte ranges.
export function relationChanges(before,after,index,executionId){
  if(!before||!after||before.historyGap||after.historyGap)return [];
  const changes=[],a=new Map((before.nodes??[]).map(n=>[n.id,n])),b=new Map((after.nodes??[]).map(n=>[n.id,n]));
  for(const id of new Set([...a.keys(),...b.keys()])){
    const old=a.get(id),next=b.get(id),base={index,executionId,nodeId:id,ranges:ranges(next??old)};
    if(!old||!next){changes.push({...base,kind:'membership',before:!!old,after:!!next});continue;}
    const x=properties(old),y=properties(next);
    for(const field of Object.keys(x))if(!equal(x[field],y[field]))changes.push({...base,kind:'property',field,before:x[field],after:y[field]});
  }
  const x=new Map((before.edges??[]).map(e=>[edgeKey(e),e])),y=new Map((after.edges??[]).map(e=>[edgeKey(e),e]));
  for(const id of new Set([...x.keys(),...y.keys()])){
    const old=x.get(id),next=y.get(id);
    if(!equal(old&&[old.from,old.to,old.roleId],next&&[next.from,next.to,next.roleId]))changes.push({index,executionId,kind:'connection',edgeId:id,before:old,after:next,
      ranges:[...ranges(a.get(old?.from)),...ranges(b.get(next?.from)),...ranges(a.get(old?.to)),...ranges(b.get(next?.to))]});
  }
  return changes;
}

function validHierarchy(nodes,edges){
  const ids=new Set(nodes.map(n=>n.id)),parents=new Map(),children=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges)if(ids.has(e.from)&&ids.has(e.to)){
    if(e.from===e.to||parents.has(e.to)&&parents.get(e.to)!==e.from)return false;
    parents.set(e.to,e.from);children.get(e.from).push(e.to);
  }
  const done=new Set(),active=new Set();
  const walk=id=>{if(active.has(id))return false;if(done.has(id))return true;active.add(id);for(const child of children.get(id))if(!walk(child))return false;active.delete(id);done.add(id);return true;};
  return nodes.every(n=>walk(n.id));
}

// Physical index slots stay fixed. Pointer-based hierarchies follow current
// relationships; colour changes alone never trigger a new layout.
export function prepareStructureHistory(variant,appearance){
  const entries=[],indexedHeap=['min-heap','max-heap'].includes(variant.view)&&variant.entries.some(e=>e.presentation.relation?.sourceKind==='index-tree'||
    appearance.descriptor.elementBytes>0&&e.presentation.relation?.nodes?.length&&e.presentation.relation.nodes.every(n=>Number.isInteger(n.index))),
    movable=treePresentation(variant.view)&&!['segment-tree','fenwick-tree','range-aggregate'].includes(variant.view)&&!indexedHeap;
  let positions=new Map(appearance.positions),previous=null,topology=null,lastPositions=null,layoutBoundary=null;
  for(const entry of variant.entries??[]){
    const p=entry.presentation,r=p.relation,changes=relationChanges(previous,r,entry.index,p.afterExecutionId),nodes=r?.nodes??[],edges=r?.edges??[],
      key=JSON.stringify([nodes.map(n=>n.id),edges.map(e=>[e.from,e.to,e.roleId]),r?.rootNodeIds]);
    if(movable&&r&&!r.historyGap&&key!==topology){
      if(validHierarchy(nodes,variant.view==='disjoint-set'?edges.map(e=>({...e,from:e.to,to:e.from})):edges)){
        const proposed=layoutStructure({view:variant.view,nodes,edges,roots:r.rootNodeIds},positions).positions,
          dirty=new Set(changes.filter(c=>c.kind==='connection').flatMap(c=>[c.before?.from,c.before?.to,c.after?.from,c.after?.to])),placed=[];
        // Preserve unchanged branches at the same depth. Resolve collisions by
        // shifting only changed nodes, while retaining all original edges.
        const order=[...nodes].sort((a,b)=>Number(dirty.has(a.id))-Number(dirty.has(b.id)));
        for(const n of order){let point=proposed.get(n.id);if(!point)continue;const old=positions.get(n.id);
          if(topology!==null&&old&&old.y===point.y&&!dirty.has(n.id))point=old;
          while(placed.some(q=>Math.abs(q.x-point.x)<90&&Math.abs(q.y-point.y)<70))point={x:point.x+112,y:point.y};
          proposed.set(n.id,point);placed.push(point);
        }
        positions=new Map([...positions,...proposed]);
      }
      // During multi-write rewiring, cyclic/shared intermediate links remain
      // visible at their old positions. They are never repaired into a tree.
      topology=key;
    }
    const next=[...positions];if(!equal(next,lastPositions)){lastPositions=next;layoutBoundary=entry.index;}
    entries.push({index:entry.index,layoutBoundary,positions:lastPositions,changes});previous=r;
  }
  return {movable,entries};
}
