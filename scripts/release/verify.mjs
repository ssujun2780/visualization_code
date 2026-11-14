import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

const zip=resolve(process.argv[2]??''),bytes=await fs.readFile(zip),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(bytes),(await fs.readFile(zip+'.sha256','utf8')).split(/\s/)[0]);
const root=await fs.mkdtemp(join(tmpdir(),'c-release-verify-'));
let child;
try{
  for(const [name,data] of Object.entries(unzipSync(bytes))){
    const path=resolve(root,name);assert.ok(path.startsWith(root+sep));
    await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,data);
  }
  let checked=0;
  for(const line of (await fs.readFile(join(root,'SHA256SUMS.txt'),'utf8')).trim().split('\n')){
    const [digest,name]=line.split('  ');assert.equal(hash(await fs.readFile(join(root,name))),digest,name);checked++;
  }
  const manifest=JSON.parse(await fs.readFile(join(root,'RELEASE.json'),'utf8'));
  child=spawn(process.execPath,[join(root,'scripts/release/server.mjs')],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'0',NODE_PATH:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  const base=await new Promise((ok,no)=>{
    let output='';const timer=setTimeout(()=>no(new Error('Server start timeout: '+stderr)),15000);
    child.once('error',e=>{clearTimeout(timer);no(e);});child.once('exit',code=>{clearTimeout(timer);no(new Error(`Server exit ${code}: ${stderr}`));});
    child.stdout.on('data',b=>{output+=b;const match=/http:\/\/127\.0\.0\.1:\d+\//.exec(output);if(match){clearTimeout(timer);ok(match[0].slice(0,-1));}});
  });
  const page=await fetch(base);assert.equal(page.status,200);const html=await page.text();
  const asset=html.match(/src="([^\"]+\.js)"/)[1];assert.equal((await fetch(base+asset)).status,200);
  const assets=await fs.readdir(join(root,'dist/assets'));
  const routingWasm=assets.find(name=>name.startsWith('libavoid-')&&name.endsWith('.wasm'));assert.ok(routingWasm,'routing WASM must be emitted as a public build asset');
  const wasmResponse=await fetch(base+'/assets/'+routingWasm);assert.equal(wasmResponse.status,200);assert.equal(wasmResponse.headers.get('content-type'),'application/wasm');
  assert.equal(hash(Buffer.from(await wasmResponse.arrayBuffer())),hash(await fs.readFile(join(root,'node_modules/libavoid-js/dist/libavoid.wasm'))));
  for(const name of assets.filter(name=>name.endsWith('.js'))){const code=await fs.readFile(join(root,'dist/assets',name),'utf8');assert.ok(!code.includes('../../node_modules/'),'unresolved build asset: '+name);}
  const compiler=await fetch(base+'/toolchain/clang.wasm.gz');assert.equal(hash(Buffer.from(await compiler.arrayBuffer())),hash(await fs.readFile(join(root,'public/toolchain/clang.wasm.gz'))));
  for(const path of ['/scripts/model/index.mjs','/package.json','/.git/config'])assert.equal((await fetch(base+path)).status,404);
  const post=async(path,body)=>{const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;};
  const {Playback,createRecording}=await import(pathToFileURL(join(root,'src/animation/playback.js')));
  const output=r=>{const p=new Playback(createRecording(r.plan,r.trace));p.seek(r.trace.events.length);return p.state.output;};
  const source='#include <stdio.h>\nint add(int x,int y){return x+y;}\nint main(void){int n;scanf("%d",&n);int c=add(n,2);printf("%d\\n",c);return 0;}';
  const batch=await post('/api/animation/sessions',{source,inputMode:'batch',stdin:'40\n'});
  assert.equal(batch.type,'complete');assert.equal(batch.trace.status,'completed');assert.equal(output(batch),'42\n');
  assert.equal(batch.workAnalysis.structureInference.status,'completed');
  const first=await post('/api/animation/sessions',{source});assert.equal(first.type,'input');
  const resumed=await post(`/api/animation/sessions/${first.sessionId}/input`,{requestId:first.request.id,stdin:'7\n',eof:true});
  assert.equal(resumed.type,'complete');assert.equal(resumed.trace.runId,first.trace.runId);assert.equal(output(resumed),'9\n');
  const example=await post('/api/animation/sessions',{example:'functions',inputMode:'batch',stdin:''});
  assert.equal(example.type,'complete');assert.equal(example.trace.status,'completed');
  const legacy=await fetch(base+'/api/animation/examples/scalar');assert.equal(legacy.status,200);assert.equal((await legacy.json()).trace.status,'completed');
  console.log(JSON.stringify({zip,sourceSnapshot:manifest.sourceSnapshot,verifiedFiles:checked,node:process.version,isolatedDirectory:true,batchOutput:output(batch),resumedOutput:output(resumed),sameExecution:true,catalogExample:true,legacyExample:true},null,2));
}finally{
  if(child&&child.exitCode===null){child.kill();await new Promise(ok=>child.once('exit',ok));}
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'c-release-verify-'));await fs.rm(root,{recursive:true,force:true});
}
