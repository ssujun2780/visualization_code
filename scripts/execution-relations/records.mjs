// Canonical event identities and compiler metadata only. No source parsing,
// pointer-address matching, final memory snapshots or structural heuristics.
const cache=new WeakMap();
export const complete=e=>e&&(!e.phase||e.phase==='complete');
export const unique=items=>[...new Set(items)];
export function range(context,target,event){
  const object=context.object(target?.objectId),position=context.position(event?.eventId);
  if(!object||position===undefined||!Number.isSafeInteger(target.offset)||target.offset<0||
    !Number.isSafeInteger(target.size)||target.size<=0||!Number.isSafeInteger(target.offset+target.size)||target.offset+target.size>object.size)return null;
  const created=context.position(object.createdBy),ended=context.position(object.endedBy);
  if(created===undefined||created>position||ended!==undefined&&ended<=position)return null;
  return {objectId:object.id,offset:target.offset,size:target.size};
}
export function union(ranges){
  const out=[];
  for(const r of ranges.map(r=>({offset:r.offset,size:r.size})).sort((a,b)=>a.offset-b.offset)){
    const previous=out.at(-1);
    if(previous&&r.offset<=previous.offset+previous.size)previous.size=Math.max(previous.offset+previous.size,r.offset+r.size)-previous.offset;
    else out.push(r);
  }
  return out;
}
export function latest(context,ids){return ids.reduce((a,b)=>context.position(a)>context.position(b)?a:b);}
export function relation(id,kind,at,activationIds,participants,evidence,extra={}){
  return {id,kind,status:'supported',availableAtExecutionId:at,activationIds:unique(activationIds),participants,
    supportingExecutionIds:unique(evidence),contradictingExecutionIds:[],...extra};
}
function lvalue(node){
  if(node?.kind==='BinaryOperator'&&node.operator==='=')return node.children?.[0];
  return node;
}
function findLayout(node){
  if(!node)return null;
  if(node.kind==='ArraySubscriptExpr')return {type:node.cType,memberOffset:0,memberPath:[]};
  if(node.kind==='UnaryOperator'&&node.operator==='*')return {type:node.cType,memberOffset:0,memberPath:[]};
  if(node.kind==='MemberExpr'){
    const base=findLayout(node.children?.[0]),member=node.targetPath?.filter(p=>p.kind==='member').at(-1);
    if(base&&Number.isSafeInteger(member?.offsetBits)&&member.offsetBits%8===0)
      return {...base,memberOffset:base.memberOffset+member.offsetBits/8,memberPath:[...base.memberPath,node.memberName]};
    return null;
  }
  // Follow lvalue wrappers, never the index, RHS or another operand.
  if(['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(node.kind))return findLayout(node.children?.[0]);
  return null;
}
export function accessLayout(context,event,target){
  const info=findLayout(lvalue(context.instruction(event.instructionId)?.expression)),size=(info?.type?.sizeBits??0)/8;
  if(!Number.isSafeInteger(size)||size<=0)return null;
  const offset=target.offset-info.memberOffset;
  if(offset<0||offset+size>context.object(target.objectId).size||info.memberOffset+target.size>size)return null;
  return {elementSizeBytes:size,elementOffset:offset,memberOffset:info.memberOffset,memberPath:info.memberPath,
    typeId:info.type.id??null,evidence:'compiler lvalue type and observed storage range'};
}
export function recordIndex(context){
  if(cache.has(context))return cache.get(context);
  const byFrame=new Map(context.trace.frames.map(f=>[f.id,{frame:f,begin:null,end:null,events:[],accesses:[],children:[]}]));
  const calls=[],argumentsByFrame=new Map(),pending=new Map();
  for(const event of context.trace.events){
    if(!complete(event))continue;
    const f=byFrame.get(event.activationId);if(f)f.events.push(event);
    if(event.kind==='FLOW'&&event.action==='call'){
      const stack=pending.get(event.activationId)??[];stack.push(event);pending.set(event.activationId,stack);
    }
    if(event.kind==='FLOW'&&event.action==='resume'){
      const stack=pending.get(event.activationId)??[],i=stack.findIndex(e=>e.eventId===event.callExecutionId);
      if(i>=0)stack.splice(i,1);
    }
    if(event.kind==='SPACE'&&event.action==='frame.begin'&&f){
      f.begin=event;
      const parent=byFrame.get(f.frame.parent),call=pending.get(f.frame.parent)?.at(-1);
      if(parent?.begin&&call?.resolvedFunctionId===f.frame.functionId&&call.activationId===parent.frame.id){
        f.call=call;parent.children.push(f);calls.push({parent,child:f,call,begin:event});
      }
    }
    if(event.kind==='SPACE'&&event.action==='frame.end'&&f)f.end=event;
    if(event.kind==='WRITE'&&event.action==='argument'&&f){
      const args=argumentsByFrame.get(event.activationId)??[];args.push(event);argumentsByFrame.set(event.activationId,args);
    }
    if(f&&['READ','WRITE'].includes(event.kind)){
      const target=range(context,event.target,event);
      if(target){
        const object=context.object(target.objectId),layout=accessLayout(context,event,target);
        // Local scalar bookkeeping is not an array range. External storage is
        // allowed but stays a byte range unless compiler layout proves more.
        if(layout||object.cType?.kind==='array'||object.frameId!==event.activationId)
          f.accesses.push({event,target,layout,mode:event.kind==='READ'?'read':'write'});
      }
      if(event.kind==='WRITE'&&event.action==='copy'){
        const source=range(context,{objectId:event.sourceObjectId,offset:event.sourceOffset,size:event.sourceSize},event);
        if(source)f.accesses.push({event,target:source,layout:null,mode:'read'});
      }
    }
  }
  const result={byFrame,calls,argumentsByFrame};cache.set(context,result);return result;
}
