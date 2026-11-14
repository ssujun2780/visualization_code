import {createStringComparisonReader} from './string-comparison.mjs';
import {keyMemory} from './key-memory.mjs';
import {key} from './storage-semantics.mjs';
// Library operands are observed ranges, not invented READ events or guessed keys.
export function priorityStringEvidence(plan,trace,c){
 const memory=keyMemory(trace),comparisons=new Map(),types=new Map((plan.types??[]).map(t=>[t.id,t])),stringComparison=createStringComparisonReader(plan,trace,c.flow,memory);
 function baseType(id){const seen=new Set();let t=types.get(id);while(t?.kind==='Derived'&&t.baseType&&!seen.has(t.id)){seen.add(t.id);t=types.get(t.baseType);}return t;}
 for(const e of c.events){
  if(e.action!=='resume')continue;
  const comparison=stringComparison(e);if(!comparison)continue;
  const operands=comparison.args.map(arg=>{
   // Pointer copies/parameters can precede the actual record-field read in
   // the identity chain. Keep that read's identity rather than the alias slot.
   let storage=arg.stringKey.storage;
   let source=arg.reads.map(access=>{const at=c.pos.get(access.eventId),origin=c.origin(access.target,at),field=origin&&c.fieldAt(origin.range,origin.at);
    if(field)return {access,origin,field};
    // Copying bytes into a field changes its contents, not its record identity.
    // Whole-record argument copies still use the resolved origin above.
    const stored=c.fieldAt(access.target,at);return stored?{access,origin:{range:access.target,at,copyExecutionIds:[]},field:stored}:null;
   }).find(x=>x?.field);
   if(!source)for(const read of arg.reads){
    const ref=read.value?.reference,bytes=arg.stringKey.byteRange,at=c.pos.get(read.eventId);
    if(ref?.status!=='in-bounds'||ref.targetObjectId!==bytes.objectId||ref.targetOffset!==bytes.offset)continue;
    const node=c.recordAt({...bytes,size:1},at),member=node?.type.members.find(m=>node.range.offset+m.offsetBits/8===bytes.offset),type=baseType(member?.typeId);
    if(type?.tag!=='DW_TAG_array_type'||baseType(type.baseType)?.sizeBits!==8||bytes.size>member.sizeBits/8)continue;
    const range={objectId:bytes.objectId,offset:bytes.offset,size:member.sizeBits/8},origin=c.origin(range,at);if(!origin)continue;
    // Derived access to the original array field, anchored by an actual pointer
    // READ. It is metadata only and is never added as a READ to the input IR.
    const access={...read,target:range,addressInputs:[read.eventId],value:{...read.value,cType:{kind:'array',sizeBits:member.sizeBits,elementType:{sizeBits:8}}}};
    source={access,origin,field:c.fieldAt(origin.range,origin.at)};storage='inline';if(source.field)break;source=null;
   }
   if(!source)return null;const {access,origin,field}=source;
   return {...origin,field,cell:c.cell(origin.range),access,readExecutionId:access.eventId,
    storage,byteRange:arg.stringKey.byteRange,payload:access.keyPayload};
  });
  if(operands.every(Boolean))comparisons.set(e.eventId,{...comparison.comparison,operands});
 }
 function value(component,range,at){
  if(component.storage==='inline'){
   const v=memory.bytesKey(component,range,at);return {value:v?.payload??null,evidence:v?.writer?[v.writer]:[]};
  }
  const edge=c.edgesAt(at).find(e=>key(e.source)===key(range)),target=edge?.target;
  if(edge?.status!=='in-bounds'||!target||!c.alive(target.objectId,at))return {value:null,evidence:edge?[edge.lastObservationExecutionId]:[]};
  const v=memory.bytesKey(component,target,at);return {value:v?.payload??null,evidence:[edge.lastObservationExecutionId,...v?.writer?[v.writer]:[]]};
 }
 return {comparisons,value};
}
