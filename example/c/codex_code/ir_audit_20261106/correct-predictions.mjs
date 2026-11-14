import fs from 'node:fs/promises';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const corrections=[
 {id:'01_comma_conditional',field:'checks.writes.a',before:['10'],after:['5','10'],reason:'Tag is line-wide: the predicted x+=3 writes5 before a gets10. Original prose already predicts both. Harness omitted the first write; not a model defect.'},
 {id:'07_overlap_memmove',field:'stdout',before:'aXbcdef 5\n',after:'aXbcdef 4\n',reason:'Manual character indexing error. In aXbcdef, d is at zero-based4. Both GCC O0 and O2 disagree with original prediction; the model was not executed for this case.'}
];
for(const correction of corrections){const c=suite.cases.find(c=>c.id===correction.id);c.predictionCorrection={...correction,correctedAt:new Date().toISOString()};if(c.id.startsWith('01_'))c.checks.writes.a=correction.after;else{c.stdout=correction.after;c.process[1]='s becomes aXbcdef; memchr returns s+4; one copy with correct pre-copy snapshot.';}}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');
await fs.writeFile(new URL('../../../../test-results/ir-audit-2026-11-06/oracle-corrections.json',import.meta.url),JSON.stringify(corrections,null,2)+'\n');
