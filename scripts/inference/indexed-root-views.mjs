import {stateHistoryCoverage,appendStateSnapshot} from './state-history.mjs';
// Rooted views of existing integer relations. This consumer neither invents
// edges nor changes the global storage graph, values, or execution events.
import {queryCoindexedRecords} from './coindexed-record-views.mjs';
import {matchesBoundary} from './traversal-boundaries.mjs';
import {topology} from '../shared/topology.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const contains=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
const num=v=>{const raw=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);return raw!==undefined&&Number.isSafeInteger(Number(raw))?Number(raw):null;};
export function indexedRootStructures(plan,{events,objects,structures,valueFlow,inferenceBudget},{maxStates=2048,maxRoots=256}={}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    byObject=new Map(objects.map(o=>[o.id,o])),arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),out=[];
  const alive=(id,at)=>{const o=byObject.get(id);return o&&pos.get(o.createdBy)<=at&&at<(pos.get(o.endedBy)??Infinity);};
  for(const s of structures.filter(s=>['record-index-graph-candidate','value-index-graph-candidate','table-row-graph-candidate','coindexed-record-candidate'].includes(s.kind))){
    const domainArrays=s.arrays?s.arrays.map(a=>arrays.get(a.arrayId)).filter(Boolean):[arrays.get(s.containerId??s.arrayId)].filter(Boolean);
    if(!domainArrays.length)continue;
    const domains=domainArrays.map(a=>({a,range:a.range,stride:s.kind==='table-row-graph-candidate'?a.geometry.byteStrides[0]:a.elementBytes})),
      inside=r=>domains.some(d=>contains(d.range,r)),bindings=new Map();
    // Require a real index operand of the matching AST subscript, followed
    // through exact copies/call parameters. Matching numbers are insufficient.
    for(const e of events){if(e.kind!=='READ'||!e.target)continue;
      const d=domains.find(d=>contains(d.range,e.target));if(!d)continue;
      const index=Math.floor((e.target.offset-d.range.offset)/d.stride),subscripts=walk(defs.get(e.instructionId)?.expression)
        .filter(n=>n.kind==='ArraySubscriptExpr'&&n.cType?.sizeBits===d.stride*8);
      const indexNodes=new Set(subscripts.flatMap(n=>walk(n.children[1]).map(n=>n.nodeId)));
      for(const id of e.addressInputs??[]){const input=byId.get(id);
        if(num(input?.value)!==index||!walk(defs.get(input?.instructionId)?.expression).some(n=>indexNodes.has(n.nodeId)))continue;
        const chain=valueFlow.reads(id);
        // Follow external seed reads only up to the first stored link. Later
        // changes to an established root are tracked directly by slot identity.
        for(const read of chain){if(inside(read.target))break;
          if(!read.target||num(read.value)===null||!['signed','unsigned'].includes(read.value?.cType?.signedness))continue;
          const range={objectId:read.target.objectId,offset:read.target.offset,size:read.target.size},k=key(range);
          if(!bindings.has(k)&&bindings.size>=maxRoots)inferenceBudget?.report('indexed-roots',maxRoots,e.eventId);
          if(!bindings.has(k)&&bindings.size<maxRoots)bindings.set(k,{range,cType:read.value.cType,discovered:e.eventId,
            evidence:{rootReadExecutionId:read.eventId,indexExecutionId:id,targetAccessExecutionId:e.eventId,domainArrayId:d.a.id}});
        }
      }
    }
    // Extend an observed root-array role only through actual record insertion
    // and an identity-preserving index WRITE. Array capacity is not membership.
    const seeds=[...bindings.values()];
    for(const seed of seeds){const rootArray=[...arrays.values()].find(a=>contains(a.range,seed.range)&&a.elementBytes===seed.range.size);if(!rootArray)continue;
      for(const write of events){if(write.kind!=='WRITE'||!contains(rootArray.range,write.target)||write.target.size!==rootArray.elementBytes||bindings.has(key(write.target)))continue;
        const roots=(write.dataInputs??[]).flatMap(id=>valueFlow.chain(id)),indices=events.filter(e=>e.kind==='WRITE'&&inside(e.target)&&pos.get(e.eventId)<pos.get(write.eventId));
        let proof=null;
        for(const access of indices){const d=domains.find(d=>contains(d.range,access.target)),index=Math.floor((access.target.offset-d.range.offset)/d.stride);
          if(num(write.value)!==index)continue;
          const nodeIds=new Set(walk(defs.get(access.instructionId)?.expression).filter(n=>n.kind==='ArraySubscriptExpr').flatMap(n=>walk(n.children[1]).map(n=>n.nodeId)));
          for(const id of access.addressInputs??[]){const input=byId.get(id);if(num(input?.value)!==index||!walk(defs.get(input?.instructionId)?.expression).some(n=>nodeIds.has(n.nodeId)))continue;
            const common=valueFlow.chain(id).find(e=>roots.some(r=>r.eventId===e.eventId));if(common){proof={kind:'stored-index-seed',rootWriteExecutionId:write.eventId,indexExecutionId:id,
              originExecutionId:common.eventId,targetAccessExecutionId:access.eventId,domainArrayId:d.a.id,
              learnedRootReadExecutionId:seed.evidence.rootReadExecutionId,learnedTargetAccessExecutionId:seed.evidence.targetAccessExecutionId};break;}
          }if(proof)break;
        }
        if(proof&&bindings.size>=maxRoots)inferenceBudget?.report('indexed-roots',maxRoots,write.eventId);
        if(proof&&bindings.size<maxRoots)bindings.set(key(write.target),{range:{objectId:write.target.objectId,offset:write.target.offset,size:write.target.size},cType:write.value.cType,
          discovered:pos.get(seed.discovered)>pos.get(write.eventId)?seed.discovered:write.eventId,evidence:proof});
      }
    }
    const roleIds=s.kind==='record-index-graph-candidate'?s.relations.filter(r=>r.kind==='record-field').map(r=>r.id):
      s.kind==='coindexed-record-candidate'?[...new Set(s.relationEvidence.map(p=>p.sourceArrayId))]:
      s.kind==='table-row-graph-candidate'?[...new Set(s.states.flatMap(st=>st.roleIds))]:[s.arrayId];
    // Combine only roles actually used by the same traversal function pair.
    // Individual paths remain available; a combined cycle is a graph, not a tree.
    const groups=new Map(),roleSets=roleIds.map(id=>({ids:[id],after:null,evidence:[]}));
    const proofs=s.relations?.flatMap(r=>r.evidence.map(p=>({...p,roleId:r.id})))??
      (s.relationEvidence??[]).map(p=>({...p,roleId:p.sourceArrayId??s.states?.flatMap(st=>st.edges).find(e=>e.column===p.column)?.roleId}));
    for(const p of [...proofs].sort((a,b)=>pos.get(a.targetAccessExecutionId)-pos.get(b.targetAccessExecutionId))){const from=byId.get(p.sourceReadExecutionId??p.sourceExecutionId),to=byId.get(p.targetAccessExecutionId),
      f=defs.get(from?.instructionId)?.functionId,t=defs.get(to?.instructionId)?.functionId;
      if(!f||f!==t||!roleIds.includes(p.roleId))continue;
      if(!groups.has(f))groups.set(f,new Map());const g=groups.get(f);if(!g.has(p.roleId))g.set(p.roleId,p.targetAccessExecutionId);
      if(g.size<2)continue;
      const ids=[...g.keys()].sort(),evidence=[...g.values()],after=evidence.reduce((a,b)=>pos.get(a)>pos.get(b)?a:b),
        existing=roleSets.find(r=>JSON.stringify(r.ids)===JSON.stringify(ids));
      // Keep each observed prefix, using the earliest complete witness across
      // traversal functions rather than whichever function was visited first.
      if(!existing)roleSets.push({ids,evidence,after});
      else if(pos.get(after)<pos.get(existing.after)){existing.evidence=evidence;existing.after=after;}
    }
    for(const binding of bindings.values())for(const roleSet of roleSets){
      const selectedRoles=roleSet.ids,roleId=selectedRoles.join('|');
      const id=`indexed-root:${s.id}:${key(binding.range)}:${roleId}`,states=[],logical=new Map();let value=null,bytes=null,lastWrite=null,last=null,history=stateHistoryCoverage(maxStates),everNonempty=false;
      const updates=new Set([...(s.states??[]).map(st=>st.afterExecutionId),...(s.changes??[]).map(st=>st.afterExecutionId),binding.discovered,roleSet.after]);
      for(const e of events){
        const at=pos.get(e.eventId),target=e.target??(e.memoryState&&e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null),
          overlap=target?.objectId===binding.range.objectId&&target.offset<binding.range.offset+binding.range.size&&binding.range.offset<target.offset+target.size;
        if(overlap&&['READ','WRITE','SPACE'].includes(e.kind)){
          const next=observeScalarBytes(bytes,{size:binding.range.size,signed:binding.cType.signedness==='signed',
            ...(e.memoryState&&e.kind!=='READ'?{snapshot:e.memoryState,start:target.offset,offset:binding.range.offset}:
              key(target)===key(binding.range)?{value:e.value?.bits??num(e.value)}:
              {snapshot:{byteLength:target.size,ranges:[]},start:target.offset,offset:binding.range.offset})});
          if(next){bytes=next;value=next.value;lastWrite=e.eventId;}
        }
        if(at<pos.get(binding.discovered)||at<pos.get(s.discoveredAtExecutionId)||roleSet.after&&at<pos.get(roleSet.after)||
          !updates.has(e.eventId)&&!overlap&&e.action!=='object.end'&&e.action!=='frame.end')continue;
        const snap=s.kind==='coindexed-record-candidate'?queryCoindexedRecords(s,{events},{afterExecutionId:e.eventId}):
          s.states.findLast(st=>pos.get(st.afterExecutionId)<=at);
        if(!snap)continue;
        const rootAlive=!!alive(binding.range.objectId,at),storageAlive=domains.every(d=>alive(d.range.objectId,at)),
          allNodes=snap.nodes??[],byNode=new Map(allNodes.map(n=>[n.id,n])),byIndex=new Map(allNodes.map(n=>[n.index,n])),
          edges=(snap.edges??[]).filter(edge=>selectedRoles.includes(edge.relationId??edge.roleId??s.arrayId)),
          boundary=selectedRoles.every(role=>(s.terminationEvidence??[]).some(p=>p.predicate?.kind==='stored-boundary'&&(!p.roleId||p.roleId===role||p.arrayId===role)&&
            pos.get(p.executionId)<=at&&matchesBoundary(p.predicate,value,value,domains[0].a.capacity)));
        const ordered=[],visited=new Set();let termination=!rootAlive?'ended-root':!storageAlive?'ended-target':value===null?'unknown':boundary?'boundary':null;
        const pending=termination?[]:[byIndex.get(value)];let unknown=false;
        while(pending.length){const node=pending.pop();
          if(!node){unknown=true;continue;}
          if(visited.has(node.id))continue;visited.add(node.id);ordered.push(node);
          const own=edges.filter(edge=>edge.from===node.id);
          if(selectedRoles.some(r=>!own.some(e=>(e.relationId??e.roleId??s.arrayId)===r)))unknown=true;
          for(const edge of [...own].reverse()){
            if(['observed-termination','root-termination'].includes(edge.status))continue;
            if(edge.status!=='observed'||!byNode.has(edge.to)){unknown=true;continue;}
            pending.push(byNode.get(edge.to));
          }
        }
        const selected=edges.filter(edge=>visited.has(edge.from)&&visited.has(edge.to)&&edge.status==='observed'),g=topology(ordered,selected);
        termination??=unknown?'unknown':g.cyclic?'cycle':'boundary';
        const
          complete=['boundary','cycle'].includes(termination),row={afterExecutionId:e.eventId,rootAlive,storageAlive,rootIndex:value,
            rootValueExecutionId:lastWrite,orders:[{roleId,nodeIds:ordered.map(n=>n.id),indices:ordered.map(n=>n.index),termination}],
            memberIndices:ordered.map(n=>n.index),topology:{...g,reachableNodeIds:ordered.map(n=>n.id),edges:selected,rootNodeId:ordered[0]?.id??null,
              connected:true,maxChildren:Math.max(0,...ordered.map(n=>selected.filter(edge=>edge.from===n.id).length)),
              sharedChildren:ordered.filter(n=>selected.filter(edge=>edge.to===n.id).length>1).map(n=>n.id),
              status:!complete?'partial':ordered.length?'observed':'empty'},status:complete?'observed':'partial'};
        for(const n of ordered){const range=n.record??n.range??n.storage??n.parts?.[0]?.range??(n.objectId?n:null);
          if(range)logical.set(n.id,{id:n.id,index:n.index,objectId:range.objectId,offset:range.offset,size:range.size});}
        if(!last||JSON.stringify({...last,afterExecutionId:null})!==JSON.stringify({...row,afterExecutionId:null})){
          everNonempty||=row.orders[0].nodeIds.length>0;appendStateSnapshot(states,row,history);last=row;
        }
      }
      if(!everNonempty)continue;
      out.push({id,kind:'rooted-index-structure',origin:'inferred',intent:'unconfirmed',nodes:[],edges:[],
        root:{kind:'index-slot',...binding.range},roleIds:selectedRoles,roleCombinationEvidence:roleSet.evidence,relationStructureId:s.id,containerId:s.containerId??s.arrayId,
        storageRanges:domains.map(d=>d.range),logicalNodes:[...logical.values()],states,
        discoveredAtExecutionId:history.firstStateExecutionId,rootEvidence:[binding.evidence],
        coverage:{maxStates,maxRoots,...history},membershipPolicy:'current directed reachability from the observed integer root; global stored links remain unchanged'});
    }
  }
  return out;
}
