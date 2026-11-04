import { WASI } from "@runno/wasi";
import { gunzipSync } from "fflate";

const decoder = new TextDecoder();
let compilerPromise;
let linkerPromise;

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
export function getCompiler() {
  if (!compilerPromise) {
    compilerPromise = Promise.all([
      fetchBytes("clang.wasm.gz").then(bytes => WebAssembly.compile(decompress(bytes))),
      fetchBytes("clang-fs.tar.gz").then(unpackFileSystem),
    ]).catch(error => { compilerPromise = null; throw error; });
  }
  return compilerPromise;
}
export async function getToolchain() {
  linkerPromise??=fetchBytes("wasm-ld.wasm.gz").then(bytes=>WebAssembly.compile(decompress(bytes))).catch(error=>{linkerPromise=null;throw error;});
  const [[clang,fs],linker]=await Promise.all([getCompiler(),linkerPromise]);
  return [clang,linker,fs];
}
export async function execute(module, options, inputBytes) {
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
