import {layoutMemory,containerId} from './object-view.js';
import {layoutStructure,circularPresentation,roundPresentation,treePresentation,multiKeyPresentation} from './structure-layout.js';
import {nodeState} from './structure-history.js';
const overlap=(a,b)=>a.offset<b.offset+b.size&&b.offset<a.offset+a.size;

// A different shape for the same original memory, never copied runtime nodes.
export function structuredMemory(object,presentation,collapsed,windows){
  const raw=layoutMemory(object,collapsed,windows),rootId=containerId(object.id),root=raw.groups.get(rootId);
  if(!presentation||presentation.view==='boxes'||presentation.backingStorageOnly||root?.collapsed)return raw;
  const rootBox=root??{id:rootId,objectId:object.id,kind:'aggregate',path:'',label:object.name,offset:0,size:object.size,children:[]},
    sourceCells=object.renderCells?.length?object.renderCells:[...raw.cells.values()].map(c=>({...c,objectId:object.id,offset:c.offset??0,size:c.size??object.size}));
  const gap=presentation.relation?.historyGap,view=presentation.view,semantic=gap?{}:presentation.relation?.semantic??{},all=presentation.layoutNodes??presentation.relation?.nodes??[],current=new Map((gap?[]:presentation.relation?.nodes??[]).map(n=>[n.id,n])),
    descriptor=presentation.descriptor??{},sequence=['stack','queue','deque'].includes(view),physical=['array','grid','dynamic-array','string'].includes(view)||sequence&&descriptor.objectId===object.id&&descriptor.elementBytes>0,
    circular=circularPresentation(presentation),round=roundPresentation(view),multi=multiKeyPresentation(view),parts=[];
  if(physical){
    let element=object.cType;while(element?.kind==='array')element=element.elementType;
    const bytes=sequence?descriptor.elementBytes:element?.kind==='record'?element.sizeBits/8:null,byRange=new Map();
    for(const cell of sourceCells){if(descriptor.range&&(cell.offset<descriptor.range.offset||cell.offset+cell.size>descriptor.range.offset+descriptor.range.size))continue;const offset=bytes?(descriptor.range?.offset??0)+Math.floor((cell.offset-(descriptor.range?.offset??0))/bytes)*bytes:cell.offset;
      if(offset<0)continue;const key=`${offset}:${bytes??cell.size}`,stride=bytes??descriptor.elementBytes??cell.size;if(!byRange.has(key))byRange.set(key,{id:bytes?`${object.id}:slot:${offset}`:cell.id,index:Math.floor((offset-(descriptor.range?.offset??0))/stride),range:{objectId:object.id,offset,size:bytes??cell.size}});}
    parts.push(...byRange.values());parts.sort((a,b)=>a.range.offset-b.range.offset);
  }else{
    for(const n of all)for(const r of n.ranges??[])if(r.objectId===object.id&&r.offset>=0&&r.offset+r.size<=object.size)parts.push({id:n.id,index:n.index,ranges:n.ranges,...current.get(n.id),range:r});
  }
  const unique=[...new Map(parts.map(n=>[`${n.range.offset}:${n.range.size}`,n])).values()],shown=unique.slice(0,128),
    cells=new Map(),groups=new Map(),ports=new Map(),anchors=new Map(),nodeRects=new Map(),assigned=new Set(),annotations=[];
  const orphanNodes=!physical&&presentation.diagramOwnerObjectId===object.id?all.filter(n=>!n.ranges?.length):[];
  const keyCells=(n,values)=>{const roles=n.keyRanges??(n.keyRange?[n.keyRange]:[]);return multi&&roles.length?values.filter(c=>roles.some(r=>r.objectId===object.id&&overlap(c,r))):values;};
  const record=shown.some(n=>sourceCells.filter(c=>overlap(c,n.range)).length>1),compactGraph=['graph','dag'].includes(view),valueLimit=compactGraph?1:3,
    sizes=shown.map(n=>{const local=sourceCells.filter(c=>overlap(c,n.range)),p=local.filter(c=>c.cType?.kind==='pointer').length,values=local.filter(c=>c.cType?.kind!=='pointer'),v=keyCells(n,values).length;return {w:Math.max(112,8+p*40,multi?16+Math.min(16,v)*56:0),h:multi?132+(v<values.length?64:0):compactGraph?(p?155:132):Math.max(132,(round?155:112)+Math.max(0,Math.min(3,v)-1)*48)};}),
    sx=record?Math.max(1.4,(Math.max(112,...sizes.map(s=>s.w))+28)/112):1.15,sy=record?Math.max(1.5,(Math.max(132,...sizes.map(s=>s.h))+28)/116):1.05;
  const slotPositions=presentation.slots?new Map(presentation.slots.positions):null,
    localLayout=physical?(slotPositions?{...presentation.slots,positions:new Map(shown.map(n=>[n.id,slotPositions.get(n.index)]))}:layoutStructure({view,nodes:shown,edges:[],variant:presentation.variant,circular,semantic,capacity:descriptor.capacity,columns:object.cType?.dimensions?.at(-1)??descriptor.dimensions?.at(-1)})):null,
    positions=localLayout?.positions??new Map(presentation.positions??[]);
  let extentX=210,extentY=130;
  const activeOffsets=new Set((presentation.relation?.nodes??[]).flatMap(n=>(n.ranges??[]).filter(r=>r.objectId===object.id).map(r=>r.offset))),order=semantic.logicalOrder;
  const knownOccupancy=physical&&(sequence||view==='dynamic-array')&&(!!order||semantic.activeRange?.valid||Array.isArray(semantic.inactiveRanges)),
    occupied=index=>order?Array.from({length:Math.min(order.length??order.count??0,128)},(_,i)=>{const value=order.start+i*(order.direction??order.stride??1),modulus=order.modulus??(circular?descriptor.capacity:null);return modulus>0?(value%modulus+modulus)%modulus:value;}).includes(index):null;
  for(const [slot,n]of shown.entries()){
    const local=sourceCells.filter(c=>overlap(c,n.range)&&!assigned.has(c.id));if(!local.length)continue;
    const single=!physical&&unique.length===1&&n.range.offset===0&&n.range.size===object.size,point=single?null:positions.get(n.id),x=18+(point?.x??slot*112)*sx,y=42+(point?.y??0)*sy;
    const rawValues=local.filter(c=>c.cType?.kind!=='pointer'),values=keyCells(n,rawValues),administrative=rawValues.filter(c=>!values.includes(c)),pointers=local.filter(c=>c.cType?.kind==='pointer'),w=record?sizes[slot].w:84,h=record?sizes[slot].h:round?84:64,
      original=[...raw.groups.values()].find(g=>g.id!==rootId&&g.offset===n.range.offset&&g.size===n.range.size),id=original?.id??`node:${object.id}:${n.range.offset}:${n.range.size}`;
    const rect={id,objectId:object.id,offset:n.range.offset,size:n.range.size,x,y,width:w,height:h,kind:'aggregate',path:original?.path??'',label:`${object.name} +${n.range.offset} B`,logicalNode:true,collapsed:collapsed.has(id),header:{x,y,width:w,height:14},toggle:{x:x+3,y:y+2,width:20,height:20},resizeHandle:{x:x+w-16,y:y+h-16,width:16,height:16},children:[],hidden:false,bare:round};
    if(record){groups.set(id,rect);ports.set(id,rect.collapsed?rect:{...rect,...rect.header});anchors.set(id,id);}
    const visible=new Set((rect.collapsed?[]:[...values.slice(0,multi?16:valueLimit),...administrative.slice(0,3)]).map(c=>c.id));if(!rect.collapsed)for(const c of pointers)visible.add(c.id);
    const nodeLabel=n.label??(n.index!==undefined?String(n.index):original?.path??`+${n.range.offset}`),occupiedSlot=occupied(n.index),inactive=knownOccupancy?(occupiedSlot===null?!activeOffsets.has(n.range.offset):!occupiedSlot):!physical&&!current.has(n.id);
    let visual=rect;
    for(const c of local){
      assigned.add(c.id);const pointer=c.cType?.kind==='pointer',admin=administrative.includes(c),i=pointer?pointers.indexOf(c):admin?administrative.indexOf(c):values.indexOf(c),hidden=record&&!visible.has(c.id),first=round&&!pointer&&i===0,diameter=84,
        box={...c,kind:'cell',label:`${object.name}${c.path}`,objectId:object.id,x:record?(pointer?x+8+i*40:multi?x+8+i*(admin?Math.max(48,(w-16)/3):56):first?x+(w-diameter)/2:x+8):x,
          y:record?(pointer?y+h-23:y+30+(multi?admin?64:0:round&&i>0?84+(i-1)*48:i*48)):y,width:record?(pointer?24:multi?admin?Math.max(44,(w-24)/3):48:first?diameter:w-16):w,height:record?(pointer?19:first?diameter:43):h,
          hidden,compactPointer:record&&pointer,structured:true,nodeId:n.id,shape:round&&(!record||first)?'circle':'box',nodeLabel:round?nodeLabel:null,inactive,
          coverage:n.coverage,color:n.color,nodeState:!record||!pointer&&!admin&&i===0?nodeState(n):undefined,administrative:admin,keyRole:!!(multi&&!admin&&!pointer&&(n.keyRanges?.length||n.keyRange)),terminal:(n.terminal??[]).some(t=>t.accepted===true),parent:view==='disjoint-set'};
      if(hidden){Object.assign(box,{x,y,width:w,height:h});anchors.set(c.id,id);}else{ports.set(c.id,box);anchors.set(c.id,c.id);if(first||!record)visual=box;}cells.set(c.id,box);
    }
    nodeRects.set(n.id,{...visual,nodeId:n.id,nodeLabel,ranges:n.ranges??[n.range]});extentX=Math.max(extentX,x+w+24);extentY=Math.max(extentY,y+h+34);
    if(physical){
      const front=view!=='stack'?(semantic.front?.index??semantic.front??semantic.head??order?.start):undefined,back=view!=='stack'?(semantic.back?.index??semantic.back??semantic.tail??semantic.rear):undefined,top=view==='stack'?(semantic.top?.index??semantic.top):undefined;
      for(const [name,index]of [['front',front],['rear',back],['top',top]])if(Number.isInteger(index)&&index===n.index)annotations.push({text:name,x:x+w/2,y:y-12,color:name==='front'?'#83baff':'#ffce85'});
      if(circular&&slot===0)annotations.push({text:`순환 · 용량 ${descriptor.capacity??semantic.capacity??shown.length}`,x:x+w/2,y:y-34,color:'#9dd7ca'});
    }
    if(n.coverage)annotations.push({text:`[${n.coverage.start}, ${n.coverage.end})`,x:visual.x+visual.width/2,y:visual.y+visual.height+17,color:'#b7c8dd'});
    if(n.height!==undefined&&n.height!==null)annotations.push({text:`h: ${n.height}`,x:visual.x+visual.width/2,y:visual.y+visual.height+17,color:'#b7c8dd'});
    if(view==='disjoint-set'&&n.root===n.index)annotations.push({text:'대표',x:visual.x+visual.width/2,y:record?visual.y+visual.height+17:visual.y-12,color:'#a5d9bd'});
    if(view==='hash-table'&&n.bucket!==undefined&&(!slot||shown[slot-1].bucket!==n.bucket))annotations.push({text:`버킷 ${n.bucket}`,x:x+w/2,y:y-14,color:'#abcbd5'});
  }
  for(const n of orphanNodes.slice(0,128)){
    const point=positions.get(n.id)??{x:0,y:0},now=current.get(n.id),rect={x:18+point.x,y:72+point.y,width:84,height:84,nodeId:n.id,nodeLabel:now?.label??String(n.index??''),color:now?.color,nodeState:nodeState(now),inactive:!now,diagramOnly:true,ranges:[]};nodeRects.set(n.id,rect);extentX=Math.max(extentX,rect.x+108);extentY=Math.max(extentY,rect.y+118);
  }
  let auxiliary=0;
  const auxiliaryTop=extentY;
  for(const c of sourceCells)if(!cells.has(c.id)){
    if(descriptor.range&&(c.offset<descriptor.range.offset||c.offset>=descriptor.range.offset+descriptor.range.size)){
      const box={...c,objectId:object.id,x:18+(auxiliary%3)*112,y:auxiliaryTop+Math.floor(auxiliary/3)*80,width:92,height:60,hidden:false,label:`${object.name}${c.path}`};auxiliary++;cells.set(c.id,box);ports.set(c.id,box);anchors.set(c.id,c.id);extentX=Math.max(extentX,box.x+112);extentY=Math.max(extentY,box.y+84);
    }else{cells.set(c.id,{...c,objectId:object.id,x:0,y:0,width:0,height:0,hidden:true,label:`${object.name}${c.path}`});anchors.set(c.id,rootId);}
  }
  const resized=windows.get(rootId),width=resized?.width??extentX,height=resized?.height??extentY,
    roleNote=view==='red-black'&&!shown.some(n=>['red','black'].includes(n.color))?' · 색 역할 미확정':view==='avl'&&!shown.some(n=>n.height!=null)?' · 저장 높이 미확정':multi&&!shown.some(n=>n.keyRanges?.length)?' · 키 역할 미확정':'',
    group={...rootBox,x:0,y:0,width,height,header:{x:0,y:0,width,height:30},toggle:{x:5,y:3,width:27,height:27},resizeHandle:{x:width-20,y:height-20,width:20,height:20},structured:true,structureLabel:presentation.label+roleNote,hiddenChildren:unique.length-shown.length,incomplete:unique.length>shown.length};
  groups.set(rootId,group);ports.set(rootId,{...group,height:30});anchors.set(rootId,rootId);
  const captionGroups=new Map();for(const a of annotations){const key=`${a.x}:${a.y}`;if(captionGroups.has(key))captionGroups.get(key).text+=` · ${a.text}`;else captionGroups.set(key,{...a});}
  if(resized)for(const [id,c]of cells)if(!c.hidden&&(c.x+c.width>width-8||c.y+c.height>height-16)){c.hidden=true;anchors.set(id,rootId);ports.delete(id);group.incomplete=true;}
  return {...raw,width,height,cells,groups,ports,anchors,structure:{id:presentation.relation?.id,view,label:presentation.label,nodeRects,annotations:[...captionGroups.values()],circular,semantic,directed:presentation.directed??semantic.directed??descriptor.directed,
    guide:localLayout?.ring?{x:18+localLayout.ring.x*sx+42,y:42+localLayout.ring.y*sy+32,rx:localLayout.ring.radius*sx,ry:localLayout.ring.radius*sy}:null,
    edges:presentation.relation?.historyGap?[]:presentation.relation?.edges??[],positions,tree:treePresentation(view),warnings:presentation.warnings??[],historyGap:presentation.relation?.historyGap},memory:object};
}
