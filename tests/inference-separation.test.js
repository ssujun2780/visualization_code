import assert from 'node:assert/strict';
import {test,before} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import * as generation from '../scripts/model/index.mjs';
import {inferStructures,inferStructuresAsync,createInferenceView,queryBSTOrder} from '../scripts/inference/index.mjs';
import {traceWithInference} from '../scripts/pipeline/trace-with-inference.mjs';
import {recordObservedTrace} from '../scripts/model/recorded-result.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const source=`#include <stdio.h>
typedef struct N{int k;struct N*l,*r;}N;
int find(N*p,int k){while(p){if(k==p->k)return 1;p=k<p->k?p->l:p->r;}return 0;}
int main(void){N a={10,0,0},b={5,0,0},c={15,0,0};a.l=&b;a.r=&c;N*seed=&a;printf("%d\\n",find(seed,5)+find(seed,15));return 0;}`;
let result;
before(async()=>{result=await generation.traceModel(source,{filename:'separated.c',includeObservations:true});});

test('generation and inference have disjoint implementation dependency graphs',async()=>{
  async function visit(file,seen=new Set()){
    file=path.resolve(root,file);if(seen.has(file))return seen;seen.add(file);
    const source=await fs.readFile(file,'utf8');
    const specs=[...source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.[^'"]+)['"]/g)].map(m=>m[1]);
    for(const spec of specs)if(spec.endsWith('.mjs'))await visit(path.resolve(path.dirname(file),spec),seen);
    return seen;
  }
  for(const file of await visit('scripts/model/index.mjs'))assert.ok(!file.includes(`${path.sep}inference${path.sep}`)&&!file.includes(`${path.sep}pipeline${path.sep}`),file);
  for(const file of await visit('scripts/inference/index.mjs'))assert.ok(!file.includes(`${path.sep}model${path.sep}`)&&!file.includes(`${path.sep}instrumentation${path.sep}`)&&!file.includes(`${path.sep}pipeline${path.sep}`),file);
  assert.deepEqual(Object.keys(generation).sort(),['compileCToIR','describeLogicalWork','traceModel']);
});

test('generation and record conversion return unprojected IR without inference',()=>{
  assert.equal(result.trace.status,'completed');assert.equal(result.stdout,'2\n');
  assert.equal(result.inference,undefined);assert.equal(result.plan.structureBindings,undefined);assert.deepEqual(result.trace.structures,[]);
  assert.deepEqual(result.observations.trace.structures,[]);
  const recorded=recordObservedTrace(result.plan,result.observations.plan,result.observations.trace);
  assert.deepEqual(recorded,{trace:result.trace});
  assert.throws(()=>generation.traceModel(source,{inference:true}),/별도로/);
});

test('explicit inference and a consumer view leave values, events, lifetimes and plan untouched',async()=>{
  const snapshot=structuredClone(result),mutable=Object.isFrozen(result.trace),options={observationPlan:result.observations.plan,observedTrace:result.observations.trace};
  const sync=inferStructures(result.plan,result.trace,options),asyncResult=await inferStructuresAsync(result.plan,result.trace,options);
  assert.deepEqual(asyncResult,sync);assert.equal(sync.status,'completed');
  assert.deepEqual(sync.scope,{programId:result.plan.programId,runId:result.trace.runId});
  assert.deepEqual(result,snapshot);assert.equal(Object.isFrozen(result.trace),mutable);
  const view=createInferenceView(result,sync);assert.notEqual(view.trace,result.trace);assert.notEqual(view.plan,result.plan);
  const output=view.trace.events.find(e=>e.action==='output'),target={objectId:view.trace.objects.find(o=>o.name==='seed').id};
  assert.equal(queryBSTOrder(view.trace,{target,afterExecutionId:output.eventId}).assessment,'satisfied-observed');
  assert.deepEqual({...view.trace,structures:[]},result.trace);
  assert.throws(()=>createInferenceView({...result,trace:{...result.trace,runId:'another-run'}},sync),/다른 프로그램/);
  assert.throws(()=>inferStructures(result.plan,result.trace,{...options,observedTrace:{...options.observedTrace,runId:'stale-run'}}),/다른 실행/);
  assert.throws(()=>inferStructures(result.plan,result.trace,{...options,observationPlan:{...options.observationPlan,programId:'stale-program'}}),/다른 프로그램/);
  assert.deepEqual(result,snapshot);
});

test('inference timeout and failure are separate from successful execution',async()=>{
  const snapshot=structuredClone(result);
  const limited=await inferStructuresAsync(result.plan,result.trace,{timeoutMs:1});
  assert.equal(limited.status,'limited');assert.equal(limited.diagnostics[0].scope,'visualization-only');
  const failed=await inferStructuresAsync({...result.plan,instructions:null},result.trace);
  assert.equal(failed.status,'partial');assert.ok(failed.diagnostics.length);
  assert.deepEqual(result,snapshot);assert.equal(result.trace.status,'completed');assert.equal(result.trace.exitCode,0);
  assert.ok(!result.trace.events.some(e=>e.kind==='ERROR'));
  assert.deepEqual(createInferenceView(result,limited).trace.events,result.trace.events);
});

test('optional pipeline returns raw IR plus independent metadata; compilation failure skips inference',async()=>{
  const r=await traceWithInference(source,{filename:'pipeline.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.inference.status,'completed');assert.equal(r.observations,undefined);
  assert.equal(r.plan.structureBindings,undefined);assert.deepEqual(r.trace.structures,[]);assert.ok(r.inference.structures.length);
  const bad=await traceWithInference('int main(void){ return ; @ }');
  assert.equal(bad.trace.status,'compile-error');assert.equal(bad.inference.status,'skipped');
});

test('independent CLI consumes saved IR without C source and writes only inference output',async()=>{
  const folder=await fs.mkdtemp(path.join(tmpdir(),'c-inference-separation-'));
  try{
    const output=path.join(folder,'derived');
    for(const [file,data]of Object.entries({'plan.json':result.plan,'trace.json':result.trace,'observations.plan.json':result.observations.plan,'observations.trace.json':result.observations.trace}))
      await fs.writeFile(path.join(folder,file),JSON.stringify(data));
    const before=await Promise.all(['plan.json','trace.json'].map(f=>fs.readFile(path.join(folder,f),'utf8')));
    const cli=await exec(process.execPath,['scripts/infer-structures.mjs',folder,'--out-dir',output],{cwd:root});
    assert.match(cli.stdout,/completed/);assert.deepEqual(await fs.readdir(output),['inference.json']);
    const inference=JSON.parse(await fs.readFile(path.join(output,'inference.json'),'utf8'));
    assert.deepEqual(inference,inferStructures(result.plan,result.trace,{observationPlan:result.observations.plan,observedTrace:result.observations.trace}));
    assert.deepEqual(await Promise.all(['plan.json','trace.json'].map(f=>fs.readFile(path.join(folder,f),'utf8'))),before);
  }finally{
    assert.equal(path.dirname(path.resolve(folder)),path.resolve(tmpdir()));
    assert.ok(path.basename(folder).startsWith('c-inference-separation-'));
    await fs.rm(folder,{recursive:true,force:true});
  }
});
