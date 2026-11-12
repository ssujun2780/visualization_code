import {sequenceEvidence,unwrap,key,contains,num} from './sequence-evidence.mjs';
import {sequenceConditions} from './sequence-conditions.mjs';
import {validateStateHistory} from './state-history.mjs';
export function validateSequenceLookups(plan,trace){
 const candidates=trace.structures.filter(s=>s.kind==='sequence-lookup-candidate');if(!candidates.length)return;
 const historyPositions=new Map(trace.events.map((e,i)=>[e.eventId,i]));
 for(const candidate of candidates)validateStateHistory(candidate,historyPositions);
 const {byId,pos,defs,flow,deps,isInput,advance,scalar,depends,loopExits}=sequenceEvidence(plan,trace),
   sources=new Map(trace.structures.map(s=>[s.id,s])),objects=new Map(trace.objects.map(o=>[o.id,o]));
 const need=(ok,why)=>{if(!ok)throw new Error(`문자열 경로 근거 불일치: ${why}`);},
   event=id=>{need(byId.has(id),'사건');return byId.get(id);},
   range=r=>{const o=objects.get(r?.objectId);need(o&&Number.isSafeInteger(r.offset)&&r.offset>=0&&r.size>0&&r.offset+r.size<=o.size,'저장 범위');},
   equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),stateAt=(s,at)=>s.states.findLast(s=>pos.get(s.afterExecutionId)<=at);
 for(const s of candidates){const source=sources.get(s.sourceStructureId);need(source&&s.intent==='unconfirmed','원본 관계와 의도');
   event(s.discoveredAtExecutionId);
   for(const p of s.selectionEvidence){const input=event(p.inputReadExecutionId),a=advance(input,p.kind==='compared-segment'?p.observedLength:null);
     need(a&&a.cursorReadExecutionId===p.cursorReadExecutionId&&a.advanceExecutionId===p.advanceExecutionId&&a.bytes===p.bytes,'입력 이동 출처');
     for(const id of [...p.evidenceExecutionIds??[],p.inputReadExecutionId,p.advanceExecutionId])need(pos.get(event(id).eventId)<=pos.get(p.afterExecutionId),'선택 근거 시점');
     if(p.kind==='indexed-symbol'){
       const access=event(p.accessExecutionId);need(isInput(input)&&deps(access.addressInputs).some(r=>r.eventId===input.eventId),'입력과 선택 주소');
       need(equal(p.labelUnits,[num(input.value)]),'선택 문자');
       if(source.kind==='table-row-graph-candidate'){
         const array=trace.structures.find(a=>a.kind==='array'&&key(a.range)===key(source.range)),column=((access.target.offset-array.range.offset)%array.elementBytes)/access.target.size;
         need(contains(array.range,access.target)&&p.roleId===`${array.id}:column:${column}`,'문자 열');
       }else {const raw=sources.get(source.sourceStructureId);let observed=null;
         for(const change of raw.changes){if(pos.get(change.afterExecutionId)>pos.get(access.eventId))break;
           for(const edge of change.upsertEdges)if(key(edge.source)===key(access.target))observed={edge,executionId:change.afterExecutionId};}
         need(observed&&observed.edge.roleId===p.roleId&&observed.edge.id===p.storedEdgeId&&observed.edge.to===p.targetNodeId&&
           observed.executionId===p.slotObservationExecutionId&&key(p.slotRange)===key(access.target),'포인터 선택 슬롯과 관측 시점');}
     }else if(p.kind==='compared-symbol'){
       const e=event(p.comparisonExecutionId),step=e.steps?.find(x=>x.nodeId===p.comparisonNodeId),stored=event(p.storedReadExecutionId),n=unwrap(defs.get(stored.instructionId)?.expression);
       need(isInput(input)&&['==','!='].includes(step?.operator),'문자 비교');
       const ids=step.inputs.map(i=>flow.sourceReadOperand(i,e,step)?.eventId);need(ids.includes(input.eventId)&&ids.includes(stored.eventId),'문자 비교 출처');
       need(n?.fieldNodeId===p.field.fieldNodeId&&n.targetPath.at(-1).offsetBits===p.field.offset*8&&n.targetPath.at(-1).sizeBits===p.field.size*8,'문자 필드');
     }else if(p.kind==='compared-segment'){
       const call=event(p.callExecutionId),resume=event(p.resumeExecutionId),label=event(p.labelReadExecutionId),access=event(p.accessExecutionId);
       need(defs.get(call.instructionId)?.external&&['@strncmp','@memcmp'].includes(call.callee)&&resume.callExecutionId===call.eventId&&num(resume.value)===0,'문자열 비교 호출');
       need(num(call.arguments[2])===p.observedLength&&p.bytes===p.observedLength,'문자열 길이와 이동');
       need(call.inputs.some(i=>i.executionId===input.eventId)&&call.inputs.some(i=>flow.reads(i.executionId).some(r=>r.eventId===label.eventId)),'문자열 인자 출처');
       need(p.labelDelta===label.target.offset-access.target.offset&&label.target.objectId===access.target.objectId&&p.labelPointerBytes===label.target.size,'간선 라벨 저장 위치');
       need(access.controlInputs.some(id=>depends(id,resume.eventId)),'비교 결과와 이동 분기');
       if(p.lengthMode==='nul-terminated')need(p.evidenceExecutionIds.some(id=>{const e=byId.get(id),c=byId.get(e.callExecutionId);return e?.action==='resume'&&c?.callee==='@strlen'&&
         flow.reads(c.inputs?.[0]?.executionId).some(r=>r.eventId===label.eventId); }),'문자열 길이 계약');
     }else need(false,'선택 근거 종류');
   }
   for(const p of s.terminalEvidence){const read=event(p.readExecutionId),ret=event(p.returnExecutionId),exit=event(p.exitExecutionId),input=event(p.inputEndReadExecutionId);
     need(ret.action==='return.value'&&loopExits(ret).includes(exit),'입력 종료 후 반환');
     need(isInput(input)&&num(input.value)===0&&deps(exit.dataInputs).some(r=>r.eventId===input.eventId)&&(ret.dataInputs??[]).flatMap(id=>flow.reads(id)).some(r=>r.eventId===read.eventId),'종료 입력/반환 출처');
     if(p.role.kind==='record'){const n=unwrap(defs.get(read.instructionId)?.expression);need(n?.fieldNodeId===p.role.fieldNodeId&&n.targetPath.at(-1).offsetBits===p.role.offset*8,'종료 필드');}
     else {const a=sources.get(p.role.arrayId),index=event(p.role.indexReadExecutionId);need(a?.kind==='array'&&key(a.range)===key(p.role.range)&&a.elementBytes===p.role.elementBytes&&
       contains(a.range,read.target)&&contains(source.range,index.target)&&(read.addressInputs??[]).flatMap(id=>flow.reads(id)).some(r=>r.eventId===index.eventId),'분리 종료 배열');}
   }
   for(const state of s.states){const at=pos.get(event(state.afterExecutionId).eventId),base=stateAt(source,at);need(base,'해당 시점의 원본');
     need(state.nodes.length===base.nodes.length&&state.nodes.every(n=>base.nodes.some(b=>b.id===n.id&&key(b.range)===key(n.range))),'구성원 식별자와 범위');
     const edges=base.edges.filter(e=>e.to);need(state.edges.length===edges.length&&state.edges.every(e=>edges.some(b=>b.from===e.from&&b.to===e.to&&b.roleId===e.roleId&&equal(b.storedEdgeIds,e.storedEdgeIds))),'관계 보존');
     for(const id of state.evidenceExecutionIds)need(pos.get(event(id).eventId)<=at,'미래 근거');
     for(const edge of state.edges)for(const l of edge.labels){
       for(const id of l.evidenceExecutionIds)need(pos.get(event(id).eventId)<=at,'미래 라벨');
       const p=s.selectionEvidence.find(p=>p.kind===l.proofKind&&[p.afterExecutionId,p.inputReadExecutionId,...p.evidenceExecutionIds??[]].every(id=>l.evidenceExecutionIds.includes(id))&&pos.get(p.afterExecutionId)<=at);need(p,'라벨 선택 근거');
       if(l.proofKind==='indexed-symbol')need(equal(l.units,p.labelUnits)&&(source.kind==='table-row-graph-candidate'?p.roleId.endsWith(`:column:${edge.column}`):
         key(p.slotRange)===key(edge.source)&&(edge.storedEdgeIds??[edge.id]).includes(p.storedEdgeId)&&p.targetNodeId===edge.to&&
         p.roleId.replace(/:slot:\d+$/,'')===edge.roleId.replace(/:slot:\d+$/,'')),'문자 라벨과 실제 선택 슬롯');
       else if(l.proofKind==='compared-symbol'){const n=state.nodes.find(n=>n.id===edge.to),r={objectId:n.range.objectId,offset:n.range.offset+p.field.offset,size:p.field.size};
         need(l.ranges.length===1&&key(l.ranges[0])===key(r)&&equal(l.units,[scalar(r,at)?.value]),'노드 문자 값');}
       else {need(l.ranges.length===l.units.length,'문자열 범위 길이');for(let i=0;i<l.ranges.length;i++){range(l.ranges[i]);need(scalar(l.ranges[i],at,false)?.value===l.units[i],'문자열 바이트');}}
     }
     for(const n of state.nodes)for(const m of n.terminalMarkers){range(m.range);need(m.value===(scalar(m.range,at)?.value??null)&&m.accepted===(m.value===null?null:m.value!==0),'단어 종료 값');
       need(state.terminalRoles.some(p=>pos.get(p.afterExecutionId)<=at&&key(m.range)===key(p.role.kind==='record'?{objectId:n.range.objectId,offset:n.range.offset+p.role.offset,size:p.role.size}:
         {objectId:p.role.range.objectId,offset:p.role.range.offset+n.index*p.role.elementBytes,size:p.role.elementBytes})),'단어 종료 역할');
       for(const id of m.evidenceExecutionIds)need(pos.get(event(id).eventId)<=at,'미래 단어 종료');
     }
     need(equal(state.conditions,sequenceConditions(base,state.edges,state.terminalRoles)),'의미 조건 조합');
   }
 }
}
