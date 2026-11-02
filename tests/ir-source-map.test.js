import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel,compileCToIR} from '../scripts/model/index.mjs';
import {createSourceMap} from '../scripts/model/source-map.mjs';

test('No4 binds one compound CALC, typed increments and the do condition without semantic source scans',async()=>{
  const filename='examples/c/blind/No4.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
  const {plan,trace,stdout}=await traceModel(source,{filename});
  assert.equal(trace.status,'completed');assert.equal(stdout,'18 7\n8 0\n6 3\n');
  const defs=new Map(plan.instructions.map(i=>[i.id,i]));
  const cs=trace.events.filter(e=>e.kind==='CALC'&&defs.get(e.instructionId).source?.line===32);
  assert.equal(cs.length,3);assert.equal(new Set(cs.map(e=>e.instructionId)).size,1);
  assert.deepEqual(cs.map(e=>e.steps.map(s=>s.value.decimal)),[['1','1'],['2','3'],['3','6']]);
  assert.ok(cs.every(e=>e.steps.map(s=>s.operator).join(',')==='+,+='));
  const updates=trace.events.filter(e=>e.kind==='CALC'&&['++','--'].includes(e.operator));
  assert.equal(updates.length,14);assert.ok(updates.every(e=>e.value.cType.name==='int'));
  const decisions=trace.events.filter(e=>e.action==='branch'&&defs.get(e.instructionId).controlKind==='DoStmt');
  assert.equal(decisions.length,3);
  for(const e of decisions){const d=defs.get(e.instructionId);assert.equal(d.source.line,34);assert.equal(d.statementSource.line,31);assert.equal(d.source.expression,'MhxjfzmEXh < 3');}
  assert.equal(plan.sourceMap.stats.semanticSourceScans,0);
  assert.ok(plan.sourceMap.stats.compilerLocationCacheHits>0);assert.ok(plan.sourceMap.stats.rangeCacheHits>0);
  assert.ok(plan.sourceMap.sourceQueries.every(q=>['token-end-not-in-compiler-dump','display-source-text'].includes(q.reason)));
  assert.equal(plan.sourceMap.snapshot.text,source);
  for(const binding of Object.values(plan.bindings))assert.ok(binding.sourceMapping);
  const src=Buffer.from(source);
  for(const instruction of plan.instructions.filter(i=>i.sourceStatus==='mapped')){
    const s=instruction.source;assert.equal(s.file,filename);assert.ok(s.endExclusive);
    if(s.expression!==undefined)assert.equal(src.subarray(s.start.byte,s.end.byte).toString('utf8'),s.expression);
  }
});

test('compiler case constants handle shared hexadecimal and parenthesized labels without source-number parsing',async()=>{
  const source=`int f(int n){switch(n){case 0x1:case (2):return 10;case 'A':return 20;case -1:return 30;case (1<<2):return 40;default:return 0;}}
int main(){return f(2);}`;
  const {plan,trace}=await traceModel(source);
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,10);
  const selected=trace.events.find(e=>e.action==='switch');assert.equal(selected.selection.value,'2');
  const label=plan.controlFlow.labels.find(l=>l.id===selected.selection.labelId);assert.equal(label.value,'2');
  assert.deepEqual(plan.controlFlow.labels.filter(l=>l.kind==='case').map(l=>l.value),['1','2','65','-1','4']);
  assert.deepEqual(plan.controlFlow.gaps,[]);assert.equal(plan.sourceMap.stats.semanticSourceScans,0);
});

test('compile-only source snapshots preserve CRLF, byte and UTF-16 ranges for same-line and multiline work',async()=>{
  const source='int main(){\r\n char *s="한😀\\n"; int a=1; int b=2;\r\n int c=(a +\r\n b)*3;\r\n return c;\r\n}\r\n';
  const {plan,trace}=await compileCToIR(source,{filename:'unicode.c'});assert.equal(trace,undefined);
  assert.equal(plan.sourceMap.snapshot.text,source);
  const calc=plan.instructions.find(i=>i.kind==='CALC'&&i.source?.expression==='(a +\r\n b)*3');assert.ok(calc);
  assert.equal(calc.source.start.line,3);assert.equal(calc.source.end.line,4);
  const a=plan.declarations.find(d=>d.name==='a'),b=plan.declarations.find(d=>d.name==='b');
  assert.equal(a.source.line,b.source.line);assert.notEqual(a.source.column,b.source.column);
  assert.ok(a.source.column>a.source.editorRange.startColumn,'UTF-8 bytes and UTF-16 columns differ after Korean/emoji');
  const lines=source.split('\n');
  for(const i of plan.instructions.filter(i=>i.sourceStatus==='mapped')){
    const s=i.source;
    assert.equal(s.start.editorColumn,Buffer.from(lines[s.start.line-1]).subarray(0,s.start.column-1).toString('utf8').length+1);
    assert.equal(s.end.editorColumn,Buffer.from(lines[s.end.line-1]).subarray(0,s.end.column-1).toString('utf8').length+1);
  }
  assert.ok(plan.sourceMap.compilerSites.some(s=>s.astNodeIds.length>0));
});

test('position mapping precedes source fallback and repeated range requests reuse bounded work',()=>{
  const source='int value = 1;\n',node={id:'n',kind:'VarDecl',functionName:'f',depth:1,source:{file:'/main.c',start:{line:1,column:1},end:{line:1,column:13}}};
  const mapping=createSourceMap({source,filename:'one.c',nodes:[node],llvm:'define i32 @f() {\n  ret i32 1, !dbg !1\n}',metadata:{location:()=>({file:'/main.c',line:1,column:13})}});
  assert.equal(mapping.report().sourceQueries.length,0);
  assert.deepEqual(mapping.sites[0].astNodeIds,['n']);
  for(let i=0;i<100;i++)assert.equal(mapping.range(node.source,{text:true}).expression,'int value = 1');
  const result=mapping.report();assert.equal(result.stats.tokenBoundaryScans,1);assert.equal(result.stats.textExtractions,1);assert.equal(result.stats.rangeCacheHits,99);
  assert.equal(mapping.range({file:'/other.h',start:{line:1,column:1},end:{line:1,column:1}}),null);
  assert.ok(mapping.report().gaps.some(g=>g.reason==='external-or-macro-range'));
});

test('for condition mapping retains empty AST child slots',async()=>{
  const source='int main(){int i=0;for(;i<2;){i++;}return i;}';
  const {plan,trace}=await traceModel(source);assert.equal(trace.exitCode,2);
  const d=plan.instructions.find(i=>i.kind==='FLOW'&&i.controlKind==='ForStmt'&&i.action==='branch');
  assert.equal(d.conditionSource.expression,'i<2');
});
