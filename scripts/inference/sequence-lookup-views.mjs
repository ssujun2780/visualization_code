import {sequenceEvidence,walk,unwrap,key,contains,num} from './sequence-evidence.mjs';
import {sequenceConditions} from './sequence-conditions.mjs';
import {sequenceSource} from './sequence-source.mjs';
import {stateHistoryCoverage,appendStateSnapshot,stateHistoryGapAt,structureStateAt} from './state-history.mjs';
const uniq=a=>[...new Set(a)];
const canon=id=>id?.replace(/:slot:\d+$/,'');
export function sequenceLookupStructures(plan,trace,{maxStates=2048,maxLabelUnits=256}={}){
 const ctx=sequenceEvidence(plan,trace),{events,byId,pos,defs,flow,deps,isInput,advance,scalar,depends,after,loopExits}=ctx,
   raw=trace.structures.find(s=>s.kind==='storage-reference-graph'),records=raw?.nodes.filter(n=>n.kind==='record')??[],
   rawEdges=raw?.changes.flatMap(c=>c.upsertEdges)??[],arrays=trace.structures.filter(s=>s.kind==='array'),
   sources=trace.structures.filter(s=>s.kind==='pointer-tree-projection'&&s.mode!=='inverse-parent'||s.kind==='table-row-graph-candidate'||s.kind==='record-index-graph-candidate').map(sequenceSource),out=[],slotHistory=new Map(),writesByObject=new Map();
 for(const e of events)if(e.kind==='WRITE'&&e.target?.objectId){const rows=writesByObject.get(e.target.objectId)??[];rows.push(e);writesByObject.set(e.target.objectId,rows);}
 // Bind a label to the observed slot at the access time, not the first
 // historical spelling of its field role (which may lack an array index).
 for(const change of raw?.changes??[])for(const edge of change.upsertEdges){const id=key(edge.source);
   if(!slotHistory.has(id))slotHistory.set(id,[]);
   slotHistory.get(id).push({edge,at:pos.get(change.afterExecutionId),executionId:change.afterExecutionId});}
 const seenAt=(id,at)=>pos.has(id)&&pos.get(id)<=at,
   stateAt=(s,at)=>structureStateAt(s,pos,at,trace.objects),
   scalarField=r=>{const n=unwrap(defs.get(r?.instructionId)?.expression),p=n?.targetPath?.at(-1),t=n?.children?.[0]?.cType,record=t?.pointee??t;
     return n?.kind==='MemberExpr'&&record?.kind==='record'&&p?.sizeBits>0?{nodeId:n.nodeId,fieldNodeId:n.fieldNodeId,family:record.recordTypeId,offset:p.offsetBits/8,size:p.sizeBits/8}:null;},
   inputProof=(r,kind,extra={})=>{const progress=advance(r);return progress?{kind,inputReadExecutionId:r.eventId,...progress,...extra,afterExecutionId:after([r.eventId,progress.advanceExecutionId,...extra.evidenceExecutionIds??[]])}:null;};
 for(const source of sources){
   const recordIndexed=source.kind==='record-index-graph-candidate',indexed=source.kind==='table-row-graph-candidate',
     family=recordIndexed?arrays.find(a=>a.id===source.containerId)?.elementType?.recordTypeId:
       indexed?null:records.find(n=>source.states.some(s=>s.nodes.some(x=>x.id===n.id)))?.cType.recordTypeId,
     sourceNodes=new Map(source.states.flatMap(s=>s.nodes).map(n=>[n.id,n])),proofs=[],terminalProofs=[];
   if(!sourceNodes.size)continue;
   const nodeFor=r=>[...sourceNodes.values()].find(n=>contains(n.range,r)),array=indexed?arrays.find(a=>key(a.range)===key(source.range)):null;
   const indexedObservation=e=>{
     const at=pos.get(e.eventId),matches=edge=>key(edge.source)===key(e.target)&&edge.toIndex===num(e.value);
     const current=stateAt(source,at),edge=current?.edges.find(matches);
     if(edge)return {edge,executionId:current.afterExecutionId};
     // A destination record may be discovered by the subsequent dereference.
     // Delay this evidence until then, and reject any intervening slot write.
     const overwrite=(writesByObject.get(e.target.objectId)??[]).find(w=>pos.get(w.eventId)>at&&
       w.target.offset<e.target.offset+e.target.size&&e.target.offset<w.target.offset+w.target.size),
       until=pos.get(overwrite?.eventId)??Infinity;
     for(const state of source.states){
       const end=pos.get(state.afterExecutionId);if(end<=at)continue;
       if(end>=until)return null;
       const found=state.edges.find(matches);if(found)return {edge:found,executionId:state.afterExecutionId};
     }
     return null;
   };
   // An observed symbol supplies a child slot's address. Preserve the actual
   // symbol -> slot transform; no alphabet, field name or radix is hardcoded.
   for(const e of events)if(['READ','WRITE'].includes(e.kind)&&e.target?.objectId){
     const symbolInputs=deps(e.addressInputs).filter(isInput);if(!symbolInputs.length)continue;
     const observed=recordIndexed?indexedObservation(e):
         indexed?null:slotHistory.get(key(e.target))?.findLast(x=>x.at<=pos.get(e.eventId)),edge=observed?.edge,
       column=indexed&&array&&contains(array.range,e.target)?((e.target.offset-array.range.offset)%array.elementBytes)/e.target.size:null;
     if(indexed?!Number.isSafeInteger(column):!edge||!source.roleIds.includes(canon(edge.roleId))||source.mode!=='sparse-children')continue;
     for(const input of symbolInputs){
       const p=inputProof(input,'indexed-symbol',{accessExecutionId:e.eventId,roleId:indexed?`${array.id}:column:${column}`:edge.roleId,
         ...indexed?{}:{storedEdgeId:edge.id,slotRange:{objectId:e.target.objectId,offset:e.target.offset,size:e.target.size},targetNodeId:edge.to,
           slotObservationExecutionId:observed.executionId},
         labelUnits:[num(input.value)],evidenceExecutionIds:uniq([e.eventId,...observed?[observed.executionId]:[]])});if(p)proofs.push(p);
     }
   }
   // Equality inside a sibling scan selects a child by a stored symbol.
   if(source.mode==='first-child-next-sibling')for(const e of events)if(e.kind==='CALC')for(const step of e.steps??[]){
     if(!['==','!='].includes(step.operator)||step.inputs?.length!==2)continue;
     for(let i=0;i<2;i++){const stored=flow.sourceReadOperand(step.inputs[i],e,step),input=flow.sourceReadOperand(step.inputs[1-i],e,step),field=scalarField(stored);
       if(!field||field.family!==family||!isInput(input))continue;
       const p=inputProof(input,'compared-symbol',{storedReadExecutionId:stored.eventId,comparisonExecutionId:e.eventId,comparisonNodeId:step.nodeId,
         field,evidenceExecutionIds:[stored.eventId,e.eventId]});if(p)proofs.push(p);
     }
   }
   // Standard byte-comparison contracts, corroborated by an actual pointer
   // advance and a child transition controlled by that call's result.
   if(source.mode==='owned-edge-records')for(const call of events)if(call.action==='call'&&defs.get(call.instructionId)?.external&&['@strncmp','@memcmp'].includes(call.callee)){
     const resume=events.find(e=>e.action==='resume'&&e.callExecutionId===call.eventId);if(!resume||num(resume.value)!==0)continue;
     const count=num(call.arguments?.[2]);if(count>maxLabelUnits)trace.inferenceBudget?.report('label-units',maxLabelUnits,call.eventId);if(!(count>0&&count<=maxLabelUnits))continue;
     for(let i=0;i<2;i++){
       const labelRead=flow.reads(call.inputs?.find(p=>p.parameterIndex===i)?.executionId).find(r=>scalarField(r)),
         input=byId.get(call.inputs?.find(p=>p.parameterIndex===1-i)?.executionId),field=scalarField(labelRead);
       if(!labelRead||!input?.value?.reference||!field)continue;
       const edgeRange={objectId:labelRead.target.objectId,offset:labelRead.target.offset-field.offset,size:unwrap(defs.get(labelRead.instructionId)?.expression)?.children[0]?.cType?.sizeBits/8},
         progress=advance(input,count);if(!progress)continue;
       const access=events.find(e=>e.kind==='READ'&&e.activationId===call.activationId&&pos.get(e.eventId)>pos.get(resume.eventId)&&contains(edgeRange,e.target)&&e.value?.cType?.pointee?.recordTypeId===family&&
         (e.controlInputs??[]).some(id=>depends(id,resume.eventId)));
       if(!access)continue;const edge=rawEdges.find(e=>key(e.source)===key(access.target));if(!edge||!source.roleIds.includes(canon(edge.roleId)))continue;
       const lengthRead=call.inputs?.find(p=>p.parameterIndex===2)?.executionId,
         lengthCall=events.find(e=>e.action==='resume'&&byId.get(e.callExecutionId)?.callee==='@strlen'&&depends(lengthRead,e.eventId)&&
           flow.reads(byId.get(e.callExecutionId).inputs?.[0]?.executionId).some(r=>r.eventId===labelRead.eventId));
       proofs.push({kind:'compared-segment',callExecutionId:call.eventId,resumeExecutionId:resume.eventId,inputReadExecutionId:input.eventId,labelReadExecutionId:labelRead.eventId,
         accessExecutionId:access.eventId,roleId:canon(edge.roleId),labelDelta:labelRead.target.offset-access.target.offset,labelPointerBytes:labelRead.target.size,
         lengthMode:lengthCall?'nul-terminated':'observed-length',observedLength:count,sourceRange:access.target,...progress,
         evidenceExecutionIds:[call.eventId,resume.eventId,input.eventId,labelRead.eventId,access.eventId,...lengthCall?[lengthCall.eventId]:[]],
         afterExecutionId:after([access.eventId,progress.advanceExecutionId])});
     }
   }
   if(!proofs.length)continue;
   // Return a node property after the input-controlled loop has ended. This
   // establishes a terminal marker candidate, distinct from reaching a node.
   for(const ret of events)if(ret.action==='return.value'){
     const exits=loopExits(ret);
     for(const exit of exits){const input=deps(exit.dataInputs).find(r=>isInput(r)&&num(r.value)===0);if(!input||!proofs.some(p=>byId.get(p.inputReadExecutionId).activationId===ret.activationId&&
       (byId.get(p.inputReadExecutionId).target?.objectId===input.target.objectId||byId.get(p.inputReadExecutionId).value?.reference?.targetObjectId===input.target.objectId)))continue;
       for(const read of (ret.dataInputs??[]).flatMap(id=>flow.reads(id))){if(read.kind!=='READ'||num(read.value)===null||read.value?.cType?.kind==='pointer')continue;
         let role=null,node=null;const field=scalarField(read);
         if(!indexed&&field&&(field.family===family||recordIndexed)){node=nodeFor(read.target);if(node)role={kind:'record',...field};}
         if(indexed){const a=arrays.find(a=>a.elementType?.kind!=='array'&&a.elementType?.kind!=='record'&&contains(a.range,read.target)),
           linked=(read.addressInputs??[]).flatMap(id=>flow.reads(id)).find(r=>contains(source.range,r.target)&&num(r.value)!==null);
           if(a&&linked){const index=(read.target.offset-a.range.offset)/a.elementBytes;node=[...sourceNodes.values()].find(n=>n.index===index&&index===num(linked.value));
             if(node)role={kind:'array',arrayId:a.id,range:a.range,elementBytes:a.elementBytes,indexReadExecutionId:linked.eventId};}
         }
         if(role)terminalProofs.push({role,nodeId:node.id,readExecutionId:read.eventId,returnExecutionId:ret.eventId,exitExecutionId:exit.eventId,inputEndReadExecutionId:input.eventId,afterExecutionId:ret.eventId});
       }
     }
   }
   const states=[],coverage={...stateHistoryCoverage(maxStates),maxLabelUnits},changed=new Set([...source.states.map(s=>s.afterExecutionId),...proofs.map(p=>p.afterExecutionId),...terminalProofs.map(p=>p.afterExecutionId),
     ...events.filter(e=>['WRITE','SPACE'].includes(e.kind)).map(e=>e.eventId)]),stored=new Map();let rawCursor=0;
   const discovered=proofs.map(p=>p.afterExecutionId).sort((a,b)=>pos.get(a)-pos.get(b))[0];
   for(const event of events){const at=pos.get(event.eventId);if(at<pos.get(discovered)||!changed.has(event.eventId))continue;
     while(rawCursor<(raw?.changes.length??0)&&pos.get(raw.changes[rawCursor].afterExecutionId)<=at){for(const e of raw.changes[rawCursor++].upsertEdges)stored.set(e.id,e);}
     const base=stateAt(source,at);if(!base)continue;const known=proofs.filter(p=>seenAt(p.afterExecutionId,at)),roles=terminalProofs.filter(p=>seenAt(p.afterExecutionId,at)),
       edges=base.edges.filter(e=>e.to).map(e=>{const labels=[];
         for(const p of known){let units=null,ranges=[],ids=[p.afterExecutionId,...p.evidenceExecutionIds??[],p.inputReadExecutionId,p.advanceExecutionId];
           if(p.kind==='indexed-symbol'&&(indexed?p.roleId.endsWith(`:column:${e.column}`):
             key(p.slotRange)===key(e.source)&&(e.storedEdgeIds??[e.id]).includes(p.storedEdgeId)&&p.targetNodeId===e.to&&canon(p.roleId)===canon(e.roleId)))units=p.labelUnits;
           if(p.kind==='compared-symbol'){const target=base.nodes.find(n=>n.id===e.to),range={objectId:target.range.objectId,offset:target.range.offset+p.field.offset,size:p.field.size},v=scalar(range,at);
             if(v?.value!==null&&v?.value!==undefined){units=[v.value];ranges=[range];ids.push(v.eventId);}}
           if(p.kind==='compared-segment'&&p.roleId===canon(e.roleId)){
             const physical=stored.get(e.storedEdgeIds?.at(-1)),labelRange=physical&&{objectId:physical.source.objectId,offset:physical.source.offset+p.labelDelta,size:p.labelPointerBytes},
               pointer=labelRange&&[...stored.values()].find(e=>key(e.source)===key(labelRange)),ref=pointer?.reference;
             if(ref?.status==='in-bounds'){const values=[],bound=p.lengthMode==='nul-terminated'?maxLabelUnits:p.observedLength;let complete=p.lengthMode!=='nul-terminated';
               for(let i=0;i<bound;i++){const range={objectId:ref.targetObjectId,offset:ref.targetOffset+i,size:1},v=scalar(range,at,false);if(v?.value===undefined||v.value===null){complete=false;break;}
                 ids.push(v.eventId);if(p.lengthMode==='nul-terminated'&&v.value===0){complete=true;break;}values.push(v.value);ranges.push(range);}
               if(!complete&&values.length===bound)trace.inferenceBudget?.report('label-units',maxLabelUnits,event.eventId);
               if(complete&&values.length){units=values;ids.push(pointer.lastObservationExecutionId);}}
           }
           if(units?.length&&!labels.some(l=>JSON.stringify(l.units)===JSON.stringify(units)))labels.push({units,text:units.every(n=>n>=32&&n<127)?String.fromCharCode(...units):null,
             proofKind:p.kind,evidenceExecutionIds:uniq(ids.filter(Boolean)),ranges});
         }
         return {...e,id:e.id??`${source.id}:${e.from}:${e.roleId}:${e.to}`,labels};
       }),nodes=base.nodes.map(n=>{const markers=[];for(const p of roles){const range=p.role.kind==='record'?{objectId:n.range.objectId,offset:n.range.offset+p.role.offset,size:p.role.size}:
           Number.isSafeInteger(n.index)?{objectId:p.role.range.objectId,offset:p.role.range.offset+n.index*p.role.elementBytes,size:p.role.elementBytes}:null;
         if(!range||markers.some(m=>key(m.range)===key(range)))continue;const v=scalar(range,at);markers.push({range,value:v?.value??null,accepted:v?.value===null||v?.value===undefined?null:v.value!==0,
           evidenceExecutionIds:[p.readExecutionId,p.returnExecutionId,p.exitExecutionId,...v?[v.eventId]:[]]});}
         return {...n,range:{...n.range},terminalMarkers:markers};}),conditions=sequenceConditions(base,edges,roles),alive=base.alive!==false,
       snapshot={afterExecutionId:event.eventId,alive,nodes,edges,topology:base.topology,conditions,terminalRoles:roles,
         scopeRanges:[...nodes.map(n=>n.range),...nodes.flatMap(n=>n.terminalMarkers.map(m=>m.range))],
         evidenceExecutionIds:uniq([...known.map(p=>p.afterExecutionId),...roles.map(p=>p.afterExecutionId)]),status:'partial'};
     if(base.historyGap)snapshot.historyGap=true;
     appendStateSnapshot(states,snapshot,coverage);
   }
   out.push({id:`sequence:${source.id}`,kind:'sequence-lookup-candidate',origin:'inferred',intent:'unconfirmed',sourceStructureId:source.id,root:source.root??null,
     roleIds:source.roleIds??[],discoveredAtExecutionId:discovered,queryScoped:true,nodes:[],edges:[],states,selectionEvidence:proofs,terminalEvidence:terminalProofs,
     coverage,limitations:['observed symbol consumption and end-marker role; unvisited transitions and intended language remain unproven']});
 }
 return out;
}
export function querySequenceLookup(trace,{candidateId,afterExecutionId}={}){
 const s=trace.structures?.find(s=>s.id===candidateId&&s.kind==='sequence-lookup-candidate');if(!s)return null;
 const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?trace.events.length-1:pos.get(afterExecutionId);
 if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');if(pos.get(s.discoveredAtExecutionId)>at)return null;
 const state=structureStateAt(s,pos,at,trace.objects);
 return structuredClone({candidateId:s.id,intent:s.intent,sourceStructureId:s.sourceStructureId,state,historyGap:!!state?.historyGap||stateHistoryGapAt(s,pos,at)});
}
