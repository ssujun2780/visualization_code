import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {compileAndRun} from '../scripts/instrumentation/toolchain.mjs';
const dir='test-results/function-pointer-types-2026-11-13';
const cases=[
  {name:'pointer-results',stdout:'9 z 1\n',slots:['fi','fc','fv'],calls:{take_int:1,take_char:1,as_void:1},source:`#include <stdio.h>
int* take_int(int*p,int k){return p+k;}
char* take_char(char*p,int k){return p+k;}
void* as_void(void*p){return p;}
int main(void){int values[2]={4,9};char letters[]="az";
int*(*fi)(int*,int)=take_int;char*(*fc)(char*,int)=take_char;void*(*fv)(void*)=as_void;
int*pi=fi(values,1);char*pc=fc(letters,1);void*pv=fv(values);
printf("%d %c %d\\n",*pi,*pc,pv==values);return 0;}`},
  {name:'callback-storage',stdout:'4 9 9 4\n',slots:['local'],calls:{select_value:4},source:`#include <stdio.h>
typedef int*(*Picker)(int*,int*,int);
int* select_value(int*a,int*b,int flag){return flag?a:b;}
Picker global=select_value;Picker table[2]={select_value,select_value};
struct Operations{int tag;Picker run;};
int main(void){int a=4,b=9;Picker local=global;Picker*indirect=&local;struct Operations ops={7,select_value};
int*p=local(&a,&b,1);int*q=(*indirect)(&a,&b,0);int*r=table[1](&a,&b,0);int*s=ops.run(&a,&b,1);
printf("%d %d %d %d\\n",*p,*q,*r,*s);return 0;}`},
  {name:'returned-callback',stdout:'13 5 5\n',slots:['first','second'],calls:{next:1,same:2,factory:2,relay:1},returnedFunctions:{factory:['next','same'],relay:['same']},source:`#include <stdio.h>
typedef int*(*Action)(int*);
int* next(int*p){return p+1;}int* same(int*p){return p;}
Action factory(int flag){return flag?next:same;}
Action relay(Action callback){return callback;}
int main(void){int data[2]={5,13};Action first=factory(1);Action second=relay(factory(0));
int*a=first(data);int*b=second(data);first=second;int*c=first(data);
printf("%d %d %d\\n",*a,*b,*c);return 0;}`},
  {name:'returned-variadic-callback',stdout:'ba\n',slots:['first','second'],calls:{advance:1,stay:1,dispatch:2},returnedFunctions:{dispatch:['advance','stay']},source:`#include <stdio.h>
typedef char*(*Decoder)(char*);
char* advance(char*s){return s+1;}char* stay(char*s){return s;}
Decoder dispatch(int flag,...){return flag?advance:stay;}
int main(void){char data[]="ab";Decoder first=dispatch(1,3);Decoder second=dispatch(0,4);
char*a=first(data);char*b=second(data);printf("%c%c\\n",*a,*b);return 0;}`},
];

for(const c of cases)test(`${c.name}: composed function pointer types preserve observed calls and storage`,async()=>{
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/${c.name}.c`,c.source);await fs.writeFile(`${dir}/${c.name}.expected.json`,JSON.stringify({stdout:c.stdout,slots:c.slots,calls:c.calls,returnedFunctions:c.returnedFunctions},null,2));
  const plain=await compileAndRun(c.source),r=await traceModel(c.source,{includeObservations:true,filename:c.name+'.c'});
  await fs.writeFile(`${dir}/${c.name}.execution.json`,JSON.stringify(r));
  assert.equal(plain.exitCode,0);assert.equal(plain.stdout,c.stdout);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,c.stdout);assert.equal(r.stdout,plain.stdout);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),positions=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const name of c.slots){
    const object=r.trace.objects.find(o=>o.name===name);assert.ok(object,name);assert.equal(object.size,r.plan.backend.pointerBits/8);
    const created=events.get(object.createdBy);assert.equal(created.kind,'SPACE');assert.ok(object.endedBy);
    for(const kind of ['READ','WRITE']){const accesses=r.trace.events.filter(e=>e.kind===kind&&e.target?.objectId===object.id);assert.ok(accesses.length,kind+' '+name);for(const e of accesses){assert.equal(e.target.offset,0);assert.equal(e.target.size,object.size);assert.ok(positions.get(e.eventId)>positions.get(object.createdBy));assert.ok(positions.get(e.eventId)<positions.get(object.endedBy));}}
    const allocation=r.observations.plan.instructions.find(d=>d.action==='object.begin'&&d.local?.name===name);assert.ok(allocation);assert.match(allocation.type,/\)\*$/);assert.equal(allocation.cType.kind,'pointer');
  }
  for(const [name,count]of Object.entries(c.calls)){
    // callee retains the source LLVM operand (%SSA for an indirect call).
    // The contract's resolvedFunctionName records the actually entered target.
    const calls=r.trace.events.filter(e=>e.action==='call'&&e.resolvedFunctionName===name);assert.equal(calls.length,count,name);
    for(const [index,call]of calls.entries()){
      if(call.callee.startsWith('%')){assert.equal(call.functionTarget.functionName,name);assert.equal(call.functionTarget.functionId,call.resolvedFunctionId);assert.equal(call.functionTarget.tableIndex,call.indirectTableIndex);assert.ok(call.calleeInputs.some(id=>{const v=events.get(id)?.value;return v?.reference?.kind==='function'&&v.reference.functionId===call.resolvedFunctionId&&v.tableIndex===call.indirectTableIndex;}));}
      const delivery=r.trace.resultDeliveries.find(d=>d.callExecutionId===call.eventId);assert.ok(delivery,name+' result delivery');const resume=events.get(delivery.resumeExecutionId),returned=events.get(delivery.returnValueExecutionId);assert.equal(resume.callExecutionId,call.eventId);assert.equal(typeof resume.value.bits,'string');assert.equal(resume.value.bits,returned.value.bits);assert.equal(resume.value.cType.kind,'pointer');assert.equal(returned.callExecutionId,call.eventId);
      const returnedFunction=c.returnedFunctions?.[name]?.[index];if(returnedFunction){assert.equal(resume.value.reference.kind,'function');assert.equal(resume.value.reference.functionName,returnedFunction);assert.equal(resume.value.tableIndex,returned.value.tableIndex);}
    }
  }
});
