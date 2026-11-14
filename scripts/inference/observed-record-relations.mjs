// Former observer-side grouping, now optional inference over recorded facts.
// Retain historical scope; this is not a current tree or an intent claim.
import {topology} from '../shared/topology.mjs';
export function observedRecordRelations(raw){
  if(!raw)return [];
  const groups=[],views=raw.views??[],edges=raw.references??[];
  for(const type of new Set(views.filter(v=>v.kind==='record').map(v=>v.type))){
    const nodes=views.filter(v=>v.type===type),links=[];
    for(const edge of edges){
      const from=nodes.find(v=>v.objectId===edge.objectId&&edge.offset>=v.offset&&edge.offset+4<=v.offset+v.size),
        to=nodes.find(v=>v.objectId===edge.targetObjectId&&v.address===edge.address);
      if(from&&to)links.push({from:from.id,to:to.id,offset:edge.offset});
    }
    groups.push({id:`historical-record:${type}`,type,nodes:nodes.map(v=>v.id),edges:links,...topology(nodes,links),snapshot:'last observed references, including ended objects'});
  }
  return groups;
}
