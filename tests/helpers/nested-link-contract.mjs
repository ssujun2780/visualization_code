import assert from 'node:assert/strict';

// Expected indices and field names come from the C fixture, never from the
// inferred grouping/order. Only runtime object IDs and ABI offsets are resolved.
export function assertNestedLists(trace,afterExecutionId,{outer,inner,outerLink,innerLink,entry,groups,outerOrder}){
  const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=pos.get(afterExecutionId),
    snapshot=s=>s.states?.findLast(x=>pos.get(x.afterExecutionId)<=at),
    object=name=>{const o=trace.objects.find(o=>o.name===name);assert.ok(o,`missing object ${name}`);return o;},
    a=object(inner),b=object(outer),raw=trace.structures.find(s=>s.kind==='storage-reference-graph');assert.ok(raw);
  const record=(o,i)=>({objectId:o.id,offset:i*o.cType.elementType.sizeBits/8,size:o.cType.elementType.sizeBits/8}),
    field=(o,name)=>{const f=o.cType.elementType.members.find(f=>f.name===name);assert.ok(f);return f.offsetBits/8;},
    same=(n,r)=>n?.objectId===r.objectId&&n?.offset===r.offset&&n?.size===r.size,
    rawNode=(o,i)=>{const found=raw.nodes.filter(n=>n.kind==='record'&&same(n.range,record(o,i)));assert.equal(found.length,1);return found[0];};
  const pointers=new Map();for(const change of raw.changes)if(pos.get(change.afterExecutionId)<=at)for(const e of change.upsertEdges)pointers.set(e.id,e);
  const pointer=(o,i,name)=>{const r=record(o,i),edges=[...pointers.values()].filter(e=>e.source.objectId===o.id&&e.source.offset===r.offset+field(o,name));
    assert.equal(edges.length,1,`one pointer at ${o.name}[${i}].${name}`);return edges[0];};
  function rawChain(o,indices,name){
    indices.forEach((index,j)=>{const e=pointer(o,index,name),next=indices[j+1];
      assert.equal(e.from,rawNode(o,index).id);
      if(next===undefined){assert.equal(e.to,null);assert.equal(e.status,'null');assert.equal(e.reference.targetObjectId,null);}
      else{assert.equal(e.to,rawNode(o,next).id);assert.equal(e.status,'in-bounds');assert.equal(e.reference.targetObjectId,o.id);assert.equal(e.reference.targetOffset,record(o,next).offset);}
    });
  }
  function linkedChain(o,indices,name){
    const first=record(o,indices[0]),candidates=trace.structures.filter(s=>s.kind==='linked-structure').map(s=>({s,state:snapshot(s)}))
      .filter(({s,state})=>state?.rootAlive&&s.logicalNodes.some(n=>n.id===state.topology.rootNodeId&&same(n,first)));
    assert.ok(candidates.length,`missing linked-structure rooted at ${o.name}[${indices[0]}]`);
    for(const {s,state}of candidates){
      const role=s.roles.find(r=>r.offset===field(o,name));assert.ok(role);
      const ids=indices.map(i=>{const n=s.logicalNodes.find(n=>same(n,record(o,i)));assert.ok(n,`missing ${o.name}[${i}]`);return n.id;});
      const order=state.orders.find(o=>o.fieldNodeId===role.fieldNodeId);assert.ok(order);
      assert.deepEqual(order.nodeIds,ids);assert.equal(order.termination,'null');
      ids.forEach((id,j)=>{const e=state.edges.find(e=>e.from===id&&e.fieldNodeId===role.fieldNodeId);assert.ok(e);
        assert.equal(e.to,ids[j+1]??null);assert.equal(e.status,j===ids.length-1?'null':'in-bounds');});
    }
  }
  rawChain(b,outerOrder,outerLink);
  const composed=trace.structures.filter(s=>s.kind==='composed-reference-candidate').map(s=>({s,state:snapshot(s)}))
    .find(({state})=>state?.interpretation==='nested-containers'&&groups.every(g=>state.containers.some(c=>c.containerNodeId===rawNode(b,g.outerIndex).id)));
  assert.ok(composed,'nested container view must retain the expected outer identities');
  assert.equal(composed.state.status,'supported');assert.equal(composed.state.containers.length,groups.length);
  for(const group of groups){const expected=group.innerIndices.map(i=>rawNode(a,i).id),container=composed.state.containers.find(c=>c.containerNodeId===rawNode(b,group.outerIndex).id),
      head=pointer(b,group.outerIndex,entry);
    assert.deepEqual(container.memberNodeIds,expected);assert.equal(head.to,expected[0]??null);assert.equal(head.status,expected.length?'in-bounds':'null');
    assert.equal(container.entryEdgeId,head.id);assert.equal(container.termination.status,'null');
    const end=expected.length?pointer(a,group.innerIndices.at(-1),innerLink):head;
    assert.equal(container.termination.edgeId,end.id);assert.equal(container.termination.fromNodeId,end.from);assert.equal(container.termination.targetNodeId,null);
    assert.ok(container.termination.evidenceExecutionIds.includes(end.lastObservationExecutionId));
    assert.deepEqual(container.linkEdgeIds,group.innerIndices.map(i=>pointer(a,i,innerLink).id));
    rawChain(a,group.innerIndices,innerLink);
  }
  // Explicitly retained: the three lists must have independently usable linked
  // candidates as well as their composed view. Counts alone cannot satisfy this.
  linkedChain(b,outerOrder,outerLink);
  for(const group of groups)if(group.innerIndices.length)linkedChain(a,group.innerIndices,innerLink);
  else{
    const rootOffset=record(b,group.outerIndex).offset+field(b,entry),candidate=trace.structures.find(s=>s.kind==='linked-structure'&&
      s.root.kind==='pointer-slot'&&s.root.objectId===b.id&&s.root.offset===rootOffset),now=candidate&&snapshot(candidate);
    assert.ok(now?.rootAlive,'empty head remains an observed root slot');assert.equal(now.topology.rootStatus,'null');
    assert.deepEqual(now.orders.map(o=>({nodes:o.nodeIds,end:o.termination})),[{nodes:[],end:'null'}]);
  }
}
