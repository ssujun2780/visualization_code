import {key,unique} from './storage-semantics.mjs';
// A first-child/sibling projection requires the actual prepend transfer:
// new.sibling = owner.child; owner.child = new. Field spelling is irrelevant.
export function priorityLinkLayouts(c,typeId){
 const proofs=[];
 for(const w of c.events){if(w.action!=='write'||w.value?.cType?.kind!=='pointer')continue;
  const at=c.pos.get(w.eventId),to=c.fieldAt(w.target,at),read=(w.dataInputs??[]).map(id=>c.flow.sourceRead(id)).find(Boolean),from=read&&c.fieldAt(read.target,c.pos.get(read.eventId));
  if(to?.node.typeId!==typeId||from?.node.typeId!==typeId||to.offset===from.offset||to.node.id===from.node.id)continue;
  const link=c.events.find(e=>e.activationId===w.activationId&&e.action==='write'&&c.pos.get(e.eventId)>at&&key(e.target)===key(read.target));
  if(!link||c.pointerNode(link.value,c.pos.get(link.eventId))?.id!==to.node.id)continue;
  proofs.push({childOffset:from.offset,siblingOffset:to.offset,readExecutionId:read.eventId,siblingWriteExecutionId:w.eventId,childWriteExecutionId:link.eventId,afterExecutionId:link.eventId});
 }
 return proofs;
}
export function priorityEdgesAt(stored,rootId,layouts){
 const variants=[...new Map(layouts.map(p=>[`${p.childOffset}:${p.siblingOffset}`,p])).values()];
 if(variants.length!==1)return {edges:stored.filter(e=>e.recordTo).map(e=>({id:e.id,from:e.recordFrom,to:e.recordTo,storedEdgeIds:[e.id]})),layout:null};
 const layout=variants[0],edges=[],children=new Map(stored.filter(e=>e.fieldOffset===layout.childOffset).map(e=>[e.recordFrom,e])),siblings=new Map(stored.filter(e=>e.fieldOffset===layout.siblingOffset).map(e=>[e.recordFrom,e]));
 for(const [owner,first]of children){const seen=new Set(),path=[first.id];let e=first;
  while(e?.recordTo&&!seen.has(e.recordTo)){seen.add(e.recordTo);edges.push({id:`priority-child:${owner}:${e.recordTo}`,from:owner,to:e.recordTo,storedEdgeIds:[...path]});e=siblings.get(e.recordTo);if(e)path.push(e.id);}
  if(e?.recordTo)return {edges:[],layout,invalid:true};
 }
 if(stored.some(e=>![layout.childOffset,layout.siblingOffset].includes(e.fieldOffset))||siblings.get(rootId)?.recordTo)return {edges:[],layout,invalid:true};
 return {edges,layout,evidenceExecutionIds:unique(layouts.flatMap(p=>[p.readExecutionId,p.siblingWriteExecutionId,p.childWriteExecutionId]))};
}
