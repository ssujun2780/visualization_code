import {createValueFlow} from './observed-value-flow.mjs';
import {slotTimeline} from './array-membership.mjs';
export const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
export const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
export const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
export const contains=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<=b.offset&&b.offset+b.size<=a.offset+a.size;
export const num=v=>{const n=Number(v?.decimal??v?.signed??v?.unsigned??NaN);return Number.isSafeInteger(n)?n:null;};
export function sequenceEvidence(plan,trace){
 const events=trace.events,byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),defs=new Map(plan.instructions.map(d=>[d.id,d])),flow=trace.valueFlow??createValueFlow(plan,trace),timelines=new Map(),advanceCache=new Map();
 const deps=ids=>(ids??[]).flatMap(id=>flow.dependencyReads(id));
 const isInput=r=>{const n=unwrap(defs.get(r?.instructionId)?.expression);return r?.kind==='READ'&&r.target?.objectId&&num(r.value)!==null&&r.value.cType?.kind!=='pointer'&&
   (n?.kind==='UnaryOperator'&&n.operator==='*'||n?.kind==='ArraySubscriptExpr'&&!walk(n).some(n=>n.kind==='MemberExpr'));};
 const identity=(a,b)=>flow.chain(a).some(x=>flow.chain(b).some(y=>x.eventId===y.eventId));
 function advance(read,exactBytes=null){
   const ck=`${read.eventId}:${exactBytes}`;if(advanceCache.has(ck))return advanceCache.get(ck);
   const cursors=read.value?.cType?.kind==='pointer'?[read]:deps(read.addressInputs),found=[];
   for(const cursor of cursors){if(!cursor.target?.objectId)continue;
     for(const w of events){if(w.kind!=='WRITE'||w.activationId!==read.activationId||pos.get(w.eventId)<=pos.get(cursor.eventId)||key(w.target)!==key(cursor.target))continue;
       if(!deps(w.dataInputs).some(r=>identity(r.eventId,cursor.eventId)))continue;
       const a=cursor.value?.reference,b=w.value?.reference,
         delta=a&&b&&a.targetObjectId===b.targetObjectId?b.targetOffset-a.targetOffset:
           !a&&num(cursor.value)!==null&&num(w.value)!==null?(num(w.value)-num(cursor.value))*(read.target?.size??1):null;
       if(!(delta>0)||exactBytes!==null&&delta!==exactBytes)continue;
       found.push({cursorReadExecutionId:cursor.eventId,advanceExecutionId:w.eventId,bytes:delta});break;
     }
   }
   const result=found.sort((a,b)=>pos.get(a.advanceExecutionId)-pos.get(b.advanceExecutionId))[0]??null;advanceCache.set(ck,result);return result;
 }
 const scalar=(range,at,signed=true)=>{const object=trace.objects.find(o=>o.id===range.objectId);if(!object||pos.get(object.createdBy)>at||pos.get(object.endedBy)<=at)return undefined;
   const k=`${key(range)}:${signed}`;if(!timelines.has(k))timelines.set(k,slotTimeline(range,events,{signed}));return timelines.get(k).findLast(x=>x.sequence<=at);};
 function depends(id,wanted,seen=new Set()){
   if(id===wanted)return true;if(seen.has(id))return false;seen.add(id);return (byId.get(id)?.dataInputs??[]).some(x=>depends(x,wanted,seen));
 }
 const after=ids=>ids.filter(Boolean).sort((a,b)=>pos.get(a)-pos.get(b)).at(-1);
 // Loop cleanup blocks can remove controlInputs. Recover only an immediate,
 // observed normal exit, with compiler statement ranges and no intervening
 // mutation/call/branch. Never infer completion from source text or names.
 function loopExits(ret){
   const prior=events.slice(0,pos.get(ret.eventId)).filter(e=>e.activationId===ret.activationId),
     last=prior.findLast(e=>e.action==='branch'),rd=defs.get(ret.instructionId),
     explicit=(ret.controlInputs??[]).map(id=>byId.get(id));
   return [...new Set([...explicit,last])].filter(e=>{
     const d=defs.get(e?.instructionId);if(e?.action!=='branch'||num(e.condition)!==0||!['WhileStmt','ForStmt','DoStmt'].includes(d?.controlKind))return false;
     if(explicit.includes(e))return true;
     return d.functionId===rd?.functionId&&d.statementSource?.file===rd.source?.file&&
       Number.isSafeInteger(d.statementSource?.end?.byte)&&d.statementSource.end.byte<=rd.source?.start?.byte&&
       !prior.some(x=>pos.get(x.eventId)>pos.get(e.eventId)&&(x.kind==='WRITE'||['branch','call'].includes(x.action)));
   });
 }
 return {events,byId,pos,defs,flow,deps,isInput,advance,scalar,depends,after,identity,loopExits};
}
