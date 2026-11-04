// A wasm function pointer is a table slot, never a linear-memory address.
export const isFunctionPointer=type=>typeof type==='string'&&/\)\s*\*$/.test(type);

export class FunctionReferences {
  constructor(){this.byIndex=new Map();}
  register(index,definition){
    const previous=this.byIndex.get(index);
    if(previous&&previous.functionId!==definition.functionId){this.byIndex.set(index,{ambiguous:true});return;}
    if(!previous?.ambiguous)this.byIndex.set(index,{functionId:definition.functionId,functionName:definition.functionName});
  }
  target(index){
    const definition=this.byIndex.get(index),resolved=!!index&&definition&&!definition.ambiguous;
    return {kind:'function',tableIndex:index,status:!index?'null':resolved?'resolved':'unresolved',
      functionId:resolved?definition.functionId:null,functionName:resolved?definition.functionName:null,
      evidence:resolved?'observed compiler function pointer':'observed function pointer bits'};
  }
}
