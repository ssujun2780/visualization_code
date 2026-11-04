import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {emitLLVM} from '../scripts/instrumentation/toolchain.mjs';
import {fallthroughDiagnostics} from '../src/source-diagnostics.js';

async function inspect(source){const {ast,llvm}=await emitLLVM(source);return fallthroughDiagnostics(ast,llvm,source);}
test('No3 warns before execution, ignores explanatory comments, and clears with break',async()=>{
  const source=await readFile(new URL('../examples/c/blind/No3.c',import.meta.url),'utf8');
  const warnings=await inspect(source);assert.equal(warnings.length,1);
  assert.equal(warnings[0].line,27);assert.equal(warnings[0].related.from.line,24);
  assert.equal((await inspect(source.replace('/* fall through */',''))).length,1);
  assert.deepEqual(await inspect(source.replace('/* fall through */','break;')),[]);
});
test('compiler CFG distinguishes fall-through from jumps, loops, shared labels and terminating paths',async()=>{
  const cases=[
    ['shared labels','case 1: case 2: n++; break; default: n=3;',0],
    ['conditional break','case 1: if(n) break; n++; case 2: n++; break;',1],
    ['both arms terminate','case 1: if(n) break; else return 0; case 2: n++; break;',0],
    ['inner-loop break','case 1: while(n){n--;break;} case 2: n++; break;',1],
    ['infinite loop','case 1: while(1){} case 2: n++; break;',0],
    ['nested switch','case 1: switch(n){case 1:n++;break;default:return 0;} case 2:n++;break;',1],
    ['explicit goto','case 1: goto out; case 2: n++; break;',0],
    ['noreturn call','case 1: exit(0); case 2:n++;break;',0],
  ];
  for(const [name,body,count] of cases){
    const source=`#include <stdlib.h>\nint f(int n){switch(n){${body}}out:return n;}`;
    assert.equal((await inspect(source)).length,count,name);
  }
});
test('warning positions use editor columns after non-ASCII source text',async()=>{
  const source='int f(int n){switch(n){case 1:n++; /* 한글 */ default:n++;}return n;}';
  const [warning]=await inspect(source);assert.equal(warning.column,source.indexOf('default')+1);
});
