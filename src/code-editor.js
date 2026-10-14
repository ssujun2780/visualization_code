import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/languages/definitions/cpp/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { parseCompilerDiagnostics } from "./compiler-diagnostics.js";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const snippets = [
  ["printf", 'printf("${1:Hello World!}\\n"${2});', "표준 출력"],
  ["scanf", 'scanf("${1:%d}", &${2:value});', "표준 입력"],
  ["for", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}", "반복문"],
  ["while", "while (${1:condition}) {\n\t$0\n}", "조건 반복문"],
  ["if", "if (${1:condition}) {\n\t$0\n}", "조건문"],
  ["malloc", "malloc(sizeof(${1:int}) * ${2:count})", "동적 메모리 할당 · stdlib.h"],
  ["free", "free(${1:ptr});", "동적 메모리 해제 · stdlib.h"],
];
monaco.languages.registerCompletionItemProvider("c", {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    return { suggestions: snippets.map(([label, insertText, detail]) => ({
      label, insertText, detail, range, kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    })) };
  },
});

export function createCodeEditor(container, value, onRun) {
  const editor = monaco.editor.create(container, {
    value, language: "c", theme: "vs-dark", ariaLabel: "C 소스 코드",
    editContext: false, // Use the established textarea input path across browsers and IMEs.
    automaticLayout: true, fontFamily: 'Consolas, "Cascadia Code", "Malgun Gothic", monospace',
    fontSize: 14, lineHeight: 24, tabSize: 4, insertSpaces: false, detectIndentation: false,
    autoIndent: "full", autoClosingBrackets: "languageDefined", autoClosingQuotes: "languageDefined",
    bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: true },
    lineNumbers: "on", lineNumbersMinChars: 3, renderLineHighlight: "all",
    folding: true, showFoldingControls: "always", padding: { top: 16, bottom: 16 },
    minimap: { enabled: container.clientWidth >= 600, renderCharacters: false, maxColumn: 80 },
    scrollBeyondLastLine: false, wordWrap: "off", fixedOverflowWidgets: true,
    tabCompletion: "on", acceptSuggestionOnEnter: "smart", wordBasedSuggestions: "currentDocument",
    overviewRulerBorder: false, scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });
  editor.addAction({
    id: "c-workbench.run", label: "C 코드 컴파일 · 실행", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    contextMenuGroupId: "navigation", contextMenuOrder: 1, run: onRun,
  });
  const resize = new ResizeObserver(() => editor.updateOptions({ minimap: { enabled: container.clientWidth >= 600 } }));
  resize.observe(container);
  editor.onDidDispose(() => resize.disconnect());
  return editor;
}

export function setCompilerDiagnostics(editor, text) {
  const model = editor.getModel();
  const severities = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, note: monaco.MarkerSeverity.Info };
  const markers = parseCompilerDiagnostics(text).filter(item => item.line <= model.getLineCount()).map(item => {
    const column = Math.min(item.column, model.getLineMaxColumn(item.line));
    return {
      startLineNumber: item.line, startColumn: column, endLineNumber: item.line,
      endColumn: model.getWordAtPosition({ lineNumber: item.line, column })?.endColumn ?? column + 1,
      severity: severities[item.severity], message: item.message, source: "Clang",
    };
  });
  monaco.editor.setModelMarkers(model, "clang", markers);
}
