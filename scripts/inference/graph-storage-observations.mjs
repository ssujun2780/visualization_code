import {stateHistoryCoverage,appendStateSnapshot} from './state-history.mjs';
// Extend a learned graph role with subsequent storage observations. Comparisons
// establish roles, but are not required to execute for every later edge.
import {topology} from '../shared/topology.mjs';
import {graphProofId,graphEdgeIdentity,mergeGraphEvidence} from './graph-proof-identity.mjs';
const unique=a=>[...new Set(a)];
const slot=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const number=v=>{const n=Number(v?.decimal??v?.unsigned??v?.signed);return Number.isSafeInteger(n)?n:null;};
const loop=d=>['ForStmt','WhileStmt','DoStmt'].includes(d?.controlKind);
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>n&&['ImplicitCastExpr','ParenExpr'].includes(n.kind)?unwrap(n.children?.[0]):n;

export function observeGraphStorage(plan,trace,s,{maxStates=512,maxEvidence=8192,maxEdges=1024}={}){
  const {events,objects,structures}=trace,byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),array=structures.find(a=>a.id===s.arrayId),
    work=structures.find(a=>a.kind==='array-work'),access=new Map((work?.accesses??[]).map(a=>[a.executionId,a]));
  if(!array||!work||!s.evidence.length)return s;
  const objectDecl=new Map(objects.map(o=>[o.id,defs.get(byId.get(o.createdBy)?.instructionId)?.declarationId])),
    byObject=new Map(objects.map(o=>[o.id,o])),schemas=new Map(),schemaForProof=new Map(),proofsAt=new Map(),baseAt=new Map(s.states.map(st=>[st.afterExecutionId,st]));
  const controls=e=>(e?.controlInputs??[]).filter(id=>loop(defs.get(byId.get(id)?.instructionId)));
  const iteration=e=>`${e.activationId}|${controls(e).join('|')}`;
  for(const p of s.evidence){
    const matrix=p.kind==='matrix-operand-pair',source=byId.get(matrix?p.properties[0]?.readExecutionId:p.indexSourceReadExecutionId),
      from=access.get(p.sourceAccessExecutionId),axis=from?.axes?.[0]?.index,fromDecl=axis?.declarationId,
      fromCursor=from?.cursors?.find(c=>c.declarationId===fromDecl&&c.value===p.fromIndex);
    if(!source||!matrix&&(!fromCursor||axis.offset))continue;
    const properties=p.properties.map(x=>byId.get(x.readExecutionId));if(properties.some(x=>!x))continue;
    const id=JSON.stringify([matrix,source.instructionId,fromDecl,properties.map(e=>e.instructionId)]);
    if(!schemas.has(id)){
      const roots=[...(p.rootBindings??[]).map(r=>r.source),...(p.rangeInputs??[]).map(r=>r.source)],
        rowReads=work.accesses.filter(a=>a.kind==='READ'&&pos.get(a.executionId)<=pos.get(source.eventId)&&
          roots.some(r=>slot(r)===slot(a.target))&&a.cursors?.some(c=>c.declarationId===fromDecl&&c.value===p.fromIndex)),
        gates=(source.controlInputs??[]).map(id=>byId.get(id)).filter(e=>defs.get(e?.instructionId)?.controlKind==='IfStmt'),
        loopEvent=byId.get(controls(source).at(-1)),condition=unwrap(defs.get(byId.get(loopEvent?.dataInputs?.[0])?.instructionId)?.expression),
        tested=unwrap(condition?.kind==='BinaryOperator'?condition.children?.[0]:condition),
        addressDecls=walk(defs.get(source.instructionId)?.expression).filter(n=>n.kind==='DeclRefExpr').map(n=>n.declarationId),
        completionSafe=tested?.kind==='DeclRefExpr'&&addressDecls.includes(tested.declarationId)&&
          (condition?.kind==='DeclRefExpr'||['!=','<','<='].includes(condition?.operator)),
        gate=matrix?gates.find(e=>(p.sourceReads??[]).some(r=>{
          const read=byId.get(r.executionId);return read&&e.dataInputs?.some(id=>{
            const calc=byId.get(id);return id===read.eventId||calc?.dataInputs?.includes(read.eventId);
          });
        })):null;
      schemas.set(id,{id,matrix,learnedFrom:p.executionId,learnedProofId:graphProofId(p),sourceSite:source.instructionId,fromDecl,
        functionId:defs.get(source.instructionId)?.functionId,sourceObject:source.target.objectId,
        properties:properties.map((e,i)=>({site:e.instructionId,role:p.properties[i].role,objectId:e.target.objectId,
          delta:e.target.objectId===source.target.objectId?e.target.offset-source.target.offset:null})),
        sourceSites:(p.sourceReads??[]).map(r=>byId.get(r.executionId)?.instructionId).filter(Boolean),
        rowSites:unique(rowReads.map(a=>byId.get(a.executionId).instructionId)),
        loopSite:loopEvent?.instructionId,completionSafe,
        gate:gate?{site:gate.instructionId,truth:number(gate.condition)!==0,readSites:(p.sourceReads??[]).map(r=>byId.get(r.executionId)?.instructionId).filter(Boolean)}:null});
    }
    schemaForProof.set(p,id);
    if(!proofsAt.has(p.executionId))proofsAt.set(p.executionId,[]);proofsAt.get(p.executionId).push(p);
  }
  const latest=new Map(),values=new Map(),rows=new Map(),domainFrames=new Set(),membership=new Map(),
    edges=new Map(),absences=new Map(),storageEvidence=[],absenceEvidence=[],states=[],scopeRanges=new Map(),ended=new Set();
  const readAt=(site,e)=>latest.get(`${site}|${iteration(e)}`);
  const currentCursor=(schema,e)=>values.get(`${schema.fromDecl}|${e.activationId}`)??values.get(`${schema.fromDecl}|static`);
  const fresh=(reads,at)=>reads.every(r=>!events.slice(pos.get(r.eventId)+1,at+1).some(e=>
    e.kind==='WRITE'&&overlap(e.target,r.target)||e.action==='object.end'&&e.objectId===r.target.objectId));
  const nodeId=i=>s.kind==='index-domain-graph-candidate'?`domain:${array.id}:${i}`:`${array.id}:vertex:${i}`;
  const history=stateHistoryCoverage(maxStates);let base=null,omittedEvidence=0;
  function absent(edge,e,proof){
    if(edge.status==='absent'||edge.status==='ended')return false;
    const record={...proof,executionId:e.eventId,edgeIdentity:edge.edgeIdentity};absenceEvidence.push(record);absences.set(edge.id,record);
    edges.set(edge.id,{...edge,status:'absent',absence:record});return true;
  }
  for(let at=0;at<events.length;at++){
    const e=events[at],a=access.get(e.eventId);let changed=false;
    for(const o of objects)if(o.endedBy===e.eventId){ended.add(o.id);if(o.id===array.objectId||[...edges.values()].some(edge=>[...edge.sourceSlots,...edge.properties.map(p=>p.source)].some(r=>r.objectId===o.id)))changed=true;}
    if(e.kind==='READ')latest.set(`${e.instructionId}|${iteration(e)}`,e);
    if(['READ','WRITE'].includes(e.kind)&&e.target){
      const o=byObject.get(e.target.objectId),decl=objectDecl.get(o?.id);
      if(decl&&e.target.offset===0&&e.target.size===o.size)values.set(`${decl}|${o.storage==='static'?'static':o.frameId}`,e);
      if(a?.target.arrayId===array.id&&a.target.elementOffset===0&&a.target.size===array.elementBytes){
        domainFrames.add(e.activationId);
        // Actual indexed visits nominate vertex storage; capacity alone never does.
        if(a.axes?.length&&a.target.index>=0&&a.target.index<array.capacity&&!membership.has(a.target.index)){membership.set(a.target.index,e.eventId);changed=true;}
      }
    }
    if(e.kind==='WRITE'&&e.target)for(const [id,edge]of edges){
      if(edge.status==='absent')continue;
      const structural=[...edge.sourceSlots??[],...(edge.rootBindings??[]).flatMap(r=>[r.source,...r.linkSources]),...(edge.rangeInputs??[]).map(r=>r.source)];
      if(structural.some(r=>overlap(r,e.target))){edges.set(id,{...edge,status:'unconfirmed-after-write',invalidatedAtExecutionId:e.eventId});changed=true;}
      else if(edge.properties?.some(p=>overlap(p.source,e.target))){edges.set(id,{...edge,properties:edge.properties.map(p=>overlap(p.source,e.target)?{...p,value:null,status:'unconfirmed-after-write'}:p)});changed=true;}
    }
    if(e.kind==='WRITE'&&e.target)for(const row of rows.values())if(row.watched.some(r=>overlap(r,e.target)))row.incomplete=true;
    const next=baseAt.get(e.eventId);
    if(next){base=next;changed=true;for(const edge of next.edges){
      const old=edges.get(edge.id),gone=absences.get(edge.id),proof=s.evidence.find(p=>p.executionId===edge.executionId&&p.edgeIdentity===edge.edgeIdentity);
      if(gone&&pos.get(edge.executionId)<=pos.get(gone.executionId))continue;
      if(old?.basis==='learned-storage-role'&&pos.get(old.executionId)>pos.get(edge.executionId))continue;
      edges.set(edge.id,mergeGraphEvidence(old,{...edge,storageRoleId:schemaForProof.get(proof)}));
    }}
    for(const schema of schemas.values()){
      const rowKey=`${schema.id}|${e.activationId}`;
      if(e.kind==='READ'&&schema.rowSites.includes(e.instructionId)&&a?.target.index>=0){
        const cursor=currentCursor(schema,e),from=number(cursor?.value);
        if(from===a.target.index){
          const watched=[e.target,...[...edges.values()].filter(x=>x.storageRoleId===schema.id&&x.fromIndex===from).flatMap(x=>
            [...x.sourceSlots,...x.properties.map(p=>p.source),...(x.rootBindings??[]).flatMap(r=>[r.source,...r.linkSources])])];
          rows.set(rowKey,{from,start:e.eventId,seen:new Set(),pending:false,incomplete:false,watched});scopeRanges.set(slot(e.target),e.target);
        }
      }
      if(pos.get(schema.learnedFrom)>at)continue;
      for(const p of proofsAt.get(e.eventId)??[])if(schemaForProof.get(p)===schema.id){
        const row=rows.get(rowKey);if(row?.from===p.fromIndex){row.seen.add(p.edgeIdentity);row.pending=false;}
      }
      if(e.kind==='READ'&&[schema.sourceSite,...schema.properties.map(p=>p.site),...schema.sourceSites].includes(e.instructionId)&&domainFrames.has(e.activationId)){
        const source=readAt(schema.sourceSite,e),props=schema.properties.map(p=>readAt(p.site,e)),cursor=currentCursor(schema,e),
          other=schema.sourceSites.filter(site=>site!==schema.sourceSite).map(site=>readAt(site,e));
        if(!source||props.some(x=>!x)||other.some(x=>!x))continue;
        const sa=access.get(source.eventId),from=schema.matrix?sa?.target.coordinates?.[0]:number(cursor?.value),
          to=schema.matrix?sa?.target.coordinates?.[1]:number(source.value);
        if(![from,to].every(i=>Number.isInteger(i)&&i>=0&&i<array.capacity)||!schema.matrix&&!cursor)continue;
        const linkedSource=source.target.objectId!==schema.sourceObject;
        if(linkedSource&&!schema.properties.every(p=>p.delta!==null))continue;
        if(!props.every((r,i)=>{const relation=schema.properties[i],pa=access.get(r.eventId);
          return relation.delta!==null?r.target.objectId===source.target.objectId&&r.target.offset-source.target.offset===relation.delta:
            r.target.objectId===relation.objectId&&pa?.target.index===sa?.target.index;}))continue;
        const reads=unique([source,...props,...other,...(schema.matrix?[]:[cursor])]);
        if(!fresh(reads,at))continue;
        const sourceReads=schema.matrix?schema.sourceSites.map(site=>readAt(site,e)).filter(Boolean):[source,...other];
        if(schema.matrix&&(sourceReads.length!==schema.sourceSites.length||!fresh(sourceReads,at)))continue;
        const slots=sourceReads.map(r=>r.target),identity=schema.matrix?graphEdgeIdentity({fromIndex:from,toIndex:to,sourceSlots:slots,properties:props.map(r=>({source:r.target}))},{matrix:true}):
          `${slots.map(slot).sort().join('|')}:${from}:${to}`;
        const row=rows.get(rowKey);if(row?.from===from){row.seen.add(identity);row.pending=false;row.watched.push(...slots,...props.map(r=>r.target));}
        if(storageEvidence.length>=maxEvidence||!edges.has(identity)&&edges.size>=maxEdges){omittedEvidence++;continue;}
        const previous=edges.get(identity);if(previous?.status==='observed'&&previous.properties?.every((p,i)=>p.readExecutionId===props[i]?.eventId))continue;
        const proof={kind:'learned-storage-role',roleId:schema.id,learnedFrom:schema.learnedFrom,learnedProofId:schema.learnedProofId,executionId:e.eventId,
          fromIndex:from,toIndex:to,edgeIdentity:identity,sourceReadExecutionId:source.eventId,
          fromReadExecutionId:schema.matrix?null:cursor.eventId,evidenceExecutionIds:unique([...reads,...sourceReads].map(r=>r.eventId)),
          sourceSlots:slots,sourceReads:sourceReads.map(r=>({source:r.target,executionId:r.eventId})),
          rootBindings:previous?.rootBindings??[],rangeInputs:row?[{source:byId.get(row.start).target,sourceReadExecutionId:row.start}]:[],properties:props.map((r,i)=>({source:r.target,value:r.value,readExecutionId:r.eventId,role:schema.properties[i].role,status:'observed'}))};
        storageEvidence.push(proof);edges.set(identity,mergeGraphEvidence(previous,{...proof,id:identity,from:nodeId(from),to:nodeId(to),status:'observed',
          storageRoleId:schema.id,basis:'learned-storage-role',afterExecutionId:e.eventId}));changed=true;
      }
      if(e.action==='branch'&&e.instructionId===schema.loopSite){
        const row=rows.get(rowKey);if(row){
          if(row.pending)row.incomplete=true;
          if(number(e.condition)===0){
            if(schema.completionSafe&&!row.incomplete)for(const edge of edges.values())if(edge.storageRoleId===schema.id&&edge.fromIndex===row.from&&!row.seen.has(edge.edgeIdentity))
              changed=absent(edge,e,{kind:'completed-row',roleId:schema.id,rowReadExecutionId:row.start,loopInstructionId:schema.loopSite})||changed;
            rows.delete(rowKey);
          }else row.pending=true;
        }
      }
      if(e.action==='branch'&&schema.gate?.site===e.instructionId&&(number(e.condition)!==0)!==schema.gate.truth){
        for(const site of schema.gate.readSites){const read=readAt(site,e),ra=access.get(read?.eventId),coords=ra?.target.coordinates;
          if(!read||coords?.length!==2||!fresh([read],at))continue;
          for(const edge of edges.values())if(edge.storageRoleId===schema.id&&edge.fromIndex===coords[0]&&edge.toIndex===coords[1])
            changed=absent(edge,e,{kind:'observed-absence-branch',roleId:schema.id,readExecutionId:read.eventId,branchInstructionId:e.instructionId})||changed;
        }
      }
    }
    if(!base||!changed)continue;
    const liveEdges=[...edges.values()].map(edge=>({...edge,status:ended.has(array.objectId)||edge.sourceSlots.some(r=>ended.has(r.objectId))?'ended':edge.status,
      properties:edge.properties.map(p=>({...p,status:ended.has(p.source.objectId)?'ended-source':p.status??'observed',
        ...(ended.has(p.source.objectId)?{endedAtExecutionId:byObject.get(p.source.objectId)?.endedBy}:{})}))})),
      indices=unique([...base.nodes.map(n=>n.index),...membership.keys(),...liveEdges.flatMap(e=>[e.fromIndex,e.toIndex])]).sort((a,b)=>a-b),
      nodes=indices.map(index=>({id:nodeId(index),index,range:{objectId:array.objectId,offset:array.range.offset+index*array.elementBytes,size:array.elementBytes}})),
      links=liveEdges.filter(e=>e.status==='observed'),shape=topology(nodes,links),state={...base,afterExecutionId:e.eventId,nodes,edges:liveEdges,
        topology:{...shape,maxChildren:Math.max(0,...nodes.map(n=>links.filter(e=>e.from===n.id).length)),sharedChildren:nodes.filter(n=>links.filter(e=>e.to===n.id).length>1).map(n=>n.id)},
        membership:{status:'candidate',scope:'observed indexed vertex-storage accesses; logical occupancy remains a candidate',evidenceExecutionIds:[...membership.values()]},
        rowStorageRanges:[...scopeRanges.values()],status:liveEdges.every(e=>e.status==='absent'||e.status==='observed'&&e.properties.every(p=>!p.status||p.status==='observed'))?'observed':'partial'};
    appendStateSnapshot(states,state,history);
  }
  return {...s,states,storageRoles:[...schemas.values()],storageEvidence,absenceEvidence,
    coverage:{...s.coverage,scope:'observed graph storage and indexed vertex accesses; unvisited membership and relations unknown',storageObservationLimit:maxEvidence,omittedStorageEvidence:omittedEvidence,...history}};
}
