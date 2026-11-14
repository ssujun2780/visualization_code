import {stateHistoryCoverage} from './state-history.mjs';
// Compose existing index-use and co-index proofs into a logical edge domain.
// The result is a candidate relation, never a claim that the code is CSR,
// Dijkstra, or another named algorithm. Original storage/events stay intact.
import {topology} from '../shared/topology.mjs';
import {observeGraphStorage} from './graph-storage-observations.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const unique=a=>[...new Set(a)];
export function indexDomainStructures(_plan,{events,objects,structures=[],resultDeliveries=[],valueFlow},{maxEvidence=8192,maxStates=512,maxEdges=1024}={}){
  const flow=valueFlow??createValueFlow(_plan,{events,resultDeliveries});
  const dependencies=structures.find(s=>s.kind==='storage-dependencies'),work=structures.find(s=>s.kind==='array-work');
  if(!dependencies||!work)return [];
  const byId=new Map(events.map(e=>[e.eventId,e])),position=new Map(events.map((e,i)=>[e.eventId,i])),
    arrays=new Map(structures.filter(s=>s.kind==='array').map(a=>[a.id,a])),
    accesses=new Map(work.accesses.map(a=>[a.executionId,a])),relations=new Map(),groups=new Map(),coindexed=new Map();
  for(const r of dependencies.relations??[])if(r.preserved&&r.targetArrayId){
    if(!relations.has(r.targetAccessExecutionId))relations.set(r.targetAccessExecutionId,[]);relations.get(r.targetAccessExecutionId).push(r);
  }
  for(const c of dependencies.coindexed??[])for(const id of c.accessExecutionIds){
    if(!coindexed.has(id))coindexed.set(id,new Set());for(const other of c.accessExecutionIds)coindexed.get(id).add(other);
  }
  const location=e=>accesses.get(e.eventId)?.target;
  for(const calc of events)if(calc.kind==='CALC'){
    const operandReads=(input,step)=>flow.dependencyReads(input,calc,step,new Set(),e=>!!location(e)).filter(e=>location(e));
    for(const step of calc.steps??[]){
      if(!['<','<=','>','>=','==','!='].includes(step.operator)||step.inputs?.length!==2)continue;
      const sides=step.inputs.map(i=>unique(operandReads(i,step).map(e=>e.eventId)).map(id=>byId.get(id)));
      const inputs=unique(sides.flat().map(e=>e.eventId)).map(id=>byId.get(id));
    for(const destination of inputs)for(const relation of relations.get(destination.eventId)??[]){
      const side=sides.findIndex(s=>s.includes(destination));
      // Pair comparison operands, not all reads in a compound logical CALC.
      if(side<0||sides[side].length!==1)continue;
      const to=location(destination),domain=arrays.get(to?.arrayId);if(!domain||to.elementOffset!==0||to.size!==domain.elementBytes)continue;
      for(const origin of sides[1-side]){const from=location(origin);
        if(origin===destination||from?.arrayId!==domain.id||from.elementOffset!==0||from.size!==domain.elementBytes)continue;
        const sourceRead=byId.get(relation.sourceReadExecutionId);if(!sourceRead)continue;
        // Same computation establishes endpoint use. Co-indexing establishes
        // edge properties; a zero property is still an observed value.
        const propertyReads=inputs.filter(e=>e!==origin&&e!==destination&&e!==sourceRead&&
          (coindexed.get(sourceRead.eventId)?.has(e.eventId)||relation.sourceRecord&&
            e.target?.objectId===relation.sourceRecord.objectId&&e.target.offset>=relation.sourceRecord.offset&&e.target.offset+e.target.size<=relation.sourceRecord.offset+relation.sourceRecord.size));
        const upstream=(dependencies.relations??[]).filter(r=>r.targetAccessExecutionId===sourceRead.eventId&&r.sourceArrayId&&
          coindexed.get(origin.eventId)?.has(r.sourceReadExecutionId));
        const rootBindings=relation.sourceRecord?(structures.filter(s=>s.kind==='linked-structure'&&s.root?.kind==='pointer-slot').flatMap(s=>{
          const state=s.states.findLast(x=>position.get(x.afterExecutionId)<=position.get(sourceRead.eventId)),
            member=s.logicalNodes.find(n=>n.objectId===relation.sourceRecord.objectId&&n.offset===relation.sourceRecord.offset),size=s.roles?.[0]?.size;
          return state?.rootAlive&&member&&state.reachableMembers.includes(member.id)&&size>0?[{structureId:s.id,
            source:{objectId:s.root.objectId,offset:s.root.offset,size},executionId:state.afterExecutionId,
            linkSources:state.edges.map(e=>e.source).filter(Boolean)}]:[];
        })):[];
        const key=domain.id;
        let g=groups.get(key);if(!g)groups.set(key,g={domain,evidence:[],omitted:0});
        if(g.evidence.length>=maxEvidence){g.omitted++;continue;}
        const endpointRelations=relations.get(origin.eventId)??[],sourceRelation=endpointRelations.find(r=>r.sourceRecord&&same(r.sourceRecord,relation.sourceRecord)||
          (r.sourceArrayId&&r.sourceArrayId===relation.sourceArrayId&&r.sourceIndex===relation.sourceIndex)||
          coindexed.get(sourceRead.eventId)?.has(r.sourceReadExecutionId)),
          sourceSlots=unique([relation.source,sourceRelation?.source].filter(Boolean).map(JSON.stringify)).map(x=>JSON.parse(x));
        // A loop comparing two range-table entries is not by itself a graph.
        // Require an independent endpoint, co-indexed property or rooted range.
        if(!sourceRelation&&!propertyReads.length&&!rootBindings.length&&!upstream.length)continue;
        if(sourceRelation&&same(sourceRelation.source,relation.source))continue;
        const proof={executionId:calc.eventId,comparisonNodeId:step.nodeId,direction:'comparison-operand roles; intent unconfirmed',fromIndex:from.index,toIndex:to.index,
          sourceAccessExecutionId:origin.eventId,targetAccessExecutionId:destination.eventId,
          indexSourceReadExecutionId:sourceRead.eventId,indexRelationId:relation.id,sourceSlots,sourceReads:[relation,sourceRelation].filter(Boolean).map(r=>({source:r.source,executionId:r.sourceReadExecutionId})),rootBindings,
          edgeIdentity:`${sourceSlots.map(r=>`${r.objectId}:${r.offset}:${r.size}`).sort().join('|')}:${from.index}:${to.index}`,
          properties:propertyReads.map(e=>({source:e.target,readExecutionId:e.eventId,value:e.value,role:'coindexed-property; meaning unconfirmed'})),
          rangeInputs:upstream.map(r=>({source:r.source,sourceReadExecutionId:r.sourceReadExecutionId,relationId:r.id,transforms:r.transforms})),
          evidence:'observed index transfer and same-expression endpoint reads; storage domains stay distinct'};
        if(!g.evidence.some(p=>p.executionId===proof.executionId&&p.edgeIdentity===proof.edgeIdentity))g.evidence.push(proof);
      }
    }
  }
  }
  const result=[];
  for(const g of groups.values()){
    const a=g.domain,nodeId=i=>`domain:${a.id}:${i}`,byEvent=new Map(),edges=new Map(),nodes=new Map(),states=[],ranges=[a.range];
    for(const p of g.evidence){if(!byEvent.has(p.executionId))byEvent.set(p.executionId,[]);byEvent.get(p.executionId).push(p);
      ranges.push(...p.sourceSlots,...p.rootBindings.flatMap(r=>[r.source,...r.linkSources]),...p.properties.map(p=>p.source),...p.rangeInputs.map(p=>p.source));}
    let history=stateHistoryCoverage(maxStates),omittedEdges=0;
    const storageRanges=[...new Map(ranges.map(r=>[JSON.stringify(r),r])).values()],objectIds=new Set(storageRanges.map(r=>r.objectId)),ended=new Set();
    for(const e of events){let changed=false;
      for(const o of objects)if(objectIds.has(o.id)&&o.endedBy===e.eventId){ended.add(o.id);changed=true;}
      if(e.kind==='WRITE'&&e.target)for(const [id,edge]of edges){
        if([...edge.sourceSlots,...edge.rootBindings.flatMap(r=>[r.source,...r.linkSources]),...edge.rangeInputs.map(r=>r.source)].some(r=>overlap(r,e.target))){edges.set(id,{...edge,status:'unconfirmed-after-write',invalidatedAtExecutionId:e.eventId});changed=true;}
        else if(edge.properties.some(p=>overlap(p.source,e.target))){edges.set(id,{...edge,properties:edge.properties.map(p=>overlap(p.source,e.target)?{...p,value:null,status:'unconfirmed-after-write'}:p)});changed=true;}
      }
      for(const p of byEvent.get(e.eventId)??[]){
        // A value retained in a temporary cannot revive a link overwritten
        // between its read and this calculation.
        const stale=p.sourceReads.some(r=>events.slice(position.get(r.executionId)+1,position.get(e.eventId)).some(e=>e.kind==='WRITE'&&overlap(r.source,e.target)));
        if(p.sourceSlots.some(r=>ended.has(r.objectId)))continue;
        if(stale)continue;
        for(const index of [p.fromIndex,p.toIndex])nodes.set(nodeId(index),{id:nodeId(index),index,range:{objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes}});
        if(!edges.has(p.edgeIdentity)&&edges.size>=maxEdges){omittedEdges++;continue;}
        edges.set(p.edgeIdentity,{...p,id:p.edgeIdentity,from:nodeId(p.fromIndex),to:nodeId(p.toIndex),status:'observed',afterExecutionId:e.eventId});changed=true;
      }
      if(!changed||!nodes.size)continue;
      const ns=[...nodes.values()],es=[...edges.values()].map(edge=>({...edge,
        status:ended.has(a.objectId)||[...edge.sourceSlots,...edge.rangeInputs.map(r=>r.source),...edge.rootBindings.flatMap(r=>[r.source,...r.linkSources])].some(r=>ended.has(r.objectId))?'ended':edge.status,
        properties:edge.properties.map(p=>({...p,status:ended.has(p.source.objectId)?'ended-source':p.status??'observed',
          ...(ended.has(p.source.objectId)?{endedAtExecutionId:objects.find(o=>o.id===p.source.objectId).endedBy}: {})}))})),alive=!ended.has(a.objectId),
        graph=topology(ns,es.filter(e=>e.status==='observed'));
      const state={afterExecutionId:e.eventId,alive,nodes:ns,edges:es,topology:graph,status:alive&&!omittedEdges&&!g.omitted&&es.every(e=>e.status==='observed'&&e.properties.every(p=>p.status==='observed'))?'observed':'partial'};
      states.push(state);
    }
    if(states.length)result.push({id:`index-domain:${a.id}`,kind:'index-domain-graph-candidate',origin:'inferred',intent:'unconfirmed',
      arrayId:a.id,vertexDomain:{arrayId:a.id,range:a.range},storageRanges,discoveredAtExecutionId:states[0].afterExecutionId,
      evidence:g.evidence,states,nodes:[],edges:[],coverage:{scope:'observed computations; unvisited edges and isolated vertices unknown',omittedEvidence:g.omitted,...history,omittedEdges,maxEvidence,maxStates,maxEdges},
      limitations:['endpoint co-use suggests a graph relation, not algorithm identity or author intent','unobserved edges and vertex membership remain unknown',
        'properties retain their original bytes and value; weight semantics are unconfirmed','integer lookup alone is insufficient; no numerical-similarity pairing']});
  }
  return result.map(s=>observeGraphStorage(_plan,{events,objects,structures},s,{maxEvidence,maxStates,maxEdges}));
}
