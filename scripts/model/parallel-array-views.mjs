// Associate per-index values only through recorded value/index flow. These are
// metadata views of existing storage, never an algorithm or cardinality claim.
import {createValueFlow} from './observed-value-flow.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
const number=v=>{const raw=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);if(raw===undefined)return null;
  const n=Number(raw);return Number.isSafeInteger(n)?n:null;};
const unique=items=>[...new Set(items)];
const slot=(a,t)=>t?.objectId===a.objectId&&t.size===a.elementBytes&&t.offset>=a.range.offset&&
  t.offset+t.size<=a.range.offset+a.range.size&&(t.offset-a.range.offset)%a.elementBytes===0?(t.offset-a.range.offset)/a.elementBytes:null;
const inputIds=e=>unique([...(e?.dataInputs??[]),...(e?.inputs??[]).map(i=>i.executionId).filter(Boolean)]);
const rangeAt=(a,index)=>({objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes});
function scalarSnapshot(e){
  const size=e.target?.size;if(!Number.isSafeInteger(size)||size<1||size>16)return null;
  const observed=observeScalarBytes(null,{size,value:e.value?.bits??e.value?.decimal}),
    bytes=e.value?.bytesHex??observed?.bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
  return {byteLength:size,ranges:[{offset:0,length:size,initialization:bytes?.length===size*2?'initialized':'unknown',
    ...(bytes?{data:{encoding:'hex',bytesHex:bytes}}:{})}]};
}

export function parallelArrayStructures(plan,{events,objects=[],structures=[],resultDeliveries=[],valueFlow}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    positions=new Map(events.map((e,i)=>[e.eventId,i])),flow=valueFlow??createValueFlow(plan,{events,resultDeliveries}),
    arrays=[...new Map(structures.filter(a=>a.kind==='array'&&['signed','unsigned'].includes(a.elementType?.signedness))
      .map(a=>[a.storageIdentity??`${a.objectId}:${a.range.offset}:${a.range.size}`,a])).values()],
    graphs=structures.filter(s=>s.kind==='value-index-graph-candidate'),candidates=new Map();
  const operator=e=>e?.operator??defs.get(e?.instructionId)?.operator;
  for(const access of events){
    if(!['READ','WRITE'].includes(access.kind))continue;
    for(const metadata of arrays){
      const index=slot(metadata,access.target);if(index===null)continue;
      for(const indexExecutionId of access.addressInputs??[]){
        if(number(byEvent.get(indexExecutionId)?.value)!==index)continue;
        for(const read of flow.reads(indexExecutionId)){
          if(number(read.value)!==index)continue;
          for(const domain of arrays){
            const sourceIndex=slot(domain,read.target);if(sourceIndex===null||domain.id===metadata.id)continue;
            const key=`${domain.id}:${metadata.id}`;
            if(!candidates.has(key))candidates.set(key,{domain,metadata,associations:[],comparisons:[],aggregations:[]});
            const c=candidates.get(key);
            if(c.associations.some(a=>a.accessExecutionId===access.eventId&&a.sourceReadExecutionId===read.eventId))continue;
            c.associations.push({accessExecutionId:access.eventId,indexExecutionId,sourceReadExecutionId:read.eventId,
              sourceIndex,index,source:rangeAt(domain,sourceIndex),target:rangeAt(metadata,index),
              evidence:'observed array value preserved into metadata index'});
          }
        }
      }
    }
  }
  const result=[];
  for(const c of candidates.values()){
    const {domain,metadata,associations}=c,associated=new Map();
    for(const a of associations){if(!associated.has(a.accessExecutionId))associated.set(a.accessExecutionId,[]);associated.get(a.accessExecutionId).push(a);}
    const operands=e=>unique(inputIds(e).map(id=>flow.sourceRead(id)?.eventId).filter(id=>associated.has(id)))
      .map(id=>({executionId:id,index:slot(metadata,byEvent.get(id).target),source:byEvent.get(id).target}));
    for(const e of events){
      if(e.kind!=='CALC'||!['==','!=','<','<=','>','>='].includes(operator(e)))continue;
      const reads=operands(e);if(reads.length!==2||reads[0].index===reads[1].index)continue;
      c.comparisons.push({executionId:e.eventId,operator:operator(e),operands:reads,evidence:'observed comparison of associated per-index values'});
    }
    for(const write of events){
      if(write.kind!=='WRITE'||!associated.has(write.eventId))continue;
      const index=slot(metadata,write.target);if(index===null)continue;
      for(const id of inputIds(write)){
        const calc=byEvent.get(id);if(calc?.kind!=='CALC'||!['+','+='].includes(operator(calc)))continue;
        // One observed binary sum only. Flattened multi-step expressions or
        // additional literal operands cannot establish this aggregation role.
        if(inputIds(calc).length!==2||calc.inputs&&calc.inputs.length!==2||
          calc.steps&&(calc.steps.length!==1||!['+','+='].includes(calc.steps[0].operator)||
            calc.steps[0].inputs?.length!==2||calc.steps[0].inputs.some(i=>!i.executionId)))continue;
        const reads=operands(calc),indices=unique(reads.map(r=>r.index));
        if(reads.length!==2||indices.length!==2||!indices.includes(index))continue;
        const comparison=c.comparisons.findLast(x=>positions.get(x.executionId)<positions.get(calc.eventId)&&
          byEvent.get(x.executionId)?.activationId===write.activationId&&x.operands.every(r=>indices.includes(r.index)));
        if(!comparison)continue;
        const sourceIndex=indices.find(i=>i!==index),linkWrite=events.slice(positions.get(comparison.executionId)+1,positions.get(write.eventId))
          .findLast(e=>e.kind==='WRITE'&&e.activationId===write.activationId&&slot(domain,e.target)===sourceIndex&&number(e.value)===index);
        c.aggregations.push({executionId:write.eventId,calculationExecutionId:calc.eventId,comparisonExecutionId:comparison.executionId,
          index,sourceIndices:indices,operands:reads,target:rangeAt(metadata,index),operator:'+',
          ...(linkWrite?{linkWriteExecutionId:linkWrite.eventId}:{}),evidence:'observed sum of associated values written to an operand index'});
      }
    }
    // Common extents, initialization values and variable names are no evidence.
    if(!c.comparisons.length||!c.aggregations.length)continue;
    const graph=graphs.find(g=>g.arrayId===domain.id||g.storageIdentity&&g.storageIdentity===domain.storageIdentity),
      graphUpdates=new Map((graph?.states??[]).map(s=>[s.afterExecutionId,s])),slots=new Map(),states=[],
      object=objects.find(o=>o.id===metadata.objectId),
      trackedIndices=unique([...events.filter(e=>['READ','WRITE'].includes(e.kind)).map(e=>slot(metadata,e.target)),
        ...associations.map(a=>a.index),...(graph?.states??[]).flatMap(s=>(s.nodes??[])
          .filter(n=>n.value!==null&&n.value!==undefined).map(n=>n.index))])
        .filter(index=>Number.isSafeInteger(index)&&index>=0&&index<metadata.capacity).sort((a,b)=>a-b);
    let graphState=null,alive=false,ended=false;
    function record(e){
      const observed=new Set((graphState?.nodes??[]).filter(n=>n.value!==null&&n.value!==undefined&&n.status!=='ended').map(n=>n.index)),
        reps=new Map((graphState?.alive===false?[]:graphState?.representatives??[]).map(r=>[r.index,r])),known=new Map();
      for(const r of reps.values())if(observed.has(r.index)&&r.rootIndex!==null&&r.rootIndex!==undefined)known.set(r.rootIndex,(known.get(r.rootIndex)??0)+1);
      const nodes=[...slots.entries()].sort((a,b)=>a[0]-b[0]).map(([index,s])=>{
        const representative=reps.get(index),rootIndex=representative?.rootIndex??null,
          role=rootIndex===null?'unconfirmed':rootIndex===index?'representative-applicable':'nonrepresentative-retained',
          count=role==='representative-applicable'&&graphState?.alive!==false?known.get(index)??0:null;
        return {index,...rangeAt(metadata,index),value:s.bytes?.value??null,status:!alive?'ended':s.bytes?.value===null?'unknown':'observed',
          lastWriteExecutionId:s.lastWriteExecutionId,role,rootIndex,
          ...(count===null?{}:{knownMemberCount:count,countScope:graphState?.topology?.complete?'complete-observed-domain':'known-members-only',
            cardinalityCorrespondence:s.bytes?.value===count?'observed-count-match':'unconfirmed'})};
      });
      const position=positions.get(e.eventId),pending=c.aggregations.filter(a=>a.linkWriteExecutionId&&
        positions.get(a.linkWriteExecutionId)<=position&&position<positions.get(a.executionId));
      const observedSlotCount=nodes.filter(n=>n.value!==null).length,unknownSlotCount=metadata.capacity-observedSlotCount,
        row={afterExecutionId:e.eventId,alive,status:!alive?'ended':pending.length?'intermediate':unknownSlotCount?'partial':'observed',
        nodes,observedSlotCount,unknownSlotCount,trackedSlotCount:nodes.length,untrackedSlotCount:metadata.capacity-nodes.length,
        pendingAggregationExecutionIds:pending.map(a=>a.executionId),
        discoveryStatus:position<positions.get(c.aggregations[0].executionId)?'before-evidence':'observed-candidate'};
      if(!states.length||JSON.stringify({...states.at(-1),afterExecutionId:null})!==JSON.stringify({...row,afterExecutionId:null}))states.push(row);
    }
    for(const e of events){
      let changed=false;if(graphUpdates.has(e.eventId)){graphState=graphUpdates.get(e.eventId);changed=true;}
      if(object?.createdBy===e.eventId){alive=true;ended=false;changed=true;}
      if(object?.endedBy===e.eventId||object?.storage==='automatic'&&object.frameId&&e.kind==='SPACE'&&e.action==='frame.end'&&
        object.frameId===(e.frameId??e.activationId)){alive=false;ended=true;changed=true;}
      const objectId=e.target?.objectId??e.objectId,start=e.target?.offset??0;
      if(objectId===metadata.objectId){
        if(e.kind==='SPACE'&&e.action==='object.begin'){alive=true;ended=false;changed=true;}
        if(e.kind==='SPACE'&&e.action==='object.end'){alive=false;ended=true;changed=true;}
        const exact=slot(metadata,e.target),size=e.memoryState?.byteLength??e.target?.size??0;
        if(e.memoryState&&['SPACE','WRITE'].includes(e.kind)||['READ','WRITE'].includes(e.kind)&&size>0){
          // A bulk snapshot is a range observation, not a request to materialize
          // every capacity slot. Only execution-indexed slots get scalar views.
          for(const index of trackedIndices){
            const offset=metadata.range.offset+index*metadata.elementBytes;
            if(offset>=start+size||offset+metadata.elementBytes<=start)continue;
            const s=slots.get(index)??{bytes:null,lastWriteExecutionId:null},
              snapshot=e.memoryState??(exact===index&&(e.value?.bits!==undefined||e.value?.decimal!==undefined)?null:
                scalarSnapshot(e)??{byteLength:size,ranges:[{offset:0,length:size,initialization:'unknown'}]}),
              updated=observeScalarBytes(s.bytes,{size:metadata.elementBytes,signed:metadata.elementType.signedness==='signed',
                snapshot,start,offset,value:!snapshot&&exact===index?e.value?.bits??e.value?.decimal:undefined});
            if(updated){s.bytes=updated;if(['SPACE','WRITE'].includes(e.kind))s.lastWriteExecutionId=e.eventId;slots.set(index,s);changed=true;}
          }
          if(['READ','WRITE'].includes(e.kind)&&!ended)alive=true;
        }
      }
      if(c.aggregations.some(a=>a.executionId===e.eventId||a.linkWriteExecutionId===e.eventId))changed=true;
      if(changed)record(e);
    }
    result.push({id:`parallel-array:${domain.id}:${metadata.id}`,kind:'parallel-array-metadata-candidate',origin:'inferred',
      classification:'candidate',intent:'unconfirmed',nodes:metadata.nodes??[],edges:[],
      views:['per-index-metadata'],arrayId:metadata.id,objectId:metadata.objectId,range:metadata.range,storageIdentity:metadata.storageIdentity,
      elementBytes:metadata.elementBytes,capacity:metadata.capacity,indexDomain:{arrayId:domain.id,objectId:domain.objectId,range:domain.range,
        storageIdentity:domain.storageIdentity,elementBytes:domain.elementBytes,capacity:domain.capacity},
      ...(graph?{indexGraphId:graph.id}:{}),associations,comparisons:c.comparisons,aggregations:c.aggregations,states,
      evidenceCounts:{associatedAccesses:associated.size,sourceReads:unique(associations.map(a=>a.sourceReadExecutionId)).length,
        comparisons:c.comparisons.length,aggregations:c.aggregations.length},
      discoveredAtExecutionId:c.aggregations[0].executionId,role:'aggregate-candidate',cardinality:'unconfirmed',
      evidence:['observed value-preserving index provenance','observed comparison and sum update at associated indices'],
      limitations:['aggregate semantics and author intent are unconfirmed','nonrepresentative values retain their actual stored bytes',
        'member counts include only observed graph representatives; a matching value does not prove cardinality semantics']});
  }
  return result;
}

export function validateParallelArrayStructures(trace){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),structures=new Map(trace.structures.map(s=>[s.id,s])),
    fail=()=>{throw new Error('자료구조 후보: 병렬 배열 메타데이터의 관측 저장 또는 실행 근거가 올바르지 않습니다.');};
  const evidence=id=>{if(!events.has(id))fail();};
  for(const s of trace.structures.filter(s=>s.kind==='parallel-array-metadata-candidate')){
    const a=structures.get(s.arrayId),d=structures.get(s.indexDomain?.arrayId);
    if(a?.kind!=='array'||d?.kind!=='array'||a.objectId!==s.objectId||a.elementBytes!==s.elementBytes||a.capacity!==s.capacity||
      JSON.stringify(a.range)!==JSON.stringify(s.range)||s.cardinality!=='unconfirmed'||s.role!=='aggregate-candidate'||
      s.classification!=='candidate'||s.intent!=='unconfirmed')fail();
    const graph=structures.get(s.indexGraphId);
    if(s.indexGraphId&&(graph?.kind!=='value-index-graph-candidate'||graph.arrayId!==d.id&&
      (!d.storageIdentity||graph.storageIdentity!==d.storageIdentity)))fail();
    evidence(s.discoveredAtExecutionId);
    for(const link of s.associations){for(const id of [link.accessExecutionId,link.indexExecutionId,link.sourceReadExecutionId])evidence(id);
      const access=events.get(link.accessExecutionId),read=events.get(link.sourceReadExecutionId);
      if(read.kind!=='READ'||slot(d,read.target)!==link.sourceIndex||slot(a,access.target)!==link.index||number(read.value)!==link.index)fail();}
    for(const c of s.comparisons){evidence(c.executionId);for(const r of c.operands)evidence(r.executionId);}
    for(const g of s.aggregations){for(const id of [g.executionId,g.calculationExecutionId,g.comparisonExecutionId,...g.linkWriteExecutionId?[g.linkWriteExecutionId]:[]])evidence(id);
      if(events.get(g.executionId).kind!=='WRITE'||slot(a,events.get(g.executionId).target)!==g.index)fail();}
    for(const state of s.states){evidence(state.afterExecutionId);for(const id of state.pendingAggregationExecutionIds)evidence(id);
      if(state.trackedSlotCount!==state.nodes.length||state.untrackedSlotCount!==a.capacity-state.nodes.length||
        state.observedSlotCount!==state.nodes.filter(n=>n.value!==null).length||state.unknownSlotCount!==a.capacity-state.observedSlotCount)fail();
      for(const n of state.nodes){if(slot(a,n)!==n.index||n.knownMemberCount!==undefined&&(!Number.isSafeInteger(n.knownMemberCount)||n.knownMemberCount<0))fail();
        if(n.lastWriteExecutionId)evidence(n.lastWriteExecutionId);}}
  }
}
