import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {traceModel} from '../scripts/model/index.mjs';
import {writeJSON} from '../scripts/shared/json-output.mjs';
import {inferExecutionRelations,createExecutionWorkQuery} from '../scripts/execution-relations/index.mjs';

// Fixed from the C source BEFORE execution. These labels are an independent
// test oracle; production inference never receives this mapping or answers.
const names={sort:'KOMiotzePa',partition:'PHsyPeGEdM',compare:'EnlcflvtYt',swap:'vWLTjaPIIW',array:'TppTGvmUHW'};
const expected={input:[5,2,5,1,4,2],stdout:'1 2 2 4 5 5\n',
  calls:{sort:7,partition:3,compare:10,swap:5,total:25},
  partitionRanges:[[0,24],[8,16],[12,12]],pivotPositions:[1,2,4],
  swapIndices:[[0,3],[1,5],[2,5],[3,4],[4,5]],
  swapRanges:[[[0,4],[12,4]],[[4,4],[20,4]],[[8,4],[20,4]],[[12,8]],[[16,8]]],
  comparatorResults:[1,0,1,-1,1,1,1,1,0,-1],
  swapCopies:15,arrayWrites:10,unaccessedLeaves:4,finalOriginalIndices:[3,5,1,4,2,0]};
const directory='test-results/execution-relations/quicksort',source=await readFile('examples/c/blind/No27.c','utf8');
let execution;
function run(){return execution??=(async()=>{
  await mkdir(directory,{recursive:true});
  await writeJSON(directory+'/prediction.json',{source:'examples/c/blind/No27.c',sourceHash:createHash('sha256').update(source).digest('hex'),
    expected,status:'frozen-before-execution',contracts:['single original array identity','no range from integer bounds alone',
      'three observed copies per swap','duplicate values do not establish identity','same shared read-only consumer rules']});
  const generated=await traceModel(source,{filename:'No27.c',maxEvents:30000});
  assert.equal(generated.trace?.status,'completed',generated.stderr);assert.equal(generated.trace.exitCode,0);
  const {plan,trace}=generated,before=JSON.stringify({plan,trace}),start=performance.now(),result=inferExecutionRelations(plan,trace),elapsedMs=performance.now()-start;
  await Promise.all([writeFile(directory+'/original.c',source),writeFile(directory+'/stdout.txt',generated.stdout),
    writeJSON(directory+'/plan.json',plan),writeJSON(directory+'/trace.json',trace),writeJSON(directory+'/execution-relations.json',result)]);
  assert.equal(result.status,'completed',JSON.stringify(result.diagnostics));assert.equal(JSON.stringify({plan,trace}),before);
  return {...generated,result,elapsedMs,query:createExecutionWorkQuery(plan,trace,result)};
})();}
const kind=(r,k)=>r.relations.filter(r=>r.kind===k),spans=rows=>rows.map(({offset,size})=>[offset,size]);
function identify(trace){
  const main=trace.frames.find(f=>f.functionName==='main'),array=trace.objects.find(o=>o.frameId===main.id&&o.name===names.array),groups={};
  for(const [role,name]of Object.entries(names))if(role!=='array')groups[role]=trace.frames.filter(f=>f.functionName===name);
  return {main,array,groups};
}
function originalIndices(trace,array,transfers){
  const positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    identity=new Map([[array.id,new Map(Array.from({length:array.size},(_,i)=>[i,i]))]]);
  for(const copy of [...transfers].sort((a,b)=>positions.get(a.writeExecutionId)-positions.get(b.writeExecutionId))){
    const [s,d]=copy.participants,from=identity.get(s.objectId);assert.ok(from);
    const to=identity.get(d.objectId)??new Map(),bytes=Array.from({length:s.size},(_,i)=>from.get(s.offset+i));
    for(let i=0;i<d.size;i++)to.set(d.offset+i,bytes[i]);identity.set(d.objectId,to);
  }
  return Array.from({length:array.size/4},(_,i)=>identity.get(array.id).get(i*4)/4);
}
test('quicksort calls and indirect comparator returns match independent source predictions',async()=>{
  const {trace,stdout,result}=await run(),{array,groups}=identify(trace);
  assert.equal(stdout,expected.stdout);assert.equal(array.size,24);assert.equal(trace.objects.filter(o=>o.storage==='heap').length,0);
  const calls=kind(result,'activation-call');assert.equal(calls.length,expected.calls.total);
  for(const role of ['sort','partition','compare','swap']){
    assert.equal(groups[role].length,expected.calls[role]);
    for(const f of groups[role])assert.ok(calls.some(r=>r.calleeActivationId===f.id&&r.callerActivationId===f.parent));
  }
  const returned=f=>Number(trace.events.find(e=>e.activationId===f.id&&e.action==='return.value').value.decimal);
  assert.deepEqual(groups.partition.map(returned),expected.pivotPositions);
  assert.deepEqual(groups.compare.map(returned),expected.comparatorResults);
});
test('shared in-place ranges preserve sparse swaps, subtree use, and unknown leaf ranges',async()=>{
  const {trace,result}=await run(),{array,groups}=identify(trace),ranges=kind(result,'activation-range');
  const summary=(f,scope='subtree')=>ranges.find(r=>r.activationIds[0]===f.id&&r.objectId===array.id&&r.scope===scope);
  assert.deepEqual(groups.partition.map(f=>spans(summary(f).ranges)),expected.partitionRanges.map(r=>[r]));
  assert.deepEqual(groups.swap.map(f=>spans(summary(f,'direct').ranges)),expected.swapRanges);
  assert.deepEqual(spans(summary(groups.sort[0]).ranges),[[0,24]]);assert.equal(summary(groups.sort[0],'direct'),undefined);
  const leaves=groups.sort.filter(f=>!trace.frames.some(child=>child.parent===f.id));assert.equal(leaves.length,expected.unaccessedLeaves);
  for(const f of leaves){assert.equal(summary(f),undefined);assert.ok(kind(result,'pointer-argument').some(r=>r.activationIds.includes(f.id)&&r.reference.objectId===array.id));}
  // The partition's own read is the pivot; comparator/swap child accesses
  // must not be misreported as direct accesses of the partition function.
  assert.deepEqual(groups.partition.map(f=>spans(summary(f,'direct').readRanges)),[[[20,4]],[[20,4]],[[20,4]]]);
});
test('all five swaps retain three actual copies and duplicate-value exchanges preserve original identity',async()=>{
  const {trace,result}=await run(),{array,groups}=identify(trace),copies=kind(result,'storage-copy'),swapFrames=new Set(groups.swap.map(f=>f.id)),
    transfers=copies.filter(r=>swapFrames.has(r.activationIds[0]));
  assert.equal(transfers.length,expected.swapCopies);assert.equal(transfers.filter(r=>r.participants[1].objectId===array.id).length,expected.arrayWrites);
  const endpoints=[];
  for(const f of groups.swap){
    const arguments_=trace.events.filter(e=>e.activationId===f.id&&e.action==='argument').sort((a,b)=>a.parameterIndex-b.parameterIndex);
    assert.equal(arguments_.length,2);assert.ok(arguments_.every(e=>e.value.reference.targetObjectId===array.id));
    endpoints.push(arguments_.map(e=>e.value.reference.targetOffset/4));
    const temp=trace.objects.find(o=>o.frameId===f.id&&o.cType?.kind!=='pointer');assert.ok(temp);
    const writes=transfers.filter(r=>r.activationIds[0]===f.id);
    assert.deepEqual(writes.map(r=>r.participants.map(p=>p.objectId)),[[array.id,temp.id],[array.id,array.id],[temp.id,array.id]]);
    assert.deepEqual(writes.map(r=>r.participants.map(p=>p.offset)),[[endpoints.at(-1)[0]*4,0],
      [endpoints.at(-1)[1]*4,endpoints.at(-1)[0]*4],[0,endpoints.at(-1)[1]*4]]);
  }
  assert.deepEqual(endpoints,expected.swapIndices);
  // Track byte identities through the inferred edges. Never match numbers;
  // indices 1/5 both contain 2, and indices 0/2 both contain 5.
  assert.deepEqual(originalIndices(trace,array,transfers),expected.finalOriginalIndices);
});
test('current work follows the indirect comparison and live swap temporary without showing future or ended frames',async()=>{
  const {plan,trace,result,query}=await run(),{array,groups}=identify(trace),compare=groups.compare[0],
    calc=trace.events.find(e=>e.activationId===compare.id&&e.kind==='CALC'),view=query.at(calc.eventId),
    pivot=trace.objects.find(o=>o.frameId===groups.partition[0].id&&o.cType?.kind!=='pointer'&&o.size===4&&
      trace.events.some(e=>e.target?.objectId===o.id&&e.action==='write'&&e.dataInputs?.some(id=>trace.events.find(r=>r.eventId===id)?.target?.objectId===array.id)));
  assert.ok(pivot);assert.equal(view.calls.currentActivationId,compare.id);
  assert.deepEqual(view.calls.stack.map(f=>f.functionName),['main',names.sort,names.partition,names.compare]);
  assert.deepEqual(spans(view.storage.find(o=>o.objectId===array.id).observed.readRanges),[[0,4]]);
  assert.ok(view.storage.some(o=>o.objectId===pivot.id));assert.ok(!view.calls.stack.some(f=>f.activationId===groups.compare[1].id));
  assert.deepEqual(view.operation.source,plan.instructions.find(i=>i.id===calc.instructionId).source);
  const swap=groups.swap[0],middle=kind(result,'storage-copy').filter(r=>r.activationIds[0]===swap.id)[1],during=query.at(middle.writeExecutionId);
  assert.equal(during.calls.currentActivationId,swap.id);assert.ok(during.locals.some(o=>o.latestObservation&&o.parameter===null));
  const cleanup=trace.events.find(e=>e.activationId===swap.id&&e.action==='frame.end'),after=query.at(cleanup.eventId);
  assert.equal(after.calls.currentActivationId,swap.parent);assert.ok(after.history.activations.some(f=>f.activationId===swap.id));
  assert.ok(!after.locals.some(o=>o.frameId===swap.id));
});
test('save the independently checked algorithm comparison and representative work contexts',async()=>{
  const {trace,stdout,result,query,elapsedMs}=await run(),{array,groups}=identify(trace),calls=kind(result,'activation-call'),copies=kind(result,'storage-copy'),
    firstComparison=trace.events.find(e=>e.activationId===groups.compare[0].id&&e.kind==='CALC'),
    firstSwapCopy=copies.find(r=>r.activationIds[0]===groups.swap[0].id),transfers=copies.filter(r=>groups.swap.some(f=>f.id===r.activationIds[0]));
  await writeJSON(directory+'/comparison.json',{expected,actual:{calls:Object.fromEntries(Object.entries(groups).map(([role,frames])=>[role,frames.length])),
    parentChildCalls:calls.length,swapCopies:transfers.length,arrayWrites:transfers.filter(r=>r.participants[1].objectId===array.id).length,
    finalOriginalIndices:originalIndices(trace,array,transfers),stdout,
    partitionRanges:groups.partition.map(f=>spans(kind(result,'activation-range').find(r=>r.activationIds[0]===f.id&&r.scope==='subtree'&&r.objectId===array.id).ranges)),
    arrayObjectId:array.id,arraySize:array.size},events:trace.events.length,relations:result.relations.length,elapsedMs,status:'matched',
    limitations:['no named partition or swap semantic relation; use exact range/copy/call records','leaf ranges remain unknown without actual access']});
  await writeJSON(directory+'/work-context.json',{comparison:query.at(firstComparison.eventId),swapTemporary:query.at(firstSwapCopy.writeExecutionId)});
});
