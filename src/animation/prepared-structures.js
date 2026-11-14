import {createStructureViewQuery} from './structure-query.js';
import {prepareAppearance} from './prepared-appearance.js';
import {decodeInference,createSharedValues} from '../../scripts/inference/shared-values.mjs';
import {samePreparedValue} from './prepared-equality.js';

// A fixed object's graph can change only through storage in its possible
// outgoing closure. Use the historical union only to choose query times, never
// as a visible relation. Extra objects in the union are harmless overestimates.
function storageGraphBoundaries(graph){
  const nodeObjects=new Map(graph.nodes.map(n=>[n.id,n.range.objectId])),outgoing=new Map(),changes=new Map();
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};
  for(const n of graph.nodes)add(changes,n.range.objectId,n.discoveredAtExecutionId);
  for(const c of graph.changes){
    for(const edge of c.upsertEdges){const from=nodeObjects.get(edge.from)??edge.source?.objectId,to=nodeObjects.get(edge.to)??edge.target?.objectId;
      if(from){add(changes,from,c.afterExecutionId);if(to)add(outgoing,from,to);}}
    for(const id of c.endedObjectIds)add(changes,id,c.afterExecutionId);
  }
  return objectId=>{const objects=new Set([objectId]),ids=new Set();for(const id of objects){for(const to of outgoing.get(id)??[])objects.add(to);for(const at of changes.get(id)??[])ids.add(at);}return ids;};
}

// Offline presentation preparation. This module consumes the inference APIs;
// it neither executes C nor changes classifications, events or memory values.
export function prepareStructures(plan,trace,inference,{onProgress=()=>{}}={}){
  inference=decodeInference(inference);
  const shared=createSharedValues();
  const q=createStructureViewQuery(plan,trace,inference),events=trace.events,indices=new Map(events.map((e,i)=>[e.eventId,i])),sources=new Map((inference.structures??[]).filter(s=>s.id).map(s=>[s.id,s])),tracks=[],graphBoundaries=new Map();
  for(const s of sources.values())if(s.kind==='storage-reference-graph')graphBoundaries.set(s.id,storageGraphBoundaries(s));
  const candidates=trace.objects.filter(o=>['array','record'].includes(o.cType?.kind)||o.storage==='heap');
  for(const [number,object]of candidates.entries()){
    const begin=indices.get(object.createdBy)??0,end=Math.min(events.length-1,(indices.get(object.endedBy)??events.length)-1),target={objectId:object.id};
    if(end<begin)continue;
    const lastAccess=events.findLastIndex((e,i)=>i<=end&&['READ','WRITE'].includes(e.kind)&&(e.target?.objectId??e.objectId)===object.id),choiceAt=lastAccess>=begin?lastAccess:end;
    let base=q.project(target,events[choiceAt].eventId,{limit:256});
    // A final clearing/free can remove a useful candidate. Only retry observed
    // earlier boundaries, without naming an algorithm or inventing a relation.
    if(base.view==='boxes')for(const i of [Math.floor((begin+end)/2),begin]){const p=q.project(target,events[i].eventId,{limit:256});if(p.view!=='boxes'){base=p;break;}}
    if(base.view==='boxes'&&!base.recommendations.length)continue;
    const variants=[['auto',base]];
    // Prepare the complete recorded reference view as a selectable alternative.
    if(base.recommendations.some(r=>['graph','tree','binary-tree','linked-list','bst','min-heap','max-heap','trie'].includes(r.view))){
      q.set(target,{view:'graph'},events[choiceAt].eventId);const graph=q.project(target,events[choiceAt].eventId,{limit:256});q.set(target,{view:'auto'},events[choiceAt].eventId);
      if(graph.relation?.nodes.length)variants.push(['graph',graph]);
    }
    const track={objectId:object.id,variants:{}};
    for(const [name,choice]of variants){
      const keys=new Set([begin,end]),wanted=new Set([choice.candidateId,choice.selection?.inferredCandidateId].filter(Boolean));
      for(const id of [...wanted]){const source=sources.get(id);if(source?.sourceStructureId)wanted.add(source.sourceStructureId);if(source?.arrayId)wanted.add(source.arrayId);}
      for(const id of wanted){const source=sources.get(id),boundaries=graphBoundaries.has(id)?graphBoundaries.get(id)(object.id):[...source?.states??[],...source?.changes??[]].map(s=>s.afterExecutionId??s.executionId);
        for(const at of boundaries){const i=indices.get(at);if(i>=begin&&i<=end)keys.add(i);}
        const gap=indices.get(source?.coverage?.historyGapFromExecutionId);if(gap>=begin&&gap<=end)keys.add(gap);
      }
      // Object retirement can change a relation even without a new snapshot.
      const members=new Set([object.id,...(choice.relation?.nodes??[]).flatMap(n=>n.ranges.map(r=>r.objectId))]);
      for(const o of trace.objects)if(members.has(o.id)){const i=indices.get(o.endedBy);if(i>=begin&&i<=end)keys.add(i);}
      const entries=[],allNodes=new Map(),snapshots=new Map(),attributeRanges=new Set(),writes=new Map();let previous=null;
      for(const [i,e]of events.entries())if(i>=begin&&i<=end&&e.kind==='WRITE'&&e.target?.objectId){const rows=writes.get(e.target.objectId)??[];rows.push([i,e.target]);writes.set(e.target.objectId,rows);}
      const discover=nodes=>{for(const n of nodes??[])for(const r of [n.colorRange,n.heightRange,n.stateRange,n.visitedRange,n.settledRange,...n.keyRanges??[]].filter(Boolean)){
        const key=JSON.stringify(r);if(attributeRanges.has(key))continue;attributeRanges.add(key);
        for(const [i,t]of writes.get(r.objectId)??[])if((t.offset??0)<r.offset+r.size&&r.offset<(t.offset??0)+(t.size??1))keys.add(i);
      }};
      discover(choice.relation?.nodes);
      // Discover ranges across the observed history, including nodes deleted
      // before the final selection. Query each newly discovered boundary once.
      for(const index of keys){
        const p=q.project(target,events[index].eventId,{limit:256,selection:choice.selection});
        p.view=choice.view;p.variant=choice.variant;p.label=choice.label;p.selection=undefined;
        // Descriptors describe representation only; values always come from
        // current playback memory. The same declared shape can exist empty.
        if(!p.descriptor?.objectId&&choice.descriptor?.objectId)p.descriptor=choice.descriptor;
        for(const n of p.relation?.nodes??[])allNodes.set(n.id,n);discover(p.relation?.nodes);snapshots.set(index,p);
      }
      for(const [index,p]of [...snapshots].sort(([a],[b])=>a-b)){
        const version={...p,afterExecutionId:null};
        if(!samePreparedValue(version,previous)){entries.push({index,presentation:p});previous=version;}
      }
      const variant={view:choice.view,label:choice.label,recommendations:choice.recommendations,entries,layoutNodes:[...allNodes.values()]};
      variant.appearance=prepareAppearance(variant);variant.positions=variant.appearance.positions;track.variants[name]=variant;
    }
    tracks.push(track);onProgress({done:number+1,total:candidates.length});
  }
  const diagramOwners=new Map();
  for(const t of tracks)for(const v of Object.values(t.variants))for(const e of v.entries)if(e.presentation.relation?.id&&!diagramOwners.has(e.presentation.relation.id))diagramOwners.set(e.presentation.relation.id,e.presentation.descriptor.objectId??t.objectId);
  for(const t of tracks)for(const v of Object.values(t.variants)){
    const canonicalOwner=diagramOwners.get(v.entries.find(e=>e.presentation.relation?.id)?.presentation.relation.id);
    for(const e of v.entries){
    const owner=diagramOwners.get(e.presentation.relation?.id)??canonicalOwner;e.presentation={...e.presentation,diagramOwnerObjectId:owner};
    // Relationships may use one storage for vertices and other storages for
    // adjacency. Keep the latter visible as original backing arrays, instead
    // of drawing empty copies of the graph on every participant.
    e.presentation.backingStorageOnly=!!owner&&owner!==t.objectId&&v.layoutNodes.length>0&&!v.layoutNodes.some(n=>n.ranges.some(r=>r.objectId===t.objectId));
    }
  }
  const sizes=new Map(trace.objects.map(o=>[o.id,o.size])),placements=new Map();
  for(const track of [...tracks].sort((a,b)=>b.variants.auto.positions.length-a.variants.auto.positions.length)){
    const v=track.variants.auto,positions=new Map(v.positions);
    for(const entry of v.entries)for(const n of entry.presentation.relation?.nodes??[])for(const r of n.ranges){const p=positions.get(n.id);
      if(p&&r.offset===0&&r.size===sizes.get(r.objectId)&&!placements.has(r.objectId))placements.set(r.objectId,{x:35+p.x*3,y:70+p.y*2.5});}
  }
  return shared.intern({schemaVersion:1,programId:plan.programId,runId:trace.runId,eventCount:events.length,tracks,placements:[...placements]});
}

export {PreparedStructures} from './prepared-state.js';
