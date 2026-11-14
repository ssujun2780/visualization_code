import {stateHistoryCoverage,appendStateSnapshot} from './state-history.mjs';
import {topology} from '../shared/topology.mjs';
import {observedTraversalBoundaries,matchesBoundary} from './traversal-boundaries.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {parentRelationTopology} from './functional-relation-topology.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const num=v=>{const x=v?.decimal??v?.signed??v?.unsigned;return x!==undefined&&Number.isSafeInteger(Number(x))?Number(x):null;};
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const overlap=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;

// Row identity follows compiler geometry. A cell is a link only after its
// recorded value reaches the row subscript, never merely because it is in range.
export function tableRowStructures(plan,{events,objects,structures,valueFlow,inferenceBudget},{maxStates=2048,maxCells=16384}={}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),out=[];
  const arrays=structures.filter(s=>s.kind==='array'&&s.geometry?.rank===2&&['signed','unsigned'].includes(s.geometry.leafType?.signedness));
  for(const a of arrays){
    const [rows,cols]=a.geometry.dimensions,[stride,size]=a.geometry.byteStrides,o=objects.find(o=>o.id===a.objectId);
    if(!rows||!cols)continue;if(rows*cols>maxCells){inferenceBudget?.report('table-cells',maxCells,a.discoveredAtExecutionId??o?.createdBy);continue;}
    const cell=r=>r?.objectId===a.objectId&&r.size===size&&r.offset>=a.range.offset&&r.offset+r.size<=a.range.offset+a.range.size&&
      (r.offset-a.range.offset)%size===0?{row:Math.floor((r.offset-a.range.offset)/stride),column:((r.offset-a.range.offset)%stride)/size}:null;
    const accesses=events.filter(e=>['READ','WRITE'].includes(e.kind)&&cell(e.target)),evidence=[];
    for(const e of accesses){const target=cell(e.target),rowNodes=walk(defs.get(e.instructionId)?.expression).filter(n=>n.kind==='ArraySubscriptExpr'&&n.cType?.kind==='array');
      for(const row of rowNodes){const ids=new Set(walk(row.children[1]).map(n=>n.nodeId));
        for(const id of e.addressInputs??[]){const input=byId.get(id);if(num(input?.value)!==target.row||!walk(defs.get(input?.instructionId)?.expression).some(n=>ids.has(n.nodeId)))continue;
          for(const read of valueFlow.reads(id)){const source=cell(read.target);if(!source||num(read.value)!==target.row||pos.get(read.eventId)>=pos.get(e.eventId))continue;
            if(!evidence.some(p=>p.sourceReadExecutionId===read.eventId&&p.targetAccessExecutionId===e.eventId))evidence.push({
              sourceReadExecutionId:read.eventId,targetAccessExecutionId:e.eventId,indexExecutionId:id,source:{...read.target},
              fromRow:source.row,column:source.column,toRow:target.row});
          }
        }
      }
    }
    if(!evidence.length)continue;
    // Generalize a witnessed cursor recurrence across executions of that same
    // compiler read site. A final leaf need not be dereferenced again. These
    // transfers remain inferred links, distinct from executed row accesses.
    const witnessed=[...evidence],cursorSites=new Map();
    for(const p of witnessed){const read=byId.get(p.sourceReadExecutionId),d=defs.get(read.instructionId),decls=new Set(walk(d.expression)
      .filter(n=>n.kind==='ArraySubscriptExpr'&&n.cType?.kind==='array').flatMap(n=>walk(n.children[1]).map(n=>n.declarationId).filter(Boolean)));
      if(!cursorSites.has(read.instructionId))cursorSites.set(read.instructionId,{decls,support:p.targetAccessExecutionId});}
    for(const write of events)if(write.kind==='WRITE'){
      const d=defs.get(write.instructionId),lhs=d?.expression?.operator==='='?d.expression.children[0]:null;
      for(const read of (write.dataInputs??[]).flatMap(id=>valueFlow.reads(id))){const site=cursorSites.get(read.instructionId),source=cell(read.target),value=num(read.value);
        if(!site||!site.decls.has(lhs?.declarationId)||!source||value===null||value<0||value>=rows||num(write.value)!==value)continue;
        if(evidence.some(p=>p.sourceReadExecutionId===read.eventId))continue;
        const support=pos.get(write.eventId)>pos.get(site.support)?write.eventId:site.support;
        evidence.push({sourceReadExecutionId:read.eventId,targetAccessExecutionId:support,transferExecutionId:write.eventId,
          source:{...read.target},fromRow:source.row,column:source.column,toRow:value,kind:'cursor-transfer',supportExecutionId:site.support});
      }
    }
    evidence.sort((a,b)=>pos.get(a.targetAccessExecutionId)-pos.get(b.targetAccessExecutionId));
    const roleId=column=>`${a.id}:column:${column}`,boundaries=observedTraversalBoundaries(plan,{events,valueFlow},{
      source:r=>{const c=cell(r?.target);return c?{roleId:roleId(c.column),index:c.row,slotIndex:c.column}:null;},traversals:evidence}),
      columns=[...new Set(evidence.map(p=>p.column))],storage=new Map(),states=[],seenRows=new Set(),proofAt=new Map();
    for(const p of evidence){if(!proofAt.has(p.targetAccessExecutionId))proofAt.set(p.targetAccessExecutionId,[]);proofAt.get(p.targetAccessExecutionId).push(p);}
    const nodeId=row=>`${a.id}:row:${row}`,discovered=evidence[0].targetAccessExecutionId;
    let history=stateHistoryCoverage(maxStates);
    for(const e of events){const at=pos.get(e.eventId),target=e.target??(e.objectId===a.objectId?{objectId:a.objectId,offset:0,size:o.size}:null);
      let changed=false;
      if(['SPACE','WRITE','READ'].includes(e.kind)&&overlap(a.range,target))for(let row=0;row<rows;row++)for(const col of columns){
        const range={objectId:a.objectId,offset:a.range.offset+row*stride+col*size,size};if(!overlap(range,target))continue;
        const key=`${row}:${col}`,old=storage.get(key),bytes=e.memoryState&&e.kind!=='READ'?observeScalarBytes(old?.bytes,{size,signed:a.geometry.leafType.signedness==='signed',snapshot:e.memoryState,start:target.offset,offset:range.offset}):
          same(range,target)?observeScalarBytes(old?.bytes,{size,signed:a.geometry.leafType.signedness==='signed',value:e.value?.bits}):null;
        if(bytes){storage.set(key,{bytes,range,lastWrite:e.kind==='READ'?old?.lastWrite??null:e.eventId,lastObservation:e.eventId});changed=true;}
      }
      for(const p of proofAt.get(e.eventId)??[]){seenRows.add(p.fromRow);seenRows.add(p.toRow);changed=true;}
      const termination=boundaries.filter(p=>p.executionId===e.eventId);for(const p of termination){seenRows.add(p.index);changed=true;}
      if(e.eventId===o.endedBy)changed=true;
      if(!changed||at<pos.get(discovered))continue;
      const alive=at<(pos.get(o.endedBy)??Infinity),nodes=[...seenRows].sort((a,b)=>a-b).map(row=>({id:nodeId(row),index:row,range:{objectId:a.objectId,offset:a.range.offset+row*stride,size:stride}})),edges=[];
      for(const n of nodes)for(const column of columns){const s=storage.get(`${n.index}:${column}`),value=s?.bytes.value??null,
        proofs=evidence.filter(p=>p.fromRow===n.index&&p.column===column&&p.toRow===value&&pos.get(p.targetAccessExecutionId)<=at&&pos.get(p.sourceReadExecutionId)>=(pos.get(s?.lastWrite)??-1)),
        end=boundaries.find(p=>p.roleId===roleId(column)&&p.index===n.index&&pos.get(p.executionId)<=at&&pos.get(p.readExecutionId)>=(pos.get(s?.lastWrite)??-1)&&matchesBoundary(p.predicate,value,n.index));
        edges.push({from:n.id,to:proofs.length&&!end?nodeId(value):null,roleId:roleId(column),column,value,source:s?.range??null,
          status:!alive?'ended':end?'observed-termination':proofs.some(p=>p.kind!=='cursor-transfer')?'observed':proofs.length?'inferred':'unknown',lastWriteExecutionId:s?.lastWrite??null,
          evidenceExecutionIds:[...proofs.map(p=>p.targetAccessExecutionId),...end?[end.executionId]:[]]});
      }
      const links=edges.filter(e=>['observed','inferred'].includes(e.status)),complete=alive&&edges.every(e=>['observed','observed-termination'].includes(e.status)),
        t={...topology(nodes,links),complete,status:complete?'observed':'partial',scope:'observed-edges',
          maxChildren:Math.max(0,...nodes.map(n=>links.filter(e=>e.from===n.id).length)),sharedChildren:nodes.filter(n=>links.filter(e=>e.to===n.id).length>1).map(n=>n.id)},
        state={afterExecutionId:e.eventId,alive,nodes,edges,topology:t,roleIds:columns.filter(col=>evidence.some(p=>p.column===col&&pos.get(p.targetAccessExecutionId)<=at)).map(roleId),
          parentTopology:columns.length===1?parentRelationTopology(nodes,edges):null,unknownSlotCount:edges.filter(e=>e.status==='unknown').length};
      appendStateSnapshot(states,state,history);
    }
    out.push({id:`row-relations:${a.id}`,kind:'table-row-graph-candidate',origin:'inferred',intent:'unconfirmed',range:a.range,
      containerId:a.id,discoveredAtExecutionId:discovered,storageKind:'table-rows',nodes:[],edges:[],states,relationEvidence:evidence,terminationEvidence:boundaries,
      coverage:{maxCells,maxStates,...history},limitations:['only executed row transitions establish links','unvisited cells remain unknown; rows and physical grid remain available']});
  }
  return out;
}
