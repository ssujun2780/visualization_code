import {appendCandidateState} from './state-history.mjs';
// Range meaning is derived from actual leaf copies and aggregation dependencies.
// Index arithmetic only supplies a representation candidate, never the values.
import {storageEvidence,key,num,unique,walk,querySemanticStructure} from './storage-semantics.mjs';
import {selectionEvidence} from './selection-evidence.mjs';
const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
export const queryRangeAggregate=querySemanticStructure;
function bitWalks(c){
 const paths=c.structures.find(s=>s.kind==='storage-dependencies')?.indexWalks??[],proofs=[];
 const ref=n=>{n=unwrap(n);return n?.kind==='DeclRefExpr'?n.declarationId:null;};
 const plusOne=n=>{n=unwrap(n);return n?.operator==='+'&&num({decimal:unwrap(n.children[1])?.literal})===1?ref(n.children[0]):null;};
 for(const path of paths)for(const t of path.transitions)for(const id of t.calculationExecutionIds){
  const e=c.byId.get(id),expr=c.defs.get(e?.instructionId)?.expression;
  for(const node of walk(expr)){if(!['&','|'].includes(node.operator))continue;
   const a=unwrap(node.children?.[0]),b=unwrap(node.children?.[1]),base=ref(a),neg=unwrap(b?.children?.[0]);
   const mode=node.operator==='&'&&base&&b?.operator==='-'&&ref(neg)===base?'one-based':
    base&&plusOne(b)===base?'zero-based':null;
   const step=e?.steps?.find(s=>s.nodeId===node.nodeId);if(!mode||!step)continue;
   const rs=step.inputs.flatMap(i=>c.flow.dependencyReads(i,e,step));
   if(!rs.some(r=>r.target?.objectId===path.cursorObjectId&&num(r.value)===t.fromIndex))continue;
   const n=t.fromIndex;if(n<0||n>0x7fffffff||mode==='one-based'&&n===0)continue;
   const low=Number(BigInt(n)&-BigInt(n)),up=mode==='one-based'?n+low:Number(BigInt(n)|BigInt(n+1)),
    down=mode==='one-based'?n-low:Number(BigInt(n)&BigInt(n+1))-1;
   const direction=t.toIndex===up?'update':t.toIndex===down?'query':null;
   if(!direction||num(e.value)!==t.toIndex)continue;
   const fromStep=path.steps.find(s=>s.cursorExecutionId===t.fromCursorExecutionId),toStep=path.steps.find(s=>s.cursorExecutionId===t.toCursorExecutionId),
    accesses=unique([...(fromStep?.accessExecutionIds??[]),toStep?.accessExecutionIds[0]].filter(Boolean)),
    after=[...accesses,t.toCursorExecutionId].sort((a,b)=>c.pos.get(a)-c.pos.get(b)).at(-1);
   proofs.push({arrayId:path.arrayId,mode,direction,fromIndex:n,toIndex:t.toIndex,calculationExecutionId:id,sourceNodeId:node.nodeId,
    fromCursorExecutionId:t.fromCursorExecutionId,toCursorExecutionId:t.toCursorExecutionId,
    accessExecutionIds:accesses,afterExecutionId:after});
  }
 }
 return proofs;
}
export function rangeAggregateStructures(plan,trace,{maxStates=2048}={}){
 const c=storageEvidence(plan,trace),{events,pos,byId,arrays,cell,reads,chain}=c,walks=bitWalks(c),groups=new Map(),
  trees=c.structures.filter(s=>s.kind==='index-tree');
 const group=a=>{if(!groups.has(a.id))groups.set(a.id,{array:a,nodes:new Map(),versions:new Map(),states:[],truncated:false});return groups.get(a.id);};
 const coverage=leaves=>{const ids=unique(leaves.map(x=>x.arrayId));if(ids.length!==1||!leaves.length)return null;
  const indices=unique(leaves.map(x=>x.index)).sort((a,b)=>a-b);return indices.at(-1)-indices[0]+1===indices.length?{arrayId:ids[0],start:indices[0],end:indices.at(-1)+1}:null;};
 for(const e of events){const at=pos.get(e.eventId),target=cell(e.target);
  if(e.kind==='WRITE'&&e.action==='write'&&target&&target.fieldOffset===0&&e.target.size===arrays.find(a=>a.id===target.arrayId).elementBytes){
   const a=arrays.find(a=>a.id===target.arrayId),g=group(a),old=g.nodes.get(target.index),selections=selectionEvidence(c,e.dataInputs),
    inputReads=[...reads(e.dataInputs),...selections.flatMap(p=>p.sourceReadExecutionIds.map(id=>byId.get(id)))].filter(r=>cell(r.target)),
    sources=unique(inputReads.map(r=>r.eventId)).map(id=>({read:byId.get(id),cell:cell(byId.get(id).target)})),
    calculations=unique((e.dataInputs??[]).flatMap(chain).filter(x=>x.kind==='CALC').map(x=>x.eventId)),
    ops=unique(calculations.flatMap(id=>byId.get(id).steps?.map(s=>s.operator)??[]).filter(Boolean)),
    aggregation=selections.length>0||ops.length>0&&ops.every(op=>['+','+=','*','*=','&','&=','|','|=','^','^=','cast'].includes(op));
   const preserveCoordinates=old?.complete&&old.coverage&&sources.some(s=>s.cell.arrayId===a.id&&s.cell.index===target.index)&&
    sources.every(s=>s.cell.arrayId===a.id?s.cell.index===target.index:s.cell.arrayId!==old.coverage.arrayId);
   const leaves=[],children=[];let complete=true;
   for(const s of sources){
    if(s.cell.arrayId!==a.id){if(!preserveCoordinates)leaves.push({...s.cell,readExecutionId:s.read.eventId});}
    else {const n=g.versions.get(s.cell.index)?.findLast(n=>pos.get(n.writeExecutionId)<=pos.get(s.read.eventId));if(n&&n.complete){leaves.push(...n.leaves);if(s.cell.index!==target.index)children.push({index:s.cell.index,readExecutionId:s.read.eventId,writeExecutionId:n.writeExecutionId});}
     else if(s.cell.index!==target.index||num(s.read.value)!==0)complete=false;}
   }
   // A direct overwrite of an established leaf changes its value, not its
   // logical position. Overwriting an aggregate does not preserve its proof.
   const establishedLeaf=old&&!old.children.length&&old.leaves.length===1;
   if(!sources.length&&establishedLeaf)leaves.push(...old.leaves);
   // A scalar leaf has its own observed storage coordinate even when it was
   // initialized from a literal. This is NOT an invented external input array.
   if(!sources.length&&!old&&!calculations.length)leaves.push({...target,writeExecutionId:e.eventId,coordinateKind:'storage-leaf'});
   const priorSelf=preserveCoordinates;
   const valid=complete&&(aggregation||priorSelf||!calculations.length&&sources.length<=1||establishedLeaf&&!sources.length),
    distinct=[...new Map(leaves.map(l=>[key(l.range),l])).values()],
    selfTransform=valid&&sources.some(s=>s.cell.arrayId===a.id&&s.cell.index===target.index)&&!children.length&&(old?.topologyChildren??old?.children??[]).length>1,
    topologyChildren=children.length?children:selfTransform?(old.topologyChildren??old.children):[];
   if(g.nodes.size>=2048&&!g.nodes.has(target.index)){g.truncated=true;continue;}
   g.nodes.set(target.index,{id:`range:${a.id}:${target.index}`,index:target.index,range:target.range,value:e.value,
    writeExecutionId:e.eventId,readExecutionIds:sources.map(s=>s.read.eventId),calculationExecutionIds:calculations,operators:ops,selectionEvidence:selections,
    leaves:valid?distinct:[],children:valid?children:[],coverage:valid?coverage(distinct):null,complete:valid,
    topologyChildren:valid?topologyChildren:[],topologySourceWriteExecutionId:selfTransform?(old.topologySourceWriteExecutionId??old.writeExecutionId):e.eventId,valueTransform:selfTransform,
    leafMeaning:'observed input or storage-leaf coordinates; current values come from writeExecutionId'});
   if(!g.versions.has(target.index))g.versions.set(target.index,[]);g.versions.get(target.index).push(g.nodes.get(target.index));
  }
  for(const g of groups.values()){
   const written=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null),
    overlaps=r=>written?.objectId===r.objectId&&written.offset<r.offset+r.size&&r.offset<written.offset+written.size,
    own=['WRITE','SPACE'].includes(e.kind)&&overlaps(g.array.range),ended=e.action==='object.end'&&e.objectId===g.array.objectId||e.endedObjects?.includes(g.array.objectId),
    relatedWalk=walks.some(p=>p.arrayId===g.array.id&&p.afterExecutionId===e.eventId);
   if(!own&&!ended&&!relatedWalk)continue;
   if(own)for(const [i,n]of g.nodes)if(overlaps(n.range)&&n.writeExecutionId!==e.eventId){
    const invalid={...n,writeExecutionId:e.eventId,value:null,readExecutionIds:[],calculationExecutionIds:[],operators:[],leaves:[],children:[],topologyChildren:[],valueTransform:false,coverage:null,complete:false};
    g.nodes.set(i,invalid);g.versions.get(i).push(invalid);
   }
   const stale=(n,seen=new Set())=>{if(seen.has(n.index))return true;return n.children.some(ch=>{const current=g.nodes.get(ch.index);return !current||!current.complete||current.writeExecutionId!==ch.writeExecutionId||stale(current,new Set(seen).add(n.index));});};
   const evidence=walks.filter(p=>p.arrayId===g.array.id&&pos.get(p.afterExecutionId)<=at),observedTrees=trees.filter(t=>t.arrayId===g.array.id&&t.formulaEvidence.some(p=>pos.get(p.executionId)<=at&&p.status==='supported')),
    nodes=[...g.nodes.values()].map(n=>({...n,stale:stale(n)})),
    aggregate=nodes.filter(n=>n.complete&&n.coverage&&n.coverage.end-n.coverage.start>1),
    hierarchical=aggregate.some(n=>n.topologyChildren.length>1),alive=c.alive(g.array.objectId,at),
    mode=evidence.find(p=>p.direction==='update')?.mode,
    fenwick=mode&&aggregate.some(n=>{const end=mode==='one-based'?n.index:n.index+1,low=Number(BigInt(end)&-BigInt(end));return n.coverage.start===end-low&&n.coverage.end===end;});
   // Contiguous, disjoint child coverage is the semantic evidence. Constant
   // folding may remove the runtime operands of an otherwise valid index form.
   const segment=hierarchical&&aggregate.every(n=>{const parts=n.topologyChildren.map(ch=>g.versions.get(ch.index)?.find(v=>v.writeExecutionId===ch.writeExecutionId)?.coverage)
    .filter(Boolean).sort((a,b)=>a.start-b.start);return parts.length===n.topologyChildren.length&&parts.length>1&&
    parts.every((p,i)=>p.arrayId===n.coverage.arrayId&&p.start===(i?parts[i-1].end:n.coverage.start))&&parts.at(-1).end===n.coverage.end;});
   const view=fenwick?'fenwick-tree':segment?'segment-tree':aggregate.length?'range-aggregate':null;
   if(!view&&!g.states.length)continue;
   const roots=nodes.filter(n=>!nodes.some(p=>p.topologyChildren.some(ch=>ch.index===n.index))).map(n=>n.index);

   appendCandidateState(g,{afterExecutionId:e.eventId,alive,view,nodes,roots,
    status:!alive?'ended':g.truncated||nodes.some(n=>!n.complete)?'incomplete':nodes.some(n=>n.valueTransform)?'transformed-aggregate':nodes.some(n=>n.stale)?'stale':view?'supported-observed':'incomplete',
    evidenceExecutionIds:unique([...nodes.map(n=>n.writeExecutionId),...evidence.map(p=>p.afterExecutionId),...observedTrees.flatMap(t=>t.formulaEvidence.filter(p=>pos.get(p.executionId)<=at).map(p=>p.executionId))])},maxStates);
  }
 }
 return [...groups.values()].filter(g=>g.states.length).map(g=>({id:`range-aggregate:${g.array.id}`,kind:'range-aggregate-candidate',arrayId:g.array.id,objectId:g.array.objectId,range:g.array.range,
  nodes:[],edges:[],intent:'unconfirmed',states:g.states,walkEvidence:walks.filter(p=>p.arrayId===g.array.id),discoveredAtExecutionId:g.coverage.firstStateExecutionId,
  coverage:{...g.coverage,maxNodes:2048,maxStates,truncated:g.truncated},
  limitations:['only observed input coverage; unused slots are not invented','arithmetic and observed min/max selectors; arbitrary comparator semantics remain unknown','candidate representation is not an algorithm correctness guarantee']}));
}
