import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {recommendStructureViews,validateStructureTrace} from '../scripts/inference/index.mjs';
async function run(source,stdout){const r=await traceWithStructureView(source,{filename:'association-variation.c',includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,stdout);assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r;}
const candidates=t=>t.structures.filter(s=>s.kind==='associative-lookup-candidate');
test('helper bit mask, zero key, changed status codes and equal payloads retain identity and tombstone semantics',async()=>{
  const {trace:t,plan}=await run(String.raw`#include <stdio.h>
typedef struct {int marker,padding,token,payload;} Cell;Cell a[8];
unsigned mix(unsigned x){return x&7u;}
int find(unsigned k){unsigned i=mix(k);for(int n=0;n<8;n++,i=(i+1)&7u){
 if(a[i].marker==5)return -1;
 if(a[i].marker==7&&a[i].token==(int)k)return i;
}return -1;}
void put(unsigned k,int v){unsigned i=mix(k);int hole=-1;for(int n=0;n<8;n++,i=(i+1)&7u){
 if(a[i].marker==9&&hole<0)hole=(int)i;
 if(a[i].marker==5){if(hole>=0)i=(unsigned)hole;a[i]=(Cell){7,123,(int)k,v};return;}
 if(a[i].marker==7&&a[i].token==(int)k){a[i].payload=v;return;}
}}
int main(void){for(int i=0;i<8;i++)a[i].marker=5;put(0,42);put(8,42);put(16,42);
 a[find(8)].marker=9;int x=find(16);printf("A %d\n",x);
 put(24,42);int y=find(8);printf("B %d\n",y);return 0;}`,'A 2\nB -1\n');
  const cs=candidates(t);assert.equal(cs.length,1);const c=cs[0],pos=new Map(t.events.map((e,i)=>[e.eventId,i])),
    checkpoint=tag=>t.events.find(e=>e.action==='output'&&e.text.startsWith(tag)).eventId,
    state=tag=>c.states.findLast(s=>pos.get(s.afterExecutionId)<=pos.get(checkpoint(tag)));
  assert.deepEqual(state('A').entries.map(e=>[e.index,e.key,e.values.map(v=>v.value),e.membership]).sort((a,b)=>a[0]-b[0]),[[0,0,[42],'active'],[1,8,[42],'inactive'],[2,16,[42],'active']]);
  assert.equal(state('A').entries.find(e=>e.index===1).slotStates[0].status,'deleted');
  assert.deepEqual(state('B').entries.map(e=>[e.index,e.key]).sort((a,b)=>a[0]-b[0]),[[0,0],[1,24],[2,16]]);
  assert.ok(c.roles.states.some(r=>r.values.some(v=>v.value===5&&v.evidence.some(p=>p.stopExecutionId))),'empty stop evidence');
  assert.ok(c.probes.some(p=>p.steps.map(s=>s.index).join(',')==='0,1,2,3'),'actual probing order');
  const target={structureId:c.id};assert.ok(recommendStructureViews(t,{target,afterExecutionId:checkpoint('A')}).some(r=>r.view==='hash-table'));
  assert.ok(!recommendStructureViews(t,{target,afterExecutionId:t.events[pos.get(c.discoveredAtExecutionId)-1].eventId}).some(r=>r.view==='hash-table'));
  for(const mode of ['comparison','key','state-code','future']){const copy=structuredClone(t),s=copy.structures.find(s=>s.id===c.id);
    if(mode==='comparison')s.lookupEvidence[0].queryReadExecutionId=s.lookupEvidence[0].keyReadExecutionId;
    if(mode==='key')s.states.at(-1).entries[0].key++;
    if(mode==='state-code')s.roles.states[0].values[0].value++;
    if(mode==='future')s.states[0].afterExecutionId=t.events[0].eventId;
    assert.throws(()=>validateStructureTrace(plan,copy),mode);
  }
});
test('linear membership search and modulo accumulators do not prove hashed lookup',async()=>{
  const {trace}=await run(String.raw`#include <stdio.h>
int keys[4]={2,4,6,8},values[4]={1,3,5,7},bins[3];
int search(int k){for(int i=0;i<4;i++)if(keys[i]==k)return values[i];return -1;}
int main(void){for(int i=0;i<8;i++)bins[i%3]+=i;printf("%d %d\n",search(6),bins[0]);return 0;}`,'5 9\n');
  assert.equal(candidates(trace).length,0);
});
