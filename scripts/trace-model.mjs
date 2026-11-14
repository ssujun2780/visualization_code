import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {traceModel,compileCToIR} from "./model/index.mjs";
import {writeJSON} from './shared/json-output.mjs';
import {writeExecutionFiles} from './shared/execution-files.mjs';

try {
  const args=process.argv.slice(2);
  if(args.includes("--help")){console.log("사용법: pnpm trace:c [입력.c] [--compile-only] [--stdin 입력.txt] [--out-dir 기록폴더] [--max-events 100000] [--max-observation-bytes 16777216] [--timeout-ms 25000] [--with-observations] [--expanded] [--pretty] [--jsonl]\n기본값: definitions.json 공통 정의 + 참조형 plan.json·trace.json. --expanded는 기존 펼친 형식, --pretty는 들여쓰기, --jsonl은 추가 사건 사본입니다.\n중간언어만 생성합니다. 자료구조 추론은 node scripts/infer-structures.mjs 기록폴더로 별도 실행합니다.");}
  else {
    let input="examples/c/instrumentation-basic.c",output="test-results/c-model",inputFile,hasInput=false,compileOnly=false,expanded=false,pretty=false,jsonl=false;const options={};
    for(let i=0;i<args.length;i++){
      const arg=args[i];if(arg==='--jsonl'){jsonl=true;continue;}if(arg==='--expanded'){expanded=true;continue;}if(arg==='--pretty'){pretty=true;continue;}if(arg==="--compile-only"){compileOnly=true;continue;}if(arg==="--with-observations"){options.includeObservations=true;continue;}if(["--stdin","--out-dir","--max-events","--timeout-ms","--max-observation-bytes"].includes(arg)){
        const value=args[++i];if(value===undefined)throw new Error(`${arg} 값이 필요합니다.`);
        if(arg==="--stdin")inputFile=value;if(arg==="--out-dir")output=value;if(arg==="--max-events")options.maxEvents=Number(value);if(arg==="--timeout-ms")options.timeoutMs=Number(value);
        if(arg==='--max-observation-bytes')options.maxObservationBytes=Number(value);
      }else if(!arg.startsWith("-")&&!hasInput){input=arg;hasInput=true;}else throw new Error(`알 수 없는 인자: ${arg}`);
    }
    const source=await readFile(resolve(input),"utf8");options.filename=input.replaceAll("\\","/");options.stdin=!compileOnly&&inputFile?await readFile(resolve(inputFile),"utf8"):"";
    const result=await (compileOnly?compileCToIR(source,options):traceModel(source,options)),directory=resolve(output);await mkdir(directory,{recursive:true});
    for(const [name,value]of Object.entries({"original.c":source,"original.ast.txt":result.ast,"original.ll":result.llvm,"instrumented.ll":result.instrumentedLLVM,
      "stdout.txt":result.stdout,
      "diagnostics.txt":(result.compilerDiagnostics??"")+(result.stderr??"")}))if(value!==null&&value!==undefined)await writeFile(join(directory,name),value+((name.endsWith(".json")||name.endsWith(".jsonl"))?"\n":""));
    await writeExecutionFiles(directory,result,{expanded,pretty,jsonl});
    for(const [name,value]of Object.entries({'conversion-failure.json':result.conversionFailure,'conversion-notice.json':result.conversionNotice,'recording-notice.json':result.recordingNotice}))
      if(value!==undefined&&value!==null)await writeJSON(join(directory,name),value,{pretty});
    console.log(expanded?'저장 형식: 기존 펼친 JSON':'저장 형식: 공통 정의 분리 · definitions.json과 함께 읽습니다.');
    if(result.trace){
      console.log(`C 실행: ${result.trace.status}, exit=${result.trace.exitCode}`);
      console.log(`중간언어: ${result.plan?.instructions.length??0}개 명령 / ${result.trace.events.length}개 실행 / ${result.trace.objects.length}개 저장 영역`);
      if(result.stdout)console.log(result.stdout.trimEnd());for(const diagnostic of result.trace.diagnostics)console.error(`${diagnostic.code}: ${diagnostic.message}`);
      if(result.conversionNotice)console.error('시간 제한으로 중간언어는 일부 구간까지 변환됐습니다. 나머지 관찰은 observations.trace.json에 보존했습니다.');
      if(result.recordingNotice)console.error(result.recordingNotice.message);
    }else console.log(`중간언어 변환: ${result.plan.instructions.length}개 명령 (사용자 코드 실행 안 함)`);
    console.log(`결과: ${directory}`);process.exitCode=!result.trace||result.trace.status==="completed"?0:1;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
