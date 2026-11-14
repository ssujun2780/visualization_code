import {parseCompilerDiagnostics} from '../../src/compiler-diagnostics.js';

// Preserve compiler diagnostics at the UI boundary, independently of the model.
export function executionFailure(error, {source, file, stage}) {
  const actualStage = error.stage ?? stage;
  const diagnostics = actualStage === 'compile' ? parseCompilerDiagnostics(error.message).filter(d => d.severity === 'error') : [];
  const first = diagnostics[0];
  return {type: 'failure', error: error.message,
    failure: {stage: actualStage,
      title: actualStage === 'compile' ? '컴파일 오류' : actualStage === 'link' ? '링크 오류' : '실행 준비·기록 오류',
      message: first?.message ?? error.message,
      source: first ? {file, line: first.line, column: first.column,
        editorRange: {startLineNumber: first.line, endLineNumber: first.line, startColumn: first.column, endColumn: first.column + 1}} : null,
      diagnostics, details: error.message},
    snapshot: typeof source === 'string' ? {file, text: source} : null};
}
