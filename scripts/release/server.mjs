import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {sessionApi} from '../animation/session-api.mjs';
import {exampleApi} from '../animation/example-api.mjs';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.gz':'application/gzip',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const within=(root,file)=>{const r=relative(root,file);return r!== '..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};

// Only hosts the existing APIs and built files. Compilation, inference and
// playback semantics stay in their existing modules.
export async function startReleaseServer({root=fileURLToPath(new URL('../../',import.meta.url)),host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??5173)}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT는 0~65535 정수여야 합니다.');
  root=await realpath(root);
  const dist=await realpath(resolve(root,'dist')),toolchain=await realpath(resolve(root,'public/toolchain'));
  await stat(resolve(dist,'animation.html'));
  const sessions=sessionApi(root),examples=exampleApi(root);
  const send=(res,status,text)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(text);};
  async function files(req,res){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');send(res,405,'Method not allowed');return;}
    let path;
    try{path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{send(res,400,'Invalid path');return;}
    if(path.includes('\0')||path.includes('\\')){send(res,400,'Invalid path');return;}
    if(path.startsWith('/api/')){send(res,404,'API not found');return;}
    const tools=path.startsWith('/toolchain/'),base=tools?toolchain:dist;
    const requested=resolve(base,tools?path.slice('/toolchain/'.length):path==='/'?'animation.html':'.'+path);
    if(!within(base,requested)){send(res,403,'Forbidden');return;}
    let file,info;
    try{file=await realpath(requested);if(!within(base,file)){send(res,403,'Forbidden');return;}info=await stat(file);}
    catch(e){if(['ENOENT','ENOTDIR'].includes(e.code)){send(res,404,'Not found');return;}throw e;}
    if(!info.isFile()){send(res,404,'Not found');return;}
    res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':info.size,
      'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){res.end();return;}
    await pipeline(createReadStream(file),res);
  }
  const server=createServer((req,res)=>{
    const fail=error=>{if(res.destroyed)return;if(res.headersSent)res.destroy(error);else send(res,500,'Server error');};
    const next=()=>{try{examples(req,res,()=>void files(req,res).catch(fail));}catch(e){fail(e);}};
    void Promise.resolve(sessions(req,res,next)).catch(fail);
  });
  server.on('close',sessions.close);
  await new Promise((ok,no)=>{server.once('error',no);server.listen(port,host,()=>{server.off('error',no);ok();});});
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  // Legacy example workers resolve their catalog paths relative to cwd.
  process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
  const server=await startReleaseServer();
  console.log(`C 작업실: http://${process.env.HOST??'127.0.0.1'}:${server.address().port}/`);
  console.log('종료: Ctrl+C');
  const stop=()=>{server.close();server.closeAllConnections();const timer=setTimeout(()=>process.exit(0),2000);timer.unref();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
