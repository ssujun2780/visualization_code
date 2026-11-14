import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {validateIRPlan,validateIRTrace} from '../scripts/model/ir-schema.mjs';
import {orderEvaluationLLVM,validateEvaluationOrderPlan} from '../scripts/model/evaluation-order.mjs';

const prelude=`#include <stdio.h>
int log_value;
int mark(int n){log_value=log_value*10+n;printf("%d",n);return n;}
void consume(int a,int b){printf(" [%d,%d]\\n",a,b);}
`;
async function inspect(source,stdout,options={}){
  const r=await traceModel(source,{timeoutMs:30000,includeObservations:true,...options});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,stdout);assert.deepEqual(r.trace.coverage.irGaps,[]);
  assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  validateIRPlan(r.plan);validateIRTrace(r.plan,r.trace);
  assert.equal(r.plan.evaluationOrder.enforcedAt,'executable-llvm-before-observation');
  assert.equal(r.plan.evaluationOrder.sourceRewrites,0);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  // The recorder must report the actual executable order. Moving field cleanup
  // is allowed; moving calls or memory effects after execution is not.
  const definitions=new Map(r.plan.instructions.map(i=>[i.id,i])),
    raw=r.observations.trace.events.filter(e=>e.action==='call.begin'&&!e.external).map(e=>e.callee),
    visible=r.trace.events.filter(e=>e.action==='call'&&!definitions.get(e.instructionId)?.external).map(e=>e.callee);
  assert.deepEqual(visible,raw);
  for(const arg of r.trace.events.filter(e=>e.action==='argument'))for(const input of arg.inputs??[])
    if(input.executionId)assert.ok(r.trace.events.findIndex(e=>e.eventId===input.executionId)<r.trace.events.indexOf(arg));
  return r;
}

test('default order covers nested calls and shared-state effects with actual argument producers',async()=>{
  const r=await inspect(prelude+`int pair(int a,int b){return 10*a+b;}
int main(void){consume(mark(1),pair(mark(2),mark(3)));consume(mark(4),log_value);return 0;}`,
    '123 [1,23]\n4 [4,1234]\n');
  assert.equal(r.plan.evaluationOrder.default,'left-to-right');
  assert.ok(r.plan.instructions.some(i=>i.action==='call'&&i.evaluationOrder));
});

test('assignment evaluates target address before RHS, then commits the value',async()=>{
  const r=await inspect(prelude+`int cells[8];
int main(void){cells[mark(1)]=mark(2);printf(" %d\\n",cells[1]);return 0;}`,'12 2\n');
  assert.ok(r.plan.evaluationOrder.transformations.length>0,'the backend RHS-first order must actually change');
  const writes=r.trace.events.filter(e=>e.kind==='WRITE'&&e.value?.decimal==='2'&&e.target),
    right=r.trace.events.find(e=>e.action==='call'&&e.callee==='@mark'&&e.inputs?.some(i=>i.value?.decimal==='2'));
  assert.ok(writes.some(w=>r.trace.events.indexOf(w)>r.trace.events.indexOf(right)));
});

test('moving complete conditional operand regions preserves branches and PHI values',async()=>{
  const r=await inspect(prelude+`int cells[2];
int* choose(int n){mark(n);return &cells[0];}
int main(void){*(mark(1)?choose(5):choose(6))=(mark(2)?mark(3):mark(4));
printf(" %d\\n",cells[0]);return 0;}`,'1523 3\n');
  assert.ok(r.plan.evaluationOrder.transformations.length>0);
});

test('logical short circuit, conditional selection, comma and unevaluated operands remain C constraints',async()=>{
  await inspect(prelude+`int main(void){
consume(mark(0)&&mark(9),mark(1)||mark(8));
consume((mark(1),mark(2)),mark(0)?mark(8):mark(3));
consume(sizeof(mark(7)),_Generic(0,int:mark(4),default:mark(6)));
return 0;}`,'01 [0,1]\n1203 [2,3]\n4 [4,4]\n');
});

test('explicit reverse order changes execution but never reverses required sequencing',async()=>{
  const r=await inspect(prelude+`int main(void){
consume(mark(0)&&mark(9),mark(1)||mark(8));
consume((mark(1),mark(2)),mark(0)?mark(8):mark(3));return 0;}`,
    '10 [0,1]\n0312 [2,3]\n',{evaluationOrder:'right-to-left'});
  assert.equal(r.plan.evaluationOrder.origin,'explicit-option');
  const bad=structuredClone(r.plan),g=bad.evaluationOrder.groups.find(g=>g.reason==='c-language'&&g.order);
  g.order.reverse();assert.throws(()=>validateIRPlan(bad),/필수 평가 순서/);
});

test('function designator and arguments use the same policy for indirect calls',async()=>{
  await inspect(prelude+`typedef void (*F)(int,int);F target(void){mark(7);return consume;}
int main(void){target()(mark(1),mark(2));return 0;}`,'712 [1,2]\n');
});

test('aggregate argument and return ABI work retain order and values',async()=>{
  await inspect(prelude+`typedef struct{int x,y;} S;
S make(int n){mark(n);S result={n,n+10};return result;}
void use(S a,S b){printf(" [%d,%d,%d,%d]\\n",a.x,a.y,b.x,b.y);}
int main(void){use(make(1),make(2));return 0;}`,'12 [1,11,2,12]\n');
});

test('compound literal initialization precedes ABI loads across argument regions',async()=>{
  // A single-field aggregate is passed as a scalar by the ABI. Its load must
  // still depend on initialization, even when the SSA address already exists.
  for(const type of ['int','long long']){
    const code=prelude+`typedef struct {${type} value;} Packet;
${type} extract(Packet p){return p.value;}
int main(void){consume(extract((Packet){mark(1)}),extract((Packet){mark(2)}));return 0;}`;
    for(const evaluationOrder of ['left-to-right','right-to-left']){
      await inspect(code,evaluationOrder==='left-to-right'?'12 [1,2]\n':'21 [1,2]\n',{evaluationOrder});
    }
  }
});

test('repeated expressions, recursion and macro-expanded calls retain operand identities',async()=>{
  await inspect(prelude+`#define APPLY(a,b) consume((a),(b))
int descend(int n){if(!n)return 0;return mark(n)+descend(n-1);}
int main(void){for(int i=0;i<2;i++)APPLY(mark(1),mark(2));consume(descend(3),mark(4));return 0;}`,
    '12 [1,2]\n12 [1,2]\n3214 [6,4]\n');
});

test('compound assignment and nested target selection do not duplicate evaluations',async()=>{
  await inspect(prelude+`int cells[8]={0,10};
int main(void){cells[mark(1)]+=mark(2);printf(" %d\\n",cells[1]);return 0;}`,'12 12\n');
});

test('compound left value is captured before a called RHS changes the same object',async()=>{
  await inspect(prelude+`int value=10;
int replace(void){mark(2);value=100;return 3;}
int main(void){value+=replace();printf(" %d\\n",value);return 0;}`,'2 13\n');
});

test('global record-array recursion preserves the complete address dependency chain',async()=>{
  const code=`#include <stdio.h>
typedef struct{int z,c[2];}R;R q[4]={{3,{1,2}},{5,{-1,-1}},{7,{-1,-1}}};
int f(int k){if(k<0)return 0;return q[k].z+f(q[k].c[0])+f(q[k].c[1]);}
int main(void){printf("%d\\n",f(0));return 0;}`;
  for(const evaluationOrder of ['left-to-right','right-to-left'])await inspect(code,'15\n',{evaluationOrder});
});

test('constant and computed subscripts work across arrays, records and pointer bases',async()=>{
  await inspect(`#include <stdio.h>
typedef struct {int pad,c[2];struct {int d;} inner;} R;
R q[3]={{0,{4,8},{9}},{0,{12,16},{17}}};int plain[3]={2,3,5},grid[2][2]={{1,6},{7,11}};
int from_pointer(R*p,int i,int j){return p[i].c[j];}
int main(void){int k=1,j=1;printf("%d %d %d %d %d %d\\n",plain[k],q[k].c[0],q[k].c[j],q[k].inner.d,grid[k][0],from_pointer(q,k,j));return 0;}`,
    '3 12 16 17 7 16\n');
});

test('nested address computations preserve dependencies and still order independent side effects',async()=>{
  await inspect(prelude+`typedef struct {long padding;struct {int entries[3];} group;} Cell;Cell table[3];
int main(void){table[mark(1)].group.entries[mark(2)]=mark(3);printf(" %d\\n",table[1].group.entries[2]);return 0;}`,'123 3\n');
});

// These compiler-level fixtures exercise value reuse across operand regions,
// which an unoptimized frontend need not produce for any particular C sample.
function schedulingFixture({dependencies=true,interleaved=false,externalControl=false}={}){
  const source=(start,end=start)=>({file:'/main.c',start:{line:1,column:start},end:{line:1,column:end}}),
    children=['callee','left','right','independent'].map((id,i)=>({id,kind:'DeclRefExpr',details:'',source:source(i*10+1),children:[],depth:1,functionName:'main'})),
    root={id:'expression',kind:'CallExpr',details:'',source:source(1,40),children,depth:0,functionName:'main'};
  for(const n of children)n.parent=root;
  const instructions=[
    {text:'%independent = add i32 1, 1',node:'independent'},
    {text:'%right = add i32 2, 2',node:'right'},
    {text:dependencies?'%left = mul i32 %right, 3':'%left = mul i32 4, 3',node:'left'},
    ...(interleaved?[{text:'%again = add i32 %right, 1',node:'right'}]:[]),
  ];
  const body=externalControl?['entry:','  br label %right_block','independent_block:',
    '  '+instructions[0].text,'  br label %left_block','right_block:','  '+instructions[1].text,
    '  br label %independent_block','left_block:','  '+instructions[2].text]:instructions.map(i=>'  '+i.text),
    llvm=['define i32 @main() {',...body,'  ret i32 %left','}'].join('\n'),
    observations={functions:[{id:'fn',name:'main'}],instructions:instructions.map(i=>({functionId:'fn',backendInstruction:i.text,
      action:i.text.startsWith('br ')?'branch':'calculate',semanticNodeId:i.node}))};
  return {llvm,observations,nodes:[root,...children]};
}

test('mandatory SSA dependencies precede direction preference; independent regions can still move',()=>{
  const {llvm,observations,nodes}=schedulingFixture(),r=orderEvaluationLLVM(llvm,observations,nodes),g=r.policy.groups[0];
  assert.deepEqual(g.order,[0,1,2,3]);assert.deepEqual(g.effectiveOrder,[0,2,1,3]);
  assert.deepEqual(g.observedOperands,[2,1,3]);
  assert.ok(r.llvm.indexOf('%right =')<r.llvm.indexOf('%left ='));
  assert.ok(r.llvm.indexOf('%left =')<r.llvm.indexOf('%independent ='));
  assert.deepEqual(g.constraints,[{before:2,after:1,value:'%right',kind:'ssa-dependency'}]);
  validateEvaluationOrderPlan({evaluationOrder:r.policy});
  const bad=structuredClone(r.policy);bad.groups[0].effectiveOrder=[0,1,2,3];
  assert.throws(()=>validateEvaluationOrderPlan({evaluationOrder:bad}),/필수 값 의존성/);
});

test('dependency-constrained original order is retained rather than rejected',()=>{
  const f=schedulingFixture(),nodes=f.nodes;nodes[0].children=nodes[0].children.slice(0,3);
  const r=orderEvaluationLLVM(f.llvm,f.observations,nodes),g=r.policy.groups[0];
  assert.equal(r.llvm,f.llvm);assert.equal(g.preservedBecause,'mandatory-dependencies');
  assert.deepEqual(g.effectiveOrder,[0,2,1]);assert.equal(r.policy.transformations.length,0);
});

test('unseparable or external-control regions retain compiler execution with explicit metadata',()=>{
  for(const [options,reason]of [[{interleaved:true},'interleaved-operand-regions'],[{externalControl:true},'external-control-flow']]){
    const f=schedulingFixture(options),r=orderEvaluationLLVM(f.llvm,f.observations,f.nodes),g=r.policy.groups[0];
    assert.equal(r.llvm,f.llvm);assert.equal(g.status,'compiler-order-preserved');assert.equal(g.preservedBecause,reason);
    if(options.interleaved)assert.equal(g.effectiveOrder,null);
  }
});

test('address consumers propagate through LLVM helpers without observation metadata',()=>{
  const source=column=>({file:'/main.c',start:{line:1,column},end:{line:1,column}}),
    base={id:'base',kind:'DeclRefExpr',source:source(1),children:[],depth:1,functionName:'main'},
    index={id:'index',kind:'DeclRefExpr',source:source(7),children:[],depth:1,functionName:'main'},
    root={id:'address',kind:'ArraySubscriptExpr',source:{...source(1),end:{line:1,column:8}},children:[base,index],depth:0,functionName:'main'};
  base.parent=root;index.parent=root;
  const instructions=[
    ['%index = add i32 0, 1','index','calculate'],
    ['%address = getelementptr [8 x i32], [8 x i32]* @items, i32 0, i32 %index','address','address'],
    ['%cast = bitcast i32* %address to i8*',null,null],
    ['%back = bitcast i8* %cast to i32*',null,'address'],
    ['%loaded = load i32, i32* %back','address','load'],
  ],llvm=['@items = global [8 x i32] zeroinitializer','define i32 @main() {',...instructions.map(([text])=>'  '+text),'  ret i32 %loaded','}'].join('\n'),
    observations={functions:[{id:'fn',name:'main'}],instructions:instructions.filter(i=>i[2]).map(([text,node,action])=>({
      functionId:'fn',backendInstruction:text,semanticNodeId:node,action,source:{file:'main.c',line:1,column:1}}))};
  const r=orderEvaluationLLVM(llvm,observations,[root,base,index]);
  assert.equal(r.llvm,llvm);assert.equal(r.policy.transformations.length,0);
  assert.equal(r.policy.groups[0].status,'no-competing-runtime-operands');
  assert.deepEqual(r.policy.groups[0].observedOperands,[1]);
});
