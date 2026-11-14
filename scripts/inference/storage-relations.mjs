// Layout-neutral relations over observed storage. No algorithm names, source
// evaluation, capacity expansion, or additional execution events are involved.
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {topology} from '../shared/topology.mjs';
import {resolveStructurePresentation} from './structure-presentation.mjs';
import {structureQueryIndex,structureQueryContext} from './query-index.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const unique=a=>[...new Set(a)];
const numeric=v=>{const x=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);return x!==undefined&&Number.isSafeInteger(Number(x))?Number(x):null;};
const key=r=>`${r.objectId}:${r.offset}:${r.size}`;
const contains=(a,b)=>a.objectId===b.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
const overlap=(a,b)=>a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
function targetExpression(d){let n=unwrap(d?.expression);if(n?.kind==='VarDecl')return null;if(n?.kind==='CompoundAssignOperator'||n?.operator==='='||['++','--'].includes(n?.operator))n=unwrap(n.children?.[0]);return n;}

export function storageRelationStructures(plan,{events,objects,structures=[],valueFlow,resultDeliveries=[]}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),eventOrder=new Map(events.map((e,i)=>[e.eventId,i])),
    byObject=new Map(objects.filter(o=>defs.get(byEvent.get(o.createdBy)?.instructionId)?.visibility!=='implementation').map(o=>[o.id,o])),
    flow=valueFlow??createValueFlow(plan,{events,resultDeliveries}),arrays=structures.filter(s=>s.kind==='array'),
    nodes=new Map(),slots=new Map(),changes=[],alive=new Set(),relations=[],nodesByObject=new Map(),arraysByObject=new Map(),slotsByObject=new Map(),relationIds=new Set();
  for(const a of arrays){if(!arraysByObject.has(a.objectId))arraysByObject.set(a.objectId,[]);arraysByObject.get(a.objectId).push(a);}
  const valid=r=>{const o=byObject.get(r?.objectId);return o&&Number.isSafeInteger(r.offset)&&r.offset>=0&&Number.isSafeInteger(r.size)&&r.size>=0&&r.offset+r.size<=o.size;};
  function node(range,e,type=null,kind='storage-range'){
    if(!valid(range))return null;const id=`storage:${key(range)}`;
    if(!nodes.has(id)){const n={id,range:{...range},kind,cType:type,discoveredAtExecutionId:e.eventId};nodes.set(id,n);
      if(!nodesByObject.has(range.objectId))nodesByObject.set(range.objectId,[]);nodesByObject.get(range.objectId).push(n);}
    return id;
  }
  function record(objectId,offset,type,e){
    if(type?.kind!=='record'||!(type.sizeBits>0))return null;
    return node({objectId,offset,size:type.sizeBits/8},e,type,'record');
  }
  function owner(range,e,expression,reference=false){
    const typed=(nodesByObject.get(range.objectId)??[]).filter(n=>n.kind==='record'&&contains(n.range,range)).sort((a,b)=>a.range.size-b.range.size)[0];
    if(typed)return typed.id;
    // A member write can precede every pointer to its containing record.
    // Use the already known compiler array layout at this event, rather than
    // making that member an independent node until a later pointer read.
    const records=(arraysByObject.get(range.objectId)??[]).filter(a=>a.elementType?.kind==='record'&&a.elementBytes>0&&contains(a.range,range)&&
      (!a.discoveredAtExecutionId||eventOrder.get(a.discoveredAtExecutionId)<=eventOrder.get(e.eventId))).sort((a,b)=>a.range.size-b.range.size);
    for(const a of records){
      const offset=a.range.offset+Math.floor((range.offset-a.range.offset)/a.elementBytes)*a.elementBytes;
      if(contains({objectId:a.objectId,offset,size:a.elementBytes},range)){
        const found=record(a.objectId,offset,a.elementType,e);if(found)return found;
      }
    }
    // A flexible/member array can extend past its record's fixed header.
    const field=walk(expression).find(n=>n.kind==='MemberExpr'&&n.cType?.kind==='array');
    if(field){
      const base=field.children?.[0]?.cType,type=base?.kind==='pointer'?base.pointee:base;
      for(const id of e.addressInputs??[]){const ref=byEvent.get(id)?.value?.reference;
        if(ref?.targetObjectId===range.objectId&&range.offset>=(ref.targetOffset??0)+(field.targetPath?.at(-1)?.offsetBits??0)/8){
          const found=record(ref.targetObjectId,ref.targetOffset??0,type,e);if(found)return found;
        }
      }
    }
    const array=(arraysByObject.get(range.objectId)??[]).filter(a=>a.elementType?.kind==='pointer'&&contains(a.range,range)).sort((a,b)=>a.range.size-b.range.size)[0];
    return array?node(array.range,e,null,'pointer-array'):node(range,e,null,reference?'addressed-range':'storage-range');
  }
  const dependencyCache=new Map();
  function dependencies(id){
    if(dependencyCache.has(id))return dependencyCache.get(id);
    const out=[],seen=new Set(),pending=[id];
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const e=byEvent.get(id);if(!e)continue;
      out.push(e);for(let i=(e.dataInputs?.length??0)-1;i>=0;i--)pending.push(e.dataInputs[i]);}
    if(dependencyCache.size>=128)dependencyCache.delete(dependencyCache.keys().next().value);
    dependencyCache.set(id,out);return out;
  }
  function pointerEdge(s,ref,e){
    let to=null;
    if(ref?.targetObjectId){
      const type=s.type?.pointee,offset=ref.targetOffset??0,o=byObject.get(ref.targetObjectId);
      if(o&&offset>=0&&offset<o.size){
        record(o.id,offset,type,e);
        const range={objectId:o.id,offset,size:Math.min(type?.sizeBits>0?type.sizeBits/8:0,o.size-offset)};
        to=owner(range,e,null,true);
      }
    }
    return {id:`reference:${key(s.range)}`,kind:'pointer',from:s.owner,to,source:s.range,
      target:ref?.targetObjectId?{objectId:ref.targetObjectId,offset:ref.targetOffset??0}:null,
      roleId:s.roleId,rolePath:s.rolePath??null,sourceTypeId:nodes.get(s.owner)?.cType?.recordTypeId??null,
      targetTypeId:s.type?.pointee?.recordTypeId??null,reference:ref,status:ref?.status??'unknown',lastObservationExecutionId:e.eventId};
  }
  // Discovery is chronological: a future pointer cast does not create a record
  // in an earlier state. Byte writes invalidate all overlapping observed slots.
  for(const e of events){
    const ended=unique([...(e.action==='object.end'?[e.objectId]:[]),...(e.action==='frame.end'?e.endedObjects??[]:[])]),upserts=[];
    if(e.action==='object.begin'&&byObject.has(e.objectId)){alive.add(e.objectId);record(e.objectId,0,byObject.get(e.objectId)?.cType,e);}
    for(const id of ended)alive.delete(id);
    const ref=e.value?.reference;
    if(ref?.targetObjectId)record(ref.targetObjectId,ref.targetOffset??0,e.value.cType?.pointee,e);
    if(['READ','WRITE'].includes(e.kind)&&valid(e.target)&&e.target.size>0&&ref&&e.value.cType?.kind==='pointer'){
      const definition=defs.get(e.instructionId),expression=targetExpression(definition),field=definition?.targetPath?.findLast(p=>p.kind==='member'&&p.fieldNodeId)??walk(expression).find(n=>n.kind==='MemberExpr'),
        id=key(e.target),s=slots.get(id)??{range:{objectId:e.target.objectId,offset:e.target.offset,size:e.target.size},bytes:null};
      s.type=e.value.cType;s.owner=owner(s.range,e,expression);s.roleId=field?`field:${field.fieldNodeId}`:`slot:${id}`;
      s.rolePath=defs.get(e.instructionId)?.targetPath??field?.targetPath??null;
      if(field&&s.rolePath?.at(-1)?.kind==='index'){
        const record=nodes.get(s.owner),memberOffset=s.rolePath.filter(p=>p.kind==='member').reduce((n,p)=>n+(p.offsetBits??0)/8,0),
          index=(s.range.offset-(record?.range.offset??0)-memberOffset)/s.range.size;
        if(record?.kind==='record'&&Number.isSafeInteger(index)&&index>=0)s.roleId+=`:slot:${index}`;
      }
      s.bytes=observeScalarBytes(s.bytes,{size:s.range.size,value:e.value.address??e.value.bits});
      s.edge=pointerEdge(s,ref,e);slots.set(id,s);upserts.push(s.edge);
      if(!slotsByObject.has(s.range.objectId))slotsByObject.set(s.range.objectId,new Map());slotsByObject.get(s.range.objectId).set(id,s);
    }
    const written=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null);
    if(written&&['WRITE','SPACE'].includes(e.kind))for(const s of slotsByObject.get(written.objectId)?.values()??[]){
      if(s.edge.lastObservationExecutionId===e.eventId||!overlap(s.range,written))continue;
      const bytes=observeScalarBytes(s.bytes,{size:s.range.size,snapshot:e.memoryState??{byteLength:written.size,ranges:[]},start:written.offset,offset:s.range.offset});
      if(!bytes)continue;s.bytes=bytes;
      const o=bytes.value===null?null:[...alive].map(id=>byObject.get(id)).find(o=>bytes.value>=o.address&&bytes.value<o.address+o.size),
        reference=bytes.value===0?{status:'null',targetObjectId:null}:o?{status:'in-bounds',targetObjectId:o.id,targetOffset:bytes.value-o.address,evidence:'recorded pointer-slot bytes and live allocation'}:{status:'unknown',targetObjectId:null};
      s.edge=pointerEdge(s,reference,e);upserts.push(s.edge);
    }
    if(upserts.length||ended.length)changes.push({afterExecutionId:e.eventId,upsertEdges:upserts,endedObjectIds:ended});
  }
  // Preserve cross-storage index/address uses, including indirection through
  // locals and real call parameters. Arithmetic remains an explicit transform;
  // it is never relabelled as an unchanged integer link.
  const work=structures.find(s=>s.kind==='array-work'),arrayAt=t=>(arraysByObject.get(t?.objectId)??[]).filter(a=>valid(t)&&contains(a.range,t)).sort((a,b)=>a.range.size-b.range.size)[0];
  for(const access of events.filter(e=>['READ','WRITE'].includes(e.kind)&&valid(e.target))){
    const targetArray=arrayAt(access.target);
    for(const input of access.addressInputs??[]){
      const exact=new Set(flow.reads(input).map(e=>e.eventId));
      for(const r of dependencies(input)){
        if(r.kind!=='READ'||!valid(r.target)||numeric(r.value)===null||r.value?.cType?.kind==='pointer')continue;
        const sourceArray=arrayAt(r.target),expr=unwrap(defs.get(r.instructionId)?.expression);
        if(!sourceArray&&expr?.kind!=='MemberExpr')continue;
        const id=`address-use:${r.eventId}:${access.eventId}`;if(relationIds.has(id))continue;relationIds.add(id);
        const preserved=exact.has(r.eventId),source={objectId:r.target.objectId,offset:r.target.offset,size:r.target.size},
          target={objectId:access.target.objectId,offset:access.target.offset,size:access.target.size};
        const recordEndpoint=(a,t)=>a?.elementType?.kind==='record'?{objectId:a.objectId,
          offset:a.range.offset+Math.floor((t.offset-a.range.offset)/a.elementBytes)*a.elementBytes,size:a.elementBytes}:null;
        relations.push({id,kind:preserved?'value-index-use':'computed-address-use',source,target,
          sourceRecord:recordEndpoint(sourceArray,source),targetRecord:recordEndpoint(targetArray,target),
          sourceArrayId:sourceArray?.id??null,targetArrayId:targetArray?.id??null,
          sourceReadExecutionId:r.eventId,addressInputExecutionId:input,targetAccessExecutionId:access.eventId,
          value:numeric(r.value),sourceIndex:sourceArray?(source.offset-sourceArray.range.offset)/sourceArray.elementBytes:null,
          targetIndex:targetArray?Math.floor((target.offset-targetArray.range.offset)/targetArray.elementBytes):null,
          transforms:dependencies(input).filter(d=>d.kind==='CALC').map(d=>({executionId:d.eventId,
            operators:unique((d.steps??[]).map(s=>s.operator).filter(Boolean)),value:d.value})),
          sourceUnit:sourceArray?'array-element':'record-field',targetUnit:targetArray?'array-element':'byte-range',
          scope:'this observed access only',preserved,interpretation:'storage dependency; logical edge role unconfirmed'});
      }
    }
  }
  // Shared index provenance joins separate arrays without assuming that equal
  // lengths, equal values, or a variable's spelling imply one logical record.
  const indexed=new Map();
  for(const a of work?.accesses??[])for(const cursor of a.cursors??[]){
    const access=byEvent.get(a.executionId);
    if(cursor.value!==a.target.index||!(access?.addressInputs??[]).some(id=>numeric(byEvent.get(id)?.value)===a.target.index&&
      (id===cursor.executionId||flow.reads(id).some(r=>r.eventId===cursor.executionId))))continue;
    const read=flow.reads(cursor.executionId).at(-1);if(!read)continue;
    const write=byEvent.get(read.dataInputs?.[0]),origin=write?.kind==='WRITE'?write.eventId:read.eventId;
    const id=`${origin}:${a.target.index}`;if(!indexed.has(id))indexed.set(id,[]);indexed.get(id).push(a);
  }
  const coindexed=[];
  for(const [origin,accesses]of indexed){const ids=unique(accesses.map(a=>a.target.arrayId));if(ids.length<2)continue;
    coindexed.push({origin,arrayIds:ids,accessExecutionIds:unique(accesses.map(a=>a.executionId)),
      interpretation:'co-indexed storage candidate; graph/record/grid intent unconfirmed'});
  }
  const packedAccesses=[],boundaryComparisons=[];
  for(const e of events.filter(e=>e.kind==='CALC'))for(const step of e.steps??[]){
    if(!['&','|','^','&=','|=','^=','<','<=','>','>=','==','!='].includes(step.operator))continue;
    const inputs=(step.inputs??[]).map((input,i)=>({input,position:i,read:flow.sourceReadOperand(input,e,step)})),
      origins=inputs.flatMap(x=>x.read?flow.reads(x.read.eventId).map(read=>({...x,read,array:arrayAt(read.target)})).filter(x=>x.array):[]);
    if(!origins.length)continue;
    const evidence={executionId:e.eventId,sourceNodeId:step.nodeId,operator:step.operator,result:step.value,
      operands:inputs.map(x=>({position:x.position,value:x.input.value,readExecutionId:x.read?.eventId??null})),
      storageOrigins:origins.map(x=>({position:x.position,arrayId:x.array.id,range:x.read.target,readExecutionId:x.read.eventId})),
      controlInputs:e.controlInputs??[],intent:'unconfirmed'};
    if(['&','|','^','&=','|=','^='].includes(step.operator))packedAccesses.push({...evidence,unit:'bit',interpretation:'observed packed-value operation; graph/bitset role unconfirmed'});
    else if(inputs.some(x=>!x.read&&x.input.value))boundaryComparisons.push({...evidence,interpretation:'observed storage/constant comparison; terminal-marker role unconfirmed'});
  }
  const indexWalks=new Map(),positions=new Map(events.map((e,i)=>[e.eventId,i]));
  for(const access of work?.accesses??[])for(const cursor of access.cursors??[]){
    if(!cursor.objectId||!Number.isSafeInteger(access.target.index))continue;
    const id=`index-walk:${access.activationId}:${access.target.arrayId}:${cursor.objectId}`;
    if(!indexWalks.has(id))indexWalks.set(id,{id,arrayId:access.target.arrayId,activationId:access.activationId,cursorObjectId:cursor.objectId,
      steps:[],transitions:[],interpretation:'observed index traversal; no implied parent/edge or algorithm identity'});
    const path=indexWalks.get(id),previous=path.steps.at(-1);
    if(previous?.cursorExecutionId===cursor.executionId&&previous.index===access.target.index){previous.accessExecutionIds.push(access.executionId);continue;}
    if(previous){const calculated=dependencies(cursor.executionId).filter(e=>e.kind==='CALC'&&positions.get(e.eventId)>positions.get(previous.cursorExecutionId));
      path.transitions.push({fromIndex:previous.index,toIndex:access.target.index,fromCursorExecutionId:previous.cursorExecutionId,
        toCursorExecutionId:cursor.executionId,calculationExecutionIds:unique(calculated.map(e=>e.eventId)),
        operators:unique(calculated.flatMap(e=>(e.steps??[]).map(s=>s.operator)).filter(Boolean)),status:'observed'});
    }
    path.steps.push({index:access.target.index,cursorValue:cursor.value,cursorExecutionId:cursor.executionId,accessExecutionIds:[access.executionId]});
  }
  const result=[];
  // Pointer fields, pointer-array slots and heterogeneous record families are
  // projections of the same storage graph. A field must actually be read;
  // taking an allocation's address never supplies traversal-role evidence.
  const roleProjections=[],roleEdges=new Map();
  for(const c of changes)for(const edge of c.upsertEdges){
    if(!edge.roleId.startsWith('field:')||!edge.sourceTypeId||!edge.targetTypeId)continue;
    if(!roleEdges.has(edge.roleId))roleEdges.set(edge.roleId,{roleId:edge.roleId,sourceTypeId:edge.sourceTypeId,targetTypeId:edge.targetTypeId,readExecutionIds:[],slotPaths:[]});
    const role=roleEdges.get(edge.roleId),e=byEvent.get(edge.lastObservationExecutionId);
    if(e?.kind==='READ')role.readExecutionIds.push(e.eventId);
    if(edge.rolePath&&!role.slotPaths.some(p=>JSON.stringify(p)===JSON.stringify(edge.rolePath)))role.slotPaths.push(edge.rolePath);
  }
  const traversed=[...roleEdges.values()].filter(r=>r.readExecutionIds.length);
  for(const role of traversed)roleProjections.push({id:`pointer-role:${role.roleId}`,roleIds:[role.roleId],
    typeIds:unique([role.sourceTypeId,role.targetTypeId]),supportingExecutionIds:unique(role.readExecutionIds),
    slotPaths:role.slotPaths,interpretation:role.sourceTypeId===role.targetTypeId?'same-record relation':'cross-record relation',intent:'unconfirmed'});
  const arrayFields=unique(traversed.filter(r=>/:slot:\d+$/.test(r.roleId)).map(r=>r.roleId.replace(/:slot:\d+$/,'')));
  for(const field of arrayFields){const group=[...roleEdges.values()].filter(r=>r.roleId.startsWith(`${field}:slot:`));
    if(group.length>1)roleProjections.push({id:`pointer-field:${field}`,roleIds:group.map(r=>r.roleId),
      typeIds:unique(group.flatMap(r=>[r.sourceTypeId,r.targetTypeId])),supportingExecutionIds:unique(group.flatMap(r=>r.readExecutionIds)),
      slotPaths:group.flatMap(r=>r.slotPaths),interpretation:'record pointer-array relation; individual slot projections retained',intent:'unconfirmed'});
  }
  // A vertex -> edge -> vertex representation remains heterogeneous. Do not
  // merge it into fictitious direct pointers or discard edge records/weights.
  const visitedTypes=new Set();for(const role of traversed){
    if(visitedTypes.has(role.sourceTypeId))continue;const types=new Set([role.sourceTypeId]);
    for(const id of types)for(const r of traversed)if(r.sourceTypeId===id||r.targetTypeId===id){types.add(r.sourceTypeId);types.add(r.targetTypeId);}
    for(const id of types)visitedTypes.add(id);const group=traversed.filter(r=>types.has(r.sourceTypeId));
    if(group.length>1)roleProjections.push({id:`pointer-family:${[...types].sort().join(':')}`,roleIds:group.map(r=>r.roleId),typeIds:[...types],
      supportingExecutionIds:unique(group.flatMap(r=>r.readExecutionIds)),interpretation:'record-family relation; separate role projections retained',intent:'unconfirmed'});
  }
  if(changes.some(c=>c.upsertEdges.length))result.push({id:'observed-storage-references',kind:'storage-reference-graph',
    nodes:[...nodes.values()],edges:[],changes,roleProjections,temporalScope:'event-deltas',classification:'observed-storage',
    displayPolicy:{mergeRelations:false,defaultView:'reference-graph',userOverrideAllowed:true},
    limitations:['null and unknown references remain distinct','overlapping union roles are access views, not independent allocations','node meaning and data-structure invariants are unconfirmed']});
  if(relations.length||coindexed.length||packedAccesses.length||boundaryComparisons.length||indexWalks.size)result.push({id:'observed-storage-dependencies',kind:'storage-dependencies',nodes:[],edges:[],relations,coindexed,packedAccesses,boundaryComparisons,indexWalks:[...indexWalks.values()],
    temporalScope:'individual-observed-accesses',classification:'relation-candidates',
    displayPolicy:{mergeRelations:false,userOverrideAllowed:true},limitations:['address use alone does not establish a graph edge','computed relations retain their execution dependency instead of inventing an index formula']});
  return result;
}

export function queryStorageReferences(graph,trace,{afterExecutionId,roleIds=null,includeEnded=false,view='auto',expected=null,preferences,slot='primary',resolvePresentation=true,includeTopology=true}={}){
  const explicitView=view!=='auto',selection=resolvePresentation&&trace.programId&&trace.runId?resolveStructurePresentation(trace,{target:{structureId:graph.id},afterExecutionId,preferences,slot,roleIds}):null;
  if(selection?.reconnection?.status==='reconnect-needed')return {
    afterExecutionId:afterExecutionId??trace.events.at(-1)?.eventId,nodes:[],edges:[],topology:null,relationAvailable:false,
    presentation:{...selection,assessment:'incomplete',warnings:[]},scope:'selected relation unavailable until user roles reconnect'};
  if(selection?.locked){view=selection.view;expected=selection.expected;roleIds=selection.roleIds;}
  else if(view==='auto'&&selection){view=selection.view;expected??=selection.expected;}
  const {positions,at}=structureQueryContext(trace,afterExecutionId),index=structureQueryIndex(trace);
  let history=index?.storageGraphs.get(graph);
  if(!history||at<history.at)history={at:-1,next:0,edges:new Map(),ended:new Set()};
  const {edges,ended}=history;
  while(history.next<graph.changes.length){const c=graph.changes[history.next];if(positions.get(c.afterExecutionId)>at)break;
    for(const e of c.upsertEdges)edges.set(e.id,e);for(const id of c.endedObjectIds)ended.add(id);history.next++;}
  history.at=at;index?.storageGraphs.set(graph,history);
  const nodes=graph.nodes.filter(n=>positions.get(n.discoveredAtExecutionId)<=at&&(includeEnded||!ended.has(n.range.objectId))),ids=new Set(nodes.map(n=>n.id)),
    selected=[...edges.values()].filter(e=>ids.has(e.from)&&(!roleIds||roleIds.includes(e.roleId))).map(e=>({...e,
      status:ended.has(e.source.objectId)?'ended-source':e.target&&ended.has(e.target.objectId)?'ended-target':e.status}));
  const links=selected.filter(e=>e.status==='in-bounds'&&ids.has(e.to)),used=new Set(links.flatMap(e=>[e.from,e.to])),sources=new Set(selected.map(e=>e.from)),
    shown=roleIds?nodes.filter(n=>used.has(n.id)||sources.has(n.id)):nodes,
    knownExpectation=['tree','forest','chain'].includes(expected),shape=includeTopology||knownExpectation?topology(shown,links):null,warnings=[];
  const unknown=selected.some(e=>!['in-bounds','null'].includes(e.status));
  if(knownExpectation){
    if(shape.cyclic)warnings.push({code:'cycle',message:'선택한 관계에 순환이 관측되었습니다.',category:'structure-expectation'});
    const incoming=new Map(),outgoing=new Map();for(const e of links){incoming.set(e.to,(incoming.get(e.to)??0)+1);outgoing.set(e.from,(outgoing.get(e.from)??0)+1);}
    if([...incoming.values()].some(n=>n>1))warnings.push({code:'shared-child',message:'여러 부모가 같은 노드를 참조합니다.',category:'structure-expectation'});
    if(expected==='chain'&&[...outgoing.values()].some(n=>n>1))warnings.push({code:'branching',message:'선택한 관계에 여러 후속 노드가 있습니다.',category:'structure-expectation'});
    if(expected==='tree'&&shown.length&&shape.roots.length!==1&&!shape.cyclic)warnings.push({code:'multiple-roots',message:'선택 범위가 하나의 루트로 연결되지 않습니다.',category:'structure-expectation'});
  }
  return {afterExecutionId:afterExecutionId??trace.events.at(-1)?.eventId,nodes:shown,edges:selected,topology:shape,
    presentation:{...(selection??{}),view,source:selection?.locked||explicitView?'user':selection?.source??'candidate',expected,
      assessment:!expected?'not-requested':!knownExpectation?'not-checkable':warnings.length?'contradicted':unknown?'incomplete':'satisfied-observed-topology',warnings},
    scope:'observed storage at requested event; role-filtered when specified'};
}
