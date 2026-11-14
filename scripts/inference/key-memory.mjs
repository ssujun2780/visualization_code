import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {scalarFromBytes} from './scalar-domain.mjs';
export const isByteKey=c=>['nul-terminated-bytes','bounded-string-bytes','fixed-bytes'].includes(c?.domain);
const same=(a,b)=>a?.objectId===b?.objectId&&a.offset===b.offset&&a.size===b.size;
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
// Indexed observation consumer. Never reads final object contents or executes C.
export function keyMemory(trace,{maxStringBytes=256}={}){
 const {events,objects}=trace,pos=new Map(events.map((e,i)=>[e.eventId,i])),byObject=new Map(),cache=new Map();
 for(const e of events){if(e.phase&&e.phase!=='complete')continue;const target=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null);
  if(target&&['SPACE','READ','WRITE'].includes(e.kind)){if(!byObject.has(target.objectId))byObject.set(target.objectId,[]);byObject.get(target.objectId).push({e,target,at:pos.get(e.eventId)});}}
 const alive=(id,at)=>{const o=objects.find(o=>o.id===id);return o&&pos.get(o.createdBy)<=at&&!(pos.get(o.endedBy)<=at);};
 function snapshot(range,at){
  if(!range||!alive(range.objectId,at)||!Number.isSafeInteger(range.size)||range.size<1||range.size>maxStringBytes)return null;
  const o=objects.find(o=>o.id===range.objectId);if(range.offset<0||range.offset+range.size>o.size)return null;
  const key=JSON.stringify(range);let c=cache.get(key);
  if(!c||at<c.at){c={at:-1,cursor:0,bytes:Array(range.size).fill(null),writer:null,reference:null};cache.set(key,c);}
  const list=byObject.get(range.objectId)??[];
  while(c.cursor<list.length&&list[c.cursor].at<=at){const {e,target}=list[c.cursor++];if(!overlap(range,target))continue;
   const exact=same(range,target),bits=e.initializationEvidence==='unobserved'?undefined:e.value?.bits;
   if(!e.memoryState&&bits===undefined&&e.kind==='READ'&&e.initializationEvidence!=='unobserved')continue;
   const scalar=bits!==undefined?observeScalarBytes(null,{size:target.size,value:bits}):null,
     snapshot=e.memoryState??(scalar?{byteLength:target.size,ranges:[{offset:0,length:target.size,initialization:'initialized',data:{encoding:'hex',bytesHex:scalar.bytes.map(b=>b.toString(16).padStart(2,'0')).join('')}}]}:
       {byteLength:target.size,ranges:[]});
   let changed=false;
   for(let i=0;i<range.size;i+=16){const size=Math.min(16,range.size-i),next=observeScalarBytes({bytes:c.bytes.slice(i,i+size)},
     {size,offset:range.offset+i,start:target.offset,snapshot});
    if(next){c.bytes.splice(i,size,...next.bytes);changed=true;}}
   if(changed){c.writer=e.eventId;c.reference=exact&&e.value?.reference?e.value.reference:null;}
  }
  c.at=at;return {...c,bytes:c.bytes.slice()};
 }
 function string(range,at){
  const o=objects.find(o=>o.id===range?.objectId);if(!o)return null;
  const size=Math.min(range.size??o.size-range.offset,maxStringBytes),state=snapshot({...range,size},at);if(!state)return null;
  const end=state.bytes.indexOf(0);if(end<0){if(size===maxStringBytes&&(range.size??o.size-range.offset)>size)trace.inferenceBudget?.report('string-key-bytes',maxStringBytes,events[at]?.eventId);return null;}
  const bytes=state.bytes.slice(0,end);if(bytes.some(b=>b===null))return null;
  return {payload:{kind:'bytes',value:bytes},value:String.fromCharCode(...bytes),range:{objectId:range.objectId,offset:range.offset,size:end+1},writer:state.writer};
 }
 function key(component,range,at){
  if(isByteKey(component)){
   if(component.storage==='inline')return bytesKey(component,range,at);
   const state=snapshot(range,at),ref=state?.reference;if(ref?.status!=='in-bounds')return null;
   const value=bytesKey(component,{objectId:ref.targetObjectId,offset:ref.targetOffset},at);
   return value?{...value,referenceExecutionId:state.writer}:null;
  }
  const state=snapshot(range,at),payload=scalarFromBytes(state?.bytes,component.cType);
  return payload?{payload,value:payload.value,writer:state.writer,range}:null;
 }
 function bytesKey(component,range,at){
  if(component.domain==='nul-terminated-bytes')return string(range,at);
  const count=component.byteLimit;if(!Number.isSafeInteger(count)||count<0)return null;
  if(count>maxStringBytes){trace.inferenceBudget?.report('string-key-bytes',maxStringBytes,events[at]?.eventId);return null;}
  const bytes=[];let writer=null;
  for(let i=0;i<count;i++){
   if(range.size!==undefined&&i>=range.size)return null;
   const s=snapshot({objectId:range.objectId,offset:range.offset+i,size:1},at),b=s?.bytes[0];if(b===null||b===undefined)return null;
   writer=s.writer??writer;
   if(component.domain==='bounded-string-bytes'&&b===0)return {payload:{kind:'bytes',value:bytes},value:String.fromCharCode(...bytes),range:{...range,size:i+1},writer};
   bytes.push(b);
  }
  return {payload:{kind:'bytes',value:bytes},value:String.fromCharCode(...bytes),range:{...range,size:count},writer};
 }
 return {pos,alive,snapshot,string,bytesKey,key};
}
