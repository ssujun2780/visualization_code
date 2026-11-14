import {complete,unique,check,storage,overlapBounds} from './common.mjs';
import {bitPreservingCast} from './provenance.mjs';

export function workIndex(c,events,tree,emit){
  const scopes=[],provided=new Set(),byFrame=new Map(),byEvent=new Map(),activeExpressions=new Map(),loopState=new Map(),regions=c.compilerFacts?.regions??[];
  const remember=scope=>{scopes.push(scope);const list=byFrame.get(scope.activationId)??[];list.push(scope);byFrame.set(scope.activationId,list);};
  for(const r of regions){check(typeof r.id==='string'&&['loop','branch'].includes(r.kind),'잘못된 제어 영역 근거입니다.');
    for(const id of [...r.entryInstructionIds??[],...r.exitInstructionIds??[],...r.memberInstructionIds??[]])check(c.instruction(id),'제어 영역의 명령이 없습니다.');
    for(const edge of [...r.entryEdges??[],...r.exitEdges??[]])check(c.instruction(edge.instructionId)?.destinations?.includes(edge.selected),'제어 영역의 컴파일 분기 간선이 없습니다.');}
  const owner=new Map();for(const instruction of c.plan.instructions){const root=instruction.expression;if(!root?.nodeId)continue;
    const todo=[root],members=[];while(todo.length){const n=todo.pop();if(!n)continue;if(n.nodeId)members.push(n.nodeId);todo.push(...n.children??[]);}
    for(const id of members){const prev=owner.get(id);if(!prev||members.length>prev.size)owner.set(id,{root:root.nodeId,size:members.length});}}
  const mapping=new Map((c.compilerFacts?.expressionOwners??[]).map(x=>{check(c.instruction(x.instructionId)&&c.instructionNodes.has(x.nodeId),'표현식 대응 근거가 없습니다.');return [x.instructionId,x.nodeId];}));
  let ordinal=0;
  for(const e of events){if(!emit.tick(e.eventId))break;emit.progress('work',e);if(!complete(e))continue;const frame=tree.frames.get(e.activationId),definition=c.instruction(e.instructionId);if(!frame)continue;
    const ids=[`work:call:${frame.id}`];
    if(e.action==='frame.begin'){
      const scope={id:ids[0],kind:'call',activationId:frame.id,parentId:frame.parent?`work:call:${frame.parent}`:null,availableAtExecutionId:e.eventId,entryExecutionId:e.eventId};remember(scope);
      const r=emit.relation('work-scope',e,[{kind:'activation',role:'owner',activationId:frame.id}],scope);if(r){scope.relationId=r.id;provided.add(scope.id);}
    }
    for(const region of regions){if(region.functionId&&region.functionId!==frame.functionId)continue;const key=`${frame.id}:${region.id}`,state=loopState.get(key)??{ordinal:0,current:null};
      const edgeMatches=edge=>edge.instructionId===e.instructionId&&edge.selected===e.selected;
      if(region.exitInstructionIds?.includes(e.instructionId)||region.exitEdges?.some(edgeMatches)){if(state.current)state.current.endedAtExecutionId=e.eventId;state.current=null;}
      if(region.entryInstructionIds?.includes(e.instructionId)||region.entryEdges?.some(edgeMatches)){
        if(state.current)state.current.endedAtExecutionId=e.eventId;
        const scope={id:`work:${key}:${++state.ordinal}`,kind:region.kind==='loop'?'iteration':'branch',activationId:frame.id,parentId:ids[0],regionId:region.id,
          ...(region.kind==='loop'?{iteration:state.ordinal}:{}),availableAtExecutionId:e.eventId,entryExecutionId:e.eventId};state.current=scope;remember(scope);if(emit.relation('work-scope',e,[],scope))provided.add(scope.id);
      }
      if(state.current&&region.memberInstructionIds?.includes(e.instructionId))ids.push(state.current.id);loopState.set(key,state);
    }
    const source=mapping.get(e.instructionId)??owner.get(definition.sourceNodeId)?.root??definition.expression?.nodeId??definition.sourceNodeId;
    if(source&&!['SPACE','FLOW'].includes(e.kind)){
      const key=`${frame.id}:${source}`,prior=activeExpressions.get(frame.id);
      if(!prior||prior.key!==key||prior.finished){
        const scope={id:`work:expression:${frame.id}:${++ordinal}`,key,kind:'expression',activationId:frame.id,parentId:ids.at(-1),sourceNodeId:source,availableAtExecutionId:e.eventId,entryExecutionId:e.eventId};
        if(prior&&!prior.endedAtExecutionId)prior.endedAtExecutionId=e.eventId;activeExpressions.set(frame.id,scope);remember(scope);if(emit.relation('work-scope',e,[],{...scope}))provided.add(scope.id);
      }
      const current=activeExpressions.get(frame.id);ids.push(current.id);if(e.kind==='WRITE')current.finished=true;
    }
    if(e.action==='frame.end'){for(const scope of byFrame.get(frame.id)??[])if(!scope.endedAtExecutionId)scope.endedAtExecutionId=e.eventId;}
    byEvent.set(e.eventId,ids.filter(id=>provided.has(id)));
  }
  // End points are stored as changes so an earlier query cannot expose them.
  for(const scope of scopes)if(scope.endedAtExecutionId)emit.relation('work-scope-end',c.event(scope.endedAtExecutionId),[],{workScopeId:scope.id},[scope.endedAtExecutionId],{workScopeIds:[scope.id]});
  return {scopes,byEvent};
}

export function transferRelations(c,events,graph,access,work,emit){
  const groups=new Map(),copiesByWrite=new Map(),currentByObject=new Map(),fanouts=new Map();
  const locationKey=s=>`${s.objectId}:${s.createdBy}:${s.offset}:${s.size}`;
  function latest(location){const rows=currentByObject.get(location.objectId)??[],[start,end]=overlapBounds(rows,location);
    return end-start===1&&rows[start].offset===location.offset&&rows[start].size===location.size?rows[start]:null;}
  for(const e of events){if(!emit.tick(e.eventId))break;emit.progress('transfers',e);if(!complete(e)||e.kind!=='WRITE')continue;const destination=storage(c,e.target,e);if(!destination)continue;
    const currentRows=currentByObject.get(destination.objectId)??[],[overwriteStart,overwriteEnd]=overlapBounds(currentRows,destination);
    currentRows.splice(overwriteStart,overwriteEnd-overwriteStart);currentByObject.set(destination.objectId,currentRows);
    let source=null,read=null;
    if(e.action==='copy')source=storage(c,{objectId:e.sourceObjectId,offset:e.sourceOffset,size:e.sourceSize},e);
    else{
      let node=graph.byId.get(`v:${e.eventId}`),seen=new Set();
      while(node&&!seen.has(node.id)){seen.add(node.id);const producer=c.event(node.executionId);
        if(node.unresolved.includes('unresolved-call-transfer'))break;
        if(node.transform==='read'){source=storage(c,producer.target,producer);read=producer;break;}
        if(!['identity','argument','return','cast'].includes(node.transform))break;
        if(node.transform==='cast'){
          const steps=producer.steps??[];if(!steps.length||!steps.every(bitPreservingCast))break;
        }
        const incoming=(graph.incoming.get(node.id)??[]).filter(x=>x.role==='value'),internal=incoming.filter(x=>x.path==='internal-result');
        const inputs=unique((internal.length?internal:incoming).map(x=>x.from));if(inputs.length!==1)break;node=graph.byId.get(inputs[0]);
      }
    }
    if(!source||source.size!==destination.size)continue;
    const r=emit.relation('storage-copy',e,[{...source,role:'source'},{...destination,role:'destination'}],{readExecutionId:read?.eventId??null,writeExecutionId:e.eventId,provenanceId:`v:${e.eventId}`,mechanism:e.action==='copy'?'recorded-range-copy':'identity-path'},unique([read?.eventId,e.eventId]),{workScopeIds:work.byEvent.get(e.eventId)??[]});
    if(!r)continue;
    const priorEdges=read?(graph.incoming.get(`v:${read.eventId}`)??[]).filter(edge=>edge.role==='value'&&['memory','recorded-memory'].includes(edge.path)):[],
      priorCopies=priorEdges.map(edge=>({edge,prior:copiesByWrite.get(graph.byId.get(edge.from)?.executionId)})).filter(x=>x.prior);
    for(const {edge,prior}of priorCopies)emit.relation('transfer-dependency',e,[],{predecessorTransferId:prior.relation.id,transferId:r.id,range:edge.range??null},[e.eventId],
      {evidence:{executionIds:[e.eventId],planNodeIds:[],relationIds:[prior.relation.id,r.id]}});
    const exact=priorCopies.length===1&&priorEdges.length===1&&priorCopies[0].edge.range?.offset===source.offset&&priorCopies[0].edge.range?.size===source.size&&priorCopies[0].prior.offset===source.offset&&priorCopies[0].prior.size===source.size?priorCopies[0].prior:null,
      rootRead=exact?.rootRead??read,root=rootRead?storage(c,rootRead.target,rootRead):null;
    r.details.rootReadExecutionId=rootRead?.eventId??null;
    const entry={...destination,relation:r,rootRead,root};copiesByWrite.set(e.eventId,entry);
    if(root&&root.size===destination.size){
      const rootKey=locationKey(root),destinationKey=locationKey(destination),fanKey=rootRead.eventId,fan=fanouts.get(fanKey)??{destinations:new Set(),previous:null};
      const newDestination=!fan.destinations.has(destinationKey);fan.destinations.add(destinationKey);
      if(newDestination&&fan.previous)emit.relation('fan-out-transfer',e,[],{rootReadExecutionId:rootRead.eventId,previousTransferId:fan.previous.id,transferId:r.id,distinctDestinationCount:fan.destinations.size},[e.eventId],
        {evidence:{executionIds:[e.eventId],planNodeIds:[],relationIds:[fan.previous.id,r.id]}});
      fan.previous=r;fanouts.set(fanKey,fan);
      const chain=[entry],seen=new Set([destinationKey]);let next=rootKey===destinationKey?null:latest(root),closed=false;
      while(next&&chain.length<c.limits.maxOriginDepth){const key=locationKey(next);if(seen.has(key))break;seen.add(key);chain.push(next);
        if(!next.root||!next.rootRead)break;
        if(locationKey(next.root)===destinationKey){closed=true;break;}next=latest(next.root);}
      if(next&&chain.length>=c.limits.maxOriginDepth)emit.issue('composition-depth-limit',{executionId:e.eventId});
      const chainByDestination=new Map(chain.map(item=>[locationKey(item),item]));
      if(closed&&chain.every(item=>{const target=chainByDestination.get(locationKey(item.root)),object=c.object(item.objectId),end=c.position(object.endedBy);
        return target&&c.position(item.rootRead.eventId)<c.position(target.relation.details.writeExecutionId)&&(end===undefined||end>c.position(e.eventId));})){
        const ids=chain.map(item=>item.relation.id);emit.relation('transfer-cycle',e,[],{transferIds:ids,extent:'observed-version-cycle'},[e.eventId],{evidence:{executionIds:[e.eventId],planNodeIds:[],relationIds:ids}});
      }
    }
    const [insert]=overlapBounds(currentRows,destination);currentRows.splice(insert,0,entry);
    if(!access.byExecution.get(e.eventId)?.some(a=>a.mode==='write'&&a.payload))continue;
    const key=`${e.activationId}:${destination.objectId}`,group=groups.get(key)??{id:`transfer-group:${key}`,transfers:[],sources:new Set(),previousSummary:null};
    const sourceKey=`${source.objectId}:${source.offset}:${source.size}`,newSource=!group.sources.has(sourceKey);
    group.transfers.push(r.id);group.sources.add(sourceKey);groups.set(key,group);
    emit.relation('transfer-group-entry',e,[],{groupId:group.id,context:'activation',transferId:r.id,ordinal:group.transfers.length},[e.eventId],{evidence:{executionIds:[e.eventId],planNodeIds:[],relationIds:[r.id]}});
    if(newSource&&group.sources.size>1){const previous=group.previousSummary?.id??group.transfers[0];
      group.previousSummary=emit.relation('multi-source-transfer',e,[],{groupId:group.id,context:'activation',extent:'observed-prefix',addedTransferId:r.id,previousRelationId:previous,sourceRangeCount:group.sources.size},[e.eventId],
        {evidence:{executionIds:[e.eventId],planNodeIds:[],relationIds:[previous,r.id]}});
    }
  }
}

export function structureRelations(c,access,emit){
  const input=c.structureInference;if(!input)return;
  const bindings=[...input.storageBindings??[]],arrays=[];
  for(const s of input.structures??[]){
    for(const node of s.nodes??[])if(node&&typeof node==='object'&&node.range&&node.discoveredAtExecutionId)bindings.push({...node.range,structureId:s.id,elementId:node.id,availableAtExecutionId:node.discoveredAtExecutionId});
    if(s.kind==='array'&&s.range&&Number.isSafeInteger(s.elementBytes)&&s.elementBytes>0){const o=c.object(s.range.objectId);
      const known=s.availableAtExecutionId??s.discoveredAtExecutionId??(o?.cType?.kind==='array'&&s.range.offset===0&&s.range.size===o.size?o.createdBy:null);
      if(known)arrays.push({...s,known});else emit.issue('missing-structure-binding-time',{structureId:s.id});}
  }
  const indexed=new Map();
  for(const b of bindings){const known=c.position(b.availableAtExecutionId);if(known===undefined){emit.issue('missing-structure-binding-time');continue;}
    const o=c.object(b.objectId);if(!o||!b.structureId||!b.elementId){emit.issue('invalid-structure-storage-binding');continue;}
    check(Number.isSafeInteger(b.offset)&&b.offset>=0&&Number.isSafeInteger(b.size)&&b.size>=0&&b.offset+b.size<=o.size,'구조 대응의 저장 범위가 잘못되었습니다.');
    const list=indexed.get(b.objectId)??[];list.push({...b,known});indexed.set(b.objectId,list);
  }
  for(const list of indexed.values()){list.sort((a,b)=>a.offset-b.offset);let max=0;for(const b of list){max=Math.max(max,b.offset+b.size);b.prefixMaxEnd=max;}}
  const emittedBindings=new Set();
  const emitBinding=(a,b)=>{const o=c.object(a.objectId),
      start=Number.isSafeInteger(b.offset)?Math.max(a.offset,b.offset):a.offset,
      end=Number.isSafeInteger(b.size)?Math.min(a.offset+a.size,b.offset+b.size):a.offset+a.size,
      matchedRange={objectId:a.objectId,offset:start,size:end-start},
      identity=JSON.stringify([a.executionId,a.mode,b.structureId,b.elementId,b.availableAtExecutionId,matchedRange]);
      if(end<=start||emittedBindings.has(identity))return;emittedBindings.add(identity);
      emit.relation('structure-access',c.event(a.executionId),[{kind:'structure-element',role:a.mode,structureId:b.structureId,elementId:b.elementId,bindingExecutionId:b.availableAtExecutionId},
        {kind:'storage',role:'backing',objectId:a.objectId,createdBy:o.createdBy,offset:a.offset,size:a.size}],{bindingId:b.id??null,matchedRange,mappingOrigin:b.origin??'inferred'},[b.availableAtExecutionId,a.executionId]);
  };
  for(const a of access.rows){if(!emit.tick(a.executionId))break;emit.progress('structures',c.event(a.executionId));
    const list=indexed.get(a.objectId)??[];let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid].offset<a.offset+a.size)lo=mid+1;else hi=mid;}
    for(let i=lo-1;i>=0&&list[i].prefixMaxEnd>a.offset;i--){const b=list[i];if(b.offset+b.size<=a.offset||c.position(a.executionId)<b.known||b.invalidatedAtExecutionId&&c.position(b.invalidatedAtExecutionId)<=c.position(a.executionId))continue;emitBinding(a,b);}
    for(const array of arrays)if(array.range.objectId===a.objectId&&c.position(array.known)<=c.position(a.executionId)&&a.offset>=array.range.offset&&a.offset+a.size<=array.range.offset+array.range.size){
      const index=Math.floor((a.offset-array.range.offset)/array.elementBytes);emitBinding(a,{structureId:array.id,elementId:`${array.id}:element:${index}`,availableAtExecutionId:array.known});}
  }
  return {bindings:bindings.length,arrays:arrays.length};
}
