import {createExecutionEncoder,createExecutionDecoder,EXECUTION_ENCODING} from './execution-format.mjs';

// The budget covers the admission snapshot of each observation and each unique
// definition once. Live event objects remain ordinary mutable records because
// the observer attaches completion evidence after constructing an event.
export function createObservationStorage(){
 const encoder=createExecutionEncoder(),decode=createExecutionDecoder(encoder.definitions,{immutableDefinitions:true});
 let eventBytes=0,definitionBytes=0;
 return {
  append(event,limit=Infinity){
   const start=encoder.checkpoint();let packet,addedDefinitions,addedEvent;
   try{
    packet=encoder.pack(event);
    addedDefinitions=encoder.definitions.entries.slice(start).reduce((n,v)=>n+Buffer.byteLength(JSON.stringify(v))+1,0);
    addedEvent=Buffer.byteLength(JSON.stringify(packet.data))+1;
   }catch(error){encoder.rollback(start);throw error;}
   if(eventBytes+definitionBytes+addedDefinitions+addedEvent>limit){encoder.rollback(start);return null;}
   const shared=decode(packet);eventBytes+=addedEvent;definitionBytes+=addedDefinitions;
   return shared;
  },
  summary(){return {observationEncoding:EXECUTION_ENCODING,observationBytes:eventBytes+definitionBytes,
   observationEventBytes:eventBytes,observationDefinitionBytes:definitionBytes,
   observationDefinitionCount:encoder.definitions.entries.length};}
 };
}
