import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const base=path.join(root,'test-results/codex_code-results/end_to_end_audit_20261113');
const reports=[],inspections=[];
for(const entry of await fs.readdir(base,{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 try{reports.push(JSON.parse(await fs.readFile(path.join(base,entry.name,'report.json'))));}catch{}
 try{inspections.push(JSON.parse(await fs.readFile(path.join(base,entry.name,'replay-inspection.json'))));}catch{}
}
const stats={
 runs:reports.length,events:reports.reduce((n,r)=>n+r.events,0),
 checks:reports.reduce((n,r)=>n+r.checks.length,0),
 failedChecks:reports.reduce((n,r)=>n+r.checks.filter(x=>!x.pass).length,0),
 playable:reports.filter(r=>r.checks.some(c=>c.name==='replay cursor'&&c.pass)).length,
 modelCompleted:reports.filter(r=>r.status==='completed').length,
 inferencePartial:reports.filter(r=>r.inference.status!=='completed').map(r=>r.id),
 workErrors:reports.filter(r=>r.relationsDiagnostics?.some(d=>d.code==='invalid-relation-evidence')).map(r=>r.id),
 inspectionCases:inspections.length,readComparisons:inspections.reduce((n,r)=>n+r.comparedReads,0),
 drawSamples:inspections.reduce((n,r)=>n+r.sampledEvents,0),inspectionIssues:inspections.reduce((n,r)=>n+r.issues.length,0)
};
const cases=reports.map(r=>({id:r.id,status:r.status,events:r.events,objects:r.objects,frames:r.frames,
 failed:r.checks.filter(c=>!c.pass),stages:r.stages.map(s=>({name:s.name,ms:s.ms,error:s.error})),
 inferenceStatus:r.inference.status,inferenceDiagnostics:r.inference.diagnostics,
 workDiagnostics:r.relationsDiagnostics,wireBytes:r.wireBytes,inferenceBytes:r.inferenceBytes,
 prepared:r.prepared,peakMiB:Math.max(...r.stages.map(s=>s.maxRssKiB??0))/1024
}));
await fs.writeFile(path.join(base,'summary.json'),JSON.stringify({stats,cases},null,2));
const rows=cases.map(r=>{
 const ms=name=>(r.stages.find(s=>s.name===name)?.ms/1000).toFixed(3);
 return '| '+[r.id,r.events,ms('model'),ms('inference'),ms('execution-relations'),ms('prepare'),(r.prepared?.bytes/1e6).toFixed(3),r.failed.map(x=>x.name).join(', ')||'없음'].join(' | ')+' |';
});
await fs.writeFile(path.join(base,'timings.md'),'| 사례 | 사건 | 생성 초 | 추론·검사·저장 초 | 작업 분석 초 | 표현 준비·저장 초 | 준비 JSON MB | 기본 검사 불일치 |\n|---|---:|---:|---:|---:|---:|---:|---|\n'+rows.join('\n')+'\n');
console.log(stats);
