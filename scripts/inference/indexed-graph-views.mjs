// A logical edge can be an integer carried by a linked record, rather than a
// pointer. Infer that relation from compiler fields and executed value flow.
// The resulting overlay never changes storage or asserts the author's intent.
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {topology} from '../shared/topology.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const integer=v=>{const n=Number(v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed));return Number.isSafeInteger(n)?n:null;};
function scalarSnapshot(e){
  const size=e.target?.size;if(!Number.isSafeInteger(size)||size<1||size>16)return null;
  let bytes=e.value?.bytesHex;
  if(!bytes&&e.value?.bits){const parsed=observeScalarBytes(null,{size,value:e.value.bits});if(parsed)bytes=parsed.bytes.map(b=>b.toString(16).padStart(2,'0')).join('');}
  return {byteLength:size,ranges:[{offset:0,length:size,initialization:bytes?.length===size*2?'initialized':'unknown',data:bytes?{encoding:'hex',bytesHex:bytes}:undefined}]};
}
function integerField(def){
  const n=unwrap(def?.expression),part=n?.targetPath?.at(-1),base=n?.children?.[0]?.cType,record=base?.pointee??base;
  if(n?.kind!=='MemberExpr'||!n.fieldNodeId||!part||record?.kind!=='record'||!['signed','unsigned'].includes(n.cType?.signedness))return null;
  if(part.offsetBits%8||part.sizeBits%8||!part.sizeBits)return null;
  return {fieldNodeId:n.fieldNodeId,recordTypeId:record.recordTypeId,offset:part.offsetBits/8,size:part.sizeBits/8,
    signed:n.cType.signedness==='signed',cType:n.cType,source:n.source};
}
function stateAt(states,eventIndex,positions){
  let lo=0,hi=states.length-1,result=null;
  while(lo<=hi){const mid=(lo+hi)>>1,state=states[mid];if(positions.get(state.afterExecutionId)<=eventIndex){result=state;lo=mid+1;}else hi=mid-1;}
  return result;
}

export function indexedGraphStructures(plan,{events,objects,structures=[],resultDeliveries=[],valueFlow}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    positions=new Map(events.map((e,i)=>[e.eventId,i])),
    lists=structures.filter(s=>s.kind==='linked-structure'&&s.root.kind==='pointer-slot'),
    arrays=structures.filter(s=>s.kind==='array'&&s.elementType?.kind==='pointer'&&s.elementType.pointee?.kind==='record'),
    fieldReads=new Map(),candidates=new Map(),flow=valueFlow??createValueFlow(plan,{events,resultDeliveries});
  if(!lists.length||!arrays.length)return [];
  for(const e of events)if(e.kind==='READ'&&e.target?.objectId){const f=integerField(defs.get(e.instructionId));if(f)fieldReads.set(e.eventId,{event:e,field:f});}
  // Only value-preserving paths qualify. Address/control inputs and arithmetic
  // transformations cannot turn an incidental equal number into a graph edge.
  const origins=id=>flow.reads(id).flatMap(e=>fieldReads.has(e.eventId)?[fieldReads.get(e.eventId)]:[]);
  for(const e of events){
    if(e.kind!=='READ'||!e.target?.objectId||unwrap(defs.get(e.instructionId)?.expression)?.kind!=='ArraySubscriptExpr')continue;
    for(const a of arrays){
      if(a.objectId!==e.target.objectId||e.target.offset<a.range.offset||e.target.offset+e.target.size>a.range.offset+a.range.size||e.target.size!==a.elementBytes)continue;
      const index=(e.target.offset-a.range.offset)/a.elementBytes;if(!Number.isInteger(index))continue;
      const roots=lists.filter(l=>l.root.objectId===a.objectId&&l.root.recordTypeId===a.elementType.pointee.recordTypeId&&
        l.root.offset>=a.range.offset&&l.root.offset<a.range.offset+a.range.size);
      if(!roots.length)continue;
      const sources=(e.addressInputs??[]).filter(id=>integer(byEvent.get(id)?.value)===index).flatMap(id=>origins(id));
      for(const {event:read,field}of sources){
        if(field.recordTypeId!==a.elementType.pointee.recordTypeId)continue;
        const readPosition=positions.get(read.eventId),owners=roots.flatMap(l=>{
          const s=stateAt(l.states,readPosition,positions);if(!s?.rootAlive)return [];
          return l.logicalNodes.filter(n=>s.reachableMembers.includes(n.id)&&n.objectId===read.target.objectId&&n.offset+field.offset===read.target.offset)
            .map(n=>({root:l,node:n}));
        });
        if(!owners.length)continue;
        const key=`${a.id}:${field.fieldNodeId}`;
        if(!candidates.has(key))candidates.set(key,{array:a,roots,field,evidence:[]});
        candidates.get(key).evidence.push({fieldReadExecutionId:read.eventId,indexReadExecutionId:e.eventId,
          destinationIndex:index,sourceRootIds:owners.map(x=>x.root.id),sourceRecordNodeIds:owners.map(x=>x.node.id),
          source:field.source,evidence:'observed integer field value preserved into root-array index'});
      }
    }
  }
  const result=[];
  for(const c of candidates.values()){
    const {array:a,field,roots}=c,records=new Map(roots.flatMap(l=>l.logicalNodes.map(n=>[n.id,n]))),
      slots=new Map(),slotsByObject=new Map(),rootUpdates=new Map(),rootStates=new Map(),states=[];
    for(const n of records.values()){
      const item={node:n,offset:n.offset+field.offset,bytes:null,lastWrite:null};slots.set(n.id,item);
      if(!slotsByObject.has(n.objectId))slotsByObject.set(n.objectId,[]);slotsByObject.get(n.objectId).push(item);
    }
    for(const l of roots)for(const s of l.states){if(!rootUpdates.has(s.afterExecutionId))rootUpdates.set(s.afterExecutionId,[]);rootUpdates.get(s.afterExecutionId).push({root:l,state:s});}
    function record(e){
      const vertexStates=[],edges=[];
      for(const l of roots){
        const s=rootStates.get(l.id);if(!s)continue;
        const fromIndex=(l.root.offset-a.range.offset)/a.elementBytes;
        const broken=s.orders.some(o=>['ended-target','out-of-bounds','one-past'].includes(o.termination)),
          partial=s.topology.status==='partial'||s.orders.some(o=>!['null','anchor'].includes(o.termination));
        vertexStates.push({index:fromIndex,rootStructureId:l.id,rootAlive:s.rootAlive,
          status:!s.rootAlive?'ended':broken?'inconsistent':partial?'unknown':s.reachableMembers.length?'observed':s.orders.every(o=>o.termination==='null')?'empty':'unknown',
          storageTerminations:s.orders.map(o=>({fieldNodeId:o.fieldNodeId,termination:o.termination}))});
        for(const id of s.reachableMembers){const v=slots.get(id);if(!v)continue;
          const value=v.bytes?.value??null,valid=value!==null&&value>=0&&value<a.capacity;
          edges.push({id:`${fromIndex}:${id}:${field.fieldNodeId}`,fromIndex,toIndex:valid?value:null,destinationValue:value,
            status:value===null?'unknown':valid?'observed':'out-of-range',recordNodeId:id,
            source:{objectId:v.node.objectId,offset:v.offset,size:field.size},lastWriteExecutionId:v.lastWrite});
        }
      }
      const ids=new Set([...vertexStates.map(v=>v.index),...edges.flatMap(e=>e.toIndex===null?[e.fromIndex]:[e.fromIndex,e.toIndex])]),
        graph=topology([...ids].map(id=>({id})),edges.filter(e=>e.toIndex!==null).map(e=>({from:e.fromIndex,to:e.toIndex})));
      graph.evidence=['observed root-array slots','recorded integer destination values'];
      graph.complete=vertexStates.length===a.capacity&&vertexStates.every(v=>['observed','empty'].includes(v.status))&&edges.every(e=>e.status==='observed');
      if(!graph.complete&&!graph.cyclic)graph.cyclic=null;
      if(!graph.complete)graph.views=graph.views.filter(v=>v==='directed-graph');
      const
        row={afterExecutionId:e.eventId,vertexStates,edges,topology:graph,
          status:vertexStates.length&&vertexStates.every(v=>v.status==='ended')?'ended':
            edges.some(e=>e.status==='out-of-range')||vertexStates.some(v=>v.status==='inconsistent')?'inconsistent':!graph.complete?'partial':'observed'};
      if(!states.length||JSON.stringify({...states.at(-1),afterExecutionId:null})!==JSON.stringify({...row,afterExecutionId:null}))states.push(row);
    }
    for(const e of events){
      let changed=false;
      for(const u of rootUpdates.get(e.eventId)??[]){rootStates.set(u.root.id,u.state);changed=true;}
      const objectId=e.target?.objectId??e.objectId,start=e.target?.offset??0;
      for(const s of slotsByObject.get(objectId)??[]){
        let updated=null;
        if(e.memoryState&&['SPACE','WRITE'].includes(e.kind))updated=observeScalarBytes(s.bytes,{size:field.size,signed:field.signed,snapshot:e.memoryState,start,offset:s.offset});
        else if(['READ','WRITE'].includes(e.kind)&&e.target?.offset===s.offset&&e.target.size===field.size)
          updated=observeScalarBytes(s.bytes,{size:field.size,signed:field.signed,value:e.value?.bits??e.value?.decimal});
        else if(e.kind==='WRITE'&&e.target?.offset<s.offset+field.size&&e.target.offset+e.target.size>s.offset){
          const snapshot=scalarSnapshot(e);if(snapshot)updated=observeScalarBytes(s.bytes,{size:field.size,signed:field.signed,snapshot,start,offset:s.offset});
        }
        if(updated){s.bytes=updated;if(e.kind==='WRITE'||e.kind==='SPACE')s.lastWrite=e.eventId;changed=true;}
      }
      if(changed)record(e);
    }
    result.push({id:`indexed-graph:${a.id}:${field.fieldNodeId}`,kind:'indexed-graph-candidate',origin:'inferred',
      nodes:a.nodes??[],edges:[],views:['directed-index-graph'],arrayId:a.id,objectId:a.objectId,
      vertexDomain:{kind:'array-indices',count:a.capacity,start:0,range:a.range,elementBytes:a.elementBytes},
      rootStructureIds:roots.map(l=>l.id),destinationRole:field,states,evidence:c.evidence,
      discoveredAtExecutionId:c.evidence[0].indexReadExecutionId,
      confidence:'observed value flow and linked-root membership; representation candidate, not author intent',
      limitations:['identity-preserving integer field flow into pointer-array indices only; transformed indices remain unresolved',
        'unobserved root slots and field bytes remain unknown; compiler capacity is a domain, not proof of active membership',
        'multiple destination-field candidates are retained separately; no chosen-structure invariant is imposed']});
  }
  return result;
}
