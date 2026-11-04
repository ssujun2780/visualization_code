import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';

async function inspect(source,{plain=false}={}){
  const expected=plain?await compileAndRun(source):null,r=await traceModel(source,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  if(expected){assert.equal(r.stdout,expected.stdout);assert.equal(r.trace.exitCode,expected.exitCode);}
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));return {...r,defs,events:r.trace.events,line:e=>defs.get(e.instructionId)?.source?.line};
}
const negations=r=>r.events.filter(e=>e.kind==='CALC'&&e.operator==='!');
function cBooleans(r){for(const c of negations(r)){assert.equal(c.value.type,'i32');assert.equal(c.value.cType.name,'int');assert.ok(['0','1'].includes(c.value.decimal));}}
let no13;
const example13=()=>no13??=(async()=>{const source=await readFile(new URL('../examples/c/blind/No13.c',import.meta.url),'utf8');return {source,result:await inspect(source)};})();

test('No13 retains source negation, dynamic allocation calls and macro assignment types/ranges',async()=>{
  const {result:r}=await example13();
  assert.equal(r.stdout,'0 1\n10 11 99 13\n20\n1 4\n');cBooleans(r);
  assert.deepEqual(negations(r).map(c=>c.value.decimal),['0','0','0']);
  const conditions=r.events.filter(e=>e.action==='branch'&&r.line(e)===8);assert.equal(conditions.length,3);
  for(const b of conditions){assert.equal(b.condition.decimal,'0');assert.equal(b.backendCondition.unsigned,'1');assert.equal(b.selected,'if.end');assert.equal(r.defs.get(b.instructionId).sourceDestinations.false,b.selected);}
  const heaps=new Set(r.trace.objects.filter(o=>o.storage==='heap').map(o=>o.id));
  for(const e of r.events.filter(e=>heaps.has(e.objectId)&&e.kind==='SPACE'))assert.ok(e.callExecutionId);
  const clears=r.events.filter(e=>e.action==='write'&&e.value?.address==='0x00000000');assert.equal(clears.length,4);
  for(const c of clears){assert.equal(c.value.cType.kind,'pointer');assert.ok(r.defs.get(c.instructionId).source.expression.includes('= NULL'));}
  assert.ok(r.plan.sourceMap.sourceQueries.some(q=>q.reason==='macro-range-not-in-compiler-dump'));
});

test('identifier renaming and line shifts preserve No13 operation and dependency structure',async()=>{
  const {source,result:a}=await example13(),names=new Map();
  const changed='/* locations changed */\n\n'+source.replace(/\b[A-Za-z]{10}\b/g,s=>{if(!names.has(s))names.set(s,`changed_${names.size}`);return names.get(s);});
  const b=await inspect(changed);assert.equal(b.stdout,a.stdout);
  const shape=r=>r.events.map(e=>[e.kind,e.action,e.operator,e.value?.decimal,e.value?.type,e.target?.offset,e.callExecutionId,e.dataInputs,e.addressInputs,e.controlInputs]);
  assert.deepEqual(shape(b),shape(a));
});

test('value negation handles pointers, nested !, comparisons, floating zero and NaN',async()=>{
  const r=await inspect('#include <stdio.h>\n#include <string.h>\nint floating(double d){return !d;}\nint main(){int value=2;int*p=&value;int*q=0;double d;memset(&d,255,sizeof d);\n int a=!p,b=!q,c=!!p,e=!!!q,f=!(value==0);\n printf("%d %d %d %d %d %d %d %d\\n",a,b,c,e,f,floating(-0.0),floating(3.5),floating(d));return 0;}',{plain:true});
  assert.equal(r.stdout,'0 1 1 1 1 1 0 0\n');assert.ok(negations(r).length>=8);cBooleans(r);
  for(const c of negations(r))assert.ok(c.steps.every(s=>s.operator!=='xor'));
});

test('branch inversions preserve source truth, executed edges and exactly-once calls',async()=>{
  const r=await inspect('#include <stdio.h>\nint calls=0;int probe(int x){calls++;return x;}\nint run(int*p,int x,double d){int hits=0;\n if(!p)hits+=1;\n if(!!x)hits+=2;\n if(!(x==0))hits+=4;\n if(!d)hits+=8;\n if(!probe(x))hits+=16;\n return hits;}\nint main(){int n=2;int a=run(&n,2,3.5);int b=run(0,0,-0.0);printf("%d %d %d\\n",a,b,calls);return 0;}',{plain:true});
  assert.equal(r.stdout,'6 25 2\n');cBooleans(r);
  const branches=r.events.filter(e=>e.action==='branch'&&e.backendCondition);assert.equal(branches.length,10);
  for(const b of branches){assert.equal(b.condition.type,'i32');assert.ok(['0','1'].includes(b.condition.decimal));assert.equal(r.defs.get(b.instructionId).sourceDestinations[b.condition.decimal==='1'?'true':'false'],b.selected);}
  assert.equal(r.events.filter(e=>e.action==='call'&&e.callee==='@probe').length,2);
});

test('negated operands retain short-circuit selection without invoking a skipped call',async()=>{
  const r=await inspect('#include <stdio.h>\nint calls=0;int probe(){calls++;return 0;}\nint evaluate(int*p){return !p || !probe();}\nint main(){int n=1;int a=evaluate(0);int b=evaluate(&n);printf("%d %d %d\\n",a,b,calls);return 0;}',{plain:true});
  assert.equal(r.stdout,'1 1 1\n');cBooleans(r);
  const results=r.events.filter(e=>e.kind==='CALC'&&e.evaluation?.kind==='logical');assert.equal(results.length,2);
  assert.deepEqual(results.map(e=>[e.evaluation.leftTruth,e.evaluation.right]),[[true,'skipped'],[false,'evaluated']]);
  assert.equal(r.events.filter(e=>e.action==='call'&&e.callee==='@probe').length,1);
});

test('macro range recovery is independent of macro names, arguments, comments and RHS values',async()=>{
  const source='#define EMPTY_VALUE(T,NOTE) ((T*)0)\n#define EMPTY_ALIAS EMPTY_VALUE(int,"unused")\n#define NUMBER_VALUE 17\nint main(){int a=3;int*slots[2]={&a,&a};int*separate=&a;int number=0;\n slots[0] = EMPTY_ALIAS; slots[1] = EMPTY_VALUE(int, "semi;comma,)\\\"");\n separate /* boundary */ = EMPTY_ALIAS;\n number = NUMBER_VALUE;\n return a+number;}';
  const r=await inspect(source,{plain:true});assert.equal(r.trace.exitCode,20);
  const assignments=r.events.filter(e=>e.action==='write'&&[5,6,7].includes(r.line(e)));assert.equal(assignments.length,4);
  for(const e of assignments){const d=r.defs.get(e.instructionId);assert.equal(d.sourceStatus,'mapped');assert.ok(d.source.expression.includes('='));assert.ok(d.source.expression.length>1);assert.ok(e.value.cType);}
  const pointerWrites=assignments.filter(e=>e.value.address);assert.equal(pointerWrites.length,3);for(const e of pointerWrites)assert.equal(e.value.reference.status,'null');
  assert.ok(r.plan.sourceMap.stats.macroRangeScans>0);assert.ok(r.plan.sourceMap.sourceQueries.filter(q=>q.reason==='macro-range-not-in-compiler-dump').every(q=>q.endByte-q.startByte<4096));
});

test('all allocation lifetime effects use their actual calloc/realloc/free call execution',async()=>{
  const r=await inspect('#include <stdio.h>\n#include <stdlib.h>\nint main(){int*p=calloc(2,sizeof*p);if(!p)return 1;p[0]=4;p[1]=6;int*q=realloc(p,3*sizeof*p);if(!q){free(p);return 2;}q[2]=9;printf("%d\\n",q[0]+q[1]+q[2]);free(q);return 0;}',{plain:true});
  assert.equal(r.stdout,'19\n');const effects=r.events.filter(e=>e.kind==='SPACE'&&r.defs.get(e.instructionId)?.callee);
  assert.equal(effects.length,4);for(const e of effects){const c=r.events.find(c=>c.eventId===e.callExecutionId);assert.ok(c);assert.equal(c.action,'call');assert.ok(['@calloc','@realloc','@free'].includes(c.callee));}
});
