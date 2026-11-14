import {inferredArrayAnchor} from './inferred-role-anchors.mjs';
const integer=Number.isSafeInteger;
const slot=r=>r?.objectId&&integer(r.offset)&&r.offset>=0&&integer(r.size)&&r.size>0?
  {objectId:r.objectId,offset:r.offset,size:r.size}:null;
const valueType=t=>t?{kind:t.kind,sizeBits:t.sizeBits,signedness:t.signedness??null,encoding:t.encoding??null}:null;
// A candidate's stable identity is its storage AND semantic roles. States,
// sampled values, names, evidence IDs and array lengths are not identities.
export function semanticCandidateAnchor(s,trace,plan,describe=null){
  const array=id=>{const child=trace.structures?.find(x=>x.id===id);return child?.kind!=='array'?null:describe?describe(child)?.storage??null:inferredArrayAnchor(child,trace);},storage=array(s.arrayId),kind=s.kind;
  const constituent=id=>describe?.(trace.structures?.find(x=>x.id===id));
  if(kind==='deferred-update-candidate'){
    const aggregate=constituent(s.aggregateId),tags=array(s.tagArrayId);
    const addition=s.tagSchema==='affine-pair'?array(s.tagAddArrayId):null;
    return aggregate&&tags&&(!s.tagSchema||addition)?{kind,aggregate,tags,...addition?{tagSchema:s.tagSchema,addition}:{}}:null;
  }
  if(kind==='pointer-partition-candidate')return s.typeId&&integer(s.fieldOffset)&&s.fieldOffset>=0?
    {kind,recordTypeId:s.typeId,parentFieldOffset:s.fieldOffset}:null;
  if(kind==='partition-selection-candidate'){
    const partition=constituent(s.partitionId),source=array(s.sourceArrayId),target=array(s.targetArrayId);
    return partition&&source&&target?{kind,partition,source,target}:null;
  }
  // This producer is a run-wide collection of peer-root sharing. Current
  // pairs grow/shrink; they are contents, not the identity of that collection.
  if(kind==='shared-substructure-candidate')return s.sharingScope==='all-observed-peer-roots'?
    {kind,scope:s.sharingScope}:null;
  if(['queue-candidate','cursor-interval-candidate'].includes(kind)){
    if(!storage||!slot(s.roles?.front)||!slot(s.roles?.back))return null;
    const roles={};for(const name of ['front','back','count','full'])if(s.roles[name]){
      roles[name]=slot(s.roles[name]);if(!roles[name])return null;
    }
    return {kind,storage,layout:s.layout??'linear',roles,indexOffset:s.roles.indexOffset??0};
  }
  if(kind==='range-aggregate-candidate')return storage?{kind,storage}:null;
  if(kind==='representative-partition-candidate')return storage&&integer(s.fieldOffset)&&s.fieldSize>0?
    {kind,storage,fieldOffset:s.fieldOffset,fieldSize:s.fieldSize}:null;
  if(kind==='index-tree'){
    const d=s.descriptor;if(!storage||![d?.degree,d?.base,d?.firstChildOffset].every(integer))return null;
    return {kind,storage,degree:d.degree,base:d.base,firstChildOffset:d.firstChildOffset,
      orderingProperty:s.orderingProperty?{offset:s.orderingProperty.offset,size:s.orderingProperty.size,type:valueType(s.orderingProperty.type)}:null};
  }
  if(kind==='composite-priority-candidate'){
    if(!storage||!s.components?.length)return null;
    const byId=new Map(trace.events.map(e=>[e.eventId,e]));
    const policies=new Set();for(const p of s.paths??[]){
      const ret=byId.get(p.returnExecutionId),call=byId.get(ret?.callExecutionId);
      if(!call?.resolvedFunctionId)return null;policies.add(call.resolvedFunctionId);
    }
    if(policies.size!==1)return null;
    // Observed key fields grow as new comparison paths run. They are evidence,
    // not candidate identity: a realloc need not repeat every tie branch.
    const records=new Set(s.components.map(c=>c.recordTypeId??c.typeId));
    if(records.size!==1||!records.values().next().value)return null;
    return {kind,storage,comparator:{functionId:[...policies][0],recordTypeId:[...records][0],returnConvention:s.returnConvention??'truth'}};
  }
  if(kind==='associative-lookup-candidate'){
    const buckets=array(s.bucketArrayId),k=s.roles?.key;if(!buckets||!k||!integer(k.offset)||!(k.size>0))return null;
    const keyStorage=array(k.arrayId);if(!keyStorage&&!k.recordTypeId)return null;
    return {kind,buckets,representation:s.representation,key:{storage:keyStorage,recordTypeId:k.recordTypeId??null,
      fieldNodeId:k.fieldNodeId??null,offset:k.offset,size:k.size,type:valueType(k.type)}};
  }
  return null;
}
