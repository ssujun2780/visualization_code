// Connect recorded storage/semantic evidence to representation-independent
// conditions. Explicit property bindings describe roles, never invent values.
import {queryStructureRelations,relationContext} from './structure-relations.mjs';
import {evaluateStructureConditions,STRUCTURE_CONDITIONS} from './structure-conditions.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';
import {queryManagementRoles} from './management-roles.mjs';
import {stateHistoryGapAt} from './state-history.mjs';
import {defineStructureConditionRules,observeUserConditions} from './user-conditions.mjs';
const sameRoles=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
export function validateConditionBindings(bindings){
  if(bindings===null||bindings===undefined)return null;
  if(typeof bindings!=='object'||Array.isArray(bindings))throw new TypeError('조건 역할 지정 객체가 필요합니다.');
  for(const [name,b]of Object.entries(bindings)){
    if(!['color','height','key','terminal'].includes(name)||!b||!['record','array'].includes(b.kind))throw new TypeError('지원하는 조건 역할은 color/height/key/terminal의 record/array 지정입니다.');
    if(b.kind==='record'&&(!Number.isSafeInteger(b.offset)||b.offset<0||!Number.isInteger(b.size)||b.size<1||b.size>16)||
      b.kind==='array'&&(typeof b.arrayId!=='string'||!b.arrayId))throw new TypeError('관측 필드 범위 또는 배열 식별자가 필요합니다.');
    if(b.shift!==undefined&&(!Number.isInteger(b.shift)||b.shift<0||b.shift>127))throw new RangeError('비트 이동 범위가 올바르지 않습니다.');
    if(b.mask!==undefined&&BigInt(b.mask)<0n)throw new RangeError('비트 마스크는 음수가 될 수 없습니다.');
    if(name==='color'&&(b.redValue===undefined||b.blackValue===undefined||BigInt(b.redValue)===BigInt(b.blackValue)))throw new TypeError('서로 다른 빨강/검정 표현값이 필요합니다.');
    if(name==='height'&&b.leafHeight!==undefined&&![0,1].includes(b.leafHeight))throw new RangeError('잎의 높이 기준은 0 또는 1입니다.');
    if(name==='color'){BigInt(b.redValue);BigInt(b.blackValue);}
  }
  return structuredClone(bindings);
}
function propertiesAt(trace,relation,bindings,ctx){
  if(!bindings||!Object.keys(bindings).length)return {};
  const source=trace.structures.find(s=>s.id===relation.sourceStructureId),objects=new Map(trace.objects.map(o=>[o.id,o])),slots=[],properties={};
  const nodes=[...relation.nodes];
  for(const id of relation.terminalNodeIds){if(nodes.some(n=>n.id===id))continue;
    const n=source?.logicalNodes?.find(n=>n.id===id);if(n)nodes.push({...n,range:{objectId:n.objectId,offset:n.offset,size:n.size}});
    else nodes.push({id});}
  for(const [name,b]of Object.entries(bindings??{})){
    const array=b.kind==='array'?trace.structures.find(s=>s.kind==='array'&&s.id===b.arrayId):null;
    properties[name]={origin:'user',...(name==='color'?{redValue:BigInt(b.redValue).toString(),blackValue:BigInt(b.blackValue).toString()}:{leafHeight:b.leafHeight??1}),values:[]};
    for(const n of nodes){
      const r=b.kind==='record'&&n.range&&(!b.recordTypeId||n.recordTypeId===b.recordTypeId)&&b.offset+b.size<=n.range.size?
        {objectId:n.range.objectId,offset:n.range.offset+b.offset,size:b.size}:array&&Number.isSafeInteger(n.index)&&n.index>=0&&n.index<array.capacity?
          {objectId:array.objectId,offset:array.range.offset+n.index*array.elementBytes,size:array.elementBytes}:null,
        o=r&&objects.get(r.objectId),valid=o&&r.size>0&&r.size<=16&&r.offset>=0&&r.offset+r.size<=o.size&&!(o.endedBy&&ctx.occurred(o.endedBy));
      slots.push({name,b,nodeId:n.id,range:valid?r:null,bytes:null,evidence:[]});
    }
  }
  const byObject=new Map();for(const s of slots)if(s.range){if(!byObject.has(s.range.objectId))byObject.set(s.range.objectId,[]);byObject.get(s.range.objectId).push(s);}
  for(let i=0;i<=ctx.at;i++){
    const e=trace.events[i];if(!['SPACE','READ','WRITE'].includes(e.kind)||e.phase&&e.phase!=='complete')continue;
    const target=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null);
    for(const s of byObject.get(target?.objectId)??[]){if(!overlap(s.range,target))continue;
      const exact=target.offset===s.range.offset&&target.size===s.range.size;
      let next;if(e.initializationEvidence==='unobserved')next=observeScalarBytes(s.bytes,{size:s.range.size,snapshot:{byteLength:target.size,ranges:[]},start:target.offset,offset:s.range.offset});
      else if(e.memoryState)next=observeScalarBytes(s.bytes,{size:s.range.size,snapshot:e.memoryState,start:target.offset,offset:s.range.offset});
      else if(exact&&e.value?.bits!==undefined)next=observeScalarBytes(s.bytes,{size:s.range.size,value:e.value.bits});
      else if(e.kind!=='READ')next=observeScalarBytes(s.bytes,{size:s.range.size,snapshot:{byteLength:target.size,ranges:[]},start:target.offset,offset:s.range.offset});
      if(next){s.bytes=next;s.evidence.push(e.eventId);}
    }
  }
  for(const s of slots){let value=null;
    if(s.bytes?.bytes.every(b=>b!==null)){let bits=0n;for(let i=s.range.size-1;i>=0;i--)bits=(bits<<8n)|BigInt(s.bytes.bytes[i]);
      if(s.b.mask!==undefined)bits&=BigInt(s.b.mask);bits>>=BigInt(s.b.shift??0);
      if(s.b.signed&&s.b.mask===undefined&&!s.b.shift)bits=BigInt.asIntN(s.range.size*8,bits);
      value=bits.toString();}
    properties[s.name].values.push({nodeId:s.nodeId,range:s.range,value,evidenceExecutionIds:s.evidence});}
  return properties;
}
export function queryStructureConditions(trace,{target,candidateId,roleIds=null,afterExecutionId,expected,bindings=null,relationBinding=null,relationLimits={},conditionRules=null}={}){
  bindings=validateConditionBindings(bindings);
  conditionRules=defineStructureConditionRules(trace,conditionRules);
  const ctx=relationContext(trace,afterExecutionId),{relations,historyGap:relationHistoryGap}=queryStructureRelations(trace,{target,candidateId,roleIds,afterExecutionId,relationBinding,relationLimits}),candidates=[];
  for(const relation of relations){
    const roleSuggestions=queryManagementRoles(trace,{afterExecutionId}).filter(r=>relation.nodes.some(n=>n.recordTypeId===r.binding.recordTypeId)),
      heights=roleSuggestions.filter(r=>r.role==='height'),autoHeight=!bindings?.height&&heights.length===1?heights[0]:null,
      colors=roleSuggestions.filter(r=>r.role==='color'&&r.suggestedMapping),autoColor=!bindings?.color&&colors.length===1?colors[0]:null,
      effectiveBindings={...bindings,...(autoHeight?{height:{...autoHeight.binding,leafHeight:autoHeight.leafHeight}}:{}),...(autoColor?{color:{...autoColor.binding,redValue:autoColor.suggestedMapping.redValue,blackValue:autoColor.suggestedMapping.blackValue}}:{})};
    const selectedOrderId=trace.structures.find(s=>s.id===(candidateId??target?.structureId)&&s.kind==='ordered-tree-candidate')?.id,
      orders=trace.structures.filter(s=>s.kind==='ordered-tree-candidate'&&s.sourceStructureId===relation.sourceStructureId&&
      (!selectedOrderId||s.id===selectedOrderId))
      .map(s=>({s,state:ctx.state(s)})).filter(({state})=>state&&sameRoles(state.contracts.map(c=>c.roleId),relation.roleIds)),
      properties=propertiesAt(trace,relation,effectiveBindings,ctx),user=observeUserConditions(trace,relation,conditionRules,ctx.at);
    if(autoHeight&&properties.height){properties.height.origin='inferred';properties.height.roleEvidenceExecutionIds=autoHeight.evidenceExecutionIds;}
    if(autoColor&&properties.color){properties.color.origin='inferred-hypothesis';properties.color.roleEvidenceExecutionIds=autoColor.evidenceExecutionIds;properties.color.encodingEvidence=autoColor.suggestedMapping;}
    for(const item of user.order?[null]:orders.length?orders:[null]){
      const state=item?.state,historyGap=!!state?.historyGap,
        snapshot=historyGap?{...relation,complete:false,historyGap:true}:relation,
        order=user.order??(state?{nodes:state.nodes,contracts:state.contracts,keyOrder:state.keyOrder??[{index:0,direction:1}],composite:!!item.s.key.components,
          complete:state.contracts.length===2&&state.contracts.some(c=>c.direction==='less')&&state.contracts.some(c=>c.direction==='greater'),
          unsupported:state.status==='not-checkable',conflict:state.contracts.some(c=>c.direction==='conflicting')}:null),
        checks=evaluateStructureConditions(snapshot,{expected,order,properties,customConditions:user.customConditions});
      candidates.push({candidateId:item?.s.id??relation.selectedCandidateId,relation:snapshot,properties,roleSuggestions,
        ...(conditionRules?{userProperties:user.properties,orderOrigin:user.order?'user':order?'inferred':null}:{}),...checks});
    }
  }
  const needsOrder=id=>id==='bst-order'||Object.hasOwn(STRUCTURE_CONDITIONS,id)&&STRUCTURE_CONDITIONS[id].requires.some(needsOrder),
    orderedIds=new Set(trace.structures.filter(s=>s.kind==='ordered-tree-candidate').map(s=>s.id)),
    // Child projections without an ordering role are not rival BST contracts.
    scoped=needsOrder(expected)&&candidates.some(c=>orderedIds.has(c.candidateId))?candidates.filter(c=>orderedIds.has(c.candidateId)):candidates,
    missingHistory=relationHistoryGap||trace.structures.some(s=>s.id===(candidateId??target?.structureId)&&stateHistoryGapAt(s,ctx.positions,ctx.at)),
    assessment=!scoped.length?(missingHistory?'incomplete':'not-checkable'):scoped.every(c=>c.assessment===scoped[0].assessment)?scoped[0].assessment:'ambiguous';
  return {expected,assessment,candidates:scoped,reason:!scoped.length?'no observed relation for the selected scope':assessment==='ambiguous'?'alternative relations have different assessments':null,
    warnings:scoped.flatMap(c=>c.warnings.map(w=>({...w,candidateId:c.candidateId,relationId:c.relation.id}))),
    policy:'conditions describe observed state, not author intent or C execution errors'};
}
