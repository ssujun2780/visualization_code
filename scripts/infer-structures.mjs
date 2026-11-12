import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {inferStructuresAsync} from './inference/index.mjs';
import {writeJSON} from './shared/json-output.mjs';

const optional=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}};
try{
  const args=process.argv.slice(2);
  if(args.includes('--help'))console.log('사용법: node scripts/infer-structures.mjs [중간언어 결과폴더] [--out-dir 추론폴더] [--timeout-ms 25000]\nplan.json·trace.json을 읽고 inference.json만 저장합니다. C 코드를 다시 실행하지 않습니다.');
  else{
    let input='test-results/c-model',output,timeoutMs=25000,hasInput=false;
    for(let i=0;i<args.length;i++){
      const arg=args[i];
      if(['--out-dir','--timeout-ms'].includes(arg)){const value=args[++i];if(value===undefined)throw new Error(`${arg} 값이 필요합니다.`);
        if(arg==='--out-dir')output=value;else timeoutMs=Number(value);}
      else if(!arg.startsWith('-')&&!hasInput){input=arg;hasInput=true;}else throw new Error(`알 수 없는 인자: ${arg}`);
    }
    const directory=resolve(input),destination=resolve(output??input);
    const [plan,trace,observationPlan,observedTrace]=await Promise.all([
      readFile(join(directory,'plan.json'),'utf8').then(JSON.parse),readFile(join(directory,'trace.json'),'utf8').then(JSON.parse),
      optional(join(directory,'observations.plan.json')),optional(join(directory,'observations.trace.json'))]);
    const inference=await inferStructuresAsync(plan,trace,{timeoutMs,observationPlan,observedTrace});
    await mkdir(destination,{recursive:true});await writeJSON(join(destination,'inference.json'),inference);
    console.log(`자료구조 추론: ${inference.status}, 후보 ${inference.structures.length}개`);
    console.log(`결과: ${join(destination,'inference.json')}`);
    for(const d of inference.diagnostics)console.error(`${d.code}: ${d.message}`);
    process.exitCode=inference.status==='completed'?0:1;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
