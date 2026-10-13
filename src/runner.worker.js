import { WASI } from "@runno/wasi";
import { gunzipSync } from "fflate";

const OUTPUT_LIMIT = 128 * 1024;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let toolchainPromise;

// Some static servers decode .gz responses using Content-Encoding themselves.
function decompress(bytes) {
  return bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
}

function unpackFileSystem(compressed) {
  const tar = decompress(compressed);
  const files = {};
  const text = (start, length) => decoder.decode(tar.subarray(start, start + length)).split("\0")[0];
  let longName;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = text(offset, 100);
    if (!name) break;
    const prefix = text(offset + 345, 155);
    const size = parseInt(text(offset + 124, 12).trim(), 8) || 0;
    const type = text(offset + 156, 1);
    const content = tar.slice(offset + 512, offset + 512 + size);
    if (type === "L") longName = decoder.decode(content).split("\0")[0];
    else if (type === "0" || type === "") {
      const path = "/" + (longName || (prefix ? `${prefix}/${name}` : name)).replace(/^\.\//, "").replace(/^\/+/, "");
      const time = new Date(0);
      files[path] = { path, mode: "binary", content, timestamps: { access: time, modification: time, change: time } };
      longName = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
async function fetchBytes(name) {
  const directory = new URL("../toolchain/", self.location.href);
  const response = await fetch(new URL(name, directory));
  if (!response.ok) throw new Error(`실행 환경 파일을 불러오지 못했습니다 (${name}, ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
function getToolchain() {
  if (!toolchainPromise) {
    toolchainPromise = Promise.all([
      fetchBytes("clang.wasm.gz").then(bytes => WebAssembly.compile(decompress(bytes))),
      fetchBytes("wasm-ld.wasm.gz").then(bytes => WebAssembly.compile(decompress(bytes))),
      fetchBytes("clang-fs.tar.gz").then(unpackFileSystem),
    ]).catch(error => { toolchainPromise = null; throw error; });
  }
  return toolchainPromise;
}
async function execute(module, options, inputBytes) {
  const wasi = new WASI(options);
  const imports = wasi.getImportObject();
  if (inputBytes) {
    let inputOffset = 0;
    for (const namespace of Object.values(imports)) {
      const read = namespace.fd_read;
      namespace.fd_read = (fd, iovs, count, resultPointer) => {
        if (fd !== 0) return read(fd, iovs, count, resultPointer);
        const view = new DataView(wasi.memory.buffer);
        let total = 0;
        for (let i = 0; i < count; i++) {
          const pointer = view.getUint32(iovs + i * 8, true);
          const capacity = view.getUint32(iovs + i * 8 + 4, true);
          const amount = Math.min(capacity, inputBytes.length - inputOffset);
          new Uint8Array(wasi.memory.buffer, pointer, amount).set(inputBytes.subarray(inputOffset, inputOffset + amount));
          inputOffset += amount; total += amount;
        }
        view.setUint32(resultPointer, total, true);
        return 0;
      };
    }
  }
  const instance = await WebAssembly.instantiate(module, imports);
  return wasi.start({ module, instance });
}

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
