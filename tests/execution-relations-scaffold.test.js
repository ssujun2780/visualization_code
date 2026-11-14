import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inferExecutionRelations,inferExecutionRelationsAsync,validateExecutionRelations,createExecutionRelationQuery} from '../scripts/execution-relations/index.mjs';
import {createRelationContext} from '../scripts/execution-relations/context.mjs';
import {runRelationPasses} from '../scripts/execution-relations/engine.mjs';
import {relationResult} from '../scripts/execution-relations/result.mjs';

const sample=JSON.parse(await readFile(new URL('../public/animation-demo.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(sample);
function proposed(plan,trace){
  return {id:'test-relation',kind:'test-range',status:'supported',availableAtExecutionId:trace.events.at(-1).eventId,
    activationIds:[trace.frames[0].id],participants:[{role:'source',objectId:trace.objects[0].id,offset:0,size:1}],
    supportingExecutionIds:[trace.events[0].eventId],contradictingExecutionIds:[]};
}

test('saved IR is accepted without compiler/inference execution, and an empty registry is explicitly not implemented',()=>{
  const {plan,trace}=fresh(),before=JSON.stringify({plan,trace});
  const metadata=runRelationPasses(plan,trace,{},[]);
  assert.equal(metadata.status,'not-implemented');assert.deepEqual(metadata.relations,[]);
  assert.equal(metadata.coverage.registeredPasses,0);assert.equal(metadata.coverage.eventCount,trace.events.length);
  assert.equal(metadata.diagnostics[0].code,'relation-passes-not-implemented');
  assert.equal(JSON.stringify({plan,trace}),before);assert.equal(Object.isFrozen(plan),false);assert.equal(Object.isFrozen(trace),false);
  assert.equal(validateExecutionRelations(plan,trace,metadata),metadata);
  assert.ok(!('trace'in metadata));assert.ok(!('events'in metadata));
});

test('absent, invalid and cross-run inputs remain analysis diagnostics, never changes to C execution',()=>{
  assert.equal(inferExecutionRelations(null,null).status,'skipped');
  const {plan,trace}=fresh(),before=JSON.stringify(trace);
  assert.equal(inferExecutionRelations(plan,{...trace,programId:'another-program'}).status,'failed');
  const invalidId=inferExecutionRelations({...plan,programId:{unexpected:true}},trace);
  assert.equal(invalidId.status,'failed');assert.equal(invalidId.scope.programId,null);
  assert.equal(inferExecutionRelations({...plan,schemaVersion:2},trace).status,'failed');
  const bad=structuredClone(trace);bad.events[0].instructionId='missing';assert.equal(inferExecutionRelations(plan,bad).status,'failed');
  assert.equal(inferExecutionRelations(plan,trace,{structureInference:{scope:{programId:plan.programId,runId:'other-run'}}}).status,'failed');
  const failedStructure={scope:{programId:plan.programId,runId:trace.runId},status:'failed',structures:[]};
  assert.equal(inferExecutionRelations(plan,trace,{structureInference:failedStructure}).status,'completed');
  assert.equal(JSON.stringify(trace),before);
});

test('passes see frozen independent snapshots; a mutating pass fails without preventing another pass',()=>{
  const {plan,trace}=fresh(),before=JSON.stringify({plan,trace});
  const ctx=createRelationContext(plan,trace);assert.ok(Object.isFrozen(ctx.trace.events));assert.notEqual(ctx.trace,trace);
  const metadata=runRelationPasses(plan,trace,{},[
    {id:'mutates',analyze:ctx=>{ctx.trace.events.push({kind:'WRITE'});return [];}},
    {id:'reads',analyze:ctx=>{assert.equal(ctx.position(ctx.trace.events[0].eventId),0);return [proposed(ctx.plan,ctx.trace)];}}
  ]);
  assert.equal(metadata.status,'partial');assert.deepEqual(metadata.coverage.failedPasses,['mutates']);
  assert.deepEqual(metadata.coverage.completedPasses,['reads']);assert.equal(metadata.relations.length,1);
  assert.equal(JSON.stringify({plan,trace}),before);
});

test('metadata validates scope, evidence positions, object ranges and identities without accepting synthetic execution events',()=>{
  const {plan,trace}=fresh(),base=relationResult({programId:plan.programId,runId:trace.runId},'completed',{relations:[proposed(plan,trace)]});
  validateExecutionRelations(plan,trace,base);
  const mutations=[
    r=>{r.scope.runId='wrong';},r=>{r.events=[];},r=>{r.relations.push(structuredClone(r.relations[0]));},
    r=>{r.relations[0].participants[0].objectId='missing';},r=>{r.relations[0].participants[0].offset=-1;},
    r=>{r.relations[0].participants[0].size=trace.objects[0].size+1;},
    r=>{r.relations[0].activationIds=['missing'];},r=>{r.relations[0].supportingExecutionIds=['missing'];},
    r=>{r.relations[0].availableAtExecutionId=trace.events[0].eventId;r.relations[0].supportingExecutionIds=[trace.events.at(-1).eventId];},
    r=>{r.relations[0].status='contradicted';},r=>{r.status='not-implemented';}
  ];
  for(const change of mutations){const invalid=structuredClone(base);change(invalid);assert.throws(()=>validateExecutionRelations(plan,trace,invalid));}
});

test('query uses recorded order, hides future evidence and cannot leak mutable cached metadata',()=>{
  const {plan,trace}=fresh(),relation=proposed(plan,trace);
  const metadata=relationResult({programId:plan.programId,runId:trace.runId},'completed',{relations:[relation]});
  const query=createExecutionRelationQuery(plan,trace,metadata);
  assert.equal(query.status,'completed');assert.deepEqual(query.scope,metadata.scope);
  assert.deepEqual(query.at(null),[]);assert.deepEqual(query.at(trace.events[0].eventId),[]);
  const found=query.at(trace.events.at(-1).eventId);assert.equal(found.length,1);found[0].participants[0].offset=99;
  metadata.relations.length=0;assert.equal(query.at(trace.events.at(-1).eventId)[0].participants[0].offset,0);
  assert.throws(()=>query.at('not-an-event'),RangeError);
});

test('invalid pass registration and conflicting relation IDs cannot produce a successful result',()=>{
  const {plan,trace}=fresh(),pass={id:'one',analyze:ctx=>[proposed(ctx.plan,ctx.trace)]};
  const duplicateRegistry=runRelationPasses(plan,trace,{},[pass,pass]);
  assert.equal(duplicateRegistry.status,'failed');assert.equal(duplicateRegistry.diagnostics[0].code,'invalid-relation-registry');
  const conflicting=runRelationPasses(plan,trace,{},[pass,{...pass,id:'two'}]);
  assert.equal(conflicting.status,'partial');assert.equal(conflicting.relations.length,1);
  assert.deepEqual(conflicting.coverage.failedPasses,['two']);
});

test('the independent worker matches sync results and returns its own bounded timeout diagnostic',async()=>{
  const {plan,trace}=fresh(),before=JSON.stringify(trace);
  assert.deepEqual(await inferExecutionRelationsAsync(plan,trace),inferExecutionRelations(plan,trace));
  const timeout=await inferExecutionRelationsAsync(plan,trace,{timeoutMs:1});
  assert.equal(timeout.status,'failed');assert.equal(timeout.diagnostics[0].code,'execution-relations-time-limit');
  assert.equal(JSON.stringify(trace),before);
  assert.throws(()=>inferExecutionRelationsAsync(plan,trace,{timeoutMs:0}),RangeError);
});

test('the standalone module has no compiler, structure-inference, renderer or example imports',async()=>{
  const root=fileURLToPath(new URL('../scripts/execution-relations/',import.meta.url));
  const shared=fileURLToPath(new URL('../scripts/shared/',import.meta.url)),visited=new Set();
  const within=(base,file)=>{const p=relative(base,file);return !p.startsWith('..')&&!isAbsolute(p);};
  async function inspectFile(file){
    if(visited.has(file))return;visited.add(file);
    const source=await readFile(file,'utf8');
    for(const [,specifier] of source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)/g)){
      if(specifier.startsWith('node:'))continue;
      const target=resolve(dirname(file),specifier);
      assert.ok(specifier.startsWith('.')&&(within(root,target)||within(shared,target)),`${file}: ${specifier}`);
      await inspectFile(target);
    }
  }
  async function inspect(directory){for(const item of await readdir(directory,{withFileTypes:true})){
    const file=join(directory,item.name);if(item.isDirectory()){await inspect(file);continue;}
    if(!file.endsWith('.mjs'))continue;
    await inspectFile(file);
  }}
  await inspect(root);
});

test('CLI reads saved records and only writes its metadata artifact',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'execution-relations-')),out=join(directory,'out');
  t.after(async()=>{
    // Check the absolute target before recursive cleanup on Windows.
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('execution-relations-'));
    await rm(directory,{recursive:true,force:true});
  });
  const {plan,trace}=fresh(),planText=JSON.stringify(plan),traceText=JSON.stringify(trace);
  await Promise.all([writeFile(join(directory,'plan.json'),planText),writeFile(join(directory,'trace.json'),traceText)]);
  const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/infer-execution-relations.mjs',import.meta.url)),directory,'--out-dir',out]);
  const metadata=JSON.parse(await readFile(join(out,'execution-relations.json'),'utf8'));
  assert.equal(metadata.status,'completed');assert.match(stdout,/completed/);
  assert.equal(await readFile(join(directory,'plan.json'),'utf8'),planText);assert.equal(await readFile(join(directory,'trace.json'),'utf8'),traceText);
});
