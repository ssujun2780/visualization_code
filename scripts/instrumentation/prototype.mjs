import { randomUUID } from "node:crypto";
import { analyze, compileAndRun } from "./toolchain.mjs";
import { instrument } from "./instrument.mjs";
import { validateSource } from "./ast.mjs";

const typed = value => ({ typeId: "c.int32", decimal: String(value), bits: (value >>> 0).toString(16).padStart(8, "0"), evidence: "observed" });

class Recorder {
  constructor(plan) {
    this.plan = plan;
    this.events = [];
    this.objects = new Map();
    this.diagnostics = [];
    this.runId = randomUUID();
    this.objects.set("main#1:return", { id: "main#1:return", name: "$return", storage: "virtual", initialized: false, lifecycle: "alive" });
  }
  emit = (index, phase, value, address, left, right) => {
    if (this.events.length >= 4096) throw new Error("시제품 실행 기록 제한(4096개)을 초과했습니다.");
    const op = this.plan.instructions[index - 1];
    if (!op) throw new Error(`알 수 없는 계측 명령: ${index}`);
    const number = this.events.length + 1;
    const event = { schemaVersion: 1, runId: this.runId, eventId: `e${number}`, instructionId: op.id,
      activationId: this.plan.frameId, kind: op.kind, phase: phase === 0 ? "attempt" : phase === 1 ? "commit" : "fault",
      source: op.source, sceneInstanceId: op.sceneId, evidence: "observed",
      dataInputs: [left, right].filter(Boolean).map(n => `e${n}`) };
    if (op.action) event.action = op.action;
    const definition = this.plan.objects.find(o => o.id === op.objectId);
    if (op.action === "object.begin") {
      if (this.objects.has(op.objectId)) throw new Error("중복 객체 생성 사건입니다.");
      this.objects.set(op.objectId, { ...definition, address: address >>> 0, initialized: false,
        lifecycle: "alive", createdBy: event.eventId });
    }
    const object = this.objects.get(op.objectId);
    if (op.objectId) {
      if (!object) throw new Error(`등록되지 않은 관찰 객체: ${op.objectId}`);
      if (object.storage !== "virtual" && object.address !== (address >>> 0)) throw new Error("계측 주소와 등록 객체의 주소가 다릅니다.");
      event.target = { objectId: object.id, address: object.storage === "virtual" ? null : `0x${object.address.toString(16).padStart(8, "0")}`, byteOffset: 0, size: 4 };
    }
    if (op.kind === "READ" && phase === 0 && (!object.initialized || object.lifecycle !== "alive")) {
      event.phase = "fault";
      event.diagnostic = { code: object.lifecycle === "alive" ? "uninitialized-read" : "expired-object", message: `${object.name}: 유효하게 초기화된 값을 읽을 수 없습니다.` };
    } else if (phase >= 2) {
      event.diagnostic = { code: phase === 2 ? "division-by-zero" : "signed-overflow",
        message: phase === 2 ? "정수 나눗셈·나머지의 제수가 0입니다." : "계산 결과를 32비트 signed int로 표현할 수 없습니다." };
    } else if (phase === 1 && ["READ", "WRITE", "CALC"].includes(op.kind)) {
      event.value = typed(value);
      if (op.kind === "READ") {
        if (!object.initialized || object.lifecycle !== "alive") throw new Error("검사 없이 읽기가 완료됐습니다.");
        event.previousWrite = object.lastWrite;
        event.dataInputs = [object.lastWrite];
      } else if (op.kind === "WRITE") {
        event.before = object.initialized ? object.value : { initialization: "uninitialized" };
        object.initialized = true;
        object.value = event.value;
        object.lastWrite = event.eventId;
      }
      event.operands = (op.operands || []).map((input, i) => {
        const ref = [left, right][i];
        return ref ? { eventId: `e${ref}`, value: this.events[ref - 1].value }
          : { value: { typeId: "c.int32", decimal: input.constant, evidence: "compiler" } };
      });
    }
    if (op.action === "object.end") object.lifecycle = "ended";
    this.events.push(event);
    if (event.diagnostic) {
      this.diagnostics.push({ ...event.diagnostic, eventId: event.eventId, instructionId: op.id, source: op.source });
      return -number;
    }
    return number;
  };
  finish(exitCode) {
    return { schemaVersion: 1, programId: this.plan.programId, runId: this.runId,
      backend: this.plan.backend, status: this.diagnostics.length ? "fault" : "completed", exitCode,
      events: this.events, objects: [...this.objects.values()], diagnostics: this.diagnostics };
  }
}

export async function traceC(source, { filename = "main.c" } = {}) {
  validateSource(source);
  const analysis = await analyze(source);
  const { plan, instrumentedSource } = instrument(source, analysis.ast, filename);
  const recorder = new Recorder(plan);
  let execution;
  try {
    execution = await compileAndRun(instrumentedSource, recorder.emit);
  } catch (error) {
    if (!recorder.diagnostics.length || !(error instanceof WebAssembly.RuntimeError)) throw error;
    execution = { exitCode: null, stdout: "", stderr: "", compilerDiagnostics: "" };
  }
  if (!recorder.diagnostics.length && !recorder.events.some(e => e.kind === "FLOW" && e.action === "return")) {
    throw new Error(`C 실행이 반환 기록 전에 종료됐습니다 (exit ${execution.exitCode}).`);
  }
  return { plan, trace: recorder.finish(execution.exitCode), instrumentedSource, ast: analysis.ast,
    stdout: execution.stdout, stderr: execution.stderr,
    compilerDiagnostics: analysis.diagnostics + execution.compilerDiagnostics };
}
