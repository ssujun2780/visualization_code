import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {inferExecutionRelationsAsync} from './execution-relations/index.mjs';
import {writeJSON} from './shared/json-output.mjs';
import {readExecutionFiles} from './shared/execution-files.mjs';

try{
  const args=process.argv.slice(2);
  if(args.includes('--help'))console.log('사용법: node scripts/infer-execution-relations.mjs [기록폴더] [--out-dir 결과폴더] [--structure-inference inference.json] [--schema-version 1|2] [--compiler-facts facts.json] [--observation-evidence observations.json] [--timeout-ms 25000]\nplan.json·trace.json을 읽어 실행 관계 메타데이터만 저장합니다. 확장 분석은 --schema-version 2로 선택합니다.');
  else{
    let input='test-results/c-model',output,structureFile,compilerFile,observationFile,outputSchemaVersion=1,timeoutMs=25000,hasInput=false;
    for(let i=0;i<args.length;i++){
      const arg=args[i];
      if(['--out-dir','--structure-inference','--timeout-ms','--schema-version','--compiler-facts','--observation-evidence'].includes(arg)){
        const value=args[++i];if(value===undefined||value.startsWith('--'))throw new Error(`${arg} 값이 필요합니다.`);
        if(arg==='--out-dir')output=value;else if(arg==='--structure-inference')structureFile=value;else if(arg==='--compiler-facts')compilerFile=value;
        else if(arg==='--observation-evidence')observationFile=value;else if(arg==='--schema-version')outputSchemaVersion=Number(value);else timeoutMs=Number(value);
      }else if(!arg.startsWith('-')&&!hasInput){input=arg;hasInput=true;}else throw new Error(`알 수 없는 인자: ${arg}`);
    }
    const directory=resolve(input),destination=resolve(output??input),read=path=>readFile(path,'utf8').then(JSON.parse);
    const [{plan,trace},structureInference,compilerFacts,observationEvidence]=await Promise.all([readExecutionFiles(directory,{includeObservations:false}),structureFile?read(resolve(structureFile)):undefined,compilerFile?read(resolve(compilerFile)):undefined,observationFile?read(resolve(observationFile)):undefined]);
    const result=await inferExecutionRelationsAsync(plan,trace,{timeoutMs,structureInference,compilerFacts,observationEvidence,outputSchemaVersion});
    const artifact=outputSchemaVersion===2?'execution-relations-v2.json':'execution-relations.json';
    await mkdir(destination,{recursive:true});await writeJSON(join(destination,artifact),result);
    console.log(`실행 관계 분석: ${result.status}, 관계 ${result.relations.length}개`);
    for(const diagnostic of result.diagnostics)console.log(`${diagnostic.code}: ${diagnostic.message}`);
    console.log(`결과: ${join(destination,artifact)}`);
    process.exitCode=['failed','partial'].includes(result.status)?1:0;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
