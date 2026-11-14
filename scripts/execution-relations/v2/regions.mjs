import {complete,union,unique,check} from './common.mjs';

export function frameTree(c,events){
  const frames=new Map(),children=new Map();
  for(const e of events)if(complete(e)&&e.action==='frame.begin'){
    const f=c.frame(e.activationId);if(f)frames.set(f.id,{id:f.id,parent:f.parent??null,functionId:f.functionId,begin:e.eventId,end:null,ordinal:0});
  }
  for(const e of events)if(complete(e)&&e.action==='frame.end'&&frames.has(e.activationId))frames.get(e.activationId).end=e.eventId;
  for(const f of frames.values()){const rows=children.get(f.parent)??[];rows.push(f);children.set(f.parent,rows);}
  let ordinal=0;const visited=new Set(),todo=[];
  for(const f of frames.values())if(!frames.has(f.parent))todo.push({frame:f,exit:false});
  while(todo.length){const {frame:f,exit}=todo.pop();if(exit){f.lastOrdinal=ordinal-1;continue;}
    check(!visited.has(f.id),'호출 부모 관계가 순환합니다.');visited.add(f.id);f.ordinal=ordinal++;todo.push({frame:f,exit:true});
    for(const child of children.get(f.id)??[])todo.push({frame:child,exit:false});}
  check(visited.size===frames.size,'호출 부모 관계가 순환하거나 연결되지 않았습니다.');
  return {frames,children,descendant(child,parent){const a=frames.get(child),b=frames.get(parent);return !!a&&!!b&&a.ordinal>=b.ordinal&&a.ordinal<=b.lastOrdinal;}};
}
export function observedRegions(c,events,access,tree,emit){
  const summaries=new Map(),byFrameObject=new Map();
  for(const [frame,rows]of access.byFrame){const grouped=new Map();for(const a of rows){const entry=grouped.get(a.objectId)??[];entry.push(a);grouped.set(a.objectId,entry);}byFrameObject.set(frame,grouped);}
  const closed=[...tree.frames.values()].filter(f=>f.end).sort((a,b)=>c.position(a.end)-c.position(b.end));
  for(const frame of closed){
    if(!emit.tick(frame.end))break;const own=byFrameObject.get(frame.id)??new Map(),subtree=new Map();
    for(const [id,rows]of own)subtree.set(id,{readRanges:union(rows.filter(a=>a.mode==='read')),writeRanges:union(rows.filter(a=>a.mode==='write')),evidence:unique(rows.map(a=>a.executionId)),relations:[],count:rows.length});
    for(const child of tree.children.get(frame.id)??[])for(const [id,summary]of summaries.get(child.id)??[]){
      const entry=subtree.get(id)??{readRanges:[],writeRanges:[],evidence:[],relations:[],count:0};
      entry.readRanges=union([...entry.readRanges,...summary.readRanges]);entry.writeRanges=union([...entry.writeRanges,...summary.writeRanges]);entry.count+=summary.count;
      if(summary.relationId)entry.relations.push(summary.relationId);subtree.set(id,entry);}
    for(const [scope,groups]of [['direct',own],['subtree',subtree]])for(const [id,data]of groups){
      const ownRows=scope==='direct'?data:null,readRanges=ownRows?union(ownRows.filter(a=>a.mode==='read')):data.readRanges,
        writeRanges=ownRows?union(ownRows.filter(a=>a.mode==='write')):data.writeRanges,ranges=union([...readRanges,...writeRanges]),o=c.object(id);
      const event=c.event(frame.end),r=emit.relation('activation-region',event,[{kind:'region-set',role:'accessed',objectId:id,createdBy:o.createdBy,ranges}],
        {scope,extent:'closed',basis:'observed-access',readRanges,writeRanges,accessCount:ownRows?ownRows.length:data.count},
        unique([frame.begin,frame.end,...ownRows?ownRows.map(a=>a.executionId):data.evidence]),{evidence:{executionIds:unique([frame.begin,frame.end,...ownRows?ownRows.map(a=>a.executionId):data.evidence]),planNodeIds:[],relationIds:ownRows?[]:data.relations}});
      if(scope==='subtree')data.relationId=r?.id??null;
    }
    summaries.set(frame.id,subtree);
  }
  function compare(left,right,linkage,onlyObjectId=null){for(const [id,a]of summaries.get(left.id)??[]){if(onlyObjectId&&id!==onlyObjectId)continue;const b=summaries.get(right.id)?.get(id);if(!b||!a.relationId||!b.relationId)continue;
    const x=union([...a.readRanges,...a.writeRanges]),y=union([...b.readRanges,...b.writeRanges]),contains=(p,q)=>q.every(v=>p.some(u=>u.offset<=v.offset&&u.offset+u.size>=v.offset+v.size));
    const relationship=contains(x,y)?contains(y,x)?'equal':'contains':contains(y,x)?'within':x.some(u=>y.some(v=>u.offset<v.offset+v.size&&v.offset<u.offset+u.size))?'overlap':'disjoint';
    const at=c.position(left.end)>c.position(right.end)?left.end:right.end,event=c.event(at);
    emit.relation('region-relation',event,[],{objectId:id,linkage,relationship,basis:'observed-access',leftRelationId:a.relationId,rightRelationId:b.relationId},[at],
      {activationIds:[left.id,right.id],evidence:{executionIds:[at],planNodeIds:[],relationIds:[a.relationId,b.relationId]}});
  }}
  for(const frame of closed){const parent=tree.frames.get(frame.parent);if(parent?.end)compare(parent,frame,'parent-child');}
  for(const children of tree.children.values()){const previous=new Map();for(const child of children){if(!child.end)continue;
    for(const id of summaries.get(child.id)?.keys()??[]){const before=previous.get(id);if(before)compare(before,child,'successive-siblings',id);previous.set(id,child);}}}
  return summaries;
}
