import {stateHistoryCoverage,appendStateSnapshot} from './state-history.mjs';
// Logical projections of observed pointers. Physical storage edges are never
// replaced, and field names are not evidence of child/parent/sibling roles.
import {topology} from '../shared/topology.mjs';
import {parentRelationTopology} from './functional-relation-topology.mjs';
import {recordPrefixMembership} from './record-prefix-membership.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const contains=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
const canonical=id=>id?.replace(/:slot:\d+$/,'');

export function pointerTreeStructures(plan,context,{maxStates=2048,maxRoots=256}={}){
  const {events,objects,structures,valueFlow}=context,raw=structures.find(s=>s.kind==='storage-reference-graph');if(!raw)return [];
  const objectById=new Map(objects.map(o=>[o.id,o]));
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    records=raw.nodes.filter(n=>n.kind==='record'),nodes=new Map(records.map(n=>[n.id,n])),slots=new Map(),proofs=[],rootBindings=new Map(),relations=new Map(),out=[];
  let omittedRoots=0;const ownedRoles=new Map();
  const allEdges=raw.changes.flatMap(c=>c.upsertEdges);
  const firstTypedEdge=new Map(),recordsByObject=new Map(),inputReads=new Map(),embeddedFields=new Map();
  for(const edge of allEdges)if(edge.targetTypeId&&!firstTypedEdge.has(key(edge.source)))firstTypedEdge.set(key(edge.source),edge);
  for(const n of records){if(!recordsByObject.has(n.range.objectId))recordsByObject.set(n.range.objectId,[]);recordsByObject.get(n.range.objectId).push(n);}
  const reads=id=>{if(!inputReads.has(id))inputReads.set(id,valueFlow.reads(id));return inputReads.get(id);};
  const recordField=id=>{if(!embeddedFields.has(id))embeddedFields.set(id,walk(defs.get(id)?.expression).find(n=>n.kind==='MemberExpr'&&n.cType?.kind==='array'&&n.cType.elementType?.kind==='record'));return embeddedFields.get(id);};
  for(const edge of allEdges)if(nodes.has(edge.from)&&edge.sourceTypeId===edge.targetTypeId)slots.set(key(edge.source),edge);
  // Embedded edge records may hold the child pointer on behalf of their
  // containing node. Require compiler array-of-record layout and real use.
  for(const access of events)if(access.kind==='READ')for(const id of access.addressInputs??[])for(const read of reads(id)){
    const field=recordField(read.instructionId);if(!field)continue;
    const edge=firstTypedEdge.get(key(read.target??{})),
      owner=edge&&recordsByObject.get(edge.source.objectId)?.find(n=>n.cType.recordTypeId===edge.targetTypeId&&contains(n.range,edge.source)),
      ref=read.value?.reference,target=ref&&recordsByObject.get(ref.targetObjectId)?.find(n=>n.cType.recordTypeId===edge?.targetTypeId&&n.range.offset===ref.targetOffset&&contains(n.range,access.target));
    if(!field||!owner||!target)continue;
    const role=canonical(edge.roleId),k=`${edge.targetTypeId}:${role}`;
    if(!ownedRoles.has(k))ownedRoles.set(k,{role,family:edge.targetTypeId,fieldNodeId:field.fieldNodeId,evidence:[]});
    ownedRoles.get(k).evidence.push({sourceExecutionId:read.eventId,targetAccessExecutionId:access.eventId,ownerRange:owner.range,source:edge.source});
  }
  // A pointer field must actually feed a dereference, not merely be printed.
  for(const access of events)if(access.kind==='READ'&&access.target){
    for(const id of access.addressInputs??[])for(const read of reads(id)){
      const edge=slots.get(key(read.target)),ref=read.value?.reference,target=ref&&recordsByObject.get(ref.targetObjectId)?.find(n=>n.range.offset===(ref.targetOffset??0)&&contains(n.range,access.target));
      if(!edge||!target)continue;
      proofs.push({roleId:canonical(edge.roleId),sourceExecutionId:read.eventId,targetAccessExecutionId:access.eventId,source:edge.source,
        from:edge.from,to:target.id,slotIndex:/:slot:(\d+)$/.test(edge.roleId)?Number(/:slot:(\d+)$/.exec(edge.roleId)[1]):null});
    }
  }
  // Call argument identity supplies roots, including pointer-array children.
  const calls=new Map();
  for(const e of events)if(e.action==='call')for(const input of e.inputs??[]){
    const inputs=reads(input.executionId),read=inputs.find(r=>slots.has(key(r.target))),edge=read&&slots.get(key(read.target));
    for(const r of inputs){if(slots.has(key(r.target)))break;
      const o=objects.find(o=>o.id===r.target?.objectId),ref=r.value?.reference;
      if(o?.cType?.kind!=='pointer'||!ref?.targetObjectId||!records.some(n=>n.range.objectId===ref.targetObjectId&&n.range.offset===(ref.targetOffset??0)))continue;
      const k=key(r.target);if(!rootBindings.has(k)){if(rootBindings.size<maxRoots)rootBindings.set(k,{kind:'pointer-slot',...r.target,discovered:e.eventId});else{omittedRoots++;context.inferenceBudget?.report('pointer-roots',maxRoots,e.eventId);}}
    }
    if(!edge||defs.get(e.instructionId)?.functionId!==e.resolvedFunctionId)continue;
    const k=`${e.activationId}:${e.instructionId}:${input.parameterIndex}`;
    if(!calls.has(k))calls.set(k,[]);
    calls.get(k).push({call:e,read,edge,target:read.value?.reference});
  }
  // Child-list traversal is witnessed by consecutive recursive calls: the
  // first value comes from the parent, the next from the preceding child.
  const siblingPatterns=new Map();
  for(const rows of calls.values())for(let i=1;i<rows.length;i++){
    const a=rows[0],before=rows[i-1],b=rows[i],child=canonical(a.edge.roleId),sibling=canonical(b.edge.roleId);
    if(child===sibling||a.edge.sourceTypeId!==b.edge.sourceTypeId||
      nodes.get(b.edge.from)?.range.objectId!==before.target?.targetObjectId||nodes.get(b.edge.from)?.range.offset!==(before.target?.targetOffset??0))continue;
    const k=`${child}:${sibling}`;if(!siblingPatterns.has(k))siblingPatterns.set(k,{child,sibling,family:a.edge.sourceTypeId,
      after:b.call.eventId,evidence:[a.read.eventId,a.call.eventId,b.read.eventId,b.call.eventId]});
  }
  // Iterative child-list scans: one cursor is seeded from a parent field and
  // subsequently updated from a different field of that very cursor target.
  const cursorSeeds=new Map();
  for(const e of events)if(e.kind==='WRITE'&&e.target?.objectId&&e.value?.cType?.pointee?.kind==='record'){
    const read=(e.dataInputs??[]).map(id=>valueFlow.chain(id).find(x=>x.kind==='READ')).find(r=>r&&slots.has(key(r.target??{}))),edge=read&&slots.get(key(read.target)),k=key(e.target),prior=cursorSeeds.get(k);
    if(!edge){cursorSeeds.delete(k);continue;}
    const fromCursor=(read.addressInputs??[]).some(id=>valueFlow.sourceRead(id)&&key(valueFlow.sourceRead(id).target??{})===k&&valueFlow.chain(id).some(x=>x.eventId===prior?.last.eventId));
    const previousTarget=prior?.last.value?.reference,sourceNode=nodes.get(edge.from);
    if(prior&&fromCursor&&canonical(edge.roleId)!==prior.role&&edge.sourceTypeId===prior.edge.sourceTypeId&&
      sourceNode?.range.objectId===previousTarget?.targetObjectId&&sourceNode?.range.offset===previousTarget?.targetOffset){
      const sibling=canonical(edge.roleId),id=`${prior.role}:${sibling}`;
      if(!siblingPatterns.has(id))siblingPatterns.set(id,{child:prior.role,sibling,family:edge.sourceTypeId,after:e.eventId,
        iterative:true,evidence:[prior.read.eventId,prior.seed.eventId,read.eventId,e.eventId]});
    }
    cursorSeeds.set(k,{read,edge,role:canonical(edge.roleId),seed:e,last:e});
  }
  for(const p of proofs){const read=byId.get(p.sourceExecutionId),expr=unwrap(defs.get(read.instructionId)?.expression),
    field=walk(expr).find(n=>n.kind==='MemberExpr'&&n.cType?.kind==='array'&&n.cType.elementType?.kind==='pointer');
    if(expr?.kind!=='ArraySubscriptExpr'||!field||!Number.isInteger(p.slotIndex))continue;
    const id=canonical(p.roleId),part=field.targetPath?.at(-1);
    if(!relations.has(id))relations.set(id,{id,kind:'record-embedded-index-array',field:{fieldNodeId:field.fieldNodeId,
      offset:part.offsetBits/8,cType:field.cType},family:slots.get(key(p.source)).sourceTypeId,evidence:[]});
    relations.get(id).evidence.push(p);
  }
  const prefix=recordPrefixMembership(plan,context,[...relations.values()],records.map(n=>({id:n.id,record:n.range}))),
    modes=[...[...relations.values()].filter(r=>prefix.proofs.some(p=>p.relationId===r.id)).map(r=>({mode:'counted-children',family:r.family,roles:[r.id],relation:r})),
      ...[...relations.values()].filter(r=>!prefix.proofs.some(p=>p.relationId===r.id)).map(r=>({mode:'sparse-children',family:r.family,roles:[r.id],relation:r})),
      ...[...ownedRoles.values()].map(r=>({mode:'owned-edge-records',family:r.family,roles:[r.role],owned:r})),
      ...[...siblingPatterns.values()].map(p=>({mode:'first-child-next-sibling',family:p.family,roles:[p.child,p.sibling],pattern:p})),
      ...[...new Set(proofs.map(p=>p.roleId))].filter(r=>!allEdges.some(e=>canonical(e.roleId)===r&&/:slot:/.test(e.roleId)))
        .map(r=>({mode:'inverse-parent',family:[...slots.values()].find(e=>e.roleId===r)?.sourceTypeId,roles:[r]}))];
  // A source-level pointer initialized to a record is a persistent record root;
  // it does not disappear merely because a traversal cursor's frame ends.
  for(const e of events)if(e.kind==='WRITE'&&e.value?.reference?.status==='in-bounds'&&e.value.cType?.pointee?.kind==='record'&&
    !(e.dataInputs??[]).flatMap(id=>reads(id)).some(r=>slots.has(key(r.target??{})))){
    const ref=e.value.reference,n=records.find(n=>n.range.objectId===ref.targetObjectId&&n.range.offset===ref.targetOffset&&n.cType.recordTypeId===e.value.cType.pointee.recordTypeId);
    if(!n||!['VarDecl','DeclRefExpr'].includes(unwrap(defs.get(e.instructionId)?.expression)?.kind))continue;
    const k=key(n.range);if(!rootBindings.has(k)){if(rootBindings.size<maxRoots)rootBindings.set(k,{kind:'record-root',...n.range,discovered:e.eventId});else{omittedRoots++;context.inferenceBudget?.report('pointer-roots',maxRoots,e.eventId);}}
  }
  const live=(n,at)=>{const o=objectById.get(n.range.objectId);return pos.get(n.discoveredAtExecutionId)<=at&&(!o.endedBy||pos.get(o.endedBy)>at);};
  const rootDiscovery=new Set([...rootBindings.values()].map(r=>r.discovered));
  for(const spec of modes){
    const family=records.filter(n=>n.cType.recordTypeId===spec.family),edges=new Map(),edgeBySource=new Map(),candidates=new Map(),proofAt=new Map();
    for(const p of proofs.filter(p=>spec.roles.includes(p.roleId)))if(!proofAt.has(p.sourceExecutionId))proofAt.set(p.sourceExecutionId,p.targetAccessExecutionId);
    const updates=new Map(raw.changes.map(c=>[c.afterExecutionId,c]));
    const evidence=[...proofAt.values(),...(spec.pattern?.evidence??[]),...(spec.owned?.evidence??[]).map(p=>p.targetAccessExecutionId),...prefix.proofs.filter(p=>p.relationId===spec.relation?.id).map(p=>p.afterExecutionId)];
    const evidenceIds=new Set(evidence);
    const knownRoles=at=>spec.owned?spec.owned.evidence.some(p=>pos.get(p.targetAccessExecutionId)<=at):spec.roles.every(r=>proofs.some(p=>p.roleId===r&&pos.get(p.targetAccessExecutionId)<=at));
    for(const e of events){
      const change=updates.get(e.eventId);for(const edge of change?.upsertEdges??[]){edges.set(edge.id,edge);if(!edgeBySource.has(key(edge.source)))edgeBySource.set(key(edge.source),edge.id);}
      const written=e.target??(e.memoryState&&e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null),
        countChanged=['WRITE','SPACE'].includes(e.kind)&&prefix.proofs.some(p=>p.relationId===spec.relation?.id&&written?.objectId===p.countSource.objectId&&
          written.offset<p.countSource.offset+p.countSource.size&&p.countSource.offset<written.offset+written.size);
      if(!change&&!countChanged&&!evidenceIds.has(e.eventId)&&!rootDiscovery.has(e.eventId))continue;
      const at=pos.get(e.eventId);if(!knownRoles(at)||spec.pattern&&at<pos.get(spec.pattern.after))continue;
      const active=family.filter(n=>live(n,at)),ids=new Set(active.map(n=>n.id)),selected=[...edges.values()].filter(x=>spec.roles.includes(canonical(x.roleId))).flatMap(x=>{
          if(spec.owned){const owner=active.find(n=>contains(n.range,x.source));return owner&&x.targetTypeId===spec.family?[{...x,from:owner.id,ownerRange:owner.range}]:[];}
          return ids.has(x.from)?[x]:[];
        }),
        normalize=x=>({...x,status:x.status==='null'?'observed-termination':x.status==='in-bounds'&&ids.has(x.to)?'observed':'unknown'}),stored=selected.map(normalize),
        members=prefix.at(e.eventId),snapshots=[];
      const activeByRange=new Map(active.map(n=>[key(n.range),n])),outgoingByNode=new Map(),firstByRole=new Map();
      for(const x of stored){if(!outgoingByNode.has(x.from))outgoingByNode.set(x.from,[]);outgoingByNode.get(x.from).push(x);
        if(!firstByRole.has(x.from))firstByRole.set(x.from,new Map());if(!firstByRole.get(x.from).has(x.roleId))firstByRole.get(x.from).set(x.roleId,x);}
      if(spec.mode==='inverse-parent'&&!proofs.some(p=>p.roleId!==spec.roles[0]&&slots.get(key(p.source))?.sourceTypeId===spec.family&&pos.get(p.targetAccessExecutionId)<=at)){
        // Components are independent. An unrelated record cannot invalidate a
        // complete parent forest or be silently added to its membership.
        const pending=new Set(active.map(n=>n.id));
        while(pending.size){const component=new Set([pending.values().next().value]);
          for(const id of component)for(const x of stored)if(x.from===id||x.to===id){if(ids.has(x.from))component.add(x.from);if(ids.has(x.to))component.add(x.to);}
          for(const id of component)pending.delete(id);
          const ns=active.filter(n=>component.has(n.id)),es=stored.filter(x=>component.has(x.from)),g=parentRelationTopology(ns,es);
          // A linear inverse is indistinguishable from an ordinary list.
          if(!g||g.maxChildren<2)continue;
          snapshots.push({root:{kind:'record-root',...nodes.get(g.roots[0]).range},ns,es:es.filter(x=>x.to).map(x=>({...x,from:x.to,to:x.from,storedEdgeIds:[x.id]})),complete:true,evidence:es.map(x=>x.lastObservationExecutionId)});
        }
      }else if(spec.mode!=='inverse-parent')for(const root of rootBindings.values()){
        if(at<pos.get(root.discovered))continue;
        const rootEdge=edges.get(edgeBySource.get(key(root))),start=root.kind==='record-root'?activeByRange.get(key(root))?.id:rootEdge?.to;if(!ids.has(start))continue;
        const reached=new Set(),links=[],pending=[start],used=[],conflicts=[];let complete=true;
        while(pending.length){const id=pending.pop();if(reached.has(id))continue;reached.add(id);
          if(spec.mode==='counted-children'){
            const m=members.find(m=>m.nodeId===id&&m.relationId===spec.relation.id);
            if(!m){complete=false;continue;}used.push(...m.evidenceExecutionIds);
            for(let i=0;i<m.count;i++){const x=firstByRole.get(id)?.get(`${spec.relation.id}:slot:${i}`);
              if(!x||x.status==='unknown'){complete=false;continue;}
              if(x.to){links.push({...x,storedEdgeIds:[x.id]});pending.push(x.to);}
            }
          }else if(['sparse-children','owned-edge-records'].includes(spec.mode)){
            const outgoing=outgoingByNode.get(id)??[];complete=false;
            used.push(...(spec.owned?.evidence??spec.relation?.evidence??[]).filter(p=>pos.get(p.targetAccessExecutionId)<=at).flatMap(p=>[p.sourceExecutionId,p.targetAccessExecutionId]));
            for(const x of outgoing)if(x.to&&x.status==='observed'){links.push({...x,storedEdgeIds:[x.id]});pending.push(x.to);}
          }else{
            let x=firstByRole.get(id)?.get(spec.pattern.child),path=[],seen=new Set();
            while(x&&x.status==='observed'&&!seen.has(x.to)){
              seen.add(x.to);path.push(x.id);links.push({...x,from:id,storedEdgeIds:[...path]});pending.push(x.to);
              x=firstByRole.get(x.to)?.get(spec.pattern.sibling);
            }
            if(!x||x.status!=='observed-termination')complete=false;
            if(x?.status==='observed'&&seen.has(x.to))conflicts.push({kind:'sibling-cycle',sourceEdgeId:x.id,executionId:x.lastObservationExecutionId});
            used.push(...spec.pattern.evidence);
          }
        }
        snapshots.push({root,ns:active.filter(n=>reached.has(n.id)),es:links,complete,evidence:used,conflicts});
      }
      for(const snap of snapshots){
        const id=`pointer-tree:${spec.mode}:${spec.roles.join('|')}:${key(snap.root)}`,g=topology(snap.ns,snap.es),
          row={afterExecutionId:e.eventId,alive:true,nodes:snap.ns.map(n=>({id:n.id,range:n.range})),edges:snap.es,
            evidenceExecutionIds:[...new Set(snap.evidence)],scopeRanges:[snap.root,...snap.ns.map(n=>n.range)],
            topology:{...g,rootNodeId:g.roots.length===1?g.roots[0]:null,reachableNodeIds:snap.ns.map(n=>n.id),edges:snap.es,
              maxChildren:Math.max(0,...snap.ns.map(n=>snap.es.filter(x=>x.from===n.id).length)),
              sharedChildren:snap.ns.filter(n=>snap.es.filter(x=>x.to===n.id).length>1).map(n=>n.id),relationConflicts:snap.conflicts??[],scope:'observed-edges',status:snap.complete?'observed':'partial'}};
        if(!candidates.has(id))candidates.set(id,{id,kind:'pointer-tree-projection',origin:'inferred',intent:'unconfirmed',mode:spec.mode,
          sourceStructureId:raw.id,root:snap.root,roleIds:spec.roles,nodes:[],edges:[],queryScoped:true,states:[],discoveredAtExecutionId:e.eventId,
          relationEvidence:proofs.filter(p=>spec.roles.includes(p.roleId)),
          prefixMembershipEvidence:prefix.proofs.filter(p=>p.relationId===spec.relation?.id),
          coverage:{...stateHistoryCoverage(maxStates),maxRoots,omittedRoots},
          interpretation:'logical relation view; stored pointer directions and inactive slots remain in sourceStructureId'});
        append(candidates.get(id),row);
      }
      // A projection disappearing on a count/link/lifetime update must not
      // retain its previous complete tree as the current state.
      const current=new Set(snapshots.map(s=>key(s.root)));
      for(const c of candidates.values())if(!current.has(key(c.root))&&c.states.at(-1)?.alive)append(c,{afterExecutionId:e.eventId,alive:false,nodes:[],edges:[],scopeRanges:[],evidenceExecutionIds:[],topology:null});
    }
    out.push(...candidates.values());
  }
  return out;
  function append(candidate,row){appendStateSnapshot(candidate.states,row,candidate.coverage);}
}
