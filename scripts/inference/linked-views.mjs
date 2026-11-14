// Relation candidates over observed storage ranges. No C expression is executed
// here, and a failed structural invariant never repairs or discards a link.
import {rootedConnectivity} from './rooted-connectivity.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {bindLinkedRootCollections,linkedRootRanges} from './linked-root-collections.mjs';
import {reciprocalIssues,annotateReciprocalEpisodes,supportedReciprocalRelations} from './linked-reciprocity.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {createSharedValues} from './shared-values.mjs';
import {returnedLinkRecurrences} from './returned-link-recurrences.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children[0];return n;};
const position=s=>`${s?.file}:${s?.start?.byte??`${s?.line}:${s?.column}`}`;
function linkField(n){
  n=unwrap(n);const base=n?.children?.[0]?.cType,record=base?.kind==='pointer'?base.pointee:base,part=n?.targetPath?.at(-1);
  if(n?.kind!=='MemberExpr'||!n.fieldNodeId||!part||record?.kind!=='record'||n.cType?.pointee?.recordTypeId!==record.recordTypeId)return null;
  return {fieldNodeId:n.fieldNodeId,recordTypeId:record.recordTypeId,offset:part.offsetBits/8,size:part.sizeBits/8,
    cType:n.cType,recordType:record,source:n.source,evidence:'compiler self-reference field identity'};
}

export function bindLinkedStructures(plan,trace=null){
  const nodes=new Map(),fields=new Map(),assignments=new Map(),declarations=new Map(plan.declarations.map(d=>[position(d.source),d.id])),
    declarationTypes=new Map(plan.declarations.map(d=>[d.id,d.cType])),functions=new Map((plan.functions??[]).map(f=>[f.symbol,f]));
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk))if(n?.nodeId)nodes.set(n.nodeId,n);
  for(const n of nodes.values()){const f=linkField(n);if(f)fields.set(f.fieldNodeId,f);}
  function origins(n){
    n=unwrap(n);if(!n)return [];
    if(n.kind==='DeclRefExpr')return [{declarationId:n.declarationId,fieldNodeIds:[]}];
    if(n.kind==='UnaryOperator'&&['&','*'].includes(n.operator))return origins(n.children[0]);
    if(n.kind==='ArraySubscriptExpr')return origins(n.children[0]).map(o=>({...o,indexedRootCollection:true}));
    const f=linkField(n);if(f)return origins(n.children[0]).map(o=>({...o,fieldNodeIds:[...o.fieldNodeIds,f.fieldNodeId]}));
    if(n.kind==='ConditionalOperator')return n.children.slice(1).flatMap(origins);
    // An observed return belongs to one activation, not every invocation of
    // that function. Runtime result deliveries/received pointer slots establish
    // actual roots separately; do not turn a call's arguments into its result.
    if(n.kind==='CallExpr')return [];
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
  for(const observed of returnedLinkRecurrences(plan,trace,linkField)){
    const key=`${observed.cursorDeclarationId}:${observed.fieldNodeId}`;
    if(!recurrenceKeys.has(key)){recurrenceKeys.add(key);recurrences.push(observed);}
  }
  const cursorIds=new Set(recurrences.map(r=>r.cursorDeclarationId)),anchors=[],rootDeclarations=new Set(),rootOrigins=[];
  // A traversal may receive its root through several parameter and local
  // alias slots. Follow field-free declaration dependencies to their
  // caller sources, but stop at field traversal and unsupported expressions
  // (static return aliases remain unsupported). These are candidates, not a union of
  // the objects seen in different invocations of those declarations.
  for(const cursor of cursorIds){
    const queue=[{id:cursor,viaDeclarationIds:[cursor],callInstructionIds:[]}],seen=new Set([cursor]);
    for(let index=0;index<queue.length;index++){
      const path=queue[index];
      for(const origin of assignments.get(path.id)??[]){
        const id=origin.declarationId;if(origin.fieldNodeIds.length||!id||seen.has(id))continue;seen.add(id);
        const next={id,viaDeclarationIds:[...path.viaDeclarationIds,id],
          callInstructionIds:[...path.callInstructionIds,...(origin.callInstructionId?[origin.callInstructionId]:[])],
          indexedRootCollection:!!(path.indexedRootCollection||origin.indexedRootCollection)};
        if(!cursorIds.has(id)){
          rootDeclarations.add(id);rootOrigins.push({rootDeclarationId:id,cursorDeclarationId:cursor,
            viaDeclarationIds:next.viaDeclarationIds,callInstructionIds:next.callInstructionIds,
            indexedRootCollection:next.indexedRootCollection,
            evidence:next.indexedRootCollection?'compiler indexed root collection and argument slots; each runtime root slot remains separate':
              'compiler declaration aliases and direct-call argument slots; runtime root identity remains separate'});
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
  const traversedFamilies=new Set([...fields.values()].filter(f=>recurrences.some(r=>r.fieldNodeId===f.fieldNodeId)).map(f=>f.recordTypeId));
  // Preserve all observed relations of the traversed family. Traversal roles
  // and full storage connectivity are separate projections of these fields.
  const roles=[...fields.values()].filter(f=>traversedFamilies.has(f.recordTypeId));
  const roleGroups=new Map();
  for(const cursor of cursorIds){
    const traversed=recurrences.filter(r=>r.cursorDeclarationId===cursor);
    for(const family of new Set(traversed.map(r=>fields.get(r.fieldNodeId)?.recordTypeId))){
      const matching=traversed.filter(r=>fields.get(r.fieldNodeId)?.recordTypeId===family),fieldNodeIds=[...new Set(matching.map(r=>r.fieldNodeId))].sort();
      if(!fieldNodeIds.length)continue;
      const id=`link-roles:${family}:${fieldNodeIds.join(':')}`;
      if(!roleGroups.has(id))roleGroups.set(id,{id,recordTypeId:family,fieldNodeIds,cursorDeclarationIds:[],callInstructionIds:[],evidence:'compiler traversal recurrence groups, independent of field names'});
      const group=roleGroups.get(id);group.cursorDeclarationIds.push(cursor);
      group.callInstructionIds=[...new Set([...group.callInstructionIds,...matching.flatMap(r=>r.callInstructionIds)])];
      if(matching.some(r=>r.returnWitnesses))group.evidence='compiler field identities and exact observed cursor/return recurrence; witnesses retained in linkRecurrences';
    }
  }
  function location(input){
    const n=unwrap(input);if(!n)return null;
    if(n.kind==='DeclRefExpr'&&n.declarationId)return {baseDeclarationId:n.declarationId,baseKind:n.cType?.kind==='pointer'?'pointer':'object',offset:0};
    if(n.kind==='MemberExpr'){
      const base=unwrap(n.children[0]),part=n.targetPath?.at(-1);
      if(n.memberAccess==='->'&&base?.kind!=='DeclRefExpr')return null;
      const parent=location(base);return parent&&Number.isInteger(part?.offsetBits)?{...parent,offset:parent.offset+part.offsetBits/8}:null;
    }
    if(n.kind==='ArraySubscriptExpr'){
      const base=location(n.children[0]),index=unwrap(n.children[1]),stride=n.cType?.sizeBits/8;
      return base&&index?.kind==='IntegerLiteral'&&/^\d+$/.test(index.literal)&&stride>0?{...base,offset:base.offset+Number(index.literal)*stride}:null;
    }
    return null;
  }
  const boundarySpecs=[];
  for(const n of nodes.values())if(n.kind==='BinaryOperator'&&['==','!='].includes(n.operator))for(const [at,other]of [[0,1],[1,0]]){
    const anchor=unwrap(n.children[at]),pointee=n.children[at]?.cType?.pointee??anchor?.cType?.pointee??
      (anchor?.cType?.kind==='array'?anchor.cType.elementType:null);
    if(pointee?.kind!=='record'||!roles.some(r=>r.recordTypeId===pointee.recordTypeId)||
      !origins(n.children[other]).some(o=>cursorIds.has(o.declarationId)))continue;
    const located=anchor.kind==='UnaryOperator'&&anchor.operator==='&'?location(anchor.children[0]):
      anchor.kind==='DeclRefExpr'&&!cursorIds.has(anchor.declarationId)?location(anchor):null;
    if(located)boundarySpecs.push({id:`link-boundary:${n.nodeId}:${at}`,comparisonNodeId:n.nodeId,anchorNodeId:anchor.nodeId,anchorOperandIndex:at,
      cursorDeclarationIds:origins(n.children[other]).map(o=>o.declarationId).filter(id=>cursorIds.has(id)),
      recordTypeId:pointee.recordTypeId,cType:pointee,...located,source:anchor.source,evidence:'compiler cursor comparison to a record address'});
  }
  plan.structureBindings??={};plan.structureBindings.linkRoles=roles;plan.structureBindings.linkRecurrences=recurrences;plan.structureBindings.linkAnchors=anchors;
  plan.structureBindings.linkRoleGroups=[...roleGroups.values()];plan.structureBindings.linkBoundarySpecs=boundarySpecs;
  plan.structureBindings.linkRootDeclarations=[...rootDeclarations];
  plan.structureBindings.linkRootOrigins=rootOrigins;
  bindLinkedRootCollections(plan);
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{linkRoleCandidates:roles.length,
    linkedStorageSupport:recurrences.some(r=>r.returnWitnesses)?
      'record ranges, pointer slots, direct-call argument recurrence and witnessed return-link recurrence; static return aliases and arbitrary index links unresolved':
      'record ranges, pointer slots and direct-call argument recurrence; indirect calls, return-value aliases/recurrence and arbitrary index links unresolved',
    linkRootAliasPolicy:'transitive field-free declaration and direct-call argument dependencies nominate roots; actual object/offset/lifetime determines each root state',
    relationPolicy:'candidate roles are separate from actual connectivity and lifetime'});
}

export function linkedStructures(plan,{events,objects,views,arrays=[],valueFlow,resultDeliveries=[]}){
  const roles=plan.structureBindings?.linkRoles??[];if(!roles.length)return [];
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),byObject=new Map(objects.map(o=>[o.id,o])),
    decls=new Map(plan.declarations.map(d=>[d.id,d])),families=new Map(),nodes=new Map(),nodeAt=new Map(),objectDecl=new Map(),slotHistory=new Map(),roots=new Map(),
    positions=new Map(events.map((e,i)=>[e.eventId,i])),flow=valueFlow??createValueFlow(plan,{events,resultDeliveries});
  const slot=(id,offset)=>`${id}:${offset}`,recordId=t=>t?.recordTypeId;
  const boundarySpecs=plan.structureBindings.linkBoundarySpecs??[],boundaryRecords=new Map(),payloadReads=new Set();
  const shared=createSharedValues(),lastPayload=new WeakMap(),stateDependencies=new WeakMap(),storageLists=new WeakMap(),storageRecords=new WeakMap(),componentIds=new WeakMap(),familyVersions=new Map(),familyCache=new Map(),relationCache=new Map(),
    nodesByObject=new Map(),rootsByObject=new Map(),rootsByFamily=new Map(),dirty=new Set(),discoveries=new Map(),topologyCaches=new Map();
  function invalidateTopologies(family,changed){
    const cache=topologyCaches.get(family);if(!cache)return;
    if(!changed){cache.values.clear();cache.dependencies.clear();return;}
    const affected=new Set();for(const id of changed)for(const key of cache.dependencies.get(id)??[])affected.add(key);
    for(const key of affected){const entry=cache.values.get(key);if(!entry)continue;cache.values.delete(key);for(const id of entry.dependencies){const keys=cache.dependencies.get(id);keys.delete(key);if(!keys.size)cache.dependencies.delete(id);}}
  }
  const markFamily=(family,changed)=>{familyVersions.set(family,(familyVersions.get(family)??0)+1);familyCache.delete(family);invalidateTopologies(family,changed);for(const c of rootsByFamily.get(family)??[])dirty.add(c);};
  const markObject=(id,range=null)=>{
    // Root-collection checkpoints may refresh reciprocal witness timestamps.
    // Preserve those boundaries; narrow only the topology dependencies below.
    for(const c of rootsByObject.get(id)??[])dirty.add(c);
    const affected=new Map();for(const n of nodesByObject.get(id)??[]){if(!affected.has(n.recordTypeId))affected.set(n.recordTypeId,[]);if(!range||n.offset<range.offset+range.size&&range.offset<n.offset+n.size)affected.get(n.recordTypeId).push(n.id);}
    for(const [family,ids]of affected)markFamily(family,ids);
  };
  for(const r of roles){if(!families.has(r.recordTypeId))families.set(r.recordTypeId,[]);families.get(r.recordTypeId).push(r);}
  function addNode(objectId,offset,type){
    if(!families.has(recordId(type)))return null;const o=byObject.get(objectId),size=type.sizeBits/8;
    if(!o||offset<0||offset+size>o.size)return null;
    const id=`node:${objectId}:${offset}:${type.recordTypeId}`;
    if(!nodes.has(id)){const n={id,objectId,offset,size,recordTypeId:type.recordTypeId,storage:o.storage,
      sourceTemporary:!!defs.get(byEvent.get(o.createdBy)?.instructionId)?.sourceTemporary};nodes.set(id,n);nodeAt.set(`${slot(objectId,offset)}:${type.recordTypeId}`,id);
      if(!nodesByObject.has(objectId))nodesByObject.set(objectId,[]);nodesByObject.get(objectId).push(n);}
    return nodes.get(id);
  }
  for(const o of objects){
    objectDecl.set(o.id,defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId);
    addNode(o.id,0,o.cType);
  }
  for(const e of events){const r=e.value?.reference;if(r?.targetObjectId)addNode(r.targetObjectId,r.targetOffset??0,e.value?.cType?.pointee);}
  const cursors=new Set((plan.structureBindings.linkRecurrences??[]).map(r=>r.cursorDeclarationId));
  const rootDeclarations=new Set(plan.structureBindings.linkRootDeclarations??[]);
  // An address comparison only nominates an anchor. A counter/marker test must
  // never remove a real node; activate anchors after a witnessed traversal exit.
  const anchors=new Set(),observedRolesByFamily=new Map();
  function addRoot(kind,objectId,offset,type,evidence){
    if(!families.has(recordId(type)))return;
    const id=`linked:${kind}:${objectId}:${offset}:${type.recordTypeId}`;
    if(!roots.has(id))roots.set(id,{id,kind:'linked-structure',root:{kind,objectId,offset,recordTypeId:type.recordTypeId},
      roles:families.get(type.recordTypeId),evidence:[evidence],states:[],members:new Set(),inversePairs:new Map(),observedRoles:new Set(observedRolesByFamily.get(type.recordTypeId)??[]),
      roleGroups:(plan.structureBindings.linkRoleGroups??[]).filter(g=>g.recordTypeId===type.recordTypeId).map(g=>({...g,auxiliaryFieldNodeIds:[]}))});
    const root=roots.get(id);
    if(!rootsByObject.has(objectId))rootsByObject.set(objectId,new Set());rootsByObject.get(objectId).add(root);
    if(!rootsByFamily.has(type.recordTypeId))rootsByFamily.set(type.recordTypeId,new Set());rootsByFamily.get(type.recordTypeId).add(root);
    dirty.add(root);return root;
  }
  // A cursor's observed entry value can come directly from an array/address,
  // another record's head field, or an alias. These are roots even when no
  // separate head variable exists. Successor reads depending on that same
  // cursor are progress, not a new list root at every iteration.
  function seedCursorRoots(){for(const e of events){
    if(e.kind!=='WRITE'||!cursors.has(objectDecl.get(e.target?.objectId))||e.target?.offset!==0)continue;
    const type=e.value?.cType?.pointee,ref=e.value?.reference;if(type?.kind!=='record'||!families.has(type.recordTypeId)||!['in-bounds','null'].includes(ref?.status))continue;
    const groupCursors=new Set((plan.structureBindings.linkRoleGroups??[]).filter(g=>g.recordTypeId===type.recordTypeId&&g.cursorDeclarationIds.includes(objectDecl.get(e.target.objectId))).flatMap(g=>g.cursorDeclarationIds)),
      reads=(e.dataInputs??[]).flatMap(id=>flow.reads(id)),sameCursor=r=>r.activationId===e.activationId&&groupCursors.has(objectDecl.get(r.target?.objectId)),
      progress=reads.some(r=>sameCursor(r)||walk(defs.get(r.instructionId)?.expression).some(n=>linkField(n)?.recordTypeId===type.recordTypeId)&&
        (r.addressInputs??[]).some(id=>flow.reads(id).some(sameCursor)));
    if(progress)continue;
    const sources=reads.filter(r=>r.target?.objectId&&r.value?.cType?.pointee?.recordTypeId===type.recordTypeId),
      // A short-lived alias must not replace the persistent container slot
      // that supplied its value. Stop at the nearest structural source read.
      source=sources.find(r=>['MemberExpr','ArraySubscriptExpr'].includes(unwrap(defs.get(r.instructionId)?.expression)?.kind))??sources[0],
      kind=source?'pointer-slot':'record-root',objectId=source?.target.objectId??ref.targetObjectId,offset=source?.target.offset??ref.targetOffset??0;
    if(!objectId)continue;
    // A compiler-nominated sentinel's own link fields are entry directions of
    // that container. Boundary observation below establishes its canonical
    // anchor; do not manufacture separate roots for each direction.
    if(source&&walk(defs.get(source.instructionId)?.expression).some(n=>linkField(n)?.recordTypeId===type.recordTypeId)&&
      (source.addressInputs??[]).flatMap(id=>flow.reads(id)).some(r=>boundarySpecs.some(spec=>spec.recordTypeId===type.recordTypeId&&
        spec.baseDeclarationId===objectDecl.get(r.target?.objectId)&&r.value?.reference?.targetObjectId===source.target.objectId)))continue;
    if(!source)addNode(objectId,offset,type);
    const existed=roots.has(`linked:${kind}:${objectId}:${offset}:${type.recordTypeId}`),
      root=addRoot(kind,objectId,offset,type,'observed cursor entry; compiler recurrence and identity-preserving value provenance');
    root.seedEvidence??=[];root.seedEvidence.push({executionId:e.eventId,cursorObjectId:e.target.objectId,sourceReadExecutionId:source?.eventId??null,reference:{...ref}});
    if(!existed)root.discoveredAtExecutionId=e.eventId;if(ref.status==='null')root.observedEmptySeed=true;
  }}
  for(const e of events){
    if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId&&e.value?.cType?.pointee?.kind==='record'){
      const id=slot(e.target.objectId,e.target.offset);if(!slotHistory.has(id))slotHistory.set(id,{objectId:e.target.objectId,offset:e.target.offset,type:e.value.cType.pointee,size:e.value.cType.sizeBits/8,targets:new Set()});
      slotHistory.get(id).targets.add(`${e.value.reference?.targetObjectId??'null'}:${e.value.reference?.targetOffset??0}`);
      if(e.value.reference?.status==='null')slotHistory.get(id).observedNull=true;
    }
    const ref=e.value?.reference,type=e.value?.cType;
    if(e.action==='argument'&&ref?.targetObjectId&&type?.pointee?.kind==='record'){
      const call=byEvent.get(e.callExecutionId),argument=unwrap(defs.get(call?.instructionId)?.arguments?.[e.parameterIndex]);
      const direct=argument?.kind==='DeclRefExpr'&&['array','record'].includes(argument.cType?.kind)||
        argument?.kind==='UnaryOperator'&&argument.operator==='&';
      const parameter=objectDecl.get(e.target?.objectId);
      if(direct&&(rootDeclarations.has(parameter)||cursors.has(parameter))){addNode(ref.targetObjectId,ref.targetOffset??0,type.pointee);
        addRoot('record-root',ref.targetObjectId,ref.targetOffset??0,type.pointee,'observed direct argument address/array decay');}
    }
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
  // Typed allocation ranges and actual indexed accesses also establish heap
  // root collections. Only observed slots are expanded; unobserved capacity
  // remains unknown, and record fields do not become sibling array roots.
  const ranges=linkedRootRanges(plan,{events,objects,arrays});
  const rootCollections=new Set([...roots.values()].filter(c=>c.root.kind==='pointer-slot')
    .map(c=>`${c.root.objectId}:${c.root.recordTypeId}`));
  for(const h of slotHistory.values()){
    const o=byObject.get(h.objectId),type=o?.cType,element=type?.elementType,size=element?.sizeBits/8;
    const range=ranges.find(a=>a.objectId===h.objectId&&a.recordTypeId===h.type.recordTypeId&&
      h.offset>=a.range.offset&&h.offset+h.size<=a.range.offset+a.range.size&&(h.offset-a.range.offset)%a.elementBytes===0);
    const embedded=[...nodes.values()].some(n=>n.objectId===h.objectId&&h.offset>=n.offset&&h.offset<n.offset+n.size);
    if(embedded)continue;
    if(!range&&(type?.kind!=='array'||element?.kind!=='pointer'||element.pointee?.recordTypeId!==h.type.recordTypeId||
        !size||h.offset<0||h.offset%size||h.offset+size>o.size||!h.observedNull||
        !rootCollections.has(`${h.objectId}:${h.type.recordTypeId}`)))continue;
    addRoot('pointer-slot',h.objectId,h.offset,h.type,range?'observed pointer slot in compiler-indexed typed allocation range':'observed null entry in compiler-bounded linked-root collection');
    const root=roots.get(`linked:pointer-slot:${h.objectId}:${h.offset}:${h.type.recordTypeId}`);
    if(h.observedNull)root.observedEmptyArraySlot=true;
    if(range)root.rootCollection={id:range.id,arrayId:range.arrayId,range:range.range,index:(h.offset-range.range.offset)/range.elementBytes};
  }
  seedCursorRoots();
  for(const c of roots.values())if(c.discoveredAtExecutionId){const id=c.discoveredAtExecutionId;if(!discoveries.has(id))discoveries.set(id,[]);discoveries.get(id).push(c);}
  const alive=new Set(),slots=new Map(),slotBytes=new Map(),ended=new Map();
  const boundaryCandidates=new Map(),boundaryTriggers=new Map();
  const integer=v=>Number(v?.decimal??v?.signed??v?.unsigned??v?.address??v?.bits);
  for(const [i,compare]of events.entries())if(compare.kind==='CALC')for(const step of compare.steps??[]){
    const spec=boundarySpecs.find(s=>s.comparisonNodeId===step.nodeId);
    if(!spec||unwrap(defs.get(compare.instructionId)?.expression)?.nodeId!==step.nodeId||
      !((step.operator==='=='&&integer(step.value)!==0)||(step.operator==='!='&&integer(step.value)===0)))continue;
    const branch=events.slice(i+1).find(e=>e.action==='branch'&&e.activationId===compare.activationId&&e.dataInputs?.includes(compare.eventId));
    if(!branch)continue;
    let terminal=['WhileStmt','ForStmt','DoStmt'].includes(defs.get(branch.instructionId)?.controlKind)&&integer(branch.condition)===0?branch:null;
    if(!terminal)for(let j=events.indexOf(branch)+1;j<events.length;j++){
      const e=events[j];if(e.activationId!==branch.activationId)continue;
      if(['return.value','return','break'].includes(e.action)&&e.controlInputs?.includes(branch.eventId)){terminal=e;break;}
      if(e.kind==='WRITE'||['call','branch','loop.next','frame.end'].includes(e.action))break;
    }
    if(!terminal)continue;
    if(!boundaryTriggers.has(terminal.eventId))boundaryTriggers.set(terminal.eventId,[]);
    boundaryTriggers.get(terminal.eventId).push({spec,compare,step,branch});
  }
  function observeBoundaries(e){
    let changed=false;
    for(const spec of boundarySpecs){
      let objectId,offset;
      if(spec.baseKind==='object'&&e.action==='object.begin'&&objectDecl.get(e.objectId)===spec.baseDeclarationId){objectId=e.objectId;offset=spec.offset;}
      if(spec.baseKind==='pointer'&&['READ','WRITE'].includes(e.kind)&&e.target?.offset===0&&
        objectDecl.get(e.target.objectId)===spec.baseDeclarationId&&e.value?.reference?.targetObjectId){
        objectId=e.value.reference.targetObjectId;offset=(e.value.reference.targetOffset??0)+spec.offset;
      }
      if(!objectId)continue;const node=addNode(objectId,offset,spec.cType);if(!node)continue;
      boundaryCandidates.set(`${spec.id}:${node.id}`,{spec,node,address:byObject.get(objectId).address+offset});
    }
    for(const {spec,compare,step,branch}of boundaryTriggers.get(e.eventId)??[]){
      // CALC inputs are flattened leaves, not positional AST operands. In an
      // equal-address termination, use the observed cursor value, not the base
      // pointer of an embedded anchor such as &owner->sentinel.
      const input=step.inputs?.find(input=>{const read=byEvent.get(input.executionId);return read?.kind==='READ'&&spec.cursorDeclarationIds?.includes(objectDecl.get(read.target?.objectId));}),
        value=input?.value??byEvent.get(input?.executionId)?.value;
      for(const candidate of boundaryCandidates.values()){
        if(candidate.spec!==spec||integer(value)!==candidate.address)continue;
        const {node}=candidate,{objectId,offset}=node;
        if(payloadReads.has(node.id)||!alive.has(objectId))continue;
        addRoot('anchor',objectId,offset,spec.cType,'observed equal-address traversal termination');
        if(!boundaryRecords.has(node.id)){
        boundaryRecords.set(node.id,{nodeId:node.id,objectId,offset,size:node.size,recordTypeId:node.recordTypeId,
          evidenceExecutionIds:[...new Set([compare.eventId,branch.eventId,e.eventId])],sourceNodeIds:[spec.comparisonNodeId],evidence:'observed comparison and controlled traversal exit at this record address'});changed=true;
        }
      }
    }
    return changed;
  }
  function target(ref,family){return ref?.targetObjectId?nodeAt.get(`${slot(ref.targetObjectId,ref.targetOffset??0)}:${family}`)??null:null;}
  const snapshotRef=(address)=>{
    if(address===0)return {targetObjectId:null,targetOffset:0,status:'null'};
    const o=[...alive].map(id=>byObject.get(id)).find(o=>address>=o.address&&address<o.address+o.size);
    return o?{targetObjectId:o.id,targetOffset:address-o.address,status:'in-bounds',evidence:'recorded snapshot and live allocation range'}:
      {targetObjectId:null,targetOffset:0,status:'unresolved',address};
  };
  function relation(n,r){const id=`${n.id}:${r.fieldNodeId}`,version=familyVersions.get(n.recordTypeId)??0,old=relationCache.get(id);if(old?.version===version)return old.value;
    const s=slots.get(slot(n.objectId,n.offset+r.offset)),to=s&&target(s.reference,n.recordTypeId),value=s?shared.intern({from:n.id,to,fieldNodeId:r.fieldNodeId,source:{objectId:n.objectId,offset:n.offset+r.offset,size:r.size},
      reference:s.reference,lastWrite:s.lastWrite,status:s.reference?.targetObjectId&&!alive.has(s.reference.targetObjectId)?'ended-target':s.reference?.status??'unknown'}):null;
    relationCache.set(id,{version,value});return value;
  }
  function familyState(family){let value=familyCache.get(family);if(value)return value;
    const familyNodes=[...nodes.values()].filter(n=>n.recordTypeId===family&&alive.has(n.objectId)),links=familyNodes.flatMap(n=>families.get(family).map(r=>relation(n,r)).filter(Boolean)),neighbors=new Map();
    for(const l of links)if(l.to)for(const [a,b]of [[l.from,l.to],[l.to,l.from]]){if(!neighbors.has(a))neighbors.set(a,[]);neighbors.get(a).push(b);}
    value={familyNodes,liveNodeIds:shared.intern(familyNodes.map(n=>n.id)),links,neighbors,components:new Map(),orders:new Map(),inversePairs:new Map(),temporaryStorage:shared.intern({liveNodeIds:familyNodes.filter(n=>n.sourceTemporary).map(n=>n.id),endedNodeIds:[...nodes.values()].filter(n=>n.recordTypeId===family&&n.sourceTemporary&&ended.has(n.objectId)).map(n=>n.id)})};familyCache.set(family,value);return value;
  }
  function getTopology(family,key,start,options){
    let cache=topologyCaches.get(family);if(!cache){cache={values:new Map(),dependencies:new Map()};topologyCaches.set(family,cache);}
    let entry=cache.values.get(key);if(entry)return entry.value;
    const value=shared.intern(rootedConnectivity(start,options)),dependencies=new Set([start,...value.reachableNodeIds,...value.endedTargetNodeIds,...value.terminalNodeIds,...value.unknownRelations.map(x=>x.from)].filter(Boolean));
    entry={value,dependencies};cache.values.set(key,entry);for(const id of dependencies){if(!cache.dependencies.has(id))cache.dependencies.set(id,new Set());cache.dependencies.get(id).add(key);}return value;
  }
  const sameSequence=(a,b)=>!!a&&a.length===b.length&&b.every((v,i)=>Object.is(v,a[i]));
  function storageList(c,kind,ids){
    let lists=storageLists.get(c);if(!lists){lists={};storageLists.set(c,lists);}
    const previous=lists[kind];if(previous&&sameSequence(previous.ids,ids))return previous.value;
    const value=shared.intern(ids.map(id=>{
      const n=nodes.get(id);let records=storageRecords.get(n);if(!records){records={};storageRecords.set(n,records);}
      return records[kind]??=shared.intern({nodeId:id,objectId:n.objectId,offset:n.offset,size:n.size,sourceTemporary:n.sourceTemporary,
        evidence:kind==='associated'?'incoming relation without observed root reachability':'observed live record without root reachability'});
    }));lists[kind]={ids,value};return value;
  }
  function state(c,e){
    // Inactive roots still retain historical-member and external-storage
    // changes. Their empty topology is shared; do not erase those checkpoints.
    if(c.discoveredAtExecutionId&&positions.get(e.eventId)<positions.get(c.discoveredAtExecutionId))return;
    const family=c.root.recordTypeId,rootAlive=alive.has(c.root.objectId),rootNode=nodeAt.get(`${slot(c.root.objectId,c.root.offset)}:${family}`),
      anchor=c.root.kind==='anchor'&&!payloadReads.has(rootNode)?rootNode:null,
      rootReference=slots.get(slot(c.root.objectId,c.root.offset))?.reference,
      direct=c.root.kind==='record-root'||c.root.kind==='anchor'&&!anchor?rootNode:null,
      start=rootAlive?(direct??anchor??target(rootReference,family)):null,
      cache=familyState(family),topologyAt=(key,options)=>getTopology(family,key,start,options),
      rootStatus=!rootAlive?'ended-root':anchor||direct?'in-bounds':rootReference?.status??'unknown',
      topologyKey=`${start}:${rootStatus}:${!!anchor}`,
      storageTopology=topologyAt(`storage:${topologyKey}`,{nodes,roles:c.roles,relation,isAlive:n=>alive.has(n.objectId),rootStatus}),
      options={nodes,relation,isAlive:n=>!!n&&alive.has(n.objectId),isTerminal:n=>!!n&&boundaryRecords.has(n.id)&&alive.has(n.objectId),
        includeRootBoundary:!!anchor,rootStatus:!rootAlive?'ended-root':anchor||direct?'in-bounds':rootReference?.status??'unknown'},
      hasBoundary=[...boundaryRecords.values()].some(b=>b.recordTypeId===family&&alive.has(b.objectId)),
      fullTopology=hasBoundary?topologyAt(`boundary:${topologyKey}`,{...options,roles:c.roles}):storageTopology,
      properGroups=c.roleGroups.filter(g=>g.fieldNodeIds.length<c.roles.length),
      widestGroups=properGroups.filter(g=>g.fieldNodeIds.length===Math.max(...properGroups.map(x=>x.fieldNodeIds.length))),
      selectedGroup=widestGroups.length===1?widestGroups[0]:null,
      roleTopologies=c.roleGroups.map(g=>({roleGroupId:g.id,fieldNodeIds:g.fieldNodeIds.slice(),auxiliaryFieldNodeIds:g.auxiliaryFieldNodeIds.slice(),
        topology:g.fieldNodeIds.length===c.roles.length?fullTopology:topologyAt(`${topologyKey}:${g.fieldNodeIds.join('|')}`,{...options,roles:c.roles.filter(r=>g.fieldNodeIds.includes(r.fieldNodeId))})})),
      topology=selectedGroup?roleTopologies.find(g=>g.roleGroupId===selectedGroup.id).topology:fullTopology;
    // Weak connectivity only associates participating nodes with this root;
    // ordered membership below follows each actual directed role separately.
    const {familyNodes,links,neighbors}=cache;
    let connected=cache.components.get(start);if(!connected){connected=new Set(start?[start]:[]);const queue=[...connected];for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])??[])if(!connected.has(next)){connected.add(next);queue.push(next);}cache.components.set(start,connected);}
    let orders=cache.orders.get(topologyKey);if(!orders){orders=shared.intern(c.roles.map(r=>{
      const ids=[],seen=new Set();let at=start,termination='unknown';
      if(anchor&&rootAlive){const edge=relation(nodes.get(anchor),r);at=edge?.to;termination=edge?.status==='null'?'null':'unknown';if(at===anchor)return {fieldNodeId:r.fieldNodeId,nodeIds:[],termination:'anchor'};}
      else if(!at){const ref=slots.get(slot(c.root.objectId,c.root.offset))?.reference;termination=!rootAlive?'ended-root':ref?.status==='null'?'null':ref?.status??'unknown';}
      while(at){if(at===anchor){termination='anchor';break;}if(boundaryRecords.has(at)){termination='sentinel';break;}if(seen.has(at)){termination='cycle';break;}seen.add(at);ids.push(at);
        const n=nodes.get(at);if(!n||!alive.has(n.objectId)){termination='ended-target';break;}const edge=relation(n,r);
        if(!edge){termination='unknown';break;}if(!edge.to){termination=edge.status;break;}at=edge.to;
      }
      return {fieldNodeId:r.fieldNodeId,nodeIds:ids,termination};
    }));cache.orders.set(topologyKey,orders);}
    // A mixed path (first field, then second field) is as reachable as a
    // repeated single-field chain. Incoming aliases are not root members.
    for(const id of [...storageTopology.reachableNodeIds,...storageTopology.endedTargetNodeIds,...topology.terminalNodeIds])c.members.add(id);
    const edges=shared.intern([...c.members].flatMap(id=>{const n=nodes.get(id);return c.roles.map(r=>relation(n,r)).filter(Boolean);}));
    let pairs=cache.inversePairs.get(anchor);if(!pairs){pairs=[];for(const a of c.roles)for(const b of c.roles)if(a.fieldNodeId<b.fieldNodeId){
      const key=`${a.fieldNodeId}:${b.fieldNodeId}`;
      if(links.some(l=>l.fieldNodeId===a.fieldNodeId&&l.to&&l.to!==l.from&&
        (!boundaryRecords.has(l.from)||l.from===anchor)&&(!boundaryRecords.has(l.to)||l.to===anchor)&&
        links.some(m=>m.from===l.to&&m.to===l.from&&m.fieldNodeId===b.fieldNodeId)))
        pairs.push([key,shared.intern({fields:[a.fieldNodeId,b.fieldNodeId],evidence:'observed reciprocal references across distinct nodes'})]);
    }cache.inversePairs.set(anchor,pairs);}for(const [key,pair]of pairs)c.inversePairs.set(key,pair);
    for(const group of c.roleGroups){
      group.auxiliaryFieldNodeIds=c.roles.map(r=>r.fieldNodeId).filter(id=>!group.fieldNodeIds.includes(id)&&
        [...c.inversePairs.values()].some(p=>p.fields.includes(id)&&p.fields.some(f=>group.fieldNodeIds.includes(f))));
      const projection=roleTopologies.find(p=>p.roleGroupId===group.id);projection.auxiliaryFieldNodeIds=group.auxiliaryFieldNodeIds.slice();
    }
    const reciprocalCandidates=selectedGroup?.auxiliaryFieldNodeIds.length?selectedGroup.auxiliaryFieldNodeIds.map(id=>({
      forwardFieldNodeIds:selectedGroup.fieldNodeIds,backwardFieldNodeIds:[id]})):
      [...c.inversePairs.values()].map(p=>({forwardFieldNodeIds:[p.fields[0]],backwardFieldNodeIds:[p.fields[1]]}));
    const reciprocalRelations=shared.intern(supportedReciprocalRelations(c,reciprocalCandidates,links,{observedRoles:c.observedRoles,groups:c.roleGroups,rootAlive,eventId:e.eventId,
      isAlive:id=>alive.has(nodes.get(id)?.objectId),isTerminal:id=>boundaryRecords.has(id)&&id!==anchor}));
    const reached=new Set(topology.reachableNodeIds),
      boundaries=shared.intern([...new Set([...topology.terminalNodeIds,...storageTopology.reachableNodeIds.filter(id=>boundaryRecords.has(id))])]
        .map(id=>boundaryRecords.get(id)).filter(Boolean).map(b=>({...b,evidenceExecutionIds:b.evidenceExecutionIds.slice(),sourceNodeIds:b.sourceNodeIds.slice()})));
    const activeMembers=shared.intern([...c.members].filter(id=>alive.has(nodes.get(id).objectId))),
      endedMembers=shared.intern([...c.members].filter(id=>ended.has(nodes.get(id).objectId))),
      observedRoleIds=shared.intern([...c.observedRoles]),observedPayloadNodeIds=shared.intern([...payloadReads].filter(id=>c.members.has(id))),
      sharedRoleTopologies=shared.intern(roleTopologies);
    let connectedIds=componentIds.get(connected);if(!connectedIds){connectedIds=shared.intern([...connected]);componentIds.set(connected,connectedIds);}
    // Check the complete state dependencies before assembling a checkpoint.
    // members only grows, so its size also captures its insertion order/history.
    // Reciprocal witness updates above MUST run even when all links are equal:
    // their establishedAtExecutionId can change at a root-collection write.
    const dependencies=[rootAlive,orders,edges,activeMembers,endedMembers,topology,storageTopology,
      sharedRoleTopologies,boundaries,observedRoleIds,observedPayloadNodeIds,selectedGroup?.id??null,
      reciprocalRelations,connectedIds,cache.liveNodeIds,cache.temporaryStorage,c.members.size];
    if(sameSequence(stateDependencies.get(c),dependencies))return;
    stateDependencies.set(c,dependencies);
    const inconsistencies=reciprocalIssues(edges,reciprocalRelations,{
      reached,isAlive:id=>alive.has(nodes.get(id)?.objectId),isTerminal:id=>boundaryRecords.has(id)&&id!==anchor}),
      row={afterExecutionId:e.eventId,rootAlive,orders,edges,activeMembers,reachableMembers:[...reached],topology,storageTopology,roleTopologies:sharedRoleTopologies,boundaries,
        observedRoleIds,
        membership:{physicalNodeIds:[...reached],boundaryNodeIds:boundaries.map(b=>b.nodeId),
          dataNodeIds:[...reached].filter(id=>!boundaries.some(b=>b.nodeId===id))},
        observedPayloadNodeIds,
        selectedRoleGroupId:selectedGroup?.id??null,reciprocalRelations,
        detachedMembers:activeMembers.filter(id=>!reached.has(id)),endedMembers,
        associatedStorage:storageList(c,'associated',connectedIds.filter(id=>!c.members.has(id))),
        unrelatedStorage:storageList(c,'unrelated',cache.liveNodeIds.filter(id=>!c.members.has(id)&&!connected.has(id))),
        temporaryStorage:cache.temporaryStorage,
        inconsistencies,circular:orders.some(o=>o.termination==='anchor'||o.termination==='cycle'),
        status:inconsistencies.length?'intermediate-or-inconsistent':topology.status==='partial'?'partial':'observed'};
    // Share child values without retaining another full payload wrapper in the
    // interning pool for every checkpoint. Keep only this root's last signature;
    // annotation passes may still attach endpoint policies and warning IDs.
    const signature=[];for(const key of Object.keys(row))if(key!=='afterExecutionId'){row[key]=shared.intern(row[key]);signature.push(key,row[key]);}
    const previous=lastPayload.get(c);
    if(!previous||previous.length!==signature.length||signature.some((v,i)=>!Object.is(v,previous[i]))){lastPayload.set(c,signature);row.inconsistencies=row.inconsistencies.map(issue=>({...issue}));c.states.push(row);}
  }
  function cursorReferences(id,seen=new Set()){
    if(seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.kind==='READ'&&cursors.has(objectDecl.get(e.target?.objectId)))return e.value?.reference?[e.value.reference]:[];
    return [...e.dataInputs??[],...e.addressInputs??[]].flatMap(id=>cursorReferences(id,seen));
  }
  for(const e of events){
    let changed=observeBoundaries(e);
    if(changed)for(const family of families.keys())markFamily(family);
    for(const c of discoveries.get(e.eventId)??[])dirty.add(c);
    if(e.kind==='READ'&&e.target&&!e.value?.reference){
      const n=unwrap(defs.get(e.instructionId)?.expression);
      const references=(e.addressInputs??[]).flatMap(id=>cursorReferences(id));
      // A neighbour's scalar field is not a visit to that neighbour. In
      // particular, reading a shared terminal's metadata through a child or
      // parent link must not turn it into a payload node. Require the actual
      // cursor referent, including its element offset and allocation identity.
      if(n?.kind==='MemberExpr'&&n.cType?.kind!=='pointer')for(const record of nodes.values())
        if(record.objectId===e.target.objectId&&e.target.offset>=record.offset&&e.target.offset+e.target.size<=record.offset+record.size&&
          references.some(ref=>ref.status==='in-bounds'&&ref.targetObjectId===record.objectId&&(ref.targetOffset??0)===record.offset)){
          if(!payloadReads.has(record.id)){changed=true;markFamily(record.recordTypeId,[record.id]);}
          payloadReads.add(record.id);if(boundaryRecords.delete(record.id))changed=true;
        }
    }
    // A termination comparison can mark a return-to-start boundary. Once the
    // record's data was consumed it cannot be excluded as a dummy sentinel.
    for(const id of payloadReads)if(boundaryRecords.delete(id)){changed=true;markFamily(nodes.get(id).recordTypeId,[id]);}
    if(e.action==='object.begin'){alive.add(e.objectId);changed=true;markObject(e.objectId);}
    if(e.action==='object.end'){alive.delete(e.objectId);ended.set(e.objectId,{eventId:e.eventId,reason:e.reason});changed=true;markObject(e.objectId);}
    if(e.action==='frame.end')for(const id of e.endedObjects??[]){alive.delete(id);ended.set(id,{eventId:e.eventId,reason:'frame-end'});changed=true;markObject(id);}
    if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId&&e.value?.reference){
      const key=slot(e.target.objectId,e.target.offset),old=slots.get(key),next={reference:e.value.reference,lastWrite:e.kind==='WRITE'?e.eventId:old?.lastWrite??null};
      const observed=observeScalarBytes(slotBytes.get(key),{size:e.value.cType?.sizeBits/8||e.target.size,value:e.value.address});
      if(observed)slotBytes.set(key,observed);
      if(shared.intern(old)!==shared.intern(next)){slots.set(key,next);changed=true;markObject(e.target.objectId,e.target);}
      if(e.kind==='READ')for(const r of roles)if([...nodes.values()].some(n=>n.recordTypeId===r.recordTypeId&&n.objectId===e.target.objectId&&n.offset+r.offset===e.target.offset)){
        if(!observedRolesByFamily.has(r.recordTypeId))observedRolesByFamily.set(r.recordTypeId,new Set());
        observedRolesByFamily.get(r.recordTypeId).add(r.fieldNodeId);
        for(const c of roots.values())if(c.root.recordTypeId===r.recordTypeId&&!c.observedRoles.has(r.fieldNodeId)){
          c.observedRoles.add(r.fieldNodeId);changed=true;dirty.add(c);
        }
      }
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
        if(number===null){slots.set(key,{reference:{status:'unknown',targetObjectId:null,targetOffset:null},lastWrite:e.eventId});changed=true;markObject(objectId,{offset,size});continue;}
        const copied=e.sourceObjectId&&slots.get(slot(e.sourceObjectId,(e.sourceOffset??0)+offset-start)),
          retained=previous?.value===number?slots.get(key)?.reference:null,reference=copied?.reference??retained??snapshotRef(number);
        slots.set(key,{reference,lastWrite:e.eventId});changed=true;markObject(objectId,{offset,size});
      }
    }
    for(const c of dirty)state(c,e);dirty.clear();
  }
  const viewIds=new Map();for(const v of views){if(!viewIds.has(v.objectId))viewIds.set(v.objectId,[]);viewIds.get(v.objectId).push(v.id);}
  return [...roots.values()].filter(c=>(c.members.size||c.observedEmptyArraySlot||c.observedEmptySeed)&&(c.observedRoles.size||c.rootCollection||c.observedEmptySeed)).map(c=>{
    const {members,inversePairs,observedRoles,reciprocalWitnesses,reciprocalContracts,...base}=c,
      referenced=new Set([...members,...c.states.flatMap(s=>s.edges.map(e=>e.to).filter(Boolean))]),
      logicalNodes=[...referenced].map(id=>({...nodes.get(id),membershipEvidence:members.has(id)?'observed root reachability':'external reference target',ended:ended.get(nodes.get(id).objectId)??null}));
    const supported=c.roles.filter(r=>observedRoles.has(r.fieldNodeId)),paired=[...inversePairs.values()].filter(p=>p.fields.every(id=>observedRoles.has(id))),
      observedEdges=new Set(c.states.flatMap(s=>s.edges.map(e=>e.fieldNodeId))),
      availableRoles=c.roles.filter(r=>observedRoles.has(r.fieldNodeId)||observedEdges.has(r.fieldNodeId));
    const warningEpisodes=annotateReciprocalEpisodes(c.states,events),hasChildSubset=c.roleGroups.some(g=>g.fieldNodeIds.length<c.roles.length);
    return {...base,nodes:[...new Set(logicalNodes.flatMap(n=>viewIds.get(n.objectId)??[]))],edges:[],logicalNodes,
      warningEpisodes,
      storageNodes:[...nodes.values()].filter(n=>n.recordTypeId===c.root.recordTypeId).map(n=>({...n,ended:ended.get(n.objectId)??null})),
      roles:availableRoles,candidateRoles:c.roles,traversalRoles:supported,inversePairs:paired,views:[...(supported.length===1&&c.roles.length===1?['singly-linked-candidate']:[]),...(paired.length&&!hasChildSubset?['doubly-linked-candidate']:[]),
        ...new Set(c.states.flatMap(s=>s.topology.views)),
        ...(c.states.some(s=>s.boundaries.length)?['sentinel-candidate']:[]),
        ...(c.root.kind==='anchor'&&c.states.some(s=>s.orders.some(o=>o.termination==='anchor'))?['circular-linked-candidate','sentinel-candidate']:[])],
      snapshot:'event-indexed observed connectivity; candidate roles survive incomplete states',
      viewScope:'views summarize observed states; use states[].topology for a specific execution',
      membershipPolicy:'reachableMembers are current directed root members; activeMembers are live historical members and include detachedMembers',
      confidence:observedRoles.size?'compiler recurrence and observed field traversal; representation candidate, not algorithm proof':
        'compiler recurrence and observed indexed root slot; field traversal remains unobserved',
      limitations:['direct calls and declaration/field dependencies only; indirect calls and return aliases may be unresolved',
        'traversal role subsets and reciprocal auxiliary roles are candidates; ambiguous subsets remain separate alternatives',
        'tree candidates describe complete observed topology at individual states; cycles, sharing and unknown slots remain explicit',
        'ordering roles and search-tree invariants are unknown without comparison/branch and complete subtree evidence']};
  });
}
