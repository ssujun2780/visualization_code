import {referenceEdges} from './memory.js';

// Compiler-created constant backing stores have no source declaration. Keep
// them in execution state; omit their implementation-only boxes from the view.
export function internalConstantStorage(recording){
  const ids=new Set();
  const beginnings=new Map([...recording.events.values()].filter(e=>e.action==='object.begin').map(e=>[e.objectId,e]));
  for(const object of recording.objects.values()){
    const event=beginnings.get(object.id),definition=recording.instructions.get(event?.instructionId);
    if(object.storage==='static'&&object.constant===true&&definition&&
      !definition.declarationId&&!definition.source)ids.add(object.id);
  }
  return ids;
}

export function sourceVisibleObjects(recording,objects){
  const internal=recording.internalConstantStorage??new Set(),exposed=new Set();
  const outgoing=new Map(),queue=[];
  for(const edge of referenceEdges({objects})){
    if(!outgoing.has(edge.sourceObjectId))outgoing.set(edge.sourceObjectId,[]);
    outgoing.get(edge.sourceObjectId).push(edge.targetObjectId);
    if(!internal.has(edge.sourceObjectId))queue.push(edge.sourceObjectId);
  }
  for(let index=0;index<queue.length;index++)for(const id of outgoing.get(queue[index])??[])
    if(!exposed.has(id)){exposed.add(id);queue.push(id);}
  const result=new Map();
  for(const [id,object] of objects){
    if(!internal.has(id))result.set(id,object);
    else if(exposed.has(id))result.set(id,{...object,name:/^\[\d+ x i8\]$/.test(recording.objects.get(id)?.type??object.type??'')?'문자열 리터럴':'상수 데이터'});
  }
  return result;
}

export function hiddenStorageEndpoint(recording,state,endpoint){
  return endpoint.kind==='object'&&recording.internalConstantStorage?.has(endpoint.id)&&!state.objects.has(endpoint.id);
}
