import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateCalcTrace} from '../scripts/model/calc-contract.mjs';

async function inspect(code){
  const r=await traceModel(code,{includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),events=new Map(r.trace.events.map(e=>[e.eventId,e])),
    pos=new Map(r.trace.events.map((e,i)=>[e.eventId,i]));
  for(const e of r.trace.events)for(const k of ['dataInputs','addressInputs','controlInputs','calleeInputs'])
    for(const id of e[k])assert.ok(pos.get(id)<pos.get(e.eventId),`${e.eventId} consumes future ${id}`);
  return {...r,defs,events,pos};
}
const number=e=>Number(e.value.decimal);
const expr=(r,e)=>r.defs.get(e.instructionId)?.source?.expression;

test('materialized AND/OR results preserve exact evaluated operands across postfix, prefix and compound mutation',async()=>{
  const cases=[[0,0,0],[0,1,0],[1,0,0],[1,1,0],[1,1,2],[1,1,3]],
    variants=[['post','a&&b&&c++<3','c++','&&'],['pre','a&&b&&++c<3','++c','&&'],
      ['either','a||b||c++<3','c++','||'],['assign','a&&b&&(c+=2)>2','c+=2','&&']],
    calls=variants.flatMap(([name])=>cases.map(args=>`${name}(${args.join(',')});`)).join('');
  const r=await inspect(`${variants.map(([name,expression])=>`int ${name}(int a,int b,int c){int z=${expression};return z*10+c;}`).join('\n')}
int main(void){${calls}return 0;}`);
  for(const [name,expression,mutation,operator]of variants)for(const [index,f]of r.trace.frames.filter(f=>f.functionName===name).entries()){
    const [a,b,c]=cases[index],readsB=operator==='&&'?!!a:!a,updates=operator==='&&'?!!(a&&b):!(a||b),
      newC=c+(updates?(name==='assign'?2:1):0),yielded=name==='pre'||name==='assign'?newC:c,
      last=name==='assign'?yielded>2:yielded<3,expected=operator==='&&'?!!(a&&b&&last):!!(a||b||last),
      work=r.trace.events.filter(e=>e.activationId===f.id),groups=work.filter(e=>e.kind==='CALC'&&expr(r,e)===expression);
    assert.equal(groups.length,1,expression);const g=groups[0];assert.equal(number(g),+expected);
    assert.equal(g.evaluation.right,updates?'evaluated':'skipped');
    assert.equal(number(work.find(e=>e.action==='return.value')),10*expected+newC);
    const operands=work.filter(e=>e.kind==='READ'&&['a','b',mutation].includes(expr(r,e)));
    assert.deepEqual(operands.map(e=>expr(r,e)),['a',...(readsB?['b']:[]),...(updates?[mutation]:[])]);
    const mutations=work.filter(e=>e.action==='write'&&expr(r,e)===mutation);assert.equal(mutations.length,+updates);
    const consumed=new Set(g.inputs.map(i=>i.executionId));
    for(const read of operands.filter(e=>expr(r,e)!==mutation))assert.ok(consumed.has(read.eventId));
    if(updates){
      assert.equal(number(mutations[0]),newC);assert.ok(r.pos.get(mutations[0].eventId)<r.pos.get(g.eventId));
      const origin=name==='post'||name==='either'?operands.at(-1):work.find(e=>e.kind==='CALC'&&expr(r,e)===mutation);
      assert.ok(g.inputs.some(i=>i.executionId===origin.eventId&&Number(i.value.decimal)===yielded));
    }
    // Removing a condition input must still fail; control dependencies cannot
    // be used as a substitute for the CALC's own operands.
    const copy=structuredClone(r.trace),bad=copy.events.find(e=>e.eventId===g.eventId);
    bad.inputs=bad.inputs.filter(i=>i.executionId!==operands[0].eventId);
    assert.throws(()=>validateCalcTrace(r.plan,copy),/CALC 계약 위반/);
  }
});

test('mixed nested calls and assignment retain one parent result and actual side effect order',async()=>{
  const r=await inspect(`int tally;
int mark(int x){tally++;return x;}
int choose(int a,int b){int v=0;int z=(a||mark(b))&&((v=mark(2))>1);return z*100+tally*10+v;}
int main(void){choose(0,0);choose(0,1);choose(1,0);return 0;}`),
    frames=r.trace.frames.filter(f=>f.functionName==='choose');
  for(const [index,f]of frames.entries()){
    const work=r.trace.events.filter(e=>e.activationId===f.id),groups=work.filter(e=>e.kind==='CALC'&&expr(r,e)==='(a||mark(b))&&((v=mark(2))>1)');
    assert.equal(groups.length,1);assert.equal(number(work.find(e=>e.action==='return.value')),[10,132,142][index]);
    assert.equal(work.filter(e=>e.action==='call'&&e.callee==='@mark').length,[1,2,1][index]);
    const writes=work.filter(e=>e.action==='write'&&expr(r,e)==='v=mark(2)');assert.equal(writes.length,index?1:0);
    for(const w of writes)assert.ok(r.pos.get(w.eventId)<r.pos.get(groups[0].eventId));
    assert.equal(groups[0].evaluation.right,index?'evaluated':'skipped');
  }
});

test('repeated logical mutations use current iteration inputs and exclude unrelated outer guards',async()=>{
  const r=await inspect(`int main(void){int a[4]={1,0,1,1},b[4]={1,1,0,1};int n=0,sum=0,gate=1;
for(int i=0;i<4;i++){if(gate){int z=a[i]&&b[i]&&n++<2;sum+=z;}}
return sum*10+n;}`);
  assert.equal(r.trace.exitCode,22);
  const groups=r.trace.events.filter(e=>e.kind==='CALC'&&expr(r,e)==='a[i]&&b[i]&&n++<2');
  assert.deepEqual(groups.map(number),[1,0,0,1]);
  assert.deepEqual(groups.map(e=>e.evaluation.right),['evaluated','skipped','skipped','evaluated']);
  const used=new Set();for(const g of groups){const reads=g.inputs.filter(i=>r.events.get(i.executionId)?.kind==='READ');
    for(const input of reads){assert.ok(!used.has(input.executionId));used.add(input.executionId);assert.notEqual(expr(r,r.events.get(input.executionId)),'gate');}
  }
  assert.deepEqual(r.trace.events.filter(e=>e.action==='write'&&expr(r,e)==='n++').map(number),[1,2]);
});

test('pointer guards keep the original pointer operand and skip invalid dereferences and updates',async()=>{
  const expression='q&&q->key!=want&&steps++<limit',r=await inspect(`typedef struct N{int key;struct N*next;}N;
int scan(N*q,int want,int limit){int steps=0;while(${expression})q=q->next;return steps;}
int main(void){N node={7,0};scan(0,8,4);scan(&node,7,4);scan(&node,8,4);scan(&node,8,0);return 0;}`),
    outcomes=[[0],[0],[1,0],[0]],operandNames=[[['q']],[['q','q->key','want']],
      [['q','q->key','want','steps++','limit'],['q']],[['q','q->key','want','steps++','limit']]];
  for(const [i,f]of r.trace.frames.filter(f=>f.functionName==='scan').entries()){
    const work=r.trace.events.filter(e=>e.activationId===f.id),groups=work.filter(e=>e.kind==='CALC'&&expr(r,e)===expression);
    assert.deepEqual(groups.map(number),outcomes[i]);
    assert.deepEqual(groups.map(g=>g.inputs.filter(x=>x.executionId).map(x=>expr(r,r.events.get(x.executionId))).sort()),operandNames[i].map(a=>a.toSorted()));
    assert.deepEqual(work.filter(e=>e.action==='write'&&expr(r,e)==='steps++').map(number),i<2?[]:[1]);
    assert.equal(number(work.find(e=>e.action==='return.value')),i<2?0:1);
  }
});
