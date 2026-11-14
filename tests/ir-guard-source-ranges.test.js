import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source,{filename:'guard-ranges.c',inference:false});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  return r;
}

function condition(r,source,expression,values){
  const d=r.plan.instructions.find(d=>d.kind==='CALC'&&['truth','!='].includes(d.operator)&&d.source?.expression===expression);
  assert.ok(d,`missing complete condition range: ${expression}`);
  const bytes=Buffer.from(source);
  assert.equal(bytes.subarray(d.source.start.byte,d.source.end.byte).toString(),expression);
  assert.deepEqual(d.source.editorRange,d.expression.source.editorRange);
  const events=r.trace.events.filter(e=>e.instructionId===d.id);
  assert.deepEqual(events.map(e=>e.value.decimal),values,expression);
  const pos=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of events){
    const branch=r.trace.events.find(b=>b.action==='branch'&&b.dataInputs.includes(e.eventId));
    assert.ok(branch,`condition ${e.eventId} must still feed its branch`);
    assert.ok(pos.get(e.eventId)<pos.get(branch.eventId));
    assert.ok(e.dataInputs.some(id=>r.trace.events[pos.get(id)]?.kind==='READ'));
  }
}

test('implicit truth ranges cover member, array and dereference operands, with explicit comparison unchanged',async()=>{
  const source=`#include <stdio.h>
typedef struct { int flag, values[2]; } R;
int main(void){
 R record={1,{0,3}}; R *p=&record;
 int slots[2]={0,5},i=1,*q=&slots[i],hits=0;
 if(p->flag) hits+=1;
 if(record.flag) hits+=2;
 if(slots[i]) hits+=4;
 if(*q) hits+=8;
 if(p->values[i]) hits+=16;
 if(p->flag != 0) hits+=32;
 printf("%d\\n",hits);return 0;
}`;
  const r=await inspect(source,'63\n');
  for(const expr of ['p->flag','record.flag','slots[i]','*q','p->values[i]','p->flag != 0'])condition(r,source,expr,['1']);
});

test('while, do and for truth ranges retain per-iteration values and source READs',async()=>{
  const source=`#include <stdio.h>
typedef struct { int flag; } R;
int main(void){R record={2},*p=&record;int values[2]={0,2},slots[2]={0,2},i=1,hits=0;
 while(p->flag){p->flag--;hits++;}
 do{values[i]--;hits++;}while(values[i]);
 for(;slots[i];){slots[i]--;hits++;}
 printf("%d\\n",hits);return 0;}`;
  const r=await inspect(source,'6\n');
  condition(r,source,'p->flag',['1','1','0']);
  condition(r,source,'values[i]',['1','0']);
  condition(r,source,'slots[i]',['1','1','0']);
});

test('truth ranges preserve multiline UTF-8/UTF-16 positions and macro invocation boundaries',async()=>{
  const source=['#include <stdio.h>','#define FLAG(x) ((x)->flag)',
    'typedef struct { int flag; } R;','int main(void){R record={1},*p=&record;int hits=0;',
    ' /* 한😀 */ if(p->',' flag)hits++;',' if(FLAG(p))hits++;',
    ' printf("%d\\n",hits);return 0;}'].join('\r\n');
  const r=await inspect(source,'2\n');
  condition(r,source,'p->\r\n flag',['1']);
  condition(r,source,'FLAG(p)',['1']);
  const d=r.plan.instructions.find(d=>d.source?.expression==='p->\r\n flag');
  assert.equal(d.source.start.line,5);assert.equal(d.source.end.line,6);
  assert.ok(d.source.start.column>d.source.editorRange.startColumn);
});
