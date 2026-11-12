import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {bindIndexRelations,indexRelationStructures,queryIndexRelations} from '../scripts/inference/index-relations.mjs';

async function inspect(source){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,0);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const before=JSON.stringify({events:r.trace.events,objects:r.trace.objects});
  bindIndexRelations(r.plan);const trees=indexRelationStructures(r.plan,r.trace);
  assert.equal(JSON.stringify({events:r.trace.events,objects:r.trace.objects}),before);
  for(const tree of trees){const array=r.trace.structures.find(s=>s.id===tree.arrayId);assert.ok(array);
    assert.equal(tree.objectId,array.objectId);assert.deepEqual(tree.range,array.range);assert.equal(tree.isPointerStructure,false);assert.deepEqual(tree.edges,[]);}
  return {...r,trees};
}

test('embedded binary index relations retain intermediate writes and actual comparison evidence',async()=>{
  const r=await inspect(`typedef struct {char label;int slots[8];unsigned used;} Box;
void trade(int *a,int *b){int held=*a;*a=*b;*b=held;}
void put(Box *box,int v){unsigned i=box->used++;box->slots[i]=v;
while(i>0){unsigned p=(i-1)/2;if(box->slots[p]>=box->slots[i])break;
trade(&box->slots[p],&box->slots[i]);i=p;}}
int main(void){Box box={0};put(&box,4);put(&box,9);put(&box,2);
unsigned i=0,left=2*i+1,right=left+1;
if(box.slots[left]<box.slots[right])trade(&box.slots[left],&box.slots[right]);
return box.slots[0]!=9;}`);
  assert.equal(r.trees.length,1);const [tree]=r.trees;
  assert.equal(tree.descriptor.degree,2);assert.equal(tree.descriptor.base,0);assert.equal(tree.status,'supported');
  assert.equal(tree.direction.candidate,'max');assert.equal(tree.direction.invariantProven,false);
  assert.ok(tree.formulaEvidence.some(f=>f.form==='parent'&&f.status==='supported'));
  assert.ok(tree.formulaEvidence.some(f=>f.form==='child'&&f.status==='supported'));
  assert.ok(tree.formulaEvidence.some(f=>f.form==='sibling'&&f.status==='supported'));
  assert.ok(tree.comparisonEvidence.every(c=>c.readExecutionIds.length===2));
  assert.ok(tree.states.some(s=>s.max.violations>0));
  const intermediate=tree.states.find(s=>s.max.violations>0);
  assert.ok(queryIndexRelations(tree,r.trace,{afterExecutionId:intermediate.afterExecutionId,limit:7}).some(e=>e.ordering==='min'));
  const query=queryIndexRelations(tree,r.trace,{limit:2});
  assert.deepEqual(query.map(e=>[e.parentIndex,e.childIndex,e.parent.value,e.child.value]),[[0,1,'9','4'],[0,2,'9','2']]);
  assert.ok(query.every(e=>e.parent.objectId===tree.objectId&&e.child.objectId===tree.objectId&&!e.isPointer));
  assert.ok(tree.range.offset>0,'embedded field offset is reused');
  const helper=r.plan.functions.find(f=>f.name==='trade'),defs=new Map(r.plan.instructions.map(d=>[d.id,d])),
    writes=r.trace.events.filter(e=>e.kind==='WRITE'&&defs.get(e.instructionId)?.functionId===helper.id&&e.target?.objectId===tree.objectId);
  assert.ok(writes.length>=2);assert.ok(writes.every(e=>tree.states.some(s=>s.afterExecutionId===e.eventId)));
  const formula=tree.formulaEvidence.find(f=>f.form==='parent'),altered={...r.trace,events:r.trace.events.map(e=>e.eventId===formula.executionId?
    {...e,steps:e.steps.map(s=>s.nodeId===formula.sourceNodeId?{...s,value:{decimal:'999'}}:s)}:e)};
  const [contradicted]=indexRelationStructures(r.plan,altered);
  assert.equal(contradicted.status,'contradicted');assert.ok(contradicted.formulaEvidence.some(f=>f.status==='contradicted'));
});

test('one-based ternary relations work without a record and retain missing active-length evidence',async()=>{
  const r=await inspect(`int main(void){int bins[8]={0,2,5,7,9,6,8,10};unsigned child=5;
unsigned parent=(child+1)/3;int result=bins[parent]<=bins[child];
unsigned first=3*parent-1;result+=bins[first]+bins[first+1]+bins[first+2];
return result<0;}`);
  assert.equal(r.trees.length,1);const [tree]=r.trees;
  assert.deepEqual([tree.descriptor.degree,tree.descriptor.base,tree.descriptor.firstChildOffset],[3,1,-1]);
  assert.equal(tree.status,'supported');assert.equal(tree.direction.candidate,'min');
  assert.ok(tree.states.every(s=>s.activeRange.status==='unknown'&&s.activeRange.count===null));
  assert.ok(tree.states.every(s=>s.min.status==='unknown'));
  const edges=queryIndexRelations(tree,r.trace,{start:2,limit:6});
  assert.deepEqual(edges.map(e=>[e.parentIndex,e.childIndex]),[[1,2],[1,3],[1,4],[2,5],[2,6],[2,7]]);
  assert.ok(edges.every(e=>e.ordering==='min'));
  // Erasing actual value evidence must not reconstruct values from source text.
  const partial={...r.trace,events:r.trace.events.map(e=>e.target?.objectId===tree.objectId||e.objectId===tree.objectId?{...e,value:undefined,memoryState:undefined}:e)};
  assert.ok(queryIndexRelations(tree,partial,{start:2,limit:6}).every(e=>e.ordering==='unknown'));
});

test('large child-only arrays remain compact, ambiguous, and queryable without invented links',async()=>{
  const r=await inspect(`int main(void){int slots[100000]={0};unsigned row=1;
unsigned child=2*row+1;slots[row]=4;slots[child]=8;
int result=slots[row]>=slots[child];return result;}`);
  assert.equal(r.trees.length,2);assert.deepEqual(r.trees.map(t=>t.descriptor.base).sort(),[0,1]);
  assert.ok(r.trees.every(t=>t.status==='partial'&&t.edges.length===0));
  assert.ok(JSON.stringify(r.trees).length<40000,'export grows with observations, not capacity');
  const tree=r.trees.find(t=>t.descriptor.base===0),state=tree.states.at(-1);
  assert.ok(state.max.violations>0);assert.ok(state.max.unknownEdges>90000);
  assert.equal(queryIndexRelations(tree,r.trace,{start:3,limit:1})[0].ordering,'min');
  const distant=queryIndexRelations(tree,r.trace,{start:90000,limit:1})[0];
  assert.equal(distant.ordering,'equal');assert.equal(distant.child.value,'0');
  assert.throws(()=>queryIndexRelations(tree,r.trace,{limit:100000}),RangeError);
});
