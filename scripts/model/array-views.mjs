import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {compilerTypeIdentity} from './compiler-type-identity.mjs';
import {arrayGeometry} from './array-geometry.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const integer=t=>t?.signedness&&t.sizeBits>0;
function member(n){
  n=unwrap(n);if(n?.kind!=='MemberExpr'||!n.fieldNodeId)return null;
  const base=n.children?.[0]?.cType,record=base?.kind==='pointer'?base.pointee:base,last=n.targetPath?.at(-1);
  if(!record?.recordTypeId||!last)return null;
  return {fieldNodeId:n.fieldNodeId,path:n.memberPath,recordTypeId:record.recordTypeId,
    offset:last.offsetBits/8,size:last.sizeBits/8,cType:n.cType};
}
const same=(a,b)=>a&&b&&a.fieldNodeId===b.fieldNodeId;
const unique=a=>[...new Map(a.map(m=>[m.fieldNodeId,m])).values()];
export function bindArrayStructures(plan){
  const nodes=new Map();
  for(const d of plan.instructions)for(const root of [d.expression,...d.arguments??[]])for(const n of walk(root))nodes.set(n.nodeId,n);
  const comparisons=[...nodes.values()].filter(n=>n.kind==='BinaryOperator'&&['==','<','<=','>','>='].includes(n.operator));
  const candidates=new Map(),indexed=new Map(),unresolved=[];
  // A field occurring anywhere in an index is not necessarily the index:
  // remainder divisors bound the result, and multiplication can express stride.
  const directIndex=n=>{n=unwrap(n);return n?.kind==='UnaryOperator'&&['++','--'].includes(n.operator)?member(n.children[0]):member(n);};
  const comparedTo=field=>unique(comparisons.flatMap(n=>{
    const [a,b]=n.children.map(member);return same(a,field)&&b?[b]:same(b,field)&&a?[a]:[];
  }));
  const updates=new Map();
  for(const n of nodes.values())if(n.kind==='UnaryOperator'&&['++','--'].includes(n.operator)||
    n.kind==='CompoundAssignOperator'&&['+=','-='].includes(n.operator)){
    const f=member(n.children[0]);if(f){if(!updates.has(f.fieldNodeId))updates.set(f.fieldNodeId,[]);updates.get(f.fieldNodeId).push(n.nodeId);}
  }
  function add(data,index,stride,evidence,accessNodeId){
    if(!data||!index||!integer(index.cType)||data.recordTypeId!==index.recordTypeId)return;
    const caps=comparedTo(index).filter(f=>integer(f.cType)&&!same(f,index)&&f.recordTypeId===data.recordTypeId&&!same(f,stride?.field));
    if(caps.length!==1){if(caps.length)unresolved.push({accessNodeId,data,index,capacityCandidates:caps,reason:'multiple compiler bounds'});return;}
    for(const capacity of caps){
      const key=`${data.fieldNodeId}:${index.fieldNodeId}:${capacity.fieldNodeId}:${stride?.field?.fieldNodeId??stride?.bytes??'copy'}`;
      if(!candidates.has(key))candidates.set(key,{id:`array-role${candidates.size+1}`,recordTypeId:data.recordTypeId,
        data,index,capacity,stride,accessNodeId,evidence:[evidence,'compiler field comparison with index role']});
    }
  }
  for(const n of nodes.values()){
    if(n.kind==='ArraySubscriptExpr'){
      const data=member(n.children[0]),index=unwrap(n.children[1]);
      if(data?.cType.kind!=='pointer'||!(data.cType.pointee?.sizeBits>0))continue;
      if(index?.kind==='BinaryOperator'&&index.operator==='%'){
        const capacity=member(index.children[1]);
        if(capacity&&integer(capacity.cType)&&capacity.recordTypeId===data.recordTypeId){
          const key=`${data.fieldNodeId}:${capacity.fieldNodeId}`;
          if(!indexed.has(key))indexed.set(key,{id:`indexed-storage:${key}`,recordTypeId:data.recordTypeId,data,capacity,
            cardinalityCandidates:comparedTo(capacity).filter(f=>integer(f.cType)&&f.recordTypeId===data.recordTypeId&&updates.has(f.fieldNodeId))
              .map(f=>({...f,updateNodeIds:updates.get(f.fieldNodeId),evidence:'separate compiler field comparison and arithmetic updates; cardinality candidate only'})),
            elementBytes:data.cType.pointee.sizeBits/8,accesses:[],evidence:['compiler remainder divisor bounds an indexed access','capacity requires observed allocation extent validation; cardinality is not prefix length']});
          indexed.get(key).accesses.push({nodeId:n.nodeId,indexNodeId:index.nodeId,role:'modulo-index',divisorFieldNodeId:capacity.fieldNodeId});
        }
        continue;
      }
      add(data,directIndex(index),{bytes:data.cType.pointee.sizeBits/8},'compiler direct typed array index',n.nodeId);
    }
  }
  // Copy destinations carry the same stride/index relation even through void*.
  for(const d of plan.instructions.filter(d=>d.action==='call'&&d.arguments?.length===3)){
    const destination=unwrap(d.arguments[0]);
    if(destination?.kind!=='BinaryOperator'||destination.operator!=='+')continue;
    const data=member(destination.children[0]);if(data?.cType.kind!=='pointer')continue;
    const size=unwrap(d.arguments[2]),sizeField=member(size),sizeBytes=size?.sizeof?.byteSize??
      (size?.kind==='IntegerLiteral'?Number(size.literal):null),stride=sizeField?{field:sizeField}:sizeBytes>0?{bytes:sizeBytes}:null;
    const scaled=unwrap(destination.children[1]);
    if(scaled?.kind!=='BinaryOperator'||scaled.operator!=='*'||!stride)continue;
    const matches=n=>sizeField?same(member(n),sizeField):((n=unwrap(n))?.sizeof?.byteSize??(n?.kind==='IntegerLiteral'?Number(n.literal):null))===sizeBytes;
    const [a,b]=scaled.children,index=matches(a)?directIndex(b):matches(b)?directIndex(a):null;
    if(index)add(data,index,stride,'compiler multiplication separates index and transfer stride',d.sourceNodeId);
  }
  plan.structureBindings={arrayRoles:[...candidates.values()],indexedStorageRoles:[...indexed.values()],unresolvedArrayRoles:unresolved,evidence:'compiler member identities and operator roles'};
  plan.coverage.structureInference={arrayRoleCandidates:candidates.size,indexedStorageCandidates:indexed.size,unresolvedArrayRoles:unresolved.length,
    source:'compiler operator roles + field identities + observed range evidence',classification:'candidates, not a proof of algorithm identity'};
  bindEmbeddedArrays(plan);
}

// Build lazy views over recorded ranges. This adds no program objects or READs.
export function arrayStructures(plan,{events,objects,views}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byObject=new Map(objects.map(o=>[o.id,o])),
    roles=plan.structureBindings?.arrayRoles??[],contexts=new Map(),arrays=new Map(),executionDefs=new Map(events.map(e=>[e.eventId,defs.get(e.instructionId)])),
    alive=new Set(),fieldAccess=new Map(),typed=new Map(),definitionNodes=new Map(),viewsByObject=new Map(),typeIdentity=compilerTypeIdentity(plan.types),indexedTypes=new Map();
  const visible=o=>o&&executionDefs.get(o.createdBy)?.visibility!=='implementation';
  // A pointer to a record field describes that subobject, not an array over
  // every byte of the enclosing allocation. Collect compiler-backed record
  // ranges first so pointer-observation order cannot change the extent.
  const records=new Map();
  function recordRange(id,offset,type){
    if(type?.kind!=='record'||!Number.isInteger(offset))return;
    if(!records.has(id))records.set(id,new Map());
    records.get(id).set(`${offset}:${type.recordTypeId}`,{offset,type});
  }
  for(const o of objects)recordRange(o.id,0,o.cType);
  for(const e of events){const r=e.value?.reference; if(r?.targetObjectId)recordRange(r.targetObjectId,r.targetOffset,e.value?.cType?.pointee);}
  for(const v of views){if(!viewsByObject.has(v.objectId))viewsByObject.set(v.objectId,[]);viewsByObject.get(v.objectId).push(v.id);}
  const viewIds=id=>viewsByObject.get(id)??[];
  for(const d of plan.instructions){
    const expression=walk(d.expression);definitionNodes.set(d.id,new Set(expression.map(n=>n.nodeId)));
    const fields=expression.filter(n=>n.kind==='MemberExpr'&&n.fieldNodeId&&
      (!d.memberPath||JSON.stringify(n.memberPath)===JSON.stringify(d.memberPath))).map(member).filter(Boolean);
    if(fields.length)fieldAccess.set(d.id,fields[0]);
  }
  // Explicit subscript observations distinguish a real single-element array
  // from merely taking the address of a single record or scalar field.
  for(const e of events)if(e.target&&['READ','WRITE'].includes(e.kind)){
    for(const n of walk(defs.get(e.instructionId)?.expression))if(n.kind==='ArraySubscriptExpr'&&n.cType){
      if(!indexedTypes.has(e.target.objectId))indexedTypes.set(e.target.objectId,new Set());indexedTypes.get(e.target.objectId).add(typeIdentity.key(n.cType));
    }
  }
  const typeViewId=type=>JSON.stringify([type.id,type.name,typeIdentity.key(type)]);
  function addTypeView(array,type,evidence){
    if(!array.elementTypeViews.some(t=>typeViewId(t)===typeViewId(type)))array.elementTypeViews.push(type);
    if(!array.evidence.includes(evidence))array.evidence.push(evidence);
  }
  function typedArray(id,type,evidence,offset=0,size=null,declared=false){
    const o=byObject.get(id),bytes=type?.sizeBits/8;if(!o||!visible(o)||!(bytes>0)||offset<0||offset>=o.size)return;
    size??=o.size-offset;
    // A declared scalar record remains one record box. Merely taking its
    // address for a value copy does not establish another user array.
    if(!declared&&size===bytes&&type.kind==='record'&&!indexedTypes.get(id)?.has(typeIdentity.key(type)))return;
    for(const record of records.get(id)?.values()??[]){
      if(type.recordTypeId&&type.recordTypeId===record.type.recordTypeId)continue;
      const part=record.type.members.find(m=>offset>=record.offset+m.offsetBits/8&&offset<record.offset+(m.offsetBits+m.sizeBits)/8);
      if(part){
        size=Math.min(size,record.offset+(part.offsetBits+part.sizeBits)/8-offset);evidence='compiler subobject extent + observed pointer target';
        if(!declared&&!typeIdentity.isArray(part.typeId)&&offset===record.offset+part.offsetBits/8&&size===bytes&&
          typeIdentity.raw(part.typeId)===typeIdentity.key(type))return;
      }
    }
    if(size<=0||size%bytes||offset+size>o.size)return;
    const canonical=typeIdentity.key(type),key=`${id}:${offset}:${size}:${canonical}`,inherited=[];
    for(const [k,a] of arrays)if(a.objectId===id&&a.canonicalElementType===canonical){
      if(a.range.offset<=offset&&a.range.offset+a.range.size>=offset+size){addTypeView(a,type,evidence);return;}
      if(offset<=a.range.offset&&offset+size>=a.range.offset+a.range.size){inherited.push(a);arrays.delete(k);}
    }
    if(!arrays.has(key))arrays.set(key,{id:`array:${key}`,kind:'array',objectId:id,nodes:viewIds(id),edges:[],
      range:{objectId:id,offset,size},storageIdentity:`storage:${id}:${offset}:${size}`,canonicalElementType:canonical,
      elementBytes:bytes,elementType:type,elementTypeViews:[type],capacity:size/bytes,
      lifecycle:o.lifecycle,snapshot:'recorded typed range; may include ended storage',evidence:[evidence]});
    for(const old of inherited)for(const t of old.elementTypeViews)for(const why of old.evidence)addTypeView(arrays.get(key),t,why);
    if(offset===0&&size===o.size){if(!typed.has(id))typed.set(id,new Map());typed.get(id).set(canonical,type);}
  }
  for(const o of objects)if(o.cType?.kind==='array')typedArray(o.id,o.cType.elementType,'compiler array extent',0,o.size,true);
  const fields=role=>[role.data,role.index,role.capacity,...(role.stride?.field?[role.stride.field]:[])];
  function context(o,role,base=0){
    if(!visible(o)||!Number.isSafeInteger(base)||base<0||fields(role).some(f=>base+f.offset<0||base+f.offset+f.size>o.size))return null;
    const key=`${o.id}:${base}:${role.id}`;let c=contexts.get(key);
    if(!c)contexts.set(key,c={id:`dynamic-array:${key}`,kind:'dynamic-array',ownerObjectId:o.id,ownerOffset:base,
      recordTypeId:role.recordTypeId,role,values:new Map(),bytes:new Map(),states:[],evidence:role.evidence.slice(),verified:false});
    return c;
  }
  for(const o of objects)for(const role of roles)if(o.cType?.recordTypeId===role.recordTypeId)context(o,role);
  function current(c,e){
    const r=c.role,get=f=>c.values.get(f.fieldNodeId),address=get(r.data),length=get(r.index),capacity=get(r.capacity),
      stride=r.stride.field?get(r.stride.field):r.stride.bytes;
    const backing=alive.has(c.backingOriginId)?byObject.get(c.backingOriginId):null,
      offset=backing?address-backing.address:0,available=backing&&stride>0?(backing.size-offset)/stride:null,
      valid=Number.isSafeInteger(length)&&length>=0&&Number.isSafeInteger(capacity)&&capacity>=length&&stride>0&&
        (capacity===0&&address===0||backing&&capacity<=available);
    if(valid&&backing&&capacity>0&&c.hasAccess&&alive.has(c.ownerObjectId))c.verified=true;
    const ownerAlive=alive.has(c.ownerObjectId),state={afterExecutionId:e.eventId,backingObjectId:backing?.id??null,
      dataAddress:address??null,pointerOriginObjectId:c.backingOriginId??null,byteOffset:offset,length:length??null,capacity:capacity??null,elementBytes:stride??null,
      unknownFields:fields(r).filter(f=>get(f)===undefined).map(f=>f.fieldNodeId),
      status:valid?'consistent':'intermediate-or-unavailable',ownerAlive,storageAlive:!!backing,active:ownerAlive&&!!backing};
    const previous=c.states.at(-1);
    if(!previous||JSON.stringify({...previous,afterExecutionId:null})!==JSON.stringify({...state,afterExecutionId:null}))c.states.push(state);
  }
  function setValue(c,field,value,origin){
    if(value===null){c.values.delete(field.fieldNodeId);if(same(field,c.role.data)){c.backingOriginId=null;c.originObserved=true;}return;}
    const changed=c.values.get(field.fieldNodeId)!==value;c.values.set(field.fieldNodeId,value);
    if(same(field,c.role.data)&&(changed||!c.originObserved||origin!==undefined)){
      c.backingOriginId=origin??[...alive].map(id=>byObject.get(id)).find(o=>value>=o.address&&value<o.address+o.size)?.id??null;
      c.originObserved=true;
    }
  }
  for(const e of events){
    if(e.action==='object.begin')alive.add(e.objectId);
    if(e.action==='object.end')alive.delete(e.objectId);
    if(e.action==='frame.end')for(const id of e.endedObjects??[])alive.delete(id);
    const pointer=e.value?.cType;
    if(pointer?.kind==='pointer'&&pointer.pointee?.sizeBits>0&&e.value.reference?.targetObjectId){
      const target=byObject.get(e.value.reference.targetObjectId);if(target?.storage==='heap')typedArray(target.id,pointer.pointee,'observed typed pointer target',e.value.reference.targetOffset??0);
    }
    if(e.action==='copy'){
      const source=byObject.get(e.sourceObjectId),sourceTypes=source?.cType?.kind==='array'?[source.cType.elementType]:[...(typed.get(e.sourceObjectId)?.values()??[])];
      for(const type of sourceTypes)if(e.target?.size>=type.sizeBits/8&&(e.sourceOffset??0)%(type.sizeBits/8)===0)
        // Copying one array element into a scalar record does not declare an
        // array at the destination. Declared/indexed arrays retain their own evidence.
        typedArray(e.target.objectId,type,'observed copy from compiler-typed source range',e.target.offset??0,e.target.size);
    }
    if(e.copiedFrom)for(const type of typed.get(e.copiedFrom.objectId)?.values()??[])typedArray(e.objectId,type,'observed retained range across reallocation',0,null,true);
    const f=fieldAccess.get(e.instructionId),o=byObject.get(e.target?.objectId);
    if(f&&o&&['READ','WRITE'].includes(e.kind))for(const role of roles){
      const own=fields(role).find(x=>same(x,f));if(!own)continue;
      const c=context(o,role,e.target.offset-own.offset);if(!c)continue;
      const raw=own.cType.kind==='pointer'?e.value?.address:own.cType.signedness==='signed'?e.value?.signed??e.value?.decimal:e.value?.unsigned??e.value?.decimal;
      const observed=observeScalarBytes(c.bytes.get(own.fieldNodeId),{size:own.size,signed:own.cType.signedness==='signed',value:raw});
      if(observed){c.bytes.set(own.fieldNodeId,observed);setValue(c,own,observed.value,own.cType.kind==='pointer'?e.value?.reference?.targetObjectId:undefined);}
    }
    if(e.memoryState&&['WRITE','SPACE'].includes(e.kind)){
      const target=byObject.get(e.target?.objectId??e.objectId),start=e.target?.offset??0;
      for(const c of contexts.values())if(c.ownerObjectId===target?.id)for(const own of fields(c.role)){
        const observed=observeScalarBytes(c.bytes.get(own.fieldNodeId),{size:own.size,signed:own.cType.signedness==='signed',
          snapshot:e.memoryState,start,offset:c.ownerOffset+own.offset});
        const original=contexts.get(`${e.sourceObjectId}:${(e.sourceOffset??0)+c.ownerOffset-start}:${c.role.id}`);
        if(observed){c.bytes.set(own.fieldNodeId,observed);setValue(c,own,observed.value,same(own,c.role.data)?original?.backingOriginId:undefined);}
      }
    }
    if(e.kind==='WRITE'&&e.target?.objectId)for(const c of contexts.values()){
      const data=c.values.get(c.role.data.fieldNodeId),target=byObject.get(e.target.objectId),d=defs.get(e.instructionId);
      if(target&&c.backingOriginId===target.id&&data>=target.address&&data<target.address+target.size&&
        (d.sourceNodeId===c.role.accessNodeId||definitionNodes.get(d.id)?.has(c.role.accessNodeId)))c.hasAccess=true;
    }
    for(const c of contexts.values())current(c,e);
  }
  const dynamic=[...contexts.values()].filter(c=>c.verified||c.hasAccess).map(c=>{
    const {values,bytes,verified,...description}=c,last=c.states.filter(s=>s.status==='consistent'&&s.active).at(-1),
      objects=[...new Set(c.states.map(s=>s.backingObjectId).filter(Boolean))];
    const observed=last??c.states.findLast(s=>s.backingObjectId),
      elementTypes=[...(typed.get(observed?.backingObjectId)?.values()??[])].filter(t=>t.sizeBits===observed.elementBytes*8);
    return {...description,nodes:[...new Set([c.ownerObjectId,...objects].flatMap(viewIds))],edges:[],
      backingHistory:objects,latestValidState:last,elementType:elementTypes.length===1?elementTypes[0]:null,elementTypeCandidates:elementTypes,
      lifecycle:byObject.get(c.ownerObjectId)?.lifecycle??'unknown',confidence:verified?'candidate validated by observed bounds and allocation extent':'observed indexed writes with inconsistent or incomplete bounds',
      snapshot:'execution history; states retain actual lifetimes'};
  });
  return [...arrays.values(),...dynamic,...embeddedArrayStructures(plan,{events,objects,views})]
    .map(s=>s.kind==='array'?{...s,geometry:arrayGeometry(s,byObject.get(s.objectId))}:s);
}
import {bindEmbeddedArrays,embeddedArrayStructures} from './embedded-array-views.mjs';
