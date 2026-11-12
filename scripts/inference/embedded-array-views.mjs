// Compiler identities establish candidates; only recorded accesses and updates
// establish operation evidence. This module never evaluates source expressions.
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {containerHistory} from './array-container-history.mjs';
import {arrayStorageExtent} from './array-storage-extent.mjs';
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
    const type=data.cType,elementBytes=(type?.elementType??type?.pointee)?.sizeBits/8,capacity=type?.count??null;
    if(!['array','pointer'].includes(type?.kind)||!(elementBytes>0)||type.kind==='array'&&(!Number.isSafeInteger(capacity)||capacity<=0||elementBytes*capacity!==data.size))continue;
    const accesses=[...nodes.values()].filter(n=>n.kind==='ArraySubscriptExpr'&&field(n.children[0])?.fieldNodeId===data.fieldNodeId).map(n=>{
      const deps=dependencies(n.children[1]);return {nodeId:n.nodeId,
        indexDeclarations:[...new Set(deps.map(x=>x.declarationId).filter(Boolean))],
        indexFields:[...new Set(deps.map(field).filter(f=>f?.recordTypeId===data.recordTypeId).map(f=>f.fieldNodeId))],
        moduloDivisors:deps.filter(x=>x.operator==='%').map(x=>literal(x.children[1])).filter(x=>x!==null),moduloCapacity:capacity!==null&&deps.some(x=>x.operator==='%'&&literal(x.children[1])===capacity)};
    });
    const indexDeclarations=new Set(accesses.flatMap(a=>a.indexDeclarations)),bounds=[];
    for(const n of nodes.values())if(['<','<=','>','>='].includes(n.operator))for(const [fexpr,other]of [n.children,[...n.children].reverse()]){
      const f=field(fexpr);if(f?.recordTypeId!==data.recordTypeId)continue;
      if(literal(other)===capacity||dependencies(other).some(x=>indexDeclarations.has(x.declarationId)))
        bounds.push({fieldNodeId:f.fieldNodeId,sourceNodeId:n.nodeId,kind:literal(other)===capacity?'capacity-bound':'index-bound'});
    }
    roles.push({id:`embedded-role:${data.fieldNodeId}`,recordTypeId:data.recordTypeId,data,elementBytes,capacity,accesses,bounds,
      fields:[...fields.values()].filter(f=>f.recordTypeId===data.recordTypeId&&f.fieldNodeId!==data.fieldNodeId&&
        (f.cType.signedness||f.cType.kind==='pointer')&&f.size>0&&f.size<=8),
      evidence:['compiler fixed-array field identity and extent','compiler indexed-access dependencies through declarations and assignments']});
  }
  const scalarDeclarations=new Map((plan.declarations??[]).filter(d=>(d.cType?.signedness||d.cType?.kind==='pointer')&&d.cType.sizeBits>0&&d.cType.sizeBits<=64).map(d=>[d.id,d]));
  for(const data of plan.declarations??[]){
    const type=data.cType,capacity=type?.count??null,elementBytes=(type?.elementType??type?.pointee)?.sizeBits/8;
    if(!['array','pointer'].includes(type?.kind)||!(elementBytes>0)||type.kind==='array'&&(!Number.isSafeInteger(capacity)||capacity<=0))continue;
    const accesses=[...nodes.values()].filter(n=>n.kind==='ArraySubscriptExpr'&&unwrap(n.children[0])?.declarationId===data.id||
      type.kind==='pointer'&&n.kind==='UnaryOperator'&&n.operator==='*'&&dependencies(n.children[0]).some(x=>x.declarationId===data.id)).map(n=>{
      const deps=dependencies(n.kind==='ArraySubscriptExpr'?n.children[1]:n.children[0]),ids=[...new Set(deps.map(x=>x.declarationId).filter(id=>id!==data.id&&scalarDeclarations.has(id)))];
      return {nodeId:n.nodeId,indexDeclarations:ids,indexFields:ids.map(id=>`declaration:${id}`),
        moduloDivisors:deps.filter(x=>x.operator==='%').map(x=>literal(x.children[1])).filter(x=>x!==null),moduloCapacity:capacity!==null&&deps.some(x=>x.operator==='%'&&literal(x.children[1])===capacity)};
    });
    if(!accesses.length)continue;
    const indexIds=new Set(accesses.flatMap(a=>a.indexDeclarations)),bounds=[],ids=new Set(indexIds);
    for(const n of nodes.values())if(['<','<=','>','>='].includes(n.operator))for(const [fexpr,other]of [n.children,[...n.children].reverse()]){
      const f=unwrap(fexpr);if(!scalarDeclarations.has(f?.declarationId))continue;
      if(literal(other)===capacity||dependencies(other).some(x=>indexIds.has(x.declarationId))){
        ids.add(f.declarationId);bounds.push({fieldNodeId:`declaration:${f.declarationId}`,sourceNodeId:n.nodeId,kind:'observed-bound-candidate'});
      }
    }
    roles.push({id:`separate-fixed-role:${data.id}`,storage:'separate',recordTypeId:null,
      data:{declarationId:data.id,offset:0,size:type.sizeBits/8,cType:type},elementBytes,capacity,accesses,bounds,
      fields:[...ids].map(id=>{const d=scalarDeclarations.get(id);return {declarationId:id,fieldNodeId:`declaration:${id}`,offset:0,size:d.cType.sizeBits/8,cType:d.cType};}),
      evidence:['compiler array and scalar declaration identities','observed endpoint operations share the same container contract as embedded fields']});
  }
  plan.structureBindings??={};plan.structureBindings.embeddedArrayRoles=roles;
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{embeddedArrayCandidates:roles.length,
    embeddedArrayPolicy:'recorded endpoint operations and compiler bounds; multi-write prefix operations retain intermediate states'});
}
export function embeddedArrayStructures(plan,{events,objects,views,storageExtent=arrayStorageExtent(plan,{objects,events})}){
  const roles=plan.structureBindings?.embeddedArrayRoles??[];if(!roles.length)return [];
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byObject=new Map(objects.map(o=>[o.id,o])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    contexts=new Map(),alive=new Set(),valueFlow=createValueFlow(plan,{events}),instructionNodes=new Map(plan.instructions.map(d=>[d.id,new Set(walk(d.expression).map(n=>n.nodeId))]));
  function context(objectId,offset,type){
    const o=byObject.get(objectId);if(!o||defs.get(byEvent.get(o.createdBy)?.instructionId)?.visibility==='implementation')return;
    const declaration=defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId;
    for(const candidate of roles.filter(r=>r.storage==='separate'?r.data.declarationId===declaration:!!r.recordTypeId&&r.recordTypeId===type?.recordTypeId)){
      let role=candidate;
      if(candidate.storage==='separate'){
        const fields=candidate.fields.map(f=>{const matches=objects.filter(x=>defs.get(byEvent.get(x.createdBy)?.instructionId)?.declarationId===f.declarationId&&
          (x.storage==='static'||x.frameId===o.frameId));return matches.length===1?{...f,objectId:matches[0].id}:null;}).filter(Boolean);
        role={...candidate,fields};
      }
      const at=offset+role.data.offset,key=`${objectId}:${offset}:${role.id}`;
      if(at<0||at+role.data.size>o.size||contexts.has(key))continue;
      contexts.set(key,{id:`array-structure:${key}`,ownerObjectId:objectId,ownerOffset:offset,role,
        range:{objectId,offset:at,size:role.data.size},values:{},bytes:new Map(),states:[],groups:new Map(),accesses:[]});
    }
  }
  for(const o of objects)context(o.id,0,o.cType);
  for(const e of events){const ref=e.value?.reference;if(ref?.targetObjectId)context(ref.targetObjectId,ref.targetOffset??0,e.value.cType?.pointee);}
  // Bind pointer-backed arrays to observed allocation identities. Each rebind
  // has its own interval; stale addresses cannot revive an old container.
  for(const [key,c] of [...contexts])if(c.role.data.cType.kind==='pointer'){
    contexts.delete(key);let current=null;
    for(let i=0;i<events.length;i++){
      const e=events[i],r=c.range,t=e.target;
      if(!t||t.objectId!==r.objectId||t.offset>=r.offset+r.size||t.offset+t.size<=r.offset||!['READ','WRITE'].includes(e.kind))continue;
      const ref=t.offset===r.offset&&t.size===r.size?e.value?.reference:null,dest=byObject.get(ref?.targetObjectId),offset=ref?.targetOffset??0;
      const extent=dest?storageExtent(dest.id,c.role.data.cType.pointee,offset,dest.size-offset):null,
        capacity=extent?extent.size/c.role.elementBytes:null;
      const valid=dest&&!extent.scalar&&ref.status==='in-bounds'&&Number.isSafeInteger(capacity)&&capacity>0;
      if(current&&valid&&current.range.objectId===dest.id&&current.range.offset===offset)continue;
      if(current)current.bindingEnd=i;current=null;
      if(!valid)continue;
      const role={...c.role,capacity,accesses:c.role.accesses.map(a=>({...a,moduloCapacity:a.moduloDivisors?.includes(capacity)??false}))};
      current={...c,id:`${c.id}:binding:${e.eventId}`,role,range:{objectId:dest.id,offset,size:capacity*role.elementBytes},
        bindingStart:i,bindingEnd:Infinity,bindingExecutionId:e.eventId,values:{},bytes:new Map(),states:[],groups:new Map(),accesses:[]};
      contexts.set(current.id,current);
    }
  }
  function indexInput(id,c,fields,seen=new Set()){
    if(seen.has(id))return false;seen.add(id);const e=byEvent.get(id);if(!e)return false;
    if(c.role.fields.some(f=>fields.includes(f.fieldNodeId)&&e.target?.objectId===(f.objectId??c.ownerObjectId)&&e.target.offset===(f.objectId?0:c.ownerOffset)+f.offset))return true;
    return (e.dataInputs??[]).some(id=>indexInput(id,c,fields,seen));
  }
  function indexReadPositions(id,c,f,seen=new Set()){
    if(seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.target?.objectId===(f.objectId??c.ownerObjectId)&&e.target.offset===(f.objectId?0:c.ownerOffset)+f.offset)
      return e.kind==='READ'?[events.indexOf(e)]:[];
    return (e.dataInputs??[]).flatMap(id=>indexReadPositions(id,c,f,seen));
  }
  for(let sequence=0;sequence<events.length;sequence++){
    const e=events[sequence];if(e.action==='object.begin')alive.add(e.objectId);
    if(e.action==='object.end')alive.delete(e.objectId);
    if(e.action==='frame.end')for(const id of e.endedObjects??[])alive.delete(id);
    for(const c of contexts.values()){
      const {role}=c,previous={...c.values},inBinding=sequence>=(c.bindingStart??0)&&sequence<(c.bindingEnd??Infinity),target=inBinding&&e.target?.objectId===c.range.objectId,
        own=role.fields.find(f=>e.target?.objectId===(f.objectId??c.ownerObjectId)&&(f.objectId?0:c.ownerOffset)+f.offset===e.target.offset&&f.size===e.target.size);
      let access=target&&['READ','WRITE'].includes(e.kind)?role.accesses.find(a=>instructionNodes.get(e.instructionId)?.has(a.nodeId)):null;
      // One compiler instruction can cover both an index-field read and the
      // eventual element read. Recorded address dependencies disambiguate them.
      if(access&&own&&access.indexFields.includes(own.fieldNodeId)&&!(e.addressInputs??[]).some(id=>indexInput(id,c,access.indexFields)))access=null;
      // Pointer helpers can access the same array without spelling its member.
      // Retain their actual slot accesses, without inventing index-field evidence.
      if(!access&&target&&['READ','WRITE'].includes(e.kind)&&e.target.size===role.elementBytes&&
        e.target.offset>=c.range.offset&&e.target.offset+e.target.size<=c.range.offset+c.range.size&&
        (e.target.offset-c.range.offset)%role.elementBytes===0)
        access={nodeId:defs.get(e.instructionId)?.sourceNodeId??null,
          indexFields:role.fields.filter(f=>(e.addressInputs??[]).some(id=>indexInput(id,c,[f.fieldNodeId]))).map(f=>f.fieldNodeId),moduloCapacity:false};
      let changed=false;
      if(own&&e.value&&['READ','WRITE'].includes(e.kind)){
        if(own.cType.kind==='pointer'){
          const ref=e.value.reference,offset=(ref?.targetOffset??0)-c.range.offset,
            value=ref?.targetObjectId===c.range.objectId&&offset>=0&&offset<=c.range.size&&offset%role.elementBytes===0?offset/role.elementBytes:undefined;
          changed=c.values[own.fieldNodeId]!==value;
          if(value===undefined)delete c.values[own.fieldNodeId];else c.values[own.fieldNodeId]=value;
        }else{
        const observed=observeScalarBytes(c.bytes.get(own.fieldNodeId),{size:own.size,signed:own.cType.signedness==='signed',
          value:(own.cType.signedness==='signed'?e.value.signed:e.value.unsigned)??e.value.decimal});
        if(observed){c.bytes.set(own.fieldNodeId,observed);const value=observed.value??undefined;
          changed=c.values[own.fieldNodeId]!==value;if(value===undefined)delete c.values[own.fieldNodeId];else c.values[own.fieldNodeId]=value;}
        }
      }
      if(e.memoryState&&['WRITE','SPACE'].includes(e.kind)){
        for(const f of role.fields.filter(f=>f.cType.kind!=='pointer'&&(e.target?.objectId??e.objectId)===(f.objectId??c.ownerObjectId))){const observed=observeScalarBytes(c.bytes.get(f.fieldNodeId),{size:f.size,signed:f.cType.signedness==='signed',
          snapshot:e.memoryState,start:e.target?.offset??0,offset:(f.objectId?0:c.ownerOffset)+f.offset});
          if(observed){c.bytes.set(f.fieldNodeId,observed);const value=observed.value??undefined;
            changed||=c.values[f.fieldNodeId]!==value;if(value===undefined)delete c.values[f.fieldNodeId];else c.values[f.fieldNodeId]=value;}}
      }
      const bulk=inBinding&&e.kind==='WRITE'&&e.action==='copy'&&e.target?.objectId===c.range.objectId&&e.sourceObjectId===c.range.objectId&&
        e.sourceSize===e.target.size&&
        e.target.offset>=c.range.offset&&e.target.offset+e.target.size<=c.range.offset+c.range.size&&
        e.sourceOffset>=c.range.offset&&e.sourceOffset+e.target.size<=c.range.offset+c.range.size&&
        [e.target.offset-c.range.offset,e.sourceOffset-c.range.offset,e.target.size].every(n=>n%role.elementBytes===0);
      if(inBinding&&(access||own||bulk)&&e.activationId){
        let g=c.groups.get(e.activationId);if(!g)c.groups.set(e.activationId,g={activationId:e.activationId,before:previous,after:{},accesses:[],updates:[],copies:[]});
        // A first read can supply a previously unobserved scalar without being a mutation.
        if(own&&e.kind==='READ'&&g.before[own.fieldNodeId]===undefined)g.before[own.fieldNodeId]=c.values[own.fieldNodeId];
        g.after={...c.values};
        if(own&&e.kind==='WRITE')g.updates.push({fieldNodeId:own.fieldNodeId,executionId:e.eventId,sequence,from:previous[own.fieldNodeId],to:c.values[own.fieldNodeId]});
        if(bulk)for(let at=0;at<e.target.size;at+=role.elementBytes){
          const from=(e.sourceOffset+at-c.range.offset)/role.elementBytes,to=(e.target.offset+at-c.range.offset)/role.elementBytes;
          g.copies.push({bulk:true,read:{executionId:e.eventId,sequence,physicalIndex:from,inBounds:true},
            write:{executionId:e.eventId,sequence,physicalIndex:to,inBounds:true}});
        }
        if(access){const relative=e.target.offset-c.range.offset,record=(role.elementType??role.data.cType.elementType??role.data.cType.pointee)?.kind==='record',
          physicalIndex=record?Math.floor(relative/role.elementBytes):relative/role.elementBytes,elementOffset=record?relative%role.elementBytes:0,a={executionId:e.eventId,sequence,kind:e.kind,
          physicalIndex,elementOffset,inBounds:Number.isInteger(physicalIndex)&&physicalIndex>=0&&physicalIndex<role.capacity&&elementOffset+e.target.size<=role.elementBytes,
          target:{...e.target},sourceNodeId:access.nodeId,indexFields:access.indexFields,moduloCapacity:access.moduloCapacity,
          dataInputs:e.dataInputs??[],addressInputs:e.addressInputs??[]};g.accesses.push(a);c.accesses.push(a);}
      }
      // Unselected index/count candidates may be loop-local. Their lifetime
      // must not end the storage view. Selected roles are checked separately.
      const active=inBinding&&alive.has(c.ownerObjectId)&&alive.has(c.range.objectId),last=c.states.at(-1),
        liveRoleIds=role.fields.filter(f=>!f.objectId||alive.has(f.objectId)).map(f=>f.fieldNodeId);
      if(changed||access||last?.active!==active||JSON.stringify(last?.liveRoleIds)!==JSON.stringify(liveRoleIds)||e.action==='frame.end'&&c.groups.has(e.activationId))c.states.push({afterExecutionId:e.eventId,sequence,fieldValues:{...c.values},active,
        liveRoleIds,currentAccess:access?c.accesses.at(-1):null});
    }
  }
  const result=[];
  for(const c of contexts.values()){
    const {role,range}=c,operations=[],cursorOperations=[];
    for(const f of role.fields)for(const original of c.groups.values()){
      const changes=original.updates.filter(u=>u.fieldNodeId===f.fieldNodeId);
      // Repeated inline operations can share a frame. Partition on observed
      // count mutations; helper frames with one mutation keep their full span.
      const groups=changes.length<=1?[original]:changes.map((u,i)=>({activationId:original.activationId,
        before:{...original.before,[f.fieldNodeId]:u.from},after:{...original.after,[f.fieldNodeId]:u.to},
        updates:original.updates.filter(x=>x.sequence>(changes[i-1]?.sequence??-1)&&x.sequence<=u.sequence),
        accesses:original.accesses.filter(a=>a.sequence>(changes[i-1]?.sequence??-1)&&a.sequence<(changes[i+1]?.sequence??Infinity)&&
          (!a.indexFields.includes(f.fieldNodeId)||a.addressInputs.some(id=>indexReadPositions(id,c,f).some(at=>at>(changes[i-1]?.sequence??-1)&&at<(changes[i+1]?.sequence??Infinity))))),
        copies:original.copies.filter(x=>x.write.sequence>(changes[i-1]?.sequence??-1)&&x.write.sequence<(changes[i+1]?.sequence??Infinity))}));
      for(const g of groups){
        const delta=g.after[f.fieldNodeId]-g.before[f.fieldNodeId],updates=g.updates.filter(u=>u.fieldNodeId===f.fieldNodeId);
        if(updates.length!==1||Math.abs(delta)!==1)continue;
        // A count can be independent of the indexed head/tail expression.
        // Endpoint and opposite-direction mutation proofs below decide its role.
        const copies=[...g.copies??[]];
        for(const w of g.accesses.filter(a=>a.kind==='WRITE'))for(const id of w.dataInputs)
          for(const r of valueFlow.reads(id)){
            const a=g.accesses.find(a=>a.executionId===r.eventId&&a.kind==='READ');
            if(a&&!copies.some(x=>x.write===w))copies.push({read:a,write:w});
          }
        const directed=g.accesses.filter(a=>a.indexFields.includes(f.fieldNodeId)&&!copies.some(x=>x.write===a||x.read===a));
        if(directed.length===1)cursorOperations.push({field:f,group:g,access:directed[0],delta,copies,operation:directed[0].kind==='WRITE'?'insert':'remove'});
        const candidates=g.accesses.filter(a=>a.kind===(delta===1?'WRITE':'READ')&&
          !copies.some(x=>delta===1?x.write===a:x.read===a));
        if(candidates.length!==1)continue;
        operations.push({field:f,group:g,access:candidates[0],delta,copies});
      }
    }
    const possibilities=[];
    // A cursor is a coordinate, not necessarily a count. Establish its origin,
    // direction and bias from initialized storage and opposite endpoint actions.
    for(const length of role.fields){
      const ops=cursorOperations.filter(o=>o.field===length),first=ops.find(o=>o.operation==='insert');if(!first)continue;
      const origin=c.states.find(s=>Number.isSafeInteger(s.fieldValues[length.fieldNodeId]))?.fieldValues[length.fieldNodeId],
        direction=first.delta,bias=first.access.physicalIndex-first.group.before[length.fieldNodeId];
      if(!Number.isSafeInteger(origin)||![-1,1].includes(direction))continue;
      if(origin+bias<0||origin+bias>=role.capacity)continue;
      const supported=new Set(ops.filter(o=>o.access.inBounds&&o.delta===(o.operation==='insert'?direction:-direction)&&
        o.access.physicalIndex===(o.operation==='insert'?o.group.before[length.fieldNodeId]:o.group.after[length.fieldNodeId])+bias));
      if(!ops.some(o=>o.operation==='insert'&&supported.has(o))||!ops.some(o=>o.operation==='remove'&&supported.has(o)))continue;
      // The zero-based count convention is already handled together with
      // shifting/head-based alternatives below. Keep only distinct coordinates.
      if(origin===0&&bias===0&&direction===1&&length.cType.kind!=='pointer')continue;
      const originEvidence=[];
      for(const e of events.filter(e=>e.kind==='CALC'&&ops.some(o=>o.group.activationId===e.activationId)))for(const s of e.steps??[]){
        if(!['<','>','==','!='].includes(s.operator)||s.inputs?.length!==2)continue;
        for(const [a,b]of [s.inputs,[...s.inputs].reverse()])if(!b.executionId&&Number(b.value?.decimal??b.value?.unsigned??b.value?.signed)===origin&&indexInput(a.executionId,c,[length.fieldNodeId]))originEvidence.push(e.eventId);
      }
      possibilities.push({length,head:null,role:'lifo',ops,supported,geometry:{origin,bias,direction},originEvidence,representation:'endpoint-cursor'});
    }
    const advances=(o,f)=>{
      const updates=o.group.updates.filter(u=>u.fieldNodeId===f.fieldNodeId),start=o.group.before[f.fieldNodeId],end=o.group.after[f.fieldNodeId];
      if(!Number.isSafeInteger(start)||!updates.length||updates[0].from!==start||updates.at(-1).to!==end)return false;
      if(updates.length===1)return end===start+1||end===(start+1)%role.capacity;
      return updates.length===2&&start===role.capacity-1&&updates[0].to===role.capacity&&updates[1].from===role.capacity&&end===0;
    };
    for(const length of role.fields.filter(f=>f.cType.signedness)){
      const ops=operations.filter(o=>o.field.fieldNodeId===length.fieldNodeId),inserts=ops.filter(o=>o.delta===1),removes=ops.filter(o=>o.delta===-1);
      if(!inserts.length)continue;
      const lifoInsert=o=>o.access.inBounds&&o.access.indexFields.includes(length.fieldNodeId)&&o.access.physicalIndex===o.group.before[length.fieldNodeId],
        lifoRemove=o=>o.access.inBounds&&o.access.indexFields.includes(length.fieldNodeId)&&o.access.physicalIndex===o.group.after[length.fieldNodeId];
      if(inserts.some(lifoInsert)&&removes.some(lifoRemove))possibilities.push({length,head:null,role:'lifo',ops,
        supported:new Set([...inserts.filter(lifoInsert),...removes.filter(lifoRemove)])});
      for(const head of role.fields.filter(f=>f!==length)){
        const fifoInsert=o=>o.access.inBounds&&o.access.physicalIndex===(o.group.before[head.fieldNodeId]+o.group.before[length.fieldNodeId])%role.capacity&&(
          o.access.moduloCapacity&&o.access.indexFields.includes(head.fieldNodeId)&&o.access.indexFields.includes(length.fieldNodeId)||
          role.fields.some(t=>t!==head&&t!==length&&o.access.indexFields.includes(t.fieldNodeId)&&
            o.access.physicalIndex===o.group.before[t.fieldNodeId]%role.capacity&&
            advances(o,t))),
          fifoRemove=o=>o.access.inBounds&&o.access.indexFields.includes(head.fieldNodeId)&&o.access.physicalIndex===o.group.before[head.fieldNodeId]%role.capacity&&
            advances(o,head);
        if(inserts.some(fifoInsert)&&removes.some(fifoRemove))possibilities.push({length,head,role:'fifo',ops,
          supported:new Set([...inserts.filter(fifoInsert),...removes.filter(fifoRemove)])});
        const frontInsert=o=>o.access.inBounds&&o.access.indexFields.includes(head.fieldNodeId)&&
          o.group.after[head.fieldNodeId]===(o.group.before[head.fieldNodeId]+role.capacity-1)%role.capacity&&
          o.access.physicalIndex===o.group.after[head.fieldNodeId],
          backRemove=o=>o.access.inBounds&&o.access.moduloCapacity&&o.access.indexFields.includes(head.fieldNodeId)&&
          o.access.indexFields.includes(length.fieldNodeId)&&o.group.after[head.fieldNodeId]===o.group.before[head.fieldNodeId]&&
          o.access.physicalIndex===(o.group.before[head.fieldNodeId]+o.group.after[length.fieldNodeId])%role.capacity;
        if(inserts.length&&removes.length&&(inserts.some(frontInsert)||removes.some(backRemove))&&
          (inserts.some(fifoInsert)||removes.some(fifoRemove)))possibilities.push({length,head,role:'deque',ops,
          qualificationEvidence:[ops.filter(o=>o.delta===1?frontInsert(o):backRemove(o)).map(o=>o.access.executionId),
            ops.filter(o=>o.delta===1?fifoInsert(o):fifoRemove(o)).map(o=>o.access.executionId)],
          supported:new Set(ops.filter(o=>o.delta===1?fifoInsert(o)||frontInsert(o):fifoRemove(o)||backRemove(o)))});
      }
      const shifted=(o,direction)=>{
        const size=o.delta===1?o.group.before[length.fieldNodeId]:o.group.after[length.fieldNodeId];
        if(size<0||size>role.capacity||o.copies.length!==size)return false;
        const destinations=new Set();
        for(const x of o.copies){if(x.write.physicalIndex-x.read.physicalIndex!==direction||!x.read.inBounds||!x.write.inBounds)return false;destinations.add(x.write.physicalIndex);}
        return destinations.size===size&&[...destinations].every(i=>direction===1?i>=1&&i<=size:i>=0&&i<size);
      };
      const shiftedRemove=o=>o.copies.length>0&&o.access.physicalIndex===0&&shifted(o,-1),
        shiftedInsert=o=>o.copies.length>0&&o.access.physicalIndex===0&&shifted(o,1);
      if(inserts.some(lifoInsert)&&removes.some(shiftedRemove))possibilities.push({length,head:null,role:'fifo',ops,
        supported:new Set([...inserts.filter(lifoInsert),...removes.filter(o=>o.access.physicalIndex===0&&shifted(o,-1))]),representation:'shifted-prefix'});
      if(inserts.some(shiftedInsert)&&removes.some(shiftedRemove))possibilities.push({length,head:null,role:'lifo',ops,
        supported:new Set([...inserts.filter(o=>o.access.physicalIndex===0&&shifted(o,1)),...removes.filter(o=>o.access.physicalIndex===0&&shifted(o,-1))]),representation:'shifted-prefix'});
      if(inserts.some(shiftedInsert)&&removes.some(lifoRemove)||inserts.some(lifoInsert)&&removes.some(lifoRemove)&&removes.some(shiftedRemove))
        possibilities.push({length,head:null,role:'deque',ops,
          qualificationEvidence:[ops.filter(o=>o.delta===1?shiftedInsert(o):shiftedRemove(o)).map(o=>o.access.executionId),
            ops.filter(o=>o.delta===1?lifoInsert(o):lifoRemove(o)).map(o=>o.access.executionId)],
          supported:new Set(ops.filter(o=>o.delta===1?lifoInsert(o)||o.access.physicalIndex===0&&shifted(o,1):lifoRemove(o)||o.access.physicalIndex===0&&shifted(o,-1))),representation:'shifted-prefix'});
    }
    // Count is a storage-range role independent of LIFO/FIFO ordering. Support
    // multi-access updates only with observed endpoint and boundary evidence.
    const prefixPossibilities=[];
    for(const length of role.fields.filter(f=>f.cType.signedness)){
      const bounds=(role.bounds??[]).filter(b=>b.fieldNodeId===length.fieldNodeId),observedBounds=events.filter(e=>e.kind==='CALC'&&
        bounds.some(b=>(e.steps??[]).some(s=>s.nodeId===b.sourceNodeId)||defs.get(e.instructionId)?.sourceNodeId===b.sourceNodeId));
      // An observed access to the last occupied endpoint also supplies a
      // membership boundary; a modulo access alone cannot do this.
      for(const s of c.states)if(s.currentAccess?.kind==='READ'&&!s.currentAccess.moduloCapacity&&
        s.currentAccess.indexFields.includes(length.fieldNodeId)&&s.currentAccess.physicalIndex===s.fieldValues[length.fieldNodeId]-1)
        observedBounds.push(byEvent.get(s.currentAccess.executionId));
      if(!observedBounds.length)continue;
      const ops=[];
      for(const original of c.groups.values()){
        const updates=original.updates.filter(u=>u.fieldNodeId===length.fieldNodeId);
        if(updates.length===1){
          const delta=original.after[length.fieldNodeId]-original.before[length.fieldNodeId];if(Math.abs(delta)!==1)continue;
          const endpoint=delta===1?original.before[length.fieldNodeId]:original.after[length.fieldNodeId],kind=delta===1?'WRITE':'READ',
            accesses=original.accesses.filter(a=>a.kind===kind&&a.indexFields.includes(length.fieldNodeId)&&!a.moduloCapacity),
            access=accesses.find(a=>a.physicalIndex===endpoint)??accesses[0];
          if(access)ops.push({field:length,group:original,access,delta,prefix:true,supported:access.inBounds&&access.physicalIndex===endpoint});
          continue;
        }
        for(let i=0;i<updates.length;i++){
          const u=updates[i],delta=u.to-u.from;if(Math.abs(delta)!==1)continue;
          const endpoint=delta===1?u.from:u.to,kind=delta===1?'WRITE':'READ',
            accesses=original.accesses.filter(a=>a.kind===kind&&!a.moduloCapacity&&a.sequence>(updates[i-1]?.sequence??-1)&&a.sequence<(updates[i+1]?.sequence??Infinity)&&
              a.addressInputs.some(id=>indexInput(id,c,[length.fieldNodeId]))),
            access=accesses.sort((a,b)=>(a.physicalIndex!==endpoint)-(b.physicalIndex!==endpoint)||Math.abs(a.sequence-u.sequence)-Math.abs(b.sequence-u.sequence))[0];
          if(!access)continue;
          const before=c.states.findLast(s=>s.sequence<u.sequence)?.fieldValues??original.before,
            after=c.states.findLast(s=>s.sequence<=Math.max(u.sequence,access.sequence))?.fieldValues??original.after,
            g={activationId:original.activationId,before:{...before,[length.fieldNodeId]:u.from},after:{...after,[length.fieldNodeId]:u.to},updates:[u],accesses:[access]};
          ops.push({field:length,group:g,access,delta,prefix:true,supported:access.inBounds&&access.physicalIndex===endpoint,completionSequence:Math.max(u.sequence,access.sequence)});
        }
      }
      if(!ops.some(o=>o.delta===1&&o.supported))continue;
      prefixPossibilities.push({length,head:null,role:'active-prefix',ops,supported:new Set(ops.filter(o=>o.supported)),
        boundEvidence:observedBounds.map(e=>e.eventId)});
    }
    // Head/tail rings do not need a count. A witnessed wrap and a reserve-slot
    // guard distinguish this convention from two independent linear cursors.
    for(const head of role.fields)for(const tail of role.fields){
      if(head===tail)continue;
      const ops=[];
      for(const g of c.groups.values())for(const [f,kind,operation]of [[head,'READ','remove'],[tail,'WRITE','insert']]){
        const updates=g.updates.filter(u=>u.fieldNodeId===f.fieldNodeId);if(!updates.length)continue;
        const accesses=g.accesses.filter(a=>a.kind===kind&&a.indexFields.includes(f.fieldNodeId));if(accesses.length!==1)continue;
        const access=accesses[0];
        // A copied source is not evidence of logical consumption.
        if(kind==='READ'&&events.some(e=>e.kind==='WRITE'&&(e.dataInputs??[]).some(id=>valueFlow.reads(id).some(r=>r.eventId===access.executionId))&&
          e.target?.objectId!==undefined&&e.target.objectId!==c.ownerObjectId&&e.target.size===role.elementBytes&&
          byObject.get(e.target.objectId)?.cType?.kind==='array'))continue;
        ops.push({field:head,group:g,access,delta:operation==='insert'?1:-1,operation,copies:[],cursor:f});
      }
      const good=ops.filter(o=>o.access.inBounds&&o.access.physicalIndex===o.group.before[o.cursor.fieldNodeId]&&advances(o,o.cursor));
      if(!good.some(o=>o.operation==='insert')||!good.some(o=>o.operation==='remove')||
        !good.some(o=>o.group.after[o.cursor.fieldNodeId]<o.group.before[o.cursor.fieldNodeId]))continue;
      const reserves=[];
      for(const e of events.filter(e=>e.kind==='CALC'))for(const s of e.steps??[]){
        if(!['==','!='].includes(s.operator)||s.inputs?.length!==2)continue;
        for(const [a,b]of [s.inputs,[...s.inputs].reverse()])if(indexInput(a.executionId,c,[head.fieldNodeId])&&indexInput(b.executionId,c,[tail.fieldNodeId])){
          const value=Number(b.value?.decimal??b.value?.unsigned??b.value?.signed),before=c.states.findLast(x=>x.sequence<events.indexOf(e))?.fieldValues[tail.fieldNodeId];
          if(Number.isSafeInteger(before)&&value===(before+1)%role.capacity&&value!==before)reserves.push(e.eventId);
        }
      }
      if(!reserves.length)continue;
      possibilities.push({length:head,head,tail,role:'fifo',ops,supported:new Set(good),representation:'reserved-slot-ring',
        boundEvidence:reserves,qualificationEvidence:[reserves,good.filter(o=>o.group.after[o.cursor.fieldNodeId]<o.group.before[o.cursor.fieldNodeId]).map(o=>o.access.executionId)]});
    }
    result.push(...containerHistory(c,[...possibilities,...prefixPossibilities],operations,{events,objects,views}));
  }
  return result;
}
