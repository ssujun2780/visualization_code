import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inferStructures} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {createHash} from 'node:crypto';
import {assertNestedLists} from './helpers/nested-link-contract.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const outputs=t=>t.events.filter(e=>e.action==='output');
async function run(name,source,stdout){
  const r=await traceModel(source,{filename:name+'.c'});assert.equal(r.stdout,stdout);assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  assert.deepEqual(r.trace.coverage.irGaps??[],[]);assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  const before=hash({plan:r.plan,trace:r.trace});inferStructures(r.plan,r.trace);assert.equal(hash({plan:r.plan,trace:r.trace}),before);
  if(process.env.MODEL_INFERENCE_RESULTS){const dir=path.resolve(process.env.MODEL_INFERENCE_RESULTS,name);await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'source.c'),source);await fs.writeFile(path.join(dir,'trace.json'),JSON.stringify(r.trace));await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(r.plan));}
  return r.trace;
}
const expected={outer:'y',inner:'x',entry:'first',outerLink:'route',innerLink:'step',outerOrder:[2,0,1],
  groups:[{outerIndex:2,innerIndices:[5,1,4]},{outerIndex:0,innerIndices:[2,0]},{outerIndex:1,innerIndices:[]}]};
test('entry roots survive aliases and empty heads; equal payloads do not erase sparse order',async()=>{
  const t=await run('sparse-alias-empty',`#include <stdio.h>
typedef struct L L;struct L{int value;L*step;};typedef struct G G;struct G{G*route;L*first;int spare;};
int main(void){L x[6]={{9,0},{9,0},{9,0},{9,0},{9,0},{9,0}};G y[3]={{0}};
x[5].step=x+1;x[1].step=x+4;x[2].step=x;y[2].route=y;y[0].route=y+1;y[2].first=x+5;y[0].first=x+2;
G*hold=&y[2];int sum=0;for(G*it=hold;it;it=it->route){L*alias=it->first;for(L*walk=alias;walk;walk=walk->step)sum+=walk->value;}
printf("%d\\n",sum);return 0;}`,'45\n');
  const at=outputs(t)[0].eventId;assertNestedLists(t,at,expected);
  const s=t.structures.find(s=>s.kind==='composed-reference-candidate'),pos=new Map(t.events.map((e,i)=>[e.eventId,i])),index=s.states.findLastIndex(s=>pos.get(s.afterExecutionId)<=pos.get(at));
  // Negative tests of the checker: preserve counts and values while corrupting
  // identity, order, termination or one required independent linked candidate.
  for(const mode of ['order','membership','termination','missing-root']){
    const bad=structuredClone(t),candidate=bad.structures.find(c=>c.id===s.id),now=candidate.states[index],nonempty=now.containers.filter(c=>c.memberNodeIds.length);
    if(mode==='order')nonempty[0].memberNodeIds.reverse();
    if(mode==='membership')[nonempty[0].memberNodeIds[0],nonempty[1].memberNodeIds[0]]=[nonempty[1].memberNodeIds[0],nonempty[0].memberNodeIds[0]];
    if(mode==='termination')nonempty[0].termination.status='cycle';
    if(mode==='missing-root'){
      const object=bad.objects.find(o=>o.name==='x'),offset=5*object.cType.elementType.sizeBits/8;
      bad.structures=bad.structures.filter(c=>c.kind!=='linked-structure'||!c.states.some(st=>c.logicalNodes.some(n=>n.id===st.topology.rootNodeId&&n.objectId===object.id&&n.offset===offset)));
    }
    assert.throws(()=>assertNestedLists(bad,at,expected),assert.AssertionError,`must reject ${mode}`);
  }
});

test('rewiring preserves a real cycle and later NULL/empty boundaries without changing membership expectations',async()=>{
  const t=await run('nested-rewire',`#include <stdio.h>
typedef struct A A;struct A{A*next;int value;};typedef struct B{int unused;A*items;struct B*next;}B;
int sum(B*start){int s=0;for(B*p=start;p;p=p->next){int k=0;for(A*q=p->items;q&&k<4;q=q->next,k++)s+=q->value;}return s;}
int main(void){A a[4]={{a+1,1},{0,2},{a+3,3},{0,4}};B b[2]={{0,a,b+1},{0,a+2,0}};
printf("%d\\n",sum(b));a[1].next=a;printf("%d\\n",sum(b));a[1].next=0;b[0].items=0;printf("%d\\n",sum(b));return 0;}`,'10\n13\n7\n');
  const base={outer:'b',inner:'a',entry:'items',outerLink:'next',innerLink:'next',outerOrder:[0,1]},outs=outputs(t),
    full=[{outerIndex:0,innerIndices:[0,1]},{outerIndex:1,innerIndices:[2,3]}];
  assertNestedLists(t,outs[0].eventId,{...base,groups:full});
  const pos=new Map(t.events.map((e,i)=>[e.eventId,i])),raw=t.structures.find(s=>s.kind==='storage-reference-graph'),b=t.objects.find(o=>o.name==='b'),
    b0=raw.nodes.find(n=>n.kind==='record'&&n.range.objectId===b.id&&n.range.offset===0),s=t.structures.find(s=>s.kind==='composed-reference-candidate'),
    cyclic=s.states.findLast(s=>pos.get(s.afterExecutionId)<=pos.get(outs[1].eventId)),c=cyclic.containers.find(c=>c.containerNodeId===b0.id);
  assert.equal(cyclic.status,'partial');assert.equal(c.termination.status,'cycle');assert.equal(c.termination.targetNodeId,c.memberNodeIds[0]);
  assert.throws(()=>assertNestedLists(t,outs[1].eventId,{...base,groups:full}),assert.AssertionError);
  assertNestedLists(t,outs[2].eventId,{...base,groups:[{outerIndex:0,innerIndices:[]},{outerIndex:1,innerIndices:[2,3]}]});
});

test('pointer storage without an observed compiler recurrence does not invent linked roots',async()=>{
  const t=await run('non-traversal-pointer',`#include <stdio.h>
typedef struct R{int value;struct R*next;}R;
int main(void){R a[2]={{5,0},{5,0}};R*p=a;a[0].next=a+1;printf("%d\\n",p->value);return 0;}`,'5\n');
  assert.ok(!t.structures.some(s=>s.kind==='linked-structure'));
});
