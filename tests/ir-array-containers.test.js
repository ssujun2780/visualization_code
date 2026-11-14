import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {inferStructures,recommendStructureViews} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {structureTouches} from '../scripts/inference/structure-storage.mjs';

// Predictions are fixed from source behavior before execution. Names, widths,
// origins, fields and control syntax differ from the saved discovery fixtures.
async function run(name,source,stdout){
  const dir=process.env.ARRAY_CONTAINER_RESULTS&&`${process.env.ARRAY_CONTAINER_RESULTS}/${name}`;
  if(dir){await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/source.c',source);await fs.writeFile(dir+'/prediction.json',JSON.stringify({stdout}));}
  const r=await traceModel(source,{filename:name+'.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.trace.exitCode,0);assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const before=JSON.stringify({plan:r.plan,trace:r.trace});inferStructures(r.plan,r.trace);assert.equal(JSON.stringify({plan:r.plan,trace:r.trace}),before);
  if(dir){await fs.writeFile(dir+'/trace.json',JSON.stringify(r.trace));await fs.writeFile(dir+'/plan.json',JSON.stringify(r.plan));}
  return r.trace;
}
function inspect(t,name,label='S',range){
  const at=t.events.find(e=>e.action==='output'&&e.text?.startsWith(label+' '));assert.ok(at);
  const o=t.objects.find(o=>o.name===name),target={ranges:[{objectId:o.id,offset:range?.[0]??0,size:range?.[1]??o.size}]},
    pos=new Map(t.events.map((e,i)=>[e.eventId,i])),occurred=id=>pos.has(id)&&pos.get(id)<=pos.get(at.eventId),
    state=s=>s.states?.findLast(x=>occurred(x.afterExecutionId??x.executionId)),ctx={occurred,state,positions:pos,at:pos.get(at.eventId)};
  return {at,target,views:recommendStructureViews(t,{target,afterExecutionId:at.eventId}).map(x=>x.view),
    structures:t.structures.filter(s=>structureTouches(s,target,t,ctx)).map(s=>({s,state:state(s)})),occurred};
}
const indices=o=>o?Array.from({length:o.count??o.length},(_,i)=>o.modulus?((o.start+i*o.direction)%o.modulus+o.modulus)%o.modulus:o.start+i*o.stride):null;
function ordered(v,view,wanted){
  assert.ok(v.views.includes(view),JSON.stringify(v.views));
  const candidates=v.structures.filter(({state})=>JSON.stringify(indices(state?.logicalOrder))===JSON.stringify(wanted));
  assert.ok(candidates.length,`expected ${JSON.stringify(wanted)}; got ${JSON.stringify(v.structures.map(x=>indices(x.state?.logicalOrder)))}`);return candidates;
}

test('later shifted removal preserves earlier LIFO proof, matching a separately executed prefix',async()=>{
  const start=`#include <stdio.h>
typedef struct{unsigned used;short cells[5];}Z;
void add(Z*x,short a){x->cells[x->used++]=a;}
short last(Z*x){return x->cells[--x->used];}
short first(Z*x){short v=x->cells[0];for(unsigned j=1;j<x->used;j++)x->cells[j-1]=x->cells[j];x->used--;return v;}
int main(void){Z z={0};add(&z,6);add(&z,6);add(&z,9);int q=last(&z);printf("S0 %d\\n",q);`;
  const prefix=await run('policy-prefix',start+'return 0;}','S0 9\n');
  const full=await run('policy-change',start+'q=first(&z);printf("S1 %d\\n",q);return 0;}','S0 9\nS1 6\n');
  const a=inspect(prefix,'z','S0'),b=inspect(full,'z','S0'),c=inspect(full,'z','S1');
  ordered(a,'stack',[0,1]);ordered(b,'stack',[0,1]);assert.deepEqual(b.views,a.views);
  assert.ok(!c.views.includes('stack')&&!c.views.includes('queue'));ordered(c,'deque',[0]);
});

test('independent reverse and forward cursors keep disjoint orders and inactive ranges',async()=>{
  const t=await run('shared-storage',`#include <stdio.h>
short cells[12];int low=2,high=11;
void a(short x){cells[low++]=x;} void b(short x){cells[--high]=x;}
short c(void){if(low>2)return cells[--low];return 0;} short d(void){if(high<11)return cells[high++];return 0;}
int main(void){a(11);a(12);b(31);b(32);int x=c(),y=d();printf("S %d %d\\n",x,y);return 0;}`,'S 12 32\n');
  const left=ordered(inspect(t,'cells','S',[0,12]),'stack',[2]),right=ordered(inspect(t,'cells','S',[12,12]),'stack',[10]);
  assert.notEqual(left[0].s.id,right[0].s.id);
  for(const {s,state}of [...left,...right]){
    assert.equal(s.queryScoped,true);assert.ok(state.inactiveRanges.every(r=>!(r.offset<=20&&20<r.offset+r.size)&&!(r.offset<=4&&4<r.offset+r.size)));
  }
});

test('last-index with shifted coordinate origin and pointer cursor with interior start are supported',async()=>{
  const a=await run('biased-last-index',`#include <stdio.h>
long long cells[7];int coordinate=4;
void enter(long long v){coordinate++;cells[coordinate-5]=v;}
long long leave(void){long long x=cells[coordinate-5];coordinate--;return x;}
int main(void){enter(51);enter(52);long long x=leave();printf("S %lld\\n",x);return 0;}`,'S 52\n');
  ordered(inspect(a,'cells'),'stack',[0]);
  const b=await run('interior-pointer',`#include <stdio.h>
#include <stdlib.h>
long long *base,*cursor,*stop;
void enter(long long v){if(cursor<stop){long long *alias=cursor;*alias=v;cursor++;}}
long long leave(void){--cursor;return *cursor;}
int main(void){base=calloc(9,sizeof *base);if(!base)return 1;cursor=base+2;stop=base+8;
enter(51);enter(52);long long x=leave();printf("S %lld\\n",x);free(base);return 0;}`,'S 52\n');
  ordered(inspect(b,'base'),'stack',[2]);
});

test('inline endpoint updates bind to their own cursor version, not the neighboring operation',async()=>{
  const t=await run('inline-endpoints',`#include <stdio.h>
int main(void){short cells[8]={0};unsigned used=0;
cells[used++]=7;cells[used++]=7;cells[used++]=9;
int x=cells[--used];cells[used++]=6;int y=cells[--used];
printf("S %d %d\\n",x,y);return 0;}`,'S 9 6\n');
  const [{s}]=ordered(inspect(t,'cells'),'stack',[0,1]);assert.equal(s.operationEvidence.length,6);
  assert.equal(new Set(s.operationEvidence.map(o=>o.accessExecutionId)).size,6);
  assert.ok(s.operationEvidence.every(o=>o.status==='supported'));
});

test('nonzero cursor without empty-boundary evidence retains coordinate ambiguity',async()=>{
  const t=await run('ambiguous-origin',`#include <stdio.h>
int cells[8]={0},cursor=2;
void enter(int x){cells[cursor++]=x;}int leave(void){return cells[--cursor];}
int main(void){enter(8);enter(9);int x=leave();printf("S %d\\n",x);return 0;}`,'S 9\n');
  const v=inspect(t,'cells'),s=v.structures.find(x=>x.s.kind==='array-structure');assert.ok(s);
  assert.ok(s.s.roleAlternatives.some(p=>p.geometry?.origin===2));assert.ok(s.s.roleAlternatives.some(p=>p.geometry===null));
  assert.equal(s.state.logicalOrder,null);
});

test('bulk range shifts retain repeated element origins and compose both deque ends',async()=>{
  const t=await run('bulk-deque',`#include <stdio.h>
#include <string.h>
typedef struct{unsigned n;long long a[7];short cache;}Z;
void back(Z*x,long long v){x->a[x->n++]=v;}
void front(Z*x,long long v){memmove(x->a+1,x->a,x->n*sizeof *x->a);x->a[0]=v;x->n++;}
long long last(Z*x){return x->a[--x->n];}
long long first(Z*x){long long v=x->a[0];--x->n;memmove(x->a,x->a+1,x->n*sizeof *x->a);return v;}
int main(void){Z z={0};back(&z,4);back(&z,4);front(&z,3);long long x=last(&z);front(&z,2);long long y=first(&z);
printf("S %lld %lld %lld %lld\\n",x,y,z.a[0],z.a[1]);return 0;}`,'S 4 2 3 4\n');
  const [{s}]=ordered(inspect(t,'z'),'deque',[0,1]);assert.equal(s.operationEvidence.length,6);
  const transfers=s.operationEvidence.flatMap(o=>o.transfers);assert.ok(transfers.some(x=>x.kind==='observed-range-copy'&&x.toIndex-x.fromIndex===1));
  assert.ok(transfers.some(x=>x.kind==='observed-range-copy'&&x.toIndex-x.fromIndex===-1));
  assert.ok(s.operationEvidence.every(o=>o.status==='supported'));
});

test('modulo head-tail ring with changed width and capacity retains reserved-slot order',async()=>{
  const t=await run('modulo-reserved-ring',`#include <stdio.h>
typedef struct{unsigned char t,h;short a[7];}Z;
void enter(Z*x,short v){unsigned k=(x->t+1)%7;if(k!=x->h){x->a[x->t]=v;x->t=k;}}
short leave(Z*x){short v=x->a[x->h];x->h=(x->h+1)%7;return v;}
int main(void){Z z={0};for(short j=1;j<=6;j++)enter(&z,j);for(int j=0;j<3;j++)leave(&z);
enter(&z,7);enter(&z,8);enter(&z,9);printf("S %u %u\\n",z.h,z.t);return 0;}`,'S 3 2\n');
  ordered(inspect(t,'z'),'queue',[3,4,5,6,0,1]);
});

test('equal cursors with a full flag do not borrow the reserved-slot empty convention',async()=>{
  const t=await run('full-flag-counterexample',`#include <stdio.h>
typedef struct{int a[4];unsigned h,t;int full;}Z;
void enter(Z*x,int v){if(x->full)return;x->a[x->t]=v;x->t=(x->t+1)%4;x->full=x->t==x->h;}
int leave(Z*x){int v=x->a[x->h];x->h=(x->h+1)%4;x->full=0;return v;}
int main(void){Z z={0};for(int i=0;i<4;i++)enter(&z,i);leave(&z);enter(&z,8);printf("S %d\\n",z.full);return 0;}`,'S 1\n');
  const v=inspect(t,'z');assert.ok(!v.structures.some(x=>x.s.roleAlternatives?.some(r=>r.representation==='reserved-slot-ring')));
  assert.ok(!v.structures.some(x=>x.state?.status==='consistent'&&x.state.length===0));
});

test('append-only guarded prefix has membership without removal-policy recommendations',async()=>{
  const t=await run('append-membership',`#include <stdio.h>
typedef struct{unsigned short used;long long a[9];}Z;
void enter(Z*x,long long v){if(x->used<9){unsigned j=x->used;x->a[j]=v;x->used=x->used+1;}}
long long unused(Z*x){return x->a[--x->used];}
int main(void){Z z={0};enter(&z,8);enter(&z,8);enter(&z,5);printf("S %u\\n",z.used);return 0;}`,'S 3\n');
  const v=inspect(t,'z');ordered(v,'array',[0,1,2]);assert.ok(['stack','queue','deque'].every(k=>!v.views.includes(k)));
});

test('peek calls are non-consuming even when another activation later writes the cursor',async()=>{
  const t=await run('peek-reset',`#include <stdio.h>
int a[6],h,t;
void enter(int v){a[t++]=v;}
int leave(void){return a[h++];}
int look(void){return h<t?a[h]:0;}
void reset(void){h=0;}
int main(void){enter(9);enter(8);int v=leave();v+=look();printf("S %d\\n",v);reset();return 0;}`,'S 17\n');
  const v=inspect(t,'a');ordered(v,'queue',[1]);
  const q=v.structures.find(x=>x.s.kind==='queue-candidate');assert.ok(q);
  assert.equal(q.s.operations.filter(o=>o.kind==='dequeue').length,1);assert.equal(q.s.operations.filter(o=>o.kind==='peek').length,1);
  assert.deepEqual(q.state.pendingAccessExecutionIds,[]);
});
