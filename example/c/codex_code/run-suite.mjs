import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const suite=JSON.parse(await fs.readFile(path.join(here,'cases.json'),'utf8'));
const selected=new Set(process.argv.slice(2)),results=[];
for(const spec of suite.cases){if(selected.size&&!selected.has(spec.id))continue;
 for(const input of spec.inputs){
  const dir=path.join(root,'test-results/codex_code-results',spec.id,input.id);await fs.mkdir(dir,{recursive:true});
  const result=await new Promise(resolve=>{
   const p=spawn(process.execPath,[path.join(here,'run-one.mjs'),spec.id,input.id],{cwd:root,windowsHide:true});let stdout='',stderr='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;p.kill();},90000);
   p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
   p.on('error',e=>stderr+=e.stack);p.on('close',code=>{clearTimeout(timer);resolve({id:spec.id,inputId:input.id,code,timedOut,stdout,stderr});});
  });
  await fs.writeFile(path.join(dir,'runner.json'),JSON.stringify(result,null,2));results.push(result);
  console.log(result.stdout.trim()||JSON.stringify({id:spec.id,inputId:input.id,code:result.code,timedOut:result.timedOut,error:result.stderr.slice(-1000)}));
 }
}
await fs.writeFile(path.join(root,'test-results/codex_code-results',`batch-${Date.now()}.json`),JSON.stringify(results,null,2));
