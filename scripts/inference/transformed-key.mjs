import {recordedIntegerExpression,mapIntegerInputs,evaluateIntegerExpression} from './integer-expression.mjs';
export function transformedKeyOperand(c,input,event,step){
 const expr=recordedIntegerExpression(c,input,event,step,read=>{const o=c.origin(read.target,c.pos.get(read.eventId)),field=o&&c.fieldAt(o.range,o.at);return field?{...o,field,cell:c.cell(o.range),readExecutionId:read.eventId}:null;});
 if(!expr||expr.tree.kind!=='operation'||expr.tree.operator==='cast'||!expr.leaves.length||new Set(expr.leaves.map(x=>x.field.node.id)).size!==1)return null;
 const transform=mapIntegerInputs(expr.tree,n=>{const f=expr.leaves[n.slot].field;return {kind:'field',offset:f.offset,size:f.size,type:n.type};}),first=expr.leaves[0];
 return {...first,transform,transformedReads:expr.leaves.map(x=>({range:x.range,readExecutionId:x.readExecutionId,copyExecutionIds:x.copyExecutionIds})),transformEvidenceExecutionIds:expr.evidenceExecutionIds};
}
export function transformedKeyValue(c,component,range,at){
 const base=range.offset-component.offset;
 return evaluateIntegerExpression(component.transform,n=>c.payloadScalar({objectId:range.objectId,offset:base+n.offset,size:n.size},at,{signed:n.type.signedness!=='unsigned',type:n.type}));
}
