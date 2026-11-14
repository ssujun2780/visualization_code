import {layoutStructure,circularPresentation} from './structure-layout.js';
import {prepareStructureHistory} from './structure-history.js';

// Whole-record appearance only. Current membership, values, cursors, colours
// and edges are deliberately NOT copied into this object.
export function prepareAppearance(variant){
  const samples=(variant.entries??[]).map(e=>e.presentation),last=samples.at(-1)??{},descriptor={};
  for(const p of samples)for(const [k,v]of Object.entries(p.descriptor??{}))if(v!==undefined&&v!==null)descriptor[k]=v;
  const subtype=[...samples].reverse().find(p=>p.variant!==undefined)?.variant,
    circular=samples.some(p=>circularPresentation(p)),
    directed=[...samples].reverse().map(p=>p.directed??p.relation?.semantic?.directed??p.descriptor?.directed).find(v=>typeof v==='boolean'),
    appearance={schemaVersion:3,view:variant.view,label:variant.label??last.label,variant:subtype,circular,directed,descriptor};
  const edges=new Map();for(const p of samples)for(const e of p.relation?.edges??[])edges.set(e.id??`${e.from}:${e.to}:${e.roleId}`,e);
  appearance.positions=[...layoutStructure({...appearance,nodes:variant.layoutNodes??[],edges:[...edges.values()],capacity:descriptor.capacity,columns:descriptor.dimensions?.at(-1),roots:last.relation?.rootNodeIds??[]}).positions];
  // Reserve physical slots once, not from the visible/occupied prefix at a
  // playback instant. Reserved slots are geometry, not allocated C objects.
  if(['array','grid','dynamic-array','string','stack','queue','deque'].includes(variant.view)&&Number.isSafeInteger(descriptor.capacity)&&descriptor.capacity>0){
    const nodes=Array.from({length:Math.min(128,descriptor.capacity)},(_,index)=>({id:index,index})),
      layout=layoutStructure({...appearance,nodes,edges:[],capacity:descriptor.capacity,columns:descriptor.dimensions?.at(-1)});
    appearance.slots={positions:[...layout.positions],ring:layout.ring};
  }
  appearance.history=prepareStructureHistory(variant,appearance);
  return appearance;
}
