// Adapt already observed semantic snapshots. No classifier is rerun here.
import {topology} from '../shared/topology.mjs';
export const semanticKinds=new Set(['index-tree','pointer-priority-candidate','composite-priority-candidate','representative-partition-candidate','pointer-partition-candidate','range-aggregate-candidate','queue-candidate','array-structure','separate-array-structure','dynamic-array','associative-lookup-candidate','composed-container-candidate']);
export function projectSemanticRelation(source,state){
 if(!state||!semanticKinds.has(source.kind))return null;
 const nodes=(state.nodes??state.entries??[]).filter(n=>n&&typeof n==='object').map(n=>({...n,id:n.id??`${source.id}:element:${n.index}`,range:n.range??n.record}));
 const rawEdges=source.kind==='range-aggregate-candidate'?nodes.flatMap(n=>(n.topologyChildren??[]).map(ch=>({id:`${n.id}:${ch.index}`,from:n.id,to:nodes.find(n=>n.index===ch.index)?.id,storedEdgeIds:[],evidenceExecutionIds:[ch.readExecutionId,ch.writeExecutionId]}))):state.priorityEdges??state.edges??[],
  edges=rawEdges.map(e=>({...e,from:e.from??e.recordFrom??nodes.find(n=>n.index===e.parent)?.id,to:e.to??e.recordTo??nodes.find(n=>n.index===e.child)?.id})).filter(e=>e.from&&e.to);
 return {id:`relation:${source.id}`,sourceStructureId:source.id,selectedCandidateId:source.id,sourceKind:source.kind,
  afterExecutionId:state.afterExecutionId??state.executionId,roleIds:[],nodes,edges,terminals:[],terminalNodeIds:[],rootNodeIds:(state.roots??[]).map(id=>nodes.find(n=>n.index===id)?.id??id),
  alive:state.alive!==false&&state.active!==false&&state.status!=='ended',complete:source.kind!=='index-tree'&&!state.historyGap&&!['incomplete','unknown','partial','unresolved','intermediate'].includes(state.status),roleComplete:true,historyGap:!!state.historyGap,
  semantic:{kind:source.kind,state,view:state.view??source.view,roles:source.roles,descriptor:source.descriptor,lookupEvidence:source.lookupEvidence,operationEvidence:source.operationEvidence},
  evidenceExecutionIds:state.evidenceExecutionIds??[state.afterExecutionId??state.executionId],interpretation:'observed semantic snapshot; source storage is unchanged'};
}
const result=(status,reason=null,violations=[])=>({status,reason,violations});
export function semanticCondition(relation,expected,properties={}){
 if(!relation.alive)return result('ended');
 if(relation.historyGap||relation.semantic?.state.lifetimeGap||relation.semantic?.state.evidenceGap)return result('incomplete','omitted state history or evidence');
 const {state:s,kind,view}=relation.semantic??{};
 if(expected==='trie'&&relation.sequenceConditions){const c=relation.sequenceConditions;
  const terminal=properties.terminal&&relation.nodes.every(n=>properties.terminal.values.some(v=>v.nodeId===n.id&&v.value!==null)),supported=properties.terminal?
    terminal&&c.tree==='satisfied-observed'&&c.labelled==='satisfied-observed':c.trie==='supported-observed';
  return c.deterministic==='violated'?result('violated',null,c.conflicts.map(edges=>({code:'ambiguous-symbol-transition',edges}))):supported?result('satisfied-observed'):result('incomplete','label, terminal or tree evidence is incomplete');}
 if(['min-heap','max-heap'].includes(expected)){
  const order=expected.startsWith('min')?'min':'max',value=s?.[order]?.status??s?.[order];
  if(value)return result(value==='satisfied'?'satisfied-observed':value==='violated'?'violated':'incomplete',value==='unknown'?'active range or comparison policy missing':null,value==='violated'?[{code:'parent-priority-order',order}]:[]);
  if(properties.key){const keys=new Map(properties.key.values.map(n=>[n.nodeId,n.value])),unknown=relation.nodes.some(n=>keys.get(n.id)==null);
   const shape=topology(relation.nodes,relation.edges),parents=new Map();for(const e of relation.edges)parents.set(e.to,(parents.get(e.to)??0)+1);
   if(shape.cyclic||[...parents.values()].some(n=>n>1)||relation.complete&&relation.nodes.length&&shape.roots.length!==1)return result('violated',null,[{code:'priority-tree-shape'}]);
   if(unknown)return result('incomplete','unobserved key');
   const bad=relation.edges.filter(e=>order==='min'?BigInt(keys.get(e.from))>BigInt(keys.get(e.to)):BigInt(keys.get(e.from))<BigInt(keys.get(e.to)));
   return bad.length?result('violated',null,bad.map(e=>({code:'parent-priority-order',edgeId:e.id}))):relation.complete?result('satisfied-observed'):result('incomplete','partial relation');
  }
 }
 if(expected==='disjoint-set'&&['representative-partition-candidate','pointer-partition-candidate'].includes(kind)){
  const grouped=s.groups?.flatMap(g=>g.members)??[],ids=s.nodes.map(n=>n.id??n.index);
  if(s.nodes.some(n=>n.cycle))return result('violated',null,[{code:'representative-cycle'}]);
  return grouped.length===ids.length&&new Set(grouped).size===ids.length&&ids.every(id=>grouped.includes(id))&&s.nodes.every(n=>n.root!==null)?result('satisfied-observed'):result('incomplete','representative or membership unobserved');
 }
 if(['segment-tree','fenwick-tree','range-aggregate'].includes(expected)&&kind==='range-aggregate-candidate'){
  if(s.nodes.some(n=>n.stale))return result('violated','aggregate depends on an older child version',[{code:'stale-aggregate'}]);
  return s.nodes.some(n=>n.coverage?.end-n.coverage?.start>1)&&s.nodes.every(n=>n.complete)&&(expected==='range-aggregate'||view===expected)?result('satisfied-observed'):result('incomplete','coverage or requested index layout unobserved');
 }
 if(['queue','stack','deque','array-membership'].includes(expected)&&s){
  const desired={queue:'fifo',stack:'lifo',deque:'deque'},role=s.selectedRole??s.role;
  if(kind==='queue-candidate'&&expected==='queue')return result(s.status==='supported'?'satisfied-observed':s.status==='contradicted'?'violated':'incomplete',null,s.status==='contradicted'?[{code:'fifo-order'}]:[]);
  if(kind==='composed-container-candidate'&&view===expected)return result(s.status==='supported'?'satisfied-observed':'incomplete');
  if(['array-structure','separate-array-structure','dynamic-array'].includes(kind)&&
    (expected==='array-membership'||role===desired[expected]))return result(s.status==='consistent'?'satisfied-observed':s.status==='inconsistent-or-unavailable'?'violated':'incomplete');
 }
 if(expected==='hash-table'&&kind==='associative-lookup-candidate')return result(s.omittedEntries||s.entries.some(e=>e.alive===false)?'incomplete':s.entries.length&&relation.semantic.lookupEvidence.some(p=>p.bucketTransformExecutionIds.length)?'satisfied-observed':'not-checkable','observed key/bucket association; hash quality and author intent are not asserted');
 return result('not-checkable','requested roles or dedicated condition evidence are not established');
}
