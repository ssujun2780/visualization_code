import {getToolchain, execute} from "./browser-toolchain.js";
const OUTPUT_LIMIT = 128 * 1024;
const encoder = new TextEncoder();

self.onmessage = async ({ data: { id, code, stdin } }) => {
  let stage = "loading";
  let outputBytes = 0;
  const pending = { stdout: "", stderr: "" };
  const flush = () => {
    for (const channel of ["stdout", "stderr"]) {
      if (pending[channel]) self.postMessage({ id, type: "output", channel, text: pending[channel] });
      pending[channel] = "";
    }
  };
  const emit = channel => text => {
    outputBytes += encoder.encode(text).byteLength;
    if (outputBytes > OUTPUT_LIMIT) throw new Error("출력이 128KB를 초과하여 중지했습니다.");
    pending[channel] += text;
    if (pending[channel].length >= 4096) flush();
  };
  const setStage = value => { flush(); stage = value; self.postMessage({ id, type: "stage", stage }); };
  try {
    setStage("loading");
    const [clang, linker, baseFS] = await getToolchain();
    let fs = structuredClone(baseFS);
    const now = new Date();
    fs["/main.c"] = { path: "/main.c", mode: "string", content: code, timestamps: { access: now, modification: now, change: now } };
    setStage("compile");
    const compiled = await execute(clang, {
      args: ["clang", "-cc1", "-triple", "wasm32-unknown-wasi", "-isysroot", "/sys", "-internal-isystem", "/sys/include", "-internal-isystem", "/sys/lib/clang/8.0.1/include", "-std=c11", "-Wall", "-Wextra", "-O0", "-ferror-limit", "10", "-emit-obj", "-o", "/main.o", "/main.c"],
      fs, stdout: emit("stderr"), stderr: emit("stderr"),
    });
    fs = compiled.fs;
    if (compiled.exitCode !== 0) {
      flush(); self.postMessage({ id, type: "failed", stage }); return;
    }
    setStage("link");
    const linked = await execute(linker, {
      args: ["wasm-ld", "--no-threads", "--export-dynamic", "-z", "stack-size=1048576", "--max-memory=134217728", "-L/sys/lib/wasm32-wasi", "/sys/lib/wasm32-wasi/crt1.o", "/main.o", "-lc", "-o", "/main.wasm"],
      fs, stdout: emit("stderr"), stderr: emit("stderr"),
    });
    fs = linked.fs;
    if (linked.exitCode !== 0) {
      flush(); self.postMessage({ id, type: "failed", stage }); return;
    }
    const binary = fs["/main.wasm"];
    if (!binary || binary.mode !== "binary") throw new Error("실행 파일을 만들지 못했습니다.");
    const program = await WebAssembly.compile(binary.content);
    setStage("execute");
    fs = { "/main.c": fs["/main.c"] };
    const input = stdin ? stdin.endsWith("\n") ? stdin : stdin + "\n" : "";
    const result = await execute(program, {
      args: ["main"], fs, stdout: emit("stdout"), stderr: emit("stderr"),
    }, encoder.encode(input));
    if (result.exitCode === 134) emit("stderr")("\n프로그램 실행이 중단되었습니다. 메모리 접근이나 연산을 확인해주세요.\n");
    flush(); self.postMessage({ id, type: "done", exitCode: result.exitCode });
  } catch (error) {
    flush(); self.postMessage({ id, type: "failed", stage, message: error instanceof Error ? error.message : String(error) });
  }
};
