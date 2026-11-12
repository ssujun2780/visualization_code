import {check,snapshotOf,complete} from './common.mjs';
import {transform,bitPreservingCast} from './provenance.mjs';

const keys=new Set(['schemaVersion','scope','snapshot','status','capabilities','relations','changes','provenance','coverage','diagnostics']);
export function failure(scope,error,status='failed'){return {schemaVersion:2,scope,snapshot:null,status,capabilities:{},relations:[],changes:[],provenance:{nodes:[],edges:[]},coverage:{},diagnostics:[{code:error.code??'execution-relations-failed',stage:'execution-relations',message:error.message??String(error)}]};}
export function validateV2(c,result,{verifyOptional=false}={}){
  check(result?.schemaVersion===2&&Object.keys(result).every(k=>keys.has(k)),'알 수 없는 실행 관계 v2 형식입니다.');
  check(['completed','partial','failed','skipped','not-implemented'].includes(result.status),'잘못된 분석 상태입니다.');
  check(result.scope?.programId===c.scope.programId&&result.scope?.runId===c.scope.runId,'다른 실행의 관계입니다.');
  if(result.snapshot===null&&['failed','skipped'].includes(result.status)){
    check(Array.isArray(result.relations)&&!result.relations.length&&Array.isArray(result.changes)&&!result.changes.length&&Array.isArray(result.provenance?.nodes)&&!result.provenance.nodes.length&&Array.isArray(result.provenance?.edges)&&!result.provenance.edges.length&&Array.isArray(result.diagnostics),'스냅샷 없는 실패 결과에 관계를 넣을 수 없습니다.');return result;
  }
  const expected=snapshotOf(c);check(result.snapshot?.inputDigests?.plan===expected.inputDigests.plan&&result.snapshot?.inputDigests?.trace===expected.inputDigests.trace,'분석 스냅샷과 실행 기록 내용이 다릅니다.');
  if(verifyOptional)for(const key of ['compilerFacts','structureInference','observationEvidence'])check(result.snapshot.inputDigests[key]===expected.inputDigests[key],'보조 근거 스냅샷이 다릅니다.');
  check(result.snapshot.eventCount===c.trace.events.length&&result.snapshot.lastExecutionId===(c.trace.events.at(-1)?.eventId??null),'분석 스냅샷 범위가 다릅니다.');
  check(Array.isArray(result.relations)&&Array.isArray(result.changes)&&Array.isArray(result.diagnostics)&&Array.isArray(result.provenance?.nodes)&&Array.isArray(result.provenance?.edges),'관계/출처 목록이 없습니다.');
  const relations=new Map(),nodes=new Map();
  const validRange=(p,at)=>{const o=c.object(p.objectId);check(o&&p.createdBy===o.createdBy&&c.position(o.createdBy)!==undefined&&c.position(o.createdBy)<=at,'미래/잘못된 할당 세대입니다.');
    check(Number.isSafeInteger(p.offset)&&p.offset>=0&&Number.isSafeInteger(p.size)&&p.size>0&&Number.isSafeInteger(p.offset+p.size)&&p.offset+p.size<=o.size,'저장 범위가 객체를 벗어났습니다.');};
  function participant(p,at){check(p&&typeof p.role==='string','참여 역할이 없습니다.');
    if(p.kind==='storage')validRange(p,at);
    else if(p.kind==='region-set'){
      const o=c.object(p.objectId);check(o&&o.createdBy===p.createdBy&&c.position(o.createdBy)<=at&&Array.isArray(p.ranges),'영역 저장소가 잘못되었습니다.');
      for(const r of p.ranges)validRange({...p,...r},at);
      if(p.pattern){const v=p.pattern;check(/^\d+$/.test(v.count)&&/^\d+$/.test(v.strideBytes)&&Number.isSafeInteger(v.offset)&&v.offset>=0&&Number.isSafeInteger(v.size)&&v.size>0,'잘못된 아핀 영역입니다.');
        const count=BigInt(v.count),end=BigInt(v.offset)+(count?count-1n:0n)*BigInt(v.strideBytes)+(count?BigInt(v.size):0n);check(end<=BigInt(o.size),'아핀 영역이 객체를 벗어났습니다.');}
    }else if(p.kind==='activation')check(c.frame(p.activationId),'호출 대상이 없습니다.');
    else if(p.kind==='port')check(c.position(p.executionId)!==undefined&&c.position(p.executionId)<=at,'포트 사건이 없습니다.');
    else if(p.kind==='structure-element')check(typeof p.structureId==='string'&&typeof p.elementId==='string'&&c.position(p.bindingExecutionId)!==undefined&&c.position(p.bindingExecutionId)<=at,'구조 요소 대응 시점이 없습니다.');
    else if(p.kind==='value')check(c.position(p.executionId)!==undefined&&c.position(p.executionId)<=at,'값 관찰이 없습니다.');
    else check(false,'지원하지 않는 참여 대상입니다.');
  }
  for(const r of result.relations){const at=c.position(r.availableAtExecutionId);
    check(r&&typeof r.id==='string'&&!relations.has(r.id)&&typeof r.kind==='string'&&at!==undefined,'관계 식별자/성립 시점이 잘못되었습니다.');relations.set(r.id,r);
    check(['supported','ambiguous','insufficient','contradicted'].includes(r.status)&&Array.isArray(r.activationIds)&&r.activationIds.every(id=>c.frame(id))&&Array.isArray(r.participants),'관계 상태/호출/대상이 잘못되었습니다.');
    check(Array.isArray(r.evidence?.executionIds)&&Array.isArray(r.evidence.planNodeIds)&&Array.isArray(r.evidence.relationIds),'관계 근거 목록이 없습니다.');
    for(const id of r.evidence.executionIds)check(c.position(id)!==undefined&&c.position(id)<=at,'미래/없는 관찰을 근거로 사용할 수 없습니다.');
    for(const id of r.evidence.planNodeIds)check(c.instructionNodes.has(id),'컴파일 근거 노드가 없습니다.');
    check(r.status==='insufficient'||r.evidence.executionIds.length>0,'관찰 근거가 없습니다.');
    for(const p of r.participants)participant(p,at);
    if(r.kind==='storage-access'){const e=c.event(r.availableAtExecutionId);check(complete(e)&&['READ','WRITE'].includes(e.kind)||complete(e)&&['readRegions','libraryReadRegions','streamReadRegions'].includes(r.details.evidenceKind),'실제 접근 효과가 없습니다.');}
    if(r.kind==='storage-copy'){const e=c.event(r.details.writeExecutionId),d=r.participants.find(p=>p.role==='destination'),s=r.participants.find(p=>p.role==='source');
      check(complete(e)&&e.kind==='WRITE'&&e.target?.objectId===d?.objectId&&e.target?.offset===d?.offset&&e.target?.size===d?.size&&s?.size===d?.size,'복사의 실제 쓰기 연결이 다릅니다.');}
  }
  for(const r of relations.values())for(const id of r.evidence.relationIds){const prior=relations.get(id);check(prior&&prior!==r&&c.position(prior.availableAtExecutionId)<=c.position(r.availableAtExecutionId),'선행 관계가 없거나 미래입니다.');}
  const scopes=new Map(result.relations.filter(r=>r.kind==='work-scope').map(r=>[r.details.id,r]));
  for(const r of relations.values()){check(Array.isArray(r.workScopeIds),'작업 문맥 목록이 없습니다.');for(const id of r.workScopeIds){const scope=scopes.get(id);check(scope&&c.position(scope.availableAtExecutionId)<=c.position(r.availableAtExecutionId),'작업 문맥이 없거나 미래입니다.');}}
  for(const n of result.provenance.nodes){check(n&&typeof n.id==='string'&&!nodes.has(n.id)&&c.event(n.executionId)&&complete(c.event(n.executionId))&&Number.isInteger(n.order)&&Array.isArray(n.unresolved),'출처 관찰 노드가 잘못되었습니다.');
    check(!('value'in n)&&!('bytes'in n)&&!('address'in n),'출처에 메모리 값을 복제할 수 없습니다.');
    const e=c.event(n.executionId);
    if(n.inputRef){const ref=n.inputRef,inputs=ref.stepOrder===null?e.inputs:e.steps?.[ref.stepOrder]?.inputs,input=inputs?.[ref.inputIndex];
      check(ref.executionId===e.eventId&&ref.instructionId===e.instructionId&&input?.value!==undefined&&!input.executionId&&!input.observationId&&n.order===-1,'즉시/포착 입력의 실제 근거가 없습니다.');
      check(n.transform===(input.value.literal!==undefined||input.kind==='immediate'?'literal':'captured-input'),'입력 출처 종류가 실제 관찰과 다릅니다.');
    }else if(n.observationIds){const step=e.steps?.[n.order];check(step&&n.sourceNodeId===(step.nodeId??null)&&n.transform===transform(c,e,step),'내부 계산 출처가 다릅니다.');}
    else check(n.id===`v:${e.eventId}`&&n.order===(e.steps?.length??0)+1&&n.transform===transform(c,e),'값 관찰의 종류가 실제 명령과 다릅니다.');
    for(const id of n.observationIds??[])check(c.observationOwners.get(id)?.some(o=>o.event.eventId===n.executionId&&o.step===e.steps[n.order]),'내부 관찰의 사건 대응이 다릅니다.');nodes.set(n.id,n);}
  const edgeIds=new Set(),incoming=new Map(),internalParents=new Map();for(const edge of result.provenance.edges){const a=nodes.get(edge.from),b=nodes.get(edge.to);
    check(a&&b&&typeof edge.id==='string'&&!edgeIds.has(edge.id)&&['value','address','control','callee'].includes(edge.role),'출처 간선이 잘못되었습니다.');edgeIds.add(edge.id);
    check(c.position(a.executionId)<c.position(b.executionId)||a.executionId===b.executionId&&a.order<b.order,'출처가 미래이거나 순환입니다.');
    if(edge.range)validRange({...edge.range,createdBy:c.object(edge.range.objectId)?.createdBy},c.position(b.executionId));
    if(edge.role==='value'){const list=incoming.get(edge.to)??new Set();list.add(edge.from);incoming.set(edge.to,list);
      if(edge.path==='internal-result'){const internal=internalParents.get(edge.to)??new Set();internal.add(edge.from);internalParents.set(edge.to,internal);}}}
  const active=new Set();for(const change of result.changes){const r=relations.get(change.relationId),at=c.position(change.atExecutionId);
    check(r&&at!==undefined&&at>=c.position(r.availableAtExecutionId)&&['activate','invalidate','close'].includes(change.action),'관계 상태 변경이 잘못되었습니다.');
    if(change.action==='activate'){check(!active.has(r.id),'이미 활성인 관계입니다.');active.add(r.id);}else{check(active.has(r.id),'활성화되지 않은 관계를 종료할 수 없습니다.');active.delete(r.id);}}
  for(const r of relations.values())if(r.details?.provenanceId)check(nodes.has(r.details.provenanceId),'관계의 출처 노드가 없습니다.');
  for(const r of relations.values())if(r.kind==='storage-copy'){
    const write=c.event(r.details.writeExecutionId),source=r.participants.find(p=>p.role==='source');
    if(r.details.mechanism==='recorded-range-copy')check(write.action==='copy'&&source.objectId===write.sourceObjectId&&source.offset===write.sourceOffset&&source.size===write.sourceSize,'범위 복사의 실제 원본이 다릅니다.');
    else{const read=c.event(r.details.readExecutionId);check(read?.kind==='READ'&&read.action==='read'&&complete(read)&&read.target?.objectId===source.objectId&&read.target.offset===source.offset&&read.target.size===source.size&&c.position(read.eventId)<c.position(write.eventId),'복사의 원본 읽기 관찰이 다릅니다.');
      let node=nodes.get(`v:${write.eventId}`),seen=new Set();while(node&&node.executionId!==read.eventId&&!seen.has(node.id)){
        seen.add(node.id);check(['identity','argument','return','cast'].includes(node.transform),'계산/변환을 복사로 간주할 수 없습니다.');
        if(node.transform==='cast'){const steps=c.event(node.executionId).steps??[];check(steps.length&&steps.every(bitPreservingCast),'비트 보존 변환 근거가 없습니다.');}
        const from=[...internalParents.get(node.id)??incoming.get(node.id)??[]];check(from.length===1,'복사의 단일 값 생산자가 없습니다.');node=nodes.get(from[0]);}
      check(node?.executionId===read.eventId,'복사의 출처 경로가 실제 읽기로 이어지지 않습니다.');}
  }
  return result;
}
