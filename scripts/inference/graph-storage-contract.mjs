// Validate supplementary observations independently of the original comparison proofs.
import {graphProofId} from './graph-proof-identity.mjs';
const number=v=>Number(v?.decimal??v?.unsigned??v?.signed);
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
export function validateGraphStorage(trace,s){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    roles=new Map((s.storageRoles??[]).map(r=>[r.id,r])),work=new Map((trace.structures.find(x=>x.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a])),
    array=trace.structures.find(a=>a.id===s.arrayId),proofs=new Map();
  const require=(condition,message)=>{if(!condition)throw new Error(`자료구조 후보: ${message}`);};
  for(const p of s.storageEvidence??[]){
    const role=roles.get(p.roleId),parents=s.evidence.filter(e=>graphProofId(e)===p.learnedProofId),parent=parents[0],at=pos.get(p.executionId),source=events.get(p.sourceReadExecutionId),cursor=events.get(p.fromReadExecutionId);
    require(role&&parents.length===1&&p.learnedProofId===role.learnedProofId&&parent.executionId===p.learnedFrom&&p.learnedFrom===role.learnedFrom&&pos.get(p.learnedFrom)<=at,'저장소 역할의 선행 관측이 없습니다.');
    const learnedSource=events.get(role.matrix?parent.properties[0]?.readExecutionId:parent.indexSourceReadExecutionId);
    require(learnedSource?.instructionId===role.sourceSite&&role.properties.length===parent.properties.length&&
      role.properties.every((r,i)=>r.site===events.get(parent.properties[i].readExecutionId)?.instructionId),'재사용 역할과 최초 읽기의 연결이 다릅니다.');
    require(source?.kind==='READ'&&source.instructionId===role.sourceSite,'저장소 역할의 실제 읽기가 다릅니다.');
    require(p.evidenceExecutionIds.includes(p.sourceReadExecutionId)&&p.evidenceExecutionIds.every(id=>events.has(id)&&pos.get(id)<=at),'저장소 관계의 실행 시점이 다릅니다.');
    require([p.fromIndex,p.toIndex].every(i=>Number.isInteger(i)&&i>=0&&i<array.capacity),'저장소 관계의 정점 범위가 다릅니다.');
    if(role.matrix){const coords=work.get(source.eventId)?.target.coordinates;
      require(coords?.[0]===p.fromIndex&&coords?.[1]===p.toIndex,'행렬 관계의 관측 좌표가 다릅니다.');
    }else require(['READ','WRITE'].includes(cursor?.kind)&&number(cursor.value)===p.fromIndex&&number(source.value)===p.toIndex&&p.evidenceExecutionIds.includes(cursor.eventId),'정점 식별자의 값 전달 근거가 다릅니다.');
    require(p.sourceSlots.length===p.sourceReads.length&&p.sourceReads.every((r,i)=>events.get(r.executionId)?.kind==='READ'&&same(events.get(r.executionId).target,r.source)&&same(p.sourceSlots[i],r.source)),'연결 슬롯의 실제 읽기가 다릅니다.');
    require(p.properties.length===role.properties.length&&p.properties.every((r,i)=>{
      const e=events.get(r.readExecutionId),binding=role.properties[i];
      return e?.kind==='READ'&&e.instructionId===binding.site&&same(e.target,r.source)&&JSON.stringify(e.value)===JSON.stringify(r.value)&&p.evidenceExecutionIds.includes(e.eventId)&&
        (binding.delta!==null?e.target.objectId===source.target.objectId&&e.target.offset-source.target.offset===binding.delta:
          e.target.objectId===binding.objectId&&work.get(e.eventId)?.target.index===work.get(source.eventId)?.target.index);
    }),'간선 속성의 저장 범위 또는 값이 다릅니다.');
    for(const id of p.evidenceExecutionIds){const r=events.get(id);if(r?.target)
      require(!trace.events.slice(pos.get(id)+1,at+1).some(e=>e.kind==='WRITE'&&overlap(r.target,e.target)),'관계 확인 전에 읽은 값이 변경됐습니다.');}
    proofs.set(`${p.edgeIdentity}|${p.executionId}`,p);
  }
  for(const state of s.states){const at=pos.get(state.afterExecutionId);
    const members=new Set(state.edges.flatMap(e=>[e.fromIndex,e.toIndex])),nodes=new Map(state.nodes.map(n=>[n.id,n]));
    for(const id of state.membership?.evidenceExecutionIds??[]){const a=work.get(id),event=events.get(id);
      require(a?.target.arrayId===array.id&&a.target.elementOffset===0&&a.target.size===array.elementBytes&&a.axes?.length&&pos.get(id)<=at&&['READ','WRITE'].includes(event?.kind),'정점 구성원에 실제 인덱스 접근 근거가 없습니다.');
      members.add(a.target.index);
    }
    for(const n of state.nodes)require(members.has(n.index)&&same(n.range,{objectId:array.objectId,offset:array.range.offset+n.index*array.elementBytes,size:array.elementBytes}),'정점 식별자와 관측 저장 범위가 다릅니다.');
    for(const e of state.edges){if(e.basis==='learned-storage-role'){
      const p=proofs.get(`${e.edgeIdentity}|${e.executionId}`);
      require(p&&p.fromIndex===e.fromIndex&&p.toIndex===e.toIndex&&JSON.stringify(p.sourceSlots)===JSON.stringify(e.sourceSlots),'간선과 저장소 역할 근거가 다릅니다.');
    }
    require(nodes.get(e.from)?.index===e.fromIndex&&nodes.get(e.to)?.index===e.toIndex,'간선의 정점 식별자가 다릅니다.');
    if(e.status==='absent'){
      const p=e.absence,r=roles.get(p?.roleId),branch=events.get(p?.executionId),read=events.get(p?.rowReadExecutionId??p?.readExecutionId);
      require(r&&s.absenceEvidence.some(x=>JSON.stringify(x)===JSON.stringify(p))&&branch?.action==='branch'&&read?.kind==='READ'&&pos.get(read.eventId)<pos.get(branch.eventId)&&pos.get(branch.eventId)<=at&&read.activationId===branch.activationId,'관계 부재의 실제 순회 근거가 없습니다.');
      if(p.kind==='completed-row')require(r.completionSafe&&branch.instructionId===r.loopSite&&number(branch.condition)===0&&r.rowSites.includes(read.instructionId)&&work.get(read.eventId)?.target.index===e.fromIndex,'행 순회 종료 근거가 다릅니다.');
      else {const a=work.get(read.eventId);require(p.kind==='observed-absence-branch'&&r.gate?.site===branch.instructionId&&(number(branch.condition)!==0)!==r.gate.truth&&a?.target.coordinates?.[0]===e.fromIndex&&a.target.coordinates?.[1]===e.toIndex,'행렬 부재 분기 근거가 다릅니다.');}
    }}
  }
  for(const a of s.relationRole?.associations??[]){
    const g=trace.structures.find(g=>g.id===a.structureId),write=events.get(a.stateAccessExecutionId);
    require(['conditional-vertex-state','vertex-state-observations'].includes(s.relationRole.kind)&&write?.kind==='WRITE'&&
      ['index-domain-graph-candidate','observed-traversal-graph-candidate'].includes(g?.kind)&&g.arrayId!==s.arrayId&&
      s.evidence.some(p=>p.sourceReadExecutionId===a.sourceReadExecutionId&&p.targetAccessExecutionId===write.eventId)&&
      g.evidence.some(p=>(p.indexSourceReadExecutionId??p.sourceReadExecutionId)===a.sourceReadExecutionId&&events.get(p.targetAccessExecutionId)?.kind==='READ')&&a.evidenceExecutionIds.every(id=>events.has(id)),
    '상태 배열과 정점 관계의 공통 출처가 없습니다.');
  }
}
