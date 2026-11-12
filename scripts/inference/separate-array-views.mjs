import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const ref=n=>{n=unwrap(n);if(['++','--'].includes(n?.operator))n=unwrap(n.children?.[0]);return n?.kind==='DeclRefExpr'?n.declarationId:null;};
const unique=a=>[...new Set(a)];
// Pointer, count and capacity need not be members of a struct. Compiler uses
// nominate roles; actual accessed slots establish each container instance.
export function separateArrayStructures(plan,{events,objects,structures=[]}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    byObject=new Map(objects.map(o=>[o.id,o])),decl=new Map(objects.map(o=>[o.id,defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId])),
    nodes=new Map(),candidates=[],contexts=new Map();
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk))nodes.set(n.nodeId,n);
  const allocationBounds=new Set(plan.instructions.filter(d=>d.action==='call'&&['@malloc','@calloc','@realloc'].includes(d.callee))
    .flatMap(d=>(d.arguments??[]).slice(d.callee==='@realloc'?1:0).flatMap(walk).map(n=>n.declarationId).filter(Boolean)));
  const declarations=new Map(plan.instructions.filter(d=>d.action==='object.begin').map(d=>[d.sourceNodeId,d.declarationId])),assignments=new Map();
  for(const n of nodes.values()){
    const id=n.kind==='VarDecl'?declarations.get(n.nodeId):n.operator==='='?ref(n.children[0]):null;
    if(id){if(!assignments.has(id))assignments.set(id,[]);assignments.get(id).push(n.kind==='VarDecl'?n.children.at(-1):n.children[1]);}
  }
  for(const id of allocationBounds)for(const n of (assignments.get(id)??[]).flatMap(walk))if(n.declarationId)allocationBounds.add(n.declarationId);
  const comparisons=[...nodes.values()].filter(n=>['==','<','<=','>','>='].includes(n.operator)&&n.children?.length===2);
  for(const n of nodes.values())if(n.kind==='ArraySubscriptExpr'){
    const pointer=unwrap(n.children[0]),data=ref(pointer),length=ref(n.children[1]),bytes=pointer?.cType?.pointee?.sizeBits/8;
    if(!data||!length||!(bytes>0))continue;
    const caps=unique(comparisons.flatMap(c=>{const [a,b]=c.children.map(ref);return a===length&&b&&b!==length?[b]:b===length&&a&&a!==length?[a]:[];})).filter(id=>allocationBounds.has(id));
    if(caps.length!==1)continue;
    candidates.push({nodeId:n.nodeId,data,length,capacity:caps[0],elementBytes:bytes,elementType:pointer.cType.pointee});
  }
  function reads(id,seen=new Set()){
    if(seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.kind==='READ')return [e];return (e.dataInputs??[]).flatMap(x=>reads(x,seen));
  }
  for(const e of events)if(e.kind==='WRITE'&&e.target){
    const expressionNodes=new Set(walk(defs.get(e.instructionId)?.expression).map(n=>n.nodeId));
    for(const c of candidates.filter(c=>expressionNodes.has(c.nodeId))){
      const inputs=(e.addressInputs??[]).flatMap(id=>reads(id)),p=inputs.find(r=>decl.get(r.target?.objectId)===c.data),l=inputs.find(r=>decl.get(r.target?.objectId)===c.length);
      if(!p||!l||p.value?.reference?.targetObjectId!==e.target.objectId)continue;
      const capObjects=objects.filter(o=>decl.get(o.id)===c.capacity&&(o.storage==='static'||o.frameId===e.activationId));
      if(capObjects.length!==1)continue;const cap=capObjects[0],id=`separate-array:${p.target.objectId}:${l.target.objectId}:${cap.id}`;
      if(!contexts.has(id))contexts.set(id,{id,kind:'separate-array-structure',nodes:[],edges:[],roles:{
        data:{...p.target},length:{...l.target},capacity:{objectId:cap.id,offset:0,size:cap.size}},
        elementBytes:c.elementBytes,elementType:c.elementType,accessExecutionIds:[],discoveredAtExecutionId:e.eventId,states:[]});
      contexts.get(id).accessExecutionIds.push(e.eventId);
    }
  }
  const result=[];
  for(const c of contexts.values()){
    const bytes=new Map(),values=new Map(),alive=new Set(),backings=new Set();let pointer=null,growthObserved=false;
    for(const e of events){
      if(e.action==='object.begin')alive.add(e.objectId);
      if(e.action==='object.end')alive.delete(e.objectId);
      if(e.action==='frame.end')for(const id of e.endedObjects??[])alive.delete(id);
      let changed=false;
      for(const [role,r]of Object.entries(c.roles)){
        const exact=e.target?.objectId===r.objectId&&e.target.offset===r.offset&&e.target.size===r.size,
          snapshot=e.memoryState&&['WRITE','SPACE'].includes(e.kind)&&(e.target?.objectId??e.objectId)===r.objectId;
        if(!exact&&!snapshot)continue;
        const before=values.get(role),o=byObject.get(r.objectId),observed=observeScalarBytes(bytes.get(role),{size:r.size,signed:o.cType?.signedness==='signed',
          ...(snapshot?{snapshot:e.memoryState,start:e.target?.offset??0,offset:r.offset}:{}),
          ...(exact?{value:e.value?.address??e.value?.bits??e.value?.decimal}: {})});
        if(!observed)continue;bytes.set(role,observed);values.set(role,observed.value);changed=true;
        if(role==='data'){
          if(exact&&e.value?.reference)pointer=e.value.reference;
          else if(observed.value===null||observed.value===0||observed.value!==before)pointer=null;
        }
        if(role==='length'&&e.kind==='WRITE'&&before!==undefined&&observed.value===before+1)growthObserved=true;
      }
      const backing=byObject.get(pointer?.targetObjectId),offset=pointer?.targetOffset??0,
        length=values.get('length')??null,capacity=values.get('capacity')??null,active=!!backing&&alive.has(backing.id)&&Object.values(c.roles).every(r=>alive.has(r.objectId)),
        consistent=active&&Number.isSafeInteger(length)&&Number.isSafeInteger(capacity)&&length>=0&&length<=capacity&&
          capacity*c.elementBytes<=backing.size-offset;
      if(backing)backings.add(backing.id);
      const row={afterExecutionId:e.eventId,backingObjectId:backing?.id??null,byteOffset:offset,length,capacity,active,
        status:consistent?'consistent':'unknown-or-intermediate',elementBytes:c.elementBytes};
      if(changed||c.states.at(-1)?.active!==active)c.states.push(row);
    }
    if(!growthObserved||!backings.size)continue;
    // An index which expires while the buffer survives is a traversal/work
    // cursor, not a persistent cardinality. Keep its observed relation without
    // promoting it to a container or recommending a dynamic array.
    const lengthObject=byObject.get(c.roles.length.objectId),dataObject=byObject.get(c.roles.data.objectId),
      indexEnd=events.findIndex(e=>e.action==='object.end'&&e.objectId===lengthObject.id||e.action==='frame.end'&&e.endedObjects?.includes(lengthObject.id)),
      dataEnd=events.findIndex(e=>e.action==='object.end'&&e.objectId===dataObject.id||e.action==='frame.end'&&e.endedObjects?.includes(dataObject.id)),
      indexScope=defs.get(byEvent.get(lengthObject.createdBy)?.instructionId)?.scopeId,
      dataScope=defs.get(byEvent.get(dataObject.createdBy)?.instructionId)?.scopeId,
      shortLived=indexEnd>=0&&(dataEnd<0||indexEnd<dataEnd)&&indexScope!==dataScope,
      copiedScan=c.accessExecutionIds.every(id=>{const w=byEvent.get(id);return (w.dataInputs??[]).flatMap(id=>reads(id)).some(r=>
        r.target?.objectId!==c.roles.length.objectId&&r.target?.objectId!==w.target.objectId&&
        (r.addressInputs??[]).flatMap(id=>reads(id)).some(index=>index.target?.objectId===c.roles.length.objectId));}),
      cursor=shortLived||copiedScan;
    result.push({...c,kind:cursor?'array-cursor-relation':c.kind,backingHistory:[...backings],latestValidState:c.states.findLast(s=>s.status==='consistent')??null,
      temporalScope:'observed-states',classification:cursor?'bounded-traversal-candidate':'dynamic-array-candidate',intent:'unconfirmed',
      roleAssessment:{shortLivedIndex:shortLived,copyOnlyIndexedScan:copiedScan},
      evidence:['compiler pointer/index/bound declaration identities','observed indexed writes and count increments','actual pointer provenance and allocation extent'],
      limitations:['ambiguous capacity declarations remain unresolved','capacity/length roles are candidates; no ownership or algorithm intent is inferred']});
  }
  return result;
}
