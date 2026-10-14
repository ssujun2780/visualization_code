import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCompilerDiagnostics } from "../src/compiler-diagnostics.js";

test("Clang errors, warnings and notes retain their source positions", () => {
  const text = "/main.c:4:2: error: use of undeclared identifier 'x'\n x;\n ^\nmain.c:5:9: warning: unused variable 'a'\nmain.c:2:1: note: declared here\n";
  assert.deepEqual(parseCompilerDiagnostics(text), [
    { line: 4, column: 2, severity: "error", message: "use of undeclared identifier 'x'" },
    { line: 5, column: 9, severity: "warning", message: "unused variable 'a'" },
    { line: 2, column: 1, severity: "note", message: "declared here" },
  ]);
});
test("fatal errors are errors, runtime messages do not create source markers", () => {
  assert.equal(parseCompilerDiagnostics("main.c:1:10: fatal error: 'missing.h' file not found")[0].severity, "error");
  assert.deepEqual(parseCompilerDiagnostics("프로그램 실행 시간이 초과했습니다."), []);
});
