import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {startReleaseServer} from '../scripts/release/server.mjs';

test('release server serves built assets and toolchain only, with safe paths and methods',async t=>{
  const root=await mkdtemp(join(tmpdir(),'c-release-server-'));
  let server;
  t.after(async()=>{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'c-release-server-'));await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'dist/assets'),{recursive:true});await mkdir(join(root,'public/toolchain'),{recursive:true});
  await writeFile(join(root,'dist/animation.html'),'<title>Animation</title>');await writeFile(join(root,'dist/index.html'),'<title>Editor</title>');
  await writeFile(join(root,'dist/assets/demo.js'),'export default 3;');await writeFile(join(root,'private.txt'),'not public');
  await writeFile(join(root,'public/toolchain/test.gz'),Buffer.from([31,139,0,1]));
  // Directory junctions on Windows do not require symlink privileges.
  await mkdir(join(root,'private'));await writeFile(join(root,'private/secret.txt'),'not public');
  await symlink(join(root,'private'),join(root,'dist/escape'),process.platform==='win32'?'junction':'dir');
  server=await startReleaseServer({root,port:0});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(),/Animation/);assert.match(await (await fetch(base+'/index.html')).text(),/Editor/);
  const js=await fetch(base+'/assets/demo.js');assert.match(js.headers.get('content-type'),/javascript/);assert.match(js.headers.get('cache-control'),/immutable/);
  const gz=await fetch(base+'/toolchain/test.gz');assert.equal(gz.headers.get('content-encoding'),null);assert.deepEqual([...new Uint8Array(await gz.arrayBuffer())],[31,139,0,1]);
  assert.equal((await fetch(base+'/assets/demo.js',{method:'HEAD'})).headers.get('content-length'),'17');
  for(const path of ['/private.txt','/scripts/release/server.mjs','/api/unknown','/toolchain/%2e%2e%2f%2e%2e%2fprivate.txt','/escape/secret.txt','/assets/%ZZ'])assert.ok((await fetch(base+path)).status>=400,path);
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/animation/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
});
