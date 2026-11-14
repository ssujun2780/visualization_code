// Interpret endpoint proofs at the requested time. Future operations may add
// hypotheses, but cannot qualify or contradict an earlier snapshot.
const unique=a=>[...new Set(a)];
const mod=(n,m)=>(n%m+m)%m;
function ranges(range,bytes,indices){
  const out=[];for(const i of unique(indices).sort((a,b)=>a-b)){
    const offset=range.offset+i*bytes,last=out.at(-1);
    if(last&&last.offset+last.size===offset)last.size+=bytes;else out.push({objectId:range.objectId,offset,size:bytes});
  }return out;
}
export function containerHistory(c,choices,operations,{events,objects,views}){
  const {role,range}=c,byObject=new Map(objects.map(o=>[o.id,o])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    viewIds=views.filter(v=>v.objectId===range.objectId&&v.kind==='array'&&v.offset===range.offset&&v.size===range.size).map(v=>v.id),
    nodes=views.filter(v=>v.objectId===c.ownerObjectId).map(v=>v.id);
  function record(o,p){
    const changes=o.group.updates.filter(u=>u.fieldNodeId===o.field.fieldNodeId||u.fieldNodeId===p?.head?.fieldNodeId||u.fieldNodeId===p?.tail?.fieldNodeId||o.access.indexFields.includes(u.fieldNodeId)),
      effects=[o.access,...changes,...o.copies?.map(x=>x.write)??[]].sort((a,b)=>a.sequence-b.sequence),
      end=o.completionSequence??(o.prefix?events.findIndex(e=>e.action==='frame.end'&&e.activationId===o.group.activationId):-1),
      complete=end>=0?{sequence:end,executionId:events[end].eventId}:effects.at(-1),
      related=o.prefix?c.accesses.filter(a=>a.sequence>=effects[0].sequence&&a.sequence<=complete.sequence):o.group.accesses;
    return {activationId:o.group.activationId,operation:o.operation??(o.delta===1?'insert':'remove'),lengthFieldNodeId:o.field.fieldNodeId,
      status:p?(p.supported.has(o)?'supported':'contradicted'):'partial',before:o.group.before,after:o.group.after,
      accessExecutionId:o.access.executionId,physicalIndex:o.access.physicalIndex,updateExecutionIds:changes.map(u=>u.executionId),
      startExecutionId:effects[0].executionId,completeExecutionId:complete.executionId,
      relatedAccessExecutionIds:unique(related.map(a=>a.executionId)),
      transfers:(o.copies??[]).map(x=>({writeExecutionId:x.write.executionId,
        fromIndex:x.read.physicalIndex,toIndex:x.write.physicalIndex,
        ...(x.bulk?{kind:'observed-range-copy',copyExecutionId:x.write.executionId}:{kind:'observed-element-copy',readExecutionId:x.read.executionId})})),
      ...(o.prefix?{ordering:'unresolved'}:{}),startSequence:effects[0].sequence,completeSequence:complete.sequence};
  }
  const hypotheses=choices.map((p,i)=>({...p,id:`hypothesis:${i}`,records:p.ops.map(o=>record(o,p))}));
  // Independent management slots produce independent logical containers even
  // when their storage allocation is shared. Head/tail is one hypothesis.
  const keys=unique(hypotheses.map(p=>p.length.fieldNodeId)),groups=keys.length?keys.map(k=>hypotheses.filter(p=>p.length.fieldNodeId===k)):[[]],shared=groups.length>1;
  const physical={id:`array:${c.id}`,kind:'array',objectId:range.objectId,range,nodes:viewIds,edges:[],elementBytes:role.elementBytes,
    discoveredAtExecutionId:c.bindingExecutionId??byObject.get(c.ownerObjectId).createdBy,
    storageEvidence:{kind:role.data.cType.kind==='array'?'embedded-array':'bound-array',ownerObjectId:c.ownerObjectId,
      fieldNodeId:role.data.fieldNodeId,executionId:c.bindingExecutionId??byObject.get(c.ownerObjectId).createdBy},
    elementType:role.data.cType.elementType??role.data.cType.pointee,capacity:role.capacity,lifecycle:byObject.get(c.ownerObjectId).lifecycle,
    evidence:['compiler extent and observed backing identity'],snapshot:'physical range including inactive bytes'};
  const candidates=groups.map(group=>{
    function assessment(p,sequence){
      const done=p.records.filter(o=>o.completeSequence<=sequence),good=done.filter(o=>o.status==='supported'),bad=done.filter(o=>o.status==='contradicted'),
        contiguous=good.length>=2&&good.every((o,i)=>o.operation==='insert'&&o.before[p.length.fieldNodeId]===i&&o.after[p.length.fieldNodeId]===i+1&&o.physicalIndex===i),
        bounded=!p.boundEvidence?.length||p.boundEvidence.some(id=>pos.get(id)<=sequence)||p.role==='active-prefix'&&contiguous,
        qualified=good.some(o=>o.operation==='insert')&&(p.role==='active-prefix'?bounded:good.some(o=>o.operation==='remove'))&&
          (p.qualificationEvidence??[]).every(ids=>ids.some(id=>pos.get(id)<=sequence));
      return {p,good,bad,qualified};
    }
    function choose(sequence){
      const evaluated=group.map(p=>assessment(p,sequence)),qualified=evaluated.filter(a=>a.qualified),valid=qualified.filter(a=>!a.bad.length),
        exact=valid.filter(a=>a.p.role!=='active-prefix');
      let pool=exact.length?exact:valid.length?valid:qualified;
      const originProven=pool.filter(a=>a.p.geometry&&a.p.originEvidence?.some(id=>pos.get(id)<=sequence));
      if(originProven.length===1)pool=pool.filter(a=>a===originProven[0]||a.p.geometry||a.p.role!==originProven[0].p.role);
      // A broader deque proof only wins once both-end behavior was observed;
      // prior compatible LIFO/FIFO evidence remains available in its states.
      const distinct=unique(pool.map(a=>JSON.stringify([a.p.role,a.p.head?.fieldNodeId,a.p.geometry,a.p.representation])));
      return distinct.length===1?pool[0]:pool.find(a=>a.p.role==='deque')??null;
    }
    const final=choose(events.length),fallback=final?.p??group[0],raw=group.length?unique(group.flatMap(p=>p.ops)):operations,
      states=c.states.map(({sequence,...s})=>{
        const selected=choose(sequence),p=selected?.p,
          cursor=p?s.fieldValues[p.length.fieldNodeId]:null,
          head=p?.head?s.fieldValues[p.head.fieldNodeId]??null:p?.geometry? p.geometry.origin+p.geometry.bias:0,
          length=p?.tail?mod((s.fieldValues[p.tail.fieldNodeId]??NaN)-head,role.capacity):
            p?.geometry?((cursor??NaN)-p.geometry.origin)*p.geometry.direction:cursor??null,
          direction=p?.geometry?.direction??1,
          rolesAlive=p&&[p.length,p.head,p.tail].filter(Boolean).every(f=>s.liveRoleIds.includes(f.fieldNodeId)),
          bounded=rolesAlive&&Number.isSafeInteger(length)&&length>=0&&length<=role.capacity&&Number.isSafeInteger(head)&&
            (length===0||head>=0&&head<role.capacity)&&(!p.geometry||length===0||head+(length-1)*direction>=0&&head+(length-1)*direction<role.capacity),
          evidence=p?.records??[],pending=evidence.filter(o=>sequence>=o.startSequence&&sequence<o.completeSequence),
          contradicted=selected?.bad.length||evidence.some(o=>o.status==='contradicted'&&sequence>=o.startSequence),
          status=!p?'unresolved':s.currentAccess&&!s.currentAccess.inBounds||contradicted?'inconsistent-or-unavailable':pending.length?'intermediate':!bounded?'inconsistent-or-unavailable':'consistent',
          logicalOrder=status==='consistent'?{start:head,count:length,modulus:role.capacity,direction,mapping:'physicalIndex=(start+logicalIndex*direction)%modulus'}:null,
          active=logicalOrder?Array.from({length},(_,i)=>mod(head+i*direction,role.capacity)):[],
          known=unique(raw.filter(o=>o.access.sequence<=sequence).flatMap(o=>[o.access.physicalIndex,...o.copies?.flatMap(x=>[x.read.physicalIndex,x.write.physicalIndex])??[]])).filter(i=>i>=0&&i<role.capacity),
          domain=shared?known:Array.from({length:role.capacity},(_,i)=>i);
        return {...s,length:Number.isFinite(length)?length:null,head:p?.head?head:null,capacity:role.capacity,status,logicalOrder,
          selectedRole:p?.role??null,selectedHypothesisId:p?.id??null,
          roleAssessments:group.map(h=>{const a=assessment(h,sequence);return {hypothesisId:h.id,role:h.role,qualified:a.qualified,
            status:a.bad.length?'contradicted':a.qualified?'supported':'insufficient-evidence',
            supportingExecutionIds:a.good.map(o=>o.accessExecutionId),contradictingExecutionIds:a.bad.map(o=>o.accessExecutionId)};}),
          ...(shared?{scopeRanges:ranges(range,role.elementBytes,known),inactiveScope:'observed slots of this logical container only'}:{}),
          inactiveRanges:logicalOrder?ranges(range,role.elementBytes,domain.filter(i=>!active.includes(i))):null,
          pendingOperations:pending.map(o=>o.accessExecutionId)};
      });
    const records=fallback?.records??operations.map(o=>record(o,null));
    return {id:shared?`${c.id}:manager:${fallback.length.fieldNodeId}`:c.id,kind:'array-structure',
      storage:role.data.cType.kind==='pointer'?'pointer-backed':role.storage??'embedded',bindingExecutionId:c.bindingExecutionId??null,
      ownerObjectId:c.ownerObjectId,ownerOffset:c.ownerOffset,recordTypeId:role.recordTypeId,range,nodes,edges:[],arrayViewIds:viewIds,
      elementBytes:role.elementBytes,elementType:role.data.cType.elementType??role.data.cType.pointee,capacity:role.capacity,
      queryScoped:shared,roles:{data:role.data,length:fallback?.length??null,head:fallback?.head??null,...(fallback?.tail?{tail:fallback.tail}:{})},
      roleCandidates:final?[final.p.role]:[],
      circularAccess:{observed:c.accesses.some(a=>a.moduloCapacity),evidence:c.accesses.filter(a=>a.moduloCapacity).map(a=>a.executionId),meaning:'wrap alone does not establish FIFO'},
      roleAlternatives:group.map(p=>({hypothesisId:p.id,role:p.role,lengthFieldNodeId:p.length.fieldNodeId,headFieldNodeId:p.head?.fieldNodeId??null,
        representation:p.representation??'indexed-endpoints',geometry:p.geometry??null,originEvidence:p.originEvidence??[],
        status:p.ops.every(o=>p.supported.has(o))?'supported':'contradicted',
        supportingExecutionIds:p.records.filter(o=>o.status==='supported').map(o=>o.accessExecutionId),
        contradictingExecutionIds:p.records.filter(o=>o.status==='contradicted').map(o=>o.accessExecutionId),
        operations:p.records.map(({startSequence,completeSequence,...o})=>o),
        unexplainedAccessExecutionIds:c.accesses.filter(a=>!p.ops.some(o=>o.group.accesses.includes(a))).map(a=>a.executionId)})),
      boundEvidence:fallback?.boundEvidence??[],operationEvidence:records.map(({startSequence,completeSequence,...o})=>o),
      accesses:c.accesses.map(({sequence,...a})=>a),states,latestValidState:states.findLast(s=>s.status==='consistent'&&s.active)??null,
      lifecycle:byObject.get(c.ownerObjectId).lifecycle,confidence:'candidate supported only by evidence available at each execution',
      evidence:[...role.evidence,'recorded targets, updates and value-copy identities'],
      limitations:['observed container behavior is not proof of author intent','unknown and contradictory states are retained'],snapshot:'execution history'};
  });
  return [physical,...candidates];
}
