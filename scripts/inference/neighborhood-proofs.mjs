// Neighbour storage adapters. No algorithm names, source text or guessed reads.
import {createValueFlow} from './observed-value-flow.mjs';
const num=v=>Number(v?.decimal??v?.unsigned??v?.signed);
export function neighborhoodProofs(plan,trace,flow){
  const {events,structures}=trace,defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),
    arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),work=structures.find(s=>s.kind==='array-work'),
    accesses=new Map((work?.accesses??[]).map(a=>[a.executionId,a])),deps=structures.find(s=>s.kind==='storage-dependencies'),result=[];
  const origin=id=>flow.chain(id).at(-1)?.eventId,
    axis=(a,n)=>a?.cursors?.filter(c=>a.axes?.find(x=>x.axis===n)?.indexDeclarationIds?.includes(c.declarationId))??[],
    sameAxis=(a,n,b,m=0)=>axis(a,n).some(x=>axis(b,m).some(y=>origin(x.executionId)===origin(y.executionId))),
    reads=(input,event,step)=>flow.dependencyReads(input,event,step,new Set(),()=>true),
    scalar=a=>a&&a.elementType?.kind!=='array'&&a.elementType?.kind!=='record';
  function matrix(source,target,gate,extra={}){
    const m=accesses.get(source.eventId),t=accesses.get(target.eventId),a=arrays.get(t?.target.arrayId),coordinates=m?.target.coordinates;
    if(coordinates?.length!==2||!scalar(a)||t.target.size!==a.elementBytes||!sameAxis(m,1,t)||
      coordinates[0]>=a.capacity||coordinates[1]!==t.target.index||m.target.arrayId===a.id)return;
    result.push({array:a,proof:{kind:'matrix-gated-access',executionId:gate.eventId,targetAccessExecutionId:target.eventId,
      sourceReadExecutionId:source.eventId,fromIndex:coordinates[0],toIndex:coordinates[1],sourceSlots:[source.target],
      sourceReads:[{source:source.target,executionId:source.eventId}],properties:[],transforms:[],
      evidenceExecutionIds:[source.eventId,target.eventId,gate.eventId],...extra}});
  }
  for(const e of events)if(e.kind==='CALC')for(const step of e.steps??[]){
    if(step.operator!=='&&'||step.inputs.length!==2||!num(step.inputs[0].value))continue;
    const left=reads(step.inputs[0],e,step),right=reads(step.inputs[1],e,step);
    const cells=left.filter(r=>accesses.get(r.eventId)?.target.coordinates?.length===2);
    if(cells.length!==1)continue;
    for(const target of right)matrix(cells[0],target,e,{guard:{kind:'short-circuit',nodeId:step.nodeId}});
  }
  for(const target of events)if(['READ','WRITE'].includes(target.kind)&&accesses.has(target.eventId)){
    for(const id of target.controlInputs??[]){const gate=byId.get(id);
      if(gate?.action!=='branch'||defs.get(gate.instructionId)?.controlKind!=='IfStmt'||!num(gate.condition))continue;
      const cells=(gate.dataInputs??[]).flatMap(id=>reads({executionId:id},gate)).filter(r=>accesses.get(r.eventId)?.target.coordinates?.length===2);
      if(cells.length===1)matrix(cells[0],target,target,{guard:{kind:'branch',executionId:gate.eventId},evidenceExecutionIds:[cells[0].eventId,gate.eventId,target.eventId]});
    }
  }
  for(const r of deps?.relations??[]){
    if(!r.preserved||!r.targetArrayId)continue;
    const source=byId.get(r.sourceReadExecutionId),target=byId.get(r.targetAccessExecutionId),m=accesses.get(source?.eventId),a=arrays.get(r.targetArrayId),coords=m?.target.coordinates;
    if(coords?.length!==2||!scalar(a)||r.target.size!==a.elementBytes||r.sourceArrayId===a.id||coords[0]>=a.capacity)continue;
    for(const id of source.controlInputs??[]){const branch=byId.get(id);
      if(!['ForStmt','WhileStmt'].includes(defs.get(branch?.instructionId)?.controlKind)||!num(branch.condition)||!target.controlInputs?.includes(branch.eventId))continue;
      for(const calcId of branch.dataInputs??[]){const calc=byId.get(calcId);for(const step of calc?.steps??[]){
        if(step.operator!=='<'||step.inputs.length!==2)continue;
        const counters=reads(step.inputs[0],calc,step),bounds=reads(step.inputs[1],calc,step);
        if(!counters.some(r=>axis(m,1).some(c=>origin(c.executionId)===origin(r.eventId))))continue;
        for(const bound of bounds){const b=accesses.get(bound.eventId);
          if(!b||b.target.coordinates?.length!==1||!sameAxis(m,0,b)||coords[1]>=num(bound.value))continue;
          result.push({array:a,proof:{kind:'counted-row-access',executionId:target.eventId,fromIndex:coords[0],toIndex:r.targetIndex,
            sourceReadExecutionId:source.eventId,targetAccessExecutionId:target.eventId,relationId:r.id,countReadExecutionId:bound.eventId,branchExecutionId:branch.eventId,
            sourceSlots:[source.target,bound.target],properties:[],transforms:[],sourceReads:[{source:source.target,executionId:source.eventId},{source:bound.target,executionId:bound.eventId}],
            evidenceExecutionIds:[source.eventId,bound.eventId,branch.eventId,target.eventId]}});
        }
      }}
    }
  }
  return result;
}

const validationFlows=new WeakMap();
export function validateNeighborhoodProof(p,{events,accesses,relations,fail,trace}){
  if(!validationFlows.has(events))validationFlows.set(events,createValueFlow({instructions:[]},trace??{events:[...events.values()]}));
  const flow=validationFlows.get(events),origin=id=>flow.chain(id).at(-1)?.eventId,
    axis=(a,n)=>a?.cursors?.filter(c=>a.axes?.find(x=>x.axis===n)?.indexDeclarationIds.includes(c.declarationId))??[],
    sameAxis=(a,n,b,m=0)=>axis(a,n).some(x=>axis(b,m).some(y=>origin(x.executionId)===origin(y.executionId))),
    reads=(input,event,step)=>flow.dependencyReads(input,event,step,new Set(),()=>true);
  const source=events.get(p.sourceReadExecutionId),target=events.get(p.targetAccessExecutionId),m=accesses.get(source?.eventId),t=accesses.get(target?.eventId);
  if(source?.kind!=='READ'||m?.target.coordinates?.length!==2||m.target.coordinates[0]!==p.fromIndex||t?.target.index!==p.toIndex)fail('인접 저장소의 원래 좌표가 다릅니다.');
  if(p.kind==='counted-row-access'){
    const r=relations.get(p.relationId),bound=events.get(p.countReadExecutionId),b=accesses.get(bound?.eventId),branch=events.get(p.branchExecutionId);
    if(r?.sourceReadExecutionId!==source.eventId||r.targetAccessExecutionId!==target.eventId||bound?.kind!=='READ'||b?.target.index!==p.fromIndex||
      m.target.coordinates[1]>=num(bound.value)||!num(branch?.condition)||!source.controlInputs?.includes(branch.eventId)||!target.controlInputs?.includes(branch.eventId)||!sameAxis(m,0,b))fail('행별 개수와 목적지 전달의 근거가 다릅니다.');
    if(!(branch.dataInputs??[]).some(id=>{const e=events.get(id);return e?.steps?.some(step=>step.operator==='<'&&
      reads(step.inputs[0],e,step).some(r=>axis(m,1).some(c=>origin(c.executionId)===origin(r.eventId)))&&reads(step.inputs[1],e,step).some(r=>r.eventId===bound.eventId));}))fail('행별 개수의 반복 조건이 다릅니다.');
  }else{
    if(m.target.coordinates[1]!==p.toIndex||!sameAxis(m,1,t))fail('행렬의 목적지 축이 다릅니다.');
    const gate=events.get(p.guard?.executionId??p.executionId);
    if(p.guard?.kind==='short-circuit'){
      const step=gate?.steps?.find(s=>s.nodeId===p.guard.nodeId);
      if(gate?.kind!=='CALC'||step?.operator!=='&&'||step.inputs.length!==2||!num(step.inputs[0].value)||
        !reads(step.inputs[0],gate,step).some(r=>r.eventId===source.eventId)||!reads(step.inputs[1],gate,step).some(r=>r.eventId===target.eventId))fail('행렬의 단락 평가 근거가 다릅니다.');
    }else if(p.guard?.kind!=='branch'||gate?.action!=='branch'||!num(gate.condition)||!target.controlInputs?.includes(gate.eventId)||
      !(gate.dataInputs??[]).some(id=>reads({executionId:id},gate).some(r=>r.eventId===source.eventId)))fail('행렬의 실행 분기 근거가 다릅니다.');
  }
}
