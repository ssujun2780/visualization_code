import "./styles.css";
import { createCodeEditor, setCompilerDiagnostics } from "./code-editor.js";
import {parseCompilerDiagnostics} from './compiler-diagnostics.js';
import {createLiveDiagnostics} from './live-diagnostics.js';
import {localizeDiagnostic,diagnosticTooltip,localizeCompilerOutput} from './diagnostic-messages.ko.js';

const defaultCode = '#include <stdio.h>\n\nint main(){\n\tprintf("Hello World!\\n");\n\treturn 0;\n}\n';
const previousDefault = '#include <stdio.h>\n\nint main() {\n    return 0;\n}\n';
const templates = {
  template: defaultCode,
  hello: defaultCode,
  sum: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) {\n        fprintf(stderr, "두 정수를 입력해주세요.\\n");\n        return 1;\n    }\n    printf("%d\\n", a + b);\n    return 0;\n}\n',
};
const elements = Object.fromEntries(["code", "stdin", "run", "stop", "output", "diagnostics", "status", "timing", "example", "exit-code", "cursor-position", "diagnostics-section", "go-to-error", "find-code", "expand-editor"].map(id => [id, document.getElementById(id)]));
const storageKey = "c-workbench-v1";
let worker;
let activeRun;
let requestId = 0;
let deadline;
let stdout = "";
let diagnostics = "";
let errorLocation;
let outputScheduled = false;
let outputPlaceholder = "출력 결과가 여기에 표시됩니다.";
let initialCode = defaultCode;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  initialCode = typeof saved?.code === "string" && saved.code !== previousDefault ? saved.code : defaultCode;
  elements.stdin.value = saved?.stdin ?? "";
} catch { /* Keep the default when storage is unavailable. */ }
const codeEditor = createCodeEditor(elements.code, initialCode, run);
const problemList=document.getElementById('code-problems-list');
const problemPanel=document.getElementById('code-problems');
const analysisStatus=document.getElementById('analysis-status');
let liveDiagnostics=[],runSourceVersion=null;
const liveChecks=createLiveDiagnostics({
  createWorker:()=>new Worker(new URL('./diagnostics.worker.js',import.meta.url),{type:'module'}),
  publish:items=>{
    items=items.map(localizeDiagnostic);
    liveDiagnostics=items;problemPanel.hidden=!items.length;problemList.replaceChildren();
    for(const item of items){
      const li=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.dataset.severity=item.severity;
      button.title=diagnosticTooltip(item);
      button.textContent=`${item.severity==='error'?'오류':item.severity==='warning'?'경고':'참고'} · ${item.line}줄: ${item.message}`;
      button.addEventListener('click',()=>{
        const position={lineNumber:item.line,column:item.column};
        codeEditor.setPosition(position);codeEditor.revealPositionInCenter(position);codeEditor.focus();
      });
      li.append(button);problemList.append(li);
    }
    renderMarkers();
  },
  status:(state,value)=>{
    analysisStatus.dataset.state=state;
    const labels={waiting:'검사 대기…',checking:'코드 검사 중…',idle:'코드를 입력해 주세요.',failed:value};
    analysisStatus.textContent=state==='done'?(value.length?`오류 ${value.filter(i=>i.severity==='error').length} · 경고 ${value.filter(i=>i.severity==='warning').length}`:'문제 없음'):labels[state];
  }
});
function renderMarkers(){
  const runItems=runSourceVersion===codeEditor.getModel().getVersionId()?parseCompilerDiagnostics(diagnostics).map(localizeDiagnostic):[];
  const unique=new Map([...liveDiagnostics,...runItems].map(item=>[`${item.line}:${item.column}:${item.severity}:${item.message}`,item]));
  setCompilerDiagnostics(codeEditor,[...unique.values()]);
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({ code: codeEditor.getValue(), stdin: elements.stdin.value })); } catch { /* Private browsing or a full store must not prevent editing. */ }
}
function updateEditor() {
  const position = codeEditor.getPosition();
  const selections = codeEditor.getSelections();
  elements["cursor-position"].textContent = `줄 ${position.lineNumber}, 열 ${position.column}${selections.length > 1 ? ` · 커서 ${selections.length}개` : ""}`;
}
codeEditor.onDidChangeModelContent(() => { runSourceVersion=null;liveChecks.update(codeEditor.getValue());save();updateEditor(); });
codeEditor.onDidChangeCursorSelection(updateEditor);
elements.stdin.addEventListener("input", save);
elements["find-code"].addEventListener("click", () => { codeEditor.focus(); codeEditor.getAction("actions.find").run(); });
elements["expand-editor"].addEventListener("click", () => {
  const expanded = document.querySelector(".workspace").classList.toggle("editor-expanded");
  elements["expand-editor"].setAttribute("aria-pressed", String(expanded));
  elements["expand-editor"].textContent = expanded ? "원래 크기" : "편집기 확대";
  codeEditor.focus();
});
elements.example.addEventListener("change", () => {
  const template = templates[elements.example.value];
  if (!template) return;
  if (codeEditor.getValue() !== templates.template && codeEditor.getValue() !== template && !confirm("현재 코드를 예제 코드로 바꾸시겠습니까?")) {
    elements.example.value = ""; return;
  }
  codeEditor.pushUndoStop();
  codeEditor.executeEdits("example", [{ range: codeEditor.getModel().getFullModelRange(), text: template }]);
  codeEditor.pushUndoStop();
  if (elements.example.value === "sum") elements.stdin.value = "10 20\n";
  save(); updateEditor(); elements.example.value = "";
  codeEditor.setPosition({ lineNumber: 1, column: 1 }); codeEditor.focus();
});

function setStatus(message, kind = "ready") {
  elements.status.dataset.kind = kind;
  elements.status.replaceChildren();
  const dot = document.createElement("span"); dot.className = "status-dot";
  elements.status.append(dot, document.createTextNode(message));
}
function renderOutput() {
  outputScheduled = false;
  elements.output.textContent = stdout;
  if (!stdout) {
    const placeholder = document.createElement("span"); placeholder.className = "placeholder";
    placeholder.textContent = outputPlaceholder;
    elements.output.append(placeholder);
  }
  const localized=localizeCompilerOutput(diagnostics);
  elements.diagnostics.textContent = localized;
  document.getElementById('diagnostics-original').hidden=localized===diagnostics;
  document.getElementById('diagnostics-original-text').textContent=diagnostics;
  elements["diagnostics-section"].hidden = !diagnostics;
  const match = diagnostics.match(/\/?main\.c:(\d+):(\d+):/);
  errorLocation = match ? { line: Number(match[1]), column: Number(match[2]) } : null;
  elements["go-to-error"].hidden = !errorLocation;
  renderMarkers();
}
function scheduleOutput() {
  if (!outputScheduled) { outputScheduled = true; requestAnimationFrame(renderOutput); }
}
function stopWorker() {
  worker?.terminate(); worker = null;
}
function finish(message, kind = "ready", exitCode) {
  clearTimeout(deadline);
  const run = activeRun; activeRun = null;
  elements.run.disabled = false; elements.stop.disabled = true;
  elements.example.disabled = false;
  codeEditor.updateOptions({ readOnly: false }); elements.stdin.readOnly = false;
  elements["exit-code"].textContent = exitCode === undefined ? "" : `종료 코드 ${exitCode}`;
  if (run) elements.timing.textContent = `준비 ${((run.executionStarted ?? performance.now()) - run.started).toFixed(0)} ms${run.executionStarted ? ` · 실행 ${(performance.now() - run.executionStarted).toFixed(0)} ms` : ""}`;
  outputPlaceholder = exitCode === 0 ? "정상 종료했습니다. 출력 내용이 없습니다." : "출력 내용이 없습니다.";
  renderOutput();
  setStatus(message, kind);
}
function setDeadline(ms, message) {
  clearTimeout(deadline);
  deadline = setTimeout(() => {
    if (!activeRun) return;
    stopWorker(); diagnostics += (diagnostics ? "\n" : "") + message;
    finish("시간 제한으로 중지됨", "error");
  }, ms);
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./runner.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (!activeRun || data.id !== activeRun.id) return;
    if (data.type === "stage") {
      const labels = { loading: "실행 환경 준비 중…", compile: "컴파일 중…", link: "실행 파일 준비 중…", execute: "실행 중…" };
      setStatus(labels[data.stage], "busy");
      if (data.stage === "execute") {
        activeRun.executionStarted = performance.now();
        setDeadline(5000, "실행이 5초를 초과했습니다. 반복 조건을 확인해주세요.");
      }
    } else if (data.type === "output") {
      if (data.channel === "stdout") stdout += data.text; else diagnostics += data.text;
      scheduleOutput();
    } else if (data.type === "done") {
      finish(data.exitCode === 0 ? "실행 완료" : "프로그램이 오류 코드로 종료됨", data.exitCode === 0 ? "ready" : "error", data.exitCode);
    } else if (data.type === "failed") {
      if (data.message) diagnostics += (diagnostics ? "\n" : "") + data.message;
      finish(data.stage === "execute" ? "실행 오류" : data.stage === "loading" ? "실행 환경 준비 실패" : "컴파일 실패", "error");
    }
  };
  worker.onerror = event => {
    if (!activeRun) return;
    diagnostics += `실행 환경 오류: ${event.message || "실행 작업을 시작할 수 없습니다."}`;
    stopWorker(); finish("실행 오류", "error");
  };
  return worker;
}
function run() {
  if (activeRun) return;
  if (!codeEditor.getValue().trim()) { setStatus("C 코드를 입력해주세요.", "error"); codeEditor.focus(); return; }
  runSourceVersion=codeEditor.getModel().getVersionId();
  save(); stdout = ""; diagnostics = ""; outputPlaceholder = "실행 결과를 기다리고 있습니다…"; renderOutput();
  elements["exit-code"].textContent = "";
  activeRun = { id: ++requestId, started: performance.now() };
  elements.run.disabled = true; elements.stop.disabled = false; elements.example.disabled = true;
  codeEditor.updateOptions({ readOnly: true }); elements.stdin.readOnly = true;
  elements.timing.textContent = "준비 중… · 실행 제한 5초";
  setStatus("실행 환경 준비 중…", "busy");
  setDeadline(60000, "실행 환경 준비 또는 컴파일이 60초를 초과했습니다. 다시 실행해주세요.");
  try { ensureWorker().postMessage({ id: activeRun.id, code: codeEditor.getValue(), stdin: elements.stdin.value }); }
  catch (error) { diagnostics = error.message; stopWorker(); finish("실행 환경 준비 실패", "error"); }
}
elements.run.addEventListener("click", run);
elements.stop.addEventListener("click", () => { if (activeRun) { stopWorker(); finish("사용자가 중지함"); } });
document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); } });
elements["go-to-error"].addEventListener("click", () => {
  if (!errorLocation) return;
  const model = codeEditor.getModel();
  const lineNumber = Math.min(errorLocation.line, model.getLineCount());
  const column = Math.min(errorLocation.column, model.getLineMaxColumn(lineNumber));
  codeEditor.setPosition({ lineNumber, column });
  codeEditor.revealPositionInCenter({ lineNumber, column });
  codeEditor.focus(); updateEditor();
});
updateEditor();
liveChecks.update(codeEditor.getValue());
codeEditor.onDidDispose(()=>liveChecks.dispose());
