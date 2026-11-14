import {stateHistoryCoverage,appendStateSnapshot,structureStateAt,stateHistoryGapAt} from './state-history.mjs';
// Optional, read-only semantics over recorded comparisons and existing trees.
// No user code is evaluated, no source names are interpreted, and no IR is added.
import {structureTouches,structureRootRange} from './structure-storage.mjs';
import {compositeProofs} from './bst-composite.mjs';
import {projectStructureRelation} from './structure-relations.mjs';
import {checkBSTOrder} from './structure-conditions.mjs';
import {scalarPayload,comparePayload,numericType,scalarFromBytes,preservesNumericOrder} from './scalar-domain.mjs';
import {keyMemory,isByteKey} from './key-memory.mjs';
import {createStringComparisonReader} from './string-comparison.mjs';
import {structureQueryContext} from './query-index.mjs';
import {addressSelectionControls} from './address-selection-controls.mjs';
const payload=read=>read.keyPayload??scalarPayload(read.value);
const unique=a=>[...new Set(a)],slot=r=>r&&`${r.objectId}:${r.offset}:${r.size}`;
const same=(a,b)=>slot(a)===slot(b);
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const integer=v=>{try{const x=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed)??v?.literal;
  return x===undefined?null:BigInt(x);}catch{return null;}};
const scalar=numericType;
const rels=new Set(['<','<=','>','>=','==','!=']);
function arithmetic(op,a,b){
  if(op==='<')return a<b?1n:0n;if(op==='<=')return a<=b?1n:0n;if(op==='>')return a>b?1n:0n;if(op==='>=')return a>=b?1n:0n;
  if(op==='==')return a===b?1n:0n;if(op==='!=')return a!==b?1n:0n;
  if(op==='-')return b===undefined?-a:a-b;if(op==='+')return a+b;if(op==='!')return a===0n?1n:0n;
  if(op==='&&')return a!==0n&&b!==0n?1n:0n;if(op==='||')return a!==0n||b!==0n?1n:0n;
  return null;
}

export function bstStructures(plan,trace,{maxStates=2048,maxProofs=4096}={}){
  const {events,objects,structures,valueFlow}=trace,byEvent=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),observations=new Map(),arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),
    work=structures.find(s=>s.kind==='array-work'),access=new Map((work?.accesses??[]).map(a=>[a.executionId,a])),
    coindices=structures.find(s=>s.kind==='storage-dependencies')?.coindexed??[],memory=keyMemory(trace),strings=new Map();
  const stringComparison=createStringComparisonReader(plan,trace,valueFlow,memory);
  for(const e of events)if(e.action==='resume'){const c=stringComparison(e);if(c)strings.set(e.eventId,c);}
  const keyAccesses=events.flatMap(ev=>strings.has(ev.eventId)?[ev,...strings.get(ev.eventId).args.map(a=>a.event)]:[ev]);
  const activationEvents=new Map(),parametersByCall=new Map(),keyAccessesBySlot=new Map(),accessesBySlot=new Map(),readCache=new Map(),inputCache=new Map(),expressionCache=[new WeakMap(),new WeakMap()];
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
  for(const e of events){
    if(e.kind==='WRITE'||e.kind==='FLOW')add(activationEvents,e.activationId,e);
    if(e.kind==='WRITE'&&e.action==='argument')add(parametersByCall,e.callExecutionId,e);
    if(['READ','WRITE'].includes(e.kind)&&e.target)add(accessesBySlot,slot(e.target),e);
  }
  for(const e of keyAccesses)if(e.target)add(keyAccessesBySlot,slot(e.target),e);
  for(const e of events){for(const id of e.observationIds??[])observations.set(id,{event:e});
    for(const step of e.steps??[])for(const id of unique([step.observationId,...step.observationIds??[]].filter(Boolean)))observations.set(id,{event:e,step});}
  const reads=id=>{if(!readCache.has(id))readCache.set(id,valueFlow.reads(id));return readCache.get(id);},typeOf=e=>e?.value?.cType??defs.get(e?.instructionId)?.cType;
  const firstInput=e=>{if(!inputCache.has(e.eventId))inputCache.set(e.eventId,e.inputs?.[0]??(e.dataInputs?.length===1?{executionId:e.dataInputs[0]}:null));return inputCache.get(e.eventId);};
  const observedExpression=(input,path=false)=>{
    if(!input)return null;const cache=expressionCache[Number(path)];
    if(!cache.has(input))cache.set(input,expression(input,0,new Set(),path));return cache.get(input);
  };
  // Follow exact producer identities through copies/returns and internal CALC
  // observations. Only operations on comparison results/constants are reduced.
  function expression(input,depth=0,seen=new Set(),path=false){
    if(!input||depth>32)return null;
    const observed=observations.get(input.observationId),e=observed?.event??byEvent.get(input.executionId);
    if(!e){const n=integer(input.value);return n===null?null:{literal:n};}
    const step=observed?.step,key=`${e.eventId}:${step?e.steps.indexOf(step):'event'}`;
    if(seen.has(key))return null;seen=new Set(seen).add(key);
    if(step)return operation(step,e,depth,seen,path);
    const chain=valueFlow.chain(e.eventId),calc=chain.find(x=>x.kind==='CALC');
    const string=chain.map(x=>strings.get(x.eventId)).find(Boolean);
    if(string)return {...string,...path?{contexts:unique(chain.filter(x=>x.kind==='CALC'||x.action==='return.value').flatMap(x=>x.controlInputs??[]))}:{}};
    if(path){
      const contexts=unique(chain.filter(x=>x.kind==='CALC'||x.action==='return.value').flatMap(x=>x.controlInputs??[]));
      const tail=chain.at(-1),literal=tail?.kind==='WRITE'&&!tail.dataInputs?.length?integer(tail.value):null;
      const ast=calc&&defs.get(calc.instructionId)?.expression;
      const logical=ast&&hasLogical(ast);
      const derived=calc?(logical?astExpression(ast,calc,depth+1,seen):operation(calc.steps?.at(-1)??calc,calc,depth+1,seen,path)):literal!==null?{literal}:null;
      if(e.kind==='READ'&&scalar(typeOf(e)))return {reads:reads(e.eventId),event:e,derived,contexts};
      if(derived)return {...derived,contexts:unique([...derived.contexts??[],...contexts])};
    }
    if(e.kind==='READ'&&scalar(typeOf(e)))return {reads:reads(e.eventId),event:e,
      derived:calc?operation(calc.steps?.at(-1)??calc,calc,depth+1,seen):null};
    if(calc)return operation(calc.steps?.at(-1)??calc,calc,depth,seen);
    const read=chain.find(x=>x.kind==='READ');
    if(read&&scalar(typeOf(read)))return {reads:reads(read.eventId),event:read};
    const tail=chain.at(-1);
    if(tail?.kind==='WRITE'&&!tail.dataInputs?.length){const n=integer(tail.value);if(n!==null)return {literal:n};}
    return null;
  }
  function hasLogical(node){return ['&&','||'].includes(node.operator)||node.children?.some(hasLogical);}
  function astExpression(node,e,depth,seen){
    if(!node||depth>32)return {unknown:true};
    if(['ParenExpr','ImplicitCastExpr'].includes(node.kind)&&node.children?.length===1)return astExpression(node.children[0],e,depth+1,seen);
    if(['&&','||'].includes(node.operator))return {op:node.operator,args:node.children.map(n=>astExpression(n,e,depth+1,seen)),eventId:e.eventId,contexts:e.controlInputs??[]};
    const step=e.steps?.find(s=>s.nodeId===node.nodeId);
    if(step)return operation(step,e,depth,seen,true)??{unknown:true};
    if(node.kind==='IntegerLiteral')return {literal:BigInt(node.literal)};
    // A skipped operand has no READ. Never extrapolate the compiler's selected
    // phi constant to other hypothetical comparison outcomes.
    return {unknown:true};
  }
  function operation(step,e,depth,seen,path=false){
    if(step.kind==='folded-expression'&&integer(step.value)!==null)return {literal:integer(step.value),...path?{contexts:e.controlInputs??[]}:{}};
    const op=step.conversion?'cast':step.operator??defs.get(e.instructionId)?.operator,inputs=step.inputs??e.inputs??[];
    if(path&&['&&','||'].includes(op)){
      function find(n){return n?.nodeId===step.nodeId?n:n?.children?.map(find).find(Boolean);}
      const node=find(defs.get(e.instructionId)?.expression);
      if(node)return astExpression(node,e,depth,seen);
    }
    if(op==='cast'){
      if(inputs.length!==1)return null;
      const value=expression(inputs[0],depth+1,seen,path),from=step.conversion?.fromType??inputs[0].value?.cType,to=step.conversion?.toType??step.value?.cType;
      const widening=preservesNumericOrder(from,to);
      return widening||value?.op&&rels.has(value.op)?value:null;
    }
    if(!['<','<=','>','>=','==','!=','-','+','!','truth','&&','||'].includes(op)||inputs.length<1||inputs.length>2)return null;
    const args=inputs.map(i=>expression(i,depth+1,seen,path));
    if(['truth','!'].includes(op)&&args[0]?.op==='strcmp')return {op:op==='truth'?'!=':'==',args:args[0].args,eventId:e.eventId,
      ...path?{contexts:unique([...(e.controlInputs??[]),...(args[0].contexts??[])])}:{}};
    if(rels.has(op))for(let side=0;side<2;side++)if(args[side]?.op==='strcmp'){
      if(args[1-side]?.literal!==0n)return null;
      const compared=args[side];return {op,args:side?[...compared.args].reverse():compared.args,eventId:e.eventId,
        comparison:compared.comparison,...path?{contexts:unique([...(e.controlInputs??[]),...(compared.contexts??[])])}:{}};
    }
    return args.every(Boolean)?{op,args,eventId:e.eventId,...path?{contexts:e.controlInputs??[]}:{}}:null;
  }
  function leaves(x){return !x?[]:x.reads?[x,...leaves(x.derived)]:x.args?.flatMap(leaves)??[];}
  function producers(x){return !x?[]:[...(x.eventId?[x.eventId]:[]),...x.args?.flatMap(producers)??[],...producers(x.derived)];}
  function origin(x){const r=x.reads.at(-1);return r?`${slot(r.target)}:${r.dataInputs?.join(',')}`:null;}
  const sourceTrees=structures.filter(s=>s.kind==='linked-structure'||s.kind==='rooted-index-structure'&&s.roleIds.length===2),result=[];
  for(const source of sourceTrees){
    const pointer=source.kind==='linked-structure',sourceNodes=new Map(source.logicalNodes.map(n=>[n.id,n])),
      roles=pointer?(source.roles??[]).map(r=>({id:r.fieldNodeId,offset:r.offset,size:r.size,type:r.recordTypeId})):source.roleIds.map(id=>({id})),
      linkSlots=new Map(),nodeList=[...sourceNodes.values()],groups=new Map();
    if(roles.length<2)continue;
    for(const n of nodeList)for(const r of roles){
      let range;if(pointer){if(n.recordTypeId!==r.type)continue;range={objectId:n.objectId,offset:n.offset+r.offset,size:r.size};}
      else{const a=arrays.get(r.id);if(a)range={objectId:a.objectId,offset:a.range.offset+n.index*a.elementBytes,size:a.elementBytes};
        else{const relation=structures.find(s=>s.id===source.relationStructureId),f=relation?.relations?.find(f=>f.id===r.id)?.field;
          if(f)range={objectId:n.objectId,offset:n.offset+f.offset,size:f.size};}}
      if(range)linkSlots.set(slot(range),{node:n,role:r,range});
    }
    if(!linkSlots.size)continue;
    function descriptor(atom,link,at){
      for(const read of atom.reads){if(!scalar(typeOf(read))&&!read.stringKey||!read.target)continue;
        if(pointer||!arrays.has(link.role.id)){
          const n=link.node,r=read.target;
          if(r.objectId===n.objectId&&r.offset>=n.offset&&r.offset+r.size<=n.offset+n.size&&!same(r,link.range))
            return {id:`record:${n.recordTypeId??source.relationStructureId}:${r.offset-n.offset}:${r.size}`,kind:'record',offset:r.offset-n.offset,size:r.size,
              cType:typeOf(read),read,recordTypeId:n.recordTypeId??null,...read.stringKey?{domain:read.stringKey.domain,byteLimit:read.stringKey.byteLimit,storage:read.stringKey.storage}: {}};
        }else{
          const a=access.get(read.eventId),b=access.get(link.event.eventId);
          if(a?.target.index!==link.node.index||a.target.elementOffset!==0||a.target.size!==a.target.elementBytes||a.target.arrayId===link.role.id)continue;
          const grouped=coindices.some(p=>p.accessExecutionIds.includes(read.eventId)&&p.accessExecutionIds.includes(link.event.eventId)&&
            pos.get(read.eventId)<=at&&pos.get(link.event.eventId)<=at);
          // A WRITE uses its source node's earlier recorded read if needed.
          if(!grouped||!b||b.target.index!==a.target.index)continue;
          const array=arrays.get(a.target.arrayId);if(!array)continue;
          return {id:`array:${array.id}`,kind:'array',arrayId:array.id,range:array.range,size:array.elementBytes,cType:typeOf(read),read,
            ...read.stringKey?{domain:read.stringKey.domain,byteLimit:read.stringKey.byteLimit,storage:read.stringKey.storage}: {}};
        }
      }
      return null;
    }
    function keyRange(d,n){return d.kind==='record'?{objectId:n.objectId,offset:n.offset+d.offset,size:d.size}:
      {objectId:d.range.objectId,offset:d.range.offset+n.index*d.size,size:d.size};}
    function reduce(tree,d,link){
      const current=keyRange(d,link.node);let query=null,keyRead=null,unknown=false;
      function evalAt(x,sign){
        if(x.literal!==undefined)return x.literal;
        if(x.reads)return x.derived?evalAt(x.derived,sign):null;
        if(!x.op)return null;
        const [a,b]=x.args;
        if(rels.has(x.op)&&a?.reads&&b?.reads){
          const ak=a.reads.find(r=>same(r.target,current)),bk=b.reads.find(r=>same(r.target,current));
          if(!!ak===!!bk)return null;
          const other=ak?b:a,id=origin(other);if(!id||query&&query.id!==id)return null;
          // Identity provenance must survive any compiler integer conversions.
          const k=ak??bk,q=other.event;
          if(comparePayload(payload(k),payload(q)).sign===null)return null;
          query={id,read:q,reads:other.reads};keyRead=k;
          return arithmetic(x.op,BigInt(ak?0:sign),BigInt(ak?sign:0));
        }
        const args=x.args.map(n=>evalAt(n,sign));if(args.some(n=>n===null))return null;
        return arithmetic(x.op,...args);
      }
      const values=[-1,0,1].map(sign=>evalAt(tree,sign));unknown=values.some(n=>n===null);
      if(unknown||!query||!keyRead)return null;
      return {values,query,keyRead};
    }
    function movement(e,link,query,keyRead,d){
      if(e.kind==='WRITE'){
        const ref=e.value?.reference,child=pointer?
          ref?.status==='in-bounds'&&nodeList.find(n=>n.objectId===ref.targetObjectId&&n.offset===ref.targetOffset):
          nodeList.find(n=>BigInt(n.index)===integer(e.value));
        if(!child||!query.reads.some(r=>same(r.target,keyRange(d,child))))return null;
        return {executionId:e.eventId,kind:'insertion'};
      }
      // Same cursor slot used for the parent address and the next cursor value.
      const addressReads=(e.addressInputs??[]).flatMap(id=>reads(id));
      const cursors=addressReads.filter(r=>pointer?r.value?.reference?.targetObjectId===link.node.objectId&&r.value.reference.targetOffset===link.node.offset:
        integer(r.value)===BigInt(link.node.index));
      const ownEvents=activationEvents.get(e.activationId)??[];let lo=0,hi=ownEvents.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(pos.get(ownEvents[mid].eventId)<=pos.get(e.eventId))lo=mid+1;else hi=mid;}
      for(let i=lo;i<ownEvents.length;i++){
        const next=ownEvents[i];
        if(next.kind==='FLOW'&&['loop.next','return'].includes(next.action))break;
        if(next.kind==='WRITE'&&next.action==='write'&&cursors.some(r=>same(r.target,next.target))&&reads(next.eventId).some(r=>r.eventId===e.eventId))
          return {executionId:next.eventId,kind:'cursor-move'};
        if(next.kind==='FLOW'&&next.action==='call'){
          const passed=(next.inputs??[]).filter(input=>input.executionId&&reads(input.executionId).some(r=>r.eventId===e.eventId));
          if(!passed.length)continue;
          const parameters=(parametersByCall.get(next.eventId)??[]).filter(ev=>
            passed.some(input=>input.parameterIndex===ev.parameterIndex));
          const child=pointer?nodeList.find(n=>n.objectId===e.value?.reference?.targetObjectId&&n.offset===e.value.reference.targetOffset):
            nodeList.find(n=>BigInt(n.index)===integer(e.value));
          if(!child)continue;const expected=keyRange(d,child);
          // Passing a pointer to printf or an unrelated helper is not traversal.
          // Require the actual callee to use that parameter to read a node key.
          const used=(keyAccessesBySlot.get(slot(expected))??[]).find(ev=>(ev.kind==='READ'||ev.stringKey?.storage==='inline')&&parameters.some(arg=>ev.activationId===arg.activationId&&
            (ev.addressInputs??[]).flatMap(id=>valueFlow.dependencyReads(id)).some(r=>valueFlow.chain(r.eventId).some(x=>x.eventId===arg.eventId))));
          if(used)return {executionId:used.eventId,kind:'call-argument',callExecutionId:next.eventId,
            ...(used.stringKey?{transferStringKey:used.stringKey}:{})};
        }
      }
      return null;
    }
    const linkEvents=[...linkSlots.keys()].flatMap(key=>accessesBySlot.get(key)??[]).sort((a,b)=>pos.get(a.eventId)-pos.get(b.eventId));
    for(const e of linkEvents){
      if(!['READ','WRITE'].includes(e.kind)||!e.target)continue;
      const found=linkSlots.get(slot(e.target));if(!found)continue;const link={...found,event:e};
      for(const branchId of addressSelectionControls(e,valueFlow).reverse()){
        const branch=byEvent.get(branchId);if(!branch||!['branch','conditional'].includes(branch.action))continue;
        const producer=firstInput(branch),tree=observedExpression(producer),truth=integer(branch.condition);if(!tree||truth===null)continue;
        for(const atom of leaves(tree)){
          const d=descriptor(atom,link,pos.get(e.eventId));if(!d)continue;const reduced=reduce(tree,d,link);if(!reduced)continue;
          const signs=[-1,0,1].filter((_,i)=>(reduced.values[i]!==0n)===(truth!==0n));
          const direction=signs.includes(-1)&&!signs.includes(1)?'less':signs.includes(1)&&!signs.includes(-1)?'greater':null;
          if(!direction)continue;
          const actual=comparePayload(payload(reduced.query.read),payload(reduced.keyRead)).sign;
          if(actual===null)continue;
          if(!signs.includes(actual))continue;
          const transfer=movement(e,link,reduced.query,reduced.keyRead,d);if(!transfer)continue;
          // A helper may return a secondary comparison only after testing a
          // different key component. That is not a scalar ordering contract.
          const contextualReads=unique(producers(tree).flatMap(id=>byEvent.get(id)?.controlInputs??[]))
            .flatMap(id=>byEvent.get(id)?.dataInputs??[]).flatMap(id=>valueFlow.dependencyReads(id));
          const unsupportedContext=contextualReads.some(read=>{
            const other=descriptor({reads:[read]},link,pos.get(e.eventId));return other&&other.id!==d.id;
          });
          if(!groups.has(d.id)){const {read,...key}=d;groups.set(d.id,{key,proofs:[],omittedProofs:0});}
          const g=groups.get(d.id);if(g.proofs.length>=maxProofs){g.omittedProofs++;g.firstOmittedProofExecutionId??=e.eventId;continue;}
          if(g.proofs.some(p=>p.linkExecutionId===e.eventId&&p.branchExecutionId===branchId))continue;
          g.proofs.push({afterExecutionId:transfer.executionId,comparisonExecutionId:producer?.executionId,branchExecutionId:branchId,
            calculationExecutionIds:unique(producers(tree)),
            keyReadExecutionId:reduced.keyRead.eventId,queryReadExecutionId:reduced.query.read.eventId,linkExecutionId:e.eventId,
            transferExecutionId:transfer.executionId,callExecutionId:transfer.callExecutionId??null,kind:transfer.kind,roleId:link.role.id,direction,allowsEqual:signs.includes(0),unsupportedContext,
            ...(transfer.transferStringKey?{transferStringKey:transfer.transferStringKey}:{}),
            equalInsertion:transfer.kind==='insertion'&&actual===0,keyRange:reduced.keyRead.target,linkRange:e.target,
            ...reduced.keyRead.stringKey?{stringComparison:{key:reduced.keyRead.stringKey,query:reduced.query.read.stringKey}}:{}});
        }
      }
    }
    const composite=compositeProofs({plan,events:linkEvents,byEvent,pos,defs,valueFlow,linkSlots,descriptor,keyRange,movement,origin,integer,
      expression:input=>observedExpression(input,true),firstInput,maxProofs});
    for(const group of composite){for(const c of group.key.components)groups.delete(c.id);groups.set(group.key.id,group);}
    for(const g of groups.values()){
      const {key,proofs}=g;proofs.sort((a,b)=>pos.get(a.afterExecutionId)-pos.get(b.afterExecutionId));if(!proofs.length)continue;
      const keyComponents=key.components??[key];
      const states=[],slots=nodeList.flatMap(n=>keyComponents.map((component,index)=>({node:n,component,index,range:keyRange(component,n),bytes:null,writer:null}))),
        slotsByObject=new Map(),slotsByNode=new Map();
      for(const x of slots){if(!slotsByObject.has(x.range.objectId))slotsByObject.set(x.range.objectId,[]);slotsByObject.get(x.range.objectId).push(x);
        if(!slotsByNode.has(x.node.id))slotsByNode.set(x.node.id,[]);slotsByNode.get(x.node.id).push(x);}
      const proofAt=new Set(proofs.map(p=>p.afterExecutionId)),sourceAt=new Set(source.states.map(st=>st.afterExecutionId));
      const history=stateHistoryCoverage(maxStates);let sourceCursor=-1,last=null,orderInfo=null,orderProofCount=-1;
      for(const e of events){
        const at=pos.get(e.eventId);while(sourceCursor+1<source.states.length&&pos.get(source.states[sourceCursor+1].afterExecutionId)<=at)sourceCursor++;
        let changed=false;const target=e.target??(e.objectId&&e.memoryState?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null);
        if(target&&['SPACE','READ','WRITE'].includes(e.kind))for(const x of slotsByObject.get(target.objectId)??[]){
          if(!overlap(target,x.range))continue;
          const next=memory.snapshot(x.range,at);
          if(next&&(e.kind==='WRITE'||JSON.stringify(next.bytes)!==JSON.stringify(x.bytes?.bytes))){x.bytes=next;x.writer=e.eventId;changed=true;}
        }
        if(keyComponents.some(c=>isByteKey(c))&&(target||e.kind==='SPACE'))changed=true;
        if(at<pos.get(proofs[0].afterExecutionId)||!changed&&!proofAt.has(e.eventId)&&!sourceAt.has(e.eventId))continue;
        const observed=proofs.filter(p=>pos.get(p.afterExecutionId)<=at),st=structureStateAt(source,pos,at,trace.objects);if(!st)continue;
        if(g.orderAt&&observed.length!==orderProofCount){orderInfo=g.orderAt(observed);orderProofCount=observed.length;}
        const order=orderInfo?.order??(g.orderAt?null:[{index:0,direction:1}]);
        const byRole=new Map();for(const p of observed){if(!byRole.has(p.roleId))byRole.set(p.roleId,[]);byRole.get(p.roleId).push(p);}
        const contracts=[...byRole].map(([roleId,ps])=>({roleId,direction:unique(ps.map(p=>p.direction)).length===1?ps[0].direction:'conflicting',
          duplicates:ps.some(p=>p.equalInsertion)?'observed-allowed':ps.some(p=>p.kind==='insertion'&&p.allowsEqual)?'allowed-by-insertion-rule':
            ps.some(p=>p.kind==='insertion')?'excluded-by-insertion-rule':'unknown',
          evidenceExecutionIds:unique(ps.flatMap(p=>[p.branchExecutionId,p.linkExecutionId,p.transferExecutionId]))}));
        const roleIds=contracts.map(p=>p.roleId),relation=projectStructureRelation(source,st,{roleIds}),projection=pointer?
          st.roleTopologies?.find(p=>p.fieldNodeIds.length===roleIds.length&&p.fieldNodeIds.every(id=>roleIds.includes(id))):null,
          complete=contracts.length===2&&contracts.some(p=>p.direction==='less')&&contracts.some(p=>p.direction==='greater')&&
            (pointer?!!projection:roleIds.length===source.roleIds.length&&roleIds.every(id=>source.roleIds.includes(id))),
          conflict=contracts.some(p=>p.direction==='conflicting'),top=relation.topology,
          alive=st.rootAlive&&(pointer||st.storageAlive),ids=new Set(top?.reachableNodeIds??[]),nodes=nodeList.filter(n=>ids.has(n.id)).map(n=>{
            const parts=slotsByNode.get(n.id).map(x=>{
              const string=isByteKey(x.component)?memory.key(x.component,x.range,at):null,
                payload=isByteKey(x.component)?string?.payload??null:scalarFromBytes(x.bytes?.bytes,x.component.cType),
                value=isByteKey(x.component)?string?.value??null:payload?.value??null;
              return {componentId:x.component.id,keyRange:x.range,value,payload,valueExecutionId:isByteKey(x.component)?string?.writer??null:x.writer,
                ...string?{stringEvidence:{range:string.range,referenceExecutionId:string.referenceExecutionId??null}}:{}};});
            return {id:n.id,range:{objectId:n.objectId,offset:n.offset,size:n.size},keyRange:parts[0].keyRange,
              value:key.components?parts.map(p=>p.value):parts[0].value,payload:key.components?undefined:parts[0].payload,valueExecutionId:parts[0].valueExecutionId,
              ...(key.components?{components:parts}:parts[0].stringEvidence?{stringEvidence:parts[0].stringEvidence}:{})};
          }),edges=relation.edges.map(({from,to,roleId})=>({from,to,roleId}));
        const proofLimit=g.firstOmittedProofExecutionId&&pos.get(g.firstOmittedProofExecutionId)<=at,
          unsupported=observed.some(p=>p.unsupportedContext)||proofLimit||!order;
        const {status,violations}=checkBSTOrder({relation,nodes,contracts,keyOrder:order,composite:!!key.components,complete,unsupported,conflict});
        const row={alive,status,contracts,nodes,edges,violations,
          relation:{sourceStructureId:source.id,roleIds,afterExecutionId:st.afterExecutionId},
          ...key.components?{keyOrder:order}:{},topologyStatus:top?.status??'unknown',
          reason:proofLimit?'comparison proof limit':orderInfo?.reason??(unsupported?'comparison depends on additional key components':conflict?'conflicting observed routing rules':null),
          evidenceExecutionIds:unique(observed.flatMap(p=>[p.branchExecutionId,p.keyReadExecutionId,p.queryReadExecutionId,p.linkExecutionId,p.transferExecutionId,
            ...p.guardExecutionIds??[],...p.componentReads?.flatMap(c=>[c.keyReadExecutionId,c.queryReadExecutionId])??[]])),
          scopeRanges:[structureRootRange(source,trace),...nodes.map(n=>n.range)].filter(r=>r?.size>0)},
          fingerprint=JSON.stringify({...row,relation:{sourceStructureId:source.id,roleIds}});
        if(fingerprint===last)continue;last=fingerprint;
        appendStateSnapshot(states,{afterExecutionId:e.eventId,...row},history);
      }
      if(states.length)result.push({id:`bst:${source.id}:${key.id}`,kind:'ordered-tree-candidate',origin:'inferred',intent:'unconfirmed',
        composition:{relation:'child-links',conditions:['binary-tree','bst-order']},
        nodes:[],edges:[],sourceStructureId:source.id,root:{...source.root,...structureRootRange(source,trace)},key,roleIds:unique(proofs.map(p=>p.roleId)),queryScoped:true,
        discoveredAtExecutionId:history.firstStateExecutionId,proofs,states,
        coverage:{...history,maxProofs,omittedProofs:g.omittedProofs,firstOmittedProofExecutionId:g.firstOmittedProofExecutionId??null},
        limitations:['Observed key comparison and child routing only; ambiguous orders and opaque comparators remain unclassified',
          'Duplicate policy is unknown until insertion evidence; this is not a proof of author intent']});
    }
  }
  return result;
}

export function queryBSTOrder(trace,{target,afterExecutionId,roleIds=null,candidateId=null}={}){
  const ctx=structureQueryContext(trace,afterExecutionId),{positions,at}=ctx;
  const normalized=target?.objectId?{ranges:[{objectId:target.objectId,offset:0,size:trace.objects.find(o=>o.id===target.objectId)?.size}]}:target;
  let candidates=trace.structures.filter(s=>s.kind==='ordered-tree-candidate'&&(!candidateId||s.id===candidateId)&&structureTouches(s,normalized,trace,ctx)&&
    (!roleIds||roleIds.length===s.roleIds.length&&roleIds.every(id=>s.roleIds.includes(id)))).map(s=>{
      let state=ctx.state(s);const historyGap=state?.lifetimeStatus!=='ended'&&stateHistoryGapAt(s,positions,at);
      if(state&&historyGap)
        state={...state,status:'incomplete',reason:'state history limit',violations:[]};
      return {candidateId:s.id,key:s.key,state,...historyGap?{historyGap:true}:{}};})
    .filter(c=>c.state?.alive||c.historyGap);
  const exact=candidates.filter(c=>{const s=trace.structures.find(s=>s.id===c.candidateId),root=structureRootRange(s,trace);return normalized.ranges?.some(r=>same(root,r));});
  if(exact.length)candidates=exact;
  return {expected:'bst-order',assessment:!candidates.length?'not-checkable':candidates.some(c=>c.state?.status==='violated')?'contradicted':
    candidates.every(c=>c.state?.status==='satisfied-observed')?'satisfied-observed':candidates.some(c=>c.state?.status==='not-checkable')?'not-checkable':'incomplete',
    candidates,warnings:candidates.flatMap(c=>(c.state?.violations??[]).map(v=>({...v,candidateId:c.candidateId,category:'structure-expectation'})))};
}
