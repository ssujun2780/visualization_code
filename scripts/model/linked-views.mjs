// Relation candidates over observed storage ranges. No C expression is executed
// here, and a failed structural invariant never repairs or discards a link.
import {rootedConnectivity} from './rooted-connectivity.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const position=s=>`${s?.file}:${s?.start?.byte??`${s?.line}:${s?.column}`}`;
function linkField(n){
  n=unwrap(n);const base=n?.children?.[0]?.cType,record=base?.kind==='pointer'?base.pointee:base,part=n?.targetPath?.at(-1);
  if(n?.kind!=='MemberExpr'||!n.fieldNodeId||!part||record?.kind!=='record'||n.cType?.pointee?.recordTypeId!==record.recordTypeId)return null;
  return {fieldNodeId:n.fieldNodeId,recordTypeId:record.recordTypeId,offset:part.offsetBits/8,size:part.sizeBits/8,
    cType:n.cType,recordType:record,source:n.source,evidence:'compiler self-reference field identity'};
}

export function bindLinkedStructures(plan){
  const nodes=new Map(),fields=new Map(),assignments=new Map(),declarations=new Map(plan.declarations.map(d=>[position(d.source),d.id])),
    declarationTypes=new Map(plan.declarations.map(d=>[d.id,d.cType])),functions=new Map((plan.functions??[]).map(f=>[f.symbol,f]));
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk))if(n?.nodeId)nodes.set(n.nodeId,n);
  for(const n of nodes.values()){const f=linkField(n);if(f)fields.set(f.fieldNodeId,f);}
  function origins(n){
    n=unwrap(n);if(!n)return [];
    if(n.kind==='DeclRefExpr')return [{declarationId:n.declarationId,fieldNodeIds:[]}];
    if(n.kind==='UnaryOperator'&&['&','*'].includes(n.operator))return origins(n.children[0]);
    const f=linkField(n);if(f)return origins(n.children[0]).map(o=>({...o,fieldNodeIds:[...o.fieldNodeIds,f.fieldNodeId]}));
    if(n.kind==='ConditionalOperator')return n.children.slice(1).flatMap(origins);
    return [];
  }
  for(const n of nodes.values()){
    const target=n.kind==='VarDecl'?declarations.get(position(n.source)):n.kind==='BinaryOperator'&&n.operator==='='?unwrap(n.children[0])?.declarationId:null;
    const rhs=n.kind==='VarDecl'?n.children.at(-1):n.children?.[1];
    if(target&&(declarationTypes.get(target)??n.cType)?.kind==='pointer'){if(!assignments.has(target))assignments.set(target,[]);assignments.get(target).push(...origins(rhs));}
  }
  // Parameter slots are declaration identities, including when mutually
  // recursive functions exchange argument positions. Names have no role.
  for(const d of plan.instructions)if(d.action==='call'&&d.callee){
    const callee=functions.get(d.callee);if(!callee)continue;
    for(let index=0;index<(d.arguments??[]).length;index++){
      const target=callee.parameters?.[index];if(!target||declarationTypes.get(target)?.kind!=='pointer')continue;
      if(!assignments.has(target))assignments.set(target,[]);
      assignments.get(target).push(...origins(d.arguments[index]).map(o=>({...o,callInstructionId:d.id,argumentIndex:index})));
    }
  }
  const recurrences=[],recurrenceKeys=new Set();
  for(const cursor of assignments.keys()){
    function search(id,path,visited,calls){for(const o of assignments.get(id)??[]){
      const next=[...path,...o.fieldNodeIds],callIds=o.callInstructionId?[...calls,o.callInstructionId]:calls;
      if(o.declarationId===cursor)for(const fieldNodeId of next){
        const key=`${cursor}:${fieldNodeId}`;if(!fields.has(fieldNodeId)||recurrenceKeys.has(key))continue;recurrenceKeys.add(key);
        recurrences.push({cursorDeclarationId:cursor,fieldNodeId,callInstructionIds:[...new Set(callIds)],
          evidence:callIds.length?'compiler recurrence through call argument/parameter slots':'compiler cursor recurrence through field/temporary'});
      }
      else if(o.declarationId&&!visited.has(o.declarationId))search(o.declarationId,next,new Set(visited).add(o.declarationId),callIds);
    }}
    search(cursor,[],new Set([cursor]),[]);
  }
  const cursorIds=new Set(recurrences.map(r=>r.cursorDeclarationId)),anchors=[],rootDeclarations=new Set(),rootOrigins=[];
  // A traversal may receive its root through several parameter and local
  // alias slots. Follow field-free declaration dependencies to their
  // caller sources, but stop at field traversal and unsupported expressions
  // (including function returns). These are static candidates, not a union of
  // the objects seen in different invocations of those declarations.
  for(const cursor of cursorIds){
    const queue=[{id:cursor,viaDeclarationIds:[cursor],callInstructionIds:[]}],seen=new Set([cursor]);
    for(let index=0;index<queue.length;index++){
      const path=queue[index];
      for(const origin of assignments.get(path.id)??[]){
        const id=origin.declarationId;if(origin.fieldNodeIds.length||!id||seen.has(id))continue;seen.add(id);
        const next={id,viaDeclarationIds:[...path.viaDeclarationIds,id],
          callInstructionIds:[...path.callInstructionIds,...(origin.callInstructionId?[origin.callInstructionId]:[])]};
        if(!cursorIds.has(id)){
          rootDeclarations.add(id);rootOrigins.push({rootDeclarationId:id,cursorDeclarationId:cursor,
            viaDeclarationIds:next.viaDeclarationIds,callInstructionIds:next.callInstructionIds,
            evidence:'compiler declaration aliases and direct-call argument slots; runtime root identity remains separate'});
        }
        queue.push(next);
      }
    }
  }
  for(const n of nodes.values())if(n.kind==='BinaryOperator'&&['==','!='].includes(n.operator)){
    const [a,b]=n.children.map(unwrap);
    if(a?.kind!=='DeclRefExpr'||b?.kind!=='DeclRefExpr'||a.cType?.kind!=='pointer'||b.cType?.kind!=='pointer')continue;
    for(const [cursor,anchor]of [[a,b],[b,a]])if(cursorIds.has(cursor.declarationId)&&!cursorIds.has(anchor.declarationId))
      anchors.push({cursorDeclarationId:cursor.declarationId,anchorDeclarationId:anchor.declarationId,nodeId:n.nodeId,source:n.source});
  }
  const roles=[...fields.values()].filter(f=>recurrences.some(r=>r.fieldNodeId===f.fieldNodeId));
  plan.structureBindings??={};plan.structureBindings.linkRoles=roles;plan.structureBindings.linkRecurrences=recurrences;plan.structureBindings.linkAnchors=anchors;
  plan.structureBindings.linkRootDeclarations=[...rootDeclarations];
  plan.structureBindings.linkRootOrigins=rootOrigins;
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{linkRoleCandidates:roles.length,
    linkedStorageSupport:'record ranges, pointer slots and direct-call argument recurrence; indirect calls, return-value aliases/recurrence and arbitrary index links unresolved',
    linkRootAliasPolicy:'transitive field-free declaration and direct-call argument dependencies nominate roots; actual object/offset/lifetime determines each root state',
    relationPolicy:'candidate roles are separate from actual connectivity and lifetime'});
}

export function linkedStructures(plan,{events,objects,views}){
  const roles=plan.structureBindings?.linkRoles??[];if(!roles.length)return [];
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),byObject=new Map(objects.map(o=>[o.id,o])),
    decls=new Map(plan.declarations.map(d=>[d.id,d])),families=new Map(),nodes=new Map(),nodeAt=new Map(),objectDecl=new Map(),slotHistory=new Map(),roots=new Map();
  const slot=(id,offset)=>`${id}:${offset}`,recordId=t=>t?.recordTypeId;
  for(const r of roles){if(!families.has(r.recordTypeId))families.set(r.recordTypeId,[]);families.get(r.recordTypeId).push(r);}
  function addNode(objectId,offset,type){
    if(!families.has(recordId(type)))return null;const o=byObject.get(objectId),size=type.sizeBits/8;
    if(!o||offset<0||offset+size>o.size)return null;
    const id=`node:${objectId}:${offset}:${type.recordTypeId}`;
    if(!nodes.has(id)){const n={id,objectId,offset,size,recordTypeId:type.recordTypeId,storage:o.storage,
      sourceTemporary:!!defs.get(byEvent.get(o.createdBy)?.instructionId)?.sourceTemporary};nodes.set(id,n);nodeAt.set(`${slot(objectId,offset)}:${type.recordTypeId}`,id);}
    return nodes.get(id);
  }
  for(const o of objects){
    objectDecl.set(o.id,defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId);
    addNode(o.id,0,o.cType);
  }
  for(const e of events){const r=e.value?.reference;if(r?.targetObjectId)addNode(r.targetObjectId,r.targetOffset??0,e.value?.cType?.pointee);}
  const cursors=new Set((plan.structureBindings.linkRecurrences??[]).map(r=>r.cursorDeclarationId));
  const rootDeclarations=new Set(plan.structureBindings.linkRootDeclarations??[]);
  const anchors=new Set((plan.structureBindings.linkAnchors??[]).map(r=>r.anchorDeclarationId));
  function addRoot(kind,objectId,offset,type,evidence){
    if(!families.has(recordId(type)))return;
    const id=`linked:${kind}:${objectId}:${offset}:${type.recordTypeId}`;
    if(!roots.has(id))roots.set(id,{id,kind:'linked-structure',root:{kind,objectId,offset,recordTypeId:type.recordTypeId},
      roles:families.get(type.recordTypeId),evidence:[evidence],states:[],members:new Set(),inversePairs:new Map(),observedRoles:new Set()});
  }
  for(const e of events){
    if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId&&e.value?.cType?.pointee?.kind==='record'){
      const id=slot(e.target.objectId,e.target.offset);if(!slotHistory.has(id))slotHistory.set(id,{objectId:e.target.objectId,offset:e.target.offset,type:e.value.cType.pointee,size:e.value.cType.sizeBits/8,targets:new Set()});
      slotHistory.get(id).targets.add(`${e.value.reference?.targetObjectId??'null'}:${e.value.reference?.targetOffset??0}`);
    }
    const ref=e.value?.reference,type=e.value?.cType;
    if(ref?.targetObjectId&&type?.pointee?.kind==='pointer'&&type.pointee.pointee?.kind==='record'){
      const embedded=[...nodes.values()].some(n=>n.objectId===ref.targetObjectId&&ref.targetOffset>=n.offset&&ref.targetOffset<n.offset+n.size);
      if(!embedded)addRoot('pointer-slot',ref.targetObjectId,ref.targetOffset??0,type.pointee.pointee,'observed address of root pointer slot');
    }
    if(e.kind==='WRITE'&&anchors.has(objectDecl.get(e.target?.objectId))&&ref?.targetObjectId)
      addRoot('anchor',ref.targetObjectId,ref.targetOffset??0,type?.pointee,'compiler cursor/anchor comparison + observed anchor target');
  }
  for(const h of slotHistory.values()){
    const declaration=decls.get(objectDecl.get(h.objectId));
    const embedded=[...nodes.values()].some(n=>n.objectId===h.objectId&&h.offset>=n.offset&&h.offset<n.offset+n.size);
    const ordinary=declaration?.kind==='VarDecl'&&(h.targets.size>1||rootDeclarations.has(declaration.id))&&
        (!cursors.has(declaration.id)||h.targets.values().next().value==='null:0'),
      parameter=declaration?.kind==='ParmVarDecl'&&rootDeclarations.has(declaration.id)&&!cursors.has(declaration.id);
    // An array decay or a call result need not have a caller-side pointer
    // variable. The received parameter is itself an observed root slot, scoped
    // to this activation's object identity, even when its static origin is unknown.
    if((ordinary||parameter)&&!embedded)
      addRoot('pointer-slot',h.objectId,h.offset,h.type,parameter?'observed non-cursor parameter root in its activation':'observed non-cursor root pointer slot');
  }
  const alive=new Set(),slots=new Map(),slotBytes=new Map(),ended=new Map();
  function target(ref,family){return ref?.targetObjectId?nodeAt.get(`${slot(ref.targetObjectId,ref.targetOffset??0)}:${family}`)??null:null;}
  const snapshotRef=(address)=>{
    if(address===0)return {targetObjectId:null,targetOffset:0,status:'null'};
    const o=[...alive].map(id=>byObject.get(id)).find(o=>address>=o.address&&address<o.address+o.size);
    return o?{targetObjectId:o.id,targetOffset:address-o.address,status:'in-bounds',evidence:'recorded snapshot and live allocation range'}:
      {targetObjectId:null,targetOffset:0,status:'unresolved',address};
  };
  function relation(n,r){const s=slots.get(slot(n.objectId,n.offset+r.offset));if(!s)return null;const to=target(s.reference,n.recordTypeId);
    return {from:n.id,to,fieldNodeId:r.fieldNodeId,source:{objectId:n.objectId,offset:n.offset+r.offset,size:r.size},
      reference:s.reference,lastWrite:s.lastWrite,status:s.reference?.targetObjectId&&!alive.has(s.reference.targetObjectId)?'ended-target':s.reference?.status??'unknown'};
  }
  function state(c,e){
    const family=c.root.recordTypeId,rootAlive=alive.has(c.root.objectId),anchor=c.root.kind==='anchor'?nodeAt.get(`${slot(c.root.objectId,c.root.offset)}:${family}`):null,
      rootReference=slots.get(slot(c.root.objectId,c.root.offset))?.reference,
      start=rootAlive?(anchor??target(rootReference,family)):null,connected=new Set(start?[start]:[]),
      topology=rootedConnectivity(start,{nodes,roles:c.roles,relation,isAlive:n=>alive.has(n.objectId),
        rootStatus:!rootAlive?'ended-root':anchor?'in-bounds':rootReference?.status??'unknown'});
    // Weak connectivity only associates participating nodes with this root;
    // ordered membership below follows each actual directed role separately.
    const familyNodes=[...nodes.values()].filter(n=>n.recordTypeId===family&&alive.has(n.objectId));
    const links=familyNodes.flatMap(n=>c.roles.map(r=>relation(n,r)).filter(Boolean));
    const neighbors=new Map();for(const l of links)if(l.to){for(const [a,b]of [[l.from,l.to],[l.to,l.from]]){if(!neighbors.has(a))neighbors.set(a,[]);neighbors.get(a).push(b);}}
    const queue=[...connected];for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])??[])if(!connected.has(next)){connected.add(next);queue.push(next);}
    const orders=c.roles.map(r=>{
      const ids=[],seen=new Set();let at=start,termination='unknown';
      if(anchor&&rootAlive){const edge=relation(nodes.get(anchor),r);at=edge?.to;termination=edge?.status==='null'?'null':'unknown';if(at===anchor)return {fieldNodeId:r.fieldNodeId,nodeIds:[],termination:'anchor'};}
      else if(!at){const ref=slots.get(slot(c.root.objectId,c.root.offset))?.reference;termination=!rootAlive?'ended-root':ref?.status==='null'?'null':ref?.status??'unknown';}
      while(at){if(at===anchor){termination='anchor';break;}if(seen.has(at)){termination='cycle';break;}seen.add(at);ids.push(at);
        const n=nodes.get(at);if(!n||!alive.has(n.objectId)){termination='ended-target';break;}const edge=relation(n,r);
        if(!edge){termination='unknown';break;}if(!edge.to){termination=edge.status;break;}at=edge.to;
      }
      return {fieldNodeId:r.fieldNodeId,nodeIds:ids,termination};
    });
    // A mixed path (first field, then second field) is as reachable as a
    // repeated single-field chain. Incoming aliases are not root members.
    for(const id of [...topology.reachableNodeIds,...topology.endedTargetNodeIds])c.members.add(id);
    const edges=[...c.members].flatMap(id=>{const n=nodes.get(id);return c.roles.map(r=>relation(n,r)).filter(Boolean);});
    for(const a of c.roles)for(const b of c.roles)if(a.fieldNodeId<b.fieldNodeId){
      const key=`${a.fieldNodeId}:${b.fieldNodeId}`;
      if(edges.some(l=>l.fieldNodeId===a.fieldNodeId&&l.to&&l.to!==l.from&&edges.some(m=>m.from===l.to&&m.to===l.from&&m.fieldNodeId===b.fieldNodeId)))
        c.inversePairs.set(key,{fields:[a.fieldNodeId,b.fieldNodeId],evidence:'observed reciprocal references across distinct nodes'});
    }
    const reached=new Set(topology.reachableNodeIds),inconsistencies=[];
    for(const pair of c.inversePairs.values())for(const edge of edges.filter(x=>pair.fields.includes(x.fieldNodeId)&&x.to&&reached.has(x.from)&&reached.has(x.to)&&alive.has(nodes.get(x.from)?.objectId)&&alive.has(nodes.get(x.to)?.objectId))){
      const opposite=pair.fields.find(id=>id!==edge.fieldNodeId),back=edges.find(x=>x.from===edge.to&&x.fieldNodeId===opposite);
      if(back&&back.to!==edge.from)inconsistencies.push({kind:'reciprocal-mismatch',from:edge.from,to:edge.to,fieldNodeId:edge.fieldNodeId,oppositeFieldNodeId:opposite});
    }
    const activeMembers=[...c.members].filter(id=>alive.has(nodes.get(id).objectId)),
      row={afterExecutionId:e.eventId,rootAlive,orders,edges,activeMembers,reachableMembers:[...reached],topology,
        detachedMembers:activeMembers.filter(id=>!reached.has(id)),endedMembers:[...c.members].filter(id=>ended.has(nodes.get(id).objectId)),
        associatedStorage:[...connected].filter(id=>!c.members.has(id)).map(id=>{const n=nodes.get(id);return {nodeId:id,objectId:n.objectId,offset:n.offset,size:n.size,sourceTemporary:n.sourceTemporary,evidence:'incoming relation without observed root reachability'};}),
        unrelatedStorage:familyNodes.filter(n=>!c.members.has(n.id)&&!connected.has(n.id)).map(n=>({nodeId:n.id,objectId:n.objectId,offset:n.offset,size:n.size,sourceTemporary:n.sourceTemporary,
          evidence:'observed live record without root reachability'})),
        temporaryStorage:{liveNodeIds:familyNodes.filter(n=>n.sourceTemporary).map(n=>n.id),
          endedNodeIds:[...nodes.values()].filter(n=>n.recordTypeId===family&&n.sourceTemporary&&ended.has(n.objectId)).map(n=>n.id)},
        inconsistencies,circular:orders.some(o=>o.termination==='anchor'||o.termination==='cycle'),
        status:inconsistencies.length?'intermediate-or-inconsistent':topology.status==='partial'?'partial':'observed'};
    const prev=c.states.at(-1);if(!prev||JSON.stringify({...prev,afterExecutionId:null})!==JSON.stringify({...row,afterExecutionId:null}))c.states.push(row);
  }
  for(const e of events){
    let changed=false;
    if(e.action==='object.begin'){alive.add(e.objectId);changed=true;}
    if(e.action==='object.end'){alive.delete(e.objectId);ended.set(e.objectId,{eventId:e.eventId,reason:e.reason});changed=true;}
    if(e.action==='frame.end')for(const id of e.endedObjects??[]){alive.delete(id);ended.set(id,{eventId:e.eventId,reason:'frame-end'});changed=true;}
    if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId&&e.value?.reference){
      const key=slot(e.target.objectId,e.target.offset),old=slots.get(key),next={reference:e.value.reference,lastWrite:e.kind==='WRITE'?e.eventId:old?.lastWrite??null};
      const observed=observeScalarBytes(slotBytes.get(key),{size:e.value.cType?.sizeBits/8||e.target.size,value:e.value.address});
      if(observed)slotBytes.set(key,observed);
      if(JSON.stringify(old)!==JSON.stringify(next)){slots.set(key,next);changed=true;}
      if(e.kind==='READ')for(const c of roots.values())for(const r of c.roles)if([...nodes.values()].some(n=>n.recordTypeId===r.recordTypeId&&n.objectId===e.target.objectId&&n.offset+r.offset===e.target.offset))c.observedRoles.add(r.fieldNodeId);
    }
    if(e.memoryState&&['WRITE','SPACE'].includes(e.kind)){
      const objectId=e.target?.objectId??e.objectId,start=e.target?.offset??0;
      const ranges=new Map();
      for(const n of nodes.values())if(n.objectId===objectId)for(const r of families.get(n.recordTypeId))ranges.set(n.offset+r.offset,r.size);
      for(const root of roots.values())if(root.root.kind==='pointer-slot'&&root.root.objectId===objectId){
        const size=slotHistory.get(slot(objectId,root.root.offset))?.size??families.get(root.root.recordTypeId)?.[0]?.size;
        if(size)ranges.set(root.root.offset,size);
      }
      for(const [offset,size]of ranges){
        if(offset>=start+e.memoryState.byteLength||offset+size<=start)continue;
        const key=slot(objectId,offset),previous=slotBytes.get(key),observed=observeScalarBytes(previous,{size,snapshot:e.memoryState,start,offset});
        if(!observed)continue;slotBytes.set(key,observed);const number=observed.value;
        if(number===null){slots.set(key,{reference:{status:'unknown',targetObjectId:null,targetOffset:null},lastWrite:e.eventId});changed=true;continue;}
        const copied=e.sourceObjectId&&slots.get(slot(e.sourceObjectId,(e.sourceOffset??0)+offset-start)),
          retained=previous?.value===number?slots.get(key)?.reference:null,reference=copied?.reference??retained??snapshotRef(number);
        slots.set(key,{reference,lastWrite:e.eventId});changed=true;
      }
    }
    if(changed)for(const c of roots.values())state(c,e);
  }
  const viewIds=new Map();for(const v of views){if(!viewIds.has(v.objectId))viewIds.set(v.objectId,[]);viewIds.get(v.objectId).push(v.id);}
  return [...roots.values()].filter(c=>c.members.size&&c.observedRoles.size).map(c=>{
    const {members,inversePairs,observedRoles,...base}=c,
      referenced=new Set([...members,...c.states.flatMap(s=>s.edges.map(e=>e.to).filter(Boolean))]),
      logicalNodes=[...referenced].map(id=>({...nodes.get(id),membershipEvidence:members.has(id)?'observed root reachability':'external reference target',ended:ended.get(nodes.get(id).objectId)??null}));
    const supported=c.roles.filter(r=>observedRoles.has(r.fieldNodeId)),paired=[...inversePairs.values()].filter(p=>p.fields.every(id=>observedRoles.has(id)));
    return {...base,nodes:[...new Set(logicalNodes.flatMap(n=>viewIds.get(n.objectId)??[]))],edges:[],logicalNodes,
      storageNodes:[...nodes.values()].filter(n=>n.recordTypeId===c.root.recordTypeId).map(n=>({...n,ended:ended.get(n.objectId)??null})),
      roles:supported,inversePairs:paired,views:[...(supported.length===1&&c.roles.length===1?['singly-linked-candidate']:[]),...(paired.length?['doubly-linked-candidate']:[]),
        ...new Set(c.states.flatMap(s=>s.topology.views)),
        ...(c.root.kind==='anchor'&&c.states.some(s=>s.orders.some(o=>o.termination==='anchor'))?['circular-linked-candidate','sentinel-candidate']:[])],
      snapshot:'event-indexed observed connectivity; candidate roles survive incomplete states',
      viewScope:'views summarize observed states; use states[].topology for a specific execution',
      membershipPolicy:'reachableMembers are current directed root members; activeMembers are live historical members and include detachedMembers',
      confidence:'compiler recurrence and observed field traversal; representation candidate, not algorithm proof',
      limitations:['direct calls and declaration/field dependencies only; indirect calls and return aliases may be unresolved',
        'roles are grouped by record family; alternative subsets such as child links versus parent links are not assigned semantic names',
        'tree candidates describe complete observed topology at individual states; cycles, sharing and unknown slots remain explicit',
        'ordering roles and search-tree invariants are unknown without comparison/branch and complete subtree evidence']};
  });
}
