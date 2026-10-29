import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {traceModel,compileCToIR} from "./model/index.mjs";

try {
  const args=process.argv.slice(2);
  if(args.includes("--help")){console.log("사용법: pnpm trace:c [입력.c] [--compile-only] [--stdin 입력.txt] [--out-dir 기록폴더] [--max-events 100000] [--timeout-ms 25000] [--with-observations]");}
  else {
    let input="examples/c/instrumentation-basic.c",output="test-results/c-model",inputFile,hasInput=false,compileOnly=false;const options={};
    for(let i=0;i<args.length;i++){
      const arg=args[i];if(arg==="--compile-only"){compileOnly=true;continue;}if(arg==="--with-observations"){options.includeObservations=true;continue;}if(["--stdin","--out-dir","--max-events","--timeout-ms"].includes(arg)){
        const value=args[++i];if(value===undefined)throw new Error(`${arg} 값이 필요합니다.`);
        if(arg==="--stdin")inputFile=value;if(arg==="--out-dir")output=value;if(arg==="--max-events")options.maxEvents=Number(value);if(arg==="--timeout-ms")options.timeoutMs=Number(value);
      }else if(!arg.startsWith("-")&&!hasInput){input=arg;hasInput=true;}else throw new Error(`알 수 없는 인자: ${arg}`);
    }
    const source=await readFile(resolve(input),"utf8");options.filename=input.replaceAll("\\","/");options.stdin=!compileOnly&&inputFile?await readFile(resolve(inputFile),"utf8"):"";
    const result=await (compileOnly?compileCToIR(source,options):traceModel(source,options)),directory=resolve(output);await mkdir(directory,{recursive:true});
    for(const [name,value]of Object.entries({"original.c":source,"original.ast.txt":result.ast,"original.ll":result.llvm,"instrumented.ll":result.instrumentedLLVM,
      "plan.json":JSON.stringify(result.plan,null,2),"trace.json":JSON.stringify(result.trace,null,2),
      ...(result.observations?{"observations.plan.json":JSON.stringify(result.observations.plan,null,2),"observations.trace.json":JSON.stringify(result.observations.trace,null,2)}:{}),
      "trace.jsonl":result.trace?.events.map(e=>JSON.stringify(e)).join("\n"),"stdout.txt":result.stdout,
      "diagnostics.txt":(result.compilerDiagnostics??"")+(result.stderr??"")}))if(value!==null&&value!==undefined)await writeFile(join(directory,name),value+((name.endsWith(".json")||name.endsWith(".jsonl"))?"\n":""));
    if(result.trace){
      console.log(`C 실행: ${result.trace.status}, exit=${result.trace.exitCode}`);
      console.log(`중간언어: ${result.plan?.instructions.length??0}개 명령 / ${result.trace.events.length}개 실행 / ${result.trace.objects.length}개 저장 영역`);
      if(result.stdout)console.log(result.stdout.trimEnd());for(const diagnostic of result.trace.diagnostics)console.error(`${diagnostic.code}: ${diagnostic.message}`);
    }else console.log(`중간언어 변환: ${result.plan.instructions.length}개 명령 (사용자 코드 실행 안 함)`);
    console.log(`결과: ${directory}`);process.exitCode=!result.trace||result.trace.status==="completed"?0:1;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
