import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const base=path.join(root,'test-results/codex_code-results');
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8'));
const rows=[],details=[];
for(const spec of suite.cases){
 const row={id:spec.id,file:spec.file,style:spec.style,intent:spec.intent,inputs:[],inferenceKinds:[],inferenceViews:[]};
 for(const input of spec.inputs){
  const directory=path.join(base,spec.id,input.id),r=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  const item={id:input.id,status:r.status,nativePass:r.native.length===2&&r.native.every(x=>x.agrees),plainWasmPass:r.plainWasm?.agrees===true,
   processAssessment:r.processAssessment??null,events:r.events??0,failedChecks:r.failedChecks?.map(x=>x.name)??[],error:r.error?.split('\n')[0]??null,
   sourceHashMatches:crypto.createHash('sha256').update(await fs.readFile(new URL(spec.file,import.meta.url))).digest('hex')===r.sourceSha256,
   missingHints:r.inference.hints?.filter(x=>!x.found).map(x=>x.hint)??[],unexpected:r.inference.unexpected??[]};
  row.inputs.push(item);details.push({caseId:spec.id,...item});
  row.inferenceKinds.push(...r.inference.kinds??[]);row.inferenceViews.push(...r.inference.views??[]);
 }
 row.inferenceKinds=[...new Set(row.inferenceKinds)];row.inferenceViews=[...new Set(row.inferenceViews)];rows.push(row);
}
const before=JSON.parse(await fs.readFile(path.join(base,'model-before.json'),'utf8')),hashes={},changed=[];
for(const [file,hash]of Object.entries(before.hashes)){hashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');if(hashes[file]!==hash)changed.push(file);}
const after={time:new Date().toISOString(),hashes,changed,unchanged:changed.length===0};
await fs.writeFile(path.join(base,'model-after.json'),JSON.stringify(after,null,2)+'\n');
const summary={generatedAt:new Date().toISOString(),sources:rows.length,inputs:details.length,nativeValid:details.filter(x=>x.nativePass).length,
 plainWasmValid:details.filter(x=>x.plainWasmPass).length,completed:details.filter(x=>x.status==='completed').length,
 checkedProcessMatches:details.filter(x=>x.processAssessment==='checked-process-matches').length,
 completedWithMismatch:details.filter(x=>x.status==='completed'&&x.processAssessment==='mismatch').length,
 exceptions:details.filter(x=>x.status==='tool-or-model-exception').length,events:details.reduce((n,x)=>n+x.events,0),
 staleSources:details.filter(x=>!x.sourceHashMatches),unchangedModel:after.unchanged,hashedModelFiles:Object.keys(hashes).length,
 statusMeaning:'checkedProcessMatches covers stdout, selected exact write sequences, selected call counts and API coverage, not every animation or all possible inputs',rows};
await fs.writeFile(path.join(base,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const table=['| 코드 | 입력 수 | 중간언어 완료 | 과정 검사 일치 | 오류/누락 |','|---|---:|---:|---:|---|'];
for(const r of rows)table.push(`| [${r.id}](../../example/c/codex_code/${r.file}) | ${r.inputs.length} | ${r.inputs.filter(i=>i.status==='completed').length} | ${r.inputs.filter(i=>i.processAssessment==='checked-process-matches').length} | ${[...new Set(r.inputs.flatMap(i=>i.error?[i.error]:i.failedChecks))].join('; ')||'선택한 검사에서 없음'} |`);
await fs.writeFile(path.join(base,'CASE_RESULTS.md'),'# 예제별 결과\n\n'+table.join('\n')+'\n\n전체 목록의 통과는 모든 시각화 과정에 대한 완전성 증명이 아닙니다. 자료구조 추론 결과는 별도로 IMPROVEMENTS.md에 기록했습니다.\n');
console.log(JSON.stringify({...summary,rows:undefined}));
