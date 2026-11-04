// Overlay work relations on existing storage. No source scans, expression
// execution, synthetic memory accesses, or algorithm-name classification.
import {createValueFlow} from './observed-value-flow.mjs';
import {arrayGeometry,arrayLocation} from './array-geometry.mjs';
import {arrayValueDependencies} from './array-value-dependencies.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const unique=a=>[...new Set(a)];
const refs=n=>unique(walk(n).map(n=>n.declarationId).filter(Boolean));
const comparison=new Set(['<','<=','>','>=','==','!=']);
const number=v=>{const x=Number(v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed));return Number.isSafeInteger(x)?x:null;};
const span=t=>t&&({objectId:t.objectId,offset:t.offset,size:t.size});
const affineKey=x=>x&&`${x.declarationId??''}:${x.offset}`;
function affine(n){
  n=unwrap(n);if(!n)return null;
  if(n.kind==='DeclRefExpr'&&n.declarationId)return {declarationId:n.declarationId,offset:0};
  if(n.kind==='IntegerLiteral'){const v=Number(n.literal);return Number.isSafeInteger(v)?{declarationId:null,offset:v}:null;}
  if(n.kind==='BinaryOperator'&&['+','-'].includes(n.operator)){
    const a=affine(n.children[0]),b=affine(n.children[1]);if(!a||!b)return null;
    if(!b.declarationId)return {...a,offset:a.offset+(n.operator==='+'?b.offset:-b.offset)};
    if(!a.declarationId&&n.operator==='+')return {...b,offset:a.offset+b.offset};
  }
  return null;
}

function accessAxes(node){
  const axes=[];let base=unwrap(node);
  while(base?.kind==='ArraySubscriptExpr'){
    axes.unshift({nodeId:base.nodeId,indexNodeId:base.children[1]?.nodeId,indexDeclarationIds:refs(base.children[1]),
      index:affine(base.children[1]),byteStride:base.cType?.sizeBits>0?base.cType.sizeBits/8:null});
    base=unwrap(base.children[0]);
  }
  return {baseDeclarationIds:refs(base),axes:axes.map((a,axis)=>({...a,axis}))};
}
// Only lvalue-base accesses describe this memory operation. An assignment's
// RHS and subscripts inside an index expression are separate READ sites.
function targetAccesses(definition,direction='target'){
  if(!['READ','WRITE'].includes(definition.kind))return [];
  let n=unwrap(definition.expression);
  if(direction==='copy-source'){
    if(n?.kind==='BinaryOperator'&&n.operator==='=')n=unwrap(n.children[1]);
    else if(n?.kind==='VarDecl')n=unwrap(n.children.at(-1));else return [];
  }else if(n?.kind==='CompoundAssignOperator'||n?.kind==='BinaryOperator'&&n.operator==='='||
    n?.kind==='UnaryOperator'&&['++','--'].includes(n.operator))n=unwrap(n.children[0]);
  const result=[];
  while(n){
    if(n.kind==='ArraySubscriptExpr')result.push(n.nodeId);
    if(!['ArraySubscriptExpr','MemberExpr'].includes(n.kind))break;
    n=unwrap(n.children[0]);
  }
  return result;
}

export function bindArrayWork(plan){
  const nodes=new Map(),declarationNodes=new Map(),initializers=new Map(),changed=new Set(),accesses=new Map(),ranges=[];
  for(const d of plan.instructions)if(d.action==='object.begin'&&d.declarationId&&d.sourceNodeId)declarationNodes.set(d.sourceNodeId,d.declarationId);
  for(const d of plan.instructions)for(const root of [d.expression,...d.arguments??[]])for(const n of walk(root)){
    nodes.set(n.nodeId,{node:n,functionId:d.functionId});
    if(n.kind==='ArraySubscriptExpr'){
      const shape=accessAxes(n),axis=shape.axes.at(-1);
      let a=accesses.get(n.nodeId);if(!a)accesses.set(n.nodeId,a={nodeId:n.nodeId,functionId:d.functionId,
        ...shape,axis:axis.axis,indexStrideBytes:axis.byteStride,indexDeclarationIds:axis.indexDeclarationIds,index:axis.index,instructionIds:[],copySourceInstructionIds:[]});
    }
    const decl=n.kind==='VarDecl'?declarationNodes.get(n.nodeId):n.operator==='='?unwrap(n.children?.[0])?.declarationId:null;
    if(decl){if(!initializers.has(decl))initializers.set(decl,new Map());initializers.get(decl).set(n.nodeId,n.kind==='VarDecl'?n.children.at(-1):n.children[1]);}
    if(['++','--','+=','-=','*=','/='].includes(n.operator)){const id=unwrap(n.children?.[0])?.declarationId;if(id)changed.add(id);}
  }
  for(const d of plan.instructions)for(const id of targetAccesses(d)){
    const access=accesses.get(id);if(access&&!access.instructionIds.includes(d.id))access.instructionIds.push(d.id);
  }
  for(const d of plan.instructions)for(const id of targetAccesses(d,'copy-source')){
    const access=accesses.get(id);if(access&&!access.copySourceInstructionIds.includes(d.id))access.copySourceInstructionIds.push(d.id);
  }
  const initial=id=>{const values=[...(initializers.get(id)?.values()??[])].map(affine).filter(Boolean);
    return values.length&&unique(values.map(affineKey)).length===1?values[0]:null;};
  const declarations=new Map((plan.declarations??[]).map(d=>[d.id,d]));
  const seenRanges=new Map();
  function add(r){
    if(!r.from||!r.to||!r.baseDeclarationId)return;
    const key=[r.functionId,r.baseDeclarationId,r.axis,r.indexStrideBytes,affineKey(r.from),affineKey(r.to),r.cursorDeclarationId??''].join(':');
    const previous=seenRanges.get(key);
    if(previous){previous.accessNodeIds=unique([...previous.accessNodeIds,...r.accessNodeIds]);previous.boundNodeIds=unique([...previous.boundNodeIds,...r.boundNodeIds]);return;}
    const candidate={...r,id:`work-range${ranges.length+1}`};seenRanges.set(key,candidate);ranges.push(candidate);
  }
  for(const a of accesses.values())for(const baseDeclarationId of a.baseDeclarationIds){
    const index=a.index;if(!index)continue;
    if(index.declarationId&&!changed.has(index.declarationId)&&!initializers.has(index.declarationId)&&declarations.get(index.declarationId)?.kind==='ParmVarDecl')
      add({functionId:a.functionId,baseDeclarationId,axis:a.axis,indexStrideBytes:a.indexStrideBytes,from:index,to:{...index,offset:index.offset+1},
        accessNodeIds:[a.nodeId],boundNodeIds:[],cursorDeclarationId:null,relation:'indexed-position',viaFunctionIds:[a.functionId]});
    if(!index.declarationId)continue;
    const start=initial(index.declarationId);if(!start)continue;
    for(const {node:n,functionId}of nodes.values()){
      if(functionId!==a.functionId||!['<','<=','>','>='].includes(n.operator))continue;
      let left=affine(n.children?.[0]),right=affine(n.children?.[1]),operator=n.operator;
      if(right?.declarationId===index.declarationId){[left,right]=[right,left];operator=({'<':'>','<=':'>=','>':'<','>=':'<='})[operator];}
      if(left?.declarationId!==index.declarationId||!right||!['<','<='].includes(operator))continue;
      add({functionId:a.functionId,baseDeclarationId,axis:a.axis,indexStrideBytes:a.indexStrideBytes,from:{...start,offset:start.offset+index.offset},
        to:{...right,offset:right.offset-left.offset+index.offset+(operator==='<='?1:0)},
        accessNodeIds:[a.nodeId],boundNodeIds:[n.nodeId],cursorDeclarationId:index.declarationId,
        relation:'cursor-bound',viaFunctionIds:[a.functionId]});
    }
  }
  // Adjacent compiler intervals can describe one shared span. This also keeps
  // a last-element operand distinct from a loop which stops before it.
  function joinRanges(){
    const current=ranges.slice();for(const a of current)for(const b of current)
      if(a.functionId===b.functionId&&a.baseDeclarationId===b.baseDeclarationId&&a.axis===b.axis&&a.indexStrideBytes===b.indexStrideBytes&&affineKey(a.to)===affineKey(b.from)&&affineKey(a.from)!==affineKey(b.to))
        add({...a,from:a.from,to:b.to,cursorDeclarationId:null,relation:'joined-bounds',accessNodeIds:unique([...a.accessNodeIds,...b.accessNodeIds]),
          boundNodeIds:unique([...a.boundNodeIds,...b.boundNodeIds])});
  }
  joinRanges();
  const functions=new Map((plan.functions??[]).map(f=>[f.symbol,f]));
  // A caller inherits only the callee's parameter relations, never a guessed
  // role based on argument order. Cyclic call paths are not expanded.
  for(let pass=0;pass<(plan.functions?.length??0);pass++){
    const before=ranges.length;
    for(const d of plan.instructions.filter(d=>d.action==='call')){
      const f=functions.get(d.callee);if(!f)continue;
      const args=new Map(f.parameters.map((id,i)=>[id,d.arguments?.[i]]));
      const substitute=x=>{if(!x.declarationId)return x;const y=affine(args.get(x.declarationId));return y?{...y,offset:y.offset+x.offset}:null;};
      for(const r of ranges.slice().filter(r=>r.functionId===f.id&&!r.viaFunctionIds.includes(d.functionId))){
        const base=unwrap(args.get(r.baseDeclarationId));if(base?.kind!=='DeclRefExpr'||!base.declarationId)continue;
        add({...r,functionId:d.functionId,baseDeclarationId:base.declarationId,from:substitute(r.from),to:substitute(r.to),
          cursorDeclarationId:null,relation:'forwarded-bounds',callInstructionId:d.id,viaFunctionIds:[...r.viaFunctionIds,d.functionId]});
      }
    }
    joinRanges();if(ranges.length===before)break;
  }
  plan.structureBindings??={};plan.structureBindings.arrayWork={accesses:[...accesses.values()],ranges,
    comparisonNodeIds:[...nodes.values()].filter(x=>comparison.has(x.node.operator)).map(x=>x.node.nodeId),
    evidence:'compiler declaration/index/bound identities and direct-call parameter mapping'};
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{arrayWorkAccessSites:accesses.size,arrayWorkRangeCandidates:ranges.length,
    arrayWorkPolicy:'observed storage overlays; bounds are candidates, not algorithm identities or proofs of executed coverage'});
}

export function arrayWorkStructures(plan,{events,objects,views,frames=[],structures=[],resultDeliveries=[],valueFlow}){
  const binding=plan.structureBindings?.arrayWork;if(!binding)return [];
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),byObject=new Map(objects.map(o=>[o.id,o])),
    arrays=structures.filter(s=>s.kind==='array'),byDeclaration=new Map(),objectDeclaration=new Map(),values=new Map(),accesses=[],transfers=[],temporaries=[],comparisons=[],readOrigins=new Map(),copies=new Map();
  const declarationKey=(activation,id)=>`${activation}:${id}`;
  for(const o of objects){const d=defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId;
    if(d){objectDeclaration.set(o.id,d);const k=declarationKey(o.frameId,d);if(!byDeclaration.has(k))byDeclaration.set(k,[]);byDeclaration.get(k).push(o);}}
  // Return ports and other value destinations are not byte-addressable memory.
  const memoryRange=t=>{const o=byObject.get(t?.objectId);return !!o&&Number.isSafeInteger(t.offset)&&Number.isSafeInteger(t.size)&&t.offset>=0&&t.size>=0&&t.offset+t.size<=o.size;};
  const arrayAt=t=>memoryRange(t)&&arrays.filter(a=>a.objectId===t.objectId&&t.offset>=a.range.offset&&t.offset+t.size<=a.range.offset+a.range.size)
    .sort((a,b)=>a.range.size-b.range.size)[0];
  const geometry=new Map(arrays.map(a=>[a.id,arrayGeometry(a,byObject.get(a.objectId))]));
  const location=t=>{const a=arrayAt(t);return a?arrayLocation(t,a,byObject.get(a.objectId)):span(t);};
  const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
  const contains=(a,b)=>a?.objectId===b?.objectId&&a.offset<=b.offset&&a.offset+a.size>=b.offset+b.size;
  const staticAccesses=new Map(plan.instructions.map(d=>[d.id,binding.accesses.filter(a=>a.instructionIds.includes(d.id))]));
  const copySourceAccesses=new Map(plan.instructions.map(d=>[d.id,binding.accesses.filter(a=>a.copySourceInstructionIds?.includes(d.id))]));
  const cursorIds=new Set(binding.accesses.flatMap(a=>a.indexDeclarationIds));
  function addressReads(id,seen=new Set()){
    if(seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.kind==='READ')return cursorIds.has(objectDeclaration.get(e.target?.objectId))?[e]:[];
    return unique([...(e.dataInputs??[]),...(e.addressInputs??[])]).flatMap(x=>addressReads(x,seen));
  }
  function recordAccess(e,target,direction){
    const at=location(target);if(!at?.arrayId)return;
    const sites=(direction==='copy-source'?copySourceAccesses:staticAccesses).get(e.instructionId)??[],
      cursorReads=unique((e.addressInputs??[]).flatMap(id=>addressReads(id)).map(e=>e.eventId));
    const deepest=sites.slice().sort((a,b)=>b.axes.length-a.axes.length)[0];
    const a={executionId:e.eventId,activationId:e.activationId,kind:e.kind,direction,action:e.action,target:at,
      sourceNodeIds:sites.map(s=>s.nodeId),accessSiteNodeId:deepest?.nodeId??null,axes:deepest?.axes??[],
      cursors:cursorReads.map(id=>{const r=byEvent.get(id);return {declarationId:objectDeclaration.get(r.target.objectId),
        objectId:r.target.objectId,executionId:id,value:number(r.value)};}),status:sites.length||cursorReads.length?'supported':'partial'};
    accesses.push(a);return a;
  }
  const {sourceRead,sourceReadOperand}=valueFlow??createValueFlow(plan,{events,resultDeliveries});
  function copyOrigin(target){return [...copies.values()].filter(c=>contains(c.target,target)).at(-1)??null;}
  for(const e of events){
    if(e.target&&['READ','WRITE'].includes(e.kind)){
      const d=objectDeclaration.get(e.target.objectId),v=number(e.value);
      if(d&&v!==null){const k=declarationKey(byObject.get(e.target.objectId)?.frameId,d);if(!values.has(k))values.set(k,[]);values.get(k).push({value:v,executionId:e.eventId,objectId:e.target.objectId});}
    }
    if(e.kind==='READ'&&e.target){recordAccess(e,e.target,'read');readOrigins.set(e.eventId,copyOrigin(e.target));}
    if(e.kind==='WRITE'&&memoryRange(e.target)){
      recordAccess(e,e.target,'write');
      const read=e.action==='copy'?null:sourceRead(e.eventId),
        source=e.action==='copy'&&e.sourceObjectId?{objectId:e.sourceObjectId,offset:e.sourceOffset??0,size:e.sourceSize??e.target.size}:read?.target;
      const previous=source?(read?readOrigins.get(read.eventId):copyOrigin(source)):null;
      const from=location(source),to=location(e.target);
      for(const [id,c]of copies)if(overlap(c.target,e.target)){c.invalidatedBy=e.eventId;copies.delete(id);}
      if(memoryRange(source)&&(from?.arrayId||to?.arrayId||previous)){
        if(e.action==='copy')recordAccess(e,source,'copy-source');
        const t={id:`transfer:${e.eventId}`,executionId:e.eventId,activationId:e.activationId,source:from,target:to,
          readExecutionId:read?.eventId??null,sourceTemporaryId:previous?.id??null,
          mode:e.action==='copy'?'range-copy':'value-copy',size:e.target.size,
          wholeElement:!!(from?.arrayId&&from.elementOffset===0&&source.size===from.elementBytes&&e.target.size===from.elementBytes),
          status:source.size===e.target.size?'supported':'partial'};
        transfers.push(t);
        const o=byObject.get(e.target.objectId);
        if(!to.arrayId&&o?.cType&&o.cType.kind!=='pointer'&&o.cType.kind!=='array'&&(from.arrayId||previous)){
          const temp={id:`temporary:${e.eventId}`,objectId:o.id,declarationId:objectDeclaration.get(o.id)??null,
            activationId:e.activationId,createdBy:e.eventId,endedBy:o.endedBy??null,target:to,source:from,
            origin:previous?.origin??from,sourceTemporaryId:previous?.id??null,transferId:t.id,
            semantics:'copied-value',isReference:false,comparisonExecutionIds:[],useExecutionIds:[],status:t.status};
          temporaries.push(temp);copies.set(temp.id,temp);
        }
        if(previous)previous.useExecutionIds.push(e.eventId);
      }
    }
    if(e.kind==='CALC')for(const step of e.steps??[]){
      if(!comparison.has(step.operator))continue;
      const operands=(step.inputs??[]).map((input,index)=>{
        const r=sourceReadOperand(input,e,step);if(!r)return {position:index,executionId:input.executionId??null,role:'unresolved',status:'partial'};
        const at=location(r.target),temp=readOrigins.get(r.eventId),role=temp?'copied-comparison-operand':at.arrayId?'array-comparison-operand':'scalar-comparison-operand';
        if(temp){temp.comparisonExecutionIds.push(e.eventId);temp.useExecutionIds.push(r.eventId);}
        return {position:index,executionId:r.eventId,role,storage:at,temporaryId:temp?.id??null,
          copiedFrom:temp?.origin??null,status:'supported'};
      });
      if(operands.some(o=>o.storage?.arrayId||o.temporaryId))comparisons.push({executionId:e.eventId,activationId:e.activationId,
        sourceNodeId:step.nodeId,operator:step.operator,operands,status:operands.length===2&&operands.every(o=>o.status==='supported')?'supported':'partial'});
    }
  }
  if(!accesses.length&&!transfers.length)return [];
  const activations=[],frameById=new Map(frames.map(f=>[f.id,f]));
  // A frame can exist without a frames export in a partial recording.
  for(const e of events)if(e.action==='frame.begin'&&!frameById.has(e.activationId))frameById.set(e.activationId,{id:e.activationId,functionId:defs.get(e.instructionId)?.functionId});
  function bound(frame,x){
    if(!x.declarationId)return {value:x.offset,executionIds:[],status:'literal'};
    const observations=values.get(declarationKey(frame,x.declarationId))??[],distinct=unique(observations.map(o=>o.value));
    return {value:distinct.length===1?distinct[0]+x.offset:null,executionIds:observations.slice(0,1).map(o=>o.executionId),
      status:distinct.length===1?'observed':distinct.length?'changing-bound':'unavailable'};
  }
  for(const f of frameById.values()){
    const ownAccesses=accesses.filter(a=>a.activationId===f.id),ownTransfers=transfers.filter(t=>t.activationId===f.id),ranges=[];
    for(const r of binding.ranges.filter(r=>r.functionId===f.functionId)){
      const bases=byDeclaration.get(declarationKey(f.id,r.baseDeclarationId))??[];
      for(const o of bases){
        let baseObjectId=o.id,baseOffsetBytes=0,evidence=[];
        if(!arrays.some(a=>a.objectId===o.id)){
          const pointers=events.filter(e=>e.target?.objectId===o.id&&e.value?.reference?.targetObjectId),targets=unique(pointers.map(e=>`${e.value.reference.targetObjectId}:${e.value.reference.targetOffset??0}`));
          if(targets.length!==1)continue;
          const p=pointers[0],ref=p.value.reference;baseObjectId=ref.targetObjectId;baseOffsetBytes=ref.targetOffset??0;evidence=[p.eventId];
        }
        // A storage object can have overlapping typed views. Use the views
        // of the actual bound access sites, not the first type ever observed.
        const siteAccesses=ownAccesses.filter(x=>x.target.objectId===baseObjectId&&x.sourceNodeIds.some(id=>r.accessNodeIds.includes(id))),
          usedViews=unique(siteAccesses.map(x=>x.target.arrayId)),
          candidates=usedViews.length?usedViews.map(id=>arrays.find(a=>a.id===id)):
            [arrayAt({objectId:baseObjectId,offset:baseOffsetBytes,size:1})].filter(Boolean);
        for(const a of candidates){
          const baseByteOffset=baseOffsetBytes-a.range.offset,baseInside=baseByteOffset>=0&&baseByteOffset<a.range.size;
          const shape=geometry.get(a.id),axisCandidates=shape?.byteStrides?.flatMap((stride,i)=>stride===r.indexStrideBytes?[i]:[])??[],
            axis=axisCandidates.includes(r.axis)?r.axis:axisCandidates.length===1?axisCandidates[0]:!r.indexStrideBytes&&shape?.rank===1?0:null,
            axisCapacity=axis===null?null:shape.dimensions[axis],stride=axis===null?null:shape.byteStrides[axis],
            baseOffset=stride?Math.floor(baseByteOffset/stride)%axisCapacity:0;
          const from=bound(f.id,r.from),to=bound(f.id,r.to),start=!baseInside||from.value===null?null:from.value+baseOffset,end=!baseInside||to.value===null?null:to.value+baseOffset,
            valid=axis!==null&&Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<=axisCapacity,
            related=siteAccesses.filter(x=>x.target.arrayId===a.id),
            outside=related.filter(x=>axis!==null&&x.target.coordinates&&start!==null&&end!==null&&(x.target.coordinates[axis]<start||x.target.coordinates[axis]>=end)),
            callExecuted=!r.callInstructionId||events.some(e=>e.activationId===f.id&&e.instructionId===r.callInstructionId&&e.action==='call');
          ranges.push({bindingId:r.id,arrayId:a.id,objectId:a.objectId,baseDeclarationId:r.baseDeclarationId,cursorDeclarationId:r.cursorDeclarationId,
            axis,axisCapacity,start,end,interval:'half-open',relation:r.relation,status:outside.length?'contradicted':valid?'supported':axis===null||start===null||end===null||!callExecuted||!related.length?'partial':'contradicted',
            executedForwarding:!!r.callInstructionId&&callExecuted,basis:'compiler-bound relation + recorded scalar values',
            sourceNodeIds:[...r.accessNodeIds,...r.boundNodeIds],executionIds:unique([...evidence,...from.executionIds,...to.executionIds]),
            bounds:{from:from.status,to:to.status},observedAccessExecutionIds:unique(related.map(x=>x.executionId)),contradictingExecutionIds:unique(outside.map(x=>x.executionId))});
        }
      }
    }
    const runs=[];for(const t of ownTransfers){
      const sourceArrayId=t.source?.arrayId??null,targetArrayId=t.target?.arrayId??null;if(!sourceArrayId&&!targetArrayId)continue;
      let run=runs.at(-1);if(!run||run.sourceArrayId!==sourceArrayId||run.targetArrayId!==targetArrayId)runs.push(run={sourceArrayId,targetArrayId,transferIds:[],executionIds:[]});
      run.transferIds.push(t.id);run.executionIds.push(t.executionId);
    }
    if(ownAccesses.length||ownTransfers.length||ranges.length)activations.push({activationId:f.id,functionId:f.functionId,parentActivationId:f.parent??null,
      arrayIds:unique([...ownAccesses.map(a=>a.target.arrayId),...ranges.map(r=>r.arrayId)]),ranges,transferRuns:runs,
      accessExecutionIds:unique(ownAccesses.map(a=>a.executionId)),transferIds:ownTransfers.map(t=>t.id)});
  }
  const usedArrays=new Set([...accesses.map(a=>a.target.arrayId),...activations.flatMap(a=>a.arrayIds)]);
  const computedDependencies=arrayValueDependencies(plan,{events,objects,structures,resultDeliveries,valueFlow,location});
  return [{id:'array-work',kind:'array-work',nodes:unique(arrays.filter(a=>usedArrays.has(a.id)).flatMap(a=>a.nodes??[])),edges:[],
    arrays:arrays.filter(a=>usedArrays.has(a.id)).map(a=>({arrayId:a.id,range:a.range,elementBytes:a.elementBytes,capacity:a.capacity,geometry:geometry.get(a.id)})),
    accesses,transfers,temporaries,comparisons,computedDependencies,activations,evidence:['compiler AST identities and bounds','recorded byte ranges and LLVM data/address dependencies'],
    limitations:['range candidates do not assert every element was accessed','changing or unavailable bounds remain partial','no algorithm identity is inferred']}];
}
