import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {executionCacheKey,readExecutionCache,writeExecutionCache} from './execution-cache.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
let toolIdentity;
async function tools(){
 return toolIdentity??=Promise.all(['clang.wasm.gz','wasm-ld.wasm.gz','clang-fs.tar.gz'].map(async name=>[name,hash(await fs.readFile(`public/toolchain/${name}`))]));
}
// Expectations are supplied independently. Bare historical JSON is not a cache.
export async function testExecution({source,options={},expected,file,reuse=true,generate,identity}){
 assert.equal(expected.sourceHash,hash(source),'source prediction differs from requested source');
 const key=await executionCacheKey(source,options,identity??{toolchain:await tools()});
 let execution=reuse?await readExecutionCache(file,key):null;
 const verify=r=>{assert.equal(r.plan.source.sha256,expected.sourceHash,'execution belongs to another source');assert.equal(r.trace.status,'completed');assert.equal(r.stdout,expected.stdout,'source-derived stdout');};
 if(execution){try{verify(execution);}catch{execution=null;}}
 if(!execution){
  generate??=(await import('../../scripts/model/index.mjs')).traceModel;
  execution=await generate(source,options);verify(execution);
  await fs.mkdir(path.dirname(file),{recursive:true});await writeExecutionCache(file,key,execution);
 }
 return execution;
}
