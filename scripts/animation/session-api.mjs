import {Worker} from 'node:worker_threads';
import {analyzeRecordingWorkAsync} from './work-analysis-client.mjs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {examples} from './examples.mjs';
import {encodeExecution,EXECUTION_ACCEPT} from '../shared/execution-format.mjs';

const limit=16384;
export function sessionApi(root) {
  const sessions=new Map();
  const close=session=>{clearTimeout(session.timer);sessions.delete(session.id);void session.worker.terminate();};
  const arm=(session,ms)=>{
    clearTimeout(session.timer);
    session.timer=setTimeout(()=>{session.reply?.(504,{error:'실행 세션의 대기 시간이 초과되었습니다.'});close(session);},ms);
    session.timer.unref?.();
  };
  const middleware=async(request,response,next)=>{
    const path=new URL(request.url,'http://localhost').pathname;
    if(!path.startsWith('/api/animation/sessions'))return next();
    const send=(status,body)=>{if(!response.destroyed&&!response.writableEnded){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept'});response.end(JSON.stringify(request.headers.accept?.includes(EXECUTION_ACCEPT)&&body.plan&&body.trace?encodeExecution(body):body));}};
    const match=/^\/api\/animation\/sessions(?:\/([\w-]+)(?:\/(input))?)?\/?$/.exec(path);
    if(!match){send(404,{error:'실행 세션 경로가 잘못되었습니다.'});return;}
    const [,id,action]=match;
    if(request.method==='DELETE'&&id&&!action){const session=sessions.get(id);if(session)close(session);send(200,{closed:true});return;}
    if(request.method!=='POST'){send(405,{error:'POST 요청만 지원합니다.'});return;}
    let size=0,chunks=[];
    try {
      const requestLimit=id?32768:4*1024*1024;
      for await(const chunk of request){size+=chunk.length;if(size>requestLimit){send(413,{error:'요청이 너무 큽니다.'});return;}chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||typeof body!=='object'||Array.isArray(body)){send(400,{error:'요청 객체가 필요합니다.'});return;}
      let session;
      if(!id){
        const custom=Object.hasOwn(body,'source');
        if(custom&&Object.hasOwn(body,'example')){send(400,{error:'소스와 예제 중 하나만 지정해 주세요.'});return;}
        if(custom&&(typeof body.source!=='string'||body.source.includes('\0'))){send(400,{error:'소스는 NUL이 없는 문자열이어야 합니다.'});return;}
        if(custom&&Buffer.byteLength(body.source)>512*1024){send(413,{error:'C 소스는 512KiB까지 지원합니다.'});return;}
        if(!custom&&!Object.hasOwn(examples,body.example)){send(404,{error:'등록되지 않은 예제입니다.'});return;}
        const batch=body.inputMode==='batch';
        if(batch&&(typeof body.stdin!=='string'||Buffer.byteLength(body.stdin)>limit)){send(400,{error:'미리 제공할 표준 입력은 16KB 이내 문자열이어야 합니다.'});return;}
        if(sessions.size>=4){send(429,{error:'실행 중인 세션을 먼저 종료해 주세요.'});return;}
        const shared=new SharedArrayBuffer(12+limit);
        const program=custom?{file:'main.c',source:body.source}:{file:resolve(root,examples[body.example].file)};
        const worker=new Worker(new URL('./session-worker.mjs',import.meta.url),{workerData:{...program,shared,...batch?{initialInput:body.stdin,inputEnded:true}:{}},execArgv:[]});
        session={id:randomUUID(),worker,shared,waiting:null,reply:send};sessions.set(session.id,session);
        worker.on('message',async message=>{
          const reply=session.reply;session.reply=null;
          if(message.type==='failure'){reply?.(422,message);close(session);return;}
          session.waiting=message.type==='input'?message.request:null;
          const {workInputs,...canonical}=message;
          // Canonical execution is already recorded; optional enrichment has an
          // independent hard deadline and can fail without replacing that trace.
          const workAnalysis=message.plan&&message.trace?await analyzeRecordingWorkAsync(message.plan,message.trace,workInputs??{}):undefined;
          reply?.(200,{sessionId:session.id,...canonical,...(workAnalysis?{workAnalysis}:{})});
          if(message.type==='complete')close(session);else arm(session,30*60*1000);
        });
        worker.on('error',error=>{session.reply?.(500,{error:error.message});close(session);});
        worker.on('exit',()=>{if(sessions.has(session.id)){session.reply?.(500,{error:'실행 세션이 종료되었습니다.'});close(session);}});
      } else {
        session=sessions.get(id);
        if(!session){send(404,{error:'종료되었거나 없는 실행 세션입니다.'});return;}
        if(action!=='input'||!session.waiting||session.reply||body.requestId!==session.waiting.id){send(409,{error:'현재 입력 대기 요청과 일치하지 않습니다.'});return;}
        if(typeof body.stdin!=='string'||typeof body.eof!=='boolean'){send(400,{error:'stdin 문자열과 eof 여부가 필요합니다.'});return;}
        const bytes=new TextEncoder().encode(body.stdin);
        if(bytes.length>limit){send(413,{error:'입력은 16KB까지 지원합니다.'});return;}
        if(!bytes.length&&!body.eof){send(400,{error:'입력할 내용을 적거나 입력 종료(EOF)를 선택해 주세요.'});return;}
        session.reply=send;session.waiting=null;
        new Uint8Array(session.shared,12).set(bytes);
        const control=new Int32Array(session.shared,0,3);
        Atomics.store(control,1,bytes.length);Atomics.store(control,2,body.eof?1:0);Atomics.store(control,0,1);Atomics.notify(control,0);
      }
      arm(session,35000);
      response.on('close',()=>{if(session.reply===send)close(session);});
    } catch(error){send(400,{error:error.message});}
  };
  middleware.close=()=>{for(const session of sessions.values())close(session);};
  return middleware;
}
