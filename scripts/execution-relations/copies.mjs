import {complete,range,recordIndex,accessLayout,union,unique,relation} from './records.mjs';

function width(v){return v?.cType?.sizeBits??Number(/^i(\d+)$/.exec(v?.type??'')?.[1]);}
function bitsPreserved(a,b){
  if(!a||!b||!width(a)||width(a)!==width(b))return false;
  const x=a.bits??a.bytesHex,y=b.bits??b.bytesHex;
  return x!==undefined&&y!==undefined&&x===y;
}
function sourceRead(context,event){
  const evidence=[event.eventId],seen=new Set();let current=event;
  while(current&&!seen.has(current.eventId)){
    seen.add(current.eventId);
    if(current.kind==='READ'&&current.action==='read'&&range(context,current.target,current))return {event:current,evidence};
    if(current.kind==='WRITE'&&current.action!=='write')return null;
    if(current.kind==='CALC'){
      const steps=current.steps??[],operator=current.operator??context.instruction(current.instructionId)?.operator;
      if(operator&&operator!=='cast'||steps.some(s=>s.operator!=='cast'&&!s.conversion)||
        steps.some(s=>s.operator&&s.operator!=='cast')||
        steps.some(s=>s.conversion?.fromType?.sizeBits!==s.conversion?.toType?.sizeBits))return null;
      if(operator!=='cast'&&!steps.length)return null;
    }else if(current.kind!=='WRITE')return null;
    const ids=unique(current.dataInputs??[]);if(ids.length!==1)return null;
    const input=context.event(ids[0]);
    if(!complete(input)||context.position(input.eventId)>=context.position(current.eventId)||
      input.activationId!==current.activationId||!bitsPreserved(input.value,current.value))return null;
    evidence.push(input.eventId);current=input;
  }
  return null;
}
export function inferCopies(context){
  const {byFrame}=recordIndex(context),out=[];
  for(const f of byFrame.values()){
    const payloadWrites=new Set(f.accesses.filter(a=>a.mode==='write').map(a=>a.event.eventId));let batch=[];
    function flush(){
      if(batch.length>1){
        const first=batch[0],last=batch.at(-1),sourceRanges=union(batch.map(r=>r.participants[0])),destinationRanges=union(batch.map(r=>r.participants[1])),runs=[];
        for(const copy of batch){
          const [s,d]=copy.participants,previous=runs.at(-1);
          if(previous&&previous.sourceOffset+previous.size===s.offset&&previous.destinationOffset+previous.size===d.offset)previous.size+=s.size;
          else runs.push({sourceOffset:s.offset,destinationOffset:d.offset,size:s.size});
        }
        out.push(relation(`sequence:${first.writeExecutionId}`,'copy-sequence',last.availableAtExecutionId,[f.frame.id],
          [...sourceRanges.map(r=>({role:'source',objectId:first.participants[0].objectId,...r})),
            ...destinationRanges.map(r=>({role:'destination',objectId:first.participants[1].objectId,...r}))],
          unique(batch.flatMap(r=>r.supportingExecutionIds)),{extent:'observed-sequence',transferIds:batch.map(r=>r.id),sourceRuns:runs,
            sourceObjectId:first.participants[0].objectId,destinationObjectId:first.participants[1].objectId}));
      }
      batch=[];
    }
    for(const event of f.events){
      if(event.kind==='FLOW'&&event.action==='call'){flush();continue;}
      if(event.kind!=='WRITE')continue;
      const destination=range(context,event.target,event);if(!destination)continue;
      let source=null,read=null,evidence=null,mechanism=null;
      if(event.action==='copy'){
        source=range(context,{objectId:event.sourceObjectId,offset:event.sourceOffset,size:event.sourceSize},event);
        if(source?.size===destination.size){evidence=[event.eventId];mechanism='recorded-memory-copy';}
      }else if(event.action==='write'){
        const origin=sourceRead(context,event);
        if(origin){read=origin.event;source=range(context,read.target,read);evidence=origin.evidence;mechanism='read-write-provenance';}
      }
      if(source&&source.size===destination.size&&evidence){
        const copy=relation(`copy:${event.eventId}`,'storage-copy',event.eventId,[f.frame.id],
          [{role:'source',...source},{role:'destination',...destination}],evidence,{
            mechanism,readExecutionId:read?.eventId??null,writeExecutionId:event.eventId,
            sourceLayout:read?accessLayout(context,read,source):null,destinationLayout:accessLayout(context,event,destination)
          });out.push(copy);
        // Keep ordinary scalar transfers, but do not let loop-index copies
        // split a payload-copy sequence. Every field transfer stays separate.
        if(payloadWrites.has(event.eventId)){
          const first=batch[0];
          if(first&&(first.participants[0].objectId!==source.objectId||first.participants[1].objectId!==destination.objectId))flush();
          batch.push(copy);
        }
      }else{
        const object=context.object(destination.objectId),first=batch[0];
        if(first&&(destination.objectId===first.participants[0].objectId||destination.objectId===first.participants[1].objectId||object.frameId!==f.frame.id))flush();
      }
    }
    flush();
  }
  return out;
}
