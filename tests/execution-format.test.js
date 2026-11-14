import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExecutionEncoder,createExecutionDecoder,encodeExecution,decodeExecution,decodeExecutionDocuments} from '../scripts/shared/execution-format.mjs';
import {writeExecutionFiles,readExecutionFiles} from '../scripts/shared/execution-files.mjs';
const json=v=>JSON.parse(JSON.stringify(v));
const type={id:'same',name:'int',sizeBits:32,signedness:'signed',qualifiers:[]};
test('static definitions share full content; event identities, order and qualified type variants remain distinct',()=>{
 const qualified={...type,qualifiers:['const']},source={file:'a.c',line:3},input={plan:{types:[type]},trace:{events:[
  {eventId:'x1',kind:'READ',source,value:{decimal:'7',cType:type}},
  {eventId:'x2',kind:'READ',source:{...source},value:{decimal:'7',cType:{...type}}},
  {eventId:'x3',kind:'READ',source,value:{decimal:'7',cType:qualified}}]}},before=structuredClone(input),encoded=encodeExecution(input),actual=decodeExecution(json(encoded));
 assert.deepEqual(actual,input);assert.deepEqual(input,before);assert.notEqual(actual.trace.events[0],actual.trace.events[1]);
 assert.equal(actual.trace.events[0].value.cType,actual.trace.events[1].value.cType);
 assert.notEqual(actual.trace.events[0].value.cType,actual.trace.events[2].value.cType);assert.equal(actual.trace.events[0].source,actual.trace.events[1].source);
});
test('reserved property names, special scalars and sparse arrays roundtrip without prototype changes',()=>{
 const input={cType:JSON.parse('{"__proto__":{"x":1},"$executionDefinition":8,"$executionLiteral":9,"$executionScalar":"NaN"}'),
  values:[undefined,NaN,-0,Infinity,-Infinity,,{missing:undefined}]};
 assert.deepEqual(decodeExecution(json(encodeExecution(input))),input);assert.equal({}.x,undefined);
});
test('subsequent snapshots do not reuse mutated definitions by object identity',()=>{
 const encoder=createExecutionEncoder(),t=structuredClone(type),a=encoder.pack({cType:t});t.qualifiers.push('const');const b=encoder.pack({cType:t}),decode=createExecutionDecoder(json(encoder.definitions));
 assert.deepEqual(decode(a).cType.qualifiers,[]);assert.deepEqual(decode(b).cType.qualifiers,['const']);
});
test('missing, mixed, forward and malformed references are rejected; legacy documents stay readable',()=>{
 const a=encodeExecution({cType:type}),b=encodeExecution({cType:type});
 assert.throws(()=>decodeExecution(a,b.definitions),/식별자/);
 const bad=json(a);bad.definitions.entries[0]={$d:0};assert.throws(()=>decodeExecution(bad),/참조/);
 const invalid=json(a);invalid.data.cType={$d:-1};assert.throws(()=>decodeExecution(invalid),/참조/);
 const {definitions,...part}=a;assert.throws(()=>decodeExecutionDocuments([part]),/definitions.json/);
 assert.deepEqual(decodeExecutionDocuments([definitions,part]),[{cType:type}]);
 const old={plan:{schemaVersion:3},trace:{events:[]}};assert.equal(decodeExecution(old),old);
 const cycle={};cycle.self=cycle;assert.throws(()=>encodeExecution(cycle),/순환/);
});
test('split files restore plan, events and observations, and an overwritten run cannot retain old observations',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'execution-files-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input={plan:{schemaVersion:3,cType:type},trace:{schemaVersion:3,events:[{eventId:'x1',value:{cType:type}}]},observations:{plan:{schemaVersion:2,cType:type},trace:{events:[{eventId:'e1'}]}}};
 await writeExecutionFiles(dir,input,{jsonl:true});assert.deepEqual(await readExecutionFiles(dir),input);
 const definitions=json(JSON.parse(await readFile(join(dir,'definitions.json'),'utf8'))),trace=JSON.parse(await readFile(join(dir,'trace.json'),'utf8')),
  event=JSON.parse((await readFile(join(dir,'trace.jsonl'),'utf8')).trim());
 assert.deepEqual(createExecutionDecoder(definitions)({...trace,data:event}),input.trace.events[0]);
 assert.equal((await readFile(join(dir,'trace.json'),'utf8')).split('\n').length,2);
 await writeExecutionFiles(dir,{plan:input.plan,trace:input.trace});assert.equal((await readExecutionFiles(dir)).observations,undefined);
 assert.deepEqual((await readdir(dir)).sort(),['definitions.json','plan.json','trace.json']);
 await writeExecutionFiles(dir,{plan:input.plan,trace:input.trace},{expanded:true,pretty:true});assert.deepEqual((await readExecutionFiles(dir)).trace,input.trace);
});

test('record layouts preserve every event field, special values and schema-1 saved files',()=>{
 const events=[{schemaVersion:2,eventId:'e1',kind:'READ',source:{line:2},value:-0},
  {schemaVersion:2,eventId:'e2',kind:'READ',source:{line:2},value:undefined},
  {schemaVersion:2,eventId:'e3',kind:'WRITE',extra:'한글',value:NaN}];
 const packed=encodeExecution({events});assert.ok(packed.data.events[0].$r);
 assert.deepEqual(decodeExecution(json(packed)),{events});
 const reserved={$r:[1,2,3],$d:2,$s:'NaN',$l:[],__proto__:null};assert.deepEqual(decodeExecution(json(encodeExecution(reserved))),{...reserved});
 const definitions={encoding:'execution-definition-table-v1',id:'old',entries:[{line:3}]},old={encoding:'execution-definitions-v1',definitionsId:'old',data:{source:{$executionDefinition:0},$executionRecord:'ordinary old key'}};
 assert.deepEqual(decodeExecutionDocuments([definitions,old]),[{source:{line:3},$executionRecord:'ordinary old key'}]);
 const broken=json(packed);broken.data.events[0].$r.pop();assert.throws(()=>decodeExecution(broken),/필드 구성/);
});

test('compile-only observations survive, and optional cleanup preserves unrelated files',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'execution-optional-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'notes.txt'),'keep');const plan={schemaVersion:2};
 await writeExecutionFiles(dir,{plan,observations:{plan}});
 assert.deepEqual((await readExecutionFiles(dir)).observations,{plan,trace:undefined});
 assert.equal(await readFile(join(dir,'notes.txt'),'utf8'),'keep');
});
