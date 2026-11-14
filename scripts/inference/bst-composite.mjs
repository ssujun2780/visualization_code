import {comparisonDiagram,inferLexicographicOrder,comparisonOperation} from './bst-key-order.mjs';
import {scalarPayload,comparePayload,numericType} from './scalar-domain.mjs';
import {addressSelectionControls} from './address-selection-controls.mjs';
const signOf=(query,key)=>comparePayload(query.keyPayload??scalarPayload(query.value),key.keyPayload??scalarPayload(key.value)).sign;
const unique=a=>[...new Set(a)],rels=new Set(['<','<=','>','>=','==','!=']);
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;

// Recover symbolic routing predicates from exact dynamic values AND the
// branches controlling those values, including constant early returns.
export function compositeProofs({plan,events,byEvent,pos,defs,valueFlow,linkSlots,descriptor,keyRange,movement,origin,integer,expression,firstInput,maxProofs}){
  const paths=[];
  for(const e of events){
    const found=linkSlots.get(e.target&&`${e.target.objectId}:${e.target.offset}:${e.target.size}`);
    if(!found||!['READ','WRITE'].includes(e.kind))continue;
    const link={...found,event:e};
    const routing=addressSelectionControls(e,valueFlow);
    for(const branchId of [...routing].sort((a,b)=>pos.get(b)-pos.get(a))){
      const branch=byEvent.get(branchId);if(!['branch','conditional'].includes(branch?.action))continue;
      const components=new Map(),guards=[],guardIds=new Set([branchId]),usedGuards=new Set(),calcs=new Set();let failed=false;
      function contexts(x){for(const id of x.contexts??[])if(!guardIds.has(id)){guardIds.add(id);guards.push(id);}}
      function reduce(x){
        if(!x)return null;
        if(x.unknown)return {unknown:true};
        if(x.reads){if(!x.derived)return null;contexts(x);return reduce(x.derived);}
        contexts(x);if(x.eventId)calcs.add(x.eventId);
        if(x.literal!==undefined)return {literal:String(x.literal)};
        const [a,b]=x.args??[];
        if(rels.has(x.op)&&a?.reads&&b?.reads){
          const da=descriptor(a,link,pos.get(e.eventId)),db=descriptor(b,link,pos.get(e.eventId));
          if(!!da!==!!db){
            const d=da??db,other=da?b:a,k=(da?a:b).reads.find(r=>same(r.target,keyRange(d,link.node))),q=other.event,id=origin(other);
            if(!k||!id||signOf(q,k)===null)return null;
            const old=components.get(d.id);if(old&&old.query.id!==id)return null;
            components.set(d.id,{descriptor:d,keyRead:k,query:{id,read:q,reads:other.reads}});
            return {op:x.op,args:da?[{literal:'0'},{component:d.id}]:[{component:d.id},{literal:'0'}]};
          }
        }
        const args=(x.args??[]).map(reduce);return args.length&&args.every(Boolean)?{op:x.op,args}:null;
      }
      const producer=firstInput(branch),truth=integer(branch.condition),tree=expression(producer);
      let predicate=reduce(tree);if(!predicate||truth===null)continue;
      predicate={op:truth!==0n?'!=':'==',args:[predicate,{literal:'0'}]};
      for(const id of routing)if(id!==branchId&&!guardIds.has(id)){guardIds.add(id);guards.push(id);}
      // Only control predicates which contributed to the compared result are
      // followed. A key's initialization is not a comparison dependency.
      for(let i=0;i<guards.length;i++){
        if(i>=64){valueFlow.reportLimit?.('comparator-control-depth',64,e.eventId);failed=true;break;}
        const guard=byEvent.get(guards[i]);if(!['branch','conditional'].includes(guard?.action))continue;
        const savedComponents=new Map(components),savedCalcs=new Set(calcs),before=components.size,
          g=reduce(expression(firstInput(guard))),value=integer(guard.condition);
        function discard(){components.clear();for(const [id,c]of savedComponents)components.set(id,c);
          calcs.clear();for(const id of savedCalcs)calcs.add(id);}
        if(!g||value===null){
          // Pointer/null and loop guards do not define an integer key. An
          // opaque scalar policy inside a called comparator cannot be ignored.
          if(components.size!==before||guard.activationId!==e.activationId&&(guard.dataInputs??[]).some(id=>valueFlow.dependencyReads(id).some(r=>
            numericType(r.value?.cType))))failed=true;
          discard();
          continue;
        }
        if(!containsComponent(g)){discard();continue;}
        usedGuards.add(guard.eventId);
        predicate={op:'&&',args:[predicate,{op:value!==0n?'!=':'==',args:[g,{literal:'0'}]}]};
      }
      if(failed||!components.size)continue;
      const list=[...components.values()],representative=list.at(-1),transfer=movement(e,link,representative.query,representative.keyRead,representative.descriptor);
      if(!transfer||transfer.kind==='insertion'&&list.some(c=>!movement(e,link,c.query,c.keyRead,c.descriptor)))continue;
      const actual=new Map(list.map(c=>[c.descriptor.id,BigInt(signOf(c.query.read,c.keyRead))]));
      if(evaluate(predicate,actual)!==1n)continue;
      paths.push({components:list,predicate,proof:{afterExecutionId:transfer.executionId,comparisonExecutionId:producer?.executionId,
        branchExecutionId:branchId,calculationExecutionIds:[...calcs],keyReadExecutionId:representative.keyRead.eventId,
        queryReadExecutionId:representative.query.read.eventId,linkExecutionId:e.eventId,transferExecutionId:transfer.executionId,
        callExecutionId:transfer.callExecutionId??null,kind:transfer.kind,roleId:link.role.id,keyRange:representative.keyRead.target,linkRange:e.target,
        ...(transfer.transferStringKey?{transferStringKey:transfer.transferStringKey}:{}),
        guardExecutionIds:[...usedGuards],componentReads:list.map(c=>({componentId:c.descriptor.id,keyReadExecutionId:c.keyRead.eventId,
          queryReadExecutionId:c.query.read.eventId,keyRange:c.keyRead.target,
          ...c.keyRead.stringKey?{stringComparison:{key:c.keyRead.stringKey,query:c.query.read.stringKey}}:{}})),
        ...representative.keyRead.stringKey?{stringComparison:{key:representative.keyRead.stringKey,query:representative.query.read.stringKey}}:{},predicate}});
      break;
    }
  }
  // Connected sets of comparison operands, never field names, declaration
  // order, or equal numeric samples. Independent keys remain separate.
  const parent=new Map();const root=id=>parent.get(id)===id?id:root(parent.get(id));
  for(const p of paths){const ids=p.components.map(c=>c.descriptor.id);for(const id of ids)if(!parent.has(id))parent.set(id,id);
    for(const id of ids)parent.set(root(id),root(ids[0]));}
  const clusters=new Map();for(const id of parent.keys()){const r=root(id);if(!clusters.has(r))clusters.set(r,[]);clusters.get(r).push(id);}
  const groups=[];
  for(const ids of clusters.values()){
    if(ids.length<2)continue;ids.sort();const matching=paths.filter(p=>ids.includes(p.components[0].descriptor.id)),descriptors=new Map();
    for(const p of matching)for(const c of p.components){const {read,...d}=c.descriptor;descriptors.set(d.id,d);}
    const components=ids.map(id=>descriptors.get(id)),roles=unique(matching.map(p=>p.proof.roleId)).sort(),proofs=[];
    for(const p of matching){if(proofs.some(q=>q.linkExecutionId===p.proof.linkExecutionId&&q.branchExecutionId===p.proof.branchExecutionId))continue;
      const zeros=new Map(ids.map(id=>[id,0n])),equal=p.components.length===ids.length&&p.components.every(c=>signOf(c.query.read,c.keyRead)===0);
      // Equality may be encountered at an ancestor before inserting farther
      // down that subtree. Tie the later insertion to the SAME query storage.
      const continued=equal&&p.proof.kind!=='insertion'?matching.find(q=>q.proof.kind==='insertion'&&
        pos.get(q.proof.linkExecutionId)>pos.get(p.proof.linkExecutionId)&&byEvent.get(q.proof.linkExecutionId).activationId===byEvent.get(p.proof.linkExecutionId).activationId&&
        p.components.every(c=>q.components.some(other=>other.descriptor.id===c.descriptor.id&&other.query.id===c.query.id))):null;
      proofs.push({...p.proof,direction:roles.indexOf(p.proof.roleId)===0?'less':'greater',
        allowsEqual:evaluate(p.predicate,zeros)===1n,equalInsertion:equal&&(p.proof.kind==='insertion'||!!continued),
        ...(continued?{afterExecutionId:continued.proof.linkExecutionId,equalityInsertionExecutionId:continued.proof.linkExecutionId}:{} )});}
    proofs.sort((a,b)=>pos.get(a.afterExecutionId)-pos.get(b.afterExecutionId));
    const omitted=proofs.length>maxProofs?proofs[maxProofs].afterExecutionId:null,kept=proofs.slice(0,maxProofs);
    for(const p of kept)if(p.equalityInsertionExecutionId&&!kept.some(q=>q.kind==='insertion'&&q.linkExecutionId===p.equalityInsertionExecutionId)){
      p.afterExecutionId=p.transferExecutionId;p.equalInsertion=false;delete p.equalityInsertionExecutionId;
    }
    groups.push({key:{id:`composite:${ids.join('|')}`,kind:'composite',components},proofs:kept,
      omittedProofs:Math.max(0,proofs.length-maxProofs),firstOmittedProofExecutionId:omitted,
      orderAt(observed){
        try{
          if(roles.length!==2)return {order:null,reason:'comparison routing needs exactly two child roles'};
          const seen=new Set(observed.flatMap(p=>p.componentReads.map(c=>c.componentId)));
          if(ids.some(id=>!seen.has(id)))return {order:null,reason:'key components not yet observed'};
          const diagram=comparisonDiagram();let route=diagram.unknown;
          function build(x){if(x.unknown)return diagram.unknown;if(x.literal!==undefined)return diagram.constant(BigInt(x.literal));
            if(x.component)return diagram.variable(ids.indexOf(x.component));
            return diagram.operation(x.op,x.args.map(build));}
          for(const p of observed){const label=roles.indexOf(p.roleId)===0?-1n:1n,
            selected=diagram.apply(`route:${label}`,[build(p.predicate)],v=>v===1n?label:null);
            route=diagram.apply('union',[route,selected],(a,b)=>a===null?b:b===null?a:a===b?a:2n);}
          const order=inferLexicographicOrder(diagram,route,ids.map((_,i)=>i));
          return {order,reason:order?null:'comparison paths do not establish one lexicographic order'};
        }catch(error){if(error instanceof RangeError){valueFlow.reportLimit?.('comparator-diagram',8192,observed.at(-1)?.afterExecutionId);return {order:null,reason:error.message};}throw error;}
      }});
  }
  return groups;
}
function containsComponent(x){return !!x.component||x.args?.some(containsComponent);}
function evaluate(x,values){if(x.unknown)return null;if(x.literal!==undefined)return BigInt(x.literal);if(x.component)return values.get(x.component)??null;
  return comparisonOperation(x.op,...x.args.map(a=>evaluate(a,values)));}
