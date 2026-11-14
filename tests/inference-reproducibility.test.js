import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cp,mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const repo=fileURLToPath(new URL('../',import.meta.url));
test('frozen candidate and composite reconnect checks run without any previous test-results',async()=>{
 const prefix=path.join(path.resolve(tmpdir()),'inference-fixtures-'),root=await mkdtemp(prefix);
 try{
  for(const directory of ['scripts/inference','scripts/shared','tests/fixtures/inference-records'])await cp(path.join(repo,directory),path.join(root,directory),{recursive:true});
  await mkdir(path.join(root,'tests/helpers'),{recursive:true});
  for(const file of ['tests/helpers/frozen-inference.mjs','tests/ir-candidate-anchors.test.js','tests/ir-composite-reconnect.test.js'])await cp(path.join(repo,file),path.join(root,file));
  await writeFile(path.join(root,'package.json'),'{"type":"module"}');
  await assert.rejects(stat(path.join(root,'test-results')),e=>e.code==='ENOENT');
  const run=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/ir-candidate-anchors.test.js','tests/ir-composite-reconnect.test.js'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(run.status,0,run.error?.message??run.stdout+run.stderr);
  await assert.rejects(stat(path.join(root,'test-results')),e=>e.code==='ENOENT');
 }finally{
  assert.ok(path.resolve(root).startsWith(prefix));await rm(root,{recursive:true,force:true});
 }
});
