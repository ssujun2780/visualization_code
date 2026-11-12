import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
async function files(dir){return (await Promise.all((await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();}
// A missing tool identity disables reuse. Expected answers are independent of
// this cache and must never be rewritten to legitimize an old execution.
export async function executionCacheKey(source,options,{toolchain,roots=['scripts/model','scripts/instrumentation','scripts/shared']}={}){
 if(!toolchain)return null;
 const inputs=await Promise.all((await Promise.all(roots.map(files))).flat().map(async p=>[p.replaceAll('\\','/'),hash(await fs.readFile(p))]));
 for(const p of ['package.json','pnpm-lock.yaml','package-lock.json'])try{inputs.push([p,hash(await fs.readFile(p))]);}catch(error){if(error.code!=='ENOENT')throw error;}
 return hash(JSON.stringify(stable({sourceHash:hash(source),options,toolchain,node:process.version,platform:process.platform,arch:process.arch,inputs})));
}
export async function readExecutionCache(file,key){
 if(!key)return null;
 try{const envelope=JSON.parse(await fs.readFile(file,'utf8'));
  return envelope.version===1&&envelope.key===key&&hash(JSON.stringify(envelope.execution))===envelope.executionHash?envelope.execution:null;
 }catch{return null;}
}
export async function writeExecutionCache(file,key,execution){
 if(!key)return;
 await fs.writeFile(file,JSON.stringify({version:1,key,executionHash:hash(JSON.stringify(execution)),execution}));
}
