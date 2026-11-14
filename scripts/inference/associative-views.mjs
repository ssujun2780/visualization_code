// Optional associations over finalized events. No identifiers, hash constants,
// source text, or desired outputs participate in these rules.
import {createValueFlow} from './observed-value-flow.mjs';
import {slotTimeline} from './array-membership.mjs';
import {stateHistoryCoverage,appendStateSnapshot,stateHistoryGapAt,structureStateAt} from './state-history.mjs';
import {equalityEvidence,addressDependencyReads} from './comparison-evidence.mjs';
import {scalarPayload,comparePayload} from './scalar-domain.mjs';
const unwrap=n=>{while(n&&['ImplicitCastExpr','ParenExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
const number=v=>{const n=Number(v?.decimal??v?.signed??v?.unsigned);return Number.isSafeInteger(n)?n:null;};
const key=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const contains=(r,t)=>r&&t&&r.objectId===t.objectId&&r.offset<=t.offset&&t.offset+t.size<=r.offset+r.size;
const unique=a=>[...new Set(a)];

export function associativeStructures(plan,trace,{maxStates=2048,maxEntries=4096}={}){
  const {events,objects,structures}=trace,flow=trace.valueFlow??createValueFlow(plan,trace),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),arrays=structures.filter(s=>s.kind==='array').sort((a,b)=>b.range.size-a.range.size||a.range.offset-b.range.offset),
    origins=new Map(),timelines=new Map(),contexts=new Map(),byActivation=new Map();
  for(const e of events){if(!byActivation.has(e.activationId))byActivation.set(e.activationId,[]);byActivation.get(e.activationId).push(e);}
  const origin=id=>{if(!origins.has(id))origins.set(id,flow.chain(id).at(-1)?.eventId);return origins.get(id);};
  const reads=(input,e,step)=>flow.dependencyReads(input,e,step,new Set(),()=>false);
  const depended=(e,token)=>{const d=addressDependencyReads(flow,byId,e.addressInputs??[]);return !!token&&d.complete&&d.reads.some(r=>origin(r.eventId)===token);};
  const alive=(id,at)=>{const o=objects.find(o=>o.id===id);return o&&pos.get(o.createdBy)<=at&&at<(pos.get(o.endedBy)??Infinity);};
  function locate(e){
    if(!e?.target)return null;
    let node=unwrap(defs.get(e.instructionId)?.expression);if(node?.operator==='=')node=unwrap(node.children[0]);
    const field=node?.kind==='MemberExpr'?node:null,record=field&&(field.children[0]?.cType?.pointee??field.children[0]?.cType),part=field?.targetPath?.at(-1);
    const a=arrays.find(a=>contains(a.range,e.target)&&(!record||a.elementType?.recordTypeId===record.recordTypeId)&&
      (field||a.elementType?.kind!=='record'&&a.elementType?.kind!=='array')&&e.target.size<=a.elementBytes);
    if(!a)return null;const index=Math.floor((e.target.offset-a.range.offset)/a.elementBytes),offset=e.target.offset-a.range.offset-index*a.elementBytes;
    if(field&&(!part||part.offsetBits!==offset*8||part.sizeBits!==e.target.size*8))return null;
    return {arrayId:a.id,index,offset,size:e.target.size,type:e.value?.cType??node?.cType,fieldNodeId:field?.fieldNodeId??null,
      recordTypeId:record?.recordTypeId??null,record:{objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes},range:{objectId:e.target.objectId,offset:e.target.offset,size:e.target.size}};
  }
  const accesses=events.filter(e=>['READ','WRITE'].includes(e.kind)&&e.target).map(e=>({e,loc:locate(e)}));
  const scalarAt=(r,at,signed=true)=>{const k=`${key(r)}:${signed}`;if(!timelines.has(k))timelines.set(k,slotTimeline(r,events,{signed}));return timelines.get(k).findLast(x=>x.sequence<=at);};
  function transformsFor(seed,token){
    const traversed=new Set(),transforms=[];
    const visit=id=>{if(traversed.has(id))return;traversed.add(id);const x=byId.get(id);if(!x)return;
      const d=addressDependencyReads(flow,byId,[id]);
      if(x.kind==='CALC'&&x.value?.cType?.kind!=='pointer'&&(x.steps??[]).some(s=>s.operator&&s.operator!=='cast')&&d.complete&&d.reads.some(r=>origin(r.eventId)===token))transforms.push(id);
      for(const input of x.dataInputs??[])visit(input);
    };for(const input of seed.e.addressInputs??[])visit(input);return unique(transforms);
  }
  function seedFor(activation,token,before=Infinity,arrayId=null){
    return accesses.find(({e,loc})=>pos.get(e.eventId)<=before&&loc&&(!arrayId||loc.arrayId===arrayId)&&depended(e,token));
  }
  // Discover a lookup from a stored key comparison and an actual query-derived
  // bucket access. A linear search or modulo histogram lacks this conjunction.
  for(const comparison of equalityEvidence(plan,trace)){
    const {event:e,step}=comparison;
    for(let side=0;side<2;side++){
      const stored=comparison.reads[side],query=comparison.reads[1-side],loc=locate(stored);
      if(!loc||!query||comparison.domain==='scalar'&&!['signed','unsigned'].includes(stored.value?.cType?.signedness)||contains(loc.record,query.target))continue;
      const token=origin(query.eventId),seeds=accesses.filter(({e:x,loc:l})=>l&&pos.get(x.eventId)<=pos.get(stored.eventId)&&depended(x,token)),seed=comparison.domain==='nul-terminated-bytes'?seeds.find(x=>transformsFor(x,token).length):seeds[0];if(!seed)continue;
      const transforms=transformsFor(seed,token);
      const id=`associative:${seed.loc.arrayId}:${loc.recordTypeId??loc.arrayId}:${loc.fieldNodeId??loc.offset}:${loc.size}`;
      let c=contexts.get(id);if(!c)contexts.set(id,c={id,seedArray:arrays.find(a=>a.id===seed.loc.arrayId),keyRole:loc,discovered:e.eventId,lookups:[],entries:new Map(),payloads:new Map(),states:[],stateRoles:new Map(),insertions:[]});
      c.lookups.push({executionId:e.eventId,comparisonNodeId:step.nodeId,operator:step.operator,keyReadExecutionId:stored.eventId,queryReadExecutionId:query.eventId,
        queryOriginExecutionId:token,seedExecutionId:seed.e.eventId,seedArrayId:seed.loc.arrayId,bucketIndex:seed.loc.index,index:loc.index,entryId:key(loc.record),keyRange:loc.range,
        activationId:e.activationId,bucketTransformExecutionIds:unique(transforms),comparisonDomain:comparison.domain,
        ...(comparison.comparisonCallExecutionId?{comparisonCallExecutionId:comparison.comparisonCallExecutionId,comparisonReturnExecutionId:comparison.comparisonReturnExecutionId,readRegions:comparison.readRegions}:{}),
        matched:(number(step.value)!==0)===(step.operator==='==')});
      c.entries.set(key(loc.record),{id:key(loc.record),record:loc.record,keyRange:loc.range,keyType:loc.type,arrayId:loc.arrayId,index:loc.index,discovered:stored.eventId});
    }
  }
  const fieldRange=(record,role)=>({objectId:record.objectId,offset:record.offset+role.offset,size:role.size});
  // Exact scalar-field origins across aggregate copies remain distinguishable.
  function writeSources(e,range){
    if(e.action==='copy'&&e.sourceObjectId){const source={objectId:e.sourceObjectId,offset:(e.sourceOffset??0)+range.offset-e.target.offset,size:range.size},
      last=events.slice(0,pos.get(e.eventId)).findLast(w=>w.kind==='WRITE'&&contains(w.target,source));
      return last?(last.dataInputs??[]).flatMap(id=>reads(id)):[];
    }
    return key(e.target)===key(range)?(e.dataInputs??[]).flatMap(id=>reads(id)):[];
  }
  function addPayload(c,entry,range,e,basis){
    if(key(range)===key(entry.keyRange)||!['signed','unsigned'].includes(e.value?.cType?.signedness)&&!basis.includes('insertion'))return;
    // A bucket head copied into a record is connectivity, not its payload.
    if(basis.includes('insertion')&&writeSources(e,range).some(r=>contains(c.seedArray.range,r.target)))return;
    const id=key(range);if(!c.payloads.has(id))c.payloads.set(id,{entryId:entry.id,range,discovered:e.eventId,evidenceExecutionIds:[e.eventId],basis});
  }
  for(const c of contexts.values()){
    c.coverage={...stateHistoryCoverage(maxStates),maxEntries};
    const layout=c.keyRole,frameLookups=new Map();
    for(const p of c.lookups){if(!frameLookups.has(p.activationId))frameLookups.set(p.activationId,[]);frameLookups.get(p.activationId).push(p);}
    // Reuse learned key layout at insertion sites only when its input also
    // supplies this bucket array's index in the same actual activation.
    for(const {e,loc}of accesses)if(e.kind==='WRITE'){
      const candidateArrays=arrays.filter(a=>contains(a.range,e.target)&&(layout.recordTypeId?a.elementType?.recordTypeId===layout.recordTypeId:a.id===layout.arrayId));
      const a=candidateArrays[0];if(!a)continue;
      const start=Math.floor((e.target.offset-a.range.offset)/a.elementBytes),stop=Math.min(a.capacity,Math.ceil((e.target.offset+e.target.size-a.range.offset)/a.elementBytes));
      for(let index=start;index<stop;index++){
        const record={objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes},range=fieldRange(record,layout);if(!contains(e.target,range))continue;
        const sources=writeSources(e,range),seed=sources.map(r=>({read:r,seed:seedFor(e.activationId,origin(r.eventId),Infinity,c.seedArray.id)})).find(x=>x.seed);
        if(!seed)continue;const id=key(record),known=c.entries.get(id),at=pos.get(seed.seed.e.eventId)>pos.get(e.eventId)?seed.seed.e.eventId:e.eventId;
        if(!known||pos.get(at)<pos.get(known.discovered))c.entries.set(id,{id,record,keyRange:range,keyType:layout.type,arrayId:a.id,index,discovered:at});
        c.insertions.push({entryId:id,executionId:e.eventId,availableAtExecutionId:at,seedExecutionId:seed.seed.e.eventId,queryReadExecutionId:seed.read.eventId,
          bucketIndex:seed.seed.loc.index,keyRange:range,activationId:e.activationId});
      }
    }
    for(const entry of c.entries.values()){
      const own=c.lookups.filter(p=>p.entryId===entry.id),insertions=c.insertions.filter(p=>p.entryId===entry.id);
      for(const {e,loc}of accesses){if(!loc||key(loc.range)===key(entry.keyRange))continue;
        const sameRecord=layout.recordTypeId&&key(loc.record)===key(entry.record),sameIndex=!layout.recordTypeId&&loc.index===entry.index&&loc.arrayId!==entry.arrayId;
        if(!sameRecord&&!sameIndex)continue;
        const compared=own.find(p=>p.activationId===e.activationId&&p.matched&&pos.get(p.executionId)<pos.get(e.eventId));
        const returned=compared&&e.kind==='READ'&&(byActivation.get(e.activationId)??[]).some(r=>r.action==='return.value'&&(r.dataInputs??[]).some(id=>flow.chain(id).some(x=>x.eventId===e.eventId)));
        const inserted=insertions.find(p=>p.activationId===e.activationId&&e.kind==='WRITE'&&(sameRecord||
          (e.addressInputs??[]).flatMap(id=>flow.chain(id)).some(x=>(byId.get(p.executionId).addressInputs??[]).flatMap(id=>flow.chain(id)).some(y=>x.eventId===y.eventId))));
        if(returned||inserted&&(e.dataInputs??[]).some(id=>reads(id).length))addPayload(c,entry,loc.range,e,returned?'matched-key-return':'associated-insertion-field');
      }
      // Compound-literal/record copies carry individual payload fields from
      // separate source writes. Constant flags and padding are not payloads.
      const a=arrays.find(a=>a.id===entry.arrayId);
      for(const p of insertions){const e=byId.get(p.executionId);if(e.action!=='copy')continue;
        for(const m of a.elementType?.members??[]){const range={objectId:entry.record.objectId,offset:entry.record.offset+m.offsetBits/8,size:m.sizeBits/8};
          if(key(range)===key(entry.keyRange)||!contains(e.target,range))continue;
          if(writeSources(e,range).length)addPayload(c,entry,range,e,'associated-insertion-copy');
        }
      }
    }
    const probeFrames=new Set([...c.lookups.map(p=>p.activationId),...c.insertions.map(p=>p.activationId)]);
    c.probes=[];
    for(const activation of probeFrames){
      const lookups=frameLookups.get(activation)??[],insertions=c.insertions.filter(p=>p.activationId===activation),seedId=lookups[0]?.seedExecutionId??insertions[0]?.seedExecutionId,
        seed=byId.get(seedId),token=lookups[0]?.queryOriginExecutionId??origin(insertions[0]?.queryReadExecutionId),frame=byActivation.get(activation)??[],sequence=[];
      for(const {e,loc}of accesses)if(e.activationId===activation&&loc&&pos.get(e.eventId)>=pos.get(seedId)&&
        (loc.arrayId===c.seedArray.id||c.entries.has(key(loc.record)))){
        if(sequence.at(-1)?.index!==loc.index)sequence.push({index:loc.index,executionId:e.eventId});
      }
      c.probes.push({activationId:activation,seedExecutionId:seedId,queryOriginExecutionId:token,steps:sequence,comparisonExecutionIds:lookups.map(p=>p.executionId)});
      if(c.seedArray.elementType?.kind==='pointer'||layout.recordTypeId&&c.seedArray.id!==layout.arrayId)continue;
      for(const {e,loc}of accesses)if(e.kind==='READ'&&e.activationId===activation&&loc&&pos.get(e.eventId)>=pos.get(seedId)){
        if(loc.fieldNodeId===layout.fieldNodeId&&loc.arrayId===layout.arrayId||!layout.recordTypeId&&loc.arrayId===layout.arrayId)continue;
        const same=layout.recordTypeId?loc.recordTypeId===layout.recordTypeId:loc.arrayId===c.seedArray.id;
        if(!same||number(e.value)===null)continue;
        const frameProofs=lookups.filter(p=>p.index===loc.index&&pos.get(p.keyReadExecutionId)>pos.get(e.eventId)),
          next=sequence.find(s=>pos.get(s.executionId)>pos.get(e.eventId)&&s.index!==loc.index),limit=next?pos.get(next.executionId):Infinity,
          compared=frameProofs.find(p=>pos.get(p.keyReadExecutionId)<limit),reuse=insertions.find(p=>c.entries.get(p.entryId).index===loc.index&&pos.get(p.executionId)>pos.get(e.eventId)),
          exits=frame.filter(x=>['return.value','return','break'].includes(x.action)&&pos.get(x.eventId)>pos.get(e.eventId)&&!lookups.some(p=>p.matched&&pos.get(p.executionId)<pos.get(x.eventId))),
          stopped=!next&&!insertions.length&&exits.some(x=>(x.controlInputs??[]).some(id=>(byId.get(id)?.dataInputs??[]).some(id=>reads(id).some(r=>r.eventId===e.eventId))));
        if(!compared&&!reuse&&!stopped&&!next)continue;
        const id=`${loc.arrayId}:${loc.offset}:${loc.size}`;let role=c.stateRoles.get(id);if(!role)c.stateRoles.set(id,role={id,arrayId:loc.arrayId,offset:loc.offset,size:loc.size,values:new Map()});
        const value=number(e.value);if(!role.values.has(value))role.values.set(value,{value,evidence:[]});
        role.values.get(value).evidence.push({readExecutionId:e.eventId,index:loc.index,comparisonExecutionId:compared?.executionId??null,
          reuseWriteExecutionId:reuse?.executionId??null,nextAccessExecutionId:next?.executionId??null,stopExecutionId:stopped?exits[0].eventId:null});
      }
    }
    c.stateRoles=[...c.stateRoles.values()].filter(r=>[...r.values.values()].some(v=>v.evidence.some(p=>p.comparisonExecutionId))).map(r=>({...r,values:[...r.values.values()]}));
    c.roles={key:{...layout,basis:'query-derived access and stored equality'},values:[...c.payloads.values()],states:c.stateRoles};
    const ranges=unique([c.seedArray.range,...[...c.entries.values()].map(e=>arrays.find(a=>a.id===e.arrayId).range),...c.payloads.values()].map(x=>JSON.stringify(x.range??x))).map(JSON.parse);
    const changes=events.filter(e=>pos.get(e.eventId)>=pos.get(c.discovered)&&(e.action==='object.end'||['WRITE','SPACE'].includes(e.kind)&&ranges.some(r=>contains(r,e.target??(e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null)))||
      c.lookups.some(p=>p.executionId===e.eventId)||c.insertions.some(p=>p.availableAtExecutionId===e.eventId)||c.stateRoles.some(r=>r.values.some(v=>v.evidence.some(p=>Object.values(p).includes(e.eventId))))));
    for(const e of changes){const at=pos.get(e.eventId),entries=[];
      for(const entry of c.entries.values()){if(pos.get(entry.discovered)>at)continue;
        const k=scalarAt(entry.keyRange,at,entry.keyType?.signedness!=='unsigned');if(!k||k.integer===null)continue;
        const payload=[...c.payloads.values()].filter(p=>p.entryId===entry.id&&pos.get(p.discovered)<=at).map(p=>({...p,value:scalarAt(p.range,at)?.value??null}));
        const states=c.stateRoles.map(r=>{const a=arrays.find(a=>a.id===r.arrayId),range={objectId:a.objectId,offset:a.range.offset+entry.index*a.elementBytes+r.offset,size:r.size},v=scalarAt(range,at),facts=(r.values.find(x=>x.value===v?.value)?.evidence??[]).filter(p=>pos.get(p.readExecutionId)<=at).map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,k.endsWith('ExecutionId')&&v&&pos.get(v)>at?null:v]))),
          compared=facts.some(p=>p.comparisonExecutionId),stop=facts.some(p=>p.stopExecutionId),reuse=facts.some(p=>p.reuseWriteExecutionId),continued=facts.some(p=>p.nextAccessExecutionId);
          const occupied=r.values.filter(v=>v.evidence.some(p=>p.comparisonExecutionId&&pos.get(p.comparisonExecutionId)<=at)).map(v=>v.value),
            prior=timelines.get(`${key(range)}:true`)?.findLast(t=>t.sequence<at&&occupied.includes(t.value)),vacated=continued&&prior&&prior.value!==v?.value;
          return {roleId:r.id,range,value:v?.value??null,status:compared?'occupied':stop?'empty':continued&&(reuse||vacated)?'deleted':continued?'skipped':'unknown',evidenceExecutionIds:unique([...facts.flatMap(p=>[p.readExecutionId,p.comparisonExecutionId,p.reuseWriteExecutionId,p.nextAccessExecutionId,p.stopExecutionId].filter(Boolean)),...(vacated?[prior.eventId]:[])])};
        });
        entries.push({...entry,key:k.value??k.integer,keyDomain:entry.keyType?.kind==='pointer'?'pointer-to-observed-string':'integer',keyObservationExecutionId:k.eventId,values:payload,slotStates:states,alive:alive(entry.record.objectId,at),
          membership:states.length?states.some(s=>['empty','deleted','skipped'].includes(s.status))?'inactive':states.every(s=>s.status==='occupied')?'active':'unknown':'stored-entry'});
      }
      const snapshot={afterExecutionId:e.eventId,alive:alive(c.seedArray.objectId,at),entries:entries.slice(0,maxEntries),omittedEntries:Math.max(0,entries.length-maxEntries),status:'partial'};
      appendStateSnapshot(c.states,snapshot,c.coverage);
    }
    c.storageRanges=ranges;
  }
  const result=[...contexts.values()].map(c=>({id:c.id,kind:'associative-lookup-candidate',origin:'inferred',intent:'unconfirmed',nodes:[],edges:[],
    discoveredAtExecutionId:c.discovered,storageRanges:c.storageRanges,bucketArrayId:c.seedArray.id,representation:c.seedArray.elementType?.kind==='pointer'?'pointer-chaining':c.keyRole.recordTypeId&&c.seedArray.id!==c.keyRole.arrayId?'index-chaining':'open-addressing-candidate',
    roles:c.roles,lookupEvidence:c.lookups,insertionEvidence:c.insertions,probes:c.probes,states:c.states,transfers:[],
    coverage:c.coverage,limitations:['observed associative lookup candidate; intent and hash quality are unproven','unobserved slot-state transitions remain unknown']}));
  for(const c of result){
    c.components=structures.filter(s=>['linked-structure','linked-root-collection','rooted-index-structure','record-index-graph-candidate','coindexed-record-candidate'].includes(s.kind)&&
      [s.root,...s.storageRanges??[],...(s.arrays??[]).map(a=>a.range)].some(r=>r&&c.storageRanges.some(t=>t.objectId===r.objectId&&t.offset<=r.offset&&r.offset<t.offset+t.size))).map(s=>({candidateId:s.id,kind:s.kind}));
    c.collisions=[];const first=new Map(),collided=new Set();for(const b of c.lookupEvidence){
      const a=first.get(b.bucketIndex);if(!a){first.set(b.bucketIndex,b);continue;}if(collided.has(b.bucketIndex))continue;
      const compared=comparePayload(scalarPayload(byId.get(a.queryReadExecutionId).value),scalarPayload(byId.get(b.queryReadExecutionId).value));
      if(compared.status!=='ordered'||compared.sign===0)continue;
      collided.add(b.bucketIndex);
      c.collisions.push({bucketIndex:b.bucketIndex,queryReadExecutionIds:[a.queryReadExecutionId,b.queryReadExecutionId],seedExecutionIds:[a.seedExecutionId,b.seedExecutionId],afterExecutionId:b.executionId});
    }
  }
  // Cross-backing identity follows the actual old key and payload READs through
  // call arguments to new WRITEs, not equality of numeric values.
  for(const target of result)for(const insert of target.insertionEvidence){const write=byId.get(insert.executionId),targetEntry=target.states.findLast(s=>pos.get(s.afterExecutionId)>=pos.get(insert.availableAtExecutionId))?.entries.find(e=>e.id===insert.entryId);
    if(!targetEntry)continue;const sources=writeSources(write,insert.keyRange);
    for(const source of result){if(source===target)continue;
      const sourceState=source.states.findLast(s=>pos.get(s.afterExecutionId)<=pos.get(insert.executionId));if(!sourceState)continue;
      for(const old of sourceState.entries){const keyRead=sources.find(r=>key(r.target)===key(old.keyRange));if(!keyRead)continue;
        const values=[];for(const payload of targetEntry.values){const w=events.find(e=>e.eventId===payload.discovered);if(w?.kind!=='WRITE')continue;
          for(const r of writeSources(w,payload.range))if(old.values.some(v=>key(v.range)===key(r.target)))values.push({sourceReadExecutionId:r.eventId,targetWriteExecutionId:w.eventId,sourceRange:r.target,targetRange:payload.range});}
        if(!values.length)continue;const at=[insert.executionId,...values.map(v=>v.targetWriteExecutionId)].sort((a,b)=>pos.get(a)-pos.get(b)).at(-1);
        target.transfers.push({kind:'observed-entry-transfer',sourceCandidateId:source.id,sourceEntryId:old.id,targetEntryId:targetEntry.id,keyReadExecutionId:keyRead.eventId,keyWriteExecutionId:insert.executionId,
          values,afterExecutionId:at,discoveredAtExecutionId:[at,source.discoveredAtExecutionId,target.discoveredAtExecutionId].sort((a,b)=>pos.get(a)-pos.get(b)).at(-1),meaning:'entry transfer across backing stores; resizing intent unconfirmed'});
      }
    }
  }
  return result;
}

// Public query filters future role/transfer proofs; the stored overlay is a
// historical evidence ledger, never an instruction to execute the program.
export function queryAssociativeLookup(trace,{candidateId,afterExecutionId}={}){
  const s=trace.structures?.find(s=>s.id===candidateId&&s.kind==='associative-lookup-candidate');if(!s)return null;
  const pos=new Map(trace.events.map((e,i)=>[e.eventId,i])),at=afterExecutionId===undefined?trace.events.length-1:pos.get(afterExecutionId);
  if(at===undefined)throw new RangeError('관측한 실행 식별자가 필요합니다.');
  const seen=id=>pos.has(id)&&pos.get(id)<=at;if(!seen(s.discoveredAtExecutionId))return null;
  const state=structureStateAt(s,pos,at,trace.objects);
  return structuredClone({candidateId:s.id,intent:s.intent,representation:s.representation,state,historyGap:!!state?.historyGap||stateHistoryGapAt(s,pos,at),
    lookups:s.lookupEvidence.filter(p=>seen(p.executionId)),insertions:s.insertionEvidence.filter(p=>seen(p.availableAtExecutionId)),
    probes:s.probes.filter(p=>seen(p.seedExecutionId)).map(p=>({...p,steps:p.steps.filter(x=>seen(x.executionId)),comparisonExecutionIds:p.comparisonExecutionIds.filter(seen)})),
    collisions:s.collisions.filter(p=>seen(p.afterExecutionId)),transfers:s.transfers.filter(p=>seen(p.discoveredAtExecutionId))});
}
