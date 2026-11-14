import {keyMemory} from './key-memory.mjs';
import {comparePayload,scalarFromBytes} from './scalar-domain.mjs';
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const text=s=>typeof s==='string'&&s.length>0;
const fail=m=>{throw new TypeError(m);};
const unique=a=>[...new Set(a)];
const operators=['<','<=','>','>=','==','!='];
const accepts=(sign,op)=>sign!==null&&({'<':sign<0,'<=':sign<=0,'>':sign>0,'>=':sign>=0,'==':sign===0,'!=':sign!==0})[op];
function literal(value,domain){
  if(domain==='string'){
    if(typeof value!=='string')fail('문자열 조건에는 문자열 상수가 필요합니다.');
    return {kind:'bytes',value:[...new TextEncoder().encode(value)]};
  }
  if(domain==='float'){
    if(!['number','string'].includes(typeof value)||String(value).trim()===''||Number.isNaN(Number(value))&&value!=='NaN')fail('실수 상수가 필요합니다.');
    return {kind:'float',value:String(Number(value))};
  }
  if(!['number','string'].includes(typeof value)||typeof value==='number'&&!Number.isSafeInteger(value)||!/^[-+]?\d+$/.test(String(value)))fail('정확한 정수 상수가 필요합니다.');
  return {kind:'integer',value:BigInt(value).toString()};
}

export function defineStructureConditionRules(trace,spec){
  if(spec===null||spec===undefined)return null;
  if(typeof spec!=='object'||Array.isArray(spec))fail('선언형 조건 객체가 필요합니다.');
  const objects=new Map(trace.objects.map(o=>[o.id,o]));
  function property(p){
    const s=p?.source,domain=p?.domain??'integer';
    if(!s||!['integer','float','string'].includes(domain))fail('속성의 관측 저장 범위와 자료형이 필요합니다.');
    let source;
    if(s.kind==='field'){
      if(!integer(s.offset)||!integer(s.size,1))fail('속성 필드 범위가 잘못되었습니다.');
      source={kind:'field',offset:s.offset,size:s.size};
    }else if(['array','slot'].includes(s.kind)){
      const o=objects.get(s.objectId),offset=s.offset??0,size=s.size??(s.kind==='array'?o?.cType?.elementType:o?.cType)?.sizeBits/8,
        stride=s.stride??size,count=s.count??Math.max(0,Math.floor((o?.size-offset-size)/stride)+1);
      if(!o||!integer(offset)||!integer(size,1)||offset+size>o.size||s.kind==='array'&&(!integer(stride,size)||!integer(count)||count>0&&offset+(count-1)*stride+size>o.size))fail('속성 저장 범위가 잘못되었습니다.');
      source={kind:s.kind,objectId:o.id,offset,size,...s.kind==='array'?{stride,count}:{}};
    }else fail('속성은 field, array 또는 slot을 지정합니다.');
    if(domain==='integer'&&source.size>16||domain==='float'&&![4,8].includes(source.size)||domain==='string'&&source.size>4096)fail('속성 자료형과 크기가 맞지 않습니다.');
    if(p.signed!==undefined&&typeof p.signed!=='boolean')fail('signed는 불리언입니다.');
    if(p.storage!==undefined&&!['inline','pointer'].includes(p.storage))fail('문자열 저장 방식이 잘못되었습니다.');
    return {source,domain,signed:p.signed??true,...domain==='string'?{storage:p.storage??'inline'}:{}};
  }
  const properties=Object.create(null),rawProperties=spec.properties??{};
  if(typeof rawProperties!=='object'||Array.isArray(rawProperties)||Object.keys(rawProperties).length>32)fail('속성은 최대 32개입니다.');
  for(const [name,p]of Object.entries(rawProperties)){if(!text(name))fail('속성 이름이 필요합니다.');properties[name]=property(p);}
  let order=null;
  if(spec.order){
    const o=spec.order;if(!Array.isArray(o.components)||!o.components.length||o.components.length>16||!Array.isArray(o.roles)||o.roles.length!==2)fail('BST 순서는 키 구성요소와 두 연결 역할을 지정합니다.');
    const components=o.components.map(p=>{if(p.direction!==undefined&&![1,-1].includes(p.direction))fail('키 비교 방향은 1 또는 -1입니다.');return {...property(p),direction:p.direction??1};});
    const roles=o.roles.map(r=>{if(!text(r.roleId)||!['less','greater'].includes(r.direction)||!['allow','exclude','unknown'].includes(r.duplicates??'unknown'))fail('연결 비교 방향·중복 정책이 잘못되었습니다.');
      return {roleId:r.roleId,direction:r.direction,duplicates:r.duplicates??'unknown'};});
    if(new Set(roles.map(r=>r.roleId)).size!==2||new Set(roles.map(r=>r.direction)).size!==2)fail('서로 다른 작은 쪽·큰 쪽 역할이 필요합니다.');
    order={components,roles};
  }
  if(!Array.isArray(spec.conditions??[])||(spec.conditions??[]).length>32)fail('사용자 조건은 최대 32개입니다.');
  const ids=new Set(),conditions=(spec.conditions??[]).map(c=>{
    if(!text(c.id)||!c.id.startsWith('custom:')||ids.has(c.id)||!Array.isArray(c.rules)||!c.rules.length||c.rules.length>64)fail('고유한 custom: 조건 이름과 1~64개 규칙이 필요합니다.');ids.add(c.id);
    const requires=c.requires??[];if(!Array.isArray(requires)||requires.some(id=>!text(id)))fail('선행 조건 목록이 필요합니다.');
    const rules=c.rules.map(r=>{
      if(!['degree','value','edge-order','reciprocal'].includes(r?.kind))fail('지원하지 않는 선언형 조건 규칙입니다.');
      const roles=r.roleIds??null;if(roles!==null&&(!Array.isArray(roles)||roles.some(id=>!text(id))))fail('연결 역할 목록이 필요합니다.');
      const base={kind:r.kind,roleIds:roles===null?null:unique(roles)};
      if(r.kind==='degree'){
        if(!['in','out'].includes(r.direction??'out')||!integer(r.min??0)||r.max!=null&&(!integer(r.max)||(r.min??0)>r.max))fail('연결 개수 범위가 잘못되었습니다.');
        return {...base,direction:r.direction??'out',min:r.min??0,max:r.max??null};
      }
      if(r.kind==='reciprocal'){
        if(!text(r.forwardRoleId)||!text(r.reverseRoleId))fail('상호 연결 역할이 필요합니다.');return {...base,forwardRoleId:r.forwardRoleId,reverseRoleId:r.reverseRoleId};
      }
      if(!Object.hasOwn(properties,r.property)||!operators.includes(r.operator))fail('비교할 속성과 연산자가 필요합니다.');
      if(r.kind==='edge-order')return {...base,property:r.property,operator:r.operator};
      if(!['nodes','roots'].includes(r.scope??'nodes'))fail('속성 검사 범위는 nodes 또는 roots입니다.');
      // Keep the literal in its JSON source form; do not execute callbacks.
      literal(r.value,properties[r.property].domain);
      return {...base,property:r.property,operator:r.operator,scope:r.scope??'nodes',value:r.value};
    });
    return {id:c.id,requires:unique(requires),rules};
  });
  const seen=new Set(),visiting=new Set(),byId=new Map(conditions.map(c=>[c.id,c]));
  function visit(id){if(seen.has(id)||!byId.has(id))return;if(visiting.has(id))fail('사용자 조건 의존성이 순환합니다.');visiting.add(id);for(const child of byId.get(id).requires)visit(child);visiting.delete(id);seen.add(id);}
  for(const id of ids)visit(id);
  return {properties:{...properties},order,conditions};
}

export function observeUserConditions(trace,relation,spec,at){
  if(!spec)return {order:null,customConditions:null,properties:{}};
  const memory=keyMemory(trace,{maxStringBytes:4096}),properties=Object.create(null);
  function read(p,n){
    const s=p.source,range=s.kind==='field'?(n.range&&s.offset+s.size<=n.range.size?{objectId:n.range.objectId,offset:n.range.offset+s.offset,size:s.size}:null):
      s.kind==='slot'?{objectId:s.objectId,offset:s.offset,size:s.size}:integer(n.index)&&n.index<s.count?{objectId:s.objectId,offset:s.offset+n.index*s.stride,size:s.size}:null;
    if(!range)return {payload:null,value:null,keyRange:null,valueExecutionId:null};
    if(p.domain==='string'){
      const result=memory.key({domain:'nul-terminated-bytes',storage:p.storage},range,at);
      return {payload:result?.payload??null,value:result?.value??null,keyRange:result?.range??range,valueExecutionId:result?.writer??null,
        ...(result?.referenceExecutionId?{referenceExecutionId:result.referenceExecutionId}:{})};
    }
    const snapshot=memory.snapshot(range,at),payload=scalarFromBytes(snapshot?.bytes,{sizeBits:range.size*8,kind:p.domain==='float'?'floating':'integer',signedness:p.signed?'signed':'unsigned'});
    return {payload,value:payload?.value??null,keyRange:range,valueExecutionId:snapshot?.writer??null};
  }
  for(const [name,p]of Object.entries(spec.properties))properties[name]={origin:'user',values:relation.nodes.map(n=>({nodeId:n.id,...read(p,n)}))};
  const order=spec.order?{origin:'user',nodes:relation.nodes.map(n=>({id:n.id,components:spec.order.components.map(p=>read(p,n))})),
    contracts:spec.order.roles.map(r=>({...r,duplicates:r.duplicates==='allow'?'allowed-by-user':r.duplicates==='exclude'?'excluded-by-insertion-rule':'unknown'})),
    keyOrder:spec.order.components.map((p,index)=>({index,direction:p.direction})),composite:true,
    complete:relation.roleIds.length===2&&spec.order.roles.every(r=>relation.roleIds.includes(r.roleId))}:null;
  const customConditions=Object.create(null),values=Object.fromEntries(Object.entries(properties).map(([k,p])=>[k,new Map(p.values.map(v=>[v.nodeId,v]))]));
  for(const c of spec.conditions){
    const violations=[];let unknown=false;
    for(let index=0;index<c.rules.length;index++){
      const r=c.rules[index],roles=r.roleIds??relation.roleIds;
      if(roles.some(id=>!relation.roleIds.includes(id))){unknown=true;continue;}
      const edges=relation.edges.filter(e=>roles.includes(e.roleId));
      if(r.kind==='degree'){
        const counts=new Map();for(const e of edges){const id=r.direction==='in'?e.to:e.from;counts.set(id,(counts.get(id)??0)+1);}
        for(const n of relation.nodes){const count=counts.get(n.id)??0;if(count<r.min&&relation.complete||r.max!==null&&count>r.max)violations.push({code:'user-degree',ruleIndex:index,nodeId:n.id,count,min:r.min,max:r.max});}
      }else if(r.kind==='reciprocal'){
        if(![r.forwardRoleId,r.reverseRoleId].every(id=>relation.roleIds.includes(id))){unknown=true;continue;}
        const reverse=new Set(relation.edges.filter(e=>e.roleId===r.reverseRoleId).map(e=>JSON.stringify([e.from,e.to])));
        for(const e of relation.edges.filter(e=>e.roleId===r.forwardRoleId))if(!reverse.has(JSON.stringify([e.to,e.from]))){
          if(relation.complete)violations.push({code:'user-reciprocal-link',ruleIndex:index,edgeId:e.id,from:e.from,to:e.to});else unknown=true;}
      }else{
        const tests=r.kind==='edge-order'?edges.map(e=>({from:values[r.property].get(e.from),to:values[r.property].get(e.to),edgeId:e.id})):
          relation.nodes.filter(n=>r.scope!=='roots'||relation.rootNodeIds.includes(n.id)).map(n=>({from:values[r.property].get(n.id),to:{payload:literal(r.value,spec.properties[r.property].domain)}}));
        for(const pair of tests){const {sign}=comparePayload(pair.from?.payload,pair.to?.payload);
          if(sign===null){unknown=true;continue;}if(!accepts(sign,r.operator))violations.push({code:`user-${r.kind}`,ruleIndex:index,property:r.property,operator:r.operator,
            nodeId:pair.from?.nodeId,edgeId:pair.edgeId,actual:pair.from?.value,other:pair.to?.value??pair.to?.payload?.value,
            evidenceExecutionIds:unique([pair.from?.valueExecutionId,pair.to?.valueExecutionId].filter(Boolean))});}
      }
    }
    customConditions[c.id]={requires:c.requires,result:{status:violations.length?'violated':unknown||!relation.complete?'incomplete':'satisfied-observed',violations,
      reason:unknown?'missing property or role observations':null,origin:'user'}};
  }
  return {order,customConditions,properties};
}
