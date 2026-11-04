import { proposeViews } from "./structure.mjs";

const number=s=>Number(BigInt(s));
const hexNumber=s=>Number(BigInt(`0x${s}`));
const nil=s=>!s||/^0x0+$/.test(s);
const address=n=>`0x${n.toString(16).padStart(16,"0")}`;

export function decodeTrace(raw,plan) {
  const siteMap=new Map(plan.sites.map(s=>[s.id,s]));
  const events=[],frames=[],stack=[],allocations=[],contexts=[],records=[],ports=new Map(),shadow=new Map(),roots=[];
  const owners=new Map(),activeContainers=new Map(),containers=[],pendingSamples=new Map(),slotReads=new Map();
  const indexLinks=[],pairs=[],pairParents=[],pairLinks=[],dispatch=[],bitOperations=[],lookupTables=new Map();
  const functionTargets=new Map();
  const callTables=[],scratch=new Map(),copiedBitsets=new Map(),fieldReferences=[];
  let pointerSize=8,vectorOffsets=[8,16,24],pendingCall,lastExit,errorBlockId;
  function add(kind,fields) { const event={eventId:`e${events.length+1}`,kind,activationId:stack.at(-1)?.id??null,...fields};
    if(kind==="ERROR") errorBlockId=event.eventId;
    if(errorBlockId) event.errorBlockId=errorBlockId;
    events.push(event);return event; }
  function allocationAt(pointer) {
    const p=BigInt(pointer);
    return allocations.find(a=>a.alive&&p>=BigInt(a.payload)&&p<BigInt(a.payload)+BigInt(a.payloadBytes));
  }
  function recordAt(pointer) { return records.find(r=>r.address===pointer); }
  function currentContainer(pointer) { const c=activeContainers.get(pointer);if(!c) throw new Error(`Container lifetime missing: ${pointer}`);return c; }
  const fields=r=>[{id:`offset:${vectorOffsets[0]}`,kind:"size",value:number(r.x)},
    {id:`offset:${vectorOffsets[1]}`,kind:"size",value:number(r.y)},
    {id:`offset:${vectorOffsets[2]}`,kind:"size",value:hexNumber(r.z)}];
  for(const r of raw) {
    if(r.site===-1) {
      const frame={id:`f${frames.length+1}`,functionAddress:r.o,callerAddress:r.a,parent:stack.at(-1)?.id??null,ended:false};
      if(pendingCall) { frame.indirectTarget=pendingCall.target;pendingCall.entered=frame.id;pendingCall.functionAddress=r.o;
        const known=functionTargets.get(frame.indirectTarget);if(known&&known!==r.o) throw new Error("Indirect callee identity changed");functionTargets.set(frame.indirectTarget,r.o);pendingCall=null; }
      frames.push(frame);stack.push(frame);add("SPACE",{action:"frame.begin",frameId:frame.id,evidence:"compiler function instrumentation"});
      add("FLOW",{action:"enter",frameId:frame.id});continue;
    }
    if(r.site===-2) {
      const frame=stack.at(-1);
      if(!frame||frame.functionAddress!==r.o) throw new Error("Unbalanced compiler function trace");
      add("FLOW",{action:"return",frameId:frame.id});add("SPACE",{action:"frame.end",frameId:frame.id});frame.ended=true;lastExit=frame;stack.pop();
      for(const c of containers) if(c.ownerActivation===frame.id&&!c.ended) { c.ended=true;if(activeContainers.get(c.address)===c) activeContainers.delete(c.address); }
      continue;
    }
    const s=siteMap.get(r.site);if(!s) throw new Error(`Unknown site ${r.site}`);
    const e=add(s.kind,{instructionId:s.instructionId,category:s.category,source:s.source,evidence:"observed",raw:r});
    if(s.category==="layout.profile") pointerSize=number(r.x);
    else if(s.category==="layout.call-table") callTables.push({id:r.o,address:r.o,stride:number(r.y),offset:hexNumber(r.z),
      rows:number(r.x)/number(r.y),hasFunctionField:true,observedRows:[],verifiedTargets:0});
    else if(s.category==="layout.vector-fields") vectorOffsets=[number(r.x),number(r.y),hexNumber(r.z)];
    else if(s.category==="context.begin") contexts.push({address:r.o,size:number(r.x),alive:true});
    else if(s.category==="context.end") { const c=contexts.find(c=>c.address===r.o&&c.alive);if(!c) throw new Error("Unknown context free");c.alive=false; }
    else if(s.category==="allocation.begin") allocations.push({id:`H${allocations.length+1}`,address:r.o,payload:r.a,payloadBytes:number(r.y),totalBytes:number(r.x),alive:true,createdBy:e.eventId});
    else if(s.category==="allocation.end") { const a=allocations.find(a=>a.address===r.o&&a.alive);if(!a) throw new Error("Unknown arena free");a.alive=false;a.freedBy=e.eventId; }
    else if(s.category==="owner.begin") owners.set(r.o,{id:`owner${owners.size+1}`,typeId:s.typeId,index:number(r.x),activation:stack.at(-1).id});
    else if(s.category==="container.begin") {
      const owner=s.owner==="record"?owners.get(r.a):null;
      if(s.owner==="record"&&!owner) throw new Error("Missing parent record lifetime");
      const c={id:`container${containers.length+1}`,address:r.o,ownerActivation:owner?.activation??stack.at(-1).id,
        samples:[],moves:[],typeId:s.typeId,ended:false};
      const previous=activeContainers.get(r.o);if(previous&&!previous.ended) throw new Error("Overlapping container registration");
      containers.push(c);activeContainers.set(r.o,c);e.objectId=c.id;
    } else if(s.category==="container.before") {
      const c=currentContainer(r.o);pendingSamples.set(c.id,{before:fields(r),data:r.a});e.objectId=c.id;
    } else if(s.category==="container.after") {
      const c=currentContainer(r.o),sample=pendingSamples.get(c.id);if(!sample) throw new Error("Missing pre-append sample");
      sample.after=fields(r);sample.nextData=r.a;sample.payloadBytes=allocationAt(r.a)?.payloadBytes;
      if(r.a!==r.b&&!nil(r.b)) { const old=allocationAt(r.b);if(!old) throw new Error("Old backing was freed during move");c.moves.push({old:r.b,next:r.a,oldAllocation:old.id,oldStillAlive:true,event:e.eventId}); }
      e.objectId=c.id;
    } else if(s.category==="indexed.store") {
      const c=currentContainer(r.o),sample=pendingSamples.get(c.id);
      sample.store={offset:Number(BigInt(r.a)-BigInt(sample.nextData)),width:number(r.y)};
      c.samples.push(sample);pendingSamples.delete(c.id);e.objectId=c.id;
    } else if(s.category==="record.begin") {
      const physical=allocationAt(r.o);if(!physical) throw new Error("Typed object not in known payload");
      const rec={id:`object${records.length+1}`,address:r.o,typeId:s.typeId,allocation:physical.id,
        owner:r.a,index:number(r.x),tag:s.typeId==="T1"?number(r.x):number(r.y),createdBy:e.eventId,words:[]};
      if(s.typeId==="T4") rec.slot=r.a;
      records.push(rec);e.objectId=rec.id;e.physicalRegion={allocation:physical.id,offset:Number(BigInt(r.o)-BigInt(physical.address))};
    } else if(s.category==="field.ports") {
      const rec=recordAt(r.o);for(const [index,p] of [r.a,r.b].entries()) ports.set(p,{record:rec,index,id:`${rec.id}:field${index}`});
    } else if(s.category==="root.reference") roots[number(r.x)]=recordAt(r.a)?.id;
    else if(s.category==="reference") {
      const field=s.typeId==="T2"?r.b:`${r.o}:${s.field}`;
      const rec=recordAt(r.o);
      shadow.set(field,{from:r.o,to:r.a,typeId:s.typeId,field:s.field,event:e.eventId});
      if(rec) e.objectId=rec.id;
      e.value=r.a;
    } else if(s.category==="indirect.slot.read") {
      const patch=recordAt(r.o),port=ports.get(r.a);if(!patch||patch.slot!==r.a||!port) throw new Error("Unresolved pointer-to-field");
      e.target={objectId:patch.id,field:"slot"};e.value=r.a;e.observedTargetBefore=r.b;e.beforeEvidence="observer state snapshot";
      slotReads.set(r.o,{event:e.eventId,port,old:r.b,slot:r.a});
    } else if(s.category==="indirect.slot.write") {
      const read=slotReads.get(r.o);if(!read||read.slot!==r.a||recordAt(r.o).slot!==r.a) throw new Error("Indirect slot changed unexpectedly");
      e.target={objectId:read.port.record.id,field:`field${read.port.index}`,address:r.a};e.before=read.old;e.value=r.b;
      e.addressInputs=[read.event];e.pointerToSlotUnchanged=true;
      fieldReferences.push({from:recordAt(r.o).id,to:read.port.id,slotAddress:r.a,value:r.b,event:e.eventId});
      shadow.set(r.a,{from:read.port.record.address,to:r.b,typeId:"T2",field:`out[${read.port.index}]`,event:e.eventId});
    } else if(s.category==="indirect.enter") {
      const call={owner:r.o,target:number(r.x),event:e.eventId};dispatch.push(call);pendingCall=call;
    } else if(s.category==="call.target") {
      const table=callTables.find(t=>BigInt(r.o)>=BigInt(t.address)&&BigInt(r.o)<BigInt(t.address)+BigInt(t.rows*t.stride));
      if(!table) throw new Error("Function-pointer field is outside the registered static array");
      const row=Number(BigInt(r.o)-BigInt(table.address)-BigInt(table.offset))/table.stride;
      if(!Number.isInteger(row)||row<0||row>=table.rows) throw new Error("Function-pointer field alignment mismatch");
      if(!table.observedRows.includes(row)) table.observedRows.push(row);
      e.target={objectId:table.id,index:row,fieldOffset:table.offset};e.value={functionIdentity:number(r.x)};
    } else if(s.category==="call.result") {
      const call=dispatch.at(-1);if(!call||call.entered!==lastExit?.id) throw new Error("Call result not matched to actual callee frame");
      call.returned=true;e.calleeActivationId=call.entered;e.value={start:r.a,first:r.b};e.evidence="observed caller result after return";
      callTables.forEach(t=>t.verifiedTargets++);
    } else if(s.category==="bitwise.result") bitOperations.push({word:number(r.x),bit:number(r.y),valueHex:r.z,address:r.o,typeId:s.typeId});
    else if(s.category==="bitset.begin") scratch.set(r.o,{owner:r.a,words:number(r.x),logicalBits:number(r.y)});
    else if(s.category==="bitset.copy") copiedBitsets.set(r.o,r.b);
    else if(s.category==="bitset.word") recordAt(r.o).words[number(r.x)]=r.z;
    else if(s.category==="record.ready") { const rec=recordAt(r.o);rec.accepting=!!number(r.y);rec.nextAddress=r.b;rec.wordCount=hexNumber(r.z); }
    else if(s.category==="index.link") {
      const link={owner:r.o,from:recordAt(r.a)?.id,to:recordAt(r.b)?.id,indexFrom:number(r.x),symbol:number(r.y),indexTo:hexNumber(r.z)};
      if(!link.from||!link.to) throw new Error("Cached index target unresolved");indexLinks.push(link);e.indexLink=link;
    } else if(s.category==="pair.insert") pairs.push({id:number(r.x),address:r.a,coordinates:[number(r.y),hexNumber(r.z)],owner:r.o});
    else if(s.category==="parent.index") pairParents.push({id:number(r.x),parent:BigInt(r.y)===(1n<<BigInt(pointerSize*8))-1n?null:number(r.y),depth:hexNumber(r.z)});
    else if(s.category==="pair.link") pairLinks.push({from:number(r.x),to:number(r.y),symbol:hexNumber(r.z),domains:[r.a,r.b]});
    else if(s.category==="indexed.lookup-array") lookupTables.set(r.o,{id:`table:${r.a}`,capacity:number(r.x),knownCells:0,address:r.a});
    else if(s.category==="lookup.store") { const t=lookupTables.get(r.o);if(t?.address===r.a) t.knownCells++; }
    else if(s.category==="zero-range") { e.value={repeatByte:0,byteLength:number(r.x)};e.evidence="memset API effect; internal store order unobserved"; }
  }
  const references=[...shadow.values()].filter(r=>!nil(r.to));
  const groupFor=(id,nodes)=>({id,nodes:nodes.map(r=>({id:r.id})),edges:references.filter(e=>nodes.some(n=>n.address===e.from)&&nodes.some(n=>n.address===e.to))
    .map(e=>({from:recordAt(e.from).id,to:recordAt(e.to).id,field:e.field}))});
  const trees=roots.filter(Boolean).map(root=>{
    const selected=new Set([root]);let changed=true;
    while(changed) { changed=false;for(const e of references.filter(e=>e.typeId==="T1")) {
      const from=recordAt(e.from)?.id,to=recordAt(e.to)?.id;if(selected.has(from)&&to&&!selected.has(to)) { selected.add(to);changed=true; }
    } }
    return groupFor(`references:${root}`,records.filter(r=>selected.has(r.id)));
  });
  const graphOwners=[...owners.entries()].filter(([,o])=>o.typeId==="T10").sort((a,b)=>a[1].index-b[1].index);
  const graphs=graphOwners.map(([owner])=>groupFor(`references:${owner}`,records.filter(r=>r.typeId==="T2"&&r.owner===owner)));
  const cacheOwners=[...owners.entries()].filter(([,o])=>o.typeId==="T11").sort((a,b)=>a[1].index-b[1].index);
  const pairDomains=pairLinks[0]?.domains.map(owner=>({id:owner,observedIndexResolution:indexLinks.some(l=>l.owner===owner),
    keys:records.filter(r=>r.typeId==="T6"&&r.owner===owner).map(r=>r.index)}))??[];
  const blocks=allocations.map(a=>({id:a.address}));
  const blockEdges=references.filter(e=>e.typeId==="T5").map(e=>({from:e.from,to:e.to}));
  const patchChain=groupFor("indirect-reference-chain",records.filter(r=>r.typeId==="T4"));
  const flexibleBitsets=records.filter(r=>r.typeId==="T6").map(r=>({id:r.id,words:r.words,
    logicalBits:scratch.get(copiedBitsets.get(r.address))?.logicalBits,
    copiedFromObservedBitset:scratch.has(copiedBitsets.get(r.address))}));
  const facts={referenceGroups:[...trees,...graphs,patchChain,{id:"allocation-chain",nodes:blocks,edges:blockEdges}],containers,
    pairGrid:{domains:pairDomains,points:pairs},bitset:{wordBits:64,wordCount:4,operations:bitOperations.filter(o=>o.typeId==="T8")},
    discoveryTree:{nodes:pairs.map(p=>({id:String(p.id)})),edges:pairParents.filter(p=>p.parent!==null).map(p=>({from:String(p.parent),to:String(p.id)}))},
    flexibleBitsets,fieldReferences,callTables,indexLinks,lookupTables:[...lookupTables.values()]};
  const proposals=proposeViews(facts);
  const stats={recordNodes:trees.map(t=>t.nodes.length),recordEdges:trees.map(t=>t.edges.length),automatonNodes:graphs.map(g=>g.nodes.length),
    automatonEdges:graphs.map(g=>g.edges.length),indirectSlotWrites:events.filter(e=>e.category==="indirect.slot.write").length,
    indirectCalls:graphOwners.map(([owner])=>dispatch.filter(d=>d.owner===owner).map(d=>d.target)),
    cachedStateCounts:cacheOwners.map(([owner])=>records.filter(r=>r.typeId==="T6"&&r.owner===owner).length),
    pairCount:pairs.length,computedTransitions:indexLinks.length,errorBlocks:events.filter(e=>e.kind==="ERROR").length,
    frames:frames.length,arenaAllocations:allocations.length,arenaFrees:allocations.filter(a=>!a.alive).length,
    contextBalanced:contexts.every(c=>!c.alive),retainedMoves:containers.flatMap(c=>c.moves).length};
  return {events,frames,allocations,records,facts,proposals,stats,graphs,trees,pairs,pairParents,pairLinks,functionTargets:[...functionTargets],
    coverage:plan.coverage,snapshot:"last observed structural values before cleanup; all final lifetimes are recorded separately"};
}
