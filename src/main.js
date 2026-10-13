import "./styles.css";

const templates = {
  template: '#include <stdio.h>\n\nint main() {\n    return 0;\n}\n',
  hello: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n',
  sum: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    if (scanf("%d %d", &a, &b) != 2) {\n        fprintf(stderr, "두 정수를 입력해주세요.\\n");\n        return 1;\n    }\n    printf("%d\\n", a + b);\n    return 0;\n}\n',
};
const elements = Object.fromEntries(["code", "stdin", "run", "stop", "output", "diagnostics", "status", "timing", "example", "exit-code", "line-numbers", "cursor-position", "diagnostics-section", "go-to-error"].map(id => [id, document.getElementById(id)]));
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

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  elements.code.value = saved?.code ?? templates.template;
  elements.stdin.value = saved?.stdin ?? "";
} catch {
  elements.code.value = templates.template;
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({ code: elements.code.value, stdin: elements.stdin.value })); } catch { /* Private browsing or a full store must not prevent editing. */ }
}
function updateEditor() {
  const lines = elements.code.value.split("\n");
  elements["line-numbers"].textContent = lines.map((_, index) => index + 1).join("\n");
  const preceding = elements.code.value.slice(0, elements.code.selectionStart).split("\n");
  elements["cursor-position"].textContent = `줄 ${preceding.length}, 열 ${preceding.at(-1).length + 1}`;
}
elements.code.addEventListener("input", () => { save(); updateEditor(); });
elements.stdin.addEventListener("input", save);
elements.code.addEventListener("scroll", () => { elements["line-numbers"].scrollTop = elements.code.scrollTop; });
for (const event of ["click", "keyup", "select"]) elements.code.addEventListener(event, updateEditor);
elements.code.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault();
    elements.code.setRangeText("    ", elements.code.selectionStart, elements.code.selectionEnd, "end");
    save(); updateEditor();
  }
});
elements.example.addEventListener("change", () => {
  const template = templates[elements.example.value];
  if (!template) return;
  if (elements.code.value !== templates.template && elements.code.value !== template && !confirm("현재 코드를 예제 코드로 바꾸시겠습니까?")) {
    elements.example.value = ""; return;
  }
  elements.code.value = template;
  if (elements.example.value === "sum") elements.stdin.value = "10 20\n";
  save(); updateEditor(); elements.example.value = "";
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
  elements.diagnostics.textContent = diagnostics;
  elements["diagnostics-section"].hidden = !diagnostics;
  const match = diagnostics.match(/\/?main\.c:(\d+):(\d+):/);
  errorLocation = match ? { line: Number(match[1]), column: Number(match[2]) } : null;
  elements["go-to-error"].hidden = !errorLocation;
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
  elements.code.readOnly = false; elements.stdin.readOnly = false;
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
  if (!elements.code.value.trim()) { setStatus("C 코드를 입력해주세요.", "error"); elements.code.focus(); return; }
  save(); stdout = ""; diagnostics = ""; outputPlaceholder = "실행 결과를 기다리고 있습니다…"; renderOutput();
  elements["exit-code"].textContent = "";
  activeRun = { id: ++requestId, started: performance.now() };
  elements.run.disabled = true; elements.stop.disabled = false; elements.example.disabled = true;
  elements.code.readOnly = true; elements.stdin.readOnly = true;
  elements.timing.textContent = "준비 중… · 실행 제한 5초";
  setStatus("실행 환경 준비 중…", "busy");
  setDeadline(60000, "실행 환경 준비 또는 컴파일이 60초를 초과했습니다. 다시 실행해주세요.");
  try { ensureWorker().postMessage({ id: activeRun.id, code: elements.code.value, stdin: elements.stdin.value }); }
  catch (error) { diagnostics = error.message; stopWorker(); finish("실행 환경 준비 실패", "error"); }
}
elements.run.addEventListener("click", run);
elements.stop.addEventListener("click", () => { if (activeRun) { stopWorker(); finish("사용자가 중지함"); } });
document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); } });
elements["go-to-error"].addEventListener("click", () => {
  if (!errorLocation) return;
  const lines = elements.code.value.split("\n");
  const position = lines.slice(0, errorLocation.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + errorLocation.column - 1;
  elements.code.focus(); elements.code.setSelectionRange(position, position + 1);
  elements.code.scrollTop = Math.max(0, (errorLocation.line - 4) * parseFloat(getComputedStyle(elements.code).lineHeight));
  elements["line-numbers"].scrollTop = elements.code.scrollTop; updateEditor();
});
updateEditor();
