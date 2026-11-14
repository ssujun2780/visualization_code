// Independently check semantic overlays against their recorded source graph.
import {createValueFlow} from './observed-value-flow.mjs';
import {scalarPayload,comparePayload} from './scalar-domain.mjs';
import {compareKeyValues} from './bst-key-order.mjs';
import {keyMemory,isByteKey} from './key-memory.mjs';
import {createStringComparisonReader} from './string-comparison.mjs';
import {verificationStates} from './history-evidence.mjs';
import {addressSelectionControls} from './address-selection-controls.mjs';
export function validateBSTOverlays(trace,plan){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    objects=new Map(trace.objects.map(o=>[o.id,o])),structures=new Map(trace.structures.map(s=>[s.id,s]));
  const require=(ok,msg)=>{if(!ok)throw new Error(`BST overlay: ${msg}`);},key=r=>`${r?.objectId}:${r?.offset}:${r?.size}`;
  const range=r=>{const o=objects.get(r?.objectId);require(o&&Number.isSafeInteger(r.offset)&&Number.isSafeInteger(r.size)&&r.offset>=0&&r.size>0&&r.offset+r.size<=o.size,'invalid storage range');};
  const edgeKey=e=>`${e.from}|${e.to}|${e.roleId??e.fieldNodeId??e.relationId}`;
  const setEqual=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));
  let valueFlow,stringComparison;const memory=keyMemory(trace),comparisons=new Map();
  function stringAccess(metadata){
    require(plan&&metadata,'missing string comparison contract');
    if(!comparisons.has(metadata.returnExecutionId)){
      valueFlow??=createValueFlow(plan,trace);
      stringComparison??=createStringComparisonReader(plan,trace,valueFlow,memory);
      comparisons.set(metadata.returnExecutionId,stringComparison(events.get(metadata.returnExecutionId)));
    }
    const c=comparisons.get(metadata.returnExecutionId),operand=c?.args[metadata.parameterIndex];
    require(c?.comparison.callExecutionId===metadata.callExecutionId&&operand&&operand.event.stringKey.storage===metadata.storage,'invalid library string operand');
    require(key(operand.event.stringKey.byteRange)===key(metadata.byteRange),'string operand byte identity');
    require((metadata.domain??'nul-terminated-bytes')===operand.event.stringKey.domain&&metadata.byteLimit===operand.event.stringKey.byteLimit,'string comparison domain/length');return operand;
  }
  for(const s of trace.structures){if(s.kind!=='ordered-tree-candidate')continue;
    const source=structures.get(s.sourceStructureId);require(['linked-structure','rooted-index-structure'].includes(source?.kind),'missing source tree');
    const sourceHistory=verificationStates(source,pos);
    if(s.composition)require(s.composition.relation==='child-links'&&
      JSON.stringify(s.composition.conditions)===JSON.stringify(['binary-tree','bst-order']),'invalid condition composition');
    require(s.nodes.length===0&&s.edges.length===0,'semantic overlay created physical nodes');range(s.root);
    for(const p of s.proofs){
      const branch=events.get(p.branchExecutionId),link=events.get(p.linkExecutionId),read=events.get(p.keyReadExecutionId),query=events.get(p.queryReadExecutionId),transfer=events.get(p.transferExecutionId);
      valueFlow??=createValueFlow(plan??{instructions:[]},trace);
      require(branch?.kind==='FLOW'&&['branch','conditional'].includes(branch.action)&&link&&addressSelectionControls(link,valueFlow).includes(branch.eventId),'routing lacks observed branch');
      if(p.stringComparison){const k=stringAccess(p.stringComparison.key),q=stringAccess(p.stringComparison.query);
        require(k.event.eventId===read?.eventId&&q.event.eventId===query?.eventId&&key(k.event.target)===key(p.keyRange)&&key(link.target)===key(p.linkRange),'string key/link identity');
      }else require(read?.kind==='READ'&&query?.kind==='READ'&&key(read.target)===key(p.keyRange)&&key(link.target)===key(p.linkRange),'key/link read identity');
      require(pos.get(read.eventId)<pos.get(branch.eventId)&&pos.get(query.eventId)<pos.get(branch.eventId)&&pos.get(branch.eventId)<pos.get(link.eventId)&&
        transfer&&pos.get(link.eventId)<=pos.get(transfer.eventId)&&p.afterExecutionId===(p.equalityInsertionExecutionId??transfer.eventId),'invalid proof ordering');
      if(p.equalityInsertionExecutionId){const insertion=s.proofs.find(q=>q.kind==='insertion'&&q.linkExecutionId===p.equalityInsertionExecutionId),insert=events.get(p.equalityInsertionExecutionId);
        valueFlow??=createValueFlow({instructions:[]},trace);
        require(insertion&&p.equalInsertion&&insert?.kind==='WRITE'&&insert.activationId===link.activationId&&pos.get(transfer.eventId)<pos.get(insert.eventId)&&
          p.componentReads?.length===s.key.components?.length&&p.componentReads.every(c=>{
            const q=c.stringComparison?stringAccess(c.stringComparison.query).event:events.get(c.queryReadExecutionId),
              k=c.stringComparison?stringAccess(c.stringComparison.key).event:events.get(c.keyReadExecutionId),other=insertion.componentReads.find(x=>x.componentId===c.componentId);
            const a=valueFlow.reads(q.eventId).at(-1),b=other&&valueFlow.reads(other.queryReadExecutionId).at(-1);
            return comparePayload(q.keyPayload??scalarPayload(q.value),k.keyPayload??scalarPayload(k.value)).sign===0&&a&&b&&key(a.target)===key(b.target)&&JSON.stringify(a.dataInputs)===JSON.stringify(b.dataInputs);
          }),'invalid equality insertion continuation');}
      require(['less','greater'].includes(p.direction),'unknown direction');
      for(const id of p.calculationExecutionIds)require(events.get(id)?.kind==='CALC'&&pos.get(id)<pos.get(branch.eventId),'unobserved comparison producer');
      for(const c of p.componentReads??[]){const k=c.stringComparison?stringAccess(c.stringComparison.key).event:events.get(c.keyReadExecutionId),q=c.stringComparison?stringAccess(c.stringComparison.query).event:events.get(c.queryReadExecutionId);
        require((k?.kind==='READ'||k?.stringKey)&&(q?.kind==='READ'||q?.stringKey)&&key(k.target)===key(c.keyRange)&&pos.get(k.eventId)<pos.get(branch.eventId)&&
          pos.get(q.eventId)<pos.get(branch.eventId)&&s.key.components?.some(d=>d.id===c.componentId),'invalid component read');}
      for(const id of p.guardExecutionIds??[])require(['branch','conditional'].includes(events.get(id)?.action)&&pos.get(id)<pos.get(branch.eventId),`invalid comparator guard ${id} before ${branch.eventId}`);
      if(p.kind==='insertion')require(link.kind==='WRITE'&&link.eventId===transfer.eventId&&
        (source.kind==='linked-structure'?link.value?.reference?.status==='in-bounds':link.value?.decimal!==undefined),'insertion transfer');
      else if(p.kind==='call-argument'){
        const access=p.transferStringKey?stringAccess(p.transferStringKey).event:transfer;
        require(link.kind==='READ'&&(access.kind==='READ'||access.stringKey)&&access.eventId===transfer.eventId&&events.get(p.callExecutionId)?.action==='call'&&
          pos.get(link.eventId)<pos.get(p.callExecutionId)&&pos.get(p.callExecutionId)<pos.get(transfer.eventId),'callee key access');
        if(p.transferStringKey){
          valueFlow??=createValueFlow(plan,trace);
          const args=trace.events.filter(e=>e.action==='argument'&&e.callExecutionId===p.callExecutionId&&
            valueFlow.reads(e.eventId).some(r=>r.eventId===link.eventId));
          require(args.some(arg=>arg.activationId===access.activationId&&(access.addressInputs??[]).some(id=>
            valueFlow.dependencyReads(id).some(r=>valueFlow.chain(r.eventId).some(e=>e.eventId===arg.eventId)))),'callee string key parameter identity');
        }
      }
      else require(link.kind==='READ'&&transfer.kind==='WRITE','cursor transfer');
    }
    let before=-1;
    for(const st of s.states){const at=pos.get(st.afterExecutionId);require(at>before,'unordered states');before=at;
      for(const id of st.evidenceExecutionIds)require(pos.has(id)&&pos.get(id)<=at,'future or missing evidence');
      const base=sourceHistory.findLast(x=>pos.get(x.afterExecutionId)<=at);require(base,'missing source state');
      if(s.composition)require(st.relation?.sourceStructureId===source.id&&st.relation.afterExecutionId===base.afterExecutionId&&
        setEqual(new Set(st.relation.roleIds),new Set(st.contracts.map(c=>c.roleId))),'condition relation source or time differs');
      const roles=st.contracts.map(c=>c.roleId),top=source.kind==='linked-structure'?
        base.roleTopologies?.find(p=>p.fieldNodeIds.length===roles.length&&p.fieldNodeIds.every(id=>roles.includes(id)))?.topology??base.topology:base.topology;
      const ids=new Set(st.nodes.map(n=>n.id));require(setEqual(ids,new Set(top.reachableNodeIds)),'semantic node set differs from source');
      // A verified sentinel link is a termination marker, not a child edge.
      // Compare logical edges independently; ordinary/self links still count.
      require(setEqual(new Set(st.edges.map(edgeKey)),new Set(top.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&e.termination!=='sentinel').map(edgeKey))),'semantic edges differ from source');
      for(const n of st.nodes){range(n.range);range(n.keyRange);
        if(s.key.components)require(n.components?.length===s.key.components.length&&n.components.every((c,i)=>c.componentId===s.key.components[i].id&&c.value===n.value[i]),'component identity/value mismatch');
        for(const c of n.components??[n]){range(c.keyRange);
          if(c.value!==null){require(pos.has(c.valueExecutionId)&&pos.get(c.valueExecutionId)<=at,'key has no observed value');
            const descriptor=s.key.components?.find(d=>d.id===c.componentId)??s.key,observed=memory.key(descriptor,c.keyRange,at);
            require(observed&&observed.value===c.value&&(!c.payload||JSON.stringify(c.payload)===JSON.stringify(observed.payload)),'invalid typed key payload');
            if(isByteKey(descriptor))require(c.stringEvidence&&key(c.stringEvidence.range)===key(observed.range),'string snapshot range');}}}
      if(s.key.components&&st.keyOrder)require(st.keyOrder.length===s.key.components.length&&new Set(st.keyOrder.map(c=>c.index)).size===s.key.components.length&&
        st.keyOrder.every(c=>Number.isInteger(c.index)&&c.index>=0&&c.index<s.key.components.length&&[1,-1].includes(c.direction)),'invalid component order');
      if(st.status==='satisfied-observed')require(st.alive&&st.violations.length===0&&roles.length===2&&(!s.key.components||st.keyOrder)&&
        st.nodes.every(n=>(n.components??[n]).every(c=>c.value!==null)),'invalid satisfied state');
      for(const v of st.violations){const n=st.nodes.find(n=>n.id===v.nodeId),a=st.nodes.find(n=>n.id===v.ancestorId),contract=st.contracts.find(c=>c.roleId===v.roleId);
        require(st.status==='violated'&&n&&a&&contract&&JSON.stringify(n.value)===JSON.stringify(v.value)&&JSON.stringify(a.value)===JSON.stringify(v.bound),'invalid violation values');
        require(v.path.at(-1)===n.id&&v.path.slice(0,-1).includes(a.id)&&v.path.every((id,i)=>!i||st.edges.some(e=>e.from===v.path[i-1]&&e.to===id)),'invalid ancestor path');
        const values=x=>x.components?x.components.map(c=>c.payload??c.value):[x.payload??x.value],
          {sign,componentIndex:decisive}=compareKeyValues(values(n),values(a),st.keyOrder??[{index:0,direction:1}]);
        require(sign!==null,'unordered key cannot prove an order violation');
        require((v.direction==='less'?sign>0:sign<0)||sign===0&&contract.duplicates==='excluded-by-insertion-rule','false order violation');
        if(s.key.components)require(v.componentIndex===decisive&&key(v.keyRange)===key(n.components[decisive??0].keyRange)&&
          v.valueExecutionId===n.components[decisive??0].valueExecutionId,'wrong decisive component');
      }
    }
  }
}
