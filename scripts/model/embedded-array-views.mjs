// Compiler identities establish candidates; only recorded accesses and updates
// establish operation evidence. This module never evaluates source expressions.
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const position=s=>`${s?.file}:${s?.start?.byte??`${s?.line}:${s?.column}`}`;
function field(n){
  n=unwrap(n);const base=n?.children?.[0]?.cType,type=base?.kind==='pointer'?base.pointee:base,part=n?.targetPath?.at(-1);
  if(n?.kind!=='MemberExpr'||!n.fieldNodeId||!type?.recordTypeId||!part)return null;
  return {fieldNodeId:n.fieldNodeId,recordTypeId:type.recordTypeId,offset:part.offsetBits/8,size:part.sizeBits/8,cType:n.cType};
}
export function bindEmbeddedArrays(plan){
  const nodes=new Map(),fields=new Map(),assignments=new Map(),declarations=new Map((plan.declarations??[]).map(d=>[position(d.source),d.id]));
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk))nodes.set(n.nodeId,n);
  for(const n of nodes.values()){
    const f=field(n);if(f)fields.set(f.fieldNodeId,f);
    const id=n.kind==='VarDecl'?declarations.get(position(n.source)):n.operator==='='?unwrap(n.children[0])?.declarationId:null;
    if(id){if(!assignments.has(id))assignments.set(id,[]);assignments.get(id).push(n.kind==='VarDecl'?n.children.at(-1):n.children[1]);}
  }
  function dependencies(n,seen=new Set()){
    n=unwrap(n);if(!n)return [];
    if(n.kind==='DeclRefExpr'&&n.declarationId&&!seen.has(n.declarationId)){
      const next=new Set(seen).add(n.declarationId);return [n,...(assignments.get(n.declarationId)??[]).flatMap(x=>dependencies(x,next))];
    }
    return [n,...(n.children??[]).flatMap(x=>dependencies(x,seen))];
  }
  function literal(n,seen=new Set()){
    n=unwrap(n);if(n?.kind==='IntegerLiteral')return Number(n.literal);
    if(n?.kind!=='DeclRefExpr'||seen.has(n.declarationId))return null;
    const origins=assignments.get(n.declarationId)??[];
    return origins.length===1?literal(origins[0],new Set(seen).add(n.declarationId)):null;
  }
  const roles=[];
  for(const data of fields.values()){
    const type=data.cType,elementBytes=type?.elementType?.sizeBits/8,capacity=type?.count;
    if(type?.kind!=='array'||!(elementBytes>0)||!Number.isSafeInteger(capacity)||capacity<=0||elementBytes*capacity!==data.size)continue;
    const accesses=[...nodes.values()].filter(n=>n.kind==='ArraySubscriptExpr'&&field(n.children[0])?.fieldNodeId===data.fieldNodeId).map(n=>{
      const deps=dependencies(n.children[1]);return {nodeId:n.nodeId,
        indexDeclarations:[...new Set(deps.map(x=>x.declarationId).filter(Boolean))],
        indexFields:[...new Set(deps.map(field).filter(f=>f?.recordTypeId===data.recordTypeId).map(f=>f.fieldNodeId))],
        moduloCapacity:deps.some(x=>x.operator==='%'&&literal(x.children[1])===capacity)};
    });
    const indexDeclarations=new Set(accesses.flatMap(a=>a.indexDeclarations)),bounds=[];
    for(const n of nodes.values())if(['<','<=','>','>='].includes(n.operator))for(const [fexpr,other]of [n.children,[...n.children].reverse()]){
      const f=field(fexpr);if(f?.recordTypeId!==data.recordTypeId)continue;
      if(literal(other)===capacity||dependencies(other).some(x=>indexDeclarations.has(x.declarationId)))
        bounds.push({fieldNodeId:f.fieldNodeId,sourceNodeId:n.nodeId,kind:literal(other)===capacity?'capacity-bound':'index-bound'});
    }
    roles.push({id:`embedded-role:${data.fieldNodeId}`,recordTypeId:data.recordTypeId,data,elementBytes,capacity,accesses,bounds,
      fields:[...fields.values()].filter(f=>f.recordTypeId===data.recordTypeId&&f.cType.signedness&&f.size>0&&f.size<=8),
      evidence:['compiler fixed-array field identity and extent','compiler indexed-access dependencies through declarations and assignments']});
  }
  plan.structureBindings??={};plan.structureBindings.embeddedArrayRoles=roles;
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{embeddedArrayCandidates:roles.length,
    embeddedArrayPolicy:'recorded endpoint operations and compiler bounds; multi-write prefix operations retain intermediate states'});
}
function inactive(range,bytes,capacity,start,count){
  const active=count===0?[]:start+count<=capacity?[[start,start+count]]:[[0,start+count-capacity],[start,capacity]],out=[];let at=0;
  for(const [a,b]of active){if(a>at)out.push({objectId:range.objectId,offset:range.offset+at*bytes,size:(a-at)*bytes});at=b;}
  if(at<capacity)out.push({objectId:range.objectId,offset:range.offset+at*bytes,size:(capacity-at)*bytes});return out;
}
export function embeddedArrayStructures(plan,{events,objects,views}){
  const roles=plan.structureBindings?.embeddedArrayRoles??[];if(!roles.length)return [];
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byObject=new Map(objects.map(o=>[o.id,o])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    contexts=new Map(),alive=new Set(),instructionNodes=new Map(plan.instructions.map(d=>[d.id,new Set(walk(d.expression).map(n=>n.nodeId))]));
  function context(objectId,offset,type){
    const o=byObject.get(objectId);if(!o||defs.get(byEvent.get(o.createdBy)?.instructionId)?.visibility==='implementation')return;
    for(const role of roles.filter(r=>r.recordTypeId===type?.recordTypeId)){
      const at=offset+role.data.offset,key=`${objectId}:${offset}:${role.id}`;
      if(at<0||at+role.data.size>o.size||contexts.has(key))continue;
      contexts.set(key,{id:`array-structure:${key}`,ownerObjectId:objectId,ownerOffset:offset,role,
        range:{objectId,offset:at,size:role.data.size},values:{},bytes:new Map(),states:[],groups:new Map(),accesses:[]});
    }
  }
  for(const o of objects)context(o.id,0,o.cType);
  for(const e of events){const ref=e.value?.reference;if(ref?.targetObjectId)context(ref.targetObjectId,ref.targetOffset??0,e.value.cType?.pointee);}
  function indexInput(id,c,fields,seen=new Set()){
    if(seen.has(id))return false;seen.add(id);const e=byEvent.get(id);if(!e)return false;
    if(e.target?.objectId===c.ownerObjectId&&c.role.fields.some(f=>fields.includes(f.fieldNodeId)&&e.target.offset===c.ownerOffset+f.offset))return true;
    return (e.dataInputs??[]).some(id=>indexInput(id,c,fields,seen));
  }
  for(let sequence=0;sequence<events.length;sequence++){
    const e=events[sequence];if(e.action==='object.begin')alive.add(e.objectId);
    if(e.action==='object.end')alive.delete(e.objectId);
    if(e.action==='frame.end')for(const id of e.endedObjects??[])alive.delete(id);
    for(const c of contexts.values()){
      const {role}=c,previous={...c.values},target=e.target?.objectId===c.ownerObjectId,
        own=target?role.fields.find(f=>c.ownerOffset+f.offset===e.target.offset&&f.size===e.target.size):null;
      let access=target&&['READ','WRITE'].includes(e.kind)?role.accesses.find(a=>instructionNodes.get(e.instructionId)?.has(a.nodeId)):null;
      // One compiler instruction can cover both an index-field read and the
      // eventual element read. Recorded address dependencies disambiguate them.
      if(access&&own&&access.indexFields.includes(own.fieldNodeId)&&!(e.addressInputs??[]).some(id=>indexInput(id,c,access.indexFields)))access=null;
      // Pointer helpers can access the same array without spelling its member.
      // Retain their actual slot accesses, without inventing index-field evidence.
      if(!access&&target&&['READ','WRITE'].includes(e.kind)&&e.target.size===role.elementBytes&&
        e.target.offset>=c.range.offset&&e.target.offset+e.target.size<=c.range.offset+c.range.size&&
        (e.target.offset-c.range.offset)%role.elementBytes===0)
        access={nodeId:defs.get(e.instructionId)?.sourceNodeId??null,indexFields:[],moduloCapacity:false};
      let changed=false;
      if(own&&e.value&&['READ','WRITE'].includes(e.kind)){
        const observed=observeScalarBytes(c.bytes.get(own.fieldNodeId),{size:own.size,signed:own.cType.signedness==='signed',
          value:(own.cType.signedness==='signed'?e.value.signed:e.value.unsigned)??e.value.decimal});
        if(observed){c.bytes.set(own.fieldNodeId,observed);const value=observed.value??undefined;
          changed=c.values[own.fieldNodeId]!==value;if(value===undefined)delete c.values[own.fieldNodeId];else c.values[own.fieldNodeId]=value;}
      }
      if(e.memoryState&&['WRITE','SPACE'].includes(e.kind)&&(e.target?.objectId??e.objectId)===c.ownerObjectId){
        for(const f of role.fields){const observed=observeScalarBytes(c.bytes.get(f.fieldNodeId),{size:f.size,signed:f.cType.signedness==='signed',
          snapshot:e.memoryState,start:e.target?.offset??0,offset:c.ownerOffset+f.offset});
          if(observed){c.bytes.set(f.fieldNodeId,observed);const value=observed.value??undefined;
            changed||=c.values[f.fieldNodeId]!==value;if(value===undefined)delete c.values[f.fieldNodeId];else c.values[f.fieldNodeId]=value;}}
      }
      if((access||own)&&e.activationId){
        let g=c.groups.get(e.activationId);if(!g)c.groups.set(e.activationId,g={activationId:e.activationId,before:previous,after:{},accesses:[],updates:[]});
        // A first read can supply a previously unobserved scalar without being a mutation.
        if(own&&e.kind==='READ'&&g.before[own.fieldNodeId]===undefined)g.before[own.fieldNodeId]=c.values[own.fieldNodeId];
        g.after={...c.values};
        if(own&&e.kind==='WRITE')g.updates.push({fieldNodeId:own.fieldNodeId,executionId:e.eventId,sequence,from:previous[own.fieldNodeId],to:c.values[own.fieldNodeId]});
        if(access){const physicalIndex=(e.target.offset-c.range.offset)/role.elementBytes,a={executionId:e.eventId,sequence,kind:e.kind,
          physicalIndex,inBounds:Number.isInteger(physicalIndex)&&physicalIndex>=0&&physicalIndex<role.capacity,
          target:{...e.target},sourceNodeId:access.nodeId,indexFields:access.indexFields,moduloCapacity:access.moduloCapacity,
          dataInputs:e.dataInputs??[],addressInputs:e.addressInputs??[]};g.accesses.push(a);c.accesses.push(a);}
      }
      const active=alive.has(c.ownerObjectId),last=c.states.at(-1);
      if(changed||access||last?.active!==active||e.action==='frame.end'&&c.groups.has(e.activationId))c.states.push({afterExecutionId:e.eventId,sequence,fieldValues:{...c.values},active,
        currentAccess:access?c.accesses.at(-1):null});
    }
  }
  const result=[];
  for(const c of contexts.values()){
    const {role,range}=c,viewIds=views.filter(v=>v.objectId===c.ownerObjectId&&v.kind==='array'&&v.offset===range.offset&&v.size===range.size).map(v=>v.id),
      nodes=views.filter(v=>v.objectId===c.ownerObjectId).map(v=>v.id),operations=[];
    for(const f of role.fields)for(const g of c.groups.values()){
      if(g.accesses.length!==1)continue;
      const a=g.accesses[0],delta=g.after[f.fieldNodeId]-g.before[f.fieldNodeId],updates=g.updates.filter(u=>u.fieldNodeId===f.fieldNodeId);
      if(updates.length!==1||!((delta===1&&a.kind==='WRITE')||(delta===-1&&a.kind==='READ')))continue;
      if(!role.accesses.some(x=>x.indexFields.includes(f.fieldNodeId)))continue;
      operations.push({field:f,group:g,access:a,delta});
    }
    const possibilities=[];
    for(const length of role.fields){
      const ops=operations.filter(o=>o.field.fieldNodeId===length.fieldNodeId),inserts=ops.filter(o=>o.delta===1),removes=ops.filter(o=>o.delta===-1);
      if(!inserts.length)continue;
      const lifoInsert=o=>o.access.inBounds&&o.access.indexFields.includes(length.fieldNodeId)&&o.access.physicalIndex===o.group.before[length.fieldNodeId],
        lifoRemove=o=>o.access.inBounds&&o.access.indexFields.includes(length.fieldNodeId)&&o.access.physicalIndex===o.group.after[length.fieldNodeId];
      if(inserts.some(lifoInsert)&&removes.some(lifoRemove))possibilities.push({length,head:null,role:'lifo',ops,
        supported:new Set([...inserts.filter(lifoInsert),...removes.filter(lifoRemove)])});
      for(const head of role.fields.filter(f=>f!==length)){
        const fifoInsert=o=>o.access.inBounds&&o.access.moduloCapacity&&o.access.indexFields.includes(head.fieldNodeId)&&o.access.indexFields.includes(length.fieldNodeId)&&
          o.access.physicalIndex===(o.group.before[head.fieldNodeId]+o.group.before[length.fieldNodeId])%role.capacity,
          fifoRemove=o=>o.access.inBounds&&o.access.indexFields.includes(head.fieldNodeId)&&o.access.physicalIndex===o.group.before[head.fieldNodeId]&&
            o.group.after[head.fieldNodeId]===(o.group.before[head.fieldNodeId]+1)%role.capacity&&o.group.updates.filter(u=>u.fieldNodeId===head.fieldNodeId).length===1;
        if(inserts.some(fifoInsert)&&removes.some(fifoRemove))possibilities.push({length,head,role:'fifo',ops,
          supported:new Set([...inserts.filter(fifoInsert),...removes.filter(fifoRemove)])});
      }
    }
    // Count is a storage-range role independent of LIFO/FIFO ordering. Support
    // multi-access updates only with observed endpoint and boundary evidence.
    const prefixPossibilities=[];
    for(const length of role.fields){
      const bounds=(role.bounds??[]).filter(b=>b.fieldNodeId===length.fieldNodeId),observedBounds=events.filter(e=>e.kind==='CALC'&&
        bounds.some(b=>(e.steps??[]).some(s=>s.nodeId===b.sourceNodeId)||defs.get(e.instructionId)?.sourceNodeId===b.sourceNodeId));
      if(!observedBounds.length)continue;
      const ops=[];
      for(const g of c.groups.values()){
        const updates=g.updates.filter(u=>u.fieldNodeId===length.fieldNodeId),delta=g.after[length.fieldNodeId]-g.before[length.fieldNodeId];
        if(updates.length!==1||Math.abs(delta)!==1)continue;
        const endpoint=delta===1?g.before[length.fieldNodeId]:g.after[length.fieldNodeId],kind=delta===1?'WRITE':'READ',
          accesses=g.accesses.filter(a=>a.kind===kind&&a.indexFields.includes(length.fieldNodeId)&&!a.moduloCapacity),
          access=accesses.find(a=>a.physicalIndex===endpoint)??accesses[0];
        if(access)ops.push({field:length,group:g,access,delta,prefix:true,supported:access.inBounds&&access.physicalIndex===endpoint});
      }
      if(!ops.some(o=>o.delta===1&&o.supported)||!ops.some(o=>o.delta===-1&&o.supported))continue;
      prefixPossibilities.push({length,head:null,role:'active-prefix',ops,supported:new Set(ops.filter(o=>o.supported)),
        boundEvidence:observedBounds.map(e=>e.eventId)});
    }
    const choices=possibilities.length?possibilities:prefixPossibilities,chosen=choices.length===1?choices[0]:null;
    const operationEvidence=(chosen?.ops??operations).map(o=>{
      const changes=o.group.updates.filter(u=>u.fieldNodeId===o.field.fieldNodeId||u.fieldNodeId===chosen?.head?.fieldNodeId),effects=[o.access,...changes].sort((a,b)=>a.sequence-b.sequence);
      const end=o.prefix?events.findIndex(e=>e.action==='frame.end'&&e.activationId===o.group.activationId):-1,
        complete=end>=0?{sequence:end,executionId:events[end].eventId}:effects.at(-1),
        related=o.prefix?c.accesses.filter(a=>a.sequence>=effects[0].sequence&&a.sequence<=complete.sequence):[o.access];
      return {activationId:o.group.activationId,operation:o.delta===1?'insert':'remove',lengthFieldNodeId:o.field.fieldNodeId,
        status:chosen?(chosen.supported.has(o)?'supported':'contradicted'):'partial',
        before:o.group.before,after:o.group.after,accessExecutionId:o.access.executionId,physicalIndex:o.access.physicalIndex,
        updateExecutionIds:changes.map(u=>u.executionId),startExecutionId:effects[0].executionId,completeExecutionId:complete.executionId,
        ...(o.prefix?{relatedAccessExecutionIds:related.map(a=>a.executionId),ordering:'unresolved'}:{}),
        startSequence:effects[0].sequence,completeSequence:complete.sequence};
    });
    const states=c.states.map(({sequence,...s})=>{
      const length=chosen?s.fieldValues[chosen.length.fieldNodeId]??null:null,head=chosen?.head?s.fieldValues[chosen.head.fieldNodeId]??null:0,
        bounded=chosen&&Number.isSafeInteger(length)&&length>=0&&length<=role.capacity&&Number.isSafeInteger(head)&&head>=0&&head<role.capacity,
        pending=operationEvidence.filter(o=>sequence>=o.startSequence&&sequence<o.completeSequence),
        contradicted=operationEvidence.some(o=>o.status==='contradicted'&&sequence>=o.startSequence),
        invalidAccess=s.currentAccess&&!s.currentAccess.inBounds,
        status=!chosen?'unresolved':!bounded||invalidAccess||contradicted?'inconsistent-or-unavailable':pending.length?'intermediate':'consistent',
        logicalOrder=status==='consistent'?{start:head,count:length,modulus:role.capacity,direction:1,mapping:'physicalIndex=(start+logicalIndex*direction)%modulus'}:null;
      return {...s,length,head:chosen?.head?head:null,capacity:role.capacity,status,logicalOrder,
        inactiveRanges:logicalOrder?inactive(range,role.elementBytes,role.capacity,head,length):null,
        pendingOperations:pending.map(o=>o.accessExecutionId)};
    });
    result.push({id:`array:${c.id}`,kind:'array',objectId:c.ownerObjectId,range,nodes:viewIds,edges:[],elementBytes:role.elementBytes,
      elementType:role.data.cType.elementType,capacity:role.capacity,lifecycle:byObject.get(c.ownerObjectId).lifecycle,
      evidence:['compiler embedded-array extent; same storage as record field'],snapshot:'physical range including inactive bytes'});
    result.push({id:c.id,kind:'array-structure',storage:'embedded',ownerObjectId:c.ownerObjectId,ownerOffset:c.ownerOffset,
      recordTypeId:role.recordTypeId,range,nodes,edges:[],arrayViewIds:viewIds,elementBytes:role.elementBytes,elementType:role.data.cType.elementType,capacity:role.capacity,
      roles:{data:role.data,length:chosen?.length??null,head:chosen?.head??null},roleCandidates:chosen?[chosen.role]:choices.map(p=>p.role),
      circularAccess:{observed:c.accesses.some(a=>a.moduloCapacity),evidence:c.accesses.filter(a=>a.moduloCapacity).map(a=>a.executionId),meaning:'compiler modulo-capacity access; does not alone establish FIFO'},
      roleAlternatives:choices.map(p=>({role:p.role,lengthFieldNodeId:p.length.fieldNodeId,headFieldNodeId:p.head?.fieldNodeId??null})),
      boundEvidence:chosen?.boundEvidence??[],
      operationEvidence:operationEvidence.map(({startSequence,completeSequence,...o})=>o),accesses:c.accesses.map(({sequence,...a})=>a),states,
      latestValidState:states.findLast(s=>s.status==='consistent'&&s.active)??null,lifecycle:byObject.get(c.ownerObjectId).lifecycle,
      confidence:chosen?'candidate supported by recorded insertion and removal relations; contradictory operations remain explicit':'partial array candidate; ordering role unresolved',
      evidence:[...role.evidence,'recorded target offsets, scalar changes, snapshots and activation identities'],
      limitations:['active-prefix describes occupied storage, not removal order or heap correctness','ambiguous roles remain unresolved'],snapshot:'execution history; inactive bytes and intermediate states are preserved'});
  }
  return result;
}
