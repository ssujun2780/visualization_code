// Conditions can select a link's address before the later dereference/store.
// Follow recorded pointer value versions, never equal payloads or variable names.
export function addressSelectionControls(event,flow){
  const controls=new Set(event.controlInputs??[]);
  for(const id of event.addressInputs??[])for(const value of flow.chain(id)){
    const ref=value.value?.reference;
    if(ref?.status==='in-bounds'&&ref.targetObjectId===event.target?.objectId&&ref.targetOffset===event.target?.offset)
      for(const branch of value.controlInputs??[])controls.add(branch);
  }
  return [...controls];
}
