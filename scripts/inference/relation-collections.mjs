// Storage adapters for variable-length adjacency. Values remain observed data;
// following a link here never executes or rewrites a C operation.
export function* expandRelationLink(link,node,{read,memory,objects,at}){
  const s=link.source;
  if(!['span','chain'].includes(s.kind)){yield read(link,node);return;}
  const proof=new Set(),ranges=new Map();
  const observe=(item,owner=node)=>{
    const r=read(item,owner,node);
    if(r.executionId)proof.add(r.executionId);if(r.range)ranges.set(JSON.stringify(r.range),r.range);
    return r;
  };
  const finish=r=>({...r,evidenceExecutionIds:[...new Set([...proof,...r.executionId?[r.executionId]:[]])],viaRanges:[...ranges.values()]});
  const invalid=r=>r.issue||r.unknown;
  const coordinate=c=>typeof c==='number'?{value:String(c)}:observe({kind:'index',source:c,signed:c.signed});
  if(s.kind==='span'){
    const start=coordinate(s.start),extent=coordinate(s.count??s.end);
    if(invalid(start)||invalid(extent)){yield finish(invalid(start)?start:extent);return;}
    const first=BigInt(start.value),end=s.count!==undefined?first+BigInt(extent.value):BigInt(extent.value);
    if(first<0n||end<first||end>BigInt(Number.MAX_SAFE_INTEGER)){yield finish({issue:'relation-invalid-span',range:extent.range});return;}
    if(first===end){yield finish({terminal:true,termination:'empty-span',range:extent.range??start.range});return;}
    let storage=s.storage;
    if(storage.kind==='indirect'){
      const p=observe({kind:'pointer',source:storage.pointer});
      if(invalid(p)){yield finish(p);return;}
      const ref=p.reference,o=objects.get(ref?.targetObjectId);
      if(ref?.status==='unknown'){yield finish({...p,unknown:'relation-unresolved-target'});return;}
      if(p.terminal||!ref||ref.status!=='in-bounds'||ref.onePast){yield finish({issue:'relation-invalid-span-pointer',range:p.range});return;}
      if(!memory.alive(o?.id,at)){yield finish({issue:'relation-dangling-target',range:p.range,reference:ref});return;}
      storage={...storage,objectId:o.id,offset:ref.targetOffset,count:Math.max(0,Math.floor((o.size-ref.targetOffset-storage.size)/storage.stride)+1)};
    }
    if(end>BigInt(storage.count)){yield finish({issue:'relation-span-out-of-range',range:extent.range,value:String(end)});return;}
    const controlProof=[...proof],controlRanges=[...ranges];
    for(let i=Number(first);i<Number(end);i++){
      proof.clear();ranges.clear();for(const id of controlProof)proof.add(id);for(const [k,r]of controlRanges)ranges.set(k,r);
      const r=observe({...link,source:{kind:'slot',objectId:storage.objectId,offset:storage.offset+i*storage.stride,size:storage.size}});
      yield finish({...r,itemIndex:i});if(r.unknown==='relation-query-limit')return;
    }
    return;
  }
  const seen=new Set(),entry=s.entries;let pointer=observe(s.head),encoding=s.head,index=0;
  const headProof=[...proof],headRanges=[...ranges];
  while(true){
    proof.clear();ranges.clear();for(const id of headProof)proof.add(id);for(const [k,r]of headRanges)ranges.set(k,r);
    if(pointer.executionId)proof.add(pointer.executionId);if(pointer.range)ranges.set(JSON.stringify(pointer.range),pointer.range);
    if(invalid(pointer)){yield finish(pointer);return;}
    if(pointer.terminal||encoding.kind==='index'&&encoding.nullValues.includes(pointer.value)){yield finish({...pointer,terminal:true,termination:'chain-end'});return;}
    let range;
    if(encoding.kind==='index'){
      const i=BigInt(pointer.value)-BigInt(encoding.indexBase);
      if(i<0n||i>=BigInt(entry.count)){yield finish({...pointer,issue:'relation-container-index-out-of-range'});return;}
      range={objectId:entry.objectId,offset:entry.offset+Number(i)*entry.stride,size:entry.size};
    }else{
      const ref=pointer.reference,o=objects.get(ref?.targetObjectId);
      if(ref?.status==='unknown'){yield finish({...pointer,unknown:'relation-unresolved-target'});return;}
      if(ref?.status!=='in-bounds'||ref.onePast){yield finish({...pointer,issue:'relation-invalid-container-pointer'});return;}
      if(!o||ref.targetOffset<0||ref.targetOffset+entry.size>o.size){yield finish({...pointer,issue:'relation-container-out-of-range'});return;}
      if(entry.kind==='array'&&(o.id!==entry.objectId||ref.targetOffset<entry.offset||(ref.targetOffset-entry.offset)%entry.stride||
        (ref.targetOffset-entry.offset)/entry.stride>=entry.count)){yield finish({...pointer,issue:'relation-container-out-of-range'});return;}
      range={objectId:o.id,offset:ref.targetOffset,size:entry.size};
    }
    if(!memory.alive(range.objectId,at)){yield finish({...pointer,issue:'relation-dangling-target'});return;}
    const id=JSON.stringify(range);if(seen.has(id)){yield finish({...pointer,issue:'relation-container-cycle'});return;}seen.add(id);
    const owner={range},value=observe({...link,source:s.item},owner);
    yield finish({...value,itemIndex:index++});if(value.unknown==='relation-query-limit')return;
    pointer=observe(s.next,owner);encoding=s.next;
  }
}
