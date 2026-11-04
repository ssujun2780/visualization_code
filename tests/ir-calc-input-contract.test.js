import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateCalcPlan,validateCalcTrace} from '../scripts/model/calc-contract.mjs';

async function inspect(source,stdout){
  const r=await traceModel(source);
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);
  validateCalcPlan(r.plan);validateCalcTrace(r.plan,r.trace);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),events=new Map(r.trace.events.map(e=>[e.eventId,e]));
  const order=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of r.trace.events){
    for(const key of ['dataInputs','addressInputs','controlInputs','calleeInputs'])for(const id of e[key])
      assert.ok(order.get(id)<order.get(e.eventId),`${e.eventId} ${key} references future ${id}`);
    if(e.kind==='CALC')for(const input of e.inputs??[]){
      if(!input.executionId)continue;
      assert.ok(order.get(input.executionId)<order.get(e.eventId),'CALC consumes an already obtained value');
      const producer=events.get(input.executionId);
      if(producer?.kind==='READ'&&producer.value?.bits){
        assert.equal(input.value.bits,producer.value.bits,'the input is the captured READ value');
        assert.ok(input.value.cType,'captured input retains its C type');
      }
    }
  }
  const frames=name=>r.trace.frames.filter(f=>f.functionName===name);
  const work=f=>r.trace.events.filter(e=>e.activationId===f.id);
  const calcs=f=>work(f).filter(e=>e.kind==='CALC');
  return {...r,defs,events,frames,work,calcs};
}

test('arithmetic, address reads, logical guards, compound writes and increments consume fixed inputs',async()=>{
  const r=await inspect(String.raw`#include <stdio.h>
int arithmetic(int a,int b,int c,int d){int x=a+b*2;int y=(a+b)*2;int z=(a+b)-(c+d);return x+y+z;}
int indexed(int *v,int i,int b){return v[i-1]*2+b;}
int logical(int a,int b,int c){return (a+1>b*2)&&(c-1!=0);}
int branch(int a,int b,int c){if((a+1>b*2)&&(c-1!=0))return 1;return 0;}
int update(int *v,int i,int a,int b){v[i]+=a*b;return v[i];}
int postfix(int *p){return (*p)++*2;}
int prefix(int *p){return ++*p*2;}
int selected(int a,int b){return (a>b?a:b)*2;}
int main(void){int v[4]={2,5,7,9},p=3;
printf("%d %d ",arithmetic(10,20,3,4),indexed(v,3,5));
printf("%d %d %d %d ",logical(4,1,3),logical(0,2,3),branch(4,1,3),branch(0,2,3));
printf("%d ",update(v,1,2,3));printf("%d ",postfix(&p));printf("%d ",prefix(&p));
printf("%d %d %d\n",selected(4,2),selected(1,3),p);return 0;}`,'133 19 1 0 1 0 11 6 10 8 6 5\n');
  const arithmetic=r.calcs(r.frames('arithmetic')[0]);
  assert.deepEqual(arithmetic.map(e=>e.value.decimal),['50','60','23','133']);
  assert.deepEqual(arithmetic.map(e=>e.steps.map(s=>s.operator)),[['*','+'],['+','*'],['+','+','-'],['+','+']]);
  // The AST, rather than the LLVM step order, supplies left/right and parentheses.
  const tree=r.defs.get(arithmetic[0].instructionId).expression;
  assert.equal(tree.operator,'+');assert.equal(tree.children[0].children[0].referencedName,'a');
  assert.equal(tree.children[1].operator,'*');
  assert.deepEqual(r.calcs(r.frames('indexed')[0]).map(e=>e.value.decimal),['2','19']);
  for(const name of ['logical','branch'])for(const [index,f]of r.frames(name).entries()){
    const calc=r.calcs(f);assert.equal(calc.length,1);assert.equal(calc[0].evaluation.right,index?'skipped':'evaluated');
    assert.deepEqual(calc[0].steps.map(s=>s.operator),index?['+','*','>','&&']:['+','*','>','-','!=','&&']);
    const reads=r.work(f).filter(e=>e.kind==='READ');assert.equal(reads.length,index?2:3);
  }
  const u=r.work(r.frames('update')[0]),calc=u.find(e=>e.kind==='CALC'),write=u.find(e=>e.action==='write');
  assert.equal(u.filter(e=>e.kind==='CALC').length,1);assert.deepEqual(calc.steps.map(s=>s.operator),['*','+=']);
  const old=calc.inputs.map(i=>r.events.get(i.executionId)).find(e=>e?.value?.decimal==='5');
  assert.deepEqual(write.target,old.target);assert.equal(write.value.decimal,'11');
  for(const [name,oldValue,newValue,result]of [['postfix','3','4','6'],['prefix','4','5','10']]){
    const work=r.work(r.frames(name)[0]),calcs=work.filter(e=>e.kind==='CALC');
    assert.deepEqual(calcs.map(e=>e.value.decimal),[newValue,result]);
    const mul=calcs[1],input=mul.inputs.find(i=>i.executionId),write=work.find(e=>e.action==='write');
    assert.equal(write.value.decimal,newValue);assert.equal(input.value.decimal,name==='postfix'?oldValue:newValue);
    assert.equal(r.events.get(input.executionId).kind,name==='postfix'?'READ':'CALC');
  }
  for(const [index,f]of r.frames('selected').entries()){
    const calc=r.calcs(f).at(-1),input=calc.inputs.find(i=>i.executionId);
    assert.equal(input.value.decimal,index?'3':'4');assert.equal(input.value.cType.name,'int');
    assert.equal(calc.inputEvaluations[0].selected,index?'false':'true');
  }
});

test('calls remain real boundaries while their return values feed one surrounding CALC',async()=>{
  const r=await inspect(String.raw`#include <stdio.h>
int leaf(int *p,int n){*p+=n;return *p;}
int chain(int *p,int a){return (a+1)+leaf(p,a+2)*2;}
int twice(int *p){return leaf(p,1)*2+leaf(p,2)*3;}
int recur(int n){if(n==0)return 2;return (n+1)+recur(n-1)*2;}
int check(int a,int *p){return (a+1>0)&&leaf(p,1)>0;}
int main(void){int p=0;printf("%d ",chain(&p,3));printf("%d ",twice(&p));
printf("%d ",recur(2));printf("%d ",check(-2,&p));printf("%d ",check(0,&p));printf("%d\n",p);return 0;}`,
  '14 36 15 0 1 9\n');
  for(const name of ['chain','twice']){
    const work=r.work(r.frames(name)[0]),outer=r.calcs(r.frames(name)[0]).filter(e=>r.defs.get(e.instructionId).expression?.children?.some(n=>n.kind==='CallExpr')||r.defs.get(e.instructionId).source.expression.includes('leaf('));
    assert.equal(outer.length,1,`${name} has one completed consuming expression`);
    assert.equal(outer[0].phase,'complete');assert.equal(outer[0].value.decimal,name==='chain'?'14':'36');
    const resumes=work.filter(e=>e.action==='resume');assert.equal(resumes.length,name==='chain'?1:2);
    assert.ok(resumes.every(e=>work.indexOf(e)<work.indexOf(outer[0])));
    assert.equal(outer[0].inputs.filter(i=>r.events.get(i.executionId)?.action==='resume').length,resumes.length);
  }
  for(const f of r.frames('recur').slice(0,2)){
    const groups=r.calcs(f).filter(e=>r.defs.get(e.instructionId).source.expression.includes('recur('));
    assert.equal(groups.length,1);assert.equal(groups[0].phase,'complete');
  }
  const checks=r.frames('check');
  assert.equal(r.work(checks[0]).filter(e=>e.action==='call').length,0);
  assert.equal(r.work(checks[1]).filter(e=>e.action==='call').length,1);
});

test('a failure inside a called operand never completes its waiting caller calculation',async()=>{
  const r=await traceModel('int bad(int *p){return p[1];} int f(int n){int a[1]={3};return (n+1)+bad(a)*2;} int main(void){return f(2);}');
  assert.equal(r.trace.status,'fault');
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  const caller=r.trace.events.filter(e=>e.kind==='CALC'&&defs.get(e.instructionId)?.source?.expression==='(n+1)+bad(a)*2');
  assert.equal(caller.length,1);assert.equal(caller[0].phase,'failed');assert.equal(caller[0].value,undefined);
});

test('selected operand display types preserve unsigned and floating representations',async()=>{
  const r=await inspect(String.raw`#include <stdio.h>
unsigned f(unsigned a,unsigned b,int k){return (k?a:b)+1U;}
double g(double a,double b,int k){return (k?a:b)*2.0;}
int main(void){printf("%u %g\n",f(5U,8U,0),g(1.5,2.5,1));return 0;}`,'9 3\n');
  const u=r.calcs(r.frames('f')[0]).at(-1).inputs.find(i=>i.executionId);
  assert.equal(u.value.decimal,'8');assert.equal(u.value.cType.signedness,'unsigned');
  const d=r.calcs(r.frames('g')[0]).at(-1).inputs.find(i=>i.executionId),read=r.events.get(d.executionId);
  assert.equal(d.value.type,read.value.type);assert.equal(d.value.bits,read.value.bits);
  assert.equal(d.value.cType.name,'double');
});

test('direct logical operands keep each evaluated READ in guards and materialized results',async()=>{
  const r=await inspect(`#include <stdio.h>
int guard(int p,int q){if(p&&q)return 1;return 0;}
int value(int p,int q){return p||q;}
int repeat(int p,int q){int n=0;while(p&&q){++n;--p;}return n;}
int main(void){printf("%d %d %d %d %d\\n",guard(2,7),guard(0,7),value(0,9),value(4,9),repeat(2,3));return 0;}`,'1 0 1 1 2\n');
  for(const [name,op,values]of [['guard','&&',[['2','7'],['0']]],['value','||',[['0','9'],['4']]]]){
    for(const [index,frame]of r.frames(name).entries()){
      const calc=r.calcs(frame);assert.equal(calc.length,1);assert.equal(calc[0].operator,op);
      const inputs=calc[0].inputs.filter(i=>i.executionId);
      assert.deepEqual(inputs.map(i=>i.value.decimal).sort(),values[index].sort());
      assert.equal(inputs.length,r.work(frame).filter(e=>e.kind==='READ').length);
    }
  }
  const guards=r.calcs(r.frames('repeat')[0]).filter(e=>e.operator==='&&');assert.equal(guards.length,3);
  assert.deepEqual(guards.map(e=>e.inputs.filter(i=>i.executionId).map(i=>i.value.decimal).sort()),[['2','3'],['1','3'],['0']]);
  const consumed=new Set();for(const e of guards)for(const i of e.inputs.filter(i=>i.executionId)){
    assert.ok(!consumed.has(i.executionId),'previous iteration READ must not become a current operand');consumed.add(i.executionId);
  }
  const original=guards[0];
  for(const change of [e=>{e.inputs=e.inputs.slice(1);},e=>{delete e.operator;},e=>{e.inputs=[];e.dataInputs=[];e.steps=[];}]){
    const trace=structuredClone(r.trace),copy=trace.events.find(e=>e.eventId===original.eventId);change(copy);
    assert.throws(()=>validateCalcTrace(r.plan,trace),/CALC 계약 위반/);
  }
  const plan=structuredClone(r.plan);delete plan.instructions.find(d=>d.id===original.instructionId).operator;
  assert.throws(()=>validateCalcPlan(plan),/CALC 계약 위반/);
});

test('single folded short circuits and folded arithmetic retain compiler operands',async()=>{
  const r=await inspect(`#include <stdio.h>
int hit(void){return 9;}
int main(void){int a=0&&hit(),b=2||hit(),c=(2+3)*4;printf("%d %d %d\\n",a,b,c);return 0;}`,'0 1 20\n');
  const cs=r.trace.events.filter(e=>e.kind==='CALC');
  assert.deepEqual(cs.filter(e=>['&&','||'].includes(e.operator)).map(e=>e.inputs.map(i=>i.value.literal)),[['0'],['2']]);
  assert.equal(r.trace.events.filter(e=>e.action==='call'&&e.callee==='@hit').length,0);
  const folded=cs.find(e=>e.operator==='*');assert.equal(folded.inputs.length,3);
  const trace=structuredClone(r.trace),broken=trace.events.find(e=>e.eventId===folded.eventId);
  broken.inputs=broken.inputs.slice(1);broken.steps=[];
  assert.throws(()=>validateCalcTrace(r.plan,trace),/CALC 계약 위반/);
});
