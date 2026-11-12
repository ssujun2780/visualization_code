import {complete,storage,unique,port} from './common.mjs';
import {accessLayout} from '../records.mjs';

// Only recorded effects are expanded into metadata. No READ instructions are made.
export function accessIndex(c,events,emit){
  const rows=[],byExecution=new Map(),byFrame=new Map();
  for(const e of events){if(!emit.tick(e.eventId))break;emit.progress('accesses',e);
    if(['READ','WRITE'].includes(e.kind)&&(!complete(e)||e.target?.objectId&&!storage(c,e.target,e))){
      emit.relation('access-attempt',e,e.activationId?[{kind:'activation',role:'attempt-owner',activationId:e.activationId}]:[],
        {targetExecutionId:e.eventId,phase:e.phase??'complete',targetStatus:complete(e)?'outside-live-storage':'recorded-attempt'});
    }
    if(!complete(e))continue;const found=[];
    const add=(target,mode,evidenceKind)=>{const location=storage(c,target,e);if(!location)return;
      if(found.some(a=>a.mode===mode&&a.objectId===location.objectId&&a.offset===location.offset&&a.size===location.size))return;
      const layout=accessLayout(c,e,location),o=c.object(location.objectId);
      const row={...location,executionId:e.eventId,activationId:e.activationId??null,mode,evidenceKind,layout,
        payload:!!layout||o.cType?.kind==='array'||o.frameId!==e.activationId};found.push(row);rows.push(row);
      const relation=emit.relation('storage-access',e,[{...location,role:mode}],{mode,evidenceKind,layout,payload:row.payload});row.relationId=relation?.id??null;
    };
    if(['READ','WRITE'].includes(e.kind))add(e.target,e.kind==='READ'?'read':'write','direct');
    if(e.kind==='WRITE'&&e.action==='copy')add({objectId:e.sourceObjectId,offset:e.sourceOffset,size:e.sourceSize},'read','range-copy');
    for(const key of ['readRegions','libraryReadRegions','streamReadRegions'])for(const region of e[key]??[])add(region,'read',key);
    byExecution.set(e.eventId,found);const list=byFrame.get(e.activationId)??[];list.push(...found);byFrame.set(e.activationId,list);
    if(e.value?.reference){const ref=e.value.reference,target=c.object(ref.targetObjectId),p=c.position(e.eventId),begin=c.position(target?.createdBy);
      if(target&&begin!==undefined&&begin<=p){const slot=storage(c,e.target,e)??port(e),participants=slot?[{...slot,role:'reference-slot'}]:[];
        emit.relation('reference-observation',e,participants,{reference:{objectId:target.id,createdBy:target.createdBy,offset:ref.targetOffset??null,onePast:ref.onePast===true},extent:'reference-only'});}}
  }
  const parents=new Map(c.trace.frames.map(f=>[f.id,f.parent??null]));
  // Frame begin/end facts use actual IDs, not a function name or call-stack guess.
  for(const e of events)if(complete(e)&&['frame.begin','frame.end'].includes(e.action)){
    const f=c.frame(e.activationId);if(!f)continue;
    emit.relation(e.action==='frame.begin'?'activation-entry':'activation-exit',e,[{kind:'activation',activationId:f.id,role:'activation'}],{parentActivationId:f.parent??null,functionId:f.functionId??null});
  }
  return {rows,byExecution,byFrame,parents,ports:events.filter(e=>complete(e)&&port(e)).map(e=>({executionId:e.eventId,port:port(e)}))};
}
