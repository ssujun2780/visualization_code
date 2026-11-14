import {topology} from '../shared/topology.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
const number=v=>{const x=v?.decimal??v?.signed??v?.unsigned;return x!==undefined&&Number.isSafeInteger(Number(x))?Number(x):null;};
const same=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset===b.offset&&a.size===b.size;
const within=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
const overlap=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;

function composedQueues(plan,{events,objects,structures,valueFlow}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),pos=new Map(events.map((e,i)=>[e.eventId,i])),byId=new Map(events.map(e=>[e.eventId,e])),operations=[],writesByRead=new Map();
  const version=r=>r?.target&&r.dataInputs?.length===1?JSON.stringify([r.target.objectId,r.target.offset,r.target.size,r.dataInputs[0]]):r?.eventId;
  const deps=(ids,consumer)=>ids.flatMap(id=>valueFlow.dependencyReads(id,consumer,null,new Set(),()=>true));
  for(const e of events)if(e.kind==='WRITE'&&number(e.value)!==null)for(const read of deps(e.dataInputs??[],e))if(same(read.target,e.target)){
    if(!writesByRead.has(version(read)))writesByRead.set(version(read),[]);writesByRead.get(version(read)).push(e);
  }
  // Existing array views supply physical extents; operation evidence is rebuilt
  // from actual targets and value provenance, not helper/function names.
  const arrays=structures.filter(s=>s.kind==='array-structure'&&s.range&&s.elementBytes>0),seen=new Set();
  for(const a of arrays)for(const e of events)if(['READ','WRITE'].includes(e.kind)&&e.target?.size===a.elementBytes&&within(a.range,e.target)){
    let expr=unwrap(defs.get(e.instructionId)?.expression);if(e.kind==='WRITE'&&expr?.operator==='=')expr=unwrap(expr.children[0]);
    if(expr?.kind!=='ArraySubscriptExpr')continue;
    const data=a.roles?.data;if(data?.fieldNodeId&&!walk(expr.children[0]).some(n=>n.fieldNodeId===data.fieldNodeId))continue;
    const indexIds=new Set(walk(expr.children[1]).map(n=>n.fieldNodeId??n.declarationId).filter(Boolean));
    for(const read of deps(e.addressInputs??[],e)){
      let rn=unwrap(defs.get(read.instructionId)?.expression);if(rn?.kind==='UnaryOperator'&&['++','--'].includes(rn.operator))rn=unwrap(rn.children[0]);
      if(!indexIds.has(rn?.fieldNodeId??rn?.declarationId)||number(read.value)===null)continue;
      const index=(e.target.offset-a.range.offset)/a.elementBytes;if(!Number.isInteger(index))continue;
      const changes=(writesByRead.get(version(read))??[]).map(w=>({write:w,read})),producer=byId.get(read.dataInputs?.[0]);
      if(producer?.kind==='WRITE'&&same(producer.target,read.target))for(const prior of deps(producer.dataInputs??[],producer))if(same(prior.target,read.target))changes.push({write:producer,read:prior});
      const change=changes.filter(c=>c.write.activationId===e.activationId&&number(c.write.value)-number(c.read.value)===(e.kind==='WRITE'?1:-1))
        .sort((x,y)=>Math.abs(pos.get(x.write.eventId)-pos.get(e.eventId))-Math.abs(pos.get(y.write.eventId)-pos.get(e.eventId)))[0];
      if(!change||index!==(e.kind==='WRITE'?number(change.read.value):number(change.write.value)))continue;
      const key=`${a.id}:${e.eventId}`;if(seen.has(key))continue;seen.add(key);
      operations.push({arrayId:a.id,kind:e.kind==='WRITE'?'insert':'remove',accessExecutionId:e.eventId,countReadExecutionId:change.read.eventId,indexReadExecutionId:read.eventId,
        countWriteExecutionId:change.write.eventId,countSource:{...read.target},before:number(change.read.value),after:number(change.write.value),physicalIndex:index,
        completeExecutionId:pos.get(change.write.eventId)>pos.get(e.eventId)?change.write.eventId:e.eventId});
    }
  }
  const removals=new Map(operations.filter(o=>o.kind==='remove').map(o=>[o.accessExecutionId,o])),transfers=[];
  for(const insert of operations.filter(o=>o.kind==='insert'))for(const read of (byId.get(insert.accessExecutionId).dataInputs??[]).flatMap(id=>valueFlow.reads(id))){
    const remove=removals.get(read.eventId);if(remove&&remove.arrayId!==insert.arrayId&&!transfers.some(t=>t.insert===insert))transfers.push({insert,remove});
  }
  const pairs=[...new Map(transfers.map(t=>[`${t.remove.arrayId}|${t.insert.arrayId}`,[t.remove.arrayId,t.insert.arrayId]])).values()],out=[];
  for(const [inputId,outputId]of pairs){const selected=operations.filter(o=>[inputId,outputId].includes(o.arrayId)).sort((a,b)=>pos.get(a.completeExecutionId)-pos.get(b.completeExecutionId)),
    pairTransfers=transfers.filter(t=>t.remove.arrayId===inputId&&t.insert.arrayId===outputId),byInsert=new Map(pairTransfers.map(t=>[t.insert.accessExecutionId,t])),byRemove=new Map(pairTransfers.map(t=>[t.remove.accessExecutionId,t])),
    stacks=new Map([[inputId,[]],[outputId,[]]]),tokens=new Map(),removed=new Map(),queue=[],states=[],contradictions=[];let enqueues=0,dequeues=0,moved=0;
    const ranges=[inputId,outputId].map(id=>({...arrays.find(a=>a.id===id).range})),known=new Set(selected.flatMap(o=>[o.accessExecutionId,o.countWriteExecutionId])),
      invalidations=events.filter(e=>e.kind==='WRITE'&&e.target&&!known.has(e.eventId)&&pos.get(e.eventId)>pos.get(selected[0].accessExecutionId)&&
        (ranges.some(r=>overlap(r,e.target))||selected.some(o=>overlap(o.countSource,e.target))))
        .map(e=>({kind:'invalidate',accessExecutionId:e.eventId,completeExecutionId:e.eventId})),
      timeline=[...selected,...invalidations].sort((a,b)=>pos.get(a.completeExecutionId)-pos.get(b.completeExecutionId));
    for(const op of timeline){const stack=stacks.get(op.arrayId),event=byId.get(op.accessExecutionId);
      if(op.kind==='invalidate'){
        contradictions.push(op.accessExecutionId);
        states.push({...states.at(-1),afterExecutionId:op.completeExecutionId,status:'contradicted',contradictingExecutionIds:[...new Set(contradictions)]});continue;
      }
      if(stack.length!==op.before)contradictions.push(op.accessExecutionId);
      if(op.kind==='insert'){
        const transfer=byInsert.get(op.accessExecutionId),token=transfer?removed.get(transfer.remove.accessExecutionId):op.accessExecutionId;
        if(!token)contradictions.push(op.accessExecutionId);
        if(transfer){moved++;tokens.set(op.accessExecutionId,token);}else{
          if(op.arrayId!==inputId)contradictions.push(op.accessExecutionId);queue.push(token);enqueues++;tokens.set(op.accessExecutionId,token);
        }
        stack.push({token,storage:{...event.target},writeExecutionId:op.accessExecutionId});
      }else{
        const top=stack.pop(),origin=(event.dataInputs??[]).map(id=>tokens.get(id)).find(Boolean);
        if(!top||origin!==top.token)contradictions.push(op.accessExecutionId);
        removed.set(op.accessExecutionId,top?.token);
        if(!byRemove.has(op.accessExecutionId)){
          if(op.arrayId!==outputId||queue[0]!==top?.token)contradictions.push(op.accessExecutionId);
          queue.shift();dequeues++;
        }
      }
      states.push({afterExecutionId:op.completeExecutionId,alive:true,status:contradictions.length?'contradicted':enqueues&&dequeues&&moved?'supported':'insufficient-evidence',
        logicalOrder:queue.slice(),components:[...stacks].map(([arrayId,elements])=>({arrayId,elements:elements.map(e=>({...e})),view:'stack'})),
        evidenceExecutionIds:selected.filter(o=>pos.get(o.completeExecutionId)<=pos.get(op.completeExecutionId)).flatMap(o=>[o.accessExecutionId,o.countWriteExecutionId]),
        contradictingExecutionIds:[...new Set(contradictions)]});
    }
    const discovered=states.find(s=>s.status==='supported')??states.find(s=>pairTransfers.some(t=>t.insert.completeExecutionId===s.afterExecutionId));
    if(!discovered)continue;
    const end=objects.filter(o=>ranges.some(r=>r.objectId===o.id)&&o.endedBy).sort((a,b)=>pos.get(a.endedBy)-pos.get(b.endedBy))[0]?.endedBy;
    if(end)states.push({...states.at(-1),afterExecutionId:end,alive:false,status:'ended'});
    out.push({id:`composed-queue:${inputId}|${outputId}`,kind:'composed-container-candidate',view:'queue',intent:'unconfirmed',
      discoveredAtExecutionId:discovered.afterExecutionId,storageRanges:ranges,nodes:[],edges:[],states,operations:selected,invalidatingExecutionIds:invalidations.map(o=>o.accessExecutionId),
      transfers:pairTransfers.map(t=>({readExecutionId:t.remove.accessExecutionId,writeExecutionId:t.insert.accessExecutionId})),
      limitations:['observed FIFO behavior, not proof of all future calls','physical arrays and both stack orders are retained']});
  }
  return out;
}

function composedReferences(plan,{events,structures}){
  const graph=structures.find(s=>s.kind==='storage-reference-graph');if(!graph)return [];
  const pos=new Map(events.map((e,i)=>[e.eventId,i])),byId=new Map(events.map(e=>[e.eventId,e])),byNode=new Map(graph.nodes.map(n=>[n.id,n])),roles=new Map();
  for(const c of graph.changes)for(const e of c.upsertEdges)if(e.sourceTypeId&&e.targetTypeId){
    if(!roles.has(e.roleId))roles.set(e.roleId,{id:e.roleId,from:e.sourceTypeId,to:e.targetTypeId,reads:[]});
    if(byId.get(c.afterExecutionId)?.kind==='READ')roles.get(e.roleId).reads.push(c.afterExecutionId);
  }
  const rs=[...roles.values()].filter(r=>r.reads.length),out=[];
  for(const head of rs.filter(r=>r.from!==r.to))for(const next of rs.filter(r=>r.from===head.to&&r.to===head.to)){
   const targets=rs.filter(r=>r.from===head.to&&r.to===head.from);
   for(const dest of targets.length?targets:[null]){
    const edges=new Map(),edgeOrder=new Map(),byRole=new Map(),ended=new Set(),states=[],proof=[head,dest,next].filter(Boolean).map(r=>r.reads[0]),discovered=proof.reduce((a,b)=>pos.get(a)>pos.get(b)?a:b);
    for(const c of graph.changes){for(const e of c.upsertEdges){const old=edges.get(e.id);if(!edgeOrder.has(e.id))edgeOrder.set(e.id,edgeOrder.size);edges.set(e.id,e);
      // A clarified source role can move an existing edge between buckets.
      // Keep the same first edge as the original insertion-ordered Map scan.
      if(old&&(old.from!==e.from||old.roleId!==e.roleId)&&byRole.get(old.from)?.get(old.roleId)?.id===e.id){
        const replacement=[...edges.values()].find(x=>x.from===old.from&&x.roleId===old.roleId);
        if(replacement)byRole.get(old.from).set(old.roleId,replacement);else byRole.get(old.from).delete(old.roleId);
      }
      if(!byRole.has(e.from))byRole.set(e.from,new Map());const row=byRole.get(e.from),first=row.get(e.roleId);
      if(!first||edgeOrder.get(e.id)<=edgeOrder.get(first.id))row.set(e.roleId,e);
    }for(const id of c.endedObjectIds)ended.add(id);
      if(pos.get(c.afterExecutionId)<pos.get(discovered))continue;
      const nodes=graph.nodes.filter(n=>n.cType?.recordTypeId===head.from&&!ended.has(n.range.objectId)&&pos.get(n.discoveredAtExecutionId)<=pos.get(c.afterExecutionId)),
        ids=new Set(nodes.map(n=>n.id)),logical=[],containers=[],issues=[];
      for(const node of nodes){const entry=byRole.get(node.id)?.get(head.id);if(!entry){issues.push(node.id);continue;}
        let current=entry,termination=null;const seen=new Set(),members=[],linkEdgeIds=[];
        const end=(status,edge=current)=>({status,edgeId:edge.id,fromNodeId:edge.from,targetNodeId:edge.to??null,
          evidenceExecutionIds:[edge.lastObservationExecutionId]});
        while(current.to){
          if(current.status!=='in-bounds'||seen.has(current.to)||ended.has(byNode.get(current.to)?.range.objectId)){
            termination=end(seen.has(current.to)?'cycle':ended.has(byNode.get(current.to)?.range.objectId)?'ended-target':current.status);issues.push(current.id);break;}
          seen.add(current.to);members.push(current.to);
          const target=dest&&byRole.get(current.to)?.get(dest.id),advance=byRole.get(current.to)?.get(next.id);
          if(target?.status==='in-bounds'&&ids.has(target.to))logical.push({id:`logical:${node.id}:${current.to}:${dest.id}`,from:node.id,to:target.to,viaNodeId:current.to,
            viaRange:byNode.get(current.to)?.range,sourceEdgeIds:[entry.id,target.id],evidenceExecutionIds:[entry.lastObservationExecutionId,target.lastObservationExecutionId]});
          else if(dest)issues.push(current.to);
          if(!advance){termination=end('unobserved-link');issues.push(current.to);break;}linkEdgeIds.push(advance.id);current=advance;
        }
        termination??=end(current.status==='null'?'null':current.status);
        if(current.status!=='null'&&!current.to)issues.push(current.id);
        containers.push({containerNodeId:node.id,memberNodeIds:members,headRoleId:head.id,nextRoleId:next.id,
          entryEdgeId:entry.id,linkEdgeIds,termination,membership:'observed reachability; not exclusive ownership'});
      }
      const cross=logical.some(e=>e.from!==e.to),t=topology(nodes,logical);
      states.push({afterExecutionId:c.afterExecutionId,alive:nodes.length>0,status:issues.length?'partial':'supported',nodes:nodes.map(n=>({id:n.id,range:n.range})),edges:logical,containers,
        interpretation:cross?'adjacency-records':dest?'nested-containers-with-backlinks':'nested-containers',topology:t,unresolved:issues,evidenceExecutionIds:[...proof,...logical.flatMap(e=>e.evidenceExecutionIds)]});
    }
    if(!states.some(s=>s.containers.some(c=>c.memberNodeIds.length)))continue;
    out.push({id:`composed-reference:${head.id}|${dest?.id??'members'}|${next.id}`,kind:'composed-reference-candidate',intent:'unconfirmed',discoveredAtExecutionId:discovered,
      roleIds:[head.id,dest?.id,next.id].filter(Boolean),storageRanges:graph.nodes.filter(n=>[head.from,head.to].includes(n.cType?.recordTypeId)).map(n=>n.range),
      nodes:[],edges:[],states,limitations:['candidate composition of observed role paths; underlying records are never collapsed or removed','owner backlinks remain nested containment candidates']});
   }
  }
  return out;
}

export function composedContainerStructures(plan,context){return [...composedQueues(plan,context),...composedReferences(plan,context)];}
