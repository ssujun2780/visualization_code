import {stateHistoryCoverage,appendStateSnapshot,appendCandidateState} from './state-history.mjs';
import {recordEvidence} from './record-evidence.mjs';
import {key,num,unique} from './storage-semantics.mjs';
export function pointerPartitionStructures(plan,trace,{maxStates=2048}={}){
 const c=recordEvidence(plan,trace),groups=new Map(),pending=[],returned=new Map();
 const group=f=>{const id=`pointer-partition:${f.node.typeId}:${f.offset}`;if(!groups.has(id))groups.set(id,{id,typeId:f.node.typeId,fieldOffset:f.offset,terminals:[],lookups:[],operations:[],states:[],truncated:false});return groups.get(id);};
 const conventions=(g,at)=>g.terminals.filter(p=>c.pos.get(p.afterExecutionId)<=at),
  parentMap=(g,at)=>{const excluded=new Set(conventions(g,at).filter(p=>p.mode==='sentinel').map(p=>p.terminalNodeId));return new Map(c.edgesAt(at).filter(e=>e.recordFrom&&!excluded.has(e.recordFrom)&&c.records.find(n=>n.id===e.recordFrom)?.typeId===g.typeId&&e.fieldOffset===g.fieldOffset).map(e=>[e.recordFrom,e]));};
 const root=(g,edges,id,at)=>{const path=[],seen=new Set(),modes=conventions(g,at);while(edges.has(id)&&!seen.has(id)){seen.add(id);path.push(id);const e=edges.get(id);
  if(modes.some(p=>p.mode==='self'?e.recordTo===id:p.mode==='null'?e.status==='null':p.mode==='sentinel'&&e.recordTo===p.terminalNodeId))return {root:id,path};
  if(!e.recordTo)return {root:null,path};id=e.recordTo;}return {root:null,path,cycle:seen.has(id)};};
 for(const e of c.events){const at=c.pos.get(e.eventId);
  if(e.kind==='CALC')for(const s of e.steps??[]){if(!['==','!='].includes(s.operator)||s.inputs.length!==2)continue;
   if(num(s.value)!==(s.operator==='=='?1:0))continue;
   const reads=s.inputs.map(i=>c.flow.sourceReadOperand(i,e,s));for(let i=0;i<2;i++){
    const read=reads[i],f=read&&c.fieldAt(read.target,at),dest=read&&c.pointerNode(read.value,at);
    if(!f||read.value?.cType?.kind!=='pointer')continue;
    const cursor=(read.addressInputs??[]).flatMap(id=>c.flow.reads(id)).find(r=>c.pointerNode(r.value,at)?.id===f.node.id);
    if(!cursor)continue;const mode=dest?.id===f.node.id?'self':read.value.reference?.status==='null'?'null':dest?'sentinel':null;if(!mode)continue;
    pending.push({g:group(f),mode,terminalNodeId:mode==='sentinel'?dest.id:null,nodeId:f.node.id,readExecutionId:read.eventId,cursorReadExecutionId:cursor.eventId,comparisonExecutionId:e.eventId,sourceNodeId:s.nodeId,activationId:e.activationId});
   }
  }
  if(e.action==='return.value'){
   const n=c.pointerNode(e.value,at),p=pending.findLast(p=>p.activationId===e.activationId&&p.nodeId===n?.id&&(e.dataInputs??[]).flatMap(c.chain).some(x=>c.identity(x.eventId,p.cursorReadExecutionId)));
   const inherited=(e.dataInputs??[]).flatMap(c.chain).map(x=>returned.get(x.eventId)).find(x=>x?.proof.nodeId===n?.id);
   if(p){const proof={mode:p.mode,terminalNodeId:p.terminalNodeId,nodeId:p.nodeId,readExecutionId:p.readExecutionId,cursorReadExecutionId:p.cursorReadExecutionId,comparisonExecutionId:p.comparisonExecutionId,sourceNodeId:p.sourceNodeId,returnExecutionId:e.eventId,afterExecutionId:e.eventId};p.g.terminals.push(proof);p.g.lookups.push(proof);returned.set(e.eventId,{g:p.g,proof});}
   else if(inherited){const proof={...inherited.proof,returnExecutionId:e.eventId,terminalReturnExecutionId:inherited.proof.returnExecutionId,afterExecutionId:e.eventId};inherited.g.lookups.push(proof);returned.set(e.eventId,{g:inherited.g,proof});}
  }
  if(e.kind==='WRITE'&&e.action==='write'){
   const f=c.fieldAt(e.target,at),to=c.pointerNode(e.value,at);if(f&&to)for(const g of groups.values())if(g.typeId===f.node.typeId&&g.fieldOffset===f.offset){
    const edges=parentMap(g,at-1),old=root(g,edges,f.node.id,at-1),dest=root(g,edges,to.id,at-1),resolve=(ids,id)=>(ids??[]).flatMap(c.chain).map(x=>returned.get(x.eventId)).find(x=>x?.g===g&&x.proof.nodeId===id),v=resolve(e.dataInputs,to.id),a=resolve(e.addressInputs,f.node.id);
    const kind=v&&dest.root===to.id&&to.id!==f.node.id?(old.root===f.node.id&&a?'merge':old.root===to.id&&old.path.length>2?'compress':null):null;
    if(kind)g.operations.push({kind,fromNodeId:f.node.id,toNodeId:to.id,previousPath:old.path,writeExecutionId:e.eventId,valueReturnExecutionId:v.proof.returnExecutionId,addressReturnExecutionId:a?.proof.returnExecutionId??null,afterExecutionId:e.eventId});
   }
  }
  for(const g of groups.values())if(g.terminals.length&&(e.kind==='WRITE'||e.action==='object.end'||e.endedObjects?.length)){

   const edges=parentMap(g,at),nodes=[...edges].map(([id,edge])=>({id,range:c.records.find(n=>n.id===id).range,parent:edge.recordTo,...root(g,edges,id,at)})),partitions=new Map();
   for(const n of nodes)if(n.root){if(!partitions.has(n.root))partitions.set(n.root,[]);partitions.get(n.root).push(n.id);}
   const current=new Map(nodes.map(n=>[n.id,n])),activeMergeExecutionIds=g.operations.filter(p=>p.kind==='merge'&&current.get(p.fromNodeId)?.root&&current.get(p.fromNodeId).root===current.get(p.toNodeId)?.root).map(p=>p.writeExecutionId),merged=!!activeMergeExecutionIds.length;appendCandidateState(g,{afterExecutionId:e.eventId,alive:!!nodes.length,nodes,edges:[...edges.values()],activeMergeExecutionIds,groups:[...partitions].map(([representative,members])=>({representative,members})),
    status:!nodes.length?'ended':nodes.some(n=>n.cycle)?'contradicted':nodes.some(n=>!n.root)?'incomplete':merged?'supported-observed':'representative-forest',evidenceExecutionIds:unique([...g.terminals.map(p=>p.returnExecutionId),...g.operations.map(p=>p.writeExecutionId)])},maxStates);
  }
 }
 return [...groups.values()].filter(g=>g.states.length).map(g=>({...g,kind:'pointer-partition-candidate',intent:'unconfirmed',nodes:[],edges:[],discoveredAtExecutionId:g.terminals[0].afterExecutionId,coverage:{...g.coverage,maxStates,truncated:g.truncated},limitations:['self, NULL or sentinel termination requires an observed comparison and cursor return','historical merging does not prove current membership after reset or split']}));
}

// Shared reachable storage is a fact; persistence/immutability is not implied.
export function sharedRecordStructures(plan,trace,{maxStates=2048}={}){
 const c=recordEvidence(plan,trace),states=[],proofs=[],history=stateHistoryCoverage(maxStates);
 for(const e of c.events){if(!['WRITE','SPACE'].includes(e.kind))continue;const at=c.pos.get(e.eventId),edges=c.edgesAt(at),roots=edges.filter(x=>!x.recordFrom&&x.recordTo&&c.objects.find(o=>o.id===x.source.objectId)?.cType?.kind==='pointer');
  // A partial reachability prefix must never be reported as the exact shared
  // set. The inference worker's deadline handles excessive work independently.
  const reach=id=>{const seen=new Set(),pending=[id];while(pending.length){const n=pending.pop();if(seen.has(n))continue;seen.add(n);pending.push(...edges.filter(x=>x.recordFrom===n&&x.recordTo).map(x=>x.recordTo));}return seen;};
  const pairs=[];for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++){const a=roots[i],b=roots[j];if(a.recordTo===b.recordTo)continue;
   // Stable peer handles, not a recursive call's temporary traversal cursors.
   const oa=c.objects.find(o=>o.id===a.source.objectId),ob=c.objects.find(o=>o.id===b.source.objectId);if(oa.frameId!==ob.frameId)continue;
   const ra=reach(a.recordTo),rb=reach(b.recordTo),shared=[...ra].filter(id=>rb.has(id));if(!shared.length||ra.has(b.recordTo)||rb.has(a.recordTo))continue;
   pairs.push({rootSlots:[a.source,b.source],rootNodeIds:[a.recordTo,b.recordTo],sharedNodeIds:shared,exclusiveNodeIds:[[...ra].filter(id=>!rb.has(id)),[...rb].filter(id=>!ra.has(id))],evidenceExecutionIds:unique([a.lastObservationExecutionId,b.lastObservationExecutionId,...edges.filter(x=>ra.has(x.recordFrom)||rb.has(x.recordFrom)).map(x=>x.lastObservationExecutionId)])});
  }
  if(!pairs.length&&!states.length)continue;
  if(e.action==='copy'&&c.recordAt(e.target,at)&&c.recordAt({objectId:e.sourceObjectId,offset:e.sourceOffset,size:e.sourceSize},at-1))proofs.push({writeExecutionId:e.eventId,target:e.target,source:{objectId:e.sourceObjectId,offset:e.sourceOffset,size:e.sourceSize}});
  appendStateSnapshot(states,{afterExecutionId:e.eventId,alive:!!pairs.length,status:pairs.length?'supported-observed':'no-current-sharing',pairs,evidenceExecutionIds:unique(pairs.flatMap(p=>p.evidenceExecutionIds))},history);
 }
 return states.length?[{id:'shared-record-substructures',kind:'shared-substructure-candidate',intent:'unconfirmed',nodes:[],edges:[],states,copyEvidence:proofs,discoveredAtExecutionId:history.firstStateExecutionId,coverage:history,limitations:['shared storage identity does not prove persistence or immutability','root handles must be live peers in the same frame or static storage']}]:[];
}
