import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {traceModel} from '../scripts/model/index.mjs';
import {runModelCore} from '../scripts/model/core.mjs';
import {partialResult} from '../scripts/model/partial-result.mjs';
import {writeJSON,writeJSONLines} from '../scripts/shared/json-output.mjs';

const source='#include <stdio.h>\nint main(){fputs("앞🙂\\n",stdout);fflush(stdout);fputs("err\\n",stderr);fflush(stderr);int n=0;for(;;){n=(n+1)%7;}}';

// Independent source oracle: n starts at 0; each completed assignment advances
// it modulo 7. An attempted write has an input, not an observed completion.
function checkCounterWrites(r){
  const object=r.trace.objects.find(o=>o.name==='n'),raw=r.observations.trace,
    writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write'),
    counter=writes.filter(e=>e.target?.objectId===object.id),completed=counter.filter(e=>e.phase==='complete');
  assert.ok(completed.length);
  for(const e of writes){
    assert.ok(['complete','incomplete'].includes(e.phase));
    if(e.phase==='complete')assert.notEqual(e.value?.decimal,undefined);
    else assert.equal(Object.hasOwn(e,'value'),false,'an attempted write must not claim a completed value');
  }
  assert.deepEqual(completed.map(e=>e.value.decimal),completed.map((_,i)=>String(i%7)));
  const observed=raw.events.filter(e=>e.kind==='WRITE'&&e.phase==='commit'&&e.target?.objectId===object.id);
  assert.deepEqual(observed.map(e=>e.value.decimal),completed.map(e=>e.value.decimal));
  for(const [i,e]of completed.entries())assert.ok(e.observationIds.includes(observed[i].eventId));
  const last=completed.at(-1),rawLast=observed.at(-1);
  assert.deepEqual(object.initializationRanges,[{start:0,end:object.size,writer:last.eventId}]);
  assert.deepEqual(raw.objects.find(o=>o.id===object.id).initializationRanges,[{start:0,end:object.size,writer:rawLast.eventId}]);
  for(const e of counter.filter(e=>e.phase==='incomplete')){
    const attempts=raw.events.filter(o=>e.observationIds.includes(o.eventId));
    assert.equal(attempts.length,1);assert.equal(attempts[0].kind,'WRITE');assert.equal(attempts[0].phase,'attempt');
    assert.ok(e.inputs.some(i=>i.value?.decimal===String(completed.length%7)),'preserve the computed input of the pending assignment');
    for(const input of e.inputs.filter(i=>i.executionId))assert.ok(r.trace.events.findIndex(o=>o.eventId===input.executionId)<r.trace.events.indexOf(e));
    assert.equal(raw.events.some(o=>o.kind==='WRITE'&&o.phase==='commit'&&o.target?.objectId===object.id&&raw.events.indexOf(o)>raw.events.indexOf(attempts[0])),false);
    assert.ok(r.trace.events.indexOf(e)>r.trace.events.indexOf(last));
  }
}

test('record byte budgets stop safely with output, objects, live frames and the actual prefix',async()=>{
  const r=await traceModel(source,{maxEvents:1000000,maxObservationBytes:131072,includeObservations:true});
  assert.equal(r.trace.status,'limited');assert.equal(r.trace.diagnostics[0].code,'trace-size-limit');
  assert.equal(r.stdout,'앞🙂\n');assert.equal(r.stderr,'err\n');assert.ok(r.trace.events.length>30);
  assert.ok(r.trace.objects.some(o=>o.name==='n'&&o.lifecycle==='alive'));assert.equal(r.trace.frames[0].ended,false);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.ok(r.trace.coverage.observationBytes<133000);
  checkCounterWrites(r);
});

test('cuts before and after a write commit preserve input versus last observed storage',async()=>{
  const code='int main(){int n=0;for(int i=0;i<3;i++){n=(n+1)%7;}return n;}',full=await traceModel(code,{includeObservations:true});
  assert.equal(full.trace.status,'completed');assert.equal(full.trace.exitCode,3);
  const id=full.trace.objects.find(o=>o.name==='n').id,raw=full.observations.trace.events,
    commit=raw.findIndex(e=>e.kind==='WRITE'&&e.phase==='commit'&&e.target?.objectId===id&&e.value?.decimal==='1'),
    attempt=raw.findLastIndex((e,i)=>i<commit&&e.kind==='WRITE'&&e.phase==='attempt'&&e.target?.objectId===id);
  assert.ok(attempt>=0&&commit>attempt);
  for(const [cut,expected,pending]of [[attempt,'0',true],[commit,'1',false]]){
    const r=await traceModel(code,{maxEvents:cut+1,includeObservations:true});
    assert.equal(r.trace.status,'limited');assert.equal(r.trace.diagnostics.at(-1).code,'trace-limit');
    checkCounterWrites(r);
    const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.target?.objectId===id);
    assert.equal(writes.some(e=>e.phase==='incomplete'),pending);
    assert.equal(writes.findLast(e=>e.phase==='complete').value.decimal,expected);
    assert.equal(r.trace.events.at(-1).kind,'ERROR');
  }
});

test('a transferred checkpoint reconstructs matching IR state and delivered UTF8 stream prefixes',async()=>{
  let prepared,checkpoint;const events=[];
  await runModelCore(source,{maxEvents:900},m=>{
    if(m.type==='prepared')prepared=structuredClone(m);
    if(m.type==='observations'){events.push(...structuredClone(m.events));if(!checkpoint)checkpoint={state:structuredClone(m.state),events:[...events]};}
  });
  const id=`e${checkpoint.events.length+1}`,diagnostic={code:'time-limit',message:'deadline',eventId:id};
  const raw={schemaVersion:2,...checkpoint.state,events:[...checkpoint.events,{schemaVersion:2,eventId:id,kind:'ERROR',phase:'fault',diagnostic}],status:'limited',exitCode:null,diagnostics:[diagnostic]};
  const r=partialResult(prepared,raw,{includeObservations:true});
  assert.equal(r.trace.status,'limited');assert.equal(r.stdout,'앞🙂\n');assert.equal(r.stderr,'err\n');
  assert.ok(r.trace.events.length>30);assert.ok(r.trace.objects.length);assert.equal(r.trace.frames[0].ended,false);
  assert.equal(r.trace.diagnostics[0].eventId,r.trace.events.at(-1).eventId);assert.deepEqual(r.trace.coverage.irGaps,[]);
  const fallback=partialResult(prepared,raw,{skipConversion:true});assert.equal(fallback.stdout,r.stdout);
  assert.equal(fallback.observations.trace.events.length,raw.events.length);assert.equal(fallback.conversionFailure.stage,'ir-finalization');
});

test('large-artifact JSON writers preserve JSON semantics and line records without a joined trace string',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'ir-json-'));
  try{const data={label:'한글🙂',missing:undefined,values:Array.from({length:2500},(_,i)=>({i,text:'a"\n\\',v:[undefined,null,NaN]}))};
    await writeJSON(join(folder,'trace.json'),data);await writeJSONLines(join(folder,'events.jsonl'),data.values);
    assert.deepEqual(JSON.parse(await readFile(join(folder,'trace.json'),'utf8')),JSON.parse(JSON.stringify(data)));
    assert.equal((await readFile(join(folder,'events.jsonl'),'utf8')).trimEnd().split('\n').length,2500);
  }finally{await unlink(join(folder,'trace.json'));await unlink(join(folder,'events.jsonl'));await rmdir(folder);}
});
