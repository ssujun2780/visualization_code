// Structural membership is supplied by inference, never guessed from names or
// similar values. Edges are current recorded pointer references, not final edges.
const indices=new WeakMap();
function activeBindings(recording,analysis,at){
  if(!analysis)return [];
  let index=indices.get(analysis);
  if(!index){const changes=[];for(const [key,b]of (analysis.structureInference?.storageBindings??[]).entries()){
    const begin=recording.eventOrder.get(b.availableAtExecutionId),end=recording.eventOrder.get(b.invalidatedAtExecutionId);
    if(begin===undefined)continue;changes.push({at:begin,key,b,active:true});if(end!==undefined)changes.push({at:end,key,b,active:false});
  }changes.sort((a,b)=>a.at-b.at||Number(b.active)-Number(a.active));index={changes,cursor:0,at:-1,active:new Map()};indices.set(analysis,index);}
  if(index.at>at){index.cursor=0;index.active.clear();}
  while(index.cursor<index.changes.length&&index.changes[index.cursor].at<=at){const c=index.changes[index.cursor++];c.active?index.active.set(c.key,c.b):index.active.delete(c.key);}
  index.at=at;return index.active.values();
}
export function workGraph(recording,cards,analysis,atExecutionId){
  const at=atExecutionId===null?-1:recording.eventOrder.get(atExecutionId);if(at===undefined)return null;
  const byObject=new Map(cards.filter(c=>c.alive).map(c=>[c.id,c])),groups=new Map();
  for(const b of activeBindings(recording,analysis,at)){
    if(!byObject.has(b.objectId))continue;
    const group=groups.get(b.structureId)??new Map(),parts=group.get(b.elementId)??[];parts.push(b);group.set(b.elementId,parts);groups.set(b.structureId,group);
  }
  const candidates=[];
  for(const [structureId,group]of groups){
    const all=[...group].map(([id,parts])=>({id,parts,cells:parts.flatMap(b=>byObject.get(b.objectId).cells.filter(c=>c.offset>=b.offset&&c.offset<b.offset+b.size).map(c=>({...c,objectId:b.objectId}))),
      objectId:parts[0].objectId,offset:parts[0].offset,owner:byObject.get(parts[0].objectId).owner,name:byObject.get(parts[0].objectId).name}));
    const nodes=all.slice(0,12),edges=[];
    for(const source of nodes)for(const cell of source.cells){const ref=cell.value?.reference;if(!ref?.targetObjectId||ref.onePast)continue;
      const target=nodes.find(n=>n.parts.some(p=>p.objectId===ref.targetObjectId&&ref.targetOffset>=p.offset&&ref.targetOffset<p.offset+p.size));
      if(target)edges.push({from:source.id,to:target.id,sourceObjectId:cell.objectId,sourceOffset:cell.offset,targetObjectId:ref.targetObjectId,targetOffset:ref.targetOffset});
    }
    if(edges.length)candidates.push({structureId,nodes,edges,omitted:all.length-nodes.length,objectIds:[...new Set(nodes.map(n=>n.objectId))]});
  }
  // Candidate choice concerns display only. Keep alternatives explicit.
  candidates.sort((a,b)=>b.edges.length-a.edges.length||a.structureId.localeCompare(b.structureId));
  return candidates.length?{...candidates[0],alternatives:candidates.map(c=>c.structureId)}:null;
}

export function renderWorkGraph(graph,{onLocate=()=>{}}={}){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),cols=Math.min(3,graph.nodes.length),width=cols*140,height=Math.ceil(graph.nodes.length/cols)*100+25;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','추론된 요소와 현재 포인터 연결');svg.classList.add('work-node-graph');
  const make=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;},positions=new Map();
  for(const [i,n]of graph.nodes.entries())positions.set(n.id,{x:(i%cols)*140+8,y:Math.floor(i/cols)*100+20});
  for(const edge of graph.edges){const a=positions.get(edge.from),b=positions.get(edge.to),x=a.x+60,y=a.y+65,tx=b.x+60,ty=b.y;
    const path=a===b?`M ${x+40} ${y} C ${x+95} ${y+25},${x+95} ${ty-25},${tx+40} ${ty}`:`M ${x} ${y} C ${x} ${y+22},${tx} ${ty-15},${tx} ${ty}`;
    make('path',{d:path,fill:'none',stroke:'#81d9c2','stroke-width':'1.5'});make('path',{d:`M ${tx-3} ${ty-6} L ${tx} ${ty} L ${tx+3} ${ty-6}`,fill:'none',stroke:'#81d9c2'});
  }
  for(const n of graph.nodes){const p=positions.get(n.id),write=n.cells.some(c=>c.roles.includes('write')),read=n.cells.some(c=>c.roles.includes('read'));
    const box=make('rect',{x:p.x,y:p.y,width:122,height:64,rx:5,fill:'#182a33',stroke:write?'#ffce85':read?'#83baff':'#48636e','stroke-width':write||read?2:1,
      'data-object':n.objectId,'data-start':n.offset,'data-size':n.parts[0].size,role:'button',tabindex:0,'aria-label':`${n.name} +${n.offset} B 원본 위치`});
    box.onclick=()=>onLocate(n.objectId);box.onkeydown=e=>{if(e.key==='Enter')onLocate(n.objectId);};
    const group=make('g',{'data-object':n.objectId});group.appendChild(document.createElementNS(ns,'title')).textContent=`${n.owner} · ${n.name} +${n.offset} B`;
    const label=(text,y,small=false)=>{const foreign=make('foreignObject',{x:p.x+8,y,width:106,height:18}),body=document.createElementNS('http://www.w3.org/1999/xhtml','div');body.className='work-node-label';body.title=text;body.textContent=text;if(small)body.style.fontSize='11px';foreign.append(body);};
    label(`${n.name} +${n.offset} B`,p.y+5,true);
    const payload=n.cells.filter(c=>!c.value?.reference).slice(0,2);for(const [i,c]of payload.entries())label(`${c.path.split('.').at(-1)}: ${c.text}`,p.y+23+i*17);
  }
  return svg;
}
