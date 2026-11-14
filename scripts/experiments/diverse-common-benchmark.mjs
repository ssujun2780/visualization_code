import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {decodeExecution} from '../shared/execution-format.mjs';
import {decodeInference,encodeInference} from '../inference/shared-values.mjs';
import {encodePreparedStructures} from '../../src/animation/prepared-format.js';
import {collectCompilerFacts} from '../animation/compiler-facts.mjs';
const [version,stage,id]=process.argv.slice(2),prefix=version==='before'?'../../test-results/diverse-common-fixes/before/':'../../',
  base='test-results/codex_code-results/end_to_end_audit_20261113/'+id,
  read=async name=>JSON.parse(gunzipSync(await fs.readFile(base+'/'+name+'.json.gz'))),
  r=decodeExecution(await read('execution')),inf=stage==='inference'?null:decodeInference(await read('inference')),
  file={inference:'scripts/inference/structure-inference.mjs',prepare:'src/animation/prepared-structures.js',work:'scripts/execution-relations/v2/engine.mjs'}[stage],
  api=await import(new URL(prefix+file,import.meta.url));
const options={observationPlan:r.observations?.plan,observedTrace:r.observations?.trace},
  workOptions=stage==='work'?{compilerFacts:collectCompilerFacts(r.plan,{ast:r.ast}),structureInference:inf,limits:{timeMs:6000,maxRelations:100000,maxProvenanceEdges:300000}}:null;
global.gc?.();const start=performance.now();
const result=stage==='inference'?api.inferStructures(r.plan,r.trace,options):stage==='prepare'?api.prepareStructures(r.plan,r.trace,inf):api.analyzeV2(r.plan,r.trace,workOptions);
const ms=performance.now()-start,json=JSON.stringify(result),wire=stage==='inference'?JSON.stringify(encodeInference(result)):
  stage==='prepare'&&version==='after'?JSON.stringify(encodePreparedStructures(result)):json;
const summary={version,stage,id,ms,maxRssKiB:process.resourceUsage().maxRSS,expandedBytes:Buffer.byteLength(json),wireBytes:Buffer.byteLength(wire),
  hash:createHash('sha256').update(json).digest('hex'),status:result.status??'completed',diagnostics:result.diagnostics??[]};
await fs.writeFile('test-results/diverse-common-fixes/benchmark-'+version+'-'+stage+'-'+id+'.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,diagnostics:summary.diagnostics.length}));
