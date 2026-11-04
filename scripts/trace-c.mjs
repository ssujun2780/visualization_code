import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { traceC } from "./instrumentation/prototype.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("사용법: pnpm trace:c [입력.c] [--out-dir 기록폴더]\n기본 입력: examples/c/instrumentation-basic.c\n기본 출력: test-results/instrumentation-prototype");
} else {
  try {
    let input = "examples/c/instrumentation-basic.c", output = "test-results/instrumentation-prototype", hasInput = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--out-dir" && args[i + 1]) output = args[++i];
      else if (!args[i].startsWith("-") && !hasInput) { input = args[i]; hasInput = true; }
      else throw new Error(`알 수 없는 인자: ${args[i]}`);
    }
    const source = await readFile(resolve(input), "utf8");
    const result = await traceC(source, { filename: input.replaceAll("\\", "/") });
    const directory = resolve(output);
    await mkdir(directory, { recursive: true });
    const artifacts = {
      "original.c": source,
      "original.ast.txt": result.ast,
      "instrumented.c": result.instrumentedSource,
      "plan.json": JSON.stringify(result.plan, null, 2) + "\n",
      "trace.json": JSON.stringify(result.trace, null, 2) + "\n",
      "trace.jsonl": result.trace.events.map(e => JSON.stringify(e)).join("\n") + "\n",
      "diagnostics.txt": result.compilerDiagnostics + result.stderr,
    };
    for (const [name, contents] of Object.entries(artifacts)) await writeFile(join(directory, name), contents, "utf8");
    console.log(`실제 C 실행: ${result.trace.status}, exit=${result.trace.exitCode}`);
    console.log(`중간 언어: ${result.plan.instructions.length}개 명령 / ${result.trace.events.length}개 사건`);
    for (const object of result.trace.objects.filter(o => o.storage === "automatic")) {
      console.log(`${object.name} = ${object.value?.decimal ?? "미초기화"} (${object.value?.bits ?? "비트 미관측"})`);
    }
    for (const fault of result.trace.diagnostics) console.error(`${fault.code}: ${fault.message}`);
    console.log(`기록: ${directory}`);
    process.exitCode = result.trace.status === "completed" ? result.trace.exitCode : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
