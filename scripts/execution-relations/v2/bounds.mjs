import {check,complete,intersects,unique} from './common.mjs';

// Compiler-produced affine facts, not C text, algorithm templates or user-name guesses.
// A fact names its real access/entry instructions and scalar/pointer bindings.
function integer(event){const v=event?.value,raw=v?.decimal??v?.signed??v?.unsigned;
  return typeof raw==='string'&&/^-?\d+$/.test(raw)?BigInt(raw):null;}
function scalarRange(type){if(!type||!Number.isInteger(type.sizeBits)||type.sizeBits<1||type.sizeBits>128||!['signed','unsigned'].includes(type.signedness))return null;
  const bits=BigInt(type.sizeBits);return type.signedness==='signed'?[-(1n<<(bits-1n)),(1n<<(bits-1n))-1n]:[0n,(1n<<bits)-1n];}
export function analyzeBounds(c,events,emit,result){
  const facts=c.compilerFacts?.domains;
  if(!facts){result.capabilities.bounds={status:'unavailable',reason:'missing-compiler-domains'};return;}
  check(Array.isArray(facts),'domains는 목록이어야 합니다.');
  for(const d of facts){
    check(d&&typeof d.id==='string'&&Array.isArray(d.accessInstructionIds)&&d.accessInstructionIds.length&&Array.isArray(d.entryInstructionIds)&&d.entryInstructionIds.length,'영역 근거에 접근/진입 명령이 필요합니다.');
    for(const id of [...d.accessInstructionIds,...d.entryInstructionIds,...d.safeCallInstructionIds??[]])check(c.instruction(id),'영역 근거의 명령이 없습니다.');
    check(Array.isArray(d.sourceNodeIds)&&d.sourceNodeIds.length&&d.sourceNodeIds.every(id=>c.instructionNodes.has(id)),'영역의 컴파일 소스 노드 연결이 없습니다.');
    check(d.proofKind==='affine-loop'&&['<','<=','>','>='].includes(d.comparison),'지원하지 않는 영역 근거입니다.');
    check(Number.isSafeInteger(d.elementSizeBytes)&&d.elementSizeBytes>0&&scalarRange(d.indexType),'원소 폭/인덱스 자료형 근거가 없습니다.');
  }
  const latest=new Map(),touches=new Map(),states=new Map(),requested=new Map();let supported=0,unresolved=0;
  const paramKey=(frame,index)=>`${frame}:p:${index}`,instructionKey=(frame,id)=>`${frame}:i:${id}`;
  function resolve(binding,frame){
    if(binding?.literal!==undefined&&c.instructionNodes.has(binding.nodeId)&&/^-?\d+$/.test(binding.literal))return {literal:binding.literal,nodeId:binding.nodeId};
    const original=Number.isInteger(binding?.parameterIndex)?latest.get(paramKey(frame,binding.parameterIndex)):binding?.instructionId?latest.get(instructionKey(frame,binding.instructionId)):null;
    if(!original?.target?.objectId)return original;
    const target=original.target,list=touches.get(target.objectId)??[];
    for(let i=list.length-1;i>=0;i--){const e=list[i];if(!intersects(e.target,target))continue;
      const exact=e.target.offset===target.offset&&e.target.size===target.size;
      if(e.kind==='WRITE'||exact)return exact?e:null;}
    return original;
  }
  function invalidate(state,event,reason){if(!state?.relation)return;result.changes.push({relationId:state.relation.id,action:'invalidate',atExecutionId:event.eventId,reason});state.relation=null;}
  function attempt(d,frame,event){
    const key=`${frame}:${d.id}`,state=states.get(key)??{relation:null,revision:0,dependencies:[]};states.set(key,state);if(state.relation)return;
    const base=resolve(d.base,frame),lower=resolve(d.lower,frame),upper=resolve(d.upper,frame),ref=base?.value?.reference,o=c.object(ref?.targetObjectId);
    if(!base||!lower||!upper||!o)return;
    const at=c.position(event.eventId),begin=c.position(o.createdBy),end=c.position(o.endedBy);
    if(begin===undefined||begin>at||end!==undefined&&end<=at)return;
    if(state.requiredAfter!==undefined&&[base,lower,upper].some(v=>v.eventId&&c.position(v.eventId)<=state.requiredAfter))return;
    const lo=lower.literal!==undefined?BigInt(lower.literal):integer(lower),hi=upper.literal!==undefined?BigInt(upper.literal):integer(upper),step=BigInt(d.step??'1'),bounds=scalarRange(d.indexType);
    if(lo===null||hi===null||step===0n)return;
    const increasing=['<','<='].includes(d.comparison);if(increasing!==(step>0n)){state.rejected=true;unresolved++;emit.issue('unsupported-domain-direction',{domainId:d.id,executionId:event.eventId});return;}
    let count=0n;const delta=increasing?hi-lo:lo-hi,stride=step<0n?-step:step,inclusive=d.comparison.includes('=');
    if(delta>0n||delta===0n&&inclusive)count=inclusive?delta/stride+1n:(delta+stride-1n)/stride;
    const last=count?lo+(count-1n)*step:lo,after=count?last+step:lo;
    if([lo,hi,last,after].some(v=>v<bounds[0]||v>bounds[1])){state.rejected=true;unresolved++;emit.issue('domain-overflow-not-excluded',{domainId:d.id,executionId:event.eventId});return;}
    const scale=BigInt(d.indexScale??'1'),offset=BigInt(d.indexOffset??'0'),width=BigInt(d.elementSizeBytes),baseOffset=BigInt(ref.targetOffset??0);
    const firstByte=baseOffset+(lo*scale+offset)*width,lastByte=baseOffset+(last*scale+offset)*width,minimum=firstByte<lastByte?firstByte:lastByte,maximum=firstByte>lastByte?firstByte:lastByte;
    if(scale===0n||minimum<0n||count&&maximum+width>BigInt(o.size)||!count&&minimum>BigInt(o.size)){
      state.rejected=true;unresolved++;emit.issue('domain-object-bounds-not-proved',{domainId:d.id,executionId:event.eventId});return;}
    const strideBytes=stride*(scale<0n?-scale:scale)*width,pattern={offset:Number(minimum),size:d.elementSizeBytes,count:count.toString(),strideBytes:strideBytes.toString()};
    const ranges=!count?[]:strideBytes===width?[{offset:Number(minimum),size:Number(maximum-minimum+width)}]:count<=BigInt(c.limits.maxDomainElements)?Array.from({length:Number(count)},(_,i)=>({offset:Number(minimum+BigInt(i)*strideBytes),size:d.elementSizeBytes})):[];
    const evidence=unique([event.eventId,base.eventId,lower.eventId,upper.eventId]);
    const relation=emit.relation('bounded-domain',event,[{kind:'region-set',role:'possible-access',objectId:o.id,createdBy:o.createdBy,ranges,...(count?{pattern}:{})}],
      {domainId:d.id,basis:'bounded-domain',completeVisit:false,accessInstructionIds:d.accessInstructionIds,indexType:d.indexType,step:step.toString(),comparison:d.comparison},evidence,
      {id:`domain:${frame}:${d.id}:${++state.revision}`,evidence:{executionIds:evidence,planNodeIds:d.sourceNodeIds,relationIds:[]}});
    if(relation){state.relation=relation;state.dependencies=[base,lower,upper].filter(v=>v?.target?.objectId).map(v=>({...v.target}));state.objectId=o.id;
      result.changes.push({relationId:relation.id,action:'activate',atExecutionId:event.eventId});supported++;}
  }
  for(const e of events){if(!complete(e))continue;if(!emit.tick(e.eventId))break;
    for(const [key,state]of states){if(!state.relation)continue;const owner=state.relation.activationIds[0];
      if(e.kind==='WRITE'&&e.target&&state.dependencies.some(dep=>intersects(dep,e.target)))invalidate(state,e,'bound-binding-write');
      else if(e.action==='frame.end'&&owner===e.activationId)invalidate(state,e,'activation-end');
      else if(e.kind==='SPACE'&&(e.endedObjects?.includes(state.objectId)||e.objectId===state.objectId&&['object.end','free'].includes(e.action)))invalidate(state,e,'storage-ended');
      else if(e.kind==='FLOW'&&e.action==='call'&&e.activationId===owner){const d=facts.find(f=>f.id===state.relation.details.domainId);
        if(!d.safeCallInstructionIds?.includes(e.instructionId)){state.requiredAfter=c.position(e.eventId);invalidate(state,e,'unmodeled-call-effects');}}
    }
    latest.set(instructionKey(e.activationId,e.instructionId),e);
    if(e.target?.objectId&&['READ','WRITE'].includes(e.kind)){const list=touches.get(e.target.objectId)??[];list.push(e);touches.set(e.target.objectId,list);}
    if(e.action==='argument'&&Number.isInteger(e.parameterIndex))latest.set(paramKey(e.activationId,e.parameterIndex),e);
    const frame=c.frame(e.activationId);if(!frame)continue;
    for(const d of facts){if(d.functionId&&d.functionId!==frame.functionId)continue;
      const key=`${frame.id}:${d.id}`;
      if(d.entryInstructionIds.includes(e.instructionId)){requested.set(key,d);attempt(d,frame.id,e);}
      else if(requested.has(key)&&e.action==='argument')attempt(d,frame.id,e);
    }
  }
  for(const [key,d]of requested){const state=states.get(key);if(!state?.revision&&!state?.rejected){unresolved++;emit.issue('missing-domain-bindings',{domainId:d.id,context:key});}}
  result.capabilities.bounds={status:unresolved?'partial':'completed',domainFacts:facts.length,supported,unresolved};
}
