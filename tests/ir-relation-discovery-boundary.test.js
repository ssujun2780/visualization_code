import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coindexedRecordStructures,queryCoindexedRecords,validateCoindexedRecords} from '../scripts/inference/coindexed-record-views.mjs';
import {queryBSTOrder} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';

function fixture(operations,origins=null){
  const ids=[...new Set(operations.map(o=>o[1]))],arrays=ids.map(id=>({id,kind:'array',objectId:id,range:{objectId:id,offset:0,size:8},elementBytes:4,capacity:2})),
    events=operations.map(([kind,id],i)=>({eventId:`e${i}`,kind,target:{objectId:id,offset:0,size:4}})),
    work={kind:'array-work',accesses:events.map((e,i)=>({executionId:e.eventId,target:{...e.target,arrayId:operations[i][1],index:0,elementOffset:0}}))},
    coindexed=(origins??[events.map(e=>e.eventId)]).map((accessExecutionIds,i)=>({origin:`origin${i}`,accessExecutionIds})),
    trace={events,objects:ids.map(id=>({id,size:8})),structures:[...arrays,work,{kind:'storage-dependencies',coindexed,relations:[]}]};
  return {trace,build:()=>coindexedRecordStructures({},trace)};
}
const fields=s=>s.arrays.map(a=>a.arrayId).sort().join(',');
test('first sufficient prefix establishes a relation; repeated accesses do not postpone discovery',()=>{
  const f=fixture([['READ','x'],['READ','y'],['READ','x'],['READ','y']]),before=structuredClone(f.trace),s=f.build().find(s=>fields(s)==='x,y');
  assert.equal(s.discoveredAtExecutionId,'e1');
  assert.deepEqual(queryCoindexedRecords(s,f.trace,{afterExecutionId:'e0'}).nodes,[]);
  assert.equal(queryCoindexedRecords(s,f.trace,{afterExecutionId:'e1'}).discovered,true);
  assert.deepEqual(f.trace,before);
});
test('a later field extends a relation only from its own witnessed prefix',()=>{
  const f=fixture([['READ','x'],['READ','y'],['READ','x'],['READ','z'],['READ','y']]),groups=f.build(),
    pair=groups.find(s=>fields(s)==='x,y'),triple=groups.find(s=>fields(s)==='x,y,z');
  assert.ok(pair);assert.ok(triple);assert.equal(pair.discoveredAtExecutionId,'e1');assert.equal(triple.discoveredAtExecutionId,'e3');
  assert.equal(queryCoindexedRecords(triple,f.trace,{afterExecutionId:'e2'}).discovered,false);
  assert.deepEqual(queryCoindexedRecords(triple,f.trace,{afterExecutionId:'e2'}).nodes,[]);
  validateCoindexedRecords({...f.trace,structures:[...f.trace.structures,...groups]});
  const wrong=structuredClone(groups);wrong.find(s=>fields(s)==='x,y,z').discoveredAtExecutionId='e1';
  assert.throws(()=>validateCoindexedRecords({...f.trace,structures:[...f.trace.structures,...wrong]}),/discovery|proof/);
});
test('writes alone, aliases and different index origins cannot fabricate an early joined record',()=>{
  const f=fixture([['WRITE','x'],['WRITE','y'],['READ','x'],['READ','y']]),s=f.build().find(s=>fields(s)==='x,y');
  assert.equal(s.discoveredAtExecutionId,'e2');assert.equal(queryCoindexedRecords(s,f.trace,{afterExecutionId:'e1'}).discovered,false);
  assert.deepEqual(fixture([['WRITE','x'],['WRITE','y']]).build(),[]);
  const split=fixture([['READ','x'],['READ','y'],['READ','y'],['READ','z']],[['e0','e1'],['e2','e3']]);
  assert.deepEqual(split.build().map(fields).sort(),['x,y','y,z']);
  const alias=fixture([['READ','x'],['READ','y']]);alias.trace.structures[1].range={...alias.trace.structures[0].range};
  assert.deepEqual(alias.build(),[]);
});

async function run(source,stdout){const r=await traceModel('#include <stdio.h>\n'+source,{filename:'relation-boundary.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,stdout);assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r.trace;}
const at=(t,label)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId;
const state=(t,s,id)=>{const p=new Map(t.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(st=>p.get(st.afterExecutionId)<=p.get(id));};

test('another traversal can establish both split-array child roles before the first traversal finishes',async()=>{
  const t=await run(`int a[3]={1,-1,-1},b[3]={2,-1,-1},v[3]={20,10,30};
int seek(int p,int x){if(p<0)return 0;if(v[p]==x)return 1;return seek(x<v[p]?a[p]:b[p],x);}
int probe(int p,int x){while(p>=0){if(v[p]==x)return 1;p=x<v[p]?a[p]:b[p];}return 0;}
int sum(int p){if(p<0)return 0;return v[p]+sum(a[p])+sum(b[p]);}
int main(void){int root=0;int found=seek(root,10);probe(root,30);printf("A %d %d\\n",found,sum(root));
found+=seek(root,30);printf("B %d %d\\n",found,sum(root));return 0;}`,'A 1 60\nB 2 60\n');
  const root=t.objects.find(o=>o.name==='root'),storage=t.objects.find(o=>o.name==='v'),target={objectId:root.id};
  for(const tag of ['A','B']){
    const q=queryBSTOrder(t,{target,afterExecutionId:at(t,tag)});
    assert.equal(q.assessment,'satisfied-observed',tag);
    assert.ok(q.candidates.some(c=>{
      const ids=new Map(c.state.nodes.map(n=>[n.id,n.keyRange.objectId===storage.id?n.keyRange.offset/4:null]));
      return JSON.stringify([...ids.values()].sort())==='[0,1,2]'&&
        JSON.stringify(c.state.edges.map(e=>[ids.get(e.from),ids.get(e.to)]).sort())==='[[0,1],[0,2]]';
    }),tag+' exact members and child links');
  }
});

for(const embedded of [false,true])test(`shared terminal metadata does not become payload (${embedded?'same allocation, different offsets':'separate allocation'})`,async()=>{
  const storage=embedded?'struct { N data[3]; N stop; } box;':'N data[3],stop;',data=embedded?'box.data':'data',end=embedded?'box.stop':'stop';
  const t=await run(`typedef struct N { struct N*r; int flag,value; struct N*l,*parent; } N;
${storage}
int walk(N*p){if(p==&${end})return 0;return p->value+walk(p->l)+walk(p->r);}
int find(N*p,int k){while(p!=&${end}){if(p->value==k)return 1;p=k<p->value?p->l:p->r;}return 0;}
int inspect(N*p){if(p==&${end})return 1;int a=inspect(p->l),b=inspect(p->r);return a+b+(p->l->flag==17)+(p->r->flag==17);}
int main(void){${end}.flag=17;${end}.l=${end}.r=${end}.parent=&${end};
for(int i=0;i<3;i++){${data}[i].l=${data}[i].r=&${end};${data}[i].flag=29;${data}[i].parent=${data};}
${data}[0].value=20;${data}[1].value=10;${data}[2].value=30;${data}[0].l=${data}+1;${data}[0].r=${data}+2;${data}[0].parent=&${end};N*root=${data};
printf("A %d\\n",walk(root)+find(root,10)+find(root,30));printf("B %d\\n",inspect(root));return 0;}`,'A 62\nB 8\n');
  const root=t.objects.find(o=>o.name==='root'),entry=t.events.find(e=>e.kind==='WRITE'&&e.target?.objectId===root.id&&e.value?.reference),
    ref=entry.value.reference,stride=entry.value.cType.pointee.sizeBits/8,source=t.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id),
    expected=[0,1,2].map(i=>`${ref.targetObjectId}:${ref.targetOffset+i*stride}`).sort();
  for(const tag of ['A','B']){
    const q=queryBSTOrder(t,{target:{objectId:root.id},afterExecutionId:at(t,tag)});
    assert.equal(q.assessment,'satisfied-observed',tag);
    assert.ok(q.candidates.some(c=>JSON.stringify(c.state.nodes.map(n=>`${n.range.objectId}:${n.range.offset}`).sort())===JSON.stringify(expected)));
    const st=state(t,source,at(t,tag));assert.equal(st.topology.nodeCount,3);assert.equal(st.topology.cyclic,false);
    assert.equal(st.storageTopology.nodeCount,4);assert.equal(st.storageTopology.cyclic,true);
    assert.equal(st.boundaries.length,1);const boundary=st.boundaries[0];
    assert.ok(!st.topology.reachableNodeIds.includes(boundary.nodeId));assert.ok(st.topology.terminalNodeIds.includes(boundary.nodeId));
    assert.ok(!st.observedPayloadNodeIds.includes(boundary.nodeId));
  }
});
test('a circular data head and a terminal whose data is returned remain actual data nodes',async()=>{
  const circular=await run(`typedef struct N{int flag,value;struct N*next;}N;
int main(void){N a[3]={{17,3,0},{17,3,0},{17,3,0}};for(int i=0;i<3;i++)a[i].next=a+(i+1)%3;
N*head=a,*p=head;int sum=0;do{sum+=p->value;p=p->next;}while(p!=head);printf("A %d\\n",sum);return 0;}`,'A 9\n');
  const h=circular.objects.find(o=>o.name==='head'),c=circular.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===h.id),st=state(circular,c,at(circular,'A'));
  assert.equal(st.topology.nodeCount,3);assert.equal(st.topology.cyclic,true);assert.equal(st.boundaries.length,0);
  const value=await run(`typedef struct N{int value;struct N*next;}N;N stop;
int sum(N*p){if(p==&stop)return p->value;return p->value+sum(p->next);}
int main(void){stop.value=9;stop.next=&stop;N a={1,&stop};N*root=&a;printf("A %d\\n",sum(root));return 0;}`,'A 10\n');
  const root=value.objects.find(o=>o.name==='root'),s=value.structures.find(s=>s.kind==='linked-structure'&&s.root.objectId===root.id),v=state(value,s,at(value,'A'));
  assert.equal(v.topology.nodeCount,2);assert.equal(v.boundaries.length,0);
});
