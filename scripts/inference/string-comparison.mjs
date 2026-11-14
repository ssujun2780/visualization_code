const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind)&&n.children?.length===1)n=n.children[0];return n;};
const charPointer=t=>t?.kind==='pointer'&&t.pointee?.sizeBits===8;
const address=v=>{try{return BigInt(v?.address??v?.bits);}catch{return null;}};
// A derived operand refers to a real pointer READ or a library read region.
// It is never appended to the execution trace as a synthetic READ.
export function createStringComparisonReader(plan,trace,flow,memory){
 const events=new Map(),defs=new Map(),positions=new Map(),results=new WeakMap();
 for(const [i,e]of trace.events.entries())if(!events.has(e.eventId)){events.set(e.eventId,e);positions.set(e.eventId,i);}
 for(const d of plan.instructions)if(!defs.has(d.id))defs.set(d.id,d);
 let bySource,reads;
 function addressInputs(node,call){
  if(!bySource){
   bySource=new Map();for(const d of plan.instructions){if(!bySource.has(d.sourceNodeId))bySource.set(d.sourceNodeId,[]);bySource.get(d.sourceNodeId).push(d.id);}
   reads=new Map();for(const [i,e]of trace.events.entries())if(e.kind==='READ'){
    if(!reads.has(e.activationId))reads.set(e.activationId,new Map());const activation=reads.get(e.activationId);
    if(!activation.has(e.instructionId))activation.set(e.instructionId,[]);activation.get(e.instructionId).push({index:i,id:e.eventId});
   }
  }
  const ids=new Set();function visit(n){if(!n)return;for(const id of bySource.get(n.nodeId)??[])ids.add(id);for(const c of n.children??[])visit(c);}visit(node);
  const at=positions.get(call.eventId),activation=reads.get(call.activationId),latest=[];
  for(const id of ids){const records=activation?.get(id);if(!records?.length||records[0].index>=at)continue;
   let lo=0,hi=records.length;while(lo<hi){const mid=(lo+hi)>>>1;if(records[mid].index<at)lo=mid+1;else hi=mid;}
   latest.push({first:records[0].index,id:records[lo-1].id});
  }
  // Match the original Map's first-observation order, not AST field order.
  return latest.sort((a,b)=>a.first-b.first).map(r=>r.id);
 }
 // Run-local only: validators construct their own reader from source records.
 // Neither input events nor a result from another inference run is cached here.
 return resume=>{
  if(resume?.action!=='resume')return null;
  if(!results.has(resume))results.set(resume,readStringComparison(resume,flow,memory,{events,defs,addressInputs}));
  return results.get(resume);
 };
}
export function stringComparison(plan,trace,resume,flow,memory){
 if(resume?.action!=='resume')return null;
 return createStringComparisonReader(plan,trace,flow,memory)(resume);
}
function readStringComparison(resume,flow,memory,index){
 if(resume?.action!=='resume')return null;
 const call=index.events.get(resume.callExecutionId),def=index.defs.get(call?.instructionId);
 const domains={'@strcmp':'nul-terminated-bytes','@strncmp':'bounded-string-bytes','@memcmp':'fixed-bytes'},domain=domains[call?.callee];
 if(!domain||call.resolvedFunctionId||!def?.external||!resume.readRegions?.length)return null;
 const bound=call.inputs?.find(i=>i.parameterIndex===2),byteLimit=domain==='nul-terminated-bytes'?undefined:Number(bound?.value?.decimal??bound?.value?.signed??bound?.value?.literal);
 // Variable comparison lengths need their own context-dependent key policy.
 // Never freeze one observed length as a constant for later comparisons.
 const boundEvent=index.events.get(bound?.executionId),constantBound=!bound?.executionId||boundEvent?.kind==='CALC'&&!boundEvent.dataInputs?.length&&boundEvent.steps?.every(s=>s.kind==='folded-expression'&&!s.inputs?.some(i=>i.executionId||i.observationId));
 if(domain!=='nul-terminated-bytes'&&(!constantBound||!Number.isSafeInteger(byteLimit)||byteLimit<=0))return null;
 const at=memory.pos.get(resume.eventId),operands=[];
 for(let parameterIndex=0;parameterIndex<2;parameterIndex++){
  const input=call.inputs?.find(i=>i.parameterIndex===parameterIndex),addr=address(input?.value);if(addr===null||input?.value?.cType?.kind!=='pointer')return null;
  const region=resume.readRegions.find(r=>{const base=address({address:r.address});return base!==null&&base<=addr&&addr<base+BigInt(r.size);});if(!region)return null;
  const offset=region.offset+Number(addr-BigInt(region.address)),stringRange={objectId:region.objectId,offset},observed=memory.bytesKey({domain,byteLimit},stringRange,at);
  if(!observed)return null;
  const actualReads=input.executionId?flow.reads(input.executionId).filter(e=>charPointer(e.value?.cType)):[],direct=actualReads[0];
  let range=direct?.target,type=direct?.value?.cType,storage='pointer',addressInputs=[];
  if(!range){const node=unwrap(def.arguments?.[parameterIndex]);
   if(node?.cType?.kind!=='array'||node.cType.elementType?.sizeBits!==8)return null;
   range={...stringRange,size:node.cType.sizeBits/8};type=node.cType;storage='inline';
   if(!memory.snapshot(range,at))return null;
   addressInputs=index.addressInputs(node,call);
  }
  const evidence={callExecutionId:call.eventId,returnExecutionId:resume.eventId,parameterIndex,storage,domain,...byteLimit===undefined?{}:{byteLimit},byteRange:observed.range},
   project=e=>({...e,keyPayload:observed.payload,stringKey:{...evidence,cType:type}}),
   access=project(direct??{eventId:resume.eventId,activationId:resume.activationId,kind:'FLOW',action:'resume',target:range,value:{cType:type},dataInputs:region.dataInputs??[],addressInputs}),
   reads=direct?actualReads.map(project):[access];
  operands.push({reads,event:access,stringKey:evidence});
 }
 return {op:'strcmp',args:operands,comparison:{callExecutionId:call.eventId,returnExecutionId:resume.eventId,domain,...byteLimit===undefined?{}:{byteLimit}}};
}
