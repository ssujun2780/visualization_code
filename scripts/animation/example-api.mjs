import {fork} from 'node:child_process';
import {resolve, relative} from 'node:path';
import {examples} from './examples.mjs';
import {sessionApi} from './session-api.mjs';
import {encodeExecution,EXECUTION_ACCEPT} from '../shared/execution-format.mjs';

export function exampleApi(root) {
  return (request, response, next) => {
    const prefix = '/api/animation/examples/';
    const url = new URL(request.url, 'http://localhost'), path = url.pathname;
    if (!path.startsWith(prefix)) return next();
    const send = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store','Vary':'Accept'});
      response.end(JSON.stringify(request.headers.accept?.includes(EXECUTION_ACCEPT)&&value.plan&&value.trace?encodeExecution(value):value));
    };
    if (!['GET','POST'].includes(request.method)) { response.setHeader('Allow', 'GET, POST'); send(405, {error: 'GET 또는 POST 요청만 지원합니다.'}); return; }
    const id = path.slice(prefix.length);
    if (!Object.hasOwn(examples, id)) { send(404, {error: '등록되지 않은 예제입니다.'}); return; }

    // A fresh Node process imports the current model on every request. Vite's
    // module/config cache must not pin an earlier generator implementation.
    const execute = input => {
    if(input!==null&&Buffer.byteLength(input)>16384){send(413,{error:'예제 입력은 16KB까지 지원합니다.'});return;}
    const child = fork(resolve(root, 'scripts/animation/example-worker.mjs'), [id], {
      cwd: root, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let finished = false;
    let stderr = '';
    const finish = (status, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      send(status, value);
      child.kill();
    };
    const timer = setTimeout(() => finish(504, {error: '예제의 중간언어 생성 시간이 초과됐습니다.'}), 35000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('message', message => message.result ? finish(200, message.result) : finish(422, {error: message.error ?? '예제 생성에 실패했습니다.'}));
    child.on('error', error => finish(500, {error: error.message}));
    child.on('exit', () => { if (!finished) finish(500, {error: stderr || '예제 생성 작업이 종료됐습니다.'}); });
    response.on('close', () => { if (!finished) { finished = true; clearTimeout(timer); child.kill(); } });
    child.send({stdin:input});
    };
    if(request.method==='GET'){execute(url.searchParams.get('stdin'));return;}
    let chunks=[],length=0,tooLarge=false;
    request.on('data',chunk=>{length+=chunk.length;if(length>32768){tooLarge=true;chunks=[];}else if(!tooLarge)chunks.push(chunk);});
    request.on('end',()=>{
      if(tooLarge){send(413,{error:'입력 요청이 너무 큽니다.'});return;}
      try {
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(typeof body?.stdin!=='string')throw new Error('stdin은 문자열이어야 합니다.');
        execute(body.stdin);
      } catch(error){send(400,{error:error.message});}
    });
    request.on('error',()=>send(400,{error:'입력 요청을 읽지 못했습니다.'}));
  };
}

export default function animationExamples() {
  return {
    name: 'animation-examples',
    configureServer(server) { const sessions=sessionApi(server.config.root);server.middlewares.use(sessions);server.middlewares.use(exampleApi(server.config.root));server.httpServer?.once('close',sessions.close); },
    configurePreviewServer(server) { const sessions=sessionApi(server.config.root);server.middlewares.use(sessions);server.middlewares.use(exampleApi(server.config.root));server.httpServer?.once('close',sessions.close); },
    handleHotUpdate(context) {
      const file = relative(context.server.config.root, context.file).replaceAll('\\', '/');
      if (file.startsWith('scripts/model/') || file.startsWith('scripts/instrumentation/') || file.startsWith('examples/c/animation/')) {
        context.server.ws.send({type: 'custom', event: 'animation:model-changed'});
        return [];
      }
    },
  };
}
