// Index-derived overlays reuse array storage. None of these links are pointers,
// program operations, or a claim that an algorithm maintains a heap invariant.
import {observedArrayPrefixes} from './observed-array-prefix.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {copyIndexEvidence} from './copy-index-evidence.mjs';
import {indexedAddress,addressIndexAccesses} from './address-index-evidence.mjs';
import {endpointPrefix} from './endpoint-prefix.mjs';
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const unique=a=>[...new Set(a)];
const refs=n=>unique(walk(n).map(x=>x.declarationId).filter(Boolean));
const numeric=v=>{const raw=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);if(raw===undefined)return null;const x=Number(raw);return Number.isSafeInteger(x)?x:null;};
const integer=n=>Number.isSafeInteger(n);
function affine(n){
  n=unwrap(n);if(!n)return null;
  if(n.kind==='DeclRefExpr'&&n.declarationId)return {declarationId:n.declarationId,scale:1,offset:0};
  if(n.kind==='IntegerLiteral'&&integer(Number(n.literal)))return {declarationId:null,scale:0,offset:Number(n.literal)};
  if(n.kind==='UnaryOperator'&&n.operator==='-'){const a=affine(n.children[0]);return a&&{...a,scale:-a.scale,offset:-a.offset};}
  if(n.kind!=='BinaryOperator')return null;
  const a=affine(n.children[0]),b=affine(n.children[1]);if(!a||!b)return null;
  if(['+','-'].includes(n.operator)&&(!a.declarationId||!b.declarationId||a.declarationId===b.declarationId)){
    const sign=n.operator==='+'?1:-1;return {declarationId:a.declarationId??b.declarationId,scale:a.scale+sign*b.scale,offset:a.offset+sign*b.offset};}
  if(n.operator==='*'&&(!a.declarationId||!b.declarationId))return {declarationId:a.declarationId??b.declarationId,
    scale:a.scale*b.offset+b.scale*a.offset,offset:a.offset*b.offset};
  if(n.operator==='<<'&&!b.declarationId&&integer(b.offset)&&b.offset>=0&&b.offset<31)
    return {...a,scale:a.scale*2**b.offset,offset:a.offset*2**b.offset};
  return null;
}
function formula(n){
  n=unwrap(n);if(!n)return null;
  const a=affine(n);if(a?.declarationId&&integer(a.scale)&&a.scale>=2&&integer(a.offset))return {...a,form:'child',degree:a.scale};
  if(['/','>>'].includes(n.operator)){
    const numerator=affine(n.children?.[0]);let denominator=affine(n.children?.[1]);
    if(n.operator==='>>')denominator=!denominator?.declarationId&&integer(denominator?.offset)&&denominator.offset>0&&denominator.offset<31?
      {declarationId:null,offset:2**denominator.offset}:null;
    if(numerator?.declarationId&&numerator.scale===1&&!denominator?.declarationId&&integer(denominator?.offset)&&denominator.offset>=2)
      return {...numerator,form:'parent',degree:denominator.offset};
  }
  return null;
}
function baseKey(n){
  n=unwrap(n);if(n?.kind==='MemberExpr'&&n.fieldNodeId)return `field:${n.fieldNodeId}`;
  return n?.kind==='DeclRefExpr'&&n.declarationId?`declaration:${n.declarationId}`:null;
}

export function bindIndexRelations(plan,copyAccesses=[],workAccesses=[]){
  const nodes=new Map(),declarationNodes=new Map(),assignments=new Map(),groups=new Map();
  for(const d of plan.instructions)if(d.action==='object.begin'&&d.declarationId)declarationNodes.set(d.sourceNodeId,d.declarationId);
  for(const d of plan.instructions)for(const n of [d.expression,...d.arguments??[]].flatMap(walk)){
    if(!nodes.has(n.nodeId))nodes.set(n.nodeId,{node:n,functionId:d.functionId});
    const id=n.kind==='VarDecl'?declarationNodes.get(n.nodeId):n.operator==='='?unwrap(n.children?.[0])?.declarationId:null;
    if(id){if(!assignments.has(id))assignments.set(id,new Map());assignments.get(id).set(n.nodeId,n.kind==='VarDecl'?n.children.at(-1):n.children[1]);}
    const address=indexedAddress(n);if(address){
      const key=baseKey(address.base);if(!key)continue;
      let group=groups.get(key);if(!group)groups.set(key,group={key,accesses:new Map()});
      group.accesses.set(n.nodeId,{nodeId:n.nodeId,functionId:d.functionId,index:address.index});
    }
  }
  // A child index passed to a recursive/helper parameter is still an index
  // dependency. Static identities nominate it; actual frames validate it below.
  const functions=new Map((plan.functions??[]).map(f=>[f.symbol,f]));
  for(const d of plan.instructions)if(d.action==='call'){
    const fn=functions.get(d.callee);if(!fn)continue;
    for(const [i,arg]of (d.arguments??[]).entries())if(fn.parameters?.[i]){
      const id=fn.parameters[i];if(!assignments.has(id))assignments.set(id,new Map());assignments.get(id).set(`${d.id}:${i}`,arg);
    }
  }
  function dependencies(n,seen=new Set()){
    const ids=refs(n),result=new Set(walk(n).map(x=>x.nodeId));
    for(const id of ids)if(!seen.has(id))for(const value of assignments.get(id)?.values()??[])
      for(const nodeId of dependencies(value,new Set(seen).add(id)))result.add(nodeId);
    return result;
  }
  const candidates=[];
  for(const group of groups.values()){
    const accesses=[...group.accesses.values()],relevant=new Set(accesses.flatMap(a=>[...dependencies(a.index)])),forms=[];
    for(const id of relevant){const entry=nodes.get(id),f=entry?.node.kind==='BinaryOperator'?formula(entry.node):null;if(!f)continue;
      // Keep the largest affine expression: 2*i inside 2*i+1 is not another
      // child slot. Division numerators are not separate child relations.
      if([...relevant].some(other=>other!==id&&nodes.get(other)?.node.kind==='BinaryOperator'&&walk(nodes.get(other)?.node).slice(1).some(x=>x.nodeId===id)&&formula(nodes.get(other)?.node)))continue;
      // A stride/cell expression is not a parent-child relation unless the
      // source index domain itself is also used to access the array.
      const associated=new Set(workAccesses.filter(a=>a.sourceNodeIds.some(id=>group.accesses.has(id))).map(a=>a.target.arrayId));
      const baseAccess=accesses.some(a=>{const index=unwrap(a.index);return index?.kind==='DeclRefExpr'&&index.declarationId===f.declarationId;})||
        copyAccesses.some(a=>associated.has(a.arrayId)&&a.declarationId===f.declarationId);
      const inverseDomain=f.form==='parent'&&accesses.some(a=>refs(a.index).includes(f.declarationId));
      const reciprocalDomain=f.form==='child'&&[...relevant].some(other=>{
        const inverse=formula(nodes.get(other)?.node);return inverse?.form==='parent'&&inverse.degree===f.degree&&
          accesses.some(a=>refs(a.index).includes(inverse.declarationId));
      });
      if(!baseAccess&&!inverseDomain&&!reciprocalDomain)continue;
      forms.push({id:`index-form:${id}`,nodeId:id,functionId:entry.functionId,...f});
    }
    const descriptors=new Map();
    for(const f of forms){
      const offsets=f.form==='parent'?[-f.offset]:Array.from({length:Math.max(0,
        Math.floor((f.degree-f.offset)/(f.degree-1))-Math.max(0,Math.ceil((1-f.offset)/(f.degree-1)))+1)},(_,i)=>{
          const base=Math.max(0,Math.ceil((1-f.offset)/(f.degree-1)))+i;return 1-(f.degree-1)*base;});
      for(const firstChildOffset of offsets){const base=(1-firstChildOffset)/(f.degree-1);if(!integer(base)||base<0)continue;
        const key=`${f.degree}:${base}`;if(!descriptors.has(key))descriptors.set(key,{degree:f.degree,base,firstChildOffset,forms:[]});}
    }
    for(const descriptor of descriptors.values()){
      descriptor.forms=forms.filter(f=>f.degree===descriptor.degree&&(f.form==='parent'?-f.offset===descriptor.firstChildOffset:
        f.offset>=descriptor.firstChildOffset&&f.offset<descriptor.firstChildOffset+descriptor.degree));
      if(forms.some(f=>f.degree===descriptor.degree&&!descriptor.forms.includes(f)))continue;
      if(forms.some(f=>f.form==='parent'&&f.degree===descriptor.degree)&&!descriptor.forms.some(f=>f.form==='parent'))continue;
      const siblingForms=[];
      for(const nodeId of relevant){
        const entry=nodes.get(nodeId),a=entry?.node.kind==='BinaryOperator'?affine(entry.node):null;
        if(!a?.declarationId||a.scale!==1||!integer(a.offset)||a.offset===0)continue;
        const origins=[...(assignments.get(a.declarationId)?.values()??[])].map(unwrap),derivedFrom=origins.filter(n=>descriptor.forms.some(f=>f.form==='child'&&f.nodeId===n?.nodeId));
        if(derivedFrom.length)siblingForms.push({id:`index-sibling:${nodeId}`,nodeId,functionId:entry.functionId,...a,form:'sibling',degree:descriptor.degree,derivedFromNodeIds:derivedFrom.map(n=>n.nodeId)});
      }
      const reciprocal=['parent','child'].every(form=>descriptor.forms.some(f=>f.form===form));
      candidates.push({id:`index-relation${candidates.length+1}`,baseKey:group.key,...descriptor,siblingForms,reciprocal,
        copyAccessEvidence:copyAccesses.filter(a=>a.arrayDeclarationId&&group.key===`declaration:${a.arrayDeclarationId}`||workAccesses.some(x=>x.target.arrayId===a.arrayId&&x.sourceNodeIds.some(id=>group.accesses.has(id)))),
        accessNodeIds:accesses.map(a=>a.nodeId),status:reciprocal?'supported':'partial'});
    }
  }
  plan.structureBindings??={};plan.structureBindings.indexRelations={candidates,evidence:'compiler array index expressions and declaration dependencies'};
  plan.coverage.structureInference??={};Object.assign(plan.coverage.structureInference,{indexRelationCandidates:candidates.length,
    indexRelationPolicy:'index-derived storage overlays; reciprocal formulas and executed comparisons are evidence, not algorithm identities'});
}

const parentOf=(d,index)=>Math.floor((index-d.firstChildOffset)/d.degree);
const inArray=(a,t)=>t?.objectId===a.objectId&&integer(t.offset)&&integer(t.size)&&t.offset<a.range.offset+a.range.size&&t.offset+t.size>a.range.offset;
const sameRange=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
function scalarValue(value){
  const raw=value?.decimal??(value?.cType?.signedness==='unsigned'?value?.unsigned:value?.signed);
  if(raw===undefined)return null;
  try{return BigInt(raw);}catch{return null;}
}
function snapshotValue(snapshot,offset,size,type){
  if(!snapshot||offset<0||offset+size>snapshot.byteLength||size<1||size>16||!type?.signedness)return null;
  let result=0n;
  for(let byte=0;byte<size;byte++){
    const position=offset+byte,r=snapshot.ranges?.find(r=>position>=r.offset&&position<r.offset+r.length);
    if(r?.initialization!=='initialized'||!r.data)return null;
    const value=r.data.encoding==='fill'?r.data.byte:r.data.encoding==='hex'?Number.parseInt(r.data.bytesHex?.slice((position-r.offset)*2,(position-r.offset+1)*2),16):NaN;
    if(!integer(value)||value<0||value>255)return null;result|=BigInt(value)<<BigInt(byte*8);
  }
  if(type.signedness==='signed'&&(result&(1n<<BigInt(size*8-1))))result-=1n<<BigInt(size*8);
  return result;
}
function valueAtEvent(a,index,e){
  const size=a.orderingProperty?.size??a.elementBytes,type=a.orderingProperty?.type??a.elementType,
    offset=a.range.offset+index*a.elementBytes+(a.orderingProperty?.offset??0),t=e.target??(e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState?.byteLength}:null);
  if(!inArray(a,t)||offset>=t.offset+t.size||offset+size<=t.offset)return undefined;
  if(e.memoryState)return snapshotValue(e.memoryState,offset-t.offset,size,type);
  if(['READ','WRITE'].includes(e.kind))return offset===t.offset&&t.size===size?scalarValue(e.value):null;
  return undefined;
}
function activeState(owner,sequence,eventSequences,capacity,base){
  const state=owner?.states?.findLast(s=>(eventSequences.get(s.afterExecutionId)??Infinity)<=sequence),length=state?.length;
  const known=!!owner?.roles?.length&&integer(length)&&length>=0&&length<=capacity;
  return {status:known?'observed':'unknown',start:base,count:known?Math.max(0,length-base):null,physicalPrefixLength:known?length:null,sourceStatus:state?.status??'unavailable',
    active:state?.active??null,sourceExecutionId:state?.afterExecutionId??null};
}
function edgeStatus(values,parent,child){
  const a=values.get(parent),b=values.get(child);return a===undefined||a===null||b===undefined||b===null?'unknown':a===b?'equal':a>b?'max':'min';
}

export function indexRelationStructures(plan,{events,objects,views=[],structures=[],valueFlow,observationPlan,observedTrace,inferenceBudget}){
  valueFlow??=createValueFlow(plan,{events,objects});
  const copies=copyIndexEvidence(plan,{events,objects,structures,observationPlan,observedTrace});
  const accesses=addressIndexAccesses(plan,{events,objects,structures,inferenceBudget},structures.find(s=>s.kind==='array-work')?.accesses??[]);
  bindIndexRelations(plan,copies,accesses);
  const candidates=plan.structureBindings?.indexRelations?.candidates??[];
  if(!candidates.length)return [];
  const arrays=structures.filter(s=>s.kind==='array'),work=structures.find(s=>s.kind==='array-work'),byEvent=new Map(events.map(e=>[e.eventId,e])),
    sequences=new Map(events.map((e,i)=>[e.eventId,i])),defs=new Map(plan.instructions.map(d=>[d.id,d])),objectDeclarations=new Map(),contexts=new Map();
  for(const o of objects)objectDeclarations.set(o.id,defs.get(byEvent.get(o.createdBy)?.instructionId)?.declarationId);
  for(const c of candidates){
    const own=accesses.filter(a=>a.sourceNodeIds.some(id=>c.accessNodeIds.includes(id))&&
      !(a.axes??[]).some(axis=>axis.axis===0&&axis.index&&a.cursors.some(r=>r.declarationId===axis.index.declarationId&&r.value+axis.index.offset!==a.target.index))),
      copyProofs=c.copyAccessEvidence??[],arrayIds=unique([...own.map(a=>a.target.arrayId),...copyProofs.map(p=>p.arrayId)]);
    for(const arrayId of arrayIds){const a=arrays.find(a=>a.id===arrayId);if(!a||!integer(c.base)||c.base<0||c.base>=a.capacity)continue;
      const key=`${arrayId}:${c.degree}:${c.base}`;let context=contexts.get(key);
      if(!context)contexts.set(key,context={id:`index-tree:${key}`,array:a,degree:c.degree,base:c.base,firstChildOffset:c.firstChildOffset,candidates:[],formulaEvidence:[],comparisons:[]});
      context.candidates.push({candidate:c,activationIds:new Set([...own.filter(x=>x.target.arrayId===arrayId).flatMap(x=>x.indexActivationIds??[x.activationId]),
        ...copyProofs.filter(p=>p.arrayId===arrayId).map(p=>p.activationId)])});
    }
  }
  // Comparisons nominate record properties, never member names. Each property
  // keeps its own ordering condition while whole records retain their storage.
  for(const [key,context]of [...contexts])if(context.array.elementType?.kind==='record'){
    const properties=new Map();
    for(const c of work?.comparisons??[])for(const o of c.operands??[]){const t=o.storage,r=byEvent.get(o.executionId);
      if(t?.arrayId!==context.array.id||!['signed','unsigned'].includes(r?.value?.cType?.signedness))continue;
      if(!context.array.elementType.members?.some(m=>m.offsetBits===t.elementOffset*8&&m.sizeBits===t.size*8))continue;
      const p={offset:t.elementOffset,size:t.size,type:r.value.cType};properties.set(`${p.offset}:${p.size}`,p);
    }
    if(properties.size){contexts.delete(key);for(const [id,p]of properties)contexts.set(`${key}:${id}`,{...context,id:`${context.id}:property:${id}`,array:{...context.array,orderingProperty:p},formulaEvidence:[],comparisons:[]});}
  }
  function declarationReads(id,declarationId,seen=new Set()){
    if(seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.kind==='READ')return objectDeclarations.get(e.target?.objectId)===declarationId?[e]:[];
    return (e.dataInputs??[]).flatMap(id=>declarationReads(id,declarationId,seen));
  }
  function dependsOn(id,producer,seen=new Set()){
    if(id===producer)return true;if(seen.has(id))return false;seen.add(id);
    return (byEvent.get(id)?.dataInputs??[]).some(input=>dependsOn(input,producer,seen));
  }
  for(const context of contexts.values())for(const {candidate,activationIds} of context.candidates){
    for(const e of events){if(e.kind!=='CALC'||!activationIds.has(e.activationId))continue;
      for(const f of [...candidate.forms,...candidate.siblingForms??[]])for(const step of (e.steps??[]).filter(s=>s.nodeId===f.nodeId)){
        const reads=unique((e.dataInputs??[]).flatMap(id=>declarationReads(id,f.declarationId)).map(r=>r.eventId)),inputs=unique(reads.map(id=>numeric(byEvent.get(id)?.value))),
          input=inputs.length===1?inputs[0]:null,output=numeric(step.value),parentIndex=f.form==='parent'?output:f.form==='sibling'&&input!==null?parentOf(context,input):input,childIndex=f.form==='parent'?input:output,
          expected=input===null?null:f.form==='parent'?Math.trunc((input+f.offset)/f.degree):input*f.scale+f.offset,
          valid=output===expected&&integer(parentIndex)&&integer(childIndex)&&parentIndex>=context.base&&childIndex>context.base&&parentOf(context,childIndex)===parentIndex,
          observed=accesses.filter(a=>a.target.arrayId===context.array.id&&
            ([parentIndex,childIndex].includes(a.target.index)&&(a.indexActivationIds??[a.activationId]).includes(e.activationId)||
              a.target.index===output&&(byEvent.get(a.executionId)?.addressInputs??[]).some(id=>dependsOn(id,e.eventId))));
        context.formulaEvidence.push({executionId:e.eventId,sourceNodeId:step.nodeId,formulaId:f.id,form:f.form,inputExecutionIds:reads,input,output,parentIndex,childIndex,
          siblingSourceIndex:f.form==='sibling'?input:null,observedAccessExecutionIds:observed.map(a=>a.executionId),
          childAccessExecutionIds:observed.filter(a=>a.target.index===childIndex&&
            (f.form==='parent'||(byEvent.get(a.executionId)?.addressInputs??[]).some(id=>dependsOn(id,e.eventId)))).map(a=>a.executionId),
          derivedAccesses:observed.filter(a=>a.target.index===output&&
            (byEvent.get(a.executionId)?.addressInputs??[]).some(id=>dependsOn(id,e.eventId))).map(a=>({executionId:a.executionId,direction:a.direction,
              range:{objectId:a.target.objectId,offset:a.target.offset,size:a.target.size},index:a.target.index})),
          derivedAccessExecutionIds:unique(observed.filter(a=>a.target.index===output&&
            (byEvent.get(a.executionId)?.addressInputs??[]).some(id=>dependsOn(id,e.eventId))).map(a=>a.executionId)),
          status:input===null||output===null?'partial':valid?'supported':'contradicted'});
      }
    }
  }
  for(const context of contexts.values())for(const comparison of work?.comparisons??[]){
    // Interior pointers can produce another array view of the same bytes.
    // Normalize current reads by storage identity; a copied value is historical.
    const current=comparison.operands?.map(o=>{
      const r=byEvent.get(o.executionId)?.target,a=context.array;
      const offset=a.orderingProperty?.offset??0,size=a.orderingProperty?.size??a.elementBytes;
      if(!o.storage||!r||r.objectId!==a.objectId||r.size!==size||r.offset<a.range.offset||r.offset+r.size>a.range.offset+a.range.size||
        (r.offset-a.range.offset)%a.elementBytes!==offset)return null;
      return {...o.storage,arrayId:a.id,index:Math.floor((r.offset-a.range.offset)/a.elementBytes),elementOffset:offset,size:r.size};
    });
    const property=context.array.orderingProperty,endpoints=comparison.operands?.map((o,i)=>current[i]??o.copiedFrom);if(endpoints?.length!==2||endpoints.some(s=>s?.arrayId!==context.array.id||s.elementOffset!==(property?.offset??0)||s.size!==(property?.size??context.array.elementBytes)))continue;
    const [left,right]=endpoints.map(s=>s.index),leftParent=right>context.base&&parentOf(context,right)===left,rightParent=left>context.base&&parentOf(context,left)===right;
    if(!leftParent&&!rightParent)continue;
    const transported=current.some(s=>!s),
      op=comparison.operator,normalized=leftParent?op:({'<':'>','<=':'>=','>':'<','>=':'<=','==':'==','!=':'!='})[op],direction=transported?null:['>','>='].includes(normalized)?'max':['<','<='].includes(normalized)?'min':null;
    context.comparisons.push({executionId:comparison.executionId,sourceNodeId:comparison.sourceNodeId,parentIndex:leftParent?left:right,childIndex:leftParent?right:left,
      operator:op,parentOperator:normalized,directionCandidate:direction,truth:numeric(byEvent.get(comparison.executionId)?.value),
      readExecutionIds:comparison.operands.map(o=>o.executionId),operands:comparison.operands,
      relationScope:transported?'historical-copy-origin; current logical position unresolved':'observed-array-slots',
      evidence:'recorded array operands and exact copied-value provenance; origin is not a current slot or an invariant'});
  }
  for(const context of contexts.values())for(const comparison of work?.comparisons??[]){
    if(context.comparisons.some(c=>c.executionId===comparison.executionId&&c.sourceNodeId===comparison.sourceNodeId))continue;
    if(comparison.operands?.length!==2||comparison.operands.some(o=>!byEvent.has(o.executionId)))continue;
    if(!comparison.operands?.some(o=>o.storage?.arrayId===context.array.id||o.copiedFrom?.arrayId===context.array.id))continue;
    context.comparisons.push({executionId:comparison.executionId,sourceNodeId:comparison.sourceNodeId,operator:comparison.operator,
      parentIndex:null,childIndex:null,directionCandidate:null,operands:comparison.operands,readExecutionIds:comparison.operands.map(o=>o.executionId),
      relationScope:'comparison uses this storage; parent-child operand roles unresolved',evidence:'observed comparison with array or transported value'});
  }
  const results=[];
  for(const context of contexts.values()){
    const a=context.array,owner=structures.find(s=>s.kind==='array-structure'&&sameRange(s.range,a.range)),
      prefix=observedArrayPrefixes(plan,{events,valueFlow},a,{start:context.base,accesses}),endpoints=endpointPrefix({events,objects,valueFlow},a,owner,context.base),maxCheckedEdges=4096,
      totalPhysicalEdges=Math.max(0,a.capacity-context.base-1),checkedChildren=totalPhysicalEdges<=maxCheckedEdges?
        Array.from({length:totalPhysicalEdges},(_,i)=>context.base+1+i):unique(accesses.filter(x=>x.target.arrayId===a.id).map(x=>x.target.index)
          .filter(i=>integer(i)&&i>context.base&&i<a.capacity)).slice(0,maxCheckedEdges),
      indices=unique(checkedChildren.flatMap(i=>[i,parentOf(context,i)])),values=new Map(),states=[],observations=[],
      stateIds=new Set([...(owner?.states?.map(s=>s.afterExecutionId)??[]),...[...prefix.proofs,...endpoints.proofs].map(p=>p.afterExecutionId)]),directions=unique(context.comparisons.map(c=>c.directionCandidate).filter(Boolean));
    let active=activeState(owner,-1,sequences,a.capacity,context.base);
    for(let sequence=0;sequence<events.length;sequence++){
      const e=events[sequence],memoryEvent=['READ','WRITE','SPACE'].includes(e.kind)&&inArray(a,e.target??(e.memoryState&&e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null));
      if(memoryEvent){
        observations.push({executionId:e.eventId,kind:e.kind,target:e.target?{objectId:e.target.objectId,offset:e.target.offset,size:e.target.size}:{objectId:e.objectId,offset:0,size:e.memoryState.byteLength},
          source:e.memoryState?'recorded-snapshot':'recorded-value'});
        for(const index of indices){const value=valueAtEvent(a,index,e);if(value!==undefined)values.set(index,value);}
      }
      const countChange=['WRITE','SPACE'].includes(e.kind)&&prefix.proofs.some(p=>p.countSources.some(r=>e.target?.objectId===r.range.objectId||e.objectId===r.range.objectId));
      if(!memoryEvent&&!stateIds.has(e.eventId)&&!countChange)continue;
      active=activeState(owner,sequence,sequences,a.capacity,context.base);
      const scanned=prefix.at(e.eventId)??endpoints.at(e.eventId);
      if(active.count===null&&scanned)active={status:'observed',start:context.base,count:Math.max(0,scanned.count-context.base),
        physicalPrefixLength:scanned.count,sourceStatus:'observed-prefix-membership',active:true,sourceExecutionId:scanned.afterExecutionId,
        evidenceExecutionIds:scanned.evidenceExecutionIds};
      const activeEdges=active.count===null?null:Math.max(0,active.count-1),limit=active.count===null?a.capacity:context.base+active.count,
        checked=checkedChildren.filter(i=>i<limit),counts={max:0,min:0,equal:0,unknown:0},samples={max:[],min:[]};
      for(const child of checked){const status=edgeStatus(values,parentOf(context,child),child);counts[status]++;
        if(status==='max'&&samples.min.length<16)samples.min.push(child);if(status==='min'&&samples.max.length<16)samples.max.push(child);}
      const total=activeEdges??totalPhysicalEdges,unknown=counts.unknown+Math.max(0,total-checked.length),
        order=direction=>({status:counts[direction==='max'?'min':'max']?'violated':unknown||active.count===null?'unknown':'satisfied',
          violations:counts[direction==='max'?'min':'max'],unknownEdges:unknown,violationChildSamples:samples[direction]});
      states.push({afterExecutionId:e.eventId,activeRange:active,checkedEdges:checked.length,totalEdges:activeEdges,
        scope:active.count===null?'physical-capacity-candidate':'observed-active-prefix',max:order('max'),min:order('min')});
    }
    const supportedForms=new Set(context.formulaEvidence.filter(e=>e.status==='supported').map(e=>e.form)),reciprocal=supportedForms.has('parent')&&supportedForms.has('child'),
      alternatives=[...contexts.values()].filter(c=>c.array.id===a.id&&c!==context&&c.candidates.some(x=>x.candidate.reciprocal));
    results.push({id:context.id,kind:'index-tree',arrayId:a.id,objectId:a.objectId,range:a.range,nodes:a.nodes??[],edges:[],
      elementBytes:a.elementBytes,elementType:a.elementType,capacity:a.capacity,lifecycle:a.lifecycle,isPointerStructure:false,
      orderingProperty:a.orderingProperty??null,copyAccessEvidence:unique(context.candidates.flatMap(x=>x.candidate.copyAccessEvidence??[])).filter(p=>p.arrayId===a.id),
      descriptor:{degree:context.degree,base:context.base,firstChildOffset:context.firstChildOffset,
        parent:'floor((childIndex-firstChildOffset)/degree)',children:'degree*parentIndex+firstChildOffset+slot; 0<=slot<degree',
        address:'range.offset+index*elementBytes',representation:'lazy-index-relations'},
      candidateIds:context.candidates.map(x=>x.candidate.id),status:context.formulaEvidence.some(e=>e.status==='contradicted')?'contradicted':reciprocal&&!alternatives.length?'supported':'partial',
      alternativeGroupId:`index-interpretation:${a.id}`,interpretationPolicy:'alternative descriptors of the same storage, not separate trees',
      formulaEvidence:context.formulaEvidence,comparisonEvidence:context.comparisons,prefixMembershipEvidence:[...prefix.proofs,...endpoints.proofs],
      direction:{candidate:directions.length===1?directions[0]:null,status:directions.length===1?'comparison-candidate':directions.length?'conflicting':'unknown',
        invariantProven:false},observations,states,
      verification:{maxCheckedEdges,checkedChildIndices:totalPhysicalEdges<=maxCheckedEdges?null:checkedChildren,
        policy:'all small-array edges; bounded observed edges for large arrays; omitted edges remain unknown'},
      evidence:['compiler index arithmetic and declaration identities','executed CALC and actual array ranges','existing array-work comparison operands'],
      limitations:['comparison direction is a candidate, not a proof of intent','missing count roles keep active range unknown','states retain writes during incomplete operations','integer element ordering only; unknown snapshots remain unknown']});
  }
  return results;
}

// A bounded query resolves any page against existing observations. In
// particular a large fill snapshot never creates capacity-many exported nodes.
export function queryIndexRelations(tree,trace,{afterExecutionId,start=tree.descriptor.base+1,limit=32}={}){
  if(!integer(start)||!integer(limit)||limit<0||limit>256)throw new RangeError('인덱스 조회 크기는 0~256이어야 합니다.');
  const end=afterExecutionId===undefined?trace.events.length-1:trace.events.findIndex(e=>e.eventId===afterExecutionId);
  if(end<0)throw new RangeError('관측한 실행 식별자가 필요합니다.');
  const stop=Math.min(tree.capacity,start+limit),children=Array.from({length:Math.max(0,stop-Math.max(start,tree.descriptor.base+1))},(_,i)=>Math.max(start,tree.descriptor.base+1)+i),
    indices=unique(children.flatMap(i=>[i,parentOf(tree.descriptor,i)])),values=new Map();
  for(const e of trace.events.slice(0,end+1))for(const index of indices){const value=valueAtEvent(tree,index,e);if(value!==undefined)values.set(index,value);}
  return children.map(child=>{const parent=parentOf(tree.descriptor,child),value=index=>values.get(index)?.toString()??null;
    return {parentIndex:parent,childIndex:child,parent:{objectId:tree.objectId,offset:tree.range.offset+parent*tree.elementBytes,size:tree.elementBytes,value:value(parent)},
      child:{objectId:tree.objectId,offset:tree.range.offset+child*tree.elementBytes,size:tree.elementBytes,value:value(child)},
      ordering:edgeStatus(values,parent,child),relation:'index-derived',isPointer:false};});
}
