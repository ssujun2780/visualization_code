import {defineStructureRelation} from './relation-binding.mjs';
import {keyMemory} from './key-memory.mjs';
import {topology} from '../shared/topology.mjs';
import {expandRelationLink} from './relation-collections.mjs';
const rangeKey=r=>`${r.objectId}:${r.offset}:${r.size}`;
// Queries actual recorded memory. No inference candidates, final values or C execution.
export function createUserRelationQuery(trace,binding,{roleIds=null,maxNodes=4096,maxEdges=16384}={}){
  const spec=defineStructureRelation(trace,binding),memory=keyMemory(trace),objects=new Map(trace.objects.map(o=>[o.id,o]));
  if(!Number.isSafeInteger(maxNodes)||maxNodes<1||!Number.isSafeInteger(maxEdges)||maxEdges<1)throw new RangeError('양수 관계 조회 한도가 필요합니다.');
  if(roleIds!==null&&(!Array.isArray(roleIds)||roleIds.some(id=>typeof id!=='string')))throw new TypeError('역할 배열이 필요합니다.');
  const roles=roleIds??spec.links.map(l=>l.id),links=spec.links.filter(l=>roles.includes(l.id)),
    roleComplete=roles.every(id=>spec.links.some(l=>l.id===id)),sources=new Map();
  function collect(objectId,offset,type,at){
    if(spec.nodes.kind!=='records'||!type)return;
    const t=type.kind==='array'?type.elementType:type;
    if(t?.recordTypeId!==spec.nodes.recordTypeId)return;
    const count=type.kind==='array'?type.count:1,size=t.sizeBits/8,key=`${objectId}:${offset}:${size}:${count}`;
    if(!sources.has(key))sources.set(key,{objectId,offset,count,size,recordTypeId:t.recordTypeId,at});
  }
  for(const o of trace.objects)collect(o.id,0,o.cType,memory.pos.get(o.createdBy));
  for(let i=0;i<trace.events.length;i++){const e=trace.events[i];if(e.phase&&e.phase!=='complete')continue;
    const ref=e.value?.reference;if(ref?.status==='in-bounds')collect(ref.targetObjectId,ref.targetOffset,e.value?.cType?.pointee,i);
    if(e.target)collect(e.target.objectId,e.target.offset,e.value?.cType,i);}
  return {binding:structuredClone(spec),at(at){
  if(!Number.isInteger(at)||at< -1||at>=trace.events.length)throw new RangeError('관측 사건 위치가 필요합니다.');
  const catalog=new Map(),byLocation=new Map(),byIndex=new Map(),
    missing=[],violations=[],evidence=new Set(),scopeRanges=new Map(),partKeys=new WeakMap();
  let limited=false,linkReads=0;
  const occurred=id=>memory.pos.has(id)&&memory.pos.get(id)<=at;
  const remember=(r,node)=>{if(!r)return;const key=rangeKey(r);scopeRanges.set(key,r);
    if(!node||r.objectId===node.range.objectId&&r.offset>=node.range.offset&&r.offset+r.size<=node.range.offset+node.range.size)return;
    let keys=partKeys.get(node);if(!keys){keys=new Set();partKeys.set(node,keys);}if(!keys.has(key)){keys.add(key);node.parts.push({role:'relation-storage',range:r});}};
  function add(objectId,offset,size,index,recordTypeId){
    const o=objects.get(objectId);if(!o||!memory.alive(objectId,at)||offset<0||offset+size>o.size)return;
    const range={objectId,offset,size},id=`user-node:${rangeKey(range)}`;if(catalog.has(id))return;
    if(catalog.size>=maxNodes){limited=true;return;}
    const node={id,range,...index===undefined?{}:{index},...recordTypeId?{recordTypeId}:{},parts:[]};
    catalog.set(id,node);byLocation.set(`${objectId}:${offset}`,node);if(index!==undefined)byIndex.set(index,node);
  }
  if(spec.nodes.kind==='array'){
    const n=spec.nodes,o=objects.get(n.objectId),type=o.cType?.elementType;
    if(memory.alive(n.objectId,at))for(let i=0;i<n.count;i++){
      add(n.objectId,n.offset+i*n.stride,n.size,i,n.size===type?.sizeBits/8&&n.offset% n.size===0&&n.stride% n.size===0?type.recordTypeId:null);if(limited)break;}
  }else{
    for(const s of sources.values())if(s.at<=at&&memory.alive(s.objectId,at))for(let i=0;i<s.count;i++){
      add(s.objectId,s.offset+i*s.size,s.size,undefined,s.recordTypeId);if(limited)break;}
  }
  function slot(item,node){
    const s=item.source;if(!s)return null;
    if(s.kind==='slot')return {objectId:s.objectId,offset:s.offset,size:s.size};
    if(s.kind==='field')return {objectId:node.range.objectId,offset:node.range.offset+s.offset,size:s.size};
    if(node.index>=s.count)return null;
    return {objectId:s.objectId,offset:s.offset+node.index*s.stride,size:s.size};
  }
  function read(item,node,owner=node){
    const range=slot(item,node);remember(range,owner);
    if(item.value!==undefined)return {value:item.value,range:null,executionId:null};
    if(linkReads++>=maxEdges){limited=true;return {unknown:'relation-query-limit',range};}
    const object=range&&objects.get(range.objectId);
    if(object&&occurred(object.endedBy))return {issue:'relation-storage-ended',range};
    const s=memory.snapshot(range,at);if(s?.writer)evidence.add(s.writer);
    if(!s||s.bytes.some(b=>b===null))return {unknown:'unobserved-link',range,executionId:s?.writer??null};
    let bits=0n;for(let i=s.bytes.length-1;i>=0;i--)bits=(bits<<8n)|BigInt(s.bytes[i]);
    if(item.kind==='index')return {value:(item.signed?BigInt.asIntN(range.size*8,bits):bits).toString(),range,executionId:s.writer};
    // The recorded C target represents null pointers as all-zero bits. Other
    // bit patterns require an observed reference, never address-number matching.
    if(bits===0n||s.reference?.status==='null')return {terminal:true,range,executionId:s.writer};
    if(!s.reference)return {unknown:'unobserved-pointer-origin',range,executionId:s.writer};
    return {reference:s.reference,range,executionId:s.writer};
  }
  function resolve(item,observed){
    if(observed.issue||observed.unknown||observed.terminal)return observed;
    let node;
    if(item.kind==='index'){
      if(item.nullValues.includes(observed.value))return {...observed,terminal:true};
      const i=BigInt(observed.value)-BigInt(item.indexBase);
      if(i<0n||i>=BigInt(spec.nodes.count))return {...observed,issue:'relation-index-out-of-range'};
      node=byIndex.get(Number(i));
    }else{
      const ref=observed.reference,o=objects.get(ref.targetObjectId);
      if(o&&occurred(o.endedBy))return {...observed,issue:'relation-dangling-target'};
      if(ref.status==='unknown')return {...observed,unknown:'relation-unresolved-target'};
      if(ref.status!=='in-bounds'||ref.onePast)return {...observed,issue:'relation-invalid-pointer'};
      node=byLocation.get(`${ref.targetObjectId}:${ref.targetOffset}`);
      if(!node&&!limited&&spec.nodes.kind==='array')return {...observed,issue:'relation-target-outside-domain'};
      if(!node&&!limited)return {...observed,unknown:'target-not-observed-in-domain'};
    }
    if(!node)return {...observed,unknown:limited?'relation-query-limit':'target-not-yet-observed'};
    if(!memory.alive(node.range.objectId,at))return {...observed,issue:'relation-dangling-target',targetNodeId:node.id};
    return {...observed,node};
  }
  function problem(value,from,roleId){
    const item={code:value.issue??value.unknown,from,roleId,range:value.range??null,
      evidenceExecutionIds:value.evidenceExecutionIds??(value.executionId?[value.executionId]:[]),...value.value===undefined?{}:{value:value.value},
      ...value.reference?{reference:value.reference}:{}};
    if(value.issue)violations.push(item);else missing.push(item);
  }
  const rootNodeIds=[],pending=[],rootObservations=[];
  for(const root of spec.roots??[]){const r=resolve(root,read(root));rootObservations.push({...r,node:r.node?.id});
    if(r.node){rootNodeIds.push(r.node.id);pending.push(r.node);}else if(!r.terminal)problem(r,null,'root');}
  if(spec.roots===null)pending.push(...[...catalog.values()].filter(n=>memory.alive(n.range.objectId,at)));
  const nodes=[],edges=[],terminals=[],seen=new Set();
  for(let i=0;i<pending.length;i++){
    const node=pending[i];if(seen.has(node.id))continue;seen.add(node.id);nodes.push(node);remember(node.range);
    for(const l of links){
      if(limited&&linkReads>=maxEdges)break;
      for(const observed of expandRelationLink(l,node,{read,memory,objects,at})){
      const r=resolve(l,observed),base={from:node.id,roleId:l.id,sourceRange:r.range,
        evidenceExecutionIds:r.evidenceExecutionIds??(r.executionId?[r.executionId]:[]),...(r.viaRanges?{viaRanges:r.viaRanges,itemIndex:r.itemIndex}:{})};
      if(r.terminal){terminals.push({...base,to:null,kind:r.termination??(l.kind==='index'?'sentinel':'null'),value:r.value??null,storedEdgeIds:[]});continue;}
      if(!r.node){problem(r,node.id,l.id);continue;}
      edges.push({...base,id:`user-edge:${node.id}:${l.id}:${r.itemIndex??0}`,to:r.node.id,storedEdgeIds:[]});pending.push(r.node);
      }
    }
  }
  const domain=spec.nodes.kind==='array'?objects.get(spec.nodes.objectId):null,
    rootEnded=spec.roots?.length>0&&spec.roots.every(r=>r.source&&occurred(objects.get(r.source.objectId)?.endedBy)),
    knownSources=[...sources.values()].filter(s=>s.at<=at),
    domainEnded=domain?occurred(domain.endedBy):spec.roots===null&&knownSources.length>0&&knownSources.every(n=>occurred(objects.get(n.objectId)?.endedBy)),
    ended=!!(rootEnded||domainEnded),
    ready=(domain?occurred(domain.createdBy):spec.roots!==null||knownSources.length>0)&&
      (spec.roots??[]).every(r=>!r.source||occurred(objects.get(r.source.objectId)?.createdBy)),
    alive=ready&&!ended;
  if(!ready)missing.push({code:'relation-not-yet-created'});
  if(limited)missing.push({code:'relation-query-limit'});
  const top=topology(nodes,edges),complete=alive&&roleComplete&&!missing.length&&!violations.length;
  return {id:`${spec.id}:roles:${JSON.stringify([...new Set(roles)].sort())}`,sourceStructureId:spec.id,sourceKind:'user-relation',selectedCandidateId:spec.id,origin:'user',
    afterExecutionId:trace.events[at]?.eventId??null,roleIds:[...roles],alive,complete,roleComplete,historyGap:false,
    lifetimeStatus:ended?'ended':ready?'alive':'not-created',
    rootNodeIds:spec.roots===null?top.roots:[...new Set(rootNodeIds)],rootObservations,nodes,edges,terminals,terminalNodeIds:[],
    topology:{...top,status:complete?'observed':'partial'},scopeRanges:[...scopeRanges.values()],evidenceExecutionIds:[...evidence],
    violations,missing,coverage:{limited,maxNodes,maxEdges},interpretation:'user-specified roles over recorded storage; not inferred intent'};
  }};
}
export function queryUserRelation(trace,binding,{at,...options}={}){
  return createUserRelationQuery(trace,binding,options).at(at);
}
