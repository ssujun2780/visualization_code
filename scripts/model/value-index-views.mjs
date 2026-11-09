// Integer values become links only after recorded value flow reaches an actual
// index of the same array. This overlay never creates storage or IR operations.
import {createValueFlow} from './observed-value-flow.mjs';
import {observeScalarBytes} from './observed-scalar-bytes.mjs';

const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const numeric=v=>{const raw=v?.decimal??(v?.cType?.signedness==='unsigned'?v?.unsigned:v?.signed);if(raw===undefined||raw===null)return null;
  const n=Number(raw);return Number.isSafeInteger(n)?n:null;};
const unique=a=>[...new Set(a)];
const signature=n=>{n=unwrap(n);return n&&JSON.stringify([n.kind,n.declarationId??null,n.fieldNodeId??null,n.operator??null,n.literal??null,(n.children??[]).map(signature)]);};
const slotId=(a,i)=>`index-slot:${a.objectId}:${a.range.offset+i*a.elementBytes}:${a.elementBytes}`;
const fullSlot=(a,t)=>t?.objectId===a.objectId&&t.size===a.elementBytes&&Number.isInteger(t.offset)&&
  t.offset>=a.range.offset&&t.offset+t.size<=a.range.offset+a.range.size&&(t.offset-a.range.offset)%a.elementBytes===0;
const slotIndex=(a,t)=>(t.offset-a.range.offset)/a.elementBytes;
const overlap=(a,t)=>t?.objectId===a.objectId&&t.offset<a.range.offset+a.range.size&&t.offset+t.size>a.range.offset;
const reverseComparison={'<':'>','<=':'>=','>':'<','>=':'<=','==':'==','!=':'!='};
function terminalMatches(predicate,value,index,capacity){
  if(value===null||value===undefined)return false;
  if(predicate?.kind==='self-index')return value===index;
  // A stored non-index may be a terminator only with an executed exit proof.
  // In-range constants remain ambiguous node IDs, not implicit sentinels.
  if(predicate?.kind!=='stored-boundary'||value>=0&&value<capacity)return false;
  const k=predicate.constant,result={'<':value<k,'<=':value<=k,'>':value>k,'>=':value>=k,'==':value===k,'!=':value!==k}[predicate.operator];
  return result===predicate.result;
}

function graphState(a,nodes,rootIndices,discovered,alive){
  const roots=new Set(rootIndices),byIndex=new Map(nodes.map(n=>[n.index,n]));
  for(const n of nodes.slice())if(n.value!==null&&n.value>=0&&n.value<a.capacity&&!byIndex.has(n.value)){
    const target={id:slotId(a,n.value),objectId:a.objectId,offset:a.range.offset+n.value*a.elementBytes,size:a.elementBytes,index:n.value,value:null,
      status:alive?'unknown':'ended',lastWriteExecutionId:null,lastObservationExecutionId:null};nodes.push(target);byIndex.set(target.index,target);
  }
  nodes.sort((x,y)=>x.index-y.index);
  const edges=nodes.map(n=>{
    const valid=n.value!==null&&n.value>=0&&n.value<a.capacity;
    return {from:n.id,to:valid?byIndex.get(n.value).id:null,fromIndex:n.index,toIndex:valid?n.value:null,value:n.value,
      status:!alive?'ended':n.value===null?n.status:roots.has(n.index)?'root-termination':!valid?'out-of-bounds':'observed'};
  }),adj=new Map(nodes.map(n=>[n.index,[]]));
  for(const e of edges)if(e.toIndex!==null){adj.get(e.fromIndex).push(e.toIndex);adj.get(e.toIndex).push(e.fromIndex);}
  const seen=new Set(),components=[],representatives=[];
  const resolve=index=>{const path=new Set();let current=index;
    while(true){if(path.has(current))return {rootIndex:null,status:'cycle'};path.add(current);
      const n=byIndex.get(current);if(!n||n.value===null)return {rootIndex:null,status:'unknown'};
      if(roots.has(current))return {rootIndex:current,status:alive&&discovered?'supported':'partial'};
      if(n.value<0||n.value>=a.capacity)return {rootIndex:null,status:'out-of-bounds'};
      current=n.value;
    }
  };
  for(const n of nodes)representatives.push({index:n.index,...resolve(n.index)});
  const byRepresentative=new Map(representatives.map(r=>[r.index,r]));
  for(const n of nodes){if(seen.has(n.index))continue;const pending=[n.index],indices=[];
    for(let i=0;i<pending.length;i++){const index=pending[i];if(seen.has(index))continue;seen.add(index);indices.push(index);pending.push(...adj.get(index).filter(x=>!seen.has(x)));}
    const own=indices.map(i=>byRepresentative.get(i)),cyclic=own.some(r=>r.status==='cycle'),rootList=unique(own.map(r=>r.rootIndex).filter(x=>x!==null)),
      complete=indices.every(i=>byIndex.get(i).value!==null)&&own.every(r=>r.rootIndex!==null);
    components.push({nodeIds:indices.map(i=>byIndex.get(i).id),indices,rootIndices:rootList,cyclic,
      status:!alive?'ended':cyclic?'cyclic':complete&&discovered?'rooted-tree-candidate':'partial'});
  }
  const complete=alive&&nodes.length===a.capacity&&nodes.every(n=>n.value!==null&&(roots.has(n.index)||n.value>=0&&n.value<a.capacity)),cyclic=components.some(c=>c.cyclic)?true:complete?false:null,
    forest=complete&&discovered&&components.every(c=>c.status==='rooted-tree-candidate');
  return {edges,representatives,unknownSlotCount:a.capacity-nodes.filter(n=>n.value!==null).length,topology:{direction:'child-to-successor',singleSuccessor:true,complete,cyclic,
    rawCyclic:cyclic||edges.some(e=>e.fromIndex===e.toIndex),roots:[...roots].filter(i=>byIndex.has(i)),components,
    views:['directed-index-graph',...(forest?['parent-forest-candidate']:[])],
    status:!alive?'ended':forest?'rooted-forest-candidate':cyclic?'cyclic':complete?'observed':'partial'}};
}

export function valueIndexStructures(plan,{events,objects,structures=[],resultDeliveries=[],valueFlow}){
  const arrays=structures.filter(a=>a.kind==='array'&&['signed','unsigned'].includes(a.elementType?.signedness)&&
    Number.isInteger(a.capacity)&&a.capacity>0&&a.elementBytes>0&&a.elementBytes<=16),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),byEvent=new Map(events.map(e=>[e.eventId,e])),
    positions=new Map(events.map((e,i)=>[e.eventId,i])),byObject=new Map(objects.map(o=>[o.id,o])),
    flow=valueFlow??createValueFlow(plan,{events,resultDeliveries}),candidates=new Map();
  const aliveAt=(a,id)=>{const o=byObject.get(a.objectId),at=positions.get(id);return !!o&&at>=(positions.get(o.createdBy)??0)&&at<(positions.get(o.endedBy)??Infinity);};
  function accessNode(e){let n=unwrap(defs.get(e.instructionId)?.expression);
    if(e.kind==='WRITE'&&['BinaryOperator','CompoundAssignOperator','UnaryOperator'].includes(n?.kind))n=unwrap(n.children?.[0]);
    return n?.kind==='ArraySubscriptExpr'?n:null;
  }
  function indexInputs(e,n){
    const index=n?.children?.[1],ids=new Set(walk(index).map(x=>x.nodeId)),sig=signature(index);
    return (e.addressInputs??[]).filter(id=>{const input=byEvent.get(id),def=defs.get(input?.instructionId);
      return input&&numeric(input.value)!==null&&(ids.has(def?.sourceNodeId)||walk(def?.expression).some(x=>ids.has(x.nodeId))||signature(def?.expression)===sig);
    });
  }
  for(const target of events){if(!['READ','WRITE'].includes(target.kind))continue;const node=accessNode(target);if(!node)continue;
    for(const a of arrays){if(!fullSlot(a,target.target)||!aliveAt(a,target.eventId))continue;const targetIndex=slotIndex(a,target.target);
      for(const id of indexInputs(target,node)){if(numeric(byEvent.get(id).value)!==targetIndex)continue;
        for(const source of flow.reads(id)){
          if(!fullSlot(a,source.target)||numeric(source.value)!==targetIndex||!aliveAt(a,source.eventId)||positions.get(source.eventId)>=positions.get(target.eventId))continue;
          let c=candidates.get(a.id);if(!c)candidates.set(a.id,c={array:a,evidence:[],terminationEvidence:[]});
          if(!c.evidence.some(x=>x.sourceReadExecutionId===source.eventId&&x.targetAccessExecutionId===target.eventId))c.evidence.push({
            sourceReadExecutionId:source.eventId,targetAccessExecutionId:target.eventId,indexExecutionId:id,
            sourceIndex:slotIndex(a,source.target),targetIndex,sourceNodeId:accessNode(source)?.nodeId??null,targetNodeId:node.nodeId,
            evidence:'observed identity-preserving integer value flow into a same-array index'});
        }
      }
    }
  }
  if(!candidates.size)return [];
  // A terminal convention requires the executed branch to exit a compiler
  // loop or reach a controlled return/break before another traversal access.
  for(const compare of events)if(compare.kind==='CALC')for(const step of compare.steps??[]){
    if(!reverseComparison[step.operator]||step.inputs?.length!==2)continue;
    const ast=unwrap(defs.get(compare.instructionId)?.expression);
    // Do not attribute a compound condition's exit to one unrelated leaf.
    if(ast?.nodeId!==step.nodeId)continue;
    for(let side=0;side<2;side++){
      const input=step.inputs[side],otherInput=step.inputs[1-side],operandRead=flow.sourceReadOperand(input,compare,step);
      for(const read of operandRead?flow.reads(operandRead.eventId):[]){
      const node=accessNode(read),other=ast.children?.[1-side];
      if(!node||numeric(input.value)!==numeric(read.value))continue;
      const self=['==','!='].includes(step.operator)&&numeric(step.value)===(step.operator==='=='?1:0)&&signature(node.children?.[1])===signature(other),
        constant=otherInput.executionId?null:numeric(otherInput.value),
        predicate=self?{kind:'self-index'}:constant!==null?{kind:'stored-boundary',
          operator:side===0?step.operator:reverseComparison[step.operator],constant,result:numeric(step.value)!==0}:null;
      if(!predicate)continue;
      for(const c of candidates.values()){
        const a=c.array;if(!fullSlot(a,read.target)||!terminalMatches(predicate,numeric(read.value),slotIndex(a,read.target),a.capacity)||!aliveAt(a,compare.eventId))continue;
        const guard=read.activationId!==compare.activationId;
        // A callee guard is structural only if that compiler operand indexes
        // this same array in observed nonterminal calls. A payload predicate
        // helper is not automatically a traversal terminator.
        if(guard&&!c.evidence.some(p=>{const access=byEvent.get(p.targetAccessExecutionId),d=defs.get(access?.instructionId);
          return d?.functionId===defs.get(compare.instructionId)?.functionId&&signature(accessNode(access)?.children?.[1])===signature(ast.children?.[side]);}))continue;
        const index=slotIndex(a,read.target),branch=events.slice(positions.get(compare.eventId)+1).find(e=>
          e.activationId===compare.activationId&&e.action==='branch'&&e.dataInputs?.includes(compare.eventId));
        if(!branch)continue;const def=defs.get(branch.instructionId);
        let terminal=null,reason=null;
        if(['WhileStmt','ForStmt','DoStmt'].includes(def?.controlKind)&&numeric(branch.condition)===0&&def.destinations?.[1]===branch.selected){terminal=branch;reason='observed compiler loop exit on stored termination predicate';}
        else for(let p=positions.get(branch.eventId)+1;p<events.length;p++){
          const e=events[p];if(e.activationId!==branch.activationId)continue;
          if(e.kind==='WRITE'&&overlap(a,e.target)||e.kind==='READ'&&fullSlot(a,e.target)&&(guard||slotIndex(a,e.target)!==index))break;
          if(['call','loop.next','branch'].includes(e.action))break;
          const returnedReads=e.action==='return.value'?flow.reads(e.eventId):[],
            returnsSameIndex=numeric(e.value)===index&&returnedReads.some(r=>
              fullSlot(a,r.target)&&slotIndex(a,r.target)===index||signature(defs.get(r.instructionId)?.expression)===signature(node.children?.[1]));
          if(['return.value','return','break'].includes(e.action)&&e.controlInputs?.includes(branch.eventId)){
            terminal=e;reason='observed controlled termination after stored termination predicate';break;
          }
          const returnSource=defs.get(e.instructionId)?.source,afterStatement=def?.controlKind==='IfStmt'&&
            returnSource?.file===def.statementSource?.file&&returnSource?.start?.byte>=def.statementSource?.end?.byte;
          if(e.action==='return.value'&&afterStatement&&(returnsSameIndex||guard)){terminal=e;reason='observed return after compiler branch merge without further traversal';break;}
          if(e.kind==='WRITE'&&e.action!=='return.value'&&flow.reads(e.eventId).some(r=>fullSlot(a,r.target)))break;
          if(e.action==='frame.end')break;
        }
        if(terminal)c.terminationEvidence.push({executionId:terminal.eventId,comparisonExecutionId:compare.eventId,branchExecutionId:branch.eventId,
          readExecutionId:read.eventId,operandReadExecutionId:operandRead.eventId,index,comparisonNodeId:step.nodeId,operator:step.operator,predicate,
          mode:guard?'guard-before-access':'stored-value-check',evidence:reason});
      }
      }
    }
  }
  const result=[];
  for(const c of candidates.values()){
    const a=c.array,o=byObject.get(a.objectId),observedIndices=unique(events.filter(e=>['READ','WRITE'].includes(e.kind)&&fullSlot(a,e.target)).map(e=>slotIndex(a,e.target))),
      values=new Map(observedIndices.map(index=>[index,{bytes:null,lastWrite:null,lastObservation:null,initialization:'unknown'}])),
      states=[],writes=[],rootProof=new Map(),discoveredAtExecutionId=c.evidence[0].targetAccessExecutionId,
      changes=new Set(c.evidence.map(e=>e.targetAccessExecutionId)),terminationByEvent=new Map();
    const conventions=[];
    for(const proof of c.terminationEvidence){if(!terminationByEvent.has(proof.executionId))terminationByEvent.set(proof.executionId,[]);terminationByEvent.get(proof.executionId).push(proof);}
    for(let p=0;p<events.length;p++){
      const e=events[p];if(p<(positions.get(o.createdBy)??0))continue;
      let changed=e.eventId===o.createdBy||e.eventId===o.endedBy||changes.has(e.eventId),target=e.target??(e.objectId?{objectId:e.objectId,offset:0,size:o.size}:null);
      if(overlap(a,target)&&['SPACE','WRITE','READ'].includes(e.kind)){
        for(const [index,v]of values){
          const offset=a.range.offset+index*a.elementBytes;if(offset>=target.offset+target.size||offset+a.elementBytes<=target.offset)continue;let updated=null;
          if(e.memoryState&&['SPACE','WRITE'].includes(e.kind))updated=observeScalarBytes(v.bytes,{size:a.elementBytes,signed:a.elementType.signedness==='signed',snapshot:e.memoryState,start:target.offset,offset});
          else if(fullSlot(a,target)&&['READ','WRITE'].includes(e.kind))updated=observeScalarBytes(v.bytes,{size:a.elementBytes,signed:a.elementType.signedness==='signed',value:e.value?.bits??e.value?.decimal});
          if(!updated&&e.kind==='WRITE')updated={bytes:Array(a.elementBytes).fill(null),value:null};
          if(updated){changed=changed||e.kind!=='READ'||JSON.stringify(updated)!==JSON.stringify(v.bytes);v.bytes=updated;v.lastObservation=e.eventId;
            v.initialization=updated.bytes.every(b=>b!==null)?'initialized':e.memoryState?.ranges?.some(r=>r.initialization==='uninitialized')?'uninitialized':'unknown';
            if(e.kind==='WRITE'||e.kind==='SPACE'){v.lastWrite=e.eventId;rootProof.delete(index);
              if(e.kind==='WRITE')writes.push({executionId:e.eventId,index,value:updated.value,source:{objectId:a.objectId,offset,size:a.elementBytes}});
            }
          }
        }
      }
      for(const proof of terminationByEvent.get(e.eventId)??[]){
        if(values.get(proof.index)?.bytes?.value===numeric(byEvent.get(proof.readExecutionId)?.value))rootProof.set(proof.index,proof);
        if(!conventions.some(p=>JSON.stringify(p.predicate)===JSON.stringify(proof.predicate)))conventions.push(proof);changed=true;}
      if(!changed)continue;const alive=aliveAt(a,e.eventId),discovered=p>=positions.get(discoveredAtExecutionId),
        nodes=[...values].map(([index,v])=>({id:slotId(a,index),objectId:a.objectId,offset:a.range.offset+index*a.elementBytes,size:a.elementBytes,index,
          value:v.bytes?.value??null,status:!alive?'ended':v.bytes?.value!==null&&v.bytes?.value!==undefined?'observed':v.initialization,
          lastWriteExecutionId:v.lastWrite,lastObservationExecutionId:v.lastObservation})),
        rootEvidence=nodes.flatMap(n=>{const proof=rootProof.get(n.index)??conventions.find(p=>terminalMatches(p.predicate,n.value,n.index,a.capacity));
          return proof&&terminalMatches(proof.predicate,n.value,n.index,a.capacity)?[{index:n.index,predicate:proof.predicate,
            kind:rootProof.has(n.index)?'observed-termination':proof.predicate.kind==='self-index'?'inferred-self-termination':'inferred-boundary-termination',
            executionId:proof.executionId}]:[];}),
        graph=graphState(a,nodes,rootEvidence.map(r=>r.index),discovered,alive);
      states.push({afterExecutionId:e.eventId,alive,status:!alive?'ended':!discovered?'partial':graph.edges.some(e=>e.status==='out-of-bounds')?'inconsistent':graph.topology.complete?'observed':'partial',
        discoveryStatus:discovered?'observed':'not-yet-observed',rootEvidence,nodes,...graph});
      if(e.eventId===o.endedBy)break;
    }
    result.push({id:`value-index:${a.id}`,kind:'value-index-graph-candidate',origin:'inferred',classification:'candidate',intent:'unconfirmed',
      arrayId:a.id,objectId:a.objectId,storageIdentity:a.storageIdentity??`storage:${a.objectId}:${a.range.offset}:${a.range.size}`,range:a.range,
      elementBytes:a.elementBytes,capacity:a.capacity,nodes:a.nodes??[],edges:[],isPointerStructure:false,views:['directed-index-graph'],
      discoveredAtExecutionId,evidence:c.evidence,terminationEvidence:c.terminationEvidence,
      terminationConvention:{status:conventions.length?'supported':'unknown',inferredAtExecutionId:conventions[0]?.executionId??null,
        predicates:conventions.map(p=>({predicate:p.predicate,inferredAtExecutionId:p.executionId})),
        scope:{arrayId:a.id,objectId:a.objectId,comparisonNodeIds:unique(c.terminationEvidence.map(e=>e.comparisonNodeId))},
        semantics:'executed termination predicates are representation candidates for this array relation; local proof and inferred roots remain distinct'},writes,states,
      limitations:['identity-preserving values into indices of the same observed integer array only; arithmetic indices remain unresolved',
        'self links and non-index values remain unresolved until an observed predicate terminates traversal; roots remain representation candidates',
        'unobserved bytes and incomplete lifetimes remain unknown; sparse slots do not expand untouched array capacity',
        'local root proof is invalidated by every subsequent write; relation-wide inferred self roots are explicitly marked and do not prove termination of every caller']});
  }
  return result;
}

export function validateValueIndexStructures({events,objects,structures}){
  const executions=new Map(events.map((e,i)=>[e.eventId,i])),objectIds=new Set(objects.map(o=>o.id)),arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s]));
  const require=(condition,message)=>{if(!condition)throw new Error(`value-index overlay: ${message}`);};
  const execution=id=>require(executions.has(id),`missing execution ${id}`);
  for(const c of structures.filter(s=>s.kind==='value-index-graph-candidate')){
    const a=arrays.get(c.arrayId);require(a&&a.objectId===c.objectId&&objectIds.has(c.objectId),'invalid array storage');
    require(c.capacity===a.capacity&&c.elementBytes===a.elementBytes&&c.range.offset===a.range.offset&&c.range.size===a.range.size,'invalid array extent');
    require(c.edges.length===0&&c.isPointerStructure===false,'overlay must not create physical edges');execution(c.discoveredAtExecutionId);
    for(const e of c.evidence){execution(e.sourceReadExecutionId);execution(e.targetAccessExecutionId);execution(e.indexExecutionId);
      require(executions.get(e.sourceReadExecutionId)<executions.get(e.targetAccessExecutionId),'reversed value flow');}
    for(const e of c.terminationEvidence){execution(e.executionId);execution(e.comparisonExecutionId);execution(e.branchExecutionId);execution(e.readExecutionId);}
    for(const w of c.writes){execution(w.executionId);require(w.index>=0&&w.index<a.capacity,'write outside array');}
    let previous=-1;
    for(const s of c.states){execution(s.afterExecutionId);require(executions.get(s.afterExecutionId)>previous,'states out of execution order');previous=executions.get(s.afterExecutionId);
      require(s.nodes.length<=a.capacity&&new Set(s.nodes.map(n=>n.id)).size===s.nodes.length,'invalid logical slots');
      const byIndex=new Map(s.nodes.map(n=>[n.index,n]));
      for(const n of s.nodes){require(n.id===slotId(a,n.index)&&n.objectId===a.objectId&&n.offset===a.range.offset+n.index*a.elementBytes&&n.size===a.elementBytes,'duplicated or shifted storage');
        if(n.lastWriteExecutionId)execution(n.lastWriteExecutionId);if(n.lastObservationExecutionId)execution(n.lastObservationExecutionId);}
      for(const e of s.edges){require(e.from===slotId(a,e.fromIndex)&&e.value===byIndex.get(e.fromIndex)?.value,'invalid source edge');
        require(e.toIndex===null?e.to===null:e.toIndex>=0&&e.toIndex<a.capacity&&e.to===slotId(a,e.toIndex)&&e.toIndex===e.value,'invalid destination edge');}
      for(const proof of s.rootEvidence){execution(proof.executionId);
        require(executions.get(proof.executionId)<=executions.get(s.afterExecutionId),'future termination proof');
        require(c.terminationEvidence.some(p=>p.executionId===proof.executionId&&JSON.stringify(p.predicate)===JSON.stringify(proof.predicate)&&
          (proof.kind!=='observed-termination'||p.index===proof.index)),'unbacked termination predicate');
        require(terminalMatches(proof.predicate,byIndex.get(proof.index)?.value,proof.index,a.capacity),'invalid terminal predicate');}
      for(const r of s.representatives)require(r.rootIndex===null||s.rootEvidence.some(p=>p.index===r.rootIndex),'invented root');
    }
  }
  return true;
}
