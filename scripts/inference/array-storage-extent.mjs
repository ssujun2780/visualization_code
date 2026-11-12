// Shared storage bounds for typed arrays and pointer-backed containers.
// An enclosing allocation is not the extent of a field inside that allocation.
import {compilerTypeIdentity} from './compiler-type-identity.mjs';

export function arrayStorageExtent(plan,{objects,events}){
  const identity=compilerTypeIdentity(plan.types),raw=new Map((plan.types??[]).map(t=>[t.id,t])),roots=new Map(),cache=new Map(),
    byObject=new Map(objects.map(o=>[o.id,o])),defs=new Map(plan.instructions.map(d=>[d.id,d])),indexed=new Map();
  const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
  for(const e of events)if(e.target&&['READ','WRITE'].includes(e.kind))
    for(const n of walk(defs.get(e.instructionId)?.expression))if(n.kind==='ArraySubscriptExpr'&&n.cType){
      if(!indexed.has(e.target.objectId))indexed.set(e.target.objectId,new Set());indexed.get(e.target.objectId).add(identity.key(n.cType));
    }
  function shape(id,seen=new Set()){
    if(cache.has(id))return cache.get(id);if(seen.has(id))return null;
    const t=raw.get(id);if(!t)return null;seen=new Set(seen).add(id);
    if(['DW_TAG_typedef','DW_TAG_const_type','DW_TAG_volatile_type','DW_TAG_restrict_type'].includes(t.tag)){
      const base=shape(t.baseType,seen);if(!base)return null;
      const out={...base,typeKey:identity.raw(id)};cache.set(id,out);return out;
    }
    let out={id,sizeBits:t.sizeBits};
    if(['DW_TAG_structure_type','DW_TAG_union_type'].includes(t.tag))out={...out,kind:'record',recordTypeId:id,
      members:(t.elements??[]).map(id=>raw.get(id)).filter(m=>m?.tag==='DW_TAG_member').map(m=>({...m,typeId:m.baseType}))};
    else if(t.tag==='DW_TAG_array_type'){
      const element=shape(t.baseType,seen);if(!element)return null;
      out=(t.dimensions??[]).reduceRight((elementType,count)=>({kind:'array',count,elementType,sizeBits:count*elementType.sizeBits}),element);
    }
    out={...out,typeKey:identity.raw(id)};cache.set(id,out);return out;
  }
  function add(id,offset,type){
    if(!['record','array'].includes(type?.kind)||!Number.isSafeInteger(offset))return;
    if(!roots.has(id))roots.set(id,new Map());roots.get(id).set(`${offset}:${identity.key(type)}`,{offset,type});
  }
  for(const o of objects)add(o.id,0,o.cType);
  for(const e of events){const ref=e.value?.reference;if(ref?.targetObjectId)add(ref.targetObjectId,ref.targetOffset??0,e.value?.cType?.pointee);}
  function descend(type,base,size,offset,wanted,root=true,depth=0){
    if(!type||depth>32||offset<base||offset>=base+size)return null;
    const key=type.typeKey??(type.kind==='record'||type.kind==='array'?identity.key(type):identity.raw(type.id));
    if(key===wanted)return root?null:{end:base+size,scalar:true};
    if(type.kind==='array'){
      const bytes=type.elementType?.sizeBits/8;if(!(bytes>0))return {end:base+size,scalar:false};
      const element=type.elementType,k=element.typeKey??(element.kind==='record'||element.kind==='array'?identity.key(element):identity.raw(element.id));
      if(k===wanted)return {end:base+size,scalar:false,array:true};
      return descend(element,base+Math.floor((offset-base)/bytes)*bytes,bytes,offset,wanted,false,depth+1);
    }
    if(type.kind==='record'){
      const members=(type.members??[]).filter(m=>offset>=base+m.offsetBits/8&&offset<base+(m.offsetBits+m.sizeBits)/8);
      const bounds=members.map(m=>descend(shape(m.typeId),base+m.offsetBits/8,m.sizeBits/8,offset,wanted,false,depth+1)??
        {end:base+(m.offsetBits+m.sizeBits)/8,scalar:identity.raw(m.typeId)===wanted});
      // Overlapping union alternatives do not disprove a declared array member.
      return bounds.find(b=>!b.scalar)??bounds[0]??null;
    }
    return {end:base+size,scalar:key===wanted};
  }
  return (objectId,type,offset,size)=>{
    const wanted=identity.key(type),o=byObject.get(objectId);
    const singleRecord=type.kind==='record'&&size===type.sizeBits/8&&o?.cType?.kind!=='array'&&!indexed.get(objectId)?.has(wanted);
    let scalar=false,subobject=false,array=false;
    for(const r of roots.get(objectId)?.values()??[]){
      const bound=descend(r.type,r.offset,r.type.sizeBits>0?r.type.sizeBits/8:(o?.size??0)-r.offset,offset,wanted);
      if(!bound)continue;subobject=true;size=Math.min(size,bound.end-offset);scalar||=bound.scalar;array||=bound.array??false;
    }
    return {size,scalar:scalar||singleRecord&&!array,subobject};
  };
}
