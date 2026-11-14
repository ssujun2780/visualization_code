import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {inferStructures} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fixtures='example/c/codex_code/array-inference-audit-2026-11-10';
const out='test-results/codex_code-results/array-inference-fixes-2026-11-10';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const predictions=(await read(fixtures+'/expected.json')).cases;
const order=o=>o?Array.from({length:o.count},(_,i)=>(o.start+i*o.direction)%o.modulus):null;
function snapshot(trace,s,at){const pos=new Map(trace.events.map((e,i)=>[e.eventId,i]));return s.states.findLast(x=>pos.get(x.afterExecutionId)<=pos.get(at));}
function slot(trace,label){const [name,field]=label.replace(' target','').split('.'),o=trace.objects.find(o=>o.name===name);assert.ok(o,label);
  const f=field&&o.cType.members.find(f=>f.name===field);if(field)assert.ok(f,label);
  return {objectId:o.id,offset:f?f.offsetBits/8:0,size:f?f.sizeBits/8:o.size};}
function target(trace,label,at){const r=slot(trace,label);if(!label.endsWith(' target'))return r;
  const pos=trace.events.findIndex(e=>e.eventId===at),e=trace.events.slice(0,pos+1).findLast(e=>e.target?.objectId===r.objectId&&e.target.offset===r.offset&&e.value?.reference);
  assert.ok(e,label);return {objectId:e.value.reference.targetObjectId,offset:e.value.reference.targetOffset};}
function actualRole(s,r){return r&&{objectId:r.objectId??s.ownerObjectId,offset:r.offset+(r.objectId?0:s.ownerOffset??0),size:r.size};}
async function run(name,source,stdout){
  const r=await traceModel(source,{filename:name+'.c'});assert.equal(r.stdout,stdout);assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));assert.deepEqual(r.trace.coverage.irGaps,[]);
  const before=digest({plan:r.plan,trace:r.trace});inferStructures(r.plan,r.trace);assert.equal(digest({plan:r.plan,trace:r.trace}),before);
  const folder=path.join(out,name);await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'trace.json'),JSON.stringify(r.trace));await fs.writeFile(path.join(folder,'plan.json'),JSON.stringify(r.plan));
  await fs.writeFile(path.join(folder,'source.c'),source);return r;
}
for(const c of predictions)test(`original array audit: ${c.name}`,async()=>{
  const source=await fs.readFile(`${fixtures}/${c.name}.c`,'utf8'),r=await run(c.name,source,c.stdout),t=r.trace,
    outputs=t.events.filter(e=>e.action==='output');
  // Keep the original pre-fix hashes as historical compatibility evidence.
  // Live generation can add contracted provenance/selection events; its
  // read-only inference check belongs to this run, not to an older model hash.
  const historical=JSON.parse(gunzipSync(await fs.readFile(new URL(`./fixtures/array-membership-history/${c.name}.json.gz`,import.meta.url))));
  assert.equal(historical.plan.sourceMap.snapshot.text,source);
  const historyBefore=digest(historical);
  inferStructures(historical.plan,historical.trace);
  assert.equal(digest(historical),historyBefore,'historical input remains unchanged');
  for(const k of ['events','objects','frames','resultDeliveries'])assert.equal(digest(historical.trace[k]),c.coreSha256[k],`${c.name}: unchanged historical ${k}`);
  for(const [i,expected]of c.expected.entries()){
    const at=outputs[i].eventId;
    if(!expected.roles){const s=t.structures.find(s=>s.kind==='array-structure'),state=snapshot(t,s,at);
      assert.equal(state.active,true);assert.equal(state.length,null);assert.equal(state.logicalOrder,null);assert.equal(state.inactiveRanges,null);continue;}
    const range=target(t,expected.roles.storage,at),s=t.structures.find(s=>s.kind==='array-structure'&&s.range.objectId===range.objectId&&s.range.offset===range.offset);assert.ok(s);
    const state=snapshot(t,s,at);assert.equal(state.active,true);assert.equal(s.capacity,expected.capacity);
    for(const [role,label]of Object.entries(expected.roles))if(role!=='storage'){
      const key=role==='cardinality'?'length':role;
      // Dynamic capacity is also exposed by the independent manager binding.
      const owner=key==='capacity'&&!s.roles[key]?t.structures.find(m=>m.kind==='dynamic-array'&&m.ownerObjectId===s.ownerObjectId):s;
      assert.deepEqual(actualRole(owner,owner.roles?.[key]??owner.role?.[key]),slot(t,label),label);
    }
    assert.equal(state.length,expected.activeIndices.length);
    if(Array.isArray(expected.logicalOrder))assert.deepEqual(order(state.logicalOrder),expected.logicalOrder);
    else assert.equal(state.logicalOrder,null);
    const active=state.activeIndices??order(state.logicalOrder)?.slice().sort((a,b)=>a-b);assert.deepEqual(active,expected.activeIndices);
    const inactive=state.inactiveRanges.flatMap(r=>Array.from({length:r.size/s.elementBytes},(_,i)=>(r.offset-s.range.offset)/s.elementBytes+i));assert.deepEqual(inactive,expected.inactiveIndices);
  }
});

test('bulk membership handles reordered fields, short elements, interior storage and memmove',async()=>{
 const r=await run('bulk-short-interior',`#include <stdlib.h>
#include <stdio.h>
#include <string.h>
typedef struct {unsigned cap,noise,end;short*slot;} H;
void join(H*h,short*s,unsigned n){if(h->end+n<=h->cap){memmove(h->slot+h->end,s,n*sizeof *s);h->end=h->end+n;}}
int main(void){short*whole=calloc(10,sizeof *whole);if(!whole)return 1;H h={8,2,0,whole+2};short s[2]={4,7};join(&h,s,2);join(&h,s,2);h.end-=2;
printf("%u %d %d\\n",h.end,h.slot[0],h.slot[1]);free(whole);return 0;}`,'2 4 7\n');
 const s=r.trace.structures.find(s=>s.kind==='array-structure'&&s.range.offset===4),at=r.trace.events.find(e=>e.action==='output').eventId,state=snapshot(r.trace,s,at);
 assert.equal(s.elementBytes,2);assert.deepEqual(order(state.logicalOrder),[0,1]);assert.equal(state.length,2);
});

test('inverted nonboolean occupancy and separate arrays retain a set, not an invented order',async()=>{
 const r=await run('sparse-inverted-separate',`#include <stdio.h>
long value[7];int mark[7]={9,9,9,9,9,9,9};unsigned count;
void put(unsigned k){if(mark[k]==9){value[k]=12;mark[k]=-2;count++;}}
void del(unsigned k){if(mark[k]==-2){mark[k]=9;count--;}}
int main(void){put(6);put(2);put(4);del(2);long sum=0;for(int k=0;k<7;k++)if(mark[k]==-2)sum+=value[k];printf("%ld %u\\n",sum,count);return 0;}`,'24 2\n');
 const object=r.trace.objects.find(o=>o.name==='value'),s=r.trace.structures.find(s=>s.kind==='array-structure'&&s.range.objectId===object.id),state=snapshot(r.trace,s,r.trace.events.find(e=>e.action==='output').eventId);
 assert.deepEqual(state.activeIndices,[4,6]);assert.equal(state.logicalOrder,null);assert.equal(state.length,2);
});

test('same-index flags and counts without gated reads do not prove occupancy',async()=>{
 const r=await run('unrelated-flags',`#include <stdio.h>
int a[4],flag[4],n;
void add(int k){a[k]=7;flag[k]=1;n++;}void drop(int k){flag[k]=0;n--;}
int main(void){add(1);add(3);drop(1);int s=0;for(int i=0;i<4;i++)s+=a[i]+flag[i];printf("%d\\n",s);return 0;}`,'15\n');
 assert.ok(r.trace.structures.filter(s=>s.kind==='array-structure').every(s=>!s.states.some(x=>x.membership?.kind==='sparse')));
});

test('a removed prefix is not revived by rebinding to unrelated storage',async()=>{
 const r=await run('prefix-rebind',`#include <stdio.h>
#include <stdlib.h>
typedef struct{int*p;unsigned n,cap;}B;
void join(B*b,int v){if(b->n<b->cap)b->p[b->n++]=v;}
int main(void){B b={calloc(6,sizeof(int)),0,6};int*q=calloc(6,sizeof(int));if(!b.p||!q){free(b.p);free(q);return 1;}
join(&b,4);join(&b,5);int*old=b.p;b.p=q;printf("%d\\n",b.p[0]);free(old);free(q);return 0;}`,'0\n');
 const at=r.trace.events.find(e=>e.action==='output').eventId;
 const active=r.trace.structures.filter(s=>s.kind==='array-structure').map(s=>snapshot(r.trace,s,at)).filter(s=>s?.active);
 assert.ok(active.length);assert.ok(active.every(s=>s.logicalOrder===null));
});

test('sparse evidence is temporal and a dead counter does not kill its live storage',async()=>{
 const r=await run('sparse-counter-lifetime',`#include <stdio.h>
int values[5],flags[5];
void put(int k,int*c){if(!flags[k]){values[k]=k+1;flags[k]=1;(*c)++;}}
void drop(int k,int*c){if(flags[k]){flags[k]=0;(*c)--;}}
void work(void){int count=0;put(1,&count);put(3,&count);printf("before %d\\n",count);
drop(1,&count);int total=0;for(int k=0;k<5;k++)if(flags[k])total+=values[k];printf("during %d %d\\n",total,count);
count++;printf("mismatch %d\\n",count);}
int main(void){work();printf("after %d\\n",values[3]);return 0;}`,'before 2\nduring 4 1\nmismatch 2\nafter 4\n');
 const t=r.trace,o=t.objects.find(o=>o.name==='values'),s=t.structures.find(s=>s.kind==='array-structure'&&s.range.objectId===o.id),
   outputs=t.events.filter(e=>e.action==='output'),states=outputs.map(e=>snapshot(t,s,e.eventId));
 assert.notEqual(states[0].membership?.kind,'sparse','future transitions must not establish earlier membership');
 assert.deepEqual(states[1].activeIndices,[3]);assert.equal(states[1].length,1);assert.equal(states[1].status,'consistent');
 assert.equal(states[2].length,2);assert.deepEqual(states[2].activeIndices,[3]);assert.equal(states[2].status,'intermediate');
 assert.equal(states[3].active,true);assert.equal(states[3].rolesAlive,false);assert.equal(states[3].length,null);
 assert.deepEqual(states[3].activeIndices,[3]);assert.equal(states[3].status,'partial');assert.equal(states[3].logicalOrder,null);
});
