import {stateHistoryCoverage} from './state-history.mjs';
// Derived views over witnessed address transfers, bounded walks and matrix
// operand axes. No source evaluator, algorithm names or execution mutations.
import {createValueFlow} from './observed-value-flow.mjs';
import {topology} from '../shared/topology.mjs';
import {observeGraphStorage} from './graph-storage-observations.mjs';
import {neighborhoodProofs} from './neighborhood-proofs.mjs';
import {graphEdgeIdentity,mergeGraphEvidence} from './graph-proof-identity.mjs';
import {indexedNeighborhoodProofs} from './indexed-neighborhood-proofs.mjs';
import {edgeListProofs} from './edge-list-proofs.mjs';
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const num=v=>Number(v?.decimal??v?.signed??v?.unsigned);
const unique=a=>[...new Set(a)];
export function traversalGraphStructures(plan,trace,{maxEvidence=8192,maxStates=512,maxEdges=1024}={}){
  const {events,objects,frames,structures}=trace,flow=trace.valueFlow??createValueFlow(plan,trace),
    deps=structures.find(s=>s.kind==='storage-dependencies'),work=structures.find(s=>s.kind==='array-work');
  if(!deps||!work)return [];
  const byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),
    access=new Map(work.accesses.map(a=>[a.executionId,a])),frame=new Map(frames.map(f=>[f.id,f])),coindex=new Map(),groups=new Map();
  const location=e=>access.get(e?.eventId)?.target;
  const reads=(input,e,step)=>flow.dependencyReads(input,e,step,new Set(),r=>!!location(r)).filter(r=>location(r));
  for(const c of deps.coindexed??[])for(const id of c.accessExecutionIds){
    if(!coindex.has(id))coindex.set(id,new Set());for(const other of c.accessExecutionIds)coindex.get(id).add(other);
  }
  function add(a,proof){
    if(!a||![proof.fromIndex,proof.toIndex].every(i=>Number.isInteger(i)&&i>=0&&i<a.capacity))return;
    const ids=unique(proof.evidenceExecutionIds),at=pos.get(proof.executionId);
    if(ids.some(id=>!pos.has(id)||pos.get(id)>at))return;
    let g=groups.get(a.id);if(!g)groups.set(a.id,g={array:a,evidence:[],omitted:0});
    const key=graphEdgeIdentity(proof);
    if(g.evidence.some(p=>p.kind===proof.kind&&p.executionId===proof.executionId&&p.edgeIdentity===key))return;
    if(g.evidence.length>=maxEvidence){g.omitted++;return;}
    g.evidence.push({...proof,edgeIdentity:key,evidenceExecutionIds:ids});
  }
  // A computation crossing a real recursive call carries a stored link. The
  // immediate caller boundary rejects ancestors accidentally included in a
  // transitive arithmetic dependency chain.
  const computed=(deps.relations??[]).filter(r=>{
    const from=byId.get(r.sourceReadExecutionId),to=byId.get(r.targetAccessExecutionId),parent=frame.get(to?.activationId)?.parent;
    return r.kind==='computed-address-use'&&from?.activationId===parent&&
      frame.get(parent)?.functionId===frame.get(to.activationId)?.functionId&&r.targetArrayId;
  });
  const linkArrays=new Set(computed.map(r=>r.sourceArrayId));
  for(const r of computed){
    const a=arrays.get(r.targetArrayId),from=byId.get(r.sourceReadExecutionId),to=byId.get(r.targetAccessExecutionId);
    let fromIndex,origin=null;
    if(r.sourceRecord&&r.targetRecord&&r.sourceArrayId===a.id){fromIndex=(r.sourceRecord.offset-a.range.offset)/a.elementBytes;}
    else{
      if(linkArrays.has(a.id))continue;
      origin=[...coindex.get(from.eventId)??[]].map(id=>byId.get(id)).find(e=>e.kind==='READ'&&e.activationId===from.activationId&&
        location(e)?.arrayId===a.id&&pos.get(e.eventId)<=pos.get(from.eventId));
      if(!origin)continue;fromIndex=location(origin).index;
    }
    add(a,{kind:'computed-index-transfer',executionId:to.eventId,fromIndex,toIndex:r.targetIndex,
      relationId:r.id,targetAccessExecutionId:to.eventId,sourceReadExecutionId:from.eventId,
      sourceAccessExecutionId:origin?.eventId??null,sourceSlots:[r.source],properties:[],
      storedValue:from.value,sourceUnit:r.sourceUnit,targetUnit:r.targetUnit,
      coordinateSystem:{objectId:a.objectId,byteOffset:a.range.offset,elementBytes:a.elementBytes},
      transforms:r.transforms.filter(t=>pos.get(t.executionId)>=pos.get(from.eventId)),
      evidenceExecutionIds:[from.eventId,to.eventId,...origin?[origin.eventId]:[]],
      sourceReads:[{source:r.source,executionId:from.eventId}]});
  }
  // Range table -> controlled edge-index walk -> vertex-index access. Adjacent
  // bounds and exact observed indices establish the row; equal lengths do not.
  for(const r of deps.relations??[]){
    if(!r.preserved||!r.targetArrayId||!r.sourceArrayId)continue;
    const a=arrays.get(r.targetArrayId),edgeRead=byId.get(r.sourceReadExecutionId),to=byId.get(r.targetAccessExecutionId);
    if(a.elementType?.kind==='record'||a.elementType?.kind==='array'||r.target.size!==a.elementBytes)continue;
    const lowerRelations=(deps.relations??[]).filter(x=>x.targetAccessExecutionId===edgeRead.eventId&&x.sourceArrayId&&x.sourceArrayId!==r.sourceArrayId);
    for(const branchId of edgeRead.controlInputs??[]){
      const branch=byId.get(branchId),bd=defs.get(branch?.instructionId);
      if(branch?.action!=='branch'||!['ForStmt','WhileStmt'].includes(bd?.controlKind)||!num(branch.condition))continue;
      for(const id of branch.dataInputs??[]){const calc=byId.get(id);if(calc?.kind!=='CALC')continue;
        for(const step of calc.steps??[])if(['<','>'].includes(step.operator)){
          const upperReads=reads(step.inputs[step.operator==='<'?1:0],calc,step);
          for(const lower of lowerRelations)for(const upper of upperReads){
            const row=arrays.get(lower.sourceArrayId),up=location(upper),lo=byId.get(lower.sourceReadExecutionId);
            if(row.capacity!==a.capacity+1||up?.arrayId!==row.id||up.index!==lower.sourceIndex+1||
              !Number.isInteger(lower.sourceIndex)||lower.sourceIndex>=a.capacity||
              r.sourceIndex<num(lo.value)||r.sourceIndex>=num(upper.value)||pos.get(lo.eventId)>pos.get(branchId))continue;
            add(a,{kind:'bounded-index-walk',executionId:to.eventId,fromIndex:lower.sourceIndex,toIndex:r.targetIndex,
              relationId:r.id,lowerRelationId:lower.id,targetAccessExecutionId:to.eventId,sourceReadExecutionId:edgeRead.eventId,
              lowerReadExecutionId:lo.eventId,upperReadExecutionId:upper.eventId,branchExecutionId:branchId,
              sourceSlots:[r.source,lower.source,upper.target],properties:[],transforms:lower.transforms,
              evidenceExecutionIds:[to.eventId,edgeRead.eventId,lo.eventId,upper.eventId,branchId,calc.eventId],
              sourceReads:[{source:r.source,executionId:edgeRead.eventId},{source:lower.source,executionId:lo.eventId},{source:upper.target,executionId:upper.eventId}]});
          }
        }
      }
    }
  }
  const cursorOrigin=id=>flow.chain(id).at(-1)?.eventId;
  const sameAxis=(matrix,axis,endpoint)=>{
    const ids=matrix.axes?.find(a=>a.axis===axis)?.indexDeclarationIds??[],
      m=matrix.cursors.filter(c=>ids.includes(c.declarationId)),d=endpoint.cursors;
    return m.some(x=>d.some(y=>cursorOrigin(x.executionId)===cursorOrigin(y.executionId)));
  };
  // Matrix cells are properties of an observed pair only when both axes carry
  // the same dynamic cursor versions as the compared vertex accesses.
  for(const calc of events)if(calc.kind==='CALC')for(const step of calc.steps??[]){
    if(!['<','<=','>','>=','==','!='].includes(step.operator)||step.inputs?.length!==2)continue;
    const sides=step.inputs.map(i=>reads(i,calc,step));
    for(let side=0;side<2;side++){
      if(sides[side].length!==1)continue;
      const to=sides[side][0],toAccess=access.get(to.eventId),a=arrays.get(toAccess.target.arrayId);
      if(toAccess.target.size!==a.elementBytes||a.elementType?.kind==='array')continue;
      for(const from of sides[1-side]){
        const fromAccess=access.get(from.eventId);if(fromAccess.target.arrayId!==a.id||from.eventId===to.eventId)continue;
        const properties=sides[1-side].filter(e=>{const m=access.get(e.eventId);
          return m.target.coordinates?.length===2&&sameAxis(m,0,fromAccess)&&sameAxis(m,1,toAccess);});
        if(!properties.length)continue;
        const gates=unique([...(calc.dataInputs??[]).flatMap(id=>reads({executionId:id},calc).map(e=>e.eventId)),
          ...(calc.controlInputs??[]).flatMap(id=>(byId.get(id)?.dataInputs??[]).flatMap(x=>reads({executionId:x},calc).map(e=>e.eventId)))]).map(id=>byId.get(id)).filter(e=>{
          const m=access.get(e.eventId);return !properties.includes(e)&&m.target.coordinates?.length===2&&sameAxis(m,0,fromAccess)&&sameAxis(m,1,toAccess);});
        add(a,{kind:'matrix-operand-pair',executionId:calc.eventId,comparisonNodeId:step.nodeId,fromIndex:fromAccess.target.index,toIndex:toAccess.target.index,
          sourceAccessExecutionId:from.eventId,targetAccessExecutionId:to.eventId,sourceSlots:gates.map(e=>e.target),
          properties:properties.map(e=>({source:e.target,value:e.value,readExecutionId:e.eventId,role:'matrix-property; meaning unconfirmed'})),
          evidenceExecutionIds:[calc.eventId,from.eventId,to.eventId,...properties.map(e=>e.eventId),...gates.map(e=>e.eventId)],
          sourceReads:gates.map(e=>({source:e.target,executionId:e.eventId})),transforms:[]});
      }
    }
  }
  for(const {array,proof} of neighborhoodProofs(plan,trace,flow))add(array,proof);
  for(const {array,proof} of indexedNeighborhoodProofs(plan,trace,flow))add(array,proof);
  for(const {array,proof} of edgeListProofs(plan,trace,flow))add(array,proof);
  const result=[];
  for(const {array:a,evidence,omitted}of groups.values()){
    const at=new Map(),edges=new Map(),nodes=new Map(),states=[],ended=new Set();let omittedEdges=0,history=stateHistoryCoverage(maxStates);
    for(const p of evidence){if(!at.has(p.executionId))at.set(p.executionId,[]);at.get(p.executionId).push(p);}
    for(const e of events){let changed=false;
      for(const o of objects)if(o.endedBy===e.eventId){ended.add(o.id);if(o.id===a.objectId||[...edges.values()].some(p=>[...p.sourceSlots,...p.properties.map(x=>x.source)].some(r=>r.objectId===o.id)))changed=true;}
      if(e.kind==='WRITE')for(const [id,p]of edges){
        if(p.sourceSlots.some(r=>overlap(r,e.target))){edges.set(id,{...p,status:'unconfirmed-after-write',invalidatedAtExecutionId:e.eventId});changed=true;}
        else if(p.properties.some(x=>overlap(x.source,e.target))){edges.set(id,{...p,properties:p.properties.map(x=>overlap(x.source,e.target)?{...x,value:null,status:'unconfirmed-after-write'}:x)});changed=true;}
      }
      for(const p of at.get(e.eventId)??[]){
        if(p.sourceReads.some(r=>ended.has(r.source.objectId)||events.slice(pos.get(r.executionId)+1,pos.get(e.eventId)).some(w=>w.kind==='WRITE'&&overlap(w.target,r.source))))continue;
        const node=i=>`${a.id}:vertex:${i}`;
        for(const i of [p.fromIndex,p.toIndex])nodes.set(node(i),{id:node(i),index:i,range:{objectId:a.objectId,offset:a.range.offset+i*a.elementBytes,size:a.elementBytes}});
        if(!edges.has(p.edgeIdentity)&&edges.size>=maxEdges){omittedEdges++;continue;}
        edges.set(p.edgeIdentity,mergeGraphEvidence(edges.get(p.edgeIdentity),{...p,id:p.edgeIdentity,from:node(p.fromIndex),to:node(p.toIndex),status:'observed'}));changed=true;
      }
      if(!changed||!nodes.size)continue;
      const ns=[...nodes.values()],es=[...edges.values()].map(p=>({...p,
        weightRange:p.properties.filter(x=>x.role==='edge-update-attribute').length===1?p.properties.find(x=>x.role==='edge-update-attribute').source:undefined,
        status:ended.has(a.objectId)||p.sourceSlots.some(r=>ended.has(r.objectId))?'ended':p.status,
        properties:p.properties.map(x=>({...x,status:ended.has(x.source.objectId)?'ended-source':x.status??'observed'}))}));
      const links=es.filter(e=>e.status==='observed'),shape={...topology(ns,links),
        maxChildren:Math.max(0,...ns.map(n=>links.filter(e=>e.from===n.id).length)),
        sharedChildren:ns.filter(n=>links.filter(e=>e.to===n.id).length>1).map(n=>n.id)};
      const state={afterExecutionId:e.eventId,alive:!ended.has(a.objectId),nodes:ns,edges:es,topology:shape,status:'partial'};
      states.push(state);
    }
    if(!states.length)continue;
    result.push({id:`traversal-graph:${a.id}`,kind:'observed-traversal-graph-candidate',origin:'inferred',intent:'unconfirmed',arrayId:a.id,
      vertexDomain:{arrayId:a.id,range:a.range},nodes:[],edges:[],states,evidence,discoveredAtExecutionId:states[0].afterExecutionId,
      coverage:{scope:'observed relations only',omittedEvidence:omitted,omittedEdges,...history,maxEvidence,maxEdges,maxStates},
      limitations:['a computed address is not an unchanged stored index','unvisited relations, isolated vertices and author intent remain unknown','properties and control storage retain distinct roles']});
  }
  return result.map(s=>{
    const stateWrites=s.evidence.filter(p=>byId.get(p.targetAccessExecutionId)?.kind==='WRITE'),
      associations=stateWrites.flatMap(p=>[...structures,...result].filter(g=>['index-domain-graph-candidate','observed-traversal-graph-candidate'].includes(g.kind)&&g.arrayId!==s.arrayId).flatMap(g=>
        g.evidence.filter(q=>p.sourceReadExecutionId&&(q.indexSourceReadExecutionId??q.sourceReadExecutionId)===p.sourceReadExecutionId&&
          byId.get(q.targetAccessExecutionId)?.kind==='READ'&&pos.get(q.executionId)<=pos.get(p.executionId)).map(q=>({structureId:g.id,
          sourceReadExecutionId:p.sourceReadExecutionId,stateAccessExecutionId:p.targetAccessExecutionId,
          evidenceExecutionIds:[p.executionId,q.executionId,p.targetAccessExecutionId]}))));
    const conditional=stateWrites.every(p=>byId.get(p.targetAccessExecutionId).controlInputs?.some(id=>defs.get(byId.get(id)?.instructionId)?.controlKind==='IfStmt'));
    return observeGraphStorage(plan,trace,{...s,...(associations.length?{relationRole:{kind:conditional?'conditional-vertex-state':'vertex-state-observations',associations,
      meaning:'observed conditional updates associated with another vertex domain; algorithm meaning unconfirmed'}}:{})},{maxEvidence,maxStates,maxEdges});
  });
}
