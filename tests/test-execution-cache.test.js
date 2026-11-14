import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {testExecution} from './helpers/test-execution.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('common test loader checks source, input, generator, tools and execution integrity independently of stdout',async()=>{
 const prefix=path.join(path.resolve(tmpdir()),'execution-cache-'),root=await fs.mkdtemp(prefix);
 try{
  const impl=path.join(root,'implementation');await fs.mkdir(impl);await fs.writeFile(path.join(impl,'generator.mjs'),'version1');
  const file=path.join(root,'out','record.json'),identity={roots:[impl],toolchain:{compiler:'tool1'}},expected=source=>({sourceHash:hash(source),stdout:'same\n'});let calls=0;
  const generate=async(source,options)=>{calls++;return {plan:{source:{sha256:hash(source)}},trace:{status:'completed'},stdout:'same\n',options};};
  const load=(source='source1',options={stdin:'1'},id=identity)=>testExecution({source,options,expected:expected(source),file,generate,identity:id});
  await load();await load();assert.equal(calls,1,'valid unchanged input reused');
  await load('source2');assert.equal(calls,2,'equal stdout does not make different source equivalent');
  await load('source2',{stdin:'2'});assert.equal(calls,3,'input differs');
  await fs.writeFile(path.join(impl,'generator.mjs'),'version2');await load('source2',{stdin:'2'});assert.equal(calls,4);
  const changed={...identity,toolchain:{compiler:'tool2'}};await load('source2',{stdin:'2'},changed);assert.equal(calls,5);
  let envelope=JSON.parse(await fs.readFile(file));envelope.execution.stdout='forged';await fs.writeFile(file,JSON.stringify(envelope));await load('source2',{stdin:'2'},changed);assert.equal(calls,6);
  envelope=JSON.parse(await fs.readFile(file));envelope.execution.plan.source.sha256=hash('source1');envelope.executionHash=hash(JSON.stringify(envelope.execution));await fs.writeFile(file,JSON.stringify(envelope));await load('source2',{stdin:'2'},changed);assert.equal(calls,7,'record itself must match source');
  await fs.writeFile(file,JSON.stringify(envelope.execution));await load('source2',{stdin:'2'},changed);assert.equal(calls,8,'bare historical record is not a current cache');
  await assert.rejects(testExecution({source:'source2',options:{},expected:expected('source1'),file,generate,identity}));assert.equal(calls,8,'do not rewrite independent predictions');
  await assert.rejects(testExecution({source:'source3',options:{},expected:{...expected('source3'),stdout:'different\n'},file,generate,identity}));assert.equal(calls,9,'wrong generated output fails rather than becoming an expectation');
 }finally{assert.ok(path.resolve(root).startsWith(prefix));await fs.rm(root,{recursive:true,force:true});}
});
