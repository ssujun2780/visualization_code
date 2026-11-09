import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {traceModel} from '../scripts/model/index.mjs';
import {runModelCore} from '../scripts/model/core.mjs';
import {partialResult} from '../scripts/model/partial-result.mjs';
import {writeJSON,writeJSONLines} from '../scripts/model/json-output.mjs';

const source='#include <stdio.h>\nint main(){fputs("앞🙂\\n",stdout);fflush(stdout);fputs("err\\n",stderr);fflush(stderr);int n=0;for(;;){n=(n+1)%7;}}';

test('record byte budgets stop safely with output, objects, live frames and the actual prefix',async()=>{
  const r=await traceModel(source,{maxEvents:1000000,maxObservationBytes:131072,includeObservations:true});
  assert.equal(r.trace.status,'limited');assert.equal(r.trace.diagnostics[0].code,'trace-size-limit');
  assert.equal(r.stdout,'앞🙂\n');assert.equal(r.stderr,'err\n');assert.ok(r.trace.events.length>30);
  assert.ok(r.trace.objects.some(o=>o.name==='n'&&o.lifecycle==='alive'));assert.equal(r.trace.frames[0].ended,false);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.ok(r.trace.coverage.observationBytes<133000);
  assert.ok(r.trace.events.filter(e=>e.kind==='WRITE'&&e.action==='write').every(e=>e.value.decimal!==undefined));
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
