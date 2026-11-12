// A completed [0,bound) scan can describe the current logical range even when
// the program never inserts/removes elements. Values and maxima are not proof.
const unwrap=n=>{while(n&&['ImplicitCastExpr','CStyleCastExpr','ParenExpr'].includes(n.kind))n=n.children?.[0];return n;};
const number=v=>{const n=Number(v?.decimal??v?.signed??v?.unsigned??NaN);return Number.isSafeInteger(n)?n:null;};
const overlap=(a,b)=>a&&b&&a.objectId===b.objectId&&a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
export function observedArrayPrefixes(plan,{events,valueFlow},array,{start=0}={}){
  const defs=new Map(plan.instructions.map(d=>[d.id,d])),byId=new Map(events.map(e=>[e.eventId,e])),pos=new Map(events.map((e,i)=>[e.eventId,i])),rounds=new Map(),proofs=[];
  for(const branch of events){if(branch.action!=='branch'||!['ForStmt','WhileStmt','DoStmt'].includes(defs.get(branch.instructionId)?.controlKind))continue;
    const calc=(branch.dataInputs??[]).map(id=>byId.get(id)).find(e=>e?.kind==='CALC'),ast=unwrap(defs.get(calc?.instructionId)?.expression),
      step=calc?.steps?.find(s=>s.nodeId===ast?.nodeId),op=step?.operator;
    if(!['<','<=','>','>='].includes(op))continue;
    const side=op.startsWith('<')?1:0,indexNode=unwrap(ast.children[1-side]),boundNode=unwrap(ast.children[side]);
    if(indexNode?.kind!=='DeclRefExpr'||!['DeclRefExpr','MemberExpr'].includes(boundNode?.kind))continue;
    const read=valueFlow.sourceReadOperand(step.inputs[side],calc,step),index=number(step.inputs[1-side].value),raw=number(step.inputs[side].value),
      count=raw===null?null:raw+(op.endsWith('=')?1:0),k=`${branch.activationId}:${branch.instructionId}`;
    if(!read?.target||count===null||count<0||count>array.capacity||index===null)continue;
    if(index===start)rounds.set(k,{count,source:read.target,branches:[],indexDeclarationId:indexNode.declarationId,read});
    const round=rounds.get(k);if(!round||round.count!==count)continue;
    if(number(branch.condition)!==0){round.branches.push({event:branch,index});continue;}
    rounds.delete(k);
    if(index!==count||count<=start||round.branches.length!==count-start||round.branches.some((b,i)=>b.index!==start+i))continue;
    const reads=round.branches.map(({event,index})=>events.find(e=>{
      const expr=unwrap(defs.get(e.instructionId)?.expression);
      return e.kind==='READ'&&e.controlInputs?.includes(event.eventId)&&e.target?.objectId===array.objectId&&
        e.target.offset===array.range.offset+index*array.elementBytes&&e.target.size===array.elementBytes&&
        expr?.kind==='ArraySubscriptExpr'&&unwrap(expr.children[1])?.declarationId===round.indexDeclarationId;
    }));
    if(reads.some(r=>!r))continue;
    proofs.push({count,start,scanInstructionId:branch.instructionId,countSource:{...round.source},countReadExecutionId:round.read.eventId,
      countSources:valueFlow.reads(round.read.eventId).filter(r=>r.target).map(r=>({range:r.target,executionId:r.eventId})),afterExecutionId:branch.eventId,
      evidenceExecutionIds:[branch.eventId,calc.eventId,round.read.eventId,...reads.map(r=>r.eventId)],scope:'observed completed prefix scan; container intent unconfirmed'});
  }
  const writes=events.filter(e=>['WRITE','SPACE'].includes(e.kind));
  return {proofs,at(id){const at=pos.get(id),latest=new Map();
    for(const p of proofs)if(pos.get(p.afterExecutionId)<=at)latest.set(p.scanInstructionId,p);
    const valid=[...latest.values()].filter(p=>!writes.some(e=>pos.get(e.eventId)<=at&&p.countSources.some(r=>pos.get(e.eventId)>pos.get(r.executionId)&&
      overlap(r.range,e.target??(e.memoryState&&e.objectId?{objectId:e.objectId,offset:0,size:e.memoryState.byteLength}:null)))));
    const counts=new Set(valid.map(p=>p.count));return counts.size===1?valid.at(-1):null;
  }};
}
