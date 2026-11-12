import {complete,storage,port,unique,intersects,overlapBounds} from './common.mjs';

export function bitPreservingCast(step){const a=step?.conversion?.fromType,b=step?.conversion?.toType;
  const integer=t=>t&&['signed','unsigned'].includes(t.signedness)&&t.encoding!=='DW_ATE_boolean'&&t.kind!=='boolean'&&t.sizeBits>0;
  return integer(a)&&integer(b)&&a.sizeBits===b.sizeBits;
}
export function transform(c,e,step){
  if(step){if(step.conversion)return bitPreservingCast(step)?'cast':'conversion';return step.operator==='cast'?'cast':step.operator==='?:'?'choice':'calculated';}
  if(e.kind==='READ')return e.action==='input'?'input':'read';
  if(e.kind==='SPACE'&&e.action==='object.begin'&&e.memoryState)return 'initialization';
  if(e.kind==='CALC'){const op=e.operator??c.instruction(e.instructionId)?.operator;return op==='cast'?'cast':op==='?:'?'choice':'calculated';}
  if(e.action==='argument')return 'argument';if(['return.value','return','resume'].includes(e.action))return 'return';
  if(e.action==='copy')return 'range-copy';if(e.action==='write.range')return 'range-effect';if(e.action==='output')return 'output';if(['fill','zero','initialize'].includes(e.action))return 'fill';
  return e.kind==='WRITE'?'identity':'observation';
}
export function buildProvenance(c,events,access,calls,emit,result){
  const nodes=[],edges=[],byId=new Map(),incoming=new Map(),memory=new Map(),steps=new Map(),edgeKeys=new Set();let edgesTruncated=false;
  const addNode=node=>{if(byId.has(node.id))return byId.get(node.id);byId.set(node.id,node);nodes.push(node);return node;};
  const edge=(from,to,role,details={})=>{
    if(!from||!to||from.id===to.id)return;
    if(c.position(from.executionId)>c.position(to.executionId)||from.executionId===to.executionId&&from.order>=to.order){to.unresolved.push('noncausal-producer');return;}
    const key=JSON.stringify([from.id,to.id,role,details]);if(edgeKeys.has(key))return;
    if(edges.length>=c.limits.maxProvenanceEdges){if(!edgesTruncated)emit.truncate('maxProvenanceEdges',to.executionId);edgesTruncated=true;to.unresolved.push('edge-budget');return;}
    edgeKeys.add(key);const row={id:`p:${edges.length}`,from:from.id,to:to.id,role,...details};edges.push(row);
    const list=incoming.get(to.id)??[];list.push(row);incoming.set(to.id,list);
  };
  const find=(ref,e)=>{
    const producer=c.resolveRef(ref,e.eventId);if(!producer)return null;
    if(ref?.observationId){const spec=c.observationFor(ref,e.eventId);if(spec?.step)return steps.get(spec.step)??null;}
    return byId.get(`v:${producer.eventId}`)??null;
  };
  const spans=range=>{const rows=memory.get(range.objectId)??[],[start,end]=overlapBounds(rows,range);return rows.slice(start,end);};
  const setProducer=(target,producer,initialization)=>{const old=memory.get(target.objectId)??[],[start,end]=overlapBounds(old,target),first=old[start],last=old[end-1],replacement=[];
    if(end>start&&first.offset<target.offset)replacement.push({...first,size:target.offset-first.offset});
    replacement.push({...target,producer,...(initialization?{initialization}:{})});
    if(end>start&&last.offset+last.size>target.offset+target.size)replacement.push({...last,offset:target.offset+target.size,size:last.offset+last.size-target.offset-target.size});
    old.splice(start,end-start,...replacement);memory.set(target.objectId,old);};
  const explicit=new Map((c.observationEvidence?.bindings??[]).map(b=>[b.executionId,b]));
  for(const e of events){if(!emit.tick(e.eventId))break;emit.progress('provenance',e);if(!complete(e))continue;
    const node=addNode({id:`v:${e.eventId}`,executionId:e.eventId,order:(e.steps?.length??0)+1,transform:transform(c,e),unresolved:[]});
    if(e.kind==='READ'&&e.action==='read'&&!storage(c,e.target,e))node.unresolved.push('unmapped-storage-target');
    if(calls?.unresolved.has(e.eventId))node.unresolved.push('unresolved-call-transfer');
    let order=0;
    for(const step of e.steps??[]){const ids=unique([step.observationId,...step.observationIds??[]]);
      const s=addNode({id:`s:${e.eventId}:${order}`,executionId:e.eventId,observationIds:ids,sourceNodeId:step.nodeId??null,order:order++,transform:transform(c,e,step),unresolved:[]});steps.set(step,s);}
    function inputs(target,rows,defaultRole='value'){for(let i=0;i<rows.length;i++){
      const input=rows[i],producer=c.resolveRef(input,e.eventId),id=producer?.eventId;
      const role=['address','control','callee'].includes(input.role)?input.role:
        id&&!e.dataInputs?.includes(id)&&e.addressInputs?.includes(id)?'address':id&&!e.dataInputs?.includes(id)&&e.controlInputs?.includes(id)?'control':defaultRole;
      if(input.executionId||input.observationId){const source=find(input,e);
        if(source)edge(source,target,role,{path:'operand'});else target.unresolved.push(`unresolved-${role}-operand`);
      }else if(input.kind==='memory-range'){
            const range=storage(c,input,e);if(range)for(const prior of spans(range))edge(byId.get(prior.producer),target,role,{path:'memory',range:{objectId:range.objectId,offset:Math.max(prior.offset,range.offset),size:Math.min(prior.offset+prior.size,range.offset+range.size)-Math.max(prior.offset,range.offset)}});
      }else if(input.value!==undefined){const literal=input.value.literal!==undefined||input.kind==='immediate';
        const source=addNode({id:`literal:${target.id}:${i}`,executionId:e.eventId,order:-1,transform:literal?'literal':'captured-input',inputRef:{instructionId:e.instructionId,executionId:e.eventId,stepOrder:target===node?null:target.order,inputIndex:i},unresolved:literal?[]:['unbound-input-observation']});edge(source,target,role,{path:'operand'});}
    }}
    for(const step of e.steps??[])inputs(steps.get(step),step.inputs??[]);
    inputs(node,e.inputs??[],['resume','write.range','copy','fill'].includes(e.action)?'callee':e.kind==='READ'?e.action==='input'?'control':'address':'value');
    for(const [key,role]of [['dataInputs','value'],['addressInputs','address'],['controlInputs','control'],['calleeInputs','callee']]){
      if(e.kind==='READ'&&key==='dataInputs')continue;
      for(const ref of e[key]??[]){const producer=c.resolveRef(ref,e.eventId),source=producer&&byId.get(`v:${producer.eventId}`);
        if(source)edge(source,node,role,{path:'recorded'});else node.unresolved.push(`unresolved-${role}`);}
    }
    const root=(e.steps??[]).filter(s=>s.nodeId&&s.nodeId===c.instruction(e.instructionId)?.expression?.nodeId).at(-1)??e.steps?.at(-1);
    if(root)edge(steps.get(root),node,'value',{path:'internal-result'});
    for(const input of explicit.get(e.eventId)?.inputs??[]){const source=find(input,e);if(source)edge(source,node,input.role??'value',{path:'supplementary'});else node.unresolved.push('unresolved-supplementary');}
    for(const read of access.byExecution.get(e.eventId)??[]){if(read.mode!=='read')continue;
      let covered=0;
      for(const prior of spans(read)){
        const from=byId.get(prior.producer),offset=Math.max(prior.offset,read.offset),size=Math.min(prior.offset+prior.size,read.offset+read.size)-offset;
        edge(from,node,'value',{path:'memory',range:{objectId:read.objectId,offset,size}});covered+=size;
        if(prior.initialization&&prior.initialization!=='initialized')node.unresolved.push('uninitialized-source');
      }
      // Explicit memory producers can fill a gap, but cannot replace an observed later write.
      if(covered<read.size){let explicitCoverage=0;
        for(const id of e.kind==='READ'?e.dataInputs??[]:[]){const producer=c.resolveRef(id,e.eventId),source=producer&&byId.get(`v:${producer.eventId}`),target=producer&&storage(c,producer.target,producer);
          if(source&&producer.kind==='WRITE'&&target&&intersects(target,read)){
            const offset=Math.max(target.offset,read.offset),size=Math.min(target.offset+target.size,read.offset+read.size)-offset;
            const overlaps=spans({...read,offset,size}).length>0;
            if(!overlaps){edge(source,node,'value',{path:'recorded-memory',range:{objectId:read.objectId,offset,size}});explicitCoverage+=size;}
          }}
        if(covered+explicitCoverage<read.size)node.unresolved.push('unobserved-memory-producer');
      }
    }
    const target=storage(c,e.target,e);
    if(e.kind==='WRITE'&&target){
      setProducer(target,node.id);
    }
    if(e.kind==='SPACE'&&e.action==='object.begin')for(const range of e.memoryState?.ranges??[]){const initialized=storage(c,{objectId:e.objectId,offset:range.offset,size:range.length},e);if(initialized)setProducer(initialized,node.id,range.initialization);}
    if(['WRITE','CALC'].includes(e.kind)&&e.value!==undefined&&!['fill','range-copy'].includes(node.transform)&&!(incoming.get(node.id)?.length))node.unresolved.push('unrecorded-value-input');
    node.unresolved=unique(node.unresolved);
    if(node.unresolved.length)emit.issue('unresolved-provenance',{executionId:e.eventId,reasons:node.unresolved});
    if(['WRITE','CALC'].includes(e.kind)||port(e)){
      const p=target??port(e),sources=(incoming.get(node.id)??[]).filter(x=>x.role==='value');
      emit.relation(e.kind==='WRITE'?'value-transfer':'value-dependency',e,p?[{...p,role:e.kind==='WRITE'?'output':'result'}]:[],
        {provenanceId:node.id,mechanism:node.transform,inputNodeIds:unique(sources.map(x=>x.from)),complete:node.unresolved.length===0},unique([e.eventId,...sources.map(x=>byId.get(x.from).executionId)]));
    }
  }
  result.provenance={nodes,edges};return {nodes,edges,byId,incoming};
}

export function originsOf(c,graph,valueRef,atExecutionId,{limit=c.limits.maxQueryItems,depth=c.limits.maxOriginDepth,roles=['value']}={}){
  if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(depth)||depth<1)throw new RangeError('출처 조회 예산은 양의 정수여야 합니다.');
  limit=Math.min(limit,c.limits.maxQueryItems);depth=Math.min(depth,c.limits.maxOriginDepth);
  const at=atExecutionId===null?-1:c.position(atExecutionId);if(at===undefined)throw new RangeError('출처 조회 시점이 없습니다.');
  const event=c.resolveRef(valueRef,atExecutionId),id=typeof valueRef==='string'&&graph.byId.has(valueRef)?valueRef:event?`v:${event.eventId}`:null;
  const root=graph.byId.get(id);if(!root||c.position(root.executionId)>at)return {nodes:[],edges:[],complete:false,unresolved:['unavailable-value']};
  const nodes=[],edges=[],seen=new Set(),todo=[{id:root.id,depth:0}],unresolved=new Set();
  while(todo.length){if(nodes.length>=limit){unresolved.add('query-budget');break;}const current=todo.pop();if(seen.has(current.id))continue;seen.add(current.id);
    const node=graph.byId.get(current.id);if(!node||c.position(node.executionId)>at){unresolved.add('unavailable-producer');continue;}nodes.push(node);for(const r of node.unresolved??[]){const role=/^unresolved-(value|address|control|callee)(?:-|$)/.exec(r)?.[1];if(!role||roles.includes(role))unresolved.add(r);}
    const incoming=(graph.incoming.get(node.id)??[]).filter(e=>roles.includes(e.role));
    if(current.depth>=depth&&incoming.length){unresolved.add('origin-depth');continue;}
    for(const edge of incoming){if(edges.length>=limit){unresolved.add('query-budget');continue;}edges.push(edge);todo.push({id:edge.from,depth:current.depth+1});}
  }
  // A truncated edge must never refer to an omitted node as if expansion completed.
  const ids=new Set(nodes.map(n=>n.id));return structuredClone({nodes,edges:edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),complete:unresolved.size===0,unresolved:[...unresolved]});
}
