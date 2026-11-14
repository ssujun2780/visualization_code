// A filtered record row supplies two endpoints in another indexed domain.
// Joins use executed comparisons, cursor versions and address provenance.
// Names, equal capacities and printed output are not evidence.
import {createValueFlow} from './observed-value-flow.mjs';
const num=v=>Number(v?.decimal??v?.signed??v?.unsigned);
const same=(a,b)=>a?.objectId===b?.objectId&&a?.offset===b?.offset&&a?.size===b?.size;
const overlap=(a,b)=>a?.objectId===b?.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const unwrap=n=>n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind)?unwrap(n.children?.[0]):n;
const unique=a=>[...new Set(a)];
function additiveInputs(write,flow){
  const found=[];
  for(const id of write.dataInputs??[])for(const calc of flow.chain(id))if(calc.kind==='CALC')
    for(const step of calc.steps??[])if(['+','+='].includes(step.operator))
      for(const input of step.inputs??[]){
        const operand=flow.sourceReadOperand(input,calc,step);
        for(const read of operand?flow.reads(operand.eventId):[])found.push({read,calc,step});
      }
  return found;
}
function context(plan,trace,flow){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    defs=new Map(plan.instructions.map(d=>[d.id,d])),arrays=new Map(trace.structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),
    accesses=new Map((trace.structures.find(s=>s.kind==='array-work')?.accesses??[]).map(a=>[a.executionId,a]));
  const origin=id=>flow.chain(id).at(-1)?.eventId;
  const cursor=a=>{
    if(a?.axes?.length!==1||a.axes[0].index?.offset!==0)return null;
    const cs=a.cursors.filter(c=>a.axes[0].indexDeclarationIds.includes(c.declarationId));
    if(cs.length!==1)return null;
    const read=events.get(cs[0].executionId);
    return read?.kind==='READ'&&num(read.value)===a.target.index?read:null;
  };
  const fields=new Map();
  for(const [id,a]of accesses){const e=events.get(id),array=arrays.get(a.target.arrayId),n=unwrap(defs.get(e?.instructionId)?.expression);
    if(e?.kind!=='READ'||array?.elementType?.kind!=='record'||n?.kind!=='MemberExpr'||!n.fieldNodeId||
      !['signed','unsigned'].includes(n.cType?.signedness)||!cursor(a))continue;
    fields.set(id,{event:e,access:a,array,field:n.fieldNodeId,version:origin(cursor(a).eventId)});
  }
  const row=(a,b)=>a&&b&&a.array.id===b.array.id&&a.access.target.index===b.access.target.index&&a.version===b.version;
  const fresh=(reads,at)=>reads.every(r=>!trace.events.slice(positions.get(r.eventId)+1,positions.get(at)+1).some(w=>
    w.kind==='WRITE'&&overlap(w.target,r.target)||w.action==='object.end'&&w.objectId===r.target.objectId));
  return {events,positions,defs,arrays,accesses,fields,origin,cursor,row,fresh,flow};
}
export function edgeListProofs(plan,trace,flow){
  const c=context(plan,trace,flow),{events,positions,defs,arrays,accesses,fields,origin,cursor,row,fresh}=c,
    comparisons=[],domainAccesses=[];
  for(const e of trace.events)if(e.action==='branch'&&defs.get(e.instructionId)?.controlKind==='IfStmt'){
    for(const id of e.dataInputs??[]){const calc=events.get(id);
      for(const step of calc?.steps??[]){
        if(!['==','!='].includes(step.operator)||step.inputs?.length!==2||
          (step.operator==='=='?num(step.value)!==1:num(step.value)!==0))continue;
        for(let side=0;side<2;side++){
          const source=flow.sourceReadOperand(step.inputs[side],calc,step),other=flow.sourceReadOperand(step.inputs[1-side],calc,step),f=fields.get(source?.eventId);
          if(!f||!other||fields.has(other.eventId)||source.activationId!==e.activationId||num(source.value)!==num(other.value))continue;
          comparisons.push({branch:e,calc,step,from:f,cursor:other});
        }
      }
    }
  }
  for(const [id,a]of accesses){const e=events.get(id),array=arrays.get(a.target.arrayId),index=cursor(a);
    if(!array||!index||!['READ','WRITE'].includes(e.kind)||array.elementType?.kind==='array')continue;
    domainAccesses.push({event:e,access:a,array,cursor:index,version:origin(index.eventId)});
  }
  const proofs=[];
  for(const target of domainAccesses){
    const destinations=flow.reads(target.cursor.eventId).flatMap(r=>fields.has(r.eventId)?[fields.get(r.eventId)]:[]);
    for(const to of destinations)for(const gate of comparisons){
      if(!row(gate.from,to)||gate.from.field===to.field||target.array.id===to.array.id||
        gate.branch.activationId!==target.event.activationId||!target.event.controlInputs?.includes(gate.branch.eventId)||
        positions.get(gate.branch.eventId)>=positions.get(target.event.eventId))continue;
      const source=domainAccesses.findLast(a=>a.array.id===target.array.id&&a.version===origin(gate.cursor.eventId)&&
        a.event.activationId===target.event.activationId&&positions.get(a.event.eventId)<=positions.get(target.event.eventId));
      if(!source||source.access.target.index!==num(gate.from.event.value))continue;
      const reads=[gate.from.event,to.event,gate.cursor];
      if(!fresh(reads,target.event.eventId))continue;
      const base={kind:'edge-list-gated-access',executionId:target.event.eventId,
        fromIndex:source.access.target.index,toIndex:target.access.target.index,
        sourceAccessExecutionId:source.event.eventId,targetAccessExecutionId:target.event.eventId,
        sourceReadExecutionId:to.event.eventId,fromReadExecutionId:gate.from.event.eventId,
        cursorReadExecutionId:gate.cursor.eventId,branchExecutionId:gate.branch.eventId,
        comparisonExecutionId:gate.calc.eventId,comparisonNodeId:gate.step.nodeId,
        sourceSlots:[gate.from.event.target,to.event.target],properties:[],transforms:[],
        sourceReads:reads.map(e=>({source:e.target,executionId:e.eventId})),
        evidenceExecutionIds:unique([...reads.map(e=>e.eventId),gate.branch.eventId,gate.calc.eventId,source.event.eventId,target.event.eventId])};
      proofs.push({array:target.array,proof:base});
      // Additive attributes are witnessed data inputs of a vertex update.
      // A second attribute stays separate; no arbitrary field is called weight.
      for(const write of domainAccesses){
        if(write.event.kind!=='WRITE'||write.array.id!==target.array.id||write.event.activationId!==target.event.activationId||
          positions.get(write.event.eventId)<positions.get(target.event.eventId)||!write.event.controlInputs?.includes(gate.branch.eventId))continue;
        const attributes=[...new Map(additiveInputs(write.event,flow).flatMap(p=>fields.has(p.read.eventId)?[[p.read.eventId,{...fields.get(p.read.eventId),calculation:p.calc,step:p.step}]]:[])).values()]
          .filter(f=>row(to,f)&&![to.field,gate.from.field].includes(f.field));
        if(!attributes.length||!fresh([...reads,...attributes.map(f=>f.event)],write.event.eventId))continue;
        const properties=attributes.map(f=>({source:f.event.target,value:f.event.value,readExecutionId:f.event.eventId,
          writeExecutionId:write.event.eventId,calculationExecutionId:f.calculation.eventId,calculationNodeId:f.step.nodeId,
          role:'edge-update-attribute',status:'observed'}));
        proofs.push({array:target.array,proof:{...base,executionId:write.event.eventId,properties,
          evidenceExecutionIds:unique([...base.evidenceExecutionIds,write.event.eventId,...properties.flatMap(p=>[p.readExecutionId,p.calculationExecutionId])])}});
      }
    }
  }
  return proofs;
}

const validation=new WeakMap();
export function validateEdgeListProof(p,{plan,trace,fail}){
  if(!validation.has(trace))validation.set(trace,context(plan,trace,createValueFlow(plan,trace)));
  const c=validation.get(trace),{events,positions,accesses,fields,origin,cursor,row,fresh,flow}=c,
    from=fields.get(p.fromReadExecutionId),to=fields.get(p.sourceReadExecutionId),source=accesses.get(p.sourceAccessExecutionId),
    target=accesses.get(p.targetAccessExecutionId),gate=events.get(p.branchExecutionId),calc=events.get(p.comparisonExecutionId),
    step=calc?.steps?.find(s=>s.nodeId===p.comparisonNodeId),cur=events.get(p.cursorReadExecutionId),end=events.get(p.executionId);
  if(!row(from,to)||from.field===to.field||!source||!target||source.target.arrayId!==target.target.arrayId||
    source.target.arrayId===from.array.id||source.target.index!==p.fromIndex||target.target.index!==p.toIndex||
    !cursor(source)||!cursor(target)||origin(cursor(source).eventId)!==origin(cur?.eventId)||
    !flow.reads(cursor(target).eventId).some(r=>r.eventId===to.event.eventId)||
    !same(p.sourceSlots[0],from.event.target)||!same(p.sourceSlots[1],to.event.target)||p.sourceSlots.length!==2)
    fail('별도 간선 레코드의 끝점·동적 인덱스 전달이 다릅니다.');
  if(!['==','!='].includes(step?.operator)||(step.operator==='=='?num(step.value)!==1:num(step.value)!==0)||
    !step.inputs.some((input,i)=>flow.sourceReadOperand(input,calc,step)?.eventId===from.event.eventId&&
      flow.sourceReadOperand(step.inputs[1-i],calc,step)?.eventId===cur?.eventId)||
    gate?.action!=='branch'||!gate.dataInputs?.includes(calc.eventId)||
    !events.get(p.targetAccessExecutionId).controlInputs?.includes(gate.eventId)||
    num(cur?.value)!==p.fromIndex||num(to.event.value)!==p.toIndex)
    fail('간선 출발점의 실제 비교·분기 근거가 다릅니다.');
  const reads=[from.event,to.event,cur];
  for(const property of p.properties){const f=fields.get(property.readExecutionId),write=events.get(property.writeExecutionId);
    if(!row(to,f)||[from.field,to.field].includes(f.field)||!same(property.source,f.event.target)||
      property.role!=='edge-update-attribute'||write?.kind!=='WRITE'||accesses.get(write.eventId)?.target.arrayId!==target.target.arrayId||
      !additiveInputs(write,flow).some(p=>p.read.eventId===f.event.eventId&&p.calc.eventId===property.calculationExecutionId&&p.step.nodeId===property.calculationNodeId)||
      JSON.stringify(property.value)!==JSON.stringify(f.event.value))
      fail('간선 속성의 실제 갱신 출처가 다릅니다.');
    reads.push(f.event);
  }
  if(!end||!fresh(reads,end.eventId)||reads.some(r=>positions.get(r.eventId)>positions.get(end.eventId)))
    fail('간선 확인 전에 끝점 또는 속성이 변경되었습니다.');
}
