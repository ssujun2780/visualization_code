import fs from 'node:fs/promises';import crypto from 'node:crypto';
import {boundaryCases} from '../../tests/fixtures/structure-boundaries.mjs';
import {traceModel} from '../model/index.mjs';import {inferStructures} from '../inference/index.mjs';
const dir='test-results/structure-boundaries-2026-11-12',src='example/c/codex_code/structure_boundaries_20261112',hash=x=>crypto.createHash('sha256').update(x).digest('hex');
await fs.mkdir(dir,{recursive:true});await fs.mkdir(src,{recursive:true});
if(process.argv.includes('--capture')){
 await fs.writeFile(`${dir}/expected.json`,JSON.stringify(boundaryCases.map(c=>({id:c.id,area:c.area,stdout:c.stdout,expect:c.expect,sourceHash:hash(c.source)})),null,2),{flag:'wx'});
 const before={};for(const n of await fs.readdir('scripts/model'))if(n.endsWith('.mjs'))before[n]=hash(await fs.readFile(`scripts/model/${n}`));await fs.writeFile(`${dir}/model-before.json`,JSON.stringify(before,null,2),{flag:'wx'});
}
const results=[];for(const c of boundaryCases){
 await fs.writeFile(`${src}/${c.id}.c`,c.source);let r;try{r=JSON.parse(await fs.readFile(`${dir}/${c.id}.execution.json`));}catch{r=await traceModel(c.source,{filename:`${c.id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${c.id}.execution.json`,JSON.stringify(r));}
 if(r.trace?.status!=='completed'||r.stdout!==c.stdout){results.push({id:c.id,status:r.trace?.status,stdout:r.stdout,expected:c.stdout});console.log(JSON.stringify(results.at(-1)));continue;}
 const before=hash(JSON.stringify(r)),i=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});if(before!==hash(JSON.stringify(r)))throw Error('IR changed');
 await fs.writeFile(`${dir}/${c.id}.inference.json`,JSON.stringify(i));const result={id:c.id,status:i.status,diagnostics:i.diagnostics,kinds:Object.fromEntries([...new Set(i.structures.map(s=>s.kind))].map(k=>[k,i.structures.filter(s=>s.kind===k).length]))};results.push(result);console.log(JSON.stringify(result));
}
await fs.writeFile(`${dir}/${process.argv.includes('--capture')?'baseline':'actual'}.json`,JSON.stringify(results,null,2));
