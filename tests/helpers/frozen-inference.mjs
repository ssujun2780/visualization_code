import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const folder=new URL('../fixtures/inference-records/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',folder),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
// Recorded compiler output is a frozen inference input, never a replacement
// for a fresh generator test. Predictions come from the original source audit.
export async function frozenInferenceExecution(name){
  const entry=manifest[name];assert.ok(entry,`missing frozen input ${name}`);
  const [source,compressed]=await Promise.all([readFile(new URL(`${name}.c`,folder)),readFile(new URL(`${name}.json.gz`,folder))]);
  assert.equal(hash(source),entry.expected.sourceHash,`${name}: source changed`);
  const raw=gunzipSync(compressed);assert.equal(hash(raw),entry.executionSha256,`${name}: execution changed`);
  const execution=JSON.parse(raw);assert.equal(execution.stdout,entry.expected.stdout,`${name}: source prediction`);
  assert.equal(execution.trace.status,'completed');return execution;
}
