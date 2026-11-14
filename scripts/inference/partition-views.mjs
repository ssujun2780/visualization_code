import {appendCandidateState} from './state-history.mjs';
// A representative forest needs observed terminal returns AND a root-to-root
// mutation. A static parent tree or a numerical pattern alone is not a DSU.
import {storageEvidence,key,num,unique,querySemanticStructure} from './storage-semantics.mjs';
export const queryDisjointSet=querySemanticStructure;
export function partitionStructures(plan,trace,{maxNodes=2048,maxStates=2048}={}){
 const c=storageEvidence(plan,trace),{events,byId,pos,flow,arrays,cell,scalar,identity,chain}=c,groups=new Map(),returns=new Map();
 function group(r){const x=cell(r.target);if(!x||num(r.value)===null||r.value?.cType?.kind==='pointer')return null;
  const id=`partition:${x.arrayId}:${x.fieldOffset}:${r.target.size}`;
  if(!groups.has(id))groups.set(id,{id,array:arrays.find(a=>a.id===x.arrayId),fieldOffset:x.fieldOffset,size:r.target.size,terminals:[],lookups:[],operations:[],states:[],indices:new Set(),truncated:false});return groups.get(id);}
 const index=(g,r)=>Math.floor((r.offset-g.array.range.offset)/g.array.elementBytes),range=(g,i)=>({objectId:g.array.objectId,offset:g.array.range.offset+i*g.array.elementBytes+g.fieldOffset,size:g.size}),
  belongs=(g,r)=>r?.objectId===g.array.objectId&&r.size===g.size&&(r.offset-g.array.range.offset)%g.array.elementBytes===g.fieldOffset&&r.offset>=g.array.range.offset&&r.offset+r.size<=g.array.range.offset+g.array.range.size;
 const pending=[];
 function root(g,i,at){const seen=new Set(),path=[];while(g.indices.has(i)&&!seen.has(i)){
  seen.add(i);path.push(i);const v=scalar(range(g,i),at),modes=g.terminals.filter(t=>pos.get(t.afterExecutionId)<=at).map(t=>t.mode);
  if(modes.includes('self')&&v===i||modes.includes('negative')&&v!==null&&v<0)return {root:i,path};
  if(!Number.isSafeInteger(v)||v<0)return {root:null,path};i=v;
 }return {root:null,path,cycle:seen.has(i)};}
 for(const e of events){const at=pos.get(e.eventId);
  if(['READ','WRITE'].includes(e.kind)&&e.target){const g=group(e);if(g){if(g.indices.size<maxNodes)g.indices.add(index(g,e.target));else if(!g.indices.has(index(g,e.target)))g.truncated=true;}}
  if(e.kind==='CALC')for(const s of e.steps??[]){
   if(!['==','!=','<','<=','>','>='].includes(s.operator)||s.inputs?.length!==2)continue;
   const rr=s.inputs.map(i=>flow.sourceReadOperand(i,e,s));
   for(let k=0;k<2;k++){const r=rr[k],g=r&&group(r);if(!g)continue;const i=index(g,r.target),other=rr[1-k],value=num(r.value),
    cursors=(r.addressInputs??[]).flatMap(id=>flow.reads(id)).filter(x=>num(x.value)===i&&x.value?.cType?.kind!=='pointer');
    const self=value===i&&['==','!='].includes(s.operator)&&other&&cursors.some(x=>identity(x.eventId,other.eventId))&&num(s.value)===(s.operator==='=='?1:0),
     bound=num(s.inputs[1-k].value),negative=value<0&&value!==null&&!other&&bound===0&&['<','>=','>','<='].includes(s.operator);
    if(!self&&!negative)continue;
    for(const cursor of cursors)pending.push({g,mode:self?'self':'negative',index:i,readExecutionId:r.eventId,cursorReadExecutionId:cursor.eventId,
      comparisonExecutionId:e.eventId,sourceNodeId:s.nodeId,activationId:e.activationId});
   }
  }
  if(e.action==='return.value'){
   const retReads=(e.dataInputs??[]).flatMap(id=>flow.reads(id)),p=pending.findLast(p=>p.activationId===e.activationId&&retReads.some(r=>identity(r.eventId,p.cursorReadExecutionId))&&num(e.value)===p.index&&scalar(range(p.g,p.index),at)===num(byId.get(p.readExecutionId).value));
   let proof;
   if(p){proof={mode:p.mode,index:p.index,readExecutionId:p.readExecutionId,cursorReadExecutionId:p.cursorReadExecutionId,comparisonExecutionId:p.comparisonExecutionId,
    sourceNodeId:p.sourceNodeId,returnExecutionId:e.eventId,afterExecutionId:e.eventId};p.g.terminals.push(proof);returns.set(e.eventId,{g:p.g,proof});}
   else {const inherited=(e.dataInputs??[]).flatMap(chain).map(x=>returns.get(x.eventId)).find(Boolean);if(inherited&&num(e.value)===inherited.proof.index){
    proof={...inherited.proof,returnExecutionId:e.eventId,afterExecutionId:e.eventId,terminalReturnExecutionId:inherited.proof.returnExecutionId};returns.set(e.eventId,{g:inherited.g,proof});}}
   const returned=returns.get(e.eventId);if(returned)returned.g.lookups.push(proof);
  }
  // Inlined find loops have no call/return boundary. Their observed normal
  // exit establishes the same representative cursor without inventing a call.
  if(e.action==='branch'&&num(e.condition)===0&&['WhileStmt','ForStmt','DoStmt'].includes(c.defs.get(e.instructionId)?.controlKind)){
   const p=pending.findLast(p=>p.activationId===e.activationId&&e.dataInputs?.includes(p.comparisonExecutionId));
   if(p&&scalar(range(p.g,p.index),at)===num(byId.get(p.readExecutionId).value))p.g.terminals.push({mode:p.mode,index:p.index,readExecutionId:p.readExecutionId,
    cursorReadExecutionId:p.cursorReadExecutionId,comparisonExecutionId:p.comparisonExecutionId,sourceNodeId:p.sourceNodeId,returnExecutionId:null,exitExecutionId:e.eventId,afterExecutionId:e.eventId});
  }
  if(e.kind==='WRITE'&&e.action==='write')for(const g of groups.values())if(belongs(g,e.target)){
   const resolve=(ids,i)=>{const returned=(ids??[]).flatMap(chain).map(x=>returns.get(x.eventId)).find(p=>p?.g===g&&p.proof.index===i);if(returned)return returned;
    const proof=g.terminals.findLast(p=>p.exitExecutionId&&p.index===i&&(ids??[]).flatMap(id=>flow.reads(id)).some(r=>identity(r.eventId,p.cursorReadExecutionId)));return proof?{g,proof}:null;};
   const i=index(g,e.target),j=num(e.value),old=root(g,i,at-1),dest=j===null?{root:null}:root(g,j,at-1),
    valueProof=resolve(e.dataInputs,j),addressProof=resolve(e.addressInputs,i);
   if(j!==i&&valueProof&&old.root!==null&&dest.root===j){
    const kind=old.root===i&&addressProof?'merge':old.root===j&&scalar(range(g,i),at-1)!==j?'compress':null;
    if(kind)g.operations.push({kind,fromIndex:i,toIndex:j,previousPath:old.path,writeExecutionId:e.eventId,
      valueReturnExecutionId:valueProof.proof.returnExecutionId,addressReturnExecutionId:addressProof?.proof.returnExecutionId??null,
      valueExitExecutionId:valueProof.proof.exitExecutionId??null,addressExitExecutionId:addressProof?.proof.exitExecutionId??null,afterExecutionId:e.eventId});
   }
  }
  for(const g of groups.values())if(g.terminals.length&&(['READ','WRITE'].includes(e.kind)&&belongs(g,e.target)||e.memoryState&&(e.target?.objectId??e.objectId)===g.array.objectId||g.terminals.at(-1)?.afterExecutionId===e.eventId||e.action==='return.value'&&returns.get(e.eventId)?.g===g||e.action==='object.end'&&e.objectId===g.array.objectId||e.endedObjects?.includes(g.array.objectId))){

   const alive=c.alive(g.array.objectId,at),nodes=[...g.indices].sort((a,b)=>a-b).map(i=>({id:`${g.id}:${i}`,index:i,range:range(g,i),value:scalar(range(g,i),at),...root(g,i,at)})),partitions=new Map();
   for(const n of nodes)if(n.root!==null){if(!partitions.has(n.root))partitions.set(n.root,[]);partitions.get(n.root).push(n.index);}
   const operations=g.operations.filter(p=>pos.get(p.afterExecutionId)<=at),current=new Map(nodes.map(n=>[n.index,n])),
    activeMergeExecutionIds=operations.filter(p=>p.kind==='merge'&&current.get(p.fromIndex)?.root!==null&&current.has(p.fromIndex)&&current.get(p.fromIndex).root===current.get(p.toIndex)?.root).map(p=>p.writeExecutionId),merged=!!activeMergeExecutionIds.length;
   appendCandidateState(g,{afterExecutionId:e.eventId,alive,nodes,activeMergeExecutionIds,groups:[...partitions].map(([representative,members])=>({representative,members})),
    status:!alive?'ended':nodes.some(n=>n.cycle)?'contradicted':g.truncated||nodes.some(n=>n.root===null)?'incomplete':merged?'supported-observed':'representative-forest',
    evidenceExecutionIds:unique([...g.terminals.map(t=>t.returnExecutionId??t.exitExecutionId),...operations.map(p=>p.writeExecutionId)])},maxStates);
  }
 }
 return [...groups.values()].filter(g=>g.terminals.length).map(g=>({id:g.id,kind:'representative-partition-candidate',arrayId:g.array.id,objectId:g.array.objectId,range:g.array.range,
  fieldOffset:g.fieldOffset,elementBytes:g.array.elementBytes,fieldSize:g.size,intent:'unconfirmed',nodes:[],edges:[],terminals:g.terminals,lookups:g.lookups,operations:g.operations,states:g.states,
  discoveredAtExecutionId:g.terminals[0].afterExecutionId,coverage:{...g.coverage,maxNodes,maxStates,truncated:g.truncated},membership:'observed-slots; reserved and logical membership may differ',
  limitations:['terminal convention needs an observed representative return','rank/size policy and arbitrary root sentinels are not inferred','static forests remain a general relation unless merging is observed']}));
}
