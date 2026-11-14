import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {decodeExecution} from '../shared/execution-format.mjs';
import {decodeInference} from '../inference/shared-values.mjs';
import {inferStructures} from '../inference/structure-inference.mjs';
import {structureStateAt} from '../inference/state-history.mjs';
import {prepareStructures} from '../../src/animation/prepared-structures.js';
import {encodePreparedStructures} from '../../src/animation/prepared-format.js';
const [mode,id='07_bubble_novice-32']=process.argv.slice(2),dir='test-results/diverse-followup',
 base='test-results/codex_code-results/end_to_end_audit_20261113/'+id,
 read=async name=>JSON.parse(gunzipSync(await fs.readFile(base+'/'+name+'.json.gz'))),r=decodeExecution(await read('execution')),
 hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),before=hash(r);
if(mode==='limits'){
 const options={observationPlan:r.observations?.plan,observedTrace:r.observations?.trace},
  bounded=inferStructures(r.plan,r.trace,options),full=inferStructures(r.plan,r.trace,{...options,limits:{maxStates:4096}}),
  positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
 const checked=[];
 for(const d of bounded.diagnostics.filter(d=>d.resource==='omittedStates')){
  const a=bounded.structures.find(s=>s.id===d.structureId),b=full.structures.find(s=>s.id===d.structureId);
  assert.ok(b);assert.equal(b.coverage?.omittedStates??0,0);assert.equal(b.states.length,a.states.length+d.omitted);
  for(const state of a.states)assert.deepEqual(state,b.states.find(s=>(s.afterExecutionId??s.executionId)===(state.afterExecutionId??state.executionId)));
  const start=positions.get(d.historyGapFromExecutionId),end=positions.get(d.historyGapToExecutionId);
  assert.ok(end>start);assert.equal(structureStateAt(a,positions,start,r.trace.objects).historyGap,true);
  assert.ok(!structureStateAt(a,positions,end,r.trace.objects).historyGap);
  assert.ok(!structureStateAt(b,positions,start,r.trace.objects).historyGap);
  checked.push({id:a.id,retained:a.states.length,restored:b.states.length,...d});
 }
 assert.ok(checked.length);assert.equal(full.status,'completed');assert.equal(hash(r),before);
 const result={id,events:r.trace.events.length,inputHash:before,unchanged:true,boundedStatus:bounded.status,restoredStatus:full.status,checked};
 await fs.writeFile(dir+'/limits.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}else{
 const inf=decodeInference(await read('inference'));global.gc?.();const start=performance.now(),p=prepareStructures(r.plan,r.trace,inf),ms=performance.now()-start,
  result={version:mode,id,ms,maxRssKiB:process.resourceUsage().maxRSS,expandedBytes:Buffer.byteLength(JSON.stringify(p)),wireBytes:Buffer.byteLength(JSON.stringify(encodePreparedStructures(p))),hash:hash(p)};
 assert.equal(hash(r),before);await fs.writeFile(dir+'/'+mode+'-'+id+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
