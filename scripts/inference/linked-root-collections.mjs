import {observeScalarBytes} from './observed-scalar-bytes.mjs';

const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const family=t=>t?.kind==='pointer'&&t.pointee?.kind==='record'?t.pointee.recordTypeId:null;
const sameState=(a,b)=>a&&JSON.stringify({...a,afterExecutionId:null})===JSON.stringify({...b,afterExecutionId:null});
function field(n){
  n=unwrap(n);const base=n?.children?.[0]?.cType,record=base?.kind==='pointer'?base.pointee:base,part=n?.targetPath?.at(-1);
  return n?.kind==='MemberExpr'&&n.fieldNodeId&&record?.recordTypeId&&part?
    {fieldNodeId:n.fieldNodeId,recordTypeId:record.recordTypeId,path:n.memberPath,offset:part.offsetBits/8,size:part.sizeBits/8,cType:n.cType}:null;
}

// Indexed owner fields establish an association candidate independently of
// semantic capacity/count roles. No source name or algorithm label is used.
export function bindLinkedRootCollections(plan){
  const families=new Set((plan.structureBindings?.linkRoles??[]).map(r=>r.recordTypeId)),fields=new Map();
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk)){
    if(n.kind!=='ArraySubscriptExpr'||!families.has(family(n.cType)))continue;
    const data=field(n.children[0]);if(!data)continue;
    if(!fields.has(data.fieldNodeId))fields.set(data.fieldNodeId,{id:`root-field:${data.fieldNodeId}`,recordTypeId:data.recordTypeId,
      data,elementBytes:n.cType.sizeBits/8,nodeRecordTypeId:family(n.cType),accessNodeIds:[],
      evidence:['compiler indexed pointer field and recurrent node family']});
    fields.get(data.fieldNodeId).accessNodeIds.push(n.nodeId);
  }
  plan.structureBindings.linkRootFields=[...fields.values()];
}

// A range requires both a compiler-backed element extent and an actual slot
// access whose AST indexes that element type. Allocation bytes alone are not
// sufficient evidence that an arbitrary pointer slot is a root collection.
export function linkedRootRanges(plan,{events,objects,arrays=[]}){
  const families=new Set((plan.structureBindings?.linkRoles??[]).map(r=>r.recordTypeId)),byObject=new Map(objects.map(o=>[o.id,o])),
    indexed=new Map(plan.instructions.map(d=>[d.id,new Set(walk(d.expression).filter(n=>n.kind==='ArraySubscriptExpr').map(n=>family(n.cType)).filter(Boolean))]));
  const candidates=arrays.filter(a=>a.kind==='array');
  for(const o of objects)if(o.cType?.kind==='array'&&!candidates.some(a=>a.objectId===o.id))candidates.push({id:null,objectId:o.id,
    range:{objectId:o.id,offset:0,size:o.size},elementType:o.cType.elementType,elementBytes:o.cType.elementType.sizeBits/8});
  const ranges=new Map();
  for(const a of candidates){
    const recordTypeId=family(a.elementType),o=byObject.get(a.objectId),size=a.elementBytes;
    if(!families.has(recordTypeId)||!o||!(size>0)||a.range.offset<0||a.range.size<=0||a.range.offset+a.range.size>o.size||a.range.size%size)continue;
    const evidence=events.filter(e=>['READ','WRITE'].includes(e.kind)&&e.target?.objectId===o.id&&family(e.value?.cType)===recordTypeId&&
      e.target.offset>=a.range.offset&&e.target.offset+size<=a.range.offset+a.range.size&&(e.target.offset-a.range.offset)%size===0&&indexed.get(e.instructionId)?.has(recordTypeId));
    if(!evidence.length)continue;
    const key=`${o.id}:${a.range.offset}:${a.range.size}:${recordTypeId}`;
    if(!ranges.has(key))ranges.set(key,{id:`root-collection:${key}`,arrayId:a.id,objectId:o.id,recordTypeId,
      range:a.range,elementBytes:size,capacity:a.range.size/size,evidenceExecutionIds:evidence.map(e=>e.eventId)});
  }
  return [...ranges.values()];
}

export function linkedRootCollections(plan,{events,objects,views,arrays=[],linked=[]}){
  const ranges=linkedRootRanges(plan,{events,objects,arrays}),byObject=new Map(objects.map(o=>[o.id,o])),
    viewIds=id=>views.filter(v=>v.objectId===id).map(v=>v.id),alive=new Set(),currentRoots=new Map();
  if(!ranges.length)return [];
  const collections=ranges.map(r=>({...r,kind:'linked-root-collection',scope:'backing-range',nodes:viewIds(r.objectId),edges:[],states:[],
    origin:'inferred',classification:'candidate',intent:'unconfirmed',
    rootStructureIds:linked.filter(c=>c.root.kind==='pointer-slot'&&c.root.objectId===r.objectId&&c.root.recordTypeId===r.recordTypeId&&
      c.root.offset>=r.range.offset&&c.root.offset<r.range.offset+r.range.size).map(c=>c.id),
    evidence:['compiler typed array range within allocation','observed indexed pointer slots','compiler recurrent node family'],
    membershipPolicy:'directed members of observed root slots; unknown slots are not empty and node count is not an active prefix',
    confidence:'inferred collection of observed roots; semantic structure and user intent remain unconfirmed'})).filter(c=>c.rootStructureIds.length);
  const linkedById=new Map(linked.map(c=>[c.id,c])),rootUpdates=new Map();
  for(const c of linked)for(const s of c.states){if(!rootUpdates.has(s.afterExecutionId))rootUpdates.set(s.afterExecutionId,[]);rootUpdates.get(s.afterExecutionId).push([c.id,s]);}
  const roles=(plan.structureBindings?.linkRootFields??[]).map(role=>{
    const indexed=(plan.structureBindings?.indexedStorageRoles??[]).find(r=>r.data.fieldNodeId===role.data.fieldNodeId);
    return {...role,capacity:indexed?.capacity??null,cardinalityCandidates:indexed?.cardinalityCandidates??[],
      indexRelations:indexed?.accesses??[],evidence:[...role.evidence,...indexed?.evidence??[]]};
  }),contexts=new Map(),fields=r=>[r.data,...r.capacity?[r.capacity]:[],...r.cardinalityCandidates];
  function context(objectId,offset,role){
    const o=byObject.get(objectId);if(!o||!Number.isInteger(offset)||offset<0||fields(role).some(f=>offset+f.offset+f.size>o.size))return;
    const key=`${objectId}:${offset}:${role.data.fieldNodeId}`;
    if(!contexts.has(key))contexts.set(key,{id:`owner-root-collection:${key}`,kind:'linked-root-collection',scope:'owner-field',
      origin:'inferred',classification:'candidate',intent:'unconfirmed',
      ownerObjectId:objectId,ownerOffset:offset,recordTypeId:role.recordTypeId,role,values:new Map(),bytes:new Map(),references:new Map(),states:[],backingIds:new Set()});
  }
  for(const o of objects)for(const role of roles)if(o.cType?.recordTypeId===role.recordTypeId)context(o.id,0,role);
  for(const e of events)for(const role of roles){
    const ref=e.value?.reference;if(ref?.targetObjectId&&e.value.cType?.pointee?.recordTypeId===role.recordTypeId)context(ref.targetObjectId,ref.targetOffset??0,role);
  }
  const accessFields=new Map();
  for(const d of plan.instructions){
    const candidates=walk(d.expression).filter(n=>n.kind==='MemberExpr'&&(!d.memberPath||JSON.stringify(d.memberPath)===JSON.stringify(n.memberPath))).map(field).filter(Boolean);
    // The IR access type prevents a nested base member from being mistaken
    // for the pointer-array element being read or written.
    accessFields.set(d.id,candidates.filter(f=>f.cType.id===d.cType?.id||f.cType.kind===d.cType?.kind&&f.cType.sizeBits===d.cType?.sizeBits&&
      (f.cType.kind!=='pointer'||f.cType.pointee?.kind===d.cType?.pointee?.kind)));
  }
  for(const e of events)if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId)for(const f of accessFields.get(e.instructionId)??[])for(const role of roles)
    if(fields(role).some(own=>own.fieldNodeId===f.fieldNodeId))context(e.target.objectId,e.target.offset-f.offset,role);
  function resolve(address){
    if(address===0)return {status:'null',targetObjectId:null,targetOffset:0};
    const o=[...alive].map(id=>byObject.get(id)).find(o=>address>=o.address&&address<o.address+o.size);
    return o?{status:'in-bounds',targetObjectId:o.id,targetOffset:address-o.address,evidence:'recorded snapshot and live allocation range'}:
      {status:'unresolved',targetObjectId:null,targetOffset:null,address};
  }
  function observe(c,f,observed,reference){
    if(!observed)return;c.bytes.set(f.fieldNodeId,observed);
    const prior=c.values.get(f.fieldNodeId);c.values.set(f.fieldNodeId,observed.value);
    if(f.fieldNodeId!==c.role.data.fieldNodeId)return;
    const old=c.references.get(f.fieldNodeId),next=observed.value===null?{status:'unknown',targetObjectId:null,targetOffset:null}:
      reference??(prior===observed.value&&old?old:resolve(observed.value));
    c.references.set(f.fieldNodeId,next);
    for(const r of collections)if(r.objectId===next.targetObjectId&&(next.targetOffset??0)>=r.range.offset&&(next.targetOffset??0)<r.range.offset+r.range.size&&
      ((next.targetOffset??0)-r.range.offset)%r.elementBytes===0&&r.recordTypeId===c.role.nodeRecordTypeId)c.backingIds.add(r.id);
  }
  function collectionState(c,e){
    const roots=c.rootStructureIds.map(id=>{
      const root=linkedById.get(id),s=currentRoots.get(id),status=s?.topology.rootStatus??'unknown';
      return {structureId:id,index:(root.root.offset-c.range.offset)/c.elementBytes,offset:root.root.offset,
        status,reachableMembers:s?.reachableMembers??[],endedMembers:s?.topology.endedTargetNodeIds??[],
        complete:['tree','graph','empty'].includes(s?.topology.status)};
    }),storageAlive=alive.has(c.objectId),reached=new Set(storageAlive?roots.flatMap(r=>r.reachableMembers):[]),
      sharedMembers=storageAlive?collections.filter(other=>other!==c&&alive.has(other.objectId)).map(other=>({collectionId:other.id,
        nodeIds:[...new Set(other.rootStructureIds.flatMap(id=>currentRoots.get(id)?.reachableMembers??[]))].filter(id=>reached.has(id))})).filter(s=>s.nodeIds.length):[],
      observedSlotCount=roots.filter(r=>!['unknown','ended-root'].includes(r.status)).length,
      row={afterExecutionId:e.eventId,storageAlive,roots,reachableMembers:[...reached],reachableNodeCount:reached.size,sharedMembers,
        observedSlotCount,unknownSlotCount:c.capacity-observedSlotCount,incompleteRootCount:roots.filter(r=>!r.complete).length,
        status:!storageAlive?'unavailable':roots.length===c.capacity&&roots.every(r=>r.complete)?'observed':'partial'};
    if(!sameState(c.states.at(-1),row))c.states.push(row);
  }
  for(const e of events){
    if(e.action==='object.begin')alive.add(e.objectId);
    if(e.action==='object.end')alive.delete(e.objectId);
    if(e.action==='frame.end')for(const id of e.endedObjects??[])alive.delete(id);
    for(const [id,s]of rootUpdates.get(e.eventId)??[])currentRoots.set(id,s);
    if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId)for(const c of contexts.values())if(c.ownerObjectId===e.target.objectId)
      for(const f of fields(c.role))if(e.target.offset===c.ownerOffset+f.offset&&(accessFields.get(e.instructionId)??[]).some(a=>a.fieldNodeId===f.fieldNodeId)){
        const value=f.cType.kind==='pointer'?e.value?.address:f.cType.signedness==='signed'?e.value?.signed??e.value?.decimal:e.value?.unsigned??e.value?.decimal;
        observe(c,f,observeScalarBytes(c.bytes.get(f.fieldNodeId),{size:f.size,signed:f.cType.signedness==='signed',value}),f.cType.kind==='pointer'?e.value?.reference:undefined);
      }
    if(e.memoryState&&['WRITE','SPACE'].includes(e.kind))for(const c of contexts.values())if(c.ownerObjectId===(e.target?.objectId??e.objectId)){
      const start=e.target?.offset??0;
      for(const f of fields(c.role)){
        const source=[...contexts.values()].find(s=>s.ownerObjectId===e.sourceObjectId&&s.ownerOffset===(e.sourceOffset??0)+c.ownerOffset-start&&s.role.id===c.role.id);
        observe(c,f,observeScalarBytes(c.bytes.get(f.fieldNodeId),{size:f.size,signed:f.cType.signedness==='signed',snapshot:e.memoryState,start,offset:c.ownerOffset+f.offset}),
          f.fieldNodeId===c.role.data.fieldNodeId?source?.references.get(f.fieldNodeId):undefined);
      }
    }
    for(const c of collections)collectionState(c,e);
    for(const c of contexts.values()){
      const reference=c.references.get(c.role.data.fieldNodeId)??{status:'unknown',targetObjectId:null,targetOffset:null},ownerAlive=alive.has(c.ownerObjectId),
        pointerStatus=reference.targetObjectId&&!alive.has(reference.targetObjectId)?'ended-target':reference.status,
        backing=collections.find(r=>r.objectId===reference.targetObjectId&&c.backingIds.has(r.id)&&reference.targetOffset>=r.range.offset&&reference.targetOffset<r.range.offset+r.range.size),
        capacity=c.role.capacity?c.values.get(c.role.capacity.fieldNodeId)??null:null,
        available=backing?(backing.range.offset+backing.range.size-reference.targetOffset)/backing.elementBytes:null,
        backingState=backing?.states.at(-1),reachable=ownerAlive&&pointerStatus==='in-bounds'?(backingState?.roots??[]).filter(r=>r.offset>=reference.targetOffset).flatMap(r=>r.reachableMembers):[],
        members=[...new Set(reachable)],row={afterExecutionId:e.eventId,ownerAlive,pointerReference:reference,pointerStatus,
          backingCollectionId:backing?.id??null,backingObjectId:backing?.objectId??null,storageAlive:!!backing&&alive.has(backing.objectId),
          capacity,availableSlots:available,capacityStatus:capacity===null?'unknown':Number.isInteger(capacity)&&capacity>=0&&available!==null&&capacity<=available?
            capacity===available?'matches-allocation':'within-allocation':capacity===0&&pointerStatus==='null'?'empty':'intermediate-or-unavailable',
          reachableMembers:members,reachableNodeCount:members.length,
          cardinalityCandidates:c.role.cardinalityCandidates.map(f=>({fieldNodeId:f.fieldNodeId,value:c.values.get(f.fieldNodeId)??null,
            status:c.values.get(f.fieldNodeId)===null||c.values.get(f.fieldNodeId)===undefined?'unknown':'inferred-cardinality',activePrefix:false})),
          backings:[...c.backingIds].map(id=>{const b=collections.find(b=>b.id===id),s=b.states.at(-1);return {collectionId:id,objectId:b.objectId,storageAlive:s.storageAlive,
            association:id===backing?.id?'current-pointer':'previously-observed-pointer',reachableMembers:s.reachableMembers};}),
          status:!ownerAlive?'unavailable':pointerStatus==='unknown'?'partial':pointerStatus==='ended-target'?'intermediate-or-unavailable':'observed'};
      if(!sameState(c.states.at(-1),row))c.states.push(row);
    }
  }
  // Separate range timelines retain simultaneously live arrays before an
  // owner field is assigned. Future assignments never confer early ownership.
  const owners=[...contexts.values()].filter(c=>c.backingIds.size).map(c=>{
    const {values,bytes,references,backingIds,...base}=c,backingHistory=[...backingIds];
    return {...base,backingHistory,nodes:[...new Set([c.ownerObjectId,...backingHistory.map(id=>collections.find(b=>b.id===id).objectId)].flatMap(viewIds))],edges:[],
      evidence:c.role.evidence,membershipPolicy:'owner pointer selects one observed backing; previous backing timelines remain separate; cardinality never selects a root prefix',
      confidence:'compiler owner/index relation and observed pointer origins; semantic roles remain candidates'};
  });
  return [...collections,...owners];
}
