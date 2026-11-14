import fs from 'node:fs/promises';import crypto from 'node:crypto';
const root=new URL('../../../../',import.meta.url),base=new URL('test-results/codex_code-results/human-style-2026-11-06/',root);
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8')),rows=[],evidence={};
const json=async url=>JSON.parse(await fs.readFile(url,'utf8'));
for(const c of suite.cases){
 let dir=new URL(c.id+'/',base);const initial=await json(new URL('report.json',dir));
 const expanded=await fs.stat(new URL('expanded-budget/report.json',dir)).catch(()=>null);if(expanded)dir=new URL('expanded-budget/',dir);
 const r=await json(new URL('report.json',dir)),t=await json(new URL('trace.json',dir)),p=await json(new URL('plan.json',dir)),dm=new Map(p.instructions.map(d=>[d.id,d]));
 const process=await json(new URL('process-audit.json',dir));
 const unbound=(t.coverage.unboundSourceWork??[]).map(u=>({nodeId:u.nodeId,kind:u.kind,expression:u.source?.expression,line:u.source?.line,reason:u.reason}));
 const row={id:c.id,title:c.title,status:r.status,events:r.events,sourceSHA:c.sha256,predictionPrecedesExecution:Date.parse(c.createdAt)<=Date.parse(initial.started),checks:r.checks.length,failed:r.failed,untyped:r.reviewCandidates?.untyped.length??0,unbound,processFindings:process.findings,expandedBudget:!!expanded,initialStatus:initial.status};rows.push(row);
 if(unbound.length||row.untyped||['39_pushback_input','55_unbuffered_input','37_buffered_output','59_multiline_vla_return','63_multiline_scalar_control','64_vla_format_control'].includes(c.id)){
  evidence[c.id]={unbound,untyped:r.reviewCandidates?.untyped,returns:t.events.filter(e=>e.action==='return').map(e=>({eventId:e.eventId,instructionId:e.instructionId,sourceNodeId:dm.get(e.instructionId)?.sourceNodeId,line:dm.get(e.instructionId)?.source?.line,expression:dm.get(e.instructionId)?.source?.expression})),inputs:t.events.filter(e=>e.action==='input').map(e=>({eventId:e.eventId,bytesHex:e.bytesHex,byteLength:e.byteLength,callExecutionId:e.callExecutionId})),inputReturns:t.events.filter(e=>e.action==='resume'&&t.events.find(c=>c.eventId===e.callExecutionId)?.callee==='@getchar').map(e=>({eventId:e.eventId,value:e.value?.decimal,dataInputs:e.dataInputs,readRegions:e.readRegions})),sourceOutput:t.coverage.stdioOutput};
 }
}
const before=await json(new URL('model-before.json',base)),after={},changes=[];
for(const [file,hash]of Object.entries(before)){after[file]=crypto.createHash('sha256').update(await fs.readFile(new URL(file,root))).digest('hex');if(hash!==after[file])changes.push(file);}
const summary={generatedAt:new Date().toISOString(),cases:rows.length,completed:rows.filter(r=>r.status==='completed').length,nativeValidated:rows.length,predictionsWrittenBeforeExecution:rows.every(r=>r.predictionPrecedesExecution),publicEvents:rows.reduce((n,r)=>n+r.events,0),checks:rows.reduce((n,r)=>n+r.checks,0),automatedMismatches:rows.filter(r=>r.failed.length).map(r=>({id:r.id,failed:r.failed})),processFindings:rows.reduce((n,r)=>n+r.processFindings.length,0),modelFilesChecked:Object.keys(before).length,changedModelFiles:changes,rows};
await fs.writeFile(new URL('summary.json',base),JSON.stringify(summary,null,2)+'\n');await fs.writeFile(new URL('finding-evidence.json',base),JSON.stringify(evidence,null,2)+'\n');await fs.writeFile(new URL('model-after.json',base),JSON.stringify(after,null,2)+'\n');
const table=rows.map(r=>`| ${r.id} | ${r.status} | ${r.events} | ${r.unbound.length} | ${r.untyped} |`).join('\n');
await fs.writeFile(new URL('case-index.md',base),'# 사례별 결과\n\n미연결·자료형 수는 조사 후보이며 자동으로 실행 오류를 뜻하지 않습니다. 45번은 확장 한도 결과를 사용합니다.\n\n| 사례 | 상태 | 공개 사건 | 미연결 소스 항목 | C 자료형 없는 READ |\n|---|---|---:|---:|---:|\n'+table+'\n');
console.log(JSON.stringify({...summary,rows:undefined}));
