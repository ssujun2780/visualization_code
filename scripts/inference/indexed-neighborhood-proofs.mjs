// Array-index adjacency: a root slot supplies an edge cursor, a link read
// advances that same cursor, and a co-indexed destination indexes vertex data.
// All joins follow recorded value versions; neither names nor equal values join.
import {createValueFlow} from './observed-value-flow.mjs';
const slot=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const number=v=>Number(v?.decimal??v?.signed??v?.unsigned);
const unique=a=>[...new Set(a)];
const validationLookups=new WeakMap();
function lookup(trace,flow){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),
    accesses=new Map((trace.structures.find(s=>s.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a]));
  const origin=id=>flow.reads(id).find(r=>accesses.has(r.eventId)),
    cursor=id=>{
      const a=accesses.get(id),values=(a?.cursors??[]).filter(c=>a.axes?.[0]?.indexDeclarationIds?.includes(c.declarationId));
      if(values.length!==1||a.target.coordinates?.length!==1||a.axes[0].index?.offset)return null;
      const c=events.get(values[0].executionId);
      return c?.kind==='READ'&&number(c.value)===a.target.index?c:null;
    };
  return {events,accesses,origin,cursor};
}
export function indexedNeighborhoodProofs(plan,trace,flow){
  const {events,accesses,origin,cursor}=lookup(trace,flow),pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    arrays=new Map(trace.structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),defs=new Map(plan.instructions.map(d=>[d.id,d])),
    writes=new Map(),links=new Map(),byVersion=new Map(),result=[];
  for(const e of trace.events)if(e.kind==='WRITE'){
    const k=slot(e.target);if(!writes.has(k))writes.set(k,[]);writes.get(k).push(e);
  }
  for(const [id,a]of accesses){
    const e=events.get(id),c=cursor(id),o=c&&origin(c.eventId);
    if(e.kind!=='READ'||!o||!c)continue;
    const branch=(e.controlInputs??[]).map(id=>events.get(id)).findLast(b=>b?.action==='branch'&&
      ['ForStmt','WhileStmt','DoStmt'].includes(defs.get(b.instructionId)?.controlKind)&&number(b.condition));
    if(!branch)continue;
    const list=writes.get(slot(c.target))??[];let lo=0,hi=list.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(pos.get(list[mid].eventId)<=pos.get(id))lo=mid+1;else hi=mid;}
    const write=list[lo];
    if(write?.activationId!==e.activationId)continue;
    if(!write||!flow.reads(write.eventId).some(r=>r.eventId===id))continue;
    const link={read:id,write:write.eventId,branch:branch.eventId,origin:o.eventId,arrayId:a.target.arrayId,cursor:slot(c.target)};
    links.set(id,link);
    const k=`${link.cursor}|${link.origin}|${link.branch}`;
    if(!byVersion.has(k))byVersion.set(k,[]);byVersion.get(k).push(link);
  }
  for(const r of trace.structures.find(s=>s.kind==='storage-dependencies')?.relations??[]){
    if(!r.preserved||!r.targetArrayId)continue;
    const source=events.get(r.sourceReadExecutionId),target=events.get(r.targetAccessExecutionId),
      c=cursor(source?.eventId),o=c&&origin(c.eventId),domain=arrays.get(r.targetArrayId);
    if(!o||!domain||['array','record'].includes(domain.elementType?.kind)||r.target.size!==domain.elementBytes)continue;
    for(const branch of source.controlInputs??[])for(const link of byVersion.get(`${slot(c.target)}|${o.eventId}|${branch}`)??[]){
      if(link.arrayId===r.sourceArrayId||!target.controlInputs?.includes(branch))continue;
      const chain=[];let head=o,valid=true;
      while(links.has(head.eventId)){
        const previous=links.get(head.eventId);
        if(previous.arrayId!==link.arrayId||previous.cursor!==link.cursor){valid=false;break;}
        chain.push(head);head=events.get(previous.origin);
        if(chain.length>=flow.dependencyLimit){flow.reportLimit('value-dependencies',flow.dependencyLimit,source.eventId);valid=false;break;}
      }
      const headAccess=accesses.get(head?.eventId);
      if(!valid||!headAccess||[link.arrayId,r.sourceArrayId,r.targetArrayId].includes(headAccess.target.arrayId)||
        r.targetArrayId===link.arrayId||r.targetArrayId===r.sourceArrayId||headAccess.target.coordinates?.length!==1)continue;
      const sourceReads=unique([head.eventId,...chain.map(e=>e.eventId),link.read,source.eventId]).map(id=>({source:events.get(id).target,executionId:id})),
        evidence=unique([...sourceReads.map(r=>r.executionId),link.write,branch,target.eventId]),
        executionId=evidence.reduce((a,b)=>pos.get(a)>pos.get(b)?a:b);
      result.push({array:domain,proof:{kind:'indexed-list-access',executionId,relationId:r.id,
        sourceReadExecutionId:source.eventId,targetAccessExecutionId:target.eventId,
        headReadExecutionId:head.eventId,linkReadExecutionId:link.read,linkWriteExecutionId:link.write,branchExecutionId:branch,
        linkChainExecutionIds:chain.map(e=>e.eventId),fromIndex:headAccess.target.index,toIndex:r.targetIndex,
        sourceSlots:sourceReads.map(r=>r.source),sourceReads,properties:[],transforms:[],evidenceExecutionIds:evidence}});
    }
  }
  return result;
}

export function validateIndexedNeighborhoodProof(p,{events,accesses,relations,fail,trace}){
  if(!validationLookups.has(events)){
    const flow=createValueFlow({instructions:[]},trace);validationLookups.set(events,{flow,...lookup(trace,flow)});
  }
  const {flow,origin,cursor}=validationLookups.get(events),
    head=events.get(p.headReadExecutionId),link=events.get(p.linkReadExecutionId),write=events.get(p.linkWriteExecutionId),
    source=events.get(p.sourceReadExecutionId),target=events.get(p.targetAccessExecutionId),branch=events.get(p.branchExecutionId),r=relations.get(p.relationId),
    lc=cursor(link?.eventId),sc=cursor(source?.eventId);
  if(!lc||!sc||slot(lc.target)!==slot(sc.target)||origin(lc.eventId)?.eventId!==origin(sc.eventId)?.eventId||
    write?.kind!=='WRITE'||slot(write.target)!==slot(lc.target)||!flow.reads(write.eventId).some(e=>e.eventId===link.eventId)||
    branch?.action!=='branch'||!number(branch.condition)||![link,source,target].every(e=>e?.controlInputs?.includes(branch.eventId))||
    r?.preserved!==true||r.sourceReadExecutionId!==source.eventId||r.targetAccessExecutionId!==target.eventId||
    accesses.get(head?.eventId)?.target.index!==p.fromIndex||r.targetIndex!==p.toIndex)
    fail('인덱스 연결 목록의 커서 갱신 또는 목적지 전달 근거가 다릅니다.');
  let current=origin(sc.eventId);
  for(const id of p.linkChainExecutionIds){
    const c=cursor(id);
    if(current?.eventId!==id||!c||slot(c.target)!==slot(sc.target)||accesses.get(id)?.target.arrayId!==accesses.get(link.eventId)?.target.arrayId)
      fail('인덱스 연결 목록의 시작점 계보가 다릅니다.');
    current=origin(c.eventId);
  }
  if(current?.eventId!==head.eventId||!p.sourceReads.some(r=>r.executionId===head.eventId)||
    [source.eventId,link.eventId,...p.linkChainExecutionIds].some(id=>!p.sourceReads.some(r=>r.executionId===id)))
    fail('인덱스 연결 목록의 원본 읽기 근거가 빠졌습니다.');
}
