import fs from 'node:fs/promises';
const base=new URL('../../../test-results/codex_code-results/',import.meta.url);
const read=async(c,f)=>JSON.parse(await fs.readFile(new URL(c+'/input0/'+f,base),'utf8'));
const evidence={createdAt:new Date().toISOString(),scope:'Post-run focused inspection of saved traces. Original pre-run predictions remain in prediction.json; this file adds evidence and does not replace them.'};
const p1=await read('01_insertion_beginner','plan.json'),t1=await read('01_insertion_beginner','trace.json'),shifts=await read('01_insertion_beginner','writes-shift.json');
const defs1=new Map(p1.instructions.map(d=>[d.id,d])),at=t1.events.findIndex(e=>e.eventId===shifts[0].eventId);
evidence.firstInsertion={expectedExplanation:'Input starts 7,2. Read save=2; compare 7>2 with j=1; shift 7 into index1; decrement j to0; next condition short-circuits; place2 at index0.',
 eventWindow:t1.events.slice(at-15,at+24).map(e=>({id:e.eventId,kind:e.kind,action:e.action,value:e.value?.decimal??e.value?.number,source:defs1.get(e.instructionId)?.source,
 target:e.target,inputs:e.inputs?.map(i=>({executionId:i.executionId,value:i.value?.decimal??i.value?.number})),dataInputs:e.dataInputs}))};
const pv=await read('18_vector_reallocate_slow','plan.json'),tv=await read('18_vector_reallocate_slow','trace.json'),dv=new Map(pv.instructions.map(d=>[d.id,d])),counts={};
for(const e of tv.events)if(e.kind==='FLOW'&&e.action==='call'){const name=(e.resolvedFunctionName??dv.get(e.instructionId)?.callee??'?').replace(/^@/,'');counts[name]=(counts[name]??0)+1;}
evidence.inefficientVector={derivedFromSource:{append:6,realloc:6,malloc:6,memcpy:12,free:7},observed:counts,
 checks:Object.entries({append:6,realloc:6,malloc:6,memcpy:12,free:7}).map(([name,expected])=>({name,expected,actual:counts[name],pass:counts[name]===expected})),
 meaning:'Six growth reallocations and twelve redundant copies survive in public IR; they were not simplified away.'};
const td=await read('20_shared_dag','trace.json');
evidence.sharedDag=td.structures.filter(s=>s.kind==='linked-structure').map(s=>{const live=s.states.filter(x=>x.rootAlive&&x.topology?.nodeCount===4&&x.topology?.sharedChildren?.length===1).at(-1);return{id:s.id,historicalViews:s.views,selectedEvent:live?.afterExecutionId,currentTopology:live?.topology};});
evidence.sentinelComparison=[];
for(const id of ['05_circular_sentinel','26_sentinel_pointer_alias']){const p=await read(id,'plan.json'),t=await read(id,'trace.json');evidence.sentinelComparison.push({id,
 anchorCount:p.structureBindings.linkAnchors.length,boundaryCount:p.structureBindings.linkBoundarySpecs.length,
 kinds:[...new Set(t.structures.map(s=>s.kind))],views:[...new Set(t.structures.flatMap(s=>s.views??[]))]});}
const ps=await read('16_persistent_segment_tree','plan.json'),ts=await read('16_persistent_segment_tree','trace.json');
evidence.missingLogic={irGaps:ts.coverage.irGaps,definitions:ps.instructions.filter(d=>['ast1556','ast1700'].includes(d.sourceNodeId)).map(d=>({id:d.id,kind:d.kind,sourceNodeId:d.sourceNodeId,source:d.source}))};
evidence.diagnostics=[];
const suite=JSON.parse(await fs.readFile(new URL('cases.json',import.meta.url),'utf8'));
for(const c of suite.cases)for(const i of c.inputs){const r=JSON.parse(await fs.readFile(new URL(c.id+'/'+i.id+'/report.json',base),'utf8'));if(r.diagnostics?.length)evidence.diagnostics.push({case:c.id,input:i.id,diagnostics:r.diagnostics});}
await fs.writeFile(new URL('PROCESS_EVIDENCE.json',base),JSON.stringify(evidence,null,2)+'\n');
await fs.writeFile(new URL('sanitizer-availability.txt',base),'GCC 15.2 MinGW probe: -fsanitize=undefined -fno-sanitize-recover=all\nLinker failed: cannot find -lubsan: No such file or directory.\nNo sanitizer run is claimed. Native O0/O2 and plain Clang/WASM checks are recorded separately.\n');
console.log(JSON.stringify({vectorChecks:evidence.inefficientVector.checks,dag:evidence.sharedDag.map(s=>({event:s.selectedEvent,status:s.currentTopology?.status,shared:s.currentTopology?.sharedChildren.length})),diagnosticReports:evidence.diagnostics.length}));
