import {storageEvidence,key,num,unique} from './storage-semantics.mjs';
import {selectionEvidence} from './selection-evidence.mjs';
export function validateStorageSemantics(plan,trace){
 const all=trace.structures.filter(s=>['representative-partition-candidate','range-aggregate-candidate'].includes(s.kind));if(!all.length)return;
 const c=storageEvidence(plan,trace),{byId,pos,cell,scalar,chain}=c,need=(ok,why)=>{if(!ok)throw Error(`저장 의미 근거 불일치: ${why}`);},
  event=id=>{need(byId.has(id),'사건');return byId.get(id);},equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 for(const s of all){const array=c.arrays.find(a=>a.id===s.arrayId);need(array&&equal(s.range,array.range)&&s.intent==='unconfirmed','원본 저장 범위');
  if(s.kind==='representative-partition-candidate'){
   const returns=new Map(s.lookups.map(p=>[p.returnExecutionId,p]));
   for(const p of s.terminals){const r=event(p.readExecutionId),cursor=event(p.cursorReadExecutionId),ret=event(p.returnExecutionId??p.exitExecutionId),cmp=event(p.comparisonExecutionId),st=cmp.steps?.find(x=>x.nodeId===p.sourceNodeId),x=cell(r.target);
    need(x?.arrayId===s.arrayId&&x.index===p.index&&x.fieldOffset===s.fieldOffset&&r.target.size===s.fieldSize,'대표 슬롯');
    need(ret.activationId===cmp.activationId&&pos.get(cmp.eventId)<pos.get(ret.eventId),'대표 확인 순서');
    if(p.returnExecutionId)need(ret.action==='return.value'&&num(ret.value)===p.index&&(ret.dataInputs??[]).flatMap(id=>c.flow.reads(id)).some(r=>c.identity(r.eventId,cursor.eventId)),'대표 반환');
    else need(ret.action==='branch'&&num(ret.condition)===0&&ret.dataInputs?.includes(cmp.eventId)&&['WhileStmt','ForStmt','DoStmt'].includes(c.defs.get(ret.instructionId)?.controlKind),'대표 루프 종료');
    need((r.addressInputs??[]).flatMap(id=>c.flow.reads(id)).some(r=>c.identity(r.eventId,cursor.eventId)),'인덱스 출처');
    need(st?.inputs.some(i=>c.flow.sourceReadOperand(i,cmp,st)?.eventId===r.eventId),'종료 비교 피연산자');
    need(p.mode==='self'?num(r.value)===p.index&&['==','!='].includes(st.operator):p.mode==='negative'&&num(r.value)<0,'종료 규약');
   }
   for(const p of s.operations){const w=event(p.writeExecutionId),x=cell(w.target),v=returns.get(p.valueReturnExecutionId)??s.terminals.find(t=>t.exitExecutionId&&t.exitExecutionId===p.valueExitExecutionId);
    need(w.kind==='WRITE'&&x?.arrayId===s.arrayId&&x.index===p.fromIndex&&num(w.value)===p.toIndex,'병합/압축 실제 쓰기');
    const fromProof=(ids,proof,retId)=>retId?(ids??[]).flatMap(chain).some(e=>e.eventId===retId):proof&&(ids??[]).flatMap(id=>c.flow.reads(id)).some(r=>c.identity(r.eventId,proof.cursorReadExecutionId));
    need(v&&v.index===p.toIndex&&fromProof(w.dataInputs,v,p.valueReturnExecutionId),'대표 값 전달');
    if(p.kind==='merge'){const a=returns.get(p.addressReturnExecutionId)??s.terminals.find(t=>t.exitExecutionId&&t.exitExecutionId===p.addressExitExecutionId);need(a?.index===p.fromIndex&&fromProof(w.addressInputs,a,p.addressReturnExecutionId),'대표 주소 전달');}
    else need(p.kind==='compress'&&p.previousPath.length>2&&p.previousPath.at(-1)===p.toIndex,'압축 이전 경로');
    const at=pos.get(w.eventId)-1;for(let i=0;i<p.previousPath.length-1;i++)need(scalar({objectId:s.objectId,offset:s.range.offset+p.previousPath[i]*s.elementBytes+s.fieldOffset,size:s.fieldSize},at)===p.previousPath[i+1],'압축 원래 연결');
   }
  }else for(const p of s.walkEvidence){
   const calc=event(p.calculationExecutionId),from=event(p.fromCursorExecutionId),to=event(p.toCursorExecutionId),step=calc.steps?.find(x=>x.nodeId===p.sourceNodeId);
   need(calc.kind==='CALC'&&['&','|'].includes(step?.operator)&&num(from.value)===p.fromIndex&&num(to.value)===p.toIndex&&num(calc.value)===p.toIndex,'비트 인덱스 이동');
   need(chain(to.eventId).some(e=>e.eventId===calc.eventId),'인덱스 이동 값 출처');
   need(p.mode==='one-based'||p.mode==='zero-based','비트 구간 방식');
   const n=BigInt(p.fromIndex),low=n&-n,expected=p.mode==='one-based'?(p.direction==='update'?n+low:n-low):p.direction==='update'?n|(n+1n):(n&(n+1n))-1n;
   need(Number(expected)===p.toIndex&&pos.get(calc.eventId)<pos.get(to.eventId),'비트 이동 방향');
   for(const id of p.accessExecutionIds)need(cell(event(id).target)?.arrayId===s.arrayId&&pos.get(id)<=pos.get(event(p.afterExecutionId).eventId),'비트 이동 저장소/시점');
  }
  for(const st of [...s.states,...s.proofStates??[]]){const at=pos.get(event(st.afterExecutionId).eventId);need(st.alive===c.alive(array.objectId,at),'수명');
   for(const id of st.evidenceExecutionIds)need(pos.get(event(id).eventId)<=at,'미래 근거');
   if(s.kind==='representative-partition-candidate'){
    const nodes=new Map(st.nodes.map(n=>[n.index,n])),modes=s.terminals.filter(t=>pos.get(t.afterExecutionId)<=at).map(t=>t.mode),partitions=new Map();
    for(const n of st.nodes){const r={objectId:s.objectId,offset:s.range.offset+n.index*s.elementBytes+s.fieldOffset,size:s.fieldSize};need(equal(n.range,r)&&n.value===scalar(r,at),'부모 현재 값');
     let p=n.index,root=null;const path=[],seen=new Set();while(nodes.has(p)&&!seen.has(p)){seen.add(p);path.push(p);const v=nodes.get(p).value;if(modes.includes('self')&&v===p||modes.includes('negative')&&v!==null&&v<0){root=p;break;}if(v===null||v<0)break;p=v;}
     need(n.root===root&&equal(n.path,path),'구성원 순서/대표/종료');if(root!==null){if(!partitions.has(root))partitions.set(root,[]);partitions.get(root).push(n.index);}
    }
    need(equal(st.groups,[...partitions].map(([representative,members])=>({representative,members}))),'집합 구성원');
    const current=new Map(st.nodes.map(n=>[n.index,n])),active=s.operations.filter(p=>p.kind==='merge'&&pos.get(p.afterExecutionId)<=at&&current.has(p.fromIndex)&&current.get(p.fromIndex).root!==null&&current.get(p.fromIndex).root===current.get(p.toIndex)?.root).map(p=>p.writeExecutionId);
    need(JSON.stringify(st.activeMergeExecutionIds)===JSON.stringify(active),'현재 병합 근거');
    if(st.status==='supported-observed')need(st.alive&&st.nodes.every(n=>n.root!==null)&&active.length,'분리 집합 분류 근거');
   }else{
    const members=new Map(st.nodes.map(n=>[n.index,n]));
    const isStale=(n,seen=new Set())=>{if(seen.has(n.index))return true;return n.children.some(ch=>{
     const child=members.get(ch.index);return !child||!child.complete||child.writeExecutionId!==ch.writeExecutionId||isStale(child,new Set(seen).add(n.index));});};
    for(const n of st.nodes){const w=event(n.writeExecutionId);need(pos.get(w.eventId)<=at,'미래 값');
     need(n.stale===isStale(n),'하위 갱신 전파 상태');
     if(n.complete){need(w.kind==='WRITE'&&key(n.range)===key(w.target)&&equal(n.value,w.value),'집계 저장 값');
      const selectors=selectionEvidence(c,w.dataInputs);need(equal(n.selectionEvidence??[],selectors),'집계 선택 조건');
      const actual=[...c.reads(w.dataInputs),...selectors.flatMap(p=>p.sourceReadExecutionIds.map(event))].filter(r=>cell(r.target)).map(r=>r.eventId);need(equal(n.readExecutionIds,unique(actual)),'집계 읽기 출처');
      const expectedChildren=n.readExecutionIds.map(event).filter(r=>cell(r.target)?.arrayId===s.arrayId&&cell(r.target).index!==n.index).map(r=>{
       const producer=c.events.findLast(e=>e.action==='write'&&key(e.target)===key(r.target)&&pos.get(e.eventId)<pos.get(r.eventId));return {index:cell(r.target).index,readExecutionId:r.eventId,writeExecutionId:producer?.eventId};});
      need(equal(n.children,expectedChildren),'집계 구조의 자식 누락/추가');
     }
     for(const id of [...n.readExecutionIds,...n.calculationExecutionIds])need(pos.get(event(id).eventId)<pos.get(w.eventId),'집계 출처 순서');
     for(const leaf of n.leaves){const r=event(leaf.readExecutionId??leaf.writeExecutionId),a=cell(r.target);
      need(a?.arrayId===leaf.arrayId&&a.index===leaf.index&&key(a.range)===key(leaf.range)&&pos.get(r.eventId)<=pos.get(w.eventId),'잎의 실제 저장 위치');
      if(leaf.coordinateKind==='storage-leaf')need(r.action==='write'&&!c.reads(r.dataInputs).some(x=>cell(x.target))&&!c.chain(r.eventId).some(x=>x.kind==='CALC'),'상수 잎 좌표의 실제 초기화');
      else need(r.kind==='READ'&&pos.get(r.eventId)<pos.get(w.eventId),'입력 잎 읽기');}
     for(const child of n.children){const r=event(child.readExecutionId),producer=event(child.writeExecutionId),x=cell(r.target);need(n.readExecutionIds.includes(r.eventId)&&x?.arrayId===s.arrayId&&x.index===child.index&&key(producer.target)===key(r.target)&&pos.get(producer.eventId)<pos.get(r.eventId),'자식 읽기/쓰기 대응');}
     if(n.complete){const source=event(n.topologySourceWriteExecutionId);need(pos.get(source.eventId)<=pos.get(w.eventId),'구조 출처 시점');
      if(n.valueTransform){
       const selectors=selectionEvidence(c,source.dataInputs),reads=unique([...c.reads(source.dataInputs),...selectors.flatMap(p=>p.sourceReadExecutionIds.map(event))].map(r=>r.eventId)).map(event),
        children=reads.filter(r=>cell(r.target)?.arrayId===s.arrayId&&cell(r.target).index!==n.index).map(r=>{const writer=c.events.findLast(e=>e.action==='write'&&key(e.target)===key(r.target)&&pos.get(e.eventId)<pos.get(r.eventId));return {index:cell(r.target).index,readExecutionId:r.eventId,writeExecutionId:writer?.eventId};});
       need(equal(n.topologyChildren,children)&&n.readExecutionIds.some(id=>key(event(id).target)===key(n.range)),'자기 갱신 전 구조');
      }
      else need(equal(n.topologyChildren,n.children),'집계 구조와 값 출처');
     }
     const leaves=unique(n.leaves.map(l=>l.index)).sort((a,b)=>a-b),domains=unique(n.leaves.map(l=>l.arrayId)),expected=leaves.length&&domains.length===1&&leaves.at(-1)-leaves[0]+1===leaves.length?{arrayId:domains[0],start:leaves[0],end:leaves.at(-1)+1}:null;
     need(equal(n.coverage,expected),'담당 구간');
    }
    if(st.status==='supported-observed')need(st.alive&&st.nodes.every(n=>n.complete&&!n.stale),'미완료 집계');
   }
  }
 }
}
