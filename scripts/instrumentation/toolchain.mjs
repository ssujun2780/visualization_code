import { readFile } from "node:fs/promises";
import { WASI } from "@runno/wasi";
import { gunzipSync } from "fflate";

const root = new URL("../../public/toolchain/", import.meta.url);
let cached;

function unpack(bytes) {
  const tar = gunzipSync(bytes);
  const text = (start, size) => new TextDecoder().decode(tar.subarray(start, start + size)).split("\0")[0];
  const fs = {};
  let longName;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = text(offset, 100);
    if (!name) break;
    const size = parseInt(text(offset + 124, 12).trim(), 8) || 0;
    const type = text(offset + 156, 1);
    if (type === "L") longName = text(offset + 512, size);
    else if (type === "0" || type === "") {
      const prefix = text(offset + 345, 155);
      const path = "/" + (longName || (prefix ? `${prefix}/${name}` : name)).replace(/^\.\//, "").replace(/^\/+/, "");
      fs[path] = file(path, tar.slice(offset + 512, offset + 512 + size));
      longName = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return fs;
}

export function file(path, content) {
  const epoch = new Date(0);
  return { path, mode: typeof content === "string" ? "string" : "binary", content,
    timestamps: { access: epoch, modification: epoch, change: epoch } };
}

export function getToolchain() {
  cached ??= Promise.all([
    readFile(new URL("clang.wasm.gz", root)).then(b => WebAssembly.compile(gunzipSync(b))),
    readFile(new URL("wasm-ld.wasm.gz", root)).then(b => WebAssembly.compile(gunzipSync(b))),
    readFile(new URL("clang-fs.tar.gz", root)).then(unpack),
  ]).then(([clang, linker, fs]) => ({ clang, linker, fs })).catch(error => { cached = undefined; throw error; });
  return cached;
}

export async function execute(module, args, fs, traceImport, stdin = "") {
  let stdout = "", stderr = "";
  const append = channel => value => {
    if (stdout.length + stderr.length + value.length > 2 * 1024 * 1024) throw new Error("도구 출력 제한을 초과했습니다.");
    if (channel === "stdout") stdout += value; else stderr += value;
    traceImport?.output?.(channel,value);
  };
  const wasi = new WASI({ args, fs, stdout: append("stdout"), stderr: append("stderr") });
  const imports = wasi.getImportObject();
  const input = new TextEncoder().encode(stdin);
  let inputOffset = 0;
  for (const namespace of Object.values(imports)) {
    if (!namespace.fd_read) continue;
    const originalRead = namespace.fd_read;
    namespace.fd_read = (fd, iovs, count, resultPointer) => {
      if (fd !== 0) return originalRead(fd, iovs, count, resultPointer);
      const view = new DataView(wasi.memory.buffer);
      let total = 0;const startOffset=inputOffset;
      for (let i = 0; i < count; i++) {
        const pointer = view.getUint32(iovs + i * 8, true);
        const capacity = view.getUint32(iovs + i * 8 + 4, true);
        const amount = Math.min(capacity, input.length - inputOffset);
        new Uint8Array(wasi.memory.buffer, pointer, amount).set(input.subarray(inputOffset, inputOffset + amount));
        inputOffset += amount;
        total += amount;
      }
      view.setUint32(resultPointer, total, true);
      if(total)traceImport?.input?.(input.subarray(startOffset,inputOffset),startOffset);
      return 0;
    };
  }
  if (traceImport) imports.cvtrace = typeof traceImport === "function" ? { emit: traceImport } : { emit: traceImport.emit };
  const instance = await WebAssembly.instantiate(module, imports);
  traceImport?.setMemory?.(instance.exports.memory ?? wasi.memory);
  let result;
  try { result = wasi.start({ module, instance }); }
  catch (error) {
    if (!traceImport?.captureErrors) throw error;
    return { exitCode: null, stdout, stderr, runtimeError: error };
  }
  return { ...result, stdout, stderr };
}

export async function emitLLVM(source) {
  const tools = await getToolchain();
  const result = await execute(tools.clang, ["clang", ...flags, "-emit-llvm", "-debug-info-kind=standalone",
    "-dwarf-version=4", "-dwarf-column-info", "-o", "/main.ll", "/main.c"],
    { ...tools.fs, "/main.c": file("/main.c", source) });
  if (result.exitCode !== 0) throw new Error(`C 분석 실패:\n${result.stderr}`);
  const entry = result.fs["/main.ll"];
  const syntax = await analyze(source);
  return { llvm: typeof entry.content === "string" ? entry.content : new TextDecoder().decode(entry.content), ast: syntax.ast, diagnostics: result.stderr };
}

export async function runLLVM(llvm, observer, { stdin = "" } = {}) {
  const tools = await getToolchain();
  const compiled = await execute(tools.clang, ["clang", "-cc1", "-triple", "wasm32-unknown-wasi",
    "-x", "ir", "-emit-obj", "-o", "/main.o", "/main.ll"],
    { ...tools.fs, "/main.ll": file("/main.ll", llvm) });
  if (compiled.exitCode !== 0) throw new Error(`계측 LLVM 컴파일 실패:\n${compiled.stderr}`);
  const linked = await execute(tools.linker, ["wasm-ld", "--no-threads", "--export-dynamic", "--allow-undefined",
    "-z", "stack-size=1048576", "--max-memory=134217728", "-L/sys/lib/wasm32-wasi",
    "/sys/lib/wasm32-wasi/crt1.o", "/main.o", "-lc", "-o", "/main.wasm"], compiled.fs);
  if (linked.exitCode !== 0) throw new Error(`C 링크 실패:\n${linked.stderr}`);
  const module = await WebAssembly.compile(linked.fs["/main.wasm"].content);
  return { ...await execute(module, ["main"], {}, observer, stdin), compilerDiagnostics: compiled.stderr + linked.stderr };
}

const flags = ["-cc1", "-triple", "wasm32-unknown-wasi", "-isysroot", "/sys",
  "-internal-isystem", "/sys/include", "-internal-isystem", "/sys/lib/clang/8.0.1/include",
  "-std=c11", "-Wall", "-Wextra", "-O0", "-ferror-limit", "10"];

export async function analyze(source) {
  const tools = await getToolchain();
  const result = await execute(tools.clang, ["clang", ...flags, "-ast-dump", "/main.c"],
    { ...tools.fs, "/main.c": file("/main.c", source) });
  if (result.exitCode !== 0) throw new Error(`C 분석 실패:\n${result.stderr}`);
  return { ast: result.stdout, diagnostics: result.stderr };
}

export async function compileAndRun(source, traceImport, { stdin = "" } = {}) {
  const tools = await getToolchain();
  const compiled = await execute(tools.clang,
    ["clang", ...flags, "-emit-obj", "-o", "/main.o", "/main.c"],
    { ...tools.fs, "/main.c": file("/main.c", source) });
  if (compiled.exitCode !== 0) throw new Error(`C 컴파일 실패:\n${compiled.stderr}`);
  const linked = await execute(tools.linker, ["wasm-ld", "--no-threads", "--export-dynamic", ...(traceImport ? ["--allow-undefined"] : []),
    "-z", "stack-size=1048576", "--max-memory=134217728", "-L/sys/lib/wasm32-wasi",
    "/sys/lib/wasm32-wasi/crt1.o", "/main.o", "-lc", "-o", "/main.wasm"], compiled.fs);
  if (linked.exitCode !== 0) throw new Error(`C 링크 실패:\n${linked.stderr}`);
  const binary = linked.fs["/main.wasm"];
  if (binary?.mode !== "binary") throw new Error("WebAssembly 실행 파일이 없습니다.");
  const module = await WebAssembly.compile(binary.content);
  const execution = await execute(module, ["main"], {}, traceImport, stdin);
  return { ...execution, compilerDiagnostics: compiled.stderr + linked.stderr };
}
