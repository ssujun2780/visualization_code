import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { traceC } from "../scripts/instrumentation/prototype.mjs";
import { compileAndRun } from "../scripts/instrumentation/toolchain.mjs";

const variable = (result, name) => result.trace.objects.find(o => o.name === name);
const committed = (result, kind) => result.trace.events.filter(e => e.kind === kind && e.phase === "commit");

test("actual Clang/WASI execution records 50 and links its runtime operands", async () => {
  const source = await readFile(new URL("../examples/c/instrumentation-basic.c", import.meta.url), "utf8");
  const result = await traceC(source);
  assert.equal(result.trace.status, "completed");
  assert.equal(result.trace.exitCode, 0);
  assert.deepEqual(["a", "b", "c"].map(n => variable(result, n).value.decimal), ["10", "20", "50"]);
  assert.deepEqual(new Set(result.plan.instructions.map(i => i.kind)), new Set(["SPACE", "FLOW", "READ", "CALC", "WRITE"]));
  const calculations = committed(result, "CALC");
  assert.deepEqual(calculations.map(e => e.value.decimal), ["40", "50"]);
  assert.equal(calculations[0].sceneInstanceId, calculations[1].sceneInstanceId);
  assert.equal(calculations[0].source.start.line, 4);
  assert.equal(Buffer.from(source).subarray(calculations[0].source.start.byte, calculations[0].source.end.byte).toString(), "b * 2");
  assert.equal(calculations[0].operands[1].value.decimal, "2");
  const finalWrite = result.trace.events.find(e => e.eventId === variable(result, "c").lastWrite);
  assert.deepEqual(finalWrite.dataInputs, [calculations[1].eventId]);
  assert.ok(calculations[1].dataInputs.includes(calculations[0].eventId));
  for (const read of committed(result, "READ")) {
    const previous = result.trace.events.find(e => e.eventId === read.previousWrite);
    assert.equal(previous.kind, "WRITE");
    assert.equal(previous.target.objectId, read.target.objectId);
    assert.equal(previous.value.decimal, read.value.decimal);
    assert.match(read.target.address, /^0x[0-9a-f]{8}$/);
  }
  for (const object of result.trace.objects.filter(o => o.storage === "automatic")) assert.equal(object.lifecycle, "ended");
});

test("changed inputs, parentheses and negative C division match uninstrumented execution", async () => {
  const source = "/* 한글 주석 */\r\nint main(void) {\r\n int a=7, b=3;\r\n int c=(a-b)*-2+a/b;\r\n return c;\r\n}\r\n";
  const baseline = await compileAndRun(source);
  const result = await traceC(source, { filename: "한글 경로/input.c" });
  assert.equal(variable(result, "c").value.decimal, "-6");
  assert.equal(result.trace.exitCode, baseline.exitCode);
  assert.equal(result.plan.source.file, "한글 경로/input.c");
  for (const op of result.plan.instructions) {
    if (op.source) assert.equal(Buffer.from(source).subarray(op.source.start.byte, op.source.end.byte).toString(), op.expression);
  }
});

test("assignment updates the last writer used by later reads", async () => {
  const result = await traceC("int main(void){int a=10;int b=20;a=7;int c=a+b*2;return c;}");
  assert.equal(variable(result, "a").value.decimal, "7");
  assert.equal(variable(result, "c").value.decimal, "47");
  assert.equal(result.trace.exitCode, 47);
  const readA = committed(result, "READ").find(e => e.target.objectId === variable(result, "a").id);
  assert.equal(readA.previousWrite, variable(result, "a").lastWrite);
});

test("uninitialized read faults before a C load or destination store", async () => {
  const result = await traceC("int main(void){int a;int c=a+1;return 0;}");
  assert.equal(result.trace.status, "fault");
  assert.equal(result.trace.diagnostics[0].code, "uninitialized-read");
  assert.equal(committed(result, "READ").length, 0);
  assert.equal(variable(result, "c").initialized, false);
  assert.equal(committed(result, "WRITE").length, 0);
  assert.ok(!result.trace.events.some(e => e.action === "return"));
});

test("integer arithmetic checks stop the original operation before undefined behavior", async () => {
  for (const [expression, code] of [["10/0", "division-by-zero"], ["10%0", "division-by-zero"],
    ["2147483647+1", "signed-overflow"], ["50000*50000", "signed-overflow"],
    ["(-2147483647-1)/-1", "signed-overflow"]]) {
    const result = await traceC(`int main(void){int c=${expression};return 0;}`);
    assert.equal(result.trace.status, "fault", expression);
    assert.equal(result.trace.diagnostics[0].code, code, expression);
    assert.equal(variable(result, "c").initialized, false);
    assert.ok(!result.trace.events.some(e => e.kind === "WRITE" && e.target?.objectId === variable(result, "c").id));
  }
});

test("remainder and unary plus retain C values, and main can return implicitly", async () => {
  const result = await traceC("int main(void){int a=-7;int b=3;int c=+a%b;}");
  assert.equal(variable(result, "c").value.decimal, "-1");
  assert.equal(result.trace.exitCode, 0);
});

test("unsupported syntax fails explicitly instead of inventing a partial trace", async () => {
  for (const source of ["int x; int main(void){return 0;}",
    "int main(void){int a=1;if(a){a=2;}return 0;}",
    "int main(void){int a=1;a++;return 0;}",
    "int main(void){double a=1;return 0;}",
    "int main(void){int a=1;return f(a);}",
    "#define A 10\nint main(void){int a=A;return 0;}"] ) {
    await assert.rejects(traceC(source), /지원하지|지원합니다/);
  }
});

test("invalid C produces compiler diagnostics before instrumentation", async () => {
  await assert.rejects(traceC("int main(void){int a=;}"), /C 분석 실패:[\s\S]*error:/);
});

test("WASI execution consumes stdin bytes, including UTF-8, without changing compiler input", async () => {
  const result = await compileAndRun('#include <stdio.h>\nint main(void){int n;char s[8];if(scanf("%d %7s",&n,s)!=2)return 1;printf("%d:%s\\n",n,s);return 0;}',
    undefined, { stdin: "2 가나\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "2:가나\n");
});
