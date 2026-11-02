// Physical deliveries are authoritative. Remove only proven duplicate ranges.
export function outputEvents(raw,aliases,gaps){
  const coverage=[],suppressed=new Set(),replacement=new Map(),events=raw.events;
  const channels=new Set(events.filter(e=>e.action==='output.delivery'||e.outputOrigin==='stdio').map(e=>e.channel));
  for(const channel of channels){
    const deliveries=events.filter(e=>e.action==='output.delivery'&&e.channel===channel),attributed=events.filter(e=>e.outputOrigin==='delivery-attributed'&&e.channel===channel),
      legacy=events.filter(e=>e.outputOrigin==='stdio'&&e.channel===channel);
    const source=Buffer.concat(legacy.map(e=>Buffer.from(e.bytesHex,'hex'))),delivered=Buffer.concat(deliveries.map(e=>Buffer.from(e.bytesHex,'hex')));
    let sourceBytes=source.length,verified=0,mode='delivery-only';
    if(attributed.length){
      mode='observed-memory-writer';sourceBytes=0;
      const byDelivery=new Map(deliveries.map(e=>[e.eventId,e]));
      for(const e of attributed){const d=byDelivery.get(e.deliveryObservationId),at=e.deliveryOffset,b=Buffer.from(e.bytesHex,'hex'),actual=d&&Buffer.from(d.bytesHex,'hex');
        if(!actual||!Number.isSafeInteger(at)||at<0||at+b.length>actual.length||!actual.subarray(at,at+b.length).equals(b))throw new Error('Output attribution does not match its physical delivery');
        sourceBytes+=b.length;
      }
      for(const d of deliveries){const spans=attributed.filter(e=>e.deliveryObservationId===d.eventId).sort((a,b)=>a.deliveryOffset-b.deliveryOffset),bytes=Buffer.from(d.bytesHex,'hex'),parts=[];let at=0;
        for(const e of spans){if(e.deliveryOffset<at)throw new Error('Overlapping output attribution');if(e.deliveryOffset>at)parts.push(slice(d,at,e.deliveryOffset));at=e.deliveryOffset+e.byteLength;verified+=e.byteLength;}
        if(at<bytes.length)parts.push(slice(d,at,bytes.length));replacement.set(d.eventId,parts);aliases.set(d.eventId,[...spans,...parts].map(e=>e.eventId));
      }
    }else if(legacy.length){
      mode='verified-stream-prefix';
      const prefix=source.subarray(0,Math.min(source.length,delivered.length)).equals(delivered.subarray(0,Math.min(source.length,delivered.length)));
      if(prefix){verified=Math.min(source.length,delivered.length);let offset=0;
        for(const d of deliveries){const size=Buffer.from(d.bytesHex,'hex').length,skip=Math.max(0,Math.min(size,verified-offset));
          const remaining=skip<size?[slice(d,skip,size)]:[];replacement.set(d.eventId,remaining);
          aliases.set(d.eventId,[...legacy.filter(e=>(e.streamOffset??0)<offset+skip&&(e.streamOffset??0)+e.byteLength>offset),...remaining].map(e=>e.eventId));offset+=size;}
      }else{
        // Conflicting creation offsets are not sufficient to guess ownership.
        // Keep all real delivered bytes and the original observations as evidence.
        for(const e of legacy){suppressed.add(e.eventId);aliases.set(e.eventId,[]);}
      }
    }
    if(legacy.length&&verified<delivered.length||attributed.length&&verified<delivered.length)gaps.add(`unattributed-stdio-delivery:${channel}`);
    coverage.push({channel,sourceBytes,deliveredBytes:delivered.length,deliveryPrefixMatches:verified===delivered.length,
      verifiedDeliveryBytes:verified,unattributedDeliveryBytes:delivered.length-verified,mode,deliveryObservationIds:deliveries.map(e=>e.eventId)});
  }
  let result=events.flatMap(e=>suppressed.has(e.eventId)?[]:e.action==='output.delivery'?(replacement.get(e.eventId)??[{...e,action:'output',outputOrigin:'delivery-only'}]):[e]);
  // A buffer store supplies an observed source-call identity. Reattach only
  // when doing so preserves the delivered order within each stream.
  const positions=new Map(events.map((e,i)=>[e.eventId,i])),ends=new Map(events.filter(e=>e.action==='call.end').map(e=>[e.callEventId,e.eventId]));
  const safe=new Map();
  for(const channel of channels){let last=-1,ok=true;
    for(const e of result.filter(e=>e.action==='output'&&e.channel===channel).sort((a,b)=>a.streamOffset-b.streamOffset)){
      const pos=positions.get(ends.get(e.callEventId)??e.eventId);if(pos<last)ok=false;last=pos;
    }safe.set(channel,ok);if(!ok)gaps.add(`output-delivery-order:${channel}`);
  }
  const pending=new Map(),moved=new Set();
  for(const e of result)if(e.outputOrigin==='delivery-attributed'&&e.callEventId&&ends.has(e.callEventId)&&safe.get(e.channel)){
    const end=ends.get(e.callEventId);if(!pending.has(end))pending.set(end,[]);pending.get(end).push(e);moved.add(e.eventId);
  }
  result=result.flatMap(e=>moved.has(e.eventId)?[]:[...(pending.get(e.eventId)??[]),e]);
  return {events:result,coverage};
}
function slice(delivery,start,end){
  const bytes=Buffer.from(delivery.bytesHex,'hex').subarray(start,end);
  return {...delivery,eventId:start===0?delivery.eventId:`${delivery.eventId}:bytes:${start}`,action:'output',outputOrigin:'delivery-only',
    bytesHex:bytes.toString('hex'),text:bytes.toString('utf8'),byteLength:bytes.length,streamOffset:(delivery.streamOffset??0)+start,
    attribution:'unresolved source call',callEventId:null,deliveryObservationId:delivery.eventId,deliveryOffset:start};
}
