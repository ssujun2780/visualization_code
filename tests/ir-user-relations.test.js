import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile,mkdir} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {defineStructureRelation,queryStructureRelations,queryStructureConditions,setStructurePresentation,
  resolveStructurePresentation,clearStructurePresentation} from '../scripts/inference/index.mjs';

const type={name:'int',sizeBits:32,signedness:'signed'};
function recorded(){
  const trace={programId:'mapping-contract',runId:'run1',backend:'instrumented-wasm',events:[],objects:[],structures:[]};
  const event=e=>{const eventId=`x${trace.events.length+1}`;trace.events.push({eventId,phase:'complete',...e});return eventId;};
  const allocate=(size,cType=null)=>{const id=`o${trace.objects.length+1}`,createdBy=event({kind:'SPACE',action:'object.begin',objectId:id});
    trace.objects.push({id,size,cType,createdBy,endedBy:null});return id;};
  const write=(objectId,offset,value,size=4,extra={})=>event({kind:'WRITE',action:'write',target:{objectId,offset,size},
    value:{bits:`0x${BigInt.asUintN(size*8,BigInt(value)).toString(16)}`,cType:type,...extra}});
  const array=values=>{const id=allocate(values.length*4,{kind:'array',count:values.length,elementType:type});values.forEach((v,i)=>write(id,i*4,v));return id;};
  const end=id=>{const e=event({kind:'SPACE',action:'object.end',objectId:id});trace.objects.find(o=>o.id===id).endedBy=e;return e;};
  const mark=()=>event({kind:'FLOW',action:'mark'});
  return {trace,event,allocate,write,array,end,mark};
}
const relation=(trace,relationBinding,afterExecutionId,extra={})=>queryStructureRelations(trace,{relationBinding,afterExecutionId,...extra}).relations[0];
const check=(trace,relationBinding,afterExecutionId,expected='tree',extra={})=>queryStructureConditions(trace,{relationBinding,afterExecutionId,expected,...extra});
const pairs=r=>r.edges.map(e=>[r.nodes.find(n=>n.id===e.from).index,r.nodes.find(n=>n.id===e.to).index,e.roleId]).sort();
function separated(){
  const r=recorded(),data=r.array([90,10,80,20,70,30]),a=r.array([3,-7,0,-7,-7,-7]),b=r.array([-7,-7,5,-7,-7,-7]),root=r.array([2]);
  const spec={nodes:{kind:'array',objectId:data},roots:[{kind:'index',source:{kind:'slot',objectId:root,size:4},nullValues:[-7]}],links:[
    {id:'branch-A',kind:'index',source:{kind:'array',objectId:a},nullValues:[-7]},
    {id:'branch-B',kind:'index',source:{kind:'array',objectId:b},nullValues:[-7]}]};
  return {...r,data,a,b,root,binding:defineStructureRelation(r.trace,spec)};
}

test('independent source topology: nonzero root, unused capacity, shared child, cycle, repair, empty and past state',()=>{
  const s=separated(),{trace:t,binding:b}=s,A=s.mark();
  s.write(s.b,0,5);const B=s.mark();s.write(s.b,0,-7);s.write(s.a,12,2);const C=s.mark();
  s.write(s.a,12,-7);const D=s.mark();s.write(s.root,0,-7);const E=s.mark();const before=JSON.stringify(t);
  const expected=[[0,3,'branch-A'],[2,0,'branch-A'],[2,5,'branch-B']].sort();
  assert.deepEqual(pairs(relation(t,b,A)),expected);assert.deepEqual(pairs(relation(t,b,D)),expected);
  assert.deepEqual(relation(t,b,A).nodes.map(n=>n.index).sort(),[0,2,3,5]);
  assert.equal(relation(t,b,A).terminals.length,5);assert.equal(check(t,b,A).assessment,'satisfied-observed');
  assert.ok(check(t,b,B).warnings.some(w=>w.code==='multiple-parents'));assert.ok(check(t,b,C).warnings.some(w=>w.code==='relation-cycle'));
  assert.equal(check(t,b,D).assessment,'satisfied-observed');assert.equal(relation(t,b,E).nodes.length,0);
  assert.equal(check(t,b,E).assessment,'satisfied-observed');assert.equal(JSON.stringify(t),before);
  const returned=relation(t,b,A);returned.nodes[0].range.offset=999;assert.deepEqual(pairs(relation(t,b,A)),expected);
});

test('unknown, known invalid, query caps, roles, exact large integers and object lifetimes remain distinct',()=>{
  const s=separated(),{trace:t,binding:b}=s,A=s.mark();
  s.write(s.a,8,99);const B=s.mark();s.event({kind:'WRITE',target:{objectId:s.a,offset:8,size:4},initializationEvidence:'unobserved'});const C=s.mark();
  assert.equal(check(t,b,B).assessment,'contradicted');assert.ok(check(t,b,B).warnings.some(w=>w.code==='relation-index-out-of-range'));
  assert.equal(check(t,b,C).assessment,'incomplete');assert.equal(check(t,b,A,'tree',{roleIds:['absent']}).assessment,'incomplete');
  for(const relationLimits of [{maxNodes:2},{maxEdges:2}]){assert.equal(check(t,b,A,'tree',{relationLimits}).assessment,'incomplete');assert.equal(relation(t,b,A,{relationLimits}).coverage.limited,true);}
  assert.equal(check(t,b,t.events[0].eventId).assessment,'incomplete');const ended=s.end(s.data);assert.equal(check(t,b,ended).assessment,'ended');
  const wide=recorded(),data=wide.array([1,2]),links=wide.allocate(16),r=wide.allocate(8);
  wide.write(links,0,'9007199254740994',8);wide.write(links,8,'18446744073709551615',8);wide.write(r,0,'9007199254740993',8);
  const binding=defineStructureRelation(wide.trace,{nodes:{kind:'array',objectId:data},roots:[{kind:'index',source:{kind:'slot',objectId:r,size:8},signed:false,indexBase:'9007199254740993'}],
    links:[{id:'one',kind:'index',source:{kind:'array',objectId:links,size:8},signed:false,indexBase:'9007199254740993',nullValues:['18446744073709551615']}]});
  assert.deepEqual(pairs(relation(wide.trace,binding,wide.mark())),[[0,1,'one']]);
});

test('interleaved link columns, field offsets, multiple roots, explicit empty root and schema validation',()=>{
  const r=recorded(),data=r.array([5,6,7]),links=r.array([11,-8,-8,-8,-8,-8]);
  const spec={nodes:{kind:'array',objectId:data},roots:[{kind:'index',value:10,indexBase:10},{kind:'index',value:12,indexBase:10}],links:[
    {id:'x',kind:'index',source:{kind:'array',objectId:links,size:4,stride:8,count:3},indexBase:10,nullValues:[-8]},
    {id:'y',kind:'index',source:{kind:'array',objectId:links,offset:4,size:4,stride:8,count:3},indexBase:10,nullValues:[-8]}]};
  const b=defineStructureRelation(r.trace,spec),at=r.mark();assert.equal(check(r.trace,b,at,'forest').assessment,'satisfied-observed');assert.equal(check(r.trace,b,at).assessment,'contradicted');
  assert.equal(relation(r.trace,defineStructureRelation(r.trace,{...spec,roots:[]}),at).nodes.length,0);
  assert.throws(()=>defineStructureRelation({...r.trace,runId:'other'},b),/다른 실행/);
  assert.throws(()=>defineStructureRelation(r.trace,{...spec,nodes:{kind:'array',objectId:data,count:9}}),/범위/);
  assert.throws(()=>defineStructureRelation(r.trace,{...spec,links:[spec.links[0],spec.links[0]]}),/고유/);
  assert.throws(()=>defineStructureRelation(r.trace,{...spec,roots:[{kind:'index',value:Number.MAX_SAFE_INTEGER+1}]}),/정확한 정수/);
  const rows=r.allocate(36);[10,1,-1,20,2,-1,30,-1,-1].forEach((n,i)=>r.write(rows,i*4,n));
  const f=defineStructureRelation(r.trace,{nodes:{kind:'array',objectId:rows,size:12,stride:12,count:3},roots:[{kind:'index',value:0}],
    links:[{id:'next',kind:'index',source:{kind:'field',offset:4,size:4},nullValues:[-1]}]});
  assert.deepEqual(pairs(relation(r.trace,f,r.mark())),[[0,1,'next'],[1,2,'next']]);
});

test('manual preference is persistent, scoped, JSON-safe and does not forge inferred or BST evidence',()=>{
  const s=separated(),at=s.mark(),target={objectId:s.data},before=JSON.stringify(s.trace);
  let p=setStructurePresentation(null,s.trace,{target,view:'tree',relationBinding:s.binding});p=JSON.parse(JSON.stringify(p));
  const r=resolveStructurePresentation(s.trace,{target,preferences:p,afterExecutionId:at});
  assert.equal(r.mode,'manual');assert.equal(r.relationView.relations[0].nodes.length,4);assert.equal(r.expectationCheck.assessment,'satisfied-observed');assert.deepEqual(r.recommendations,[]);
  assert.equal(check(s.trace,s.binding,at,'bst-order').assessment,'not-checkable');
  const custom=setStructurePresentation(p,s.trace,{target,slot:'custom',view:'custom:diagram',expected:null,relationBinding:s.binding});
  assert.equal(resolveStructurePresentation(s.trace,{target,slot:'custom',preferences:custom,afterExecutionId:at}).relationView.relations[0].edges.length,3);
  assert.equal(check(s.trace,s.binding,at,'custom:rule').assessment,'not-checkable');
  s.write(s.a,12,2);const corrupt=s.mark();assert.equal(resolveStructurePresentation(s.trace,{target,preferences:p,afterExecutionId:corrupt}).view,'tree');
  assert.equal(resolveStructurePresentation(s.trace,{target,preferences:p,afterExecutionId:corrupt}).expectationCheck.assessment,'contradicted');
  const cleared=clearStructurePresentation(custom,s.trace,{target});assert.equal(cleared.overrides.length,1);
  assert.equal(resolveStructurePresentation({...s.trace,runId:'new'}, {target,preferences:p,afterExecutionId:at}).mode,'auto');
  assert.equal(before,JSON.stringify({...s.trace,events:s.trace.events.slice(0,-2)}));
});

const artifacts=new URL('../test-results/manual-relations-2026-11-12/',import.meta.url);
async function execute(name,source,stdout){
  const r=await traceModel(source,{filename:`${name}.c`});
  await mkdir(artifacts,{recursive:true});await writeFile(new URL(`${name}.c`,artifacts),source);await writeFile(new URL(`${name}.execution.json`,artifacts),JSON.stringify(r));
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,stdout);
  assert.deepEqual(r.trace.structures,[]);return r.trace;
}
const marker=(t,label)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId;
const object=(t,name)=>t.objects.find(o=>o.name===name);

test('actual C: split storage mapping observes mutations and independent source expectations without inference',async()=>{
  const t=await execute('split-relations',`#include <stdio.h>
int main(void){
 int data[6]={90,10,80,20,70,30}, edges[6][2]={{3,-7},{-7,-7},{0,5},{-7,-7},{-7,-7},{-7,-7}}, root=2;
 puts("A");edges[0][1]=5;puts("B");edges[0][1]=-7;edges[3][0]=2;puts("C");
 edges[3][0]=-7;edges[2][0]=99;puts("D");edges[2][0]=0;root=-7;puts("E");return 0;
}`,'A\nB\nC\nD\nE\n');
  const b=defineStructureRelation(t,{nodes:{kind:'array',objectId:object(t,'data').id},roots:[{kind:'index',source:{kind:'slot',objectId:object(t,'root').id},nullValues:[-7]}],
    links:[0,4].map((offset,i)=>({id:`branch${i}`,kind:'index',source:{kind:'array',objectId:object(t,'edges').id,offset,size:4,stride:8,count:6},nullValues:[-7]}))});
  const expected={A:'satisfied-observed',B:'contradicted',C:'contradicted',D:'contradicted',E:'satisfied-observed'},results={};
  for(const [label,status] of Object.entries(expected)){results[label]=check(t,b,marker(t,label));assert.equal(results[label].assessment,status,label);}
  assert.deepEqual(pairs(relation(t,b,marker(t,'A'))),[[0,3,'branch0'],[2,0,'branch0'],[2,5,'branch1']]);
  assert.equal(relation(t,b,marker(t,'E')).nodes.length,0);assert.ok(results.D.warnings.some(w=>w.code==='relation-index-out-of-range'));
  await writeFile(new URL('split-relations.results.json',artifacts),JSON.stringify({expected,results},null,2));
});

test('actual C: record template follows individual allocations and preserves dangling links',async()=>{
  const t=await execute('heap-relations',`#include <stdio.h>
#include <stdlib.h>
typedef struct Cell{int value;struct Cell* hop;}Cell;
int main(void){Cell*a=calloc(1,sizeof(Cell)),*b=calloc(1,sizeof(Cell)),*c=calloc(1,sizeof(Cell));
 if(!a||!b||!c)return 1;
 a->value=7;b->value=8;c->value=9;a->hop=b;b->hop=c;Cell*root=a;puts("A");
 b->hop=0;puts("B");b->hop=c;free(b);puts("C");
 a->hop=0;free(c);puts("D");free(a);root=0;puts("E");return 0;}`,'A\nB\nC\nD\nE\n');
  const root=object(t,'root'),rt=root.cType.pointee,hop=rt.members.find(m=>m.name==='hop');
  const b=defineStructureRelation(t,{nodes:{kind:'records',recordTypeId:rt.recordTypeId},roots:[{kind:'pointer',source:{kind:'slot',objectId:root.id}}],
    links:[{id:'successor',kind:'pointer',source:{kind:'field',offset:hop.offsetBits/8,size:hop.sizeBits/8}}]});
  const expected={A:{count:3,status:'satisfied-observed'},B:{count:2,status:'satisfied-observed'},C:{count:1,status:'contradicted'},D:{count:1,status:'satisfied-observed'},E:{count:0,status:'satisfied-observed'}},results={};
  for(const [label,want]of Object.entries(expected)){results[label]=check(t,b,marker(t,label),'chain');assert.equal(results[label].assessment,want.status,label);assert.equal(results[label].candidates[0].relation.nodes.length,want.count,label);}
  assert.ok(results.C.warnings.some(w=>w.code==='relation-dangling-target'));assert.equal(check(t,b,root.endedBy,'chain').assessment,'ended');
  await writeFile(new URL('heap-relations.results.json',artifacts),JSON.stringify({expected,results},null,2));
});

test('actual C: record arrays use the same mapping and condition properties without inheriting subtype rules',async()=>{
  const t=await execute('record-relations',`#include <stdio.h>
typedef struct R{unsigned color;int key;struct R*a,*b;}R;
int main(void){R pool[3]={{0,8,0,0},{1,9,0,0},{1,2,0,0}};
 pool[0].a=pool+1;pool[0].b=pool+2;R*root=pool;puts("A");pool[0].color=1;puts("B");return 0;}`,'A\nB\n');
  const pool=object(t,'pool'),root=object(t,'root'),rt=pool.cType.elementType;
  const b=defineStructureRelation(t,{nodes:{kind:'array',objectId:pool.id},roots:[{kind:'pointer',source:{kind:'slot',objectId:root.id}}],
    links:rt.members.filter(m=>['a','b'].includes(m.name)).map(m=>({id:m.name,kind:'pointer',source:{kind:'field',offset:m.offsetBits/8,size:m.sizeBits/8}}))});
  const bindings={color:{kind:'record',offset:0,size:4,redValue:1,blackValue:0}};
  assert.equal(check(t,b,marker(t,'A'),'red-black-rules',{bindings}).assessment,'satisfied-observed');
  assert.ok(check(t,b,marker(t,'B'),'red-black-rules',{bindings}).warnings.some(w=>w.code==='red-black-root-color'));
  assert.equal(check(t,b,marker(t,'B'),'tree').assessment,'satisfied-observed');
  assert.equal(check(t,b,marker(t,'A'),'bst-order').assessment,'not-checkable');
});

test('array storage outlives its root slot: closing the root lifetime ends that selection, not the array',()=>{
  const s=separated(),before=s.mark(),ended=s.end(s.root);
  assert.equal(check(s.trace,s.binding,before).assessment,'satisfied-observed');
  assert.equal(check(s.trace,s.binding,ended).assessment,'ended');
  assert.equal(s.trace.objects.find(o=>o.id===s.data).endedBy,null);
});

test('pointer origins are not reconstructed after partial overwrite or same-address reallocation',()=>{
  const r=recorded(),rt={kind:'record',recordTypeId:'type:R',sizeBits:64,members:[]},pt={kind:'pointer',sizeBits:32,pointee:rt},
    a=r.allocate(8,rt),b=r.allocate(8,rt),root=r.allocate(4,pt),writePtr=(id,offset,target,bits)=>r.write(id,offset,bits,4,
      {cType:pt,reference:target?{status:'in-bounds',targetObjectId:target,targetOffset:0}:{status:'null'}});
  r.trace.objects.find(o=>o.id===b).address=800;
  writePtr(root,0,a,700);writePtr(a,4,b,800);writePtr(b,4,null,0);
  const bind=defineStructureRelation(r.trace,{nodes:{kind:'records',recordTypeId:rt.recordTypeId},roots:[{kind:'pointer',source:{kind:'slot',objectId:root}}],
    links:[{id:'route',kind:'pointer',source:{kind:'field',offset:4,size:4}}]}),A=r.mark();
  r.write(a,4,32,1);const B=r.mark();writePtr(a,4,b,800);r.end(b);
  const c=r.allocate(8,rt);r.trace.objects.find(o=>o.id===c).address=800;writePtr(c,4,null,0);const C=r.mark();
  assert.equal(check(r.trace,bind,A,'chain').assessment,'satisfied-observed');
  assert.equal(check(r.trace,bind,B,'chain').assessment,'incomplete');
  assert.ok(check(r.trace,bind,C,'chain').warnings.some(w=>w.code==='relation-dangling-target'));
  assert.ok(!relation(r.trace,bind,C).nodes.some(n=>n.range.objectId===c));
  const noRoots=defineStructureRelation(r.trace,{...bind,roots:null});r.end(a);r.end(c);
  assert.equal(check(r.trace,noRoots,r.mark(),'forest').assessment,'ended');
});

test('manual property checks ignore failed attempts and invalidate unobserved reads',()=>{
  const s=separated(),t=s.trace,props=s.array([0,0,0,0,0,0]);
  // Existing property adapter consumes independently specified array identity.
  t.structures.push({id:'property-array',kind:'array',objectId:props,range:{objectId:props,offset:0,size:24},capacity:6,elementBytes:4});
  const bindings={color:{kind:'array',arrayId:'property-array',redValue:1,blackValue:0}},A=s.mark();
  // This tree is deliberately unbalanced in black depth, so test the recorded
  // property value itself independently from the RB condition verdict.
  s.event({kind:'WRITE',phase:'failed',target:{objectId:props,offset:8,size:4},value:{bits:'0x00000001'}});const B=s.mark();
  s.event({kind:'READ',target:{objectId:props,offset:8,size:4},initializationEvidence:'unobserved',value:{bits:'0x00000000'}});const C=s.mark();
  const value=at=>check(t,s.binding,at,'red-black-rules',{bindings}).candidates[0].properties.color.values.find(v=>v.range.offset===8).value;
  assert.equal(value(A),'0');assert.equal(value(B),'0');assert.equal(value(C),null);
});
