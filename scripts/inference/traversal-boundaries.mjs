// Storage-independent boundary proofs for integer links. A constant is not a
// sentinel by itself: an executed guard must exclude an observed traversal.
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const number=v=>{const x=v?.decimal??v?.signed??v?.unsigned;return x===undefined?null:Number.isSafeInteger(Number(x))?Number(x):null;};
const signature=n=>{n=unwrap(n);return n&&JSON.stringify([n.kind,n.declarationId??null,n.fieldNodeId??null,n.operator??null,n.literal??null,(n.children??[]).map(signature)]);};
const reverse={'<':'>','<=':'>=','>':'<','>=':'<=','==':'==','!=':'!='};
export function matchesBoundary(p,value,index){
  if(value===null||value===undefined)return false;
  if(p?.kind==='self-index')return value===index;
  if(p?.kind!=='stored-boundary')return false;
  const k=p.constant;return ({'<':value<k,'<=':value<=k,'>':value>k,'>=':value>=k,'==':value===k,'!=':value!==k})[p.operator]===p.result;
}
export function observedTraversalBoundaries(plan,{events,valueFlow}, {source,traversals}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),out=[];
  const branches=events.filter(e=>['branch','conditional'].includes(e.action)),proofs=traversals.map(t=>({...t,read:byId.get(t.sourceReadExecutionId),access:byId.get(t.targetAccessExecutionId)}));
  for(const compare of events)if(compare.kind==='CALC')for(const step of compare.steps??[]){
    const ast=unwrap(walk(defs.get(compare.instructionId)?.expression).find(n=>n.nodeId===step.nodeId)),unary=['truth','!'].includes(step.operator),
      operator=step.operator==='truth'?'!=':step.operator==='!'?'==':step.operator,
      operands=unary?[step.inputs[0],{value:{decimal:'0'}}]:step.inputs;
    if(!reverse[operator]||operands?.length!==2||ast?.nodeId!==step.nodeId)continue;
    const branch=branches.find(b=>b.activationId===compare.activationId&&b.dataInputs?.includes(compare.eventId));if(!branch)continue;
    const bd=defs.get(branch.instructionId);
    if(branch.action==='conditional'&&unwrap(bd?.expression?.children?.[0])?.nodeId!==step.nodeId)continue;
    if(branch.action==='branch'&&unwrap(defs.get(compare.instructionId)?.expression)?.nodeId!==step.nodeId)continue;
    for(let side=0;side<2;side++){
      const operand=operands[side],other=operands[1-side],constant=other.executionId?null:number(other.value),near=valueFlow.sourceReadOperand(operand,compare,step),
        operandNode=unary?(step.operator==='truth'?ast:ast.children[0]):ast.children[side];
      if(constant===null||!near)continue;
      for(const read of valueFlow.reads(near.eventId)){
        const slot=source(read);if(!slot||number(read.value)!==number(operand.value))continue;
        const own=proofs.filter(p=>source(p.read)?.roleId===slot.roleId);if(!own.length)continue;
        // Nonterminal calls use this exact parameter as an index. This rejects
        // a payload-testing helper even if it happens to return early.
        const parameter=read.activationId!==compare.activationId&&own.find(p=>defs.get(p.access?.instructionId)?.functionId===defs.get(compare.instructionId)?.functionId&&
          walk(defs.get(p.access?.instructionId)?.expression).some(n=>n.kind==='ArraySubscriptExpr'&&signature(n.children[1])===signature(operandNode)));
        const transported=own.find(p=>(p.access.addressInputs??[]).flatMap(id=>valueFlow.chain(id)).some(e=>
          defs.get(e.instructionId)?.functionId===defs.get(compare.instructionId)?.functionId&&
          signature(defs.get(e.instructionId)?.expression)===signature(operandNode)));
        let terminal=null,support=null,reason=null,exclusion=false;
        if(parameter||read.activationId===compare.activationId){
          if(['WhileStmt','ForStmt','DoStmt'].includes(bd?.controlKind)&&number(branch.condition)===0){terminal=branch;reason='observed loop exit';}
          else for(let i=pos.get(branch.eventId)+1;i<events.length;i++){
            const e=events[i];if(e.activationId!==branch.activationId)continue;
            const selectedReturn=branch.action==='conditional'&&['return.value','return'].includes(e.action)&&
              (e.inputEvaluations??[]).some(v=>v.nodeId===branch.evaluation?.nodeId&&v.decisionExecutionIds?.includes(branch.eventId));
            if(['return.value','return','break','continue'].includes(e.action)&&(e.controlInputs?.includes(branch.eventId)||selectedReturn)){terminal=e;reason='observed controlled traversal exit';break;}
            if(['call','branch','loop.next','frame.end'].includes(e.action)||e.kind==='WRITE')break;
          }
          if(terminal)support=parameter||own.find(p=>p.read.activationId===read.activationId)||transported;
        }
        // A guard may skip an enqueue, not the entire function. Require a
        // witnessed opposite branch carrying the same compiler operand into
        // an actual traversal, including intervening work-list writes/reads.
        if(!terminal&&bd?.controlKind==='IfStmt'){
          const selectedWork=events.slice(pos.get(branch.eventId)+1).filter(e=>e.activationId===branch.activationId&&(()=>{
            const loc=defs.get(e.instructionId)?.source;return loc?.file===bd.statementSource?.file&&loc.start?.byte>=bd.conditionSource?.end?.byte&&loc.end?.byte<=bd.statementSource?.end?.byte;
          })());
          // An alternative cursor assignment continues traversal; it is not
          // the empty path of a guarded enqueue/access.
          const nextBranch=branches.find(b=>b.instructionId===branch.instructionId&&pos.get(b.eventId)>pos.get(branch.eventId));
          if(selectedWork.some(e=>(!nextBranch||pos.get(e.eventId)<pos.get(nextBranch.eventId))&&(e.kind==='WRITE'||e.action==='call')))continue;
          support=own.find(p=>{
            // A copied link may be read before the guard. The guarded consumer
            // (argument/index transfer) supplies control evidence in that case.
            const transfers=(p.access.addressInputs??[]).flatMap(id=>valueFlow.chain(id));
            const witnesses=[p.read,p.access,...transfers];
            return witnesses.some(e=>(e.controlInputs??[]).some(id=>{
              const b=byId.get(id);if(b?.instructionId!==branch.instructionId||b.selected===branch.selected)return false;
              const compared=(b.dataInputs??[]).map(id=>byId.get(id)).find(e=>e?.kind==='CALC'),
                tested=compared?.steps?.find(s=>s.nodeId===step.nodeId),
                operandRead=tested&&valueFlow.sourceReadOperand(tested.inputs?.[side],compared,tested);
              // A write after the guard (e.g. creating a missing child) is not
              // the guarded link. Require the very same dynamic source read.
              return operandRead&&valueFlow.reads(operandRead.eventId).some(r=>r.eventId===p.read.eventId||
                r.target?.objectId===p.read.target?.objectId&&r.target.offset===p.read.target.offset&&r.target.size===p.read.target.size&&
                r.dataInputs?.length===1&&p.read.dataInputs?.length===1&&r.dataInputs[0]===p.read.dataInputs[0]&&
                byId.get(r.dataInputs[0])?.kind==='WRITE');
            }));
          });
          if(support){terminal=branch;reason='observed guard skips traversal transfer';}
        }
        if(!terminal&&['WhileStmt','ForStmt'].includes(bd?.controlKind)&&number(branch.condition)!==0){
          support=own.find(p=>p.access.controlInputs?.includes(branch.eventId)&&
            (p.access.addressInputs??[]).some(id=>valueFlow.reads(id).some(r=>r.eventId===near.eventId||valueFlow.chain(r.eventId).at(-1)?.eventId===valueFlow.chain(near.eventId).at(-1)?.eventId)));
          if(support){terminal=branch;exclusion=true;reason='executed guard admits traversal and excludes the complementary stored boundary';}
        }
        if(!terminal||!support)continue;
        // Never use future evidence at an earlier query point.
        const evidence=[terminal.eventId,support.targetAccessExecutionId],executionId=evidence.reduce((a,b)=>pos.get(a)>pos.get(b)?a:b);
        out.push({...slot,executionId,readExecutionId:read.eventId,operandReadExecutionId:near.eventId,
          comparisonExecutionId:compare.eventId,branchExecutionId:branch.eventId,comparisonNodeId:step.nodeId,
          supportExecutionId:support.targetAccessExecutionId,terminalExecutionId:terminal.eventId,
          predicate:{kind:'stored-boundary',operator:side===0?operator:reverse[operator],constant,result:exclusion?number(step.value)===0:number(step.value)!==0},
          mode:exclusion?'guard-exclusion':parameter?'guard-before-access':'stored-value-check',evidence:reason});
      }
    }
  }
  return out;
}
