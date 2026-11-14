import {memoryPresentation} from './memory.js';
import {formatValue} from './playback.js';
const treeViews=new Set(['tree','binary-tree','forest','bst','avl','red-black','trie','min-heap','max-heap','segment-tree','fenwick-tree','range-aggregate']);
const sequenceViews=new Set(['array','dynamic-array','linked-list','queue','deque','stack']);
const nodeSize=shape=>shape.nodes.every(n=>n.fields?.length<=1)?{w:64,h:54}:{w:126,h:76};
const intersects=(a,b)=>a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const clip=(text,max)=>String(text).length>max?String(text).slice(0,max-1)+'…':String(text);

export function hydrateStructure(recording,scene,presentation,targets=[]){
  if(presentation.view==='boxes')return null;
  let relation=presentation.relation,dimensions=presentation.descriptor?.dimensions;
  if(['array','grid','dynamic-array'].includes(presentation.view)){
    const d=presentation.descriptor,o=scene.objects.get(d?.objectId);
    if(o?.alive&&Number.isSafeInteger(d.capacity)&&d.capacity>=0&&Number.isSafeInteger(d.elementBytes)&&d.elementBytes>0){
      const start=d.range?.offset??0;
      dimensions??=start===0&&d.range?.size===o.size?o.cType?.dimensions:undefined;
      const total=dimensions?.reduce((n,d)=>n*d,1),flatten=presentation.view==='grid'&&dimensions?.length>1&&dimensions.every(n=>Number.isSafeInteger(n)&&n>0)&&Number.isSafeInteger(total)&&
        Number.isSafeInteger(d.range?.size/total)&&d.range.size/total>0;
      const capacity=flatten?total:d.capacity,bytes=flatten?d.range.size/total:d.elementBytes,cap=Math.min(presentation.displayLimit??64,capacity),indices=new Set(Array.from({length:cap},(_,i)=>i));
      for(const t of targets)if(t.objectId===o.id){const i=Math.floor((t.offset-start)/bytes);if(i>=0&&i<capacity&&!indices.has(i)){indices.delete([...indices].at(-1));indices.add(i);}}
      relation={id:presentation.candidateId??o.id,nodes:[...indices].sort((a,b)=>a-b).map(index=>({id:`${o.id}:${start+index*bytes}`,index,coordinates:flatten?dimensions.map((_,i)=>Math.floor(index/dimensions.slice(i+1).reduce((n,d)=>n*d,1))%dimensions[i]):null,ranges:[{objectId:o.id,offset:start+index*bytes,size:bytes}],terminal:[]})),
        edges:[],rootNodeIds:[],omittedNodes:capacity-indices.size,omittedEdges:0,complete:true,alive:true};
    }
  }
  if(!relation||relation.historyGap)return null;
  const windows=relation.nodes.flatMap(n=>n.ranges.map(r=>({...r,capacity:16}))),ids=new Set(windows.map(w=>w.objectId));
  const objects=memoryPresentation(recording,new Map([...scene.objects].filter(([id])=>ids.has(id))),{previewWindows:windows});
  const nodes=relation.nodes.map(n=>{
    const cells=n.ranges.flatMap(r=>{const o=objects.get(r.objectId);if(!o?.alive)return [];
      const values=o.renderCells??[{offset:0,size:o.size,path:'',value:o.value}];return values.filter(c=>intersects({...c,objectId:o.id},r)).map(c=>({...c,objectId:o.id,text:formatValue(c.value),name:o.name,
        owner:o.frameId?`STACK · ${recording.frameNames.get(o.frameId)??o.frameId}`:o.storage==='heap'?'HEAP':'전역·정적'}));});
    const active=targets.filter(t=>n.ranges.some(r=>intersects(r,t))),payload=cells.filter(c=>(!c.value?.reference||presentation.view==='hash-table'&&n.keyRange&&intersects({...c,objectId:c.objectId},n.keyRange))&&!c.cType?.kind?.includes('padding'));
    const chosen=[...new Map([...payload.filter(c=>active.some(t=>intersects({...c,objectId:c.objectId},t))),...payload].map(c=>[`${c.objectId}:${c.offset}`,c])).values()].slice(0,3);
    return {...n,cells,active,fields:chosen.map(c=>{const ref=c.value?.reference,target=ref&&scene.objects.get(ref.targetObjectId);return {label:c.path?.split('.').at(-1)||c.name,text:presentation.view==='hash-table'&&target?.alive?target.stringPreview??c.text:c.text,objectId:c.objectId,offset:c.offset,size:c.size};}),
      label:n.index!==undefined?`${n.coordinates?n.coordinates.map(i=>`[${i}]`).join(''):`[${n.index}]`}${n.coverage?` [${n.coverage.start},${n.coverage.end})`:n.root!==undefined?` 대표 ${n.root}`:''}`:n.label??(cells[0]?`${/^((?:\[\d+\])+)/.exec(cells[0].path??'')?.[1]??`+${n.ranges[0]?.offset??0} B`} ${cells[0].name}`:n.id),
      available:cells.length>0,terminal:n.terminal.filter(t=>t.accepted!==undefined)};
  });
  return {...presentation,relation,nodes,edges:relation.edges,omitted:relation.omittedNodes,roots:relation.rootNodeIds,columns:dimensions?.at(-1)};
}

// Layout changes representation only. All supplied edges, cycles and shared
// children survive; a requested tree never repairs a graph into a tree.
export function layoutStructure(shape,previous=new Map()){
  const {nodes,edges,view}=shape,positions=new Map(),size=nodeSize(shape),width=size.w+14,height=size.h+28,ids=new Set(nodes.map(n=>n.id));
  if(treeViews.has(view)){
    const incoming=new Set(edges.map(e=>e.to)),roots=[...new Set([...(shape.roots??[]).filter(id=>ids.has(id)),...nodes.filter(n=>!incoming.has(n.id)).map(n=>n.id)])],levels=new Map(),children=new Map();
    for(const e of edges){const list=children.get(e.from)??[];list.push(e.to);children.set(e.from,list);}
    const queue=roots.length?roots:nodes.length?[nodes[0].id]:[];for(const id of queue)levels.set(id,0);
    for(let i=0;i<queue.length;i++){const id=queue[i];for(const child of children.get(id)??[])if(ids.has(child)&&!levels.has(child)){levels.set(child,levels.get(id)+1);queue.push(child);}}
    let detached=Math.max(0,...levels.values())+1;for(const n of nodes)if(!levels.has(n.id))levels.set(n.id,detached);
    const rows=new Map();for(const n of nodes){const d=levels.get(n.id),row=rows.get(d)??[];row.push(n.id);rows.set(d,row);}
    const widest=Math.max(1,...[...rows.values()].map(r=>r.length));for(const [d,row]of rows)row.forEach((id,i)=>positions.set(id,{x:16+(widest-row.length)*width/2+i*width,y:22+d*height}));
  }else if(view==='stack')nodes.forEach((n,i)=>positions.set(n.id,{x:26,y:22+(nodes.length-1-i)*height}));
  else if(view==='grid'||view==='hash-table'||view==='disjoint-set'){
    const groups=new Map();for(const n of nodes){const group=view==='hash-table'?n.bucket??'미확인':view==='disjoint-set'?n.root??'미확인':Math.floor((n.index??nodes.indexOf(n))/Math.max(1,shape.columns??4)),list=groups.get(group)??[];list.push(n);groups.set(group,list);}
    [...groups.values()].forEach((row,y)=>row.forEach((n,x)=>positions.set(n.id,{x:16+x*width,y:22+y*height})));
  }else if(sequenceViews.has(view)){
    let ordered=nodes;
    if(view==='linked-list'){const byId=new Map(nodes.map(n=>[n.id,n])),visited=new Set(),list=[],pending=[...(shape.roots??[]),...nodes.map(n=>n.id)];
      for(const first of pending){let id=first;while(byId.has(id)&&!visited.has(id)){visited.add(id);list.push(byId.get(id));id=edges.find(e=>e.from===id&&!visited.has(e.to))?.to;}}ordered=list;}
    ordered.forEach((n,i)=>positions.set(n.id,{x:16+i*width,y:22}));
  }
  else{
    // Reuse graph positions for surviving logical identities, including seeks.
    const used=new Set([...previous.values()].map(p=>`${p.x}:${p.y}`)),available=p=>![...positions.values()].some(q=>p.x<q.x+size.w+8&&q.x<p.x+size.w+8&&p.y<q.y+size.h+8&&q.y<p.y+size.h+8);
    for(const n of nodes)if(previous.has(n.id)&&available(previous.get(n.id)))positions.set(n.id,previous.get(n.id));
    const radius=Math.max(110,size.w*1.75),center=radius+25,dx=2*radius+size.w+40,dy=2*radius+size.h+40;
    let slot=0;for(const n of nodes)if(!positions.has(n.id)){
      let p;do{const group=Math.floor(slot/8),angle=[-2,2,4,0,-1,3,-3,1][slot%8]*Math.PI/4;p={x:Math.round(center+(group%3)*dx+Math.cos(angle)*radius),y:Math.round(center+Math.floor(group/3)*dy+Math.sin(angle)*radius)};slot++;}while(used.has(`${p.x}:${p.y}`)||!available(p));
      positions.set(n.id,p);used.add(`${p.x}:${p.y}`);
    }
  }
  return {positions,width:Math.max(220,...[...positions.values()].map(p=>p.x+size.w+(treeViews.has(view)?65:22))),height:Math.max(110,...[...positions.values()].map(p=>p.y+size.h+35)),...size};
}

export function renderStructureShape(shape,{positions,onLocate=()=>{}}={}){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),layout=layoutStructure(shape,positions);
  svg.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);svg.setAttribute('width',layout.width);svg.setAttribute('height',layout.height);svg.setAttribute('role','group');svg.setAttribute('aria-label',`${shape.label} · 실제 저장소 연결`);
  const make=(tag,attributes,text,parent=svg)=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;parent.append(el);return el;};
  const edgeLabel=edge=>(edge.labels??[]).map(l=>typeof l==='object'?l.text??l.symbol??l.label??'':l).join(', ');
  for(const [i,e]of shape.edges.entries()){
    const a=layout.positions.get(e.from),b=layout.positions.get(e.to);if(!a||!b)continue;
    const x=a.x+layout.w/2,y=a.y+layout.h,tx=b.x+layout.w/2,ty=b.y,loop=e.from===e.to,back=y>=ty,side=i%2?1:-1;
    const horizontal=sequenceViews.has(shape.view)&&shape.view!=='stack',forward=b.x>a.x,hx=forward?a.x+layout.w:a.x,htx=forward?b.x:b.x+layout.w,hy=a.y+(forward?layout.h*.4:layout.h*.7),
      direct=horizontal&&Math.abs(a.x-b.x)<layout.w+20&&!loop;
    const path=horizontal&&!loop?(direct?`M ${hx} ${hy} H ${htx}`:`M ${hx} ${hy} C ${hx} ${a.y+layout.h+25},${htx} ${b.y+layout.h+25},${htx} ${hy}`):loop?`M ${a.x+layout.w} ${a.y+22} C ${a.x+layout.w+45} ${a.y-15},${a.x+layout.w+45} ${a.y+layout.h+20},${a.x+layout.w} ${a.y+layout.h-15}`:
      back?`M ${x} ${y} C ${x+side*65} ${y+38},${tx+side*65} ${ty-38},${tx} ${ty}`:`M ${x} ${y} C ${x} ${y+16},${tx} ${ty-16},${tx} ${ty}`;
    make('path',{d:path,fill:'none',stroke:'#81cbbb','stroke-width':1.5,'data-edge':e.id??`${e.from}:${e.to}:${i}`});
    make('path',{d:loop?`M ${a.x+layout.w+7} ${a.y+layout.h-19} L ${a.x+layout.w} ${a.y+layout.h-15} L ${a.x+layout.w+7} ${a.y+layout.h-11}`:horizontal?`M ${htx+(forward?-7:7)} ${hy-4} L ${htx} ${hy} L ${htx+(forward?-7:7)} ${hy+4}`:`M ${tx-4} ${ty-7} L ${tx} ${ty} L ${tx+4} ${ty-7}`,fill:'none',stroke:'#81cbbb'});
    const label=edgeLabel(e);if(label)make('text',{x:(x+tx)/2+5,y:(y+ty)/2,fill:'#e7c38b','font-size':11},label);
  }
  for(const n of shape.nodes){const p=layout.positions.get(n.id),roles=new Set(n.active.map(t=>t.role)),group=make('g',{'data-node':n.id,'data-object':n.ranges[0]?.objectId??'','data-offset':n.ranges[0]?.offset??0,transform:`translate(${p.x} ${p.y})`,tabindex:0,role:'button','aria-label':`${n.label} 원본 위치`}),
      stroke=roles.has('write')?'#ffce85':roles.has('read')?'#83baff':roles.has('address')?'#afbdd9':'#55717d';
    make('rect',{width:layout.w,height:layout.h,rx:treeViews.has(shape.view)?20:5,fill:n.available?'#1a303a':'#202932',stroke,'stroke-width':n.active.length?2.5:1,'stroke-dasharray':n.available?'none':'4 3'},undefined,group);
    make('title',{},n.cells.map(c=>`${c.owner} · ${c.name}${c.path??''} = ${c.text}`).join('\n')||'현재 관측값 없음',group);
    make('text',{x:8,y:15,fill:'#9eb7c2','font-size':10},clip(n.label,layout.w<100?9:20),group);
    for(const [i,f]of n.fields.entries()){
      const field=make('text',{x:8,y:layout.w<100?37:32+i*15,fill:'#eef5f7','font-size':layout.w<100?17:12,role:'button',tabindex:0,'aria-label':`${f.label} 값 ${f.text} 원본 위치`},clip(layout.w<100?f.text:`${f.label}: ${f.text}`,layout.w<100?6:23),group);
      field.onclick=e=>{e.stopPropagation();onLocate(f.objectId,{objectId:f.objectId,offset:f.offset,size:f.size});};field.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.stopPropagation();e.preventDefault();onLocate(f.objectId,{objectId:f.objectId,offset:f.offset,size:f.size});}};
    }
    if(!n.fields.length)make('text',{x:8,y:38,fill:'#91a5b0','font-size':11},n.available?'참조 필드':'관측값 없음',group);
    if(n.terminal.some(t=>t.accepted))make('circle',{cx:layout.w-11,cy:10,r:4,fill:'#a3e2b5'},undefined,group);
    const ends=(shape.relation.terminals??[]).filter(t=>t.from===n.id);if(ends.length)make('text',{x:8,y:layout.h+14,fill:'#8ca8b6','font-size':10},ends.every(t=>t.kind==='null')?`NULL${ends.length>1?` ×${ends.length}`:''}`:'경계 연결',group);
    const locate=()=>{const r=n.ranges[0];if(r)onLocate(r.objectId,r);};group.onclick=locate;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();locate();}};
  }
  if(!shape.nodes.length)make('text',{x:14,y:40,fill:'#93acb8','font-size':12},shape.relation?.historyGap?'이 시점의 구조 이력 생략':shape.relation?.alive===false?'구조 수명 종료':shape.relation?.complete?'관측된 구성원 0개':'구성원 미확정');
  return {svg,positions:layout.positions};
}
