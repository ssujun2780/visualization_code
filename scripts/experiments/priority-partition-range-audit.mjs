import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {cases} from '../../tests/fixtures/priority-partition-range.mjs';
import {traceModel} from '../model/index.mjs';
import {inferStructures,createInferenceView} from '../inference/index.mjs';
const base='test-results/priority-partition-range-2026-11-12',sources='example/c/codex_code/priority_partition_range_20261112';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
await fs.mkdir(base,{recursive:true});await fs.mkdir(sources,{recursive:true});
if(process.argv.includes('--capture')){
 const manifest=cases.map(c=>({id:c.id,family:c.family,stdout:c.stdout,expected:c.expected,sourceHash:hash(c.source)}));
 await fs.writeFile(path.join(base,'expectations.json'),JSON.stringify(manifest,null,2));
 const hashes={};for(const name of await fs.readdir('scripts/model'))if(name.endsWith('.mjs'))hashes[name]=hash(await fs.readFile(path.join('scripts/model',name)));
 await fs.writeFile(path.join(base,'model-before.json'),JSON.stringify(hashes,null,2));
 for(const c of cases){await fs.writeFile(path.join(sources,`${c.id}.c`),c.source);const r=await traceModel(c.source,{filename:`${c.id}.c`,includeObservations:true});
  await fs.writeFile(path.join(base,`${c.id}.execution.json`),JSON.stringify(r));
  console.log(c.id,JSON.stringify({status:r.trace?.status,stdout:r.stdout,match:r.stdout===c.stdout,diagnostics:r.trace?.diagnostics}));}
}
const report=[];
await fs.writeFile(path.join(base,'expectations-reviewed.json'),JSON.stringify(cases.map(c=>({id:c.id,stdout:c.stdout,expected:c.expected,sourceHash:hash(c.source)})),null,2));
for(const c of cases){const r=JSON.parse(await fs.readFile(path.join(base,`${c.id}.execution.json`))),before=hash(JSON.stringify(r));
 if(r.trace?.status!=='completed'){report.push({id:c.id,status:r.trace?.status});continue;}
 const i=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});
 if(hash(JSON.stringify(r))!==before)throw Error('execution mutated');
 await fs.writeFile(path.join(base,`${c.id}.inference.json`),JSON.stringify(i));
 const v=createInferenceView(r,i),summary={id:c.id,status:i.status,stdout:r.stdout,stdoutMatches:r.stdout===c.stdout,diagnostics:i.diagnostics,kinds:Object.fromEntries([...new Set(i.structures.map(s=>s.kind))].map(k=>[k,i.structures.filter(s=>s.kind===k).length])),trees:i.structures.filter(s=>s.kind==='index-tree').map(s=>({descriptor:s.descriptor,direction:s.direction,active:s.states.at(-1)?.activeRange})),semantics:i.structures.filter(s=>['representative-partition-candidate','range-aggregate-candidate'].includes(s.kind)).map(s=>({kind:s.kind,status:s.states.at(-1)?.status,view:s.states.at(-1)?.view,groups:s.states.at(-1)?.groups,ranges:s.states.at(-1)?.nodes.filter(n=>n.coverage).map(n=>({index:n.index,coverage:n.coverage,value:n.value?.decimal}))}))};
 report.push(summary);console.log(JSON.stringify(summary));
}
await fs.writeFile(path.join(base,process.argv.includes('--capture')?'baseline.json':'actual.json'),JSON.stringify(report,null,2));
