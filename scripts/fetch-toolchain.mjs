import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "fflate";

const directory = new URL("../public/toolchain/", import.meta.url);
const expectedHashes = {
  "clang.wasm": "2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d",
  "wasm-ld.wasm": "36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48",
  "clang-fs.tar.gz": "7ed12063619882e4dfa710ab371fc91848b256f85a4075747e8bd5c167902b50",
};
await mkdir(directory, { recursive: true });
for (const name of ["clang.wasm", "wasm-ld.wasm", "clang-fs.tar.gz"]) {
  const response = await fetch(`https://runno.dev/langs/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHashes[name]) throw new Error(`${name}: upstream toolchain changed; verify before updating the pinned hash`);
  if (name.endsWith(".wasm") && !WebAssembly.validate(bytes)) {
    throw new Error(`${name}: invalid WebAssembly binary`);
  }
  if (name.endsWith(".gz") && (bytes[0] !== 31 || bytes[1] !== 139)) {
    throw new Error(`${name}: invalid gzip archive`);
  }
  const outputName = name.endsWith(".wasm") ? name + ".gz" : name;
  await writeFile(new URL(outputName, directory), name.endsWith(".wasm") ? gzipSync(bytes, { level: 9 }) : bytes);
  console.log(`${name}: ${bytes.length} bytes, sha256 ${hash}`);
}
const licenses = {
  "LICENSE-LLVM.txt": "https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-8.0.1/llvm/LICENSE.TXT",
  "LICENSE-WASI-LIBC.txt": "https://raw.githubusercontent.com/WebAssembly/wasi-libc/main/LICENSE",
  "LICENSE-Runno.txt": "https://raw.githubusercontent.com/taybenlor/runno/main/LICENSE",
  "LICENSE-fflate.txt": "https://raw.githubusercontent.com/101arrowz/fflate/master/LICENSE",
};
for (const [name, url] of Object.entries(licenses)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  await writeFile(new URL(name, directory), await response.text());
}
