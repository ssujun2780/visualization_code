// A storage overlay inferred from indexed accesses, independent cursor writes,
// and executed cursor comparisons. It does not identify an algorithm or intent.
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const unique=a=>[...new Set(a)];
const number=v=>{const n=Number(v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed));return Number.isSafeInteger(n)?n:null;};
const slot=t=>t&&Number.isSafeInteger(t.offset)&&Number.isSafeInteger(t.size)?{objectId:t.objectId,offset:t.offset,size:t.size}:null;
const key=t=>t?`${t.objectId}:${t.offset}:${t.size}`:null;
function indexCursor(n){
  n=unwrap(n);if(!n)return null;
  if(n.kind==='DeclRefExpr'&&n.declarationId)return {declarationId:n.declarationId,offset:0};
  if(n.kind==='UnaryOperator'&&n.operator==='++'&&n.position==='postfix')return indexCursor(n.children?.[0]);
  if(n.kind==='BinaryOperator'&&['+','-'].includes(n.operator)){
    const a=indexCursor(n.children?.[0]),b=unwrap(n.children?.[1]);
    if(a&&b?.kind==='IntegerLiteral'&&Number.isSafeInteger(Number(b.literal)))return {...a,offset:a.offset+(n.operator==='+'?1:-1)*Number(b.literal)};
  }
  return null;
}

export function queueStructures(plan,{events,objects,structures=[]}){
  const work=structures.find(s=>s.kind==='array-work');if(!work)return [];
  const byEvent=new Map(events.map((e,i)=>[e.eventId,{event:e,index:i}])),defs=new Map(plan.instructions.map(d=>[d.id,d])),
    byObject=new Map(objects.map(o=>[o.id,o])),arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),
    sites=new Map(),comparisons=[];
  for(const d of plan.instructions)for(const root of [d.expression,...d.arguments??[]])for(const n of walk(root))
    if(n.kind==='ArraySubscriptExpr'){const cursor=indexCursor(n.children?.[1]);if(cursor)sites.set(n.nodeId,cursor);}
  function directRead(id,seen=new Set()){
    if(!id||seen.has(id))return null;seen.add(id);const e=byEvent.get(id)?.event;
    if(e?.kind==='READ'&&number(e.value)!==null&&slot(e.target))return e;
    if(e?.kind==='CALC'&&(!e.operator||e.operator==='cast')&&e.dataInputs?.length===1)return directRead(e.dataInputs[0],seen);
    return null;
  }
  for(const e of events)if(e.kind==='CALC')for(const s of e.steps??[]){
    if(!['<','>','!=','=='].includes(s.operator)||s.inputs?.length!==2)continue;
    const a=directRead(s.inputs[0].executionId),b=directRead(s.inputs[1].executionId);
    if(a&&b&&key(a.target)!==key(b.target))comparisons.push({executionId:e.eventId,sourceNodeId:s.nodeId,operator:s.operator,
      left:slot(a.target),right:slot(b.target),readExecutionIds:[a.eventId,b.eventId]});
  }
  const accesses=[];
  for(const a of work.accesses){
    if(!['read','write'].includes(a.direction)||a.target.elementOffset!==0||a.target.size!==a.target.elementBytes)continue;
    const candidates=a.sourceNodeIds.map(id=>sites.get(id)).filter(Boolean);
    if(!candidates.length||unique(candidates.map(c=>`${c.declarationId}:${c.offset}`)).length!==1)continue;
    const site=candidates[0],reads=a.cursors.filter(c=>c.declarationId===site.declarationId&&c.value!==null)
      .map(c=>byEvent.get(c.executionId)).filter(Boolean).sort((a,b)=>b.index-a.index);
    const r=reads[0]?.event;if(!r||!slot(r.target))continue;
    // Prefix increments, nonlinear indexes and ambiguous offsets are left to
    // other overlays; they must not be normalized into a guessed queue.
    if(a.target.index!==number(r.value)+site.offset)continue;
    accesses.push({...a,cursor:slot(r.target),cursorKey:key(r.target),cursorReadExecutionId:r.eventId,cursorValue:number(r.value),indexOffset:site.offset});
  }
  const writes=new Map();
  for(const e of events)if(e.kind==='WRITE'&&slot(e.target)){
    const k=key(e.target);if(!writes.has(k))writes.set(k,[]);writes.get(k).push(e);
  }
  const firstAfter=(list,index)=>{let low=0,high=list.length;while(low<high){const mid=(low+high)>>>1;
    if(byEvent.get(list[mid].eventId).index<=index)low=mid+1;else high=mid;}return low;};
  function updateOrigin(update,access){
    const list=writes.get(access.cursorKey)??[],version=id=>list[firstAfter(list,byEvent.get(id).index-1)-1]?.eventId??null;
    const accessVersion=version(access.cursorReadExecutionId),seen=new Set();
    function search(id){
      if(!id||seen.has(id))return null;seen.add(id);const e=byEvent.get(id)?.event;if(!e)return null;
      if(e.kind==='READ'&&key(e.target)===access.cursorKey)
        return number(e.value)===access.cursorValue&&version(id)===accessVersion?id:null;
      // Follow value provenance only. An unrelated assignment, address, or
      // controlling comparison is not an increment of the indexed cursor.
      if(e.kind==='FLOW'||(e.kind==='WRITE'&&key(e.target)===access.cursorKey))return null;
      for(const parent of e.dataInputs??[]){const found=search(parent);if(found)return found;}return null;
    }
    for(const id of update?.dataInputs??[]){const found=search(id);if(found)return found;}return null;
  }
  const results=[];
  for(const array of arrays.values()){
    const own=accesses.filter(a=>a.target.arrayId===array.id),readKeys=unique(own.filter(a=>a.direction==='read').map(a=>a.cursorKey)),
      writeKeys=unique(own.filter(a=>a.direction==='write').map(a=>a.cursorKey));
    for(const frontKey of readKeys)for(const backKey of writeKeys){
      if(frontKey===backKey)continue;
      const compare=comparisons.filter(c=>(key(c.left)===frontKey&&key(c.right)===backKey&&c.operator!=='>' )||
        (key(c.left)===backKey&&key(c.right)===frontKey&&c.operator!=='<'));
      if(!compare.length)continue;
      const frontAccesses=own.filter(a=>a.direction==='read'&&a.cursorKey===frontKey),backAccesses=own.filter(a=>a.direction==='write'&&a.cursorKey===backKey),
        offsets=unique([...frontAccesses,...backAccesses].map(a=>a.indexOffset));
      if(offsets.length!==1)continue;
      const offset=offsets[0],front=frontAccesses[0].cursor,back=backAccesses[0].cursor;
      if(!byObject.has(front.objectId)||!byObject.has(back.objectId))continue;
      function operations(list,role){
        return list.map((a,i)=>{
          const start=byEvent.get(a.cursorReadExecutionId).index,at=byEvent.get(a.executionId).index,
            next=i+1<list.length?byEvent.get(list[i+1].cursorReadExecutionId).index:Infinity;
          // The update may precede the array access (postfix lowering) or
          // follow it as a separate statement. Preserve both observed times.
          const writeList=writes.get(a.cursorKey)??[],following=writeList[firstAfter(writeList,start)],
            update=following&&byEvent.get(following.eventId).index<next?following:null;
          const after=number(update?.value),origin=updateOrigin(update,a),
            status=!update||after===null?'partial':after!==a.cursorValue+1?'contradicted':origin?'supported':'partial';
          const done=update?Math.max(at,byEvent.get(update.eventId).index):at;
          return {kind:role==='front'?'dequeue':'enqueue',role,accessExecutionId:a.executionId,cursorReadExecutionId:a.cursorReadExecutionId,
            updateExecutionId:update?.eventId??null,updateOriginExecutionId:origin,startedAtExecutionId:events[start].eventId,completedAtExecutionId:status==='partial'?null:events[done].eventId,
            index:a.target.index,cursorBefore:a.cursorValue,cursorAfter:after,status,
            reason:!update?'missing-update':after===null?'unobserved-update-value':after!==a.cursorValue+1?'unexpected-cursor-progress':!origin?'unproven-update-origin':null,
            evidence:'observed array access and cursor write; supported updates retain value dependency on the same cursor version',sourceNodeIds:a.sourceNodeIds};
        });
      }
      const ops=[...operations(frontAccesses,'front'),...operations(backAccesses,'back')].sort((a,b)=>byEvent.get(a.accessExecutionId).index-byEvent.get(b.accessExecutionId).index);
      if(!ops.some(o=>o.kind==='dequeue'&&o.status==='supported')||!ops.some(o=>o.kind==='enqueue'&&o.status==='supported'))continue;
      const changes=new Set([...writes.get(frontKey)??[],...writes.get(backKey)??[]].map(e=>e.eventId));
      for(const o of ops){changes.add(o.accessExecutionId);if(o.updateExecutionId)changes.add(o.updateExecutionId);}
      for(const c of compare)changes.add(c.executionId);
      const endedBy=unique([array.objectId,front.objectId,back.objectId].map(id=>byObject.get(id)?.endedBy).filter(Boolean));
      for(const id of endedBy)changes.add(id);
      const starts=new Map(),ends=new Map(),contradictions=new Map(),pendingOperations=new Map();
      for(const o of ops){const start=Math.min(byEvent.get(o.accessExecutionId).index,o.updateExecutionId?byEvent.get(o.updateExecutionId).index:Infinity),
        end=o.completedAtExecutionId?byEvent.get(o.completedAtExecutionId).index:Infinity;
        if(start<end){if(!starts.has(start))starts.set(start,[]);starts.get(start).push(o);if(Number.isFinite(end)){if(!ends.has(end))ends.set(end,[]);ends.get(end).push(o);}}
        if(o.status==='contradicted'){if(!contradictions.has(end))contradictions.set(end,[]);contradictions.get(end).push(o.accessExecutionId);}}
      const states=[];let frontValue=null,backValue=null;
      for(let i=0;i<events.length;i++){
        const e=events[i],k=key(e.target);
        if(['READ','WRITE'].includes(e.kind)){if(k===frontKey)frontValue=number(e.value);if(k===backKey)backValue=number(e.value);}
        for(const o of starts.get(i)??[])pendingOperations.set(o.accessExecutionId,o);
        for(const o of ends.get(i)??[])pendingOperations.delete(o.accessExecutionId);
        if(!changes.has(e.eventId))continue;
        const pending=[...pendingOperations.values()];
        const start=frontValue===null?null:frontValue+offset,end=backValue===null?null:backValue+offset,
          valid=start!==null&&end!==null&&start>=0&&end>=start&&end<=array.capacity,
          mismatch=contradictions.get(i)??[],
          ended=endedBy.some(id=>byEvent.get(id)?.index<=i),status=ended?'ended':pending.some(o=>['unproven-update-origin','unobserved-update-value'].includes(o.reason))?'partial':pending.length?'intermediate':start===null||end===null?'partial':!valid||mismatch.length?'contradicted':'supported';
        states.push({executionId:e.eventId,status,front:frontValue,back:backValue,capacity:array.capacity,
          activeRange:start===null||end===null?null:{start,end,interval:'half-open',valid},
          logicalOrder:status==='supported'?{start,length:end-start,stride:1}:null,
          pendingAccessExecutionIds:pending.map(o=>o.accessExecutionId),contradictingExecutionIds:mismatch.length?mismatch:status==='contradicted'?[e.eventId]:[],
          validityScope:'observed cursor interval and completed endpoint operations; not proof of queue intent or all slot initialization',
          physicalValues:'unchanged; refer to the array storage at this execution'});
      }
      const supporting=['dequeue','enqueue'].map(kind=>ops.find(o=>o.kind===kind&&o.status==='supported').completedAtExecutionId).concat(compare[0].executionId),
        inferredAt=supporting.reduce((a,b)=>byEvent.get(a).index>byEvent.get(b).index?a:b);
      results.push({id:`queue:${array.id}:${frontKey}:${backKey}`,kind:'queue-candidate',views:['fifo-candidate'],classification:'candidate',origin:'inferred',intent:'unconfirmed',
        arrayId:array.id,objectId:array.objectId,range:array.range,elementBytes:array.elementBytes,capacity:array.capacity,nodes:array.nodes??[],edges:[],
        roles:{front,back,indexOffset:offset},inferredAtExecutionId:inferredAt,operations:ops,comparisons:compare,states,
        evidence:['compiler array-index identities','recorded cursor reads and writes','executed comparison between cursor storage'],
        limitations:['linear cursors only; wraparound and prefix-index conventions remain unclassified','candidate does not establish user intent','incomplete updates remain intermediate; invalid states are not repaired']});
    }
  }
  return results;
}
