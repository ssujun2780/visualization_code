import {isByteKey} from './key-memory.mjs';
import {transformedKeyOperand,transformedKeyValue} from './transformed-key.mjs';
import {affineUpdateStructures} from './affine-updates.mjs';
import {colorEncodingStates} from './color-encoding.mjs';
import {recordEvidence,contains} from './record-evidence.mjs';
import {key,num} from './storage-semantics.mjs';
import {compareKeyValues} from './bst-key-order.mjs';
import {priorityLinkLayouts,priorityEdgesAt} from './priority-relations.mjs';
import {callContext} from './call-context.mjs';
import {structureStateAt} from './state-history.mjs';
import {comparatorUses} from './comparator-result.mjs';
import {priorityStringEvidence} from './priority-string-evidence.mjs';
import {indexLayoutEvidence} from './index-layout-evidence.mjs';
import {verificationStates} from './history-evidence.mjs';
import {comparisonPolicies} from './priority-policy.mjs';
import {pointerPolicyLinks} from './pointer-policy-views.mjs';
const kinds=new Set(['pointer-partition-candidate','pointer-priority-candidate','composite-priority-candidate','management-role-candidate','shared-substructure-candidate','deferred-update-candidate','partition-selection-candidate']);
export function validateExtendedSemantics(plan,trace){
 const all=trace.structures.filter(s=>kinds.has(s.kind));if(!all.length)return;
 const c=recordEvidence(plan,trace),calls=callContext(c.events),layouts=new Map(),strings=priorityStringEvidence(plan,trace,c),need=(ok,msg)=>{if(!ok)throw Error(`확장 관계 근거 불일치: ${msg}`);},eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),
  event=id=>{need(c.byId.has(id),'실행 식별자');return c.byId.get(id);},node=id=>{const n=c.records.find(n=>n.id===id);need(n,'노드 식별자');return n;},
  range=r=>{const o=c.objects.find(o=>o.id===r?.objectId);need(o&&Number.isSafeInteger(r.offset)&&Number.isSafeInteger(r.size)&&r.offset>=0&&r.size>0&&r.offset+r.size<=o.size,'저장 범위');};
 let affine;
 for(const s of all){need(s.intent==='unconfirmed','의도 미확정');let prev=-1,pointerPolicy=null;
  const arrayPolicy=s.kind==='composite-priority-candidate'?comparisonPolicies(plan,trace).find(p=>p.id===s.id):null;
  if(s.tagSchema==='affine-pair'){
   affine??=affineUpdateStructures(plan,trace,{maxStates:Math.max(2048,trace.events.length)});const actual=affine.find(a=>a.id===s.id);
   need(actual&&eq(actual.applications,s.applications)&&eq(actual.propagations,s.propagations),'복합 태그 합성/전파 출처');
   for(const st of s.states)need(eq(st,actual.states.find(x=>x.afterExecutionId===st.afterExecutionId)),'복합 태그 현재 값/시점');
  }
  if(s.kind==='management-role-candidate'&&s.role==='color'){
   const states=colorEncodingStates(c,trace,s);for(const st of s.states)need(eq(st,states.find(x=>x.afterExecutionId===st.afterExecutionId)),'색 의미 후보/근거 시점');
  }
  if(s.comparisonPolicy){pointerPolicy=comparisonPolicies(plan,trace,{recordScope:true}).find(p=>p.returnConvention===s.returnConvention&&
   [...p.components.values()][0]?.recordTypeId===s.typeId&&c.byId.get(c.byId.get(p.paths[0].returnExecutionId)?.callExecutionId)?.resolvedFunctionId===s.comparisonPolicy.functionId);
   need(pointerPolicy&&eq(pointerPolicy.paths,s.paths)&&eq(pointerPolicyLinks(c,pointerPolicy),s.proofs),'포인터 힙 비교 정책/연결 변경 근거');}
  for(const st of s.states){const at=c.pos.get(event(st.afterExecutionId).eventId);need(at>=prev,'시점 순서');prev=at;need(c.pos.get(event(s.discoveredAtExecutionId).eventId)<=at,'발견 전 상태');
   if(arrayPolicy){const actual=arrayPolicy.states.findLast(p=>c.pos.get(p.afterExecutionId)<=at);need(actual&&eq(actual.components,st.components)&&eq(actual.keyOrder,st.keyOrder),'배열 비교 정책 시점');}
   for(const id of st.evidenceExecutionIds??[])need(c.pos.get(event(id).eventId)<=at,'미래 근거');
   for(const n of st.nodes??[]){range(n.range);if(n.value!==undefined)need(n.value===(s.kind==='pointer-priority-candidate'?c.payloadScalar({...n.range,offset:n.range.offset+s.key.offset,size:s.key.size},at,{signed:s.key.signedness!=='unsigned',type:s.key.valueType}):n.value),'현재 값');
    if(s.kind==='composite-priority-candidate'||s.comparisonPolicy)need(eq(n.values,st.components.map(f=>{
     const r={...n.range,offset:n.range.offset+f.offset,size:f.size};return f.transform?transformedKeyValue(c,f,r,at):isByteKey(f)?strings.value(f,r,at).value:c.payloadScalar(r,at,{signed:f.signedness!=='unsigned',type:f.valueType});
    })),'복합키 현재 값');}
   if(s.kind==='pointer-partition-candidate'){
    const terminals=s.terminals.filter(p=>c.pos.get(p.afterExecutionId)<=at),excluded=new Set(terminals.filter(p=>p.mode==='sentinel').map(p=>p.terminalNodeId)),
     edges=new Map(c.edgesAt(at).filter(e=>e.recordFrom&&!excluded.has(e.recordFrom)&&e.fieldOffset===s.fieldOffset&&node(e.recordFrom).typeId===s.typeId).map(e=>[e.recordFrom,e])),members=new Map();
    need(eq(st.nodes.map(n=>n.id),[...edges.keys()]),'대표 구성원 완전성');
    for(const n of st.nodes){need(eq(n.range,node(n.id).range)&&n.parent===edges.get(n.id)?.recordTo,'대표 연결');let p=n.id,root=null;const seen=new Set(),path=[];
     while(edges.has(p)&&!seen.has(p)){seen.add(p);path.push(p);const e=edges.get(p);if(terminals.some(t=>t.mode==='self'?e.recordTo===p:t.mode==='null'?e.status==='null':t.mode==='sentinel'&&e.recordTo===t.terminalNodeId)){root=p;break;}if(!e.recordTo)break;p=e.recordTo;}
     need(n.root===root&&eq(n.path,path),'대표 경로/종료');if(root){if(!members.has(root))members.set(root,[]);members.get(root).push(n.id);}}
    need(eq(st.groups,[...members].map(([representative,members])=>({representative,members}))),'구성원');
    const byNode=new Map(st.nodes.map(n=>[n.id,n])),active=s.operations.filter(p=>p.kind==='merge'&&c.pos.get(p.afterExecutionId)<=at&&byNode.get(p.fromNodeId)?.root&&byNode.get(p.fromNodeId).root===byNode.get(p.toNodeId)?.root).map(p=>p.writeExecutionId);
    need(eq(st.activeMergeExecutionIds,active),'현재 병합 근거');if(st.status==='supported-observed')need(active.length&&st.nodes.every(n=>n.root),'현재 분리 집합');
   }
   if(s.kind==='composite-priority-candidate'&&(st.nodes.length||st.indexStructureId)){
    const tree=c.structures.find(t=>t.id===st.indexStructureId),a=c.arrays.find(a=>a.id===s.arrayId),reference=st.indexRelation,
     checkpoint=tree&&verificationStates(tree,c.pos).find(p=>p.afterExecutionId===reference?.afterExecutionId);
    need(reference?.sourceStructureId===tree?.id&&checkpoint&&c.pos.get(checkpoint.afterExecutionId)<=at,'복합키 인덱스 정확한 시점 근거');
    // Immutable checkpoints validate the retained dependent state only. They
    // never fill a gap in queries of the source index tree's display history.
    const shape=structureStateAt({...tree,states:[checkpoint],coverage:undefined},c.pos,at,c.objects),active=shape?.activeRange;
    need(tree?.kind==='index-tree'&&tree.arrayId===s.arrayId&&eq(st.activeRange,active),'복합키 인덱스 저장소/사용 범위');
    const layout=indexLayoutEvidence(c,tree,at);need(layout&&eq(layout,st.layoutEvidence),'복합키 실제 인덱스 관계/재할당 출처');
    if(layout.relocationExecutionIds.length)need(active?.status==='observed'&&a.range.offset+(active.start+active.count)*a.elementBytes<=layout.retainedBytes,'복합키 재할당 유지 범위');
    if(st.nodes.length||st.min==='satisfied'||st.max==='satisfied'){
     need(st.alive&&!shape.historyGap&&!shape.lifetimeGap&&active?.status==='observed'&&st.nodes.length===active.count,'복합키 구성원 완전성');
     st.nodes.forEach((n,i)=>need(n.index===active.start+i&&eq(n.range,{objectId:a.objectId,offset:a.range.offset+n.index*a.elementBytes,size:a.elementBytes}),'복합키 원소 범위'));
     const expected=st.nodes.filter(n=>n.index!==tree.descriptor.base).map(n=>({parent:Math.floor((n.index-tree.descriptor.firstChildOffset)/tree.descriptor.degree),child:n.index}));need(eq(st.edges,expected),'복합키 부모 자식');
     const values=new Map(st.nodes.map(n=>[n.index,n.values])),order=st.keyOrder?.map(f=>({index:st.components.findIndex(c=>c.id===f.id),direction:f.direction}));
     for(const direction of ['min','max'])if(st[direction]==='satisfied')need(order&&st.edges.every(e=>{const a=values.get(e.parent),b=values.get(e.child);if(!a||!b)return false;const sign=compareKeyValues(a,b,order).sign;return sign!==null&&(direction==='min'?sign<=0:sign>=0);}), '복합키 힙 조건');
    }
   }
   if(s.kind==='shared-substructure-candidate')for(const p of st.pairs){const edges=c.edgesAt(at),roots=p.rootSlots.map(r=>{range(r);return edges.find(e=>key(e.source)===key(r));});need(eq(roots.map(e=>e?.recordTo),p.rootNodeIds),'공유 루트');
    const reach=id=>{const seen=new Set(),pending=[id];while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);pending.push(...edges.filter(e=>e.recordFrom===id&&e.recordTo).map(e=>e.recordTo));}return seen;},a=reach(p.rootNodeIds[0]),b=reach(p.rootNodeIds[1]);
    need(eq(p.sharedNodeIds,[...a].filter(id=>b.has(id)))&&eq(p.exclusiveNodeIds,[[...a].filter(id=>!b.has(id)),[...b].filter(id=>!a.has(id))]),'실제 공유/독점 노드');}
   if(s.kind==='deferred-update-candidate'&&!s.tagSchema)for(const n of st.nodes){need(n.pending===c.scalar(n.range,at),'현재 지연값');if(n.presenceRange){range(n.presenceRange);const value=c.scalar(n.presenceRange,at);need(n.present===(value===null?null:value!==0),'지연 상태 표지');}}
   if(s.kind==='pointer-priority-candidate'){
    if(pointerPolicy){const policy=pointerPolicy.states.findLast(p=>c.pos.get(p.afterExecutionId)<=at);need(policy&&eq(policy.components,st.components)&&eq(policy.keyOrder,st.keyOrder),'포인터 힙 비교 정책 시점');}
    const actual=c.edgesAt(at),root=actual.find(e=>key(e.source)===key(s.root)),roles=new Set(s.proofs.filter(p=>c.pos.get(p.afterExecutionId)<=at).flatMap(p=>p.linkWrites.filter(w=>c.pos.get(w.executionId)<=at).map(w=>w.offset))),eligible=actual.filter(e=>roles.has(e.fieldOffset)&&e.recordFrom),seen=new Set(),pending=root?.recordTo?[root.recordTo]:[];
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);pending.push(...eligible.filter(e=>e.recordFrom===id&&e.recordTo).map(e=>e.recordTo));}
    need(st.nodes.length===seen.size&&st.nodes.every(n=>seen.has(n.id)),'루트 도달 구성원');
    const expected=eligible.filter(e=>seen.has(e.recordFrom)&&e.recordTo);need(eq(st.edges.map(e=>e.id).sort(),expected.map(e=>e.id).sort()),'도달 간선');
    if(!layouts.has(s.typeId))layouts.set(s.typeId,priorityLinkLayouts(c,s.typeId));
    const projected=priorityEdgesAt(eligible.filter(e=>seen.has(e.recordFrom)),root?.recordTo,layouts.get(s.typeId).filter(p=>c.pos.get(p.afterExecutionId)<=at));
    need(eq(st.priorityEdges,projected.edges)&&eq(st.priorityLayout,projected.layout),'우선순위 연결 역할과 저장 간선');
    const values=new Map(st.nodes.map(n=>[n.id,s.comparisonPolicy?n.values:[n.value]])),keyOrder=s.comparisonPolicy?st.keyOrder?.map(f=>({index:st.components.findIndex(c=>c.id===f.id),direction:f.direction})):[{index:0,direction:1}];
    for(const order of ['min','max'])if(st[order]==='satisfied')need(keyOrder&&st.priorityEdges.every(e=>(()=>{const sign=compareKeyValues(values.get(e.from),values.get(e.to),keyOrder).sign;return sign!==null&&(order==='min'?sign<=0:sign>=0);})()),'우선순위 조건');
   }
  }
  if(s.kind==='pointer-partition-candidate'){
   for(const p of s.terminals){const read=event(p.readExecutionId),ret=event(p.returnExecutionId),cmp=event(p.comparisonExecutionId),at=c.pos.get(read.eventId),n=node(p.nodeId),dest=c.pointerNode(read.value,at);
    need((p.mode==='self'?dest?.id===n.id:p.mode==='null'?read.value.reference?.status==='null':p.mode==='sentinel'&&dest?.id===p.terminalNodeId)&&c.fieldAt(read.target,at)?.node.id===n.id&&c.pointerNode(ret.value,c.pos.get(ret.eventId))?.id===n.id,'대표 종료와 반환');need(cmp.steps?.some(x=>x.nodeId===p.sourceNodeId&&['==','!='].includes(x.operator)&&num(x.value)===(x.operator==='=='?1:0)),'대표 종료 비교');}
   for(const p of s.operations){const w=event(p.writeExecutionId),at=c.pos.get(w.eventId);need(c.fieldAt(w.target,at)?.node.id===p.fromNodeId&&c.pointerNode(w.value,at)?.id===p.toNodeId,'실제 대표 쓰기');for(const [ids,ret]of [[w.dataInputs,p.valueReturnExecutionId],[w.addressInputs,p.addressReturnExecutionId]])if(ret)need((ids??[]).flatMap(c.chain).some(e=>e.eventId===ret),'대표 반환값 출처');}
  }
  if(s.kind==='composite-priority-candidate'||s.comparisonPolicy)for(const p of s.paths){const ret=event(p.returnExecutionId);
   if(p.interpretation){const use=p.interpretation;need(use.operator===s.returnConvention&&p.afterExecutionId===use.executionId,'비교 반환 규약/시점');
    need(use.operator==='truth'?use.executionId===ret.eventId:comparatorUses(c,ret).some(x=>eq(x,use)),'비교 반환 실제 소비');}
   for(const cmp of p.comparisons){const e=event(cmp.comparisonExecutionId),string=cmp.kind==='string-comparison'?strings.comparisons.get(e.eventId):null,step=e.steps?.find(s=>s.nodeId===cmp.sourceNodeId);
    need(cmp.kind==='string-comparison'?string?.callExecutionId===cmp.callExecutionId:step,'비교 연산');
    for(let i=0;i<2;i++){const actual=string?.operands[i]??(cmp.kind==='transformed-comparison'?transformedKeyOperand(c,step.inputs[i],e,step):c.operand(step.inputs[i],e,step)),o=cmp.operands[i];need(actual&&key(actual.range)===key(o.range)&&actual.readExecutionId===o.readExecutionId&&eq(actual.copyExecutionIds,o.copyExecutionIds),'복합키 복사 출처');
     if(cmp.kind==='transformed-comparison')need(eq(actual.transform,cmp.transform)&&eq(actual.transformedReads,o.transformedReads)&&eq(actual.transformEvidenceExecutionIds,o.transformEvidenceExecutionIds),'변환 키 계산 출처');
     if(string)need(actual.storage===o.storage&&eq(actual.byteRange,o.byteRange)&&eq(actual.payload,o.payload),'문자열 비교 실제 범위/값');}}}
  // Diagnose specific provenance/return violations before the final policy
  // equality check; both checks remain required.
  if(s.kind==='composite-priority-candidate')need(arrayPolicy&&eq(arrayPolicy.paths,s.paths),'배열 복합키 비교 정책 출처');
  if(s.kind==='management-role-candidate')for(const p of s.proofs){const w=event(p.writeExecutionId),f=c.fieldAt(w.target,c.pos.get(w.eventId));need(s.binding.kind==='array'?c.cell(w.target)?.arrayId===s.binding.arrayId:f?.node.typeId===s.recordTypeId&&f.offset===s.binding.offset&&f.size===s.binding.size,'관리 필드 실제 쓰기');for(const id of p.evidenceExecutionIds)need(c.pos.get(event(id).eventId)<=c.pos.get(p.afterExecutionId),'관리 필드 미래 근거');}
  if(s.kind==='deferred-update-candidate'&&!s.tagSchema){
   const aggregate=trace.structures.find(x=>x.id===s.aggregateId),history=[...aggregate?.states??[],...aggregate?.proofStates??[]].sort((a,b)=>c.pos.get(a.afterExecutionId)-c.pos.get(b.afterExecutionId)),layout=(index,at)=>history.findLast(st=>c.pos.get(st.afterExecutionId)<=at);
   for(const p of s.applications){const a=p.aggregateWriteExecutionId?event(p.aggregateWriteExecutionId):null,t=event(p.tagWriteExecutionId);
    need(c.cell(t.target)?.arrayId===s.tagArrayId&&c.cell(t.target).index===p.index,'태그 저장소');
    if(a){need(calls.common(a,t)&&c.cell(a.target)?.arrayId===s.arrayId&&c.cell(a.target).index===p.index,'집계 저장소');need(c.dependencies(a.dataInputs).some(e=>e.kind==='READ'&&c.identity(e.eventId,p.deltaReadExecutionId)),'공유 변화량');}
    else {const proof=s.applications.find(q=>q.aggregateWriteExecutionId&&q.afterExecutionId===p.siteProofExecutionId),end=event(p.frameEndExecutionId);
     need(p.aggregateEffect==='not-written'&&proof&&event(proof.tagWriteExecutionId).instructionId===t.instructionId&&proof.tagOperator===p.tagOperator,'태그 전용 갱신의 선행 위치 근거');
     need(end.activationId===t.activationId&&c.pos.get(end.eventId)<=c.pos.get(p.afterExecutionId)&&c.pos.get(proof.afterExecutionId)<=c.pos.get(p.afterExecutionId),'태그 전용 관측 완료');
     need(!c.events.some(e=>e.activationId===t.activationId&&e.action==='write'&&c.cell(e.target)?.arrayId===s.arrayId&&c.cell(e.target)?.index===p.index),'존재하는 집계 쓰기 누락');
    }
    const evidence=history.find(st=>st.afterExecutionId===p.coverageEvidenceExecutionId);need(evidence&&c.pos.get(evidence.afterExecutionId)<=c.pos.get((a??t).eventId)&&eq(evidence.nodes.find(n=>n.index===p.index)?.coverage,p.coverage),'지연 갱신 구간 출처');
    const producer=c.byId.get(t.dataInputs?.[0]),step=producer?.steps?.at(-1),operator=step?.operator?.replace(/=$/,'')??'assign';need(operator===p.tagOperator,'태그 결합 연산');need(p.neutralValue===({'+':0,'*':1,'^':0,'|':0}[operator]??null),'태그 항등원');
   }
   for(const p of s.propagations){const clear=event(p.clearExecutionId),read=event(p.sourceReadExecutionId),at=c.pos.get(clear.eventId);need(num(clear.value)===p.neutralValue&&c.cell(read.target)?.arrayId===s.tagArrayId&&c.cell(read.target)?.index===p.index,'지연값 읽기와 제거');
    if(p.clearKind==='neutral-tag')need(key(clear.target)===key(read.target)&&s.applications.some(a=>a.index===p.index&&a.neutralValue===p.neutralValue&&c.pos.get(a.completedAtExecutionId??a.afterExecutionId)<at&&c.pos.get(a.afterExecutionId)<=c.pos.get(p.afterExecutionId)),'지연값 항등원');
    else{const write=event(p.presenceWriteExecutionId),guard=event(p.guardReadExecutionId);need(p.clearKind==='presence-flag'&&num(clear.value)===0&&num(write.value)!==0&&num(guard.value)!==0&&key(write.target)===key(clear.target)&&key(guard.target)===key(clear.target)&&c.pos.get(write.eventId)<c.pos.get(guard.eventId)&&c.pos.get(guard.eventId)<at,'지연 표지 해제');}
    const apps=p.applicationExecutionIds.map((id,i)=>s.applications.find(a=>a.afterExecutionId===id&&a.index===p.childIndices[i]));need(apps.length===p.childIndices.length&&apps.every((a,i)=>a?.index===p.childIndices[i]&&c.pos.get(a.tagWriteExecutionId)>c.pos.get(read.eventId)&&c.pos.get(a.completedAtExecutionId??a.afterExecutionId)<at&&c.pos.get(a.afterExecutionId)<=c.pos.get(p.afterExecutionId)&&c.flow.reads(a.deltaReadExecutionId).some(r=>c.identity(r.eventId,read.eventId))),'자식 전파 출처');
    const proof=p.layoutEvidenceExecutionId?history.find(st=>st.afterExecutionId===p.layoutEvidenceExecutionId):layout(p.index,at);
    need(proof&&c.pos.get(proof.afterExecutionId)<=at,'전파 구조 출처 시점');
    const children=proof.nodes.find(n=>n.index===p.index)?.topologyChildren?.map(n=>n.index)??[];need(children.length>=2&&eq(children,p.childIndices),'전파 자식 완전성');
    const previous=s.propagations.filter(q=>q!==p&&q.index===p.index&&c.pos.get(q.clearExecutionId)<at).at(-1),parent=s.applications.findLast(a=>a.index===p.index&&c.pos.get(a.completedAtExecutionId??a.afterExecutionId)<at);need(parent&&c.pos.get(read.eventId)>Math.max(c.pos.get(parent.tagWriteExecutionId),previous?c.pos.get(previous.clearExecutionId):-1),'전파 버전');
   }
  }
  if(s.kind==='partition-selection-candidate')for(const p of s.selections){const copy=event(p.copyExecutionId),merge=event(p.mergeExecutionId),condition=event(p.conditionExecutionId);need(copy.action==='copy'&&key(copy.target)===key(p.targetRange)&&key({objectId:copy.sourceObjectId,offset:copy.sourceOffset,size:copy.sourceSize})===key(p.sourceRange),'선택 레코드 복사');need(copy.controlInputs.includes(condition.eventId)&&merge.controlInputs.includes(condition.eventId),'선택과 병합 제어');for(const id of p.endpointReadExecutionIds)need(contains(p.sourceRange,event(id).target),'끝점 원본 레코드');}
 }
}
