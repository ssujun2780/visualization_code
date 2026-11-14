import fs from 'node:fs/promises';
import {resolve,relative,dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'vite';
import {zipSync,unzipSync} from 'fflate';

const root=fileURLToPath(new URL('../../',import.meta.url)),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stage=resolve(root,'.tmp',`release-${randomUUID()}`),out=resolve(root,'releases');
const allowed=/^(src\/|scripts\/|examples\/|public\/|docs\/|tests\/|index\.html$|animation\.html$|package\.json$|pnpm-lock\.yaml$|vite\.config\.js$|README\.md$)/;
const committed=process.argv.includes('--committed'),revision=git('rev-parse','HEAD');
const archive=committed?unzipSync(execFileSync('git',['archive','--format=zip',revision],{cwd:root,maxBuffer:256*1024*1024})):null;
const tracked=archive?Object.keys(archive).filter(f=>!f.endsWith('/')):execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const sourceFiles=[...new Set(tracked.filter(f=>allowed.test(f)))].sort(),sourceHashes={};
const put=async(name,bytes)=>{const path=resolve(stage,name);await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,bytes);};
for(const name of sourceFiles){const bytes=archive?archive[name]:await fs.readFile(resolve(root,name));sourceHashes[name]=hash(bytes);await put(name,bytes);}
if(!committed)for(const name of sourceFiles)if(hash(await fs.readFile(resolve(root,name)))!==sourceHashes[name])throw new Error(`Source changed during snapshot; retry packaging: ${name}`);
const pkg=JSON.parse(await fs.readFile(resolve(stage,'package.json'),'utf8')),createdAt=new Date().toISOString();

// Portable JS-only runtime packages are dereferenced into ordinary directories.
// pnpm symlinks, native build tools and the local Node binary are not shipped.
const dependencies={};
for(const name of ['@runno/wasi','fflate','libavoid-js']){
  const path=await fs.realpath(resolve(root,'node_modules',name));
  const meta=JSON.parse(await fs.readFile(join(path,'package.json'),'utf8'));
  if(Object.keys(meta.dependencies??{}).length)throw new Error(`Review new transitive runtime dependencies: ${name}`);
  dependencies[name]=meta.version;await fs.cp(path,resolve(stage,'node_modules',name),{recursive:true,dereference:true});
}
// Copy runtime files BEFORE building: Worker new URL(...libavoid.wasm) resolves
// relative to the snapshot and must become a hashed public asset.
console.log('Building isolated source snapshot:',stage);
await build({configFile:false,root:stage,build:{outDir:'dist',rollupOptions:{input:{workbench:resolve(stage,'index.html'),animation:resolve(stage,'animation.html')}}},worker:{format:'es'},logLevel:'warn'});
for(const name of ['monaco-editor','libavoid-js','@runno/wasi','fflate']){
  const path=resolve(root,'node_modules',name);
  for(const file of (await fs.readdir(path)).filter(n=>/^(license|copying|notice|thirdpartynotices)/i.test(n))){
    if((await fs.stat(join(path,file))).isFile())await put(`THIRD_PARTY/${name}/${file}`,await fs.readFile(join(path,file)));
  }
}
await put('START-WINDOWS.cmd','@echo off\r\ncd /d "%~dp0"\r\nnode scripts/release/server.mjs\r\nif errorlevel 1 pause\r\n');
await put('START.sh','#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec node scripts/release/server.mjs\n');
await put('START-HERE.md',await fs.readFile(resolve(stage,'docs/deployment/release.md')));
const snapshot=hash(JSON.stringify(sourceHashes)).slice(0,12),name=`visualization-code-${pkg.version}-preview-${createdAt.slice(0,10)}-${snapshot}`;
await put('RELEASE.json',JSON.stringify({name,version:pkg.version,channel:'preview',createdAt,baseCommit:revision,sourceMode:committed?'commit':'working-tree',workingTree:committed?'':git('status','--porcelain'),sourceSnapshot:snapshot,sourceHashes,runtimeDependencies:dependencies,nodeRequirement:'Node.js 22 or newer; verified on '+process.version,containsNodeBinary:false},null,2));
const entries={},fileHashes={};
async function collect(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name),name=relative(stage,path).split('\\').join('/');
  // The server serves /toolchain from the one public/toolchain copy.
  if(name==='dist/toolchain')continue;
  if(entry.isDirectory()){await collect(path);continue;}
  if(!entry.isFile())throw new Error(`Unexpected special file: ${name}`);
  const bytes=await fs.readFile(path);fileHashes[name]=hash(bytes);
  entries[name]=[bytes,{level:['.gz','.wasm','.png'].includes(extname(name))?0:6,mtime:new Date(createdAt)}];
}}
await collect(stage);
entries['SHA256SUMS.txt']=Buffer.from(Object.entries(fileHashes).sort(([a],[b])=>a.localeCompare(b)).map(([name,digest])=>`${digest}  ${name}\n`).join(''));
await fs.mkdir(out,{recursive:true});
const zip=zipSync(entries),target=resolve(out,name+'.zip');await fs.writeFile(target,zip);
await fs.writeFile(target+'.sha256',`${hash(zip)}  ${name}.zip\n`);
console.log(JSON.stringify({zip:target,bytes:zip.length,files:Object.keys(entries).length,snapshot,baseCommit:revision},null,2));
