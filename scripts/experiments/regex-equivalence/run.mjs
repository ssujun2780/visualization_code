import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { instrumentRegex } from "./instrument.mjs";
import { decodeTrace } from "./observe.mjs";
import { proposeViews } from "./structure.mjs";

const root=new URL("../../../",import.meta.url);
const output=new URL("test-results/regex-equivalence-trace/",root);
const file=name=>fileURLToPath(new URL(name,output));
const source=await readFile(new URL("examples/c/regex_equivalence.c",root));
const predictionsText=await readFile(new URL("examples/c/regex-equivalence-predictions.json",root),"utf8");
const predictions=JSON.parse(predictionsText);
const hash=createHash("sha256").update(source).digest("hex");
assert.equal(hash,predictions.sourceSha256,"The observation manifest targets a fixed, unmodified source snapshot");
await mkdir(output,{recursive:true});
await writeFile(file("prediction.json"),predictionsText);
const generated=instrumentRegex(source);
await writeFile(file("original.c"),source);
await writeFile(file("instrumented.c"),generated.source);
await writeFile(file("plan.json"),JSON.stringify(generated.plan,null,2)+"\n");
const execute=promisify(execFile);
const gcc=process.env.CC||"C:\\msys64\\mingw64\\bin\\gcc.exe";
const flags=["-std=c11","-O0","-Wall","-Wextra","-Wpedantic","-Wconversion","-Wshadow","-Wstrict-prototypes","-Werror"];
const baselineBuild=await execute(gcc,[...flags,"original.c","-o","original.exe"],{cwd:fileURLToPath(output),timeout:30000});
const observedBuild=await execute(gcc,[...flags,"-finstrument-functions","-finstrument-functions-exclude-file-list=/include/,\\include\\",
  "instrumented.c","-o","instrumented.exe"],{cwd:fileURLToPath(output),timeout:30000});
await writeFile(file("compiler-diagnostics.txt"),baselineBuild.stderr+observedBuild.stderr);
function run(name,stdin) {
  return new Promise((resolve,reject)=>{
    const child=execFile(file(name),["--stats"],{timeout:15000,maxBuffer:64*1024*1024},(error,stdout,stderr)=>{
      if(error&&typeof error.code!=="number") reject(error);
      else resolve({exitCode:error?.code??0,stdout:stdout.replace(/\r\n/g,"\n"),stderr:stderr.replace(/\r\n/g,"\n")});
    });child.stdin.on("error",reject);child.stdin.end(stdin);
  });
}
const reports=[],artifacts=new Map();
for(const expected of predictions.cases) {
  const baseline=await run("original.exe",expected.stdin);
  const observed=await run("instrumented.exe",expected.stdin);
  const lines=observed.stderr.split("\n"),raw=lines.filter(l=>l.startsWith("@CV ")).map(l=>JSON.parse(l.slice(4)));
  const publicStderr=lines.filter(l=>!l.startsWith("@CV ")).join("\n");
  assert.equal(observed.exitCode,baseline.exitCode,`${expected.id}: exit changed`);
  assert.equal(observed.stdout,baseline.stdout,`${expected.id}: program output changed`);
  const stable=s=>s.split("\n").filter(l=>!l.startsWith("CPU seconds:")).join("\n");
  assert.equal(stable(publicStderr),stable(baseline.stderr),`${expected.id}: native statistics changed`);
  assert.equal(observed.exitCode,expected.exitCode);
  assert.equal(observed.stdout,expected.stdout);
  const trace=decodeTrace(raw,generated.plan);
  const comparisons=[];
  for(const key of ["recordNodes","recordEdges","automatonNodes","automatonEdges","indirectSlotWrites","indirectCalls","cachedStateCounts","pairCount","computedTransitions","errorBlocks"]) {
    if(expected[key]!==undefined) comparisons.push({field:key,predicted:expected[key],observed:trace.stats[key],match:JSON.stringify(expected[key])===JSON.stringify(trace.stats[key])});
  }
  assert.equal(trace.stats.arenaAllocations,trace.stats.arenaFrees,`${expected.id}: live arena allocation remains`);
  assert.equal(trace.stats.contextBalanced,true,`${expected.id}: context lifetime not closed`);
  assert.ok(trace.events.filter(e=>e.category==="indirect.slot.write").every(e=>e.pointerToSlotUnchanged));
  assert.ok(trace.facts.containers.every(c=>c.moves.every(m=>m.oldStillAlive)));
  if(expected.requiresRetainedGrowth) assert.ok(trace.stats.retainedMoves>0);
  if(expected.requiresExactHighBit) assert.ok(trace.facts.bitset.operations.some(o=>o.valueHex===expected.requiresExactHighBit));
  if(!expected.errorBlocks) assert.ok(trace.frames.every(f=>f.ended),`${expected.id}: normal frame not closed`);
  const labeled=structuredClone(trace.facts);
  for(const [i,g] of labeled.referenceGroups.entries()) {g.name=i%2 ? "array":"grid";g.displayName="renamed";}
  for(const c of labeled.containers) {c.name="graph";c.variableName="tree";}
  assert.deepEqual(proposeViews(labeled),trace.proposals,"Names must not change structural proposals");
  const report={id:expected.id,stdin:expected.stdin,stdout:observed.stdout,exitCode:observed.exitCode,
    comparisons,predictionsMatch:comparisons.every(c=>c.match),invariants:{programOutputUnchanged:true,statisticsUnchanged:true,
      arenaBalanced:true,contextBalanced:true,indirectSlotResolved:true,retiredArraysRemainAlive:true,namesIgnored:true},
    counts:trace.stats,views:trace.proposals,files:{trace:`${expected.id}.trace.jsonl`,structures:`${expected.id}.structures.json`}};
  reports.push(report);artifacts.set(expected.id,trace);
  await writeFile(file(`${expected.id}.trace.jsonl`),trace.events.map(e=>JSON.stringify(e)).join("\n")+"\n");
  await writeFile(file(`${expected.id}.structures.json`),JSON.stringify({snapshot:trace.snapshot,graphs:trace.graphs,trees:trace.trees,
    records:trace.records,pairs:trace.pairs,pairParents:trace.pairParents,pairLinks:trace.pairLinks,
    containers:trace.facts.containers,allocations:trace.allocations,views:trace.proposals},null,2)+"\n");
  await writeFile(file(`${expected.id}.stdout.txt`),observed.stdout);
}
const report={schemaVersion:1,sourceSha256:hash,predictionSha256:createHash("sha256").update(predictionsText).digest("hex"),
  method:generated.plan.method,coverage:generated.plan.coverage,allPredictionsMatch:reports.every(r=>r.predictionsMatch),
  errorPresentation:"one ERROR block; cleanup events remain attached to the execution history",
  structureInference:"anonymous type relationships, identities and access patterns; not arbitrary-C automatic recognition",
  cases:reports};
await writeFile(file("comparison.json"),JSON.stringify(report,null,2)+"\n");
// Derive a static diagram from actual reference writes, not a hand-drawn expected graph.
const cycleData=artifacts.get("cycles"),kindLabels=["byte","jump","split","accept"];
const diagram=["flowchart LR"];
for(const [index,g] of cycleData.graphs.entries()) {
  diagram.push(`subgraph G${index}["${index===0?"a*":"a*a*"}"]`);
  const keys=new Map(g.nodes.map((node,i)=>[node.id,`G${index}N${i}`]));
  for(const node of g.nodes) { const r=cycleData.records.find(r=>r.id===node.id);diagram.push(`${keys.get(node.id)}["${r.index}: ${kindLabels[r.tag]}"]`); }
  for(const edge of g.edges) diagram.push(`${keys.get(edge.from)} -->|"${edge.field}"| ${keys.get(edge.to)}`);
  diagram.push("end");
}
await writeFile(file("cycles.mmd"),diagram.join("\n")+"\n");
console.log(JSON.stringify({allPredictionsMatch:report.allPredictionsMatch,cases:reports.map(r=>({id:r.id,match:r.predictionsMatch,
  ast:r.counts.recordNodes,nfa:r.counts.automatonNodes,dfa:r.counts.cachedStateCounts,pairs:r.counts.pairCount,
  events:artifacts.get(r.id).events.length,frames:r.counts.frames,retainedMoves:r.counts.retainedMoves,
  differences:r.comparisons.filter(c=>!c.match)}))},null,2));
if(!report.allPredictionsMatch) process.exitCode=1;
