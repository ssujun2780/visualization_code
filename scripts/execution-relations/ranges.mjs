import {recordIndex,union,unique,latest,relation} from './records.mjs';

function grouped(accesses){
  const groups=new Map();
  for(const access of accesses){const list=groups.get(access.target.objectId)??[];list.push(access);groups.set(access.target.objectId,list);}
  return groups;
}
function contains(a,b){return b.every(y=>a.some(x=>x.offset<=y.offset&&x.offset+x.size>=y.offset+y.size));}
export function compareRanges(a,b){
  if(contains(a,b)&&contains(b,a))return 'equal';
  if(contains(a,b))return 'contains';if(contains(b,a))return 'within';
  return a.some(x=>b.some(y=>x.offset<y.offset+y.size&&y.offset<x.offset+x.size))?'overlap':'disjoint';
}
export function inferRanges(context){
  const {byFrame}=recordIndex(context),out=[],summaries=new Map(),visiting=new Set();
  for(const f of byFrame.values())for(const a of f.accesses){
    out.push(relation(`access:${a.event.eventId}:${a.mode}:${a.target.objectId}`,'storage-access',a.event.eventId,[f.frame.id],
      [{role:a.mode,...a.target}],[a.event.eventId],{mode:a.mode,layout:a.layout,accessExecutionId:a.event.eventId}));
  }
  function visit(f){
    if(summaries.has(f.frame.id))return summaries.get(f.frame.id);
    if(visiting.has(f.frame.id))throw new Error('호출 기록의 부모 관계가 순환합니다.');visiting.add(f.frame.id);
    const subtree=[...f.accesses];for(const child of f.children)subtree.push(...visit(child).accesses);
    const entry={accesses:subtree,objects:new Map()};summaries.set(f.frame.id,entry);visiting.delete(f.frame.id);
    for(const [scope,accesses]of [['direct',f.accesses],['subtree',subtree]]){
      for(const [objectId,list]of grouped(accesses)){
        const ranges=union(list.map(a=>a.target)),readRanges=union(list.filter(a=>a.mode==='read').map(a=>a.target)),
          writeRanges=union(list.filter(a=>a.mode==='write').map(a=>a.target));
        const evidence=unique([...(f.begin?[f.begin.eventId]:[]),...list.map(a=>a.event.eventId),...(f.end?[f.end.eventId]:[])]),
          at=latest(context,evidence),summary=relation(`range:${f.frame.id}:${scope}:${objectId}`,'activation-range',at,[f.frame.id],
            ranges.map(r=>({role:'accessed',objectId,...r})),evidence,{
              scope,extent:f.end?'closed-activation':'observed-prefix',objectId,ranges,readRanges,writeRanges,
              boundingRange:{offset:ranges[0].offset,size:ranges.at(-1).offset+ranges.at(-1).size-ranges[0].offset},
              directAccessCount:f.accesses.filter(a=>a.target.objectId===objectId).length,accessCount:list.length
            });
        out.push(summary);if(scope==='subtree')entry.objects.set(objectId,summary);
      }
    }
    return entry;
  }
  for(const f of byFrame.values())visit(f);
  function connect(a,b,linkage,onlyObjectId=null){
    for(const [objectId,left]of summaries.get(a.frame.id).objects){
      if(onlyObjectId&&objectId!==onlyObjectId)continue;
      const right=summaries.get(b.frame.id).objects.get(objectId);if(!right)continue;
      const evidence=unique([...left.supportingExecutionIds,...right.supportingExecutionIds]);
      out.push(relation(`ranges:${linkage}:${a.frame.id}:${b.frame.id}:${objectId}`,'range-relation',latest(context,evidence),
        [a.frame.id,b.frame.id],[...left.participants.map(p=>({...p,role:'left'})),...right.participants.map(p=>({...p,role:'right'}))],evidence,
        {linkage,relationship:compareRanges(left.ranges,right.ranges),extent:left.extent==='closed-activation'&&right.extent==='closed-activation'?'closed-activations':'observed-prefix',
          objectId,leftActivationId:a.frame.id,rightActivationId:b.frame.id,
          leftRelationId:left.id,rightRelationId:right.id}));
    }
  }
  for(const f of byFrame.values()){
    for(const child of f.children)connect(f,child,'parent-child');
    // Compare successive siblings per storage, not every call pair (quadratic).
    const previous=new Map();
    for(const child of f.children)for(const objectId of summaries.get(child.frame.id).objects.keys()){
      const before=previous.get(objectId);
      if(before)connect(before,child,'successive-siblings',objectId);
      previous.set(objectId,child);
    }
  }
  return out;
}
