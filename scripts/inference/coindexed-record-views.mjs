// A logical record may be split across storage arrays. Only shared dynamic
// index provenance joins fields; equal sizes/numbers/names never join them.
import {topology} from '../shared/topology.mjs';
const unique=a=>[...new Set(a)];
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const sameRange=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const partAt=(a,index)=>({arrayId:a.id,range:{objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes}});
const validIndex=(a,i)=>Number.isSafeInteger(i)&&i>=0&&i<a.capacity;

export function coindexedRecordStructures(_plan,{events,objects=[],structures=[]}){
  const dependencies=structures.find(s=>s.kind==='storage-dependencies'),work=structures.find(s=>s.kind==='array-work');
  if(!dependencies?.coindexed?.length||!work)return [];
  const arrays=new Map(structures.filter(s=>s.kind==='array').map(a=>[a.id,a])),
    accesses=new Map(work.accesses.map(a=>[a.executionId,a])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    positions=new Map(events.map((e,i)=>[e.eventId,i])),byObject=new Map(objects.map(o=>[o.id,o])),groups=new Map();
  const alive=(id,at)=>{const o=byObject.get(arrays.get(id)?.objectId);return !o||
    (positions.get(o.createdBy)??-1)<=at&&at<(positions.get(o.endedBy)??Infinity);};
  for(const proof of dependencies.coindexed){
    const used=proof.accessExecutionIds.map(id=>accesses.get(id)).filter(a=>a&&positions.has(a.executionId)&&arrays.has(a.target.arrayId)&&
      validIndex(arrays.get(a.target.arrayId),a.target.index)&&a.target.elementOffset===0&&a.target.size===arrays.get(a.target.arrayId).elementBytes)
      .sort((a,b)=>positions.get(a.executionId)-positions.get(b.executionId)),first=new Map(),reads=new Map(),emitted=new Set();
    for(const a of used){
      const at=positions.get(a.executionId);
      // The same index origin can be reused across calls and storage lifetimes.
      // Expired columns must not contaminate every later group on that origin.
      for(const id of first.keys())if(!alive(id,at)){first.delete(id);reads.delete(id);}
      if(!alive(a.target.arrayId,at))continue;
      if(!first.has(a.target.arrayId))first.set(a.target.arrayId,a.executionId);
      if(!reads.has(a.target.arrayId)&&byEvent.get(a.executionId)?.kind==='READ')reads.set(a.target.arrayId,a.executionId);
      const firstRead=[...reads.values()].sort((a,b)=>positions.get(a)-positions.get(b))[0];
      // Only an observed prefix may establish fields. Repeated reads do not
      // postpone discovery, and a later third field cannot appear in the pair.
      if(first.size<2||!firstRead)continue;
      const ids=[...first.keys()].sort(),key=JSON.stringify(ids);if(emitted.has(key))continue;emitted.add(key);
      if(ids.some((id,i)=>ids.slice(i+1).some(other=>overlap(arrays.get(id).range,arrays.get(other).range))))continue;
      const witness=unique([...first.values(),firstRead]).sort((a,b)=>positions.get(a)-positions.get(b));
      if(!groups.has(key))groups.set(key,{ids,evidence:[]});
      groups.get(key).evidence.push({origin:proof.origin,accessExecutionIds:witness,arrayIds:ids,afterExecutionId:witness.at(-1)});
    }
  }
  const result=[];
  // Preserve overlapping alternatives. Do not transitively fuse A/B and B/C.
  for(const group of groups.values()){
    const own=group.ids.map(id=>arrays.get(id)),id=`coindexed:${group.ids.join('|')}`,
      nodeId=index=>`${id}:slot:${index}`,logicalNodes=new Map(),changes=[],currentEdges=new Map(),lastWrites=new Map(),
      firstProof=group.evidence.map(p=>p.afterExecutionId)
        .sort((a,b)=>positions.get(a)-positions.get(b))[0],
      relations=(dependencies.relations??[]).filter(r=>r.preserved&&group.ids.includes(r.sourceArrayId)&&group.ids.includes(r.targetArrayId)&&
        validIndex(arrays.get(r.sourceArrayId),r.sourceIndex)&&validIndex(arrays.get(r.targetArrayId),r.targetIndex)&&
        r.source.size===arrays.get(r.sourceArrayId).elementBytes&&r.value===r.targetIndex),proofsAt=new Map(),terminalsAt=new Map(),
      terminations=structures.filter(s=>s.kind==='value-index-graph-candidate'&&group.ids.includes(s.arrayId)).flatMap(s=>
        (s.terminationEvidence??[]).filter(p=>p.predicate?.kind==='stored-boundary').map(p=>({...p,arrayId:s.arrayId})));
    for(const r of relations){if(!proofsAt.has(r.targetAccessExecutionId))proofsAt.set(r.targetAccessExecutionId,[]);proofsAt.get(r.targetAccessExecutionId).push(r);}
    for(const p of terminations){if(!terminalsAt.has(p.executionId))terminalsAt.set(p.executionId,[]);terminalsAt.get(p.executionId).push(p);}
    function discover(index,eventId){
      if(!logicalNodes.has(index))logicalNodes.set(index,{id:nodeId(index),index,discoveredAtExecutionId:eventId,
        parts:own.filter(a=>validIndex(a,index)).map(a=>partAt(a,index))});
    }
    // Track only visited indices, including fields whose bytes have not yet
    // been read. Every part remains a view of its original allocation.
    for(const a of work.accesses)if(group.ids.includes(a.target.arrayId)&&validIndex(arrays.get(a.target.arrayId),a.target.index))discover(a.target.index,a.executionId);
    const parts=[...logicalNodes.values()].flatMap(n=>n.parts.map(p=>({...p,nodeId:n.id,index:n.index}))),partsByObject=new Map(),
      objectIds=new Set(own.map(a=>a.objectId));
    for(const p of parts){if(!partsByObject.has(p.range.objectId))partsByObject.set(p.range.objectId,[]);partsByObject.get(p.range.objectId).push(p);}
    for(const e of events){
      const upsertFields=[],upsertEdges=[],endedObjectIds=objects.filter(o=>objectIds.has(o.id)&&o.endedBy===e.eventId).map(o=>o.id),
        target=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null);
      if(e.action==='object.end'&&objectIds.has(e.objectId))endedObjectIds.push(e.objectId);
      if(target&&['READ','WRITE','SPACE'].includes(e.kind))for(const p of partsByObject.get(target.objectId)??[]){
        if(!overlap(p.range,target))continue;
        const exact=target.offset===p.range.offset&&target.size===p.range.size,fieldId=`${p.nodeId}:${p.arrayId}`;
        if(['WRITE','SPACE'].includes(e.kind)){
          lastWrites.set(fieldId,e.eventId);
          if(currentEdges.has(fieldId)){const old=currentEdges.get(fieldId),next={...old,to:null,status:'unconfirmed-after-write',invalidatedAtExecutionId:e.eventId};
            currentEdges.set(fieldId,next);upsertEdges.push(next);}
        }
        // A broad snapshot does not pretend to be a decoded scalar read.
        upsertFields.push({...p,id:fieldId,value:exact?e.value??null:null,
          status:exact&&e.value?'observed':'unknown',lastObservationExecutionId:e.eventId,lastWriteExecutionId:lastWrites.get(fieldId)??null});
      }
      for(const r of proofsAt.get(e.eventId)??[]){
        const sourceId=nodeId(r.sourceIndex),fieldId=`${sourceId}:${r.sourceArrayId}`,
          write=lastWrites.get(fieldId);
        // An old value carried in a temporary is not the field's current edge.
        if(write&&positions.get(write)>positions.get(r.sourceReadExecutionId))continue;
        const edge={id:fieldId,from:sourceId,to:nodeId(r.targetIndex),fromIndex:r.sourceIndex,toIndex:r.targetIndex,
          roleId:r.sourceArrayId,source:r.source,target:r.target,value:r.value,status:'observed',
          sourceReadExecutionId:r.sourceReadExecutionId,targetAccessExecutionId:r.targetAccessExecutionId};
        currentEdges.set(fieldId,edge);upsertEdges.push(edge);
      }
      for(const p of terminalsAt.get(e.eventId)??[]){
        const from=nodeId(p.index),fieldId=`${from}:${p.arrayId}`,read=byEvent.get(p.readExecutionId),write=lastWrites.get(fieldId);
        if(!logicalNodes.has(p.index)||!read||write&&positions.get(write)>positions.get(read.eventId))continue;
        const edge={id:fieldId,from,to:null,fromIndex:p.index,toIndex:null,roleId:p.arrayId,source:read.target,target:null,
          value:read.value,status:'observed-termination',sourceReadExecutionId:read.eventId,terminationExecutionId:p.executionId,
          comparisonExecutionId:p.comparisonExecutionId,branchExecutionId:p.branchExecutionId};
        currentEdges.set(fieldId,edge);upsertEdges.push(edge);
      }
      if(upsertFields.length||upsertEdges.length||endedObjectIds.length)changes.push({afterExecutionId:e.eventId,upsertFields,upsertEdges,endedObjectIds:unique(endedObjectIds)});
    }
    result.push({id,kind:'coindexed-record-candidate',classification:'candidate',origin:'inferred',intent:'unconfirmed',
      nodes:[],edges:[],arrays:own.map(a=>({arrayId:a.id,range:a.range,capacity:a.capacity,elementBytes:a.elementBytes})),
      discoveredAtExecutionId:firstProof,evidence:group.evidence,relationEvidence:relations,terminationEvidence:terminations,
      logicalNodes:[...logicalNodes.values()].sort((a,b)=>a.index-b.index),changes,
      limitations:['shared index provenance suggests grouped fields but does not prove author intent',
        'only observed index transfers establish logical edges; unvisited roles remain unknown',
        'overlapping groups remain alternative views of the same storage; no physical allocation is added']});
  }
  return result;
}

export function queryCoindexedRecords(structure,trace,{afterExecutionId}={}){
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?trace.events.length-1:positions.get(afterExecutionId);
  if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
  const occurred=id=>positions.has(id)&&positions.get(id)<=at,discovered=occurred(structure.discoveredAtExecutionId),fields=new Map(),edges=new Map(),ended=new Set();
  for(const c of structure.changes){if(!occurred(c.afterExecutionId))continue;
    for(const f of c.upsertFields)fields.set(f.id,f);for(const e of c.upsertEdges)edges.set(e.id,e);for(const id of c.endedObjectIds)ended.add(id);}
  const nodes=structure.logicalNodes.filter(n=>discovered&&occurred(n.discoveredAtExecutionId)).map(n=>({...n,
    fields:n.parts.map(p=>({...p,...fields.get(`${n.id}:${p.arrayId}`),status:ended.has(p.range.objectId)?'ended':fields.get(`${n.id}:${p.arrayId}`)?.status??'unknown'}))})),
    ids=new Set(nodes.map(n=>n.id)),links=[...edges.values()].filter(e=>ids.has(e.from)).map(e=>({...e,
      status:ended.has(e.source.objectId)?'ended-source':ended.has(e.target?.objectId)?'ended-target':e.status})),
    observed=links.filter(e=>e.status==='observed'&&ids.has(e.to)),relationIds=new Set(links.flatMap(e=>[e.from,e.to].filter(Boolean))),relationNodes=nodes.filter(n=>relationIds.has(n.id)),graph=topology(relationNodes,observed),
    roles=unique(structure.relationEvidence.filter(p=>occurred(p.targetAccessExecutionId)).map(p=>p.sourceArrayId)),
    complete=roles.length>0&&roles.every(role=>{const a=structure.arrays.find(a=>a.arrayId===role);
      return relationNodes.length>0&&relationNodes.every(n=>
        !n.parts.some(p=>p.arrayId===role)||links.some(e=>e.from===n.id&&e.roleId===role&&['observed','observed-termination'].includes(e.status)));});
  return {nodes,edges:links,discovered,
    alive:structure.arrays.every(a=>!ended.has(a.range.objectId)),
    topology:{...graph,status:complete?'observed':'partial',complete,roleIds:roles,
      maxChildren:Math.max(0,...nodes.map(n=>observed.filter(e=>e.from===n.id).length)),
      sharedChildren:nodes.filter(n=>observed.filter(e=>e.to===n.id).length>1).map(n=>n.id),
      completenessScope:'observed traversal domain; not capacity or author-intent proof',
      includedIndices:relationNodes.map(n=>n.index),excludedIndices:nodes.filter(n=>!relationIds.has(n.id)).map(n=>n.index)},
    status:nodes.length&&nodes.every(n=>n.fields.every(f=>f.status==='ended'))?'ended':complete?'observed':'partial'};
}

export function validateCoindexedRecords(trace){
  const arrays=new Map(trace.structures.filter(a=>a.kind==='array').map(a=>[a.id,a])),
    positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),events=new Map(trace.events.map(e=>[e.eventId,e])),
    accesses=new Map((trace.structures.find(s=>s.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a])),
    proofs=trace.structures.find(s=>s.kind==='storage-dependencies')?.coindexed;
  const require=(v,m)=>{if(!v)throw new Error(`coindexed records: ${m}`);};
  for(const s of trace.structures.filter(s=>s.kind==='coindexed-record-candidate')){
    require(s.edges.length===0&&s.nodes.length===0&&positions.has(s.discoveredAtExecutionId),'physical storage or discovery');
    const nodes=new Map(s.logicalNodes.map(n=>[n.id,n]));
    for(const n of nodes.values())for(const p of n.parts){const a=arrays.get(p.arrayId);
      require(a&&validIndex(a,n.index)&&JSON.stringify(partAt(a,n.index).range)===JSON.stringify(p.range),'shifted storage');}
    const completion=[];
    for(const proof of s.evidence){
      require(proof.accessExecutionIds.length&&proof.accessExecutionIds.every(id=>events.has(id)),'missing grouping evidence');
      const end=proof.accessExecutionIds.reduce((a,b)=>positions.get(a)>positions.get(b)?a:b),
        fields=unique(proof.accessExecutionIds.map(id=>accesses.get(id)?.target.arrayId)).sort(),expected=s.arrays.map(a=>a.arrayId).sort();
      require(proof.accessExecutionIds.some(id=>events.get(id).kind==='READ')&&JSON.stringify(fields)===JSON.stringify(expected),'invalid prefix grouping proof');
      require(!proof.afterExecutionId||proof.afterExecutionId===end,'future or premature grouping proof');
      if(proofs)require(proofs.some(p=>p.origin===proof.origin&&proof.accessExecutionIds.every(id=>p.accessExecutionIds.includes(id))),'grouping proof changed index origin');
      completion.push(positions.get(end));
    }
    require(completion.length&&positions.get(s.discoveredAtExecutionId)===Math.min(...completion),'discovery does not match earliest sufficient proof');
    let before=-1;
    for(const c of s.changes){const at=positions.get(c.afterExecutionId);require(at>before,'unordered change');before=at;
      for(const f of c.upsertFields)require(nodes.get(f.nodeId)?.parts.some(p=>p.arrayId===f.arrayId&&JSON.stringify(p.range)===JSON.stringify(f.range)),'unknown field');
      for(const e of c.upsertEdges){require(nodes.has(e.from)&&(!e.to||nodes.has(e.to)),'unknown node');
        const read=events.get(e.sourceReadExecutionId),access=events.get(e.targetAccessExecutionId);
        require(read?.kind==='READ'&&sameRange(read.target,e.source),'invalid source range');
        require(nodes.get(e.from).index===e.fromIndex&&nodes.get(e.from).parts.some(p=>p.arrayId===e.roleId&&sameRange(p.range,e.source)),'invalid source role');
        if(e.terminationExecutionId){const proof=s.terminationEvidence.find(p=>p.executionId===e.terminationExecutionId&&p.readExecutionId===read.eventId&&p.arrayId===e.roleId);
          require(proof&&positions.get(read.eventId)<positions.get(proof.executionId)&&positions.get(proof.executionId)<=at&&!e.to,'invalid terminal evidence');
        }else{
          require(access&&positions.get(read.eventId)<positions.get(access.eventId)&&positions.get(access.eventId)<=at,'invalid edge evidence');
          require(!e.to||nodes.get(e.to).index===e.toIndex&&e.value===e.toIndex,'invalid destination index');
          require(sameRange(access.target,e.target),'invalid target range');}}
    }
  }
}
