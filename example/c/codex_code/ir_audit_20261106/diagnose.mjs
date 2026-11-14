import fs from 'node:fs/promises';
import {prepareCModel} from '../../../../scripts/model/compile.mjs';
import {emitLLVM} from '../../../../scripts/instrumentation/toolchain.mjs';
const base=new URL('../../../../test-results/ir-audit-2026-11-06/',import.meta.url);
for(const id of process.argv.slice(2)){
 const source=await fs.readFile(new URL(id+'.c',import.meta.url),'utf8');
 try{await prepareCModel(source);console.log(id+': preparation succeeded');}
 catch(e){await fs.writeFile(new URL(id+'/preparation-error.txt',base),e.stack+'\n');console.log(id+': '+e.stack);
  const a=await emitLLVM(source);await fs.writeFile(new URL(id+'/source.ast.txt',base),a.ast);await fs.writeFile(new URL(id+'/source.ll',base),a.llvm);
 }
}
