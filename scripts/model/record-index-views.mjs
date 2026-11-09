// Record containers define logical membership. Integer edges require executed
// value provenance; equal integers and record/type names never establish links.
import {createValueFlow} from './observed-value-flow.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const integer=v=>{const x=Number(v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed));return Number.isSafeInteger(x)?x:null;};
const isInteger=t=>['signed','unsigned'].includes(t?.signedness);
const identity=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const overlap=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const at=(states,index,positions)=>{let lo=0,hi=states.length-1,found=null;while(lo<=hi){const mid=(lo+hi)>>1;
  if(positions.get(states[mid].afterExecutionId)<=index){found=states[mid];lo=mid+1;}else hi=mid-1;}return found;};
function field(n){
  n=unwrap(n);const part=n?.targetPath?.at(-1),base=n?.children?.[0]?.cType,record=base?.pointee??base;
  if(n?.kind!=='MemberExpr'||!n.fieldNodeId||record?.kind!=='record'||!part||part.offsetBits%8||part.sizeBits%8||!part.sizeBits)return null;
  return {fieldNodeId:n.fieldNodeId,recordTypeId:record.recordTypeId,offset:part.offsetBits/8,size:part.sizeBits/8,cType:n.cType};
}

export function recordIndexStructures(plan,{events,objects,structures=[],resultDeliveries=[],valueFlow},
  {maxNodes=4096,maxEdges=16384,maxStates=2048}={}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),positions=new Map(events.map((e,i)=>[e.eventId,i])),
    byObject=new Map(objects.map(o=>[o.id,o])),referenceCandidates=new Map(),flow=valueFlow??createValueFlow(plan,{events,resultDeliveries}),containers=[],accesses=[];
  const alive=(id,index)=>{const o=byObject.get(id);return !!o&&index>=(positions.get(o.createdBy)??0)&&index<(positions.get(o.endedBy)??Infinity);};
  const reference=(value,index)=>{if(!Number.isSafeInteger(value)||value===0)return null;
    if(!referenceCandidates.has(value))referenceCandidates.set(value,objects.filter(o=>value>=Number(o.address)&&value<Number(o.address)+o.size));
    const found=referenceCandidates.get(value).filter(o=>alive(o.id,index));
    return found.length===1?{objectId:found[0].id,offset:value-Number(found[0].address)}:null;};
  const pointerIdentity=(e,range,before,after,previous,index)=>{
    const explicit=identity(e.target)===identity(range)?e.value?.reference:null;
    if(explicit?.targetObjectId)return {objectId:explicit.targetObjectId,offset:explicit.targetOffset??0};
    // Reused addresses do not revive a pointer whose recorded object ended.
    return before===after&&previous?previous:reference(after,index);
  };
  const shape=(s,index)=>{
    if(s.kind==='dynamic-array'){const state=at(s.states,index,positions);return state&&{afterExecutionId:state.afterExecutionId,
      objectId:state.backingObjectId,offset:state.byteOffset,stride:state.elementBytes,length:state.length,capacity:state.capacity,
      alive:state.active&&state.ownerAlive&&state.storageAlive,status:state.status};}
    return {afterExecutionId:byObject.get(s.objectId)?.createdBy,objectId:s.objectId,offset:s.range.offset,stride:s.elementBytes,
      length:null,capacity:s.capacity,alive:alive(s.objectId,index),status:'active-length-unobserved'};
  };
  for(const s of structures)if(s.kind==='dynamic-array'||s.kind==='array'&&
    (s.elementType?.kind==='record'||s.elementType?.pointee?.kind==='record'))containers.push({structure:s,indices:new Set(),accesses:[],states:[],type:null});
  for(const e of events){if(e.kind!=='READ'||!e.target)continue;const index=positions.get(e.eventId),d=defs.get(e.instructionId);
    const arrays=walk(d?.expression).filter(n=>n.kind==='ArraySubscriptExpr'&&(n.cType?.kind==='record'||n.cType?.pointee?.kind==='record'));
    for(const n of arrays){const pointer=n.cType.kind==='pointer',type=pointer?n.cType.pointee:n.cType,stride=n.cType.sizeBits/8;
      if(!Number.isSafeInteger(stride)||stride<=0)continue;
      const matches=containers.filter(c=>{const s=shape(c.structure,index);return s?.alive&&s.objectId===e.target.objectId&&s.stride===stride&&
        e.target.offset>=s.offset&&e.target.offset+e.target.size<=s.offset+s.capacity*stride&&(!pointer||e.target.size===stride);});
      const selected=matches.some(c=>c.structure.kind==='dynamic-array')?matches.filter(c=>c.structure.kind==='dynamic-array'):matches;
      for(const c of selected){if(c.type&&c.type.recordTypeId!==type.recordTypeId)continue;
        const s=shape(c.structure,index),slot=Math.floor((e.target.offset-s.offset)/stride);
        c.type=type;c.pointer=pointer;c.stride=stride;c.indices.add(slot);c.accesses.push({event:e,node:n,index:slot});
        accesses.push({container:c,event:e,node:n,index:slot});
      }
    }
  }
  const candidates=containers.filter(c=>c.type&&c.accesses.length);
  if(!candidates.length)return [];
  // Keep only observed members and bounded active prefixes, never capacity.
  for(const c of candidates){
    for(const s of c.structure.kind==='dynamic-array'?c.structure.states:[])if(Number.isSafeInteger(s.length)&&s.length>=0)
      for(let i=0;i<Math.min(s.length,maxNodes);i++)c.indices.add(i);
    c.indices=new Set([...c.indices].sort((a,b)=>a-b).slice(0,maxNodes));
    const bytes=new Map(),slotEvidence=new Map(),updates=new Set((c.structure.states??[]).map(s=>s.afterExecutionId));let previous=null;
    for(const e of events){const index=positions.get(e.eventId),s=shape(c.structure,index);if(!s)continue;
      if(c.structure.kind==='array'&&index<(positions.get(byObject.get(c.structure.objectId)?.createdBy)??0))continue;
      let changed=updates.has(e.eventId)||e.objectId===s.objectId&&['object.begin','object.end'].includes(e.action)||
        e.action==='object.end'&&previous?.nodes.some(n=>n.record?.objectId===e.objectId);
      if(c.pointer&&s.objectId&&['READ','WRITE','SPACE'].includes(e.kind))for(const i of c.indices){
        const range={objectId:s.objectId,offset:s.offset+i*s.stride,size:s.stride},target=e.target??(e.objectId?{objectId:e.objectId,offset:0,size:byObject.get(e.objectId)?.size}:null);
        if(!overlap(range,target))continue;const key=identity(range);let updated;
        if(e.memoryState&&e.kind!=='READ')updated=observeScalarBytes(bytes.get(key),{size:s.stride,snapshot:e.memoryState,start:target.offset,offset:range.offset});
        else if(identity(range)===identity(target))updated=observeScalarBytes(bytes.get(key),{size:s.stride,value:e.value?.bits??e.value?.address});
        if(updated){changed=changed||JSON.stringify(updated)!==JSON.stringify(bytes.get(key));
          const pointerReference=pointerIdentity(e,range,bytes.get(key)?.value,updated.value,slotEvidence.get(key)?.pointerReference,index);bytes.set(key,updated);
          slotEvidence.set(key,{pointerReference,lastObservationExecutionId:e.eventId,lastWriteExecutionId:e.kind==='READ'?slotEvidence.get(key)?.lastWriteExecutionId??null:e.eventId});}
      }
      if(!changed&&previous)continue;
      const nodes=[];for(const i of c.indices){if(s.length!==null&&i>=s.length||i>=s.capacity||!s.objectId)continue;
        const storage={objectId:s.objectId,offset:s.offset+i*s.stride,size:s.stride},recorded=c.pointer?slotEvidence.get(identity(storage))?.pointerReference:storage,
          p=recorded&&alive(recorded.objectId,index)?recorded:null,
          record=p?{objectId:p.objectId,offset:p.offset,size:c.type.sizeBits/8}:null;
        nodes.push({id:`${c.structure.id}:index:${i}`,index:i,storage,record,status:!s.alive?'ended':record?'observed':'unknown',
          membershipExecutionId:s.afterExecutionId,...(c.pointer?slotEvidence.get(identity(storage)):{})});
      }
      const state={afterExecutionId:e.eventId,length:s.length,capacity:s.capacity,elementBytes:s.stride,backingObjectId:s.objectId,
        byteOffset:s.offset,active:s.alive,lengthEvidenceExecutionId:s.afterExecutionId,nodes,
        omittedNodeCount:s.alive&&s.length!==null?Math.max(0,s.length-nodes.length):0,status:!s.alive?'ended':s.length===null||nodes.some(n=>!n.record)||s.length>nodes.length?'partial':'observed'};
      if(!previous||JSON.stringify({...state,afterExecutionId:null,lengthEvidenceExecutionId:null})!==JSON.stringify({...previous,afterExecutionId:null,lengthEvidenceExecutionId:null})){
        c.states.push(state);previous=state;
      }
    }
  }
  const members=(c,range,index)=>{const s=at(c.states,index,positions);return s?.active?s.nodes.filter(n=>n.record&&
    range.objectId===n.record.objectId&&range.offset>=n.record.offset&&range.offset+range.size<=n.record.offset+n.record.size):[];};
  const sourceSlots=new Map(),byOrigin=new Map(),fieldDefinitions=new Map();
  const remember=(e,spec)=>{const ids=flow.reads(e.eventId).map(r=>r.eventId);sourceSlots.set(e.eventId,spec);
    for(const id of ids){if(!byOrigin.has(id))byOrigin.set(id,[]);byOrigin.get(id).push({event:e,...spec});}};
  // Direct integer fields and scalar slots of a record-owned integer array.
  for(const e of events){if(!['READ','WRITE'].includes(e.kind)||!e.target||!isInteger(e.value?.cType))continue;
    const index=positions.get(e.eventId),d=defs.get(e.instructionId);let n=unwrap(d?.expression);
    if(e.kind==='WRITE'&&n?.operator==='=')n=unwrap(n.children[0]);
    const f=field(n);
    if(f&&isInteger(f.cType))for(const c of candidates)if(c.type.recordTypeId===f.recordTypeId)
      for(const member of members(c,e.target,index))if(e.target.offset===member.record.offset+f.offset){
        fieldDefinitions.set(`${c.structure.id}:${f.fieldNodeId}`,f);remember(e,{container:c,memberIndex:member.index,field:f,kind:'record-field',slotIndex:null});
      }
    if(n?.kind!=='ArraySubscriptExpr')continue;
    const base=unwrap(n.children[0]),arrayField=field(base);if(!arrayField||!isInteger(arrayField.cType?.pointee))continue;
    for(const id of e.addressInputs??[])for(const read of flow.reads(id)){
      const rf=field(defs.get(read.instructionId)?.expression),ref=read.value?.reference;
      if(rf?.fieldNodeId!==arrayField.fieldNodeId||!ref?.targetObjectId||ref.targetObjectId!==e.target.objectId||e.target.offset<(ref.targetOffset??0))continue;
      const size=arrayField.cType.pointee.sizeBits/8,slot=(e.target.offset-(ref.targetOffset??0))/size;
      if(!Number.isInteger(slot)||size!==e.target.size)continue;
      for(const c of candidates)if(c.type.recordTypeId===arrayField.recordTypeId)for(const member of members(c,read.target,index)){
        fieldDefinitions.set(`${c.structure.id}:${arrayField.fieldNodeId}`,arrayField);
        remember(e,{container:c,memberIndex:member.index,field:arrayField,kind:'record-owned-index-array',slotIndex:slot,pointerReadExecutionId:read.eventId});
      }
    }
  }
  const relations=new Map();
  for(const a of accesses){if(!candidates.includes(a.container))continue;const e=a.event,when=positions.get(e.eventId),indexNodes=new Set(walk(a.node.children[1]).map(n=>n.nodeId));
    for(const id of e.addressInputs??[]){const input=byEvent.get(id),definition=defs.get(input?.instructionId);
      if(integer(input?.value)!==a.index||!walk(definition?.expression).some(n=>indexNodes.has(n.nodeId)))continue;
      for(const origin of flow.reads(id))for(const proof of byOrigin.get(origin.eventId)??[]){
        if(proof.container!==a.container||positions.get(proof.event.eventId)>=when||integer(proof.event.value)!==a.index)continue;
        const key=`${a.container.structure.id}:${proof.kind}:${proof.field.fieldNodeId}`;
        let r=relations.get(key);if(!r)relations.set(key,r={id:key,container:a.container,kind:proof.kind,field:proof.field,evidence:[]});
        const evidence={sourceExecutionId:proof.event.eventId,sourceKind:proof.event.kind,source:{...proof.event.target},
          sourceIndex:proof.memberIndex,slotIndex:proof.slotIndex,targetAccessExecutionId:e.eventId,indexExecutionId:id,
          sharedOriginReadExecutionId:origin.eventId,targetIndex:a.index,pointerReadExecutionId:proof.pointerReadExecutionId??null,
          evidence:'observed identity-preserving value flow within this record container'};
        if(!r.evidence.some(x=>x.sourceExecutionId===evidence.sourceExecutionId&&x.targetAccessExecutionId===evidence.targetAccessExecutionId))r.evidence.push(evidence);
      }
    }
  }
  if(!relations.size)return [];
  const result=[];
  for(const c of candidates){const own=[...relations.values()].filter(r=>r.container===c);if(!own.length)continue;
    const records=new Map(c.states.flatMap(s=>s.nodes.filter(n=>n.record).map(n=>[identity(n.record),n.record]))),slots=new Map(),pointerSlots=new Map();
    for(const record of records.values())for(const r of own){const range={objectId:record.objectId,offset:record.offset+r.field.offset,size:r.field.size},
      slot={range,relation:r,record,bytes:null,lastWrite:null,lastObservation:null};
      (r.kind==='record-field'?slots:pointerSlots).set(`${r.id}:${identity(range)}`,slot);
    }
    const output=[],updates=new Set(c.states.map(s=>s.afterExecutionId)),discoveredAt=own.flatMap(r=>r.evidence).sort((a,b)=>positions.get(a.targetAccessExecutionId)-positions.get(b.targetAccessExecutionId))[0].targetAccessExecutionId;
    const typedArrays=structures.filter(a=>a.kind==='array'&&isInteger(a.elementType));let omittedStates=0;
    for(const e of events){const index=positions.get(e.eventId),state=at(c.states,index,positions);if(!state)continue;
      let changed=updates.has(e.eventId),target=e.target??(e.objectId?{objectId:e.objectId,offset:0,size:byObject.get(e.objectId)?.size}:null);
      const update=slot=>{if(!overlap(slot.range,target)||!['SPACE','WRITE','READ'].includes(e.kind))return;
        let observed=null;if(e.memoryState&&e.kind!=='READ')observed=observeScalarBytes(slot.bytes,{size:slot.range.size,
          signed:slot.relation.kind==='record-field'?slot.relation.field.cType.signedness==='signed':slot.relation.field.cType.pointee?.signedness==='signed',
          snapshot:e.memoryState,start:target.offset,offset:slot.range.offset});
        else if(identity(target)===identity(slot.range))observed=observeScalarBytes(slot.bytes,{size:slot.range.size,
          signed:slot.relation.kind==='record-field'?slot.relation.field.cType.signedness==='signed':slot.relation.field.cType.pointee?.signedness==='signed',value:e.value?.bits??e.value?.address});
        if(observed){changed=changed||JSON.stringify(observed)!==JSON.stringify(slot.bytes)||e.kind==='WRITE';
          if(slot.relation.kind==='record-owned-index-array'&&!slot.pointerSlot)slot.pointerReference=pointerIdentity(e,slot.range,slot.bytes?.value,observed.value,slot.pointerReference,index);
          slot.bytes=observed;slot.lastObservation=e.eventId;
          if(e.kind!=='READ')slot.lastWrite=e.eventId;}
      };
      for(const slot of pointerSlots.values()){
        update(slot);const ref=slot.pointerReference;if(!ref||!alive(ref.objectId,index))continue;
        const type=slot.relation.field.cType.pointee,size=type.sizeBits/8;
        const arrays=typedArrays.filter(a=>a.objectId===ref.objectId&&a.range.offset===ref.offset&&a.elementBytes===size&&a.elementType.signedness===type.signedness);
        if(!arrays.length)continue;const extent=Math.min(...arrays.map(a=>a.capacity));
        let represented=0;
        for(let i=0;i<Math.min(extent,maxEdges);i++){const range={objectId:ref.objectId,offset:ref.offset+i*size,size},key=`${slot.relation.id}:${identity(slot.record)}:${identity(range)}`;
          if(!slots.has(key)&&slots.size>=maxEdges)break;
          if(!slots.has(key))slots.set(key,{range,relation:slot.relation,record:slot.record,slotIndex:i,bytes:null,lastWrite:null,lastObservation:null,pointerSlot:slot,extent});
          represented++;
        }
        slot.omittedSlots=Math.max(0,extent-represented);
      }
      for(const slot of slots.values())update(slot);
      if(!changed&&e.eventId!==discoveredAt)continue;
      const edges=[];let omittedEdges=[...pointerSlots.values()].filter(slot=>state.nodes.some(n=>identity(n.record)===identity(slot.record)))
        .reduce((sum,slot)=>sum+(slot.omittedSlots??0),0);
      for(const node of state.nodes)if(node.record)for(const slot of slots.values())if(identity(slot.record)===identity(node.record)){
        if(edges.length>=maxEdges){omittedEdges++;continue;}
        if(slot.pointerSlot){const current=slot.pointerSlot.pointerReference;if(!current||!alive(current.objectId,index)||current.objectId!==slot.range.objectId||slot.range.offset<current.offset||slot.range.offset>=current.offset+slot.extent*slot.range.size)continue;}
        const value=slot.bytes?.value??null,destination=state.nodes.find(n=>n.index===value),within=value!==null&&value>=0&&value<state.capacity,
          active=within&&(state.length===null||value<state.length),proof=slot.relation.evidence.filter(p=>positions.get(p.targetAccessExecutionId)<=index&&
            positions.get(p.sourceExecutionId)>=(positions.get(slot.lastWrite)??-1)&&
            identity(p.source)===identity(slot.range)&&p.targetIndex===value),status=!state.active?'ended':value===null?'unknown':!within?'terminal-or-unresolved':!active?'inactive-target':!destination?.record?'unresolved-target':proof.length?'observed':state.length===null?'active-membership-unknown':'inferred';
        edges.push({id:`${node.id}:${slot.relation.field.fieldNodeId}:${slot.slotIndex??'field'}`,from:node.id,to:active&&destination?.record?destination.id:null,
          fromIndex:node.index,toIndex:active&&destination?.record?value:null,value,source:slot.range,relationId:slot.relation.id,
          slotIndex:slot.slotIndex??null,status,physicalBounds:within?'in-bounds':value===null?'unknown':'out-of-bounds',
          activeMembership:state.length===null?'unknown':active?'active':'inactive',
          lastWriteExecutionId:slot.lastWrite,lastObservationExecutionId:slot.lastObservation,
          ...(slot.pointerSlot?{pointerSource:slot.pointerSlot.range,pointerObservationExecutionId:slot.pointerSlot.lastObservation,
            pointerWriteExecutionId:slot.pointerSlot.lastWrite}:{}),
          evidenceExecutionIds:proof.map(p=>p.targetAccessExecutionId)});
      }
      const discovered=index>=positions.get(discoveredAt),row={...state,afterExecutionId:e.eventId,edges,
        discoveryStatus:discovered?'observed':'not-yet-observed',retrospective:!discovered,omittedEdgeCount:omittedEdges,
        status:!state.active?'ended':!discovered||state.status!=='observed'||omittedEdges||edges.some(e=>!['observed','inferred'].includes(e.status))?'partial':'observed'};
      if(output.length<maxStates)output.push(row);else{omittedStates++;output[output.length-1]=row;}
    }
    result.push({id:`record-index:${c.structure.id}:${c.type.recordTypeId}`,kind:'record-index-graph-candidate',origin:'inferred',classification:'candidate',intent:'unconfirmed',
      containerId:c.structure.id,recordTypeId:c.type.recordTypeId,recordSize:c.type.sizeBits/8,storageKind:c.pointer?'pointer-record-array':'record-array',
      isPointerStructure:false,temporalScope:'observed-states',nodes:[],edges:[],views:['directed-index-graph'],discoveredAtExecutionId:discoveredAt,
      displayPolicy:{mergeRelations:false,defaultRelationId:null},
      relations:own.map(r=>({id:r.id,kind:r.kind,field:r.field,evidence:r.evidence,
        role:r.kind==='record-field'&&r.evidence.every(p=>p.sourceIndex===p.targetIndex)?'self-index-candidate':'index-link-candidate',intent:'unconfirmed'})),states:output,
      coverage:{maxNodes,maxEdges,maxStates,omittedStates,complete:!omittedStates&&output.every(s=>!s.omittedNodeCount&&!s.omittedEdgeCount)},
      limitations:['container length defines active membership; capacity and temporary record copies are not logical vertices',
        'field-wide edges are inferred from observed value flow; no algorithm or sentinel semantics are assigned',
        'unknown, out-of-domain and inactive destinations remain unresolved; bounded output never implies complete coverage']});
  }
  return result;
}
