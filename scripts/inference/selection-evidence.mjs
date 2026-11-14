import {num,unique} from './storage-semantics.mjs';
// Preserve the observed selector and BOTH comparison operands. This does not
// execute a comparator or infer its unobserved paths from equal numeric values.
export function selectionEvidence(c,inputIds){
 const pending=[...(inputIds??[])],seen=new Set(),selected=[];
 while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const e=c.byId.get(id);if(!e)continue;
  if(e.kind==='READ'){
   selected.push(e);if(c.arrayAt(e.target))continue;
  }
  if(e.kind==='FLOW'&&e.action!=='resume')continue;
  if(e.kind==='CALC'||e.kind==='READ'||e.kind==='WRITE'||e.action==='resume')pending.push(...e.dataInputs??[]);
 }
 const out=[];
 for(const read of selected)for(const control of read.controlInputs??[]){const b=c.byId.get(control);if(!['conditional','branch'].includes(b?.action))continue;
  for(const id of b.dataInputs??[]){const calc=c.byId.get(id);if(calc?.kind!=='CALC')continue;
   for(const s of calc.steps??[]){if(!['<','<=','>','>='].includes(s.operator)||s.inputs?.length!==2)continue;
    const operands=s.inputs.map(i=>c.flow.sourceReadOperand(i,calc,s));if(operands.some(x=>!x))continue;
    const matched=operands.map(r=>c.identity(r.eventId,read.eventId));if(matched.filter(Boolean).length!==1)continue;
    const position=matched[0]?0:1,truth=num(s.value)!==0,
     smaller=s.operator.startsWith('<')?truth?0:1:truth?1:0;
    const sources=unique(operands.flatMap(r=>c.reads([r.eventId]).map(r=>r.eventId)));
    out.push({kind:position===smaller?'min':'max',comparisonExecutionId:calc.eventId,sourceNodeId:s.nodeId,controlExecutionId:b.eventId,
     selectedReadExecutionId:read.eventId,operandReadExecutionIds:operands.map(r=>r.eventId),sourceReadExecutionIds:sources});
   }
  }
 }
 return [...new Map(out.map(p=>[`${p.comparisonExecutionId}:${p.sourceNodeId}`,p])).values()];
}
