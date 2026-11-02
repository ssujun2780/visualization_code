import {getCompiler,execute} from './browser-toolchain.js';
import {parseCompilerDiagnostics} from './compiler-diagnostics.js';
import {fallthroughDiagnostics} from './source-diagnostics.js';

const flags=['clang','-cc1','-triple','wasm32-unknown-wasi','-isysroot','/sys',
  '-internal-isystem','/sys/include','-internal-isystem','/sys/lib/clang/8.0.1/include',
  '-std=c11','-Wall','-Wextra','-O0','-ferror-limit','10'];
const decoder=new TextDecoder();
self.onmessage=async({data:{id,code}})=>{
  try{
    if(new TextEncoder().encode(code).length>512*1024)throw new Error('코드가 커서 자동 검사를 생략했습니다.');
    self.postMessage({id,type:'checking'});
    const [clang,baseFS]=await getCompiler(),time=new Date(0);
    const fs={...baseFS,'/main.c':{path:'/main.c',mode:'string',content:code,timestamps:{access:time,modification:time,change:time}}};
    let ast='',diagnostics='',size=0;
    const collect=channel=>text=>{
      size+=text.length;if(size>8*1024*1024)throw new Error('자동 검사 결과가 너무 큽니다.');
      if(channel==='ast')ast+=text;else diagnostics+=text;
    };
    const syntax=await execute(clang,{args:[...flags,'-ast-dump','/main.c'],fs,stdout:collect('ast'),stderr:collect('diagnostics')});
    let items=parseCompilerDiagnostics(diagnostics).map(item=>{
      const bytes=new TextEncoder().encode(code.split('\n')[item.line-1]??'');
      return {...item,column:decoder.decode(bytes.subarray(0,item.column-1)).length+1,source:'Clang'};
    });
    if(syntax.exitCode===0&&ast.includes('SwitchStmt')){
      const compiled=await execute(clang,{args:[...flags,'-emit-llvm','-debug-info-kind=standalone','-dwarf-column-info','-o','/check.ll','/main.c'],
        fs,stdout:()=>{},stderr:()=>{}});
      if(compiled.exitCode!==0)throw new Error('제어 흐름 검사를 완료하지 못했습니다.');
      const content=compiled.fs['/check.ll'].content,llvm=typeof content==='string'?content:decoder.decode(content);
      const extra=fallthroughDiagnostics(ast,llvm,code);
      items.push(...extra.filter(item=>!items.some(existing=>existing.line===item.line&&/fall.?through/i.test(existing.message))));
    }
    self.postMessage({id,type:'result',items});
  }catch(error){self.postMessage({id,type:'failed',message:error.message??String(error)});}
};
