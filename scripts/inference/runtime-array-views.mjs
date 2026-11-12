// Runtime VLA strides are compiler-generated operand observations. Bounds are
// not evaluated from type spellings, nor guessed from adjacent element values.
export function runtimeArrayViews(plan,observations,raw,{events,objects}){
  const defs=new Map(observations.instructions.map(d=>[d.id,d])),byObject=new Map(objects.map(o=>[o.id,o])),values=new Map(),scales=new Map(),arrays=new Map(),
    positions=new Map(raw.events.map((e,i)=>[e.eventId,i])),publicPositions=events.map(e=>({event:e,at:Math.max(-1,...(e.observationIds??[]).map(id=>positions.get(id)??-1))}));
  const key=(e,v)=>`${e.activationId}:${v}`,number=v=>{const n=Number(v?.decimal??v?.unsigned??v?.signed);return Number.isSafeInteger(n)?n:null;};
  const operand=(e,i)=>values.get(key(e,i?.value))?.value??(/^\d+$/.test(i?.value??'')?{unsigned:i.value}:null);
  for(const e of raw.events){
    const d=defs.get(e.instructionId);if(!d)continue;const spec=plan.bindings[d.id]?.runtimeArrayScale;
    if(spec){const count=number(operand(e,d.inputs[1-spec.indexInput]));if(count>0)scales.set(e.eventId,{...spec,count});}
    if(d.action==='address'){
      const scale=values.get(key(e,d.inputs[1]?.value)),shape=scale&&scales.get(scale.eventId),base=operand(e,d.pointer),ref=base?.reference,
        element=shape?.arrayType.elementType,leafBytes=element?.sizeBits/8,rowBytes=shape?.count*leafBytes,o=byObject.get(ref?.targetObjectId),offset=ref?.targetOffset??0;
      if(o&&shape&&leafBytes>0&&Number.isSafeInteger(rowBytes)&&rowBytes>0&&offset>=0&&offset<o.size&&(o.size-offset)%rowBytes===0){
        const row={...shape.arrayType,count:shape.count,dimensions:[shape.count,...element.dimensions??[]],sizeBits:rowBytes*8,
          evidence:'compiler array type + observed LLVM stride operand'},size=o.size-offset,id=`runtime-array:${o.id}:${offset}:${rowBytes}`,
          at=publicPositions.find(p=>p.at>=positions.get(e.eventId))?.event.eventId;
        if(at&&!arrays.has(id))arrays.set(id,{id,kind:'array',objectId:o.id,range:{objectId:o.id,offset,size},nodes:[],edges:[],elementType:row,
          elementBytes:rowBytes,capacity:size/rowBytes,lifecycle:o.lifecycle,discoveredAtExecutionId:at,
          runtimeShape:{sourceNodeId:shape.sourceNodeId,strideObservationId:scale.eventId,addressObservationId:e.eventId,
            binding:'compiler subscript index matched to LLVM multiplication operand'},
          evidence:['compiler VLA subscript type','observed runtime stride and allocation extent'],snapshot:'runtime typed view over existing storage'});
      }
    }
    if(d.result&&e.value)values.set(key(e,d.result),e);
  }
  return [...arrays.values()];
}
