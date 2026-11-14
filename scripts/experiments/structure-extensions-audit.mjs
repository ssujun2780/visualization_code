import fs from 'node:fs/promises';import crypto from 'node:crypto';
import {extensionCases} from '../../tests/fixtures/structure-extensions.mjs';
import {traceModel} from '../model/index.mjs';import {inferStructures} from '../inference/index.mjs';
const dir='test-results/structure-extensions-2026-11-12',sourceDir='example/c/codex_code/structure_extensions_20261112',hash=x=>crypto.createHash('sha256').update(x).digest('hex');
await fs.mkdir(dir,{recursive:true});await fs.mkdir(sourceDir,{recursive:true});
if(process.argv.includes('--capture')){
 await fs.writeFile(`${dir}/expected.json`,JSON.stringify(extensionCases.map(c=>({id:c.id,group:c.group,stdout:c.stdout,expect:c.expect,sourceHash:hash(c.source)})),null,2));
 const hashes={};for(const n of await fs.readdir('scripts/model'))if(n.endsWith('.mjs'))hashes[n]=hash(await fs.readFile(`scripts/model/${n}`));await fs.writeFile(`${dir}/model-before.json`,JSON.stringify(hashes,null,2));
 for(const c of extensionCases){await fs.writeFile(`${sourceDir}/${c.id}.c`,c.source);const r=await traceModel(c.source,{filename:`${c.id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${c.id}.execution.json`,JSON.stringify(r));console.log(c.id,r.trace?.status,JSON.stringify(r.stdout),r.stdout===c.stdout);}
}
const summary=[];for(const c of extensionCases){const r=JSON.parse(await fs.readFile(`${dir}/${c.id}.execution.json`));if(r.trace?.status!=='completed'){summary.push({id:c.id,status:r.trace?.status});continue;}
 const before=hash(JSON.stringify(r)),i=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});if(hash(JSON.stringify(r))!==before)throw Error('IR mutation');
 await fs.writeFile(`${dir}/${c.id}.inference.json`,JSON.stringify(i));const s={id:c.id,status:i.status,diagnostics:i.diagnostics,kinds:Object.fromEntries([...new Set(i.structures.map(s=>s.kind))].map(k=>[k,i.structures.filter(s=>s.kind===k).length]))};console.log(JSON.stringify(s));summary.push(s);}
await fs.writeFile(`${dir}/${process.argv.includes('--capture')?'baseline':'actual'}.json`,JSON.stringify(summary,null,2));
