import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source){
  const r=await traceModel(source,{includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),objects=new Map(r.trace.objects.map(o=>[o.id,o]));
  return {...r,defs,objects,line:e=>defs.get(e.instructionId)?.source?.line,events:r.trace.events};
}

test('No12 preserves row access types, folded divisions, one pure comparison and the explicit return source',async()=>{
  const source=await readFile(new URL('../examples/c/blind/No12.c',import.meta.url),'utf8'),r=await inspect(source);
  assert.equal(r.stdout,'1 2 3\n13 5 26\n1 2 3\n1\n');
  const at=line=>r.events.filter(e=>r.line(e)===line),read=at(6).find(e=>e.kind==='READ'&&e.target.offset===8);
  assert.equal(read.value.decimal,'3');assert.equal(read.value.cType.name,'int');assert.equal(r.defs.get(read.instructionId).accessType,'i32');
  assert.ok(r.defs.get(read.instructionId).source.expression.endsWith('[0][2]'));
  const inc=at(7).find(e=>e.kind==='CALC');assert.equal(inc.value.cType.kind,'pointer');assert.equal(inc.value.cType.pointee.count,3);
  const folded=r.events.filter(e=>e.kind==='CALC'&&e.operator==='/');assert.deepEqual(folded.map(e=>e.value.decimal),['2','3']);
  assert.deepEqual(folded.map(e=>e.inputs.map(i=>i.value.decimal)),[['24','12'],['12','4']]);
  assert.ok(folded.every(e=>e.evidence.includes('compiler-folded')));
  const call=at(13).find(e=>e.action==='call');for(const c of folded)assert.ok(call.dataInputs.includes(c.eventId));
  const comparison=r.events.filter(e=>e.kind==='CALC'&&[15,16].includes(r.line(e)));assert.equal(comparison.length,1);assert.equal(comparison[0].operator,'==');assert.equal(comparison[0].value.decimal,'1');
  for(const e of r.events.filter(e=>['return','return.value'].includes(e.action)))assert.equal(r.line(e),17);
  assert.equal(r.line(r.events.at(-1)),18);
});

test('qualified pointers to arrays keep their shape through scalar reads and prefix updates',async()=>{
  const r=await inspect('int main(){int a[2][4]={{1,2,3,4},{5,6,7,8}};int(*p)[4]=a;int(*const fixed)[4]=a;\n int x=p[0][3];\n ++p;\n const int(*q)[4]=p;\n return x+(*q)[0]+(*fixed)[0];}');
  assert.equal(r.trace.exitCode,10);
  const type=name=>[...r.objects.values()].find(o=>o.name===name).cType;
  assert.ok(type('fixed').qualifiers.includes('const'));assert.equal(type('q').pointee.kind,'array');
  assert.ok(type('q').pointee.elementType.qualifiers.includes('const'));
  const read=r.events.find(e=>r.line(e)===2&&e.kind==='READ'&&e.target.size===4&&e.target.offset===12);assert.equal(read.value.cType.name,'int');
  const c=r.events.find(e=>r.line(e)===3&&e.kind==='CALC');assert.equal(c.value.cType.pointee.count,4);
  const update=r.events.filter(e=>r.line(e)===3);assert.equal(Number(update.at(-1).value.address)-Number(update[0].value.address),16);
});

test('folded source arithmetic attaches to stores, call arguments and return transport',async()=>{
  const r=await inspect('#include <stdio.h>\nint answer(){return (3+4)*2;}\nint main(){\n unsigned x=sizeof(int[5])/sizeof(int);\n printf("%u %d\\n",x,(2+3)*4);\n return answer();\n}');
  assert.equal(r.stdout,'5 20\n');assert.equal(r.trace.exitCode,14);
  const folded=r.events.filter(e=>e.kind==='CALC'&&e.evidence.includes('compiler-folded'));
  assert.deepEqual(folded.map(e=>e.value.decimal),['5','20','14']);
  for(const c of folded){assert.ok(r.events.some(e=>e.dataInputs.includes(c.eventId)));assert.ok(c.observationIds.length);}
  assert.ok(!r.events.some(e=>e.kind==='READ'&&r.line(e)===4));
});

test('sizeof unevaluated side effects stay unevaluated while VLA size uses observed execution',async()=>{
  const r=await inspect('#include <stdio.h>\nint main(){int i=1;int n=3;\n unsigned fixed=sizeof(i++)/sizeof(int);\n unsigned dynamic=sizeof(int[n++])/sizeof(int);\n printf("%d %d %u %u\\n",i,n,fixed,dynamic);return 0;}');
  assert.equal(r.stdout,'1 4 1 3\n');assert.ok(!r.events.some(e=>r.line(e)===3&&e.operator==='++'));
  assert.equal(r.events.find(e=>r.line(e)===3&&e.kind==='CALC').value.decimal,'1');
  const dynamic=r.events.filter(e=>r.line(e)===4&&e.kind==='CALC');assert.ok(dynamic.length);assert.ok(dynamic.every(e=>!e.evidence.includes('compiler-folded')));
  assert.equal(dynamic.filter(e=>e.operator==='++').length,1);
});

test('return carrier writes select the executed ReturnStmt and do not invent an explicit fallthrough return',async()=>{
  const r=await inspect('int pick(int n){int a[2]={4,8};\n if(n)return a[1]+n;\n return a[0];\n}\nint main(){return pick(0)+pick(1);}');
  assert.equal(r.trace.exitCode,13);
  const returns=r.events.filter(e=>e.action==='return.value');assert.deepEqual(returns.map(e=>[r.line(e),e.value.decimal??e.value.signed]),[[3,'4'],[2,'9'],[5,'13']]);
  const implicit=await inspect('int main(){\n if(0)return 17;\n}');assert.equal(implicit.trace.exitCode,0);
  assert.ok(implicit.events.filter(e=>e.action==='return.value').every(e=>implicit.line(e)!==2));
});
