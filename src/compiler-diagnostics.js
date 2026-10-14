export function parseCompilerDiagnostics(text) {
  return [...text.matchAll(/(?:^|\n)\/?main\.c:(\d+):(\d+):\s*(fatal error|error|warning|note):\s*([^\n]+)/g)]
    .map(([, line, column, severity, message]) => ({
      line: Number(line), column: Number(column),
      severity: severity === "fatal error" ? "error" : severity, message: message.trim(),
    }));
}
