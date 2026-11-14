import {projectStructureRelation} from './structure-relations.mjs';
import {structureStateAt} from './state-history.mjs';
import {evaluateStructureConditions} from './structure-conditions.mjs';
import {key,num,unique} from './storage-semantics.mjs';
import {verificationStates} from './history-evidence.mjs';

// Hypotheses about an observed colour role are distinct from declared meaning.
// Once supported, retain the encoding through later violations; never recolour
// an invalid tree merely to make its current invariants pass.
export function colorEncodingStates(c,trace,role){
 const sources=c.structures.filter(s=>['linked-structure','pointer-tree-projection','rooted-index-structure'].includes(s.kind)).map(s=>({...s,states:verificationStates(s,c.pos),coverage:undefined})),states=[];
 let established=null;
 const field=n=>n.range&&n.recordTypeId===role.recordTypeId?{objectId:n.range.objectId,offset:n.range.offset+role.binding.offset,size:role.binding.size}:null;
 const ids=unique([...role.proofs.map(p=>p.afterExecutionId),...c.events.filter(e=>['WRITE','SPACE'].includes(e.kind)).map(e=>e.eventId),...sources.flatMap(s=>s.states??[]).map(s=>s.afterExecutionId)]).sort((a,b)=>c.pos.get(a)-c.pos.get(b));
 for(const id of ids){const at=c.pos.get(id),proofs=role.proofs.filter(p=>c.pos.get(p.afterExecutionId)<=at);if(!proofs.length)continue;
  const hypotheses=[];
  for(const source of sources){const state=structureStateAt(source,c.pos,at,c.objects),relation=state&&projectStructureRelation(source,state);if(!relation?.complete||relation.nodes.length<3||!relation.nodes.every(n=>field(n)))continue;
   const roots=relation.nodes.filter(n=>relation.rootNodeIds.includes(n.id)),codes=unique(proofs.flatMap(p=>p.codes));if(codes.length!==2||roots.length!==1)continue;
   const rootRange=field(roots[0]),rootWrite=c.events.findLast(e=>e.action==='write'&&key(e.target)===key(rootRange)&&c.pos.get(e.eventId)<=at&&proofs.some(p=>c.pos.get(e.eventId)>c.pos.get(p.afterExecutionId)));
   if(!rootWrite)continue;
   for(const black of codes){const red=codes.find(x=>x!==black),values=relation.nodes.map(n=>({nodeId:n.id,range:field(n),value:c.exactScalar(field(n),at)?.toString()??null,evidenceExecutionIds:[]}));
    const result=evaluateStructureConditions(relation,{expected:'red-black-rules',properties:{color:{redValue:String(red),blackValue:String(black),values}}});
    hypotheses.push({redValue:String(red),blackValue:String(black),sourceStructureId:source.id,relationExecutionId:state.afterExecutionId,assessment:result.assessment,rootRestoration: num(rootWrite.value)===black,
     evidenceExecutionIds:unique([rootWrite.eventId,state.afterExecutionId,...proofs.flatMap(p=>p.evidenceExecutionIds)])});
   }
  }
  const supported=hypotheses.filter(h=>h.assessment==='satisfied-observed'&&h.rootRestoration),mappings=new Map(supported.map(h=>[`${h.redValue}:${h.blackValue}`,h]));
  if(!established&&mappings.size===1){const h=[...mappings.values()][0];established={redValue:h.redValue,blackValue:h.blackValue,afterExecutionId:id,relation:{sourceStructureId:h.sourceStructureId,afterExecutionId:h.relationExecutionId},evidenceExecutionIds:h.evidenceExecutionIds,origin:'observed-restoration-and-rb-constraints'};}
  states.push({afterExecutionId:id,status:'supported-observed-role',suggestedMapping:established,...established?{relation:established.relation}:{},encodingHypotheses:hypotheses,
   evidenceExecutionIds:unique([...proofs.flatMap(p=>p.evidenceExecutionIds),...established?.evidenceExecutionIds??[]])});
 }
 return states;
}
