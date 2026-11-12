// Query-time storage bindings. Follow recorded identities, never numeric addresses.
const overlaps=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
export function structureRootRange(s,trace){
  if(!s.root)return null;
  const o=trace.objects?.find(o=>o.id===s.root.objectId),offset=s.root.offset;
  // A root slot has pointer extent, not the extent of its owner array/record.
  const size=s.root.size??(s.root.kind==='pointer-slot'?
    trace.events?.find(e=>['READ','WRITE'].includes(e.kind)&&e.target?.objectId===o?.id&&e.target.offset===offset&&e.value?.cType?.kind==='pointer')?.value.cType.sizeBits/8||
    s.roles?.find(r=>r.cType?.kind==='pointer')?.cType.sizeBits/8||s.candidateRoles?.find(r=>r.cType?.kind==='pointer')?.cType.sizeBits/8||
      (o?.cType?.kind==='pointer'?o.cType.sizeBits/8:0):s.logicalNodes?.find(n=>n.objectId===o?.id&&n.offset===offset)?.size);
  return o&&size>0&&offset>=0&&offset+size<=o.size?{objectId:o.id,offset,size}:null;
}
export function structureStorageRanges(s,trace,ctx,seen=new Set()){
  if(!s||seen.has(s.id))return [];seen.add(s.id);
  if(s.queryScoped){
    const state=ctx.state(s),ranges=[...state?.scopeRanges??[]];
    for(const [name,r]of Object.entries(s.roles??{}))if(name!=='data'&&r?.size>0)
      ranges.push({objectId:r.objectId??s.ownerObjectId,offset:r.offset+(r.objectId?0:s.ownerOffset??0),size:r.size});
    return ranges;
  }
  const state=ctx.state(s),scoped=['index-domain-graph-candidate','observed-traversal-graph-candidate'].includes(s.kind)?(state?.edges??[]).flatMap(e=>[...e.sourceSlots,...(e.rootBindings??[]).flatMap(r=>[r.source,...r.linkSources]),...e.properties.map(p=>p.source),...(e.rangeInputs??[]).map(p=>p.source)]):s.storageRanges??[],ranges=[s.range,s.vertexDomain?.range,...scoped,
    ...(state?.rowStorageRanges??[]),...(s.arrays??[]).map(a=>a.range),...(s.logicalNodes??[]).map(n=>({objectId:n.objectId,offset:n.offset,size:n.size})),
    ...[...s.nodes??[],...state?.nodes??[]].filter(n=>typeof n==='object').flatMap(n=>[n.range,n.storage,n.record])].filter(r=>r?.size>0);
  for(const r of Object.values(s.roles??{})){
    if(r?.objectId&&Number.isSafeInteger(r.offset)&&r.size>0)ranges.push(r);
    else if(s.ownerObjectId&&Number.isSafeInteger(r?.offset)&&r.size>0)ranges.push({objectId:s.ownerObjectId,offset:(s.ownerOffset??0)+r.offset,size:r.size});
  }
  for(const id of [s.containerId,s.arrayId].filter(Boolean))ranges.push(...structureStorageRanges(trace.structures.find(x=>x.id===id),trace,ctx,seen));
  const root=structureRootRange(s,trace);if(root)ranges.push(root);
  for(const id of [s.objectId,s.ownerObjectId,s.root?.objectId].filter(Boolean)){
    const o=trace.objects?.find(o=>o.id===id);if(o&&!(id===s.root?.objectId&&['pointer-slot','index-slot'].includes(s.root.kind))&&!ranges.some(r=>r.objectId===id))ranges.push({objectId:id,offset:0,size:o.size});
  }
  return ranges;
}
export function selectedStorageRanges(target,trace,ctx){
  const ranges=[...target.ranges??[]];
  for(const r of target.ranges??[]){
    const o=trace.objects.find(o=>o.id===r.objectId);
    // Opening a pointer box includes its current referent, not every past alias.
    if(!o||o.endedBy&&ctx.occurred(o.endedBy))continue;
    const e=trace.events.findLast(e=>ctx.occurred(e.eventId)&&overlaps(e.target,r)&&['READ','WRITE'].includes(e.kind));
    const exact=e?.target?.offset===r.offset&&e.target.size===r.size,
      type=exact?e.value?.cType??(r.offset===0&&r.size===o.size?o.cType:null):null,
      ref=exact&&type?.kind==='pointer'?e.value?.reference:null,dest=trace.objects.find(o=>o.id===ref?.targetObjectId);
    if(!dest||dest.endedBy&&ctx.occurred(dest.endedBy)||ref.status!=='in-bounds')continue;
    // Select the pointee, not the remainder of its allocation. Unknown pointee
    // extent supplies an address anchor only. Array views still overlap this
    // anchor; sibling records and their NULL slots are not selected implicitly.
    const offset=ref.targetOffset??0,bytes=type.pointee?.sizeBits/8;
    if(offset>=0&&offset<dest.size)ranges.push({objectId:dest.id,offset,size:Math.min(dest.size-offset,Number.isSafeInteger(bytes)&&bytes>0?bytes:1)});
  }
  return ranges;
}
export function structureTouches(s,target,trace,ctx){
  if(target.structureId)return s.id===target.structureId||s.kind==='ordered-tree-candidate'&&s.sourceStructureId===target.structureId;
  if(s.kind==='linked-structure'){
    const root=structureRootRange(s,trace);
    if(root&&target.ranges?.some(r=>overlaps(r,root)))return true;
    // Indirect selection follows current members, not another candidate's root
    // slot or its historical members. A directly selected empty root remains
    // selectable; a physical sentinel also remains a current member.
    const state=ctx.state(s),ids=new Set([state?.storageTopology,state?.topology,...(state?.roleTopologies??[]).map(p=>p.topology)]
      .flatMap(t=>t?.reachableNodeIds??[])),members=(s.logicalNodes??[]).filter(n=>ids.has(n.id));
    return selectedStorageRanges(target,trace,ctx).some(t=>members.some(n=>overlaps(t,n)));
  }
  const ranges=structureStorageRanges(s,trace,ctx);
  return selectedStorageRanges(target,trace,ctx).some(t=>ranges.some(r=>overlaps(t,r)));
}
