// Pure conditions over logical relations. Storage representation is irrelevant.
import {topology} from '../shared/topology.mjs';
import {compareKeyValues} from './bst-key-order.mjs';
import {semanticCondition} from './semantic-relations.mjs';
const result=(status,violations=[],reason=null,details={})=>({status,violations,reason,...details});
const good=()=>result('satisfied-observed');
const incomplete=reason=>result('incomplete',[],reason);

// Used both while recording BST semantics and by composed queries. Actual key
// values and comparison contracts are supplied by the observation adapter.
export function checkBSTOrder({relation,nodes,contracts,keyOrder=[{index:0,direction:1}],composite=false,complete=true,unsupported=false,conflict=false}){
  if(!relation.alive)return result('ended');
  if(conflict||unsupported||!keyOrder)return result('not-checkable');
  const top=relation.topology,topologyOK=!!top&&!top.cyclic&&!top.sharedChildren?.length&&
    (top.rootNodeId||top.roots?.length===1)&&!['partial','unknown'].includes(top.status);
  if(!complete||!relation.complete||!topologyOK||nodes.some(n=>(n.components??[n]).some(c=>c.value===null)))return incomplete('missing relation, role or key evidence');
  let status='satisfied-observed';const violations=[],byId=new Map(nodes.map(n=>[n.id,n])),out=new Map();
  for(const e of relation.edges){if(!out.has(e.from))out.set(e.from,[]);out.get(e.from).push(e);}
  const stack=[{id:top.rootNodeId??top.roots[0],bounds:[],path:[]}],seen=new Set();
  while(stack.length){const item=stack.pop(),n=byId.get(item.id);if(!n||seen.has(item.id))continue;seen.add(item.id);
    for(const bound of item.bounds){const compared=compareKeyValues(composite?n.value:[n.value],composite?bound.value:[bound.value],keyOrder),
        bad=bound.direction==='less'?compared.sign>0:compared.sign<0,equal=compared.sign===0;
      if(bad||equal&&bound.duplicates==='excluded-by-insertion-rule')violations.push({code:'bst-ancestor-order',nodeId:n.id,ancestorId:bound.ancestorId,
        roleId:bound.roleId,direction:bound.direction,value:n.value,bound:bound.value,
        keyRange:n.components?.[compared.componentIndex??0].keyRange??n.keyRange,
        valueExecutionId:n.components?.[compared.componentIndex??0].valueExecutionId??n.valueExecutionId,
        ...(composite?{componentIndex:compared.componentIndex}:{}),path:[...item.path,n.id]});
      else if(equal&&bound.duplicates==='unknown')status='incomplete';}
    for(const edge of out.get(n.id)??[]){const contract=contracts.find(c=>c.roleId===edge.roleId);
      if(!contract){status='incomplete';continue;}
      stack.push({id:edge.to,bounds:[...item.bounds,{...contract,ancestorId:n.id,value:n.value}],path:[...item.path,n.id]});}
  }
  return result(violations.length?'violated':status,violations);
}
function shape(relation,{singleRoot=false,binary=false,chain=false,dag=false}={}){
  if(!relation.alive)return result('ended');
  if(relation.historyGap||relation.roleComplete===false)return incomplete('missing state history or selected relation roles');
  const ids=new Set(relation.nodes.map(n=>n.id));
  if(ids.size!==relation.nodes.length||relation.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)))return incomplete('unresolved relation identities');
  const t=topology(relation.nodes,relation.edges),incoming=new Map(),outgoing=new Map(),violations=[];
  for(const e of relation.edges){incoming.set(e.to,(incoming.get(e.to)??0)+1);outgoing.set(e.from,(outgoing.get(e.from)??0)+1);}
  if(t.cyclic)violations.push({code:'relation-cycle'});
  if(!dag)for(const [id,n]of incoming)if(n>1)violations.push({code:'multiple-parents',nodeId:id});
  if(singleRoot&&relation.complete&&ids.size&&t.roots.length!==1)violations.push({code:'root-count',rootNodeIds:t.roots});
  if(singleRoot&&relation.complete&&ids.size&&relation.rootNodeIds.length&&
    (relation.rootNodeIds.length!==1||relation.rootNodeIds[0]!==t.roots[0]))violations.push({code:'root-identity'});
  for(const [id,n]of outgoing)if(binary&&n>2||chain&&n>1)violations.push({code:chain?'multiple-successors':'binary-child-count',nodeId:id});
  // Missing history may contain a repair; do not report stale violations.
  if(relation.historyGap)return incomplete('state history limit');
  if(violations.length)return result('violated',violations);
  return relation.complete?good():incomplete('unobserved links or role boundaries');
}
function traversal(relation){
  const children=new Map(relation.nodes.map(n=>[n.id,[]]));for(const e of relation.edges)children.get(e.from).push(e.to);
  const incoming=new Set(relation.edges.map(e=>e.to)),roots=relation.nodes.filter(n=>!incoming.has(n.id)).map(n=>n.id),order=[],pending=[...roots];
  while(pending.length){const id=pending.pop();order.push(id);pending.push(...children.get(id));}
  return {children,roots,postorder:order.reverse()};
}
function balance(relation,properties){
  const {children,postorder}=traversal(relation),heights=new Map(),violations=[],cacheViolations=[];let cacheUnknown=false;
  for(const id of postorder){const hs=children.get(id).map(c=>heights.get(c));while(hs.length<2)hs.push(0);
    const h=1+Math.max(...hs);heights.set(id,h);
    if(Math.abs(hs[0]-hs[1])>1)violations.push({code:'avl-height-difference',nodeId:id,childHeights:hs});
    if(properties.height){const observed=properties.height.values.find(v=>v.nodeId===id);
      if(observed?.value===null||!observed)cacheUnknown=true;
      else if(BigInt(observed.value)!==BigInt(h+(properties.height.leafHeight??1)-1))cacheViolations.push({code:'stored-height-mismatch',nodeId:id,
        actual:observed.value,expected:String(h+(properties.height.leafHeight??1)-1),range:observed.range,evidenceExecutionIds:observed.evidenceExecutionIds});}}
  return result(violations.length?'violated':'satisfied-observed',violations,null,{heights:Object.fromEntries(heights),
    ...(properties.height?{storedHeightCheck:result(cacheViolations.length?'violated':cacheUnknown?'incomplete':'satisfied-observed',cacheViolations)}:{})});
}
function redBlack(relation,properties){
  const color=properties.color;if(!color)return result('not-checkable',[],'colour role and red/black encoding are not established');
  const {children,roots,postorder}=traversal(relation),values=new Map(color.values.map(v=>[v.nodeId,v])),colors=new Map(),violations=[];
  let unknown=false;
  for(const n of relation.nodes){const v=values.get(n.id);if(v?.value===null||!v){unknown=true;continue;}
    if(v.value===color.redValue)colors.set(n.id,'red');else if(v.value===color.blackValue)colors.set(n.id,'black');
    else violations.push({code:'red-black-invalid-color',nodeId:n.id,value:v.value,range:v.range,evidenceExecutionIds:v.evidenceExecutionIds});}
  for(const id of relation.terminalNodeIds){const v=values.get(id);if(!v||v.value===null)unknown=true;
    else if(v.value!==color.blackValue)violations.push({code:'red-black-terminal-color',nodeId:id,value:v.value,range:v.range,evidenceExecutionIds:v.evidenceExecutionIds});}
  for(const id of roots)if(colors.get(id)==='red')violations.push({code:'red-black-root-color',nodeId:id});
  for(const e of relation.edges)if(colors.get(e.from)==='red'&&colors.get(e.to)==='red')violations.push({code:'red-black-red-child',nodeId:e.to,parentId:e.from});
  const blackHeights=new Map();
  for(const id of postorder){const hs=children.get(id).map(c=>blackHeights.get(c));while(hs.length<2)hs.push(1);
    if(hs.some(h=>h===null||h===undefined)||!colors.has(id)){blackHeights.set(id,null);continue;}
    if(hs[0]!==hs[1]){violations.push({code:'red-black-black-height',nodeId:id,childBlackHeights:hs});blackHeights.set(id,null);}
    else blackHeights.set(id,hs[0]+(colors.get(id)==='black'?1:0));}
  return result(violations.length?'violated':unknown?'incomplete':'satisfied-observed',violations,
    unknown?'unobserved colour values':null,{blackHeights:Object.fromEntries(blackHeights)});
}
// Dependencies describe composition, not an exclusive type hierarchy.
const definitions={
  graph:{requires:[],check:c=>!c.relation.alive?result('ended'):c.relation.complete?good():incomplete('unobserved relations')},
  dag:{requires:[],check:c=>shape(c.relation,{dag:true})},
  forest:{requires:[],check:c=>shape(c.relation)},
  tree:{requires:['forest'],check:c=>shape(c.relation,{singleRoot:true})},
  chain:{requires:['forest'],check:c=>shape(c.relation,{singleRoot:true,chain:true})},
  'binary-tree':{requires:['tree'],check:c=>shape(c.relation,{binary:true})},
  'bst-order':{requires:['binary-tree'],check:c=>c.order?checkBSTOrder({...c.order,relation:c.relation}):result('not-checkable',[],'key and comparison roles are not established')},
  'avl-balance':{requires:['binary-tree'],check:c=>balance(c.relation,c.properties)},
  avl:{requires:['bst-order','avl-balance'],check:good},
  'red-black-rules':{requires:['binary-tree'],check:c=>redBlack(c.relation,c.properties)},
  'red-black':{requires:['bst-order','red-black-rules'],check:good},
};
for(const id of ['min-heap','max-heap','disjoint-set','segment-tree','fenwick-tree','range-aggregate','queue','stack','deque','array-membership','hash-table','trie'])
 definitions[id]={requires:[],check:c=>semanticCondition(c.relation,id,c.properties)};
export const STRUCTURE_CONDITIONS=Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id,d])=>[id,Object.freeze({requires:Object.freeze([...d.requires])})])));
export function evaluateStructureConditions(relation,{expected,order=null,properties={}}={}){
  const checks=[],done=new Map();
  function visit(id){if(done.has(id))return done.get(id);const d=definitions[id];
    if(!d){const r={conditionId:id,...result('not-checkable',[],'unsupported structure condition'),requires:[]};done.set(id,r);checks.push(r);return r;}
    const dependencies=d.requires.map(visit),blocked=dependencies.filter(r=>r.status!=='satisfied-observed');
    const state=blocked.length?result(blocked.some(r=>r.status==='ended')?'ended':blocked.some(r=>r.status==='violated')?'violated':
      blocked.some(r=>r.status==='incomplete')?'incomplete':'not-checkable',[],'required conditions are not satisfied',
      {blockedBy:blocked.map(r=>r.conditionId)}):d.check({relation,order,properties});
    const r={conditionId:id,requires:[...d.requires],...state};done.set(id,r);checks.push(r);return r;
  }
  const final=visit(expected);
  return {expected,status:final.status,assessment:final.status==='violated'?'contradicted':final.status,checks,
    warnings:checks.flatMap(c=>[...c.violations.map(v=>({...v,conditionId:c.conditionId,category:'structure-expectation'})),
      ...c.storedHeightCheck?.violations.map(v=>({...v,conditionId:'stored-height',category:'structure-expectation'}))??[]]),intent:'unconfirmed'};
}
