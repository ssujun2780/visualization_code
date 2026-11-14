import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceWithStructureView} from './helpers/structure-runner.mjs';
import {querySequenceLookup,validateStructureTrace} from '../scripts/inference/index.mjs';

test('pointer labels follow observed slots, node-specific mappings and reference targets at each time',async()=>{
 const source=String.raw`#include <stdio.h>
typedef struct N{int base,end;struct N*child[2];}N;N bank[4];
int contains(const char*s){N*p=bank;while(*s){int i=*s-p->base;if(i<0||i>=2||!p->child[i])return 0;p=p->child[i];s++;}return p->end;}
int main(void){bank[0].base='a';bank[1].base='x';bank[2].end=bank[3].end=1;
bank[0].child[0]=bank+1;bank[1].child[0]=bank+2;
printf("A %d\n",contains("ax"));
bank[0].child[0]=bank+3;puts("R");printf("C %d\n",contains("a"));return 0;}`;
 const {plan,trace,inference}=await traceWithStructureView(source,{filename:'slot-labels.c',includeObservations:true});
 assert.equal(trace.status,'completed');assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));
 const output=trace.events.filter(e=>e.action==='output').map(e=>e.text).join('');assert.equal(output,'A 1\nR\nC 1\n');
 const object=trace.objects.find(o=>o.name==='bank'&&o.storage==='static'),width=object.size/4,
  candidate=trace.structures.find(s=>s.kind==='sequence-lookup-candidate'&&s.root?.objectId===object.id&&s.root.offset===0);assert.ok(candidate);
 const checkpoint=tag=>trace.events.find(e=>e.action==='output'&&e.text.startsWith(tag)).eventId,
  state=tag=>querySequenceLookup(trace,{candidateId:candidate.id,afterExecutionId:checkpoint(tag)}).state,
  labels=st=>{const indices=new Map(st.nodes.map(n=>[n.id,n.range.offset/width]));return st.edges.map(e=>[indices.get(e.from),indices.get(e.to),e.labels.map(l=>l.text).sort()]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
 // Both first slots have the same field role, but consume different symbols.
 assert.deepEqual(labels(state('A')),[[0,1,['a']],[1,2,['x']]]);
 // Rewiring must not lend the new transition an old target's label evidence.
 assert.deepEqual(labels(state('R')),[[0,3,[]]]);
 assert.deepEqual(labels(state('C')),[[0,3,['a']]]);
 const snapshot=structuredClone(trace);
 for(const mode of ['range','target','edge','future','label-swap']){
  const altered=structuredClone(trace),s=altered.structures.find(s=>s.id===candidate.id),p=s.selectionEvidence.find(p=>p.labelUnits[0]===97);
  if(mode==='range')p.slotRange.offset++;
  if(mode==='target')p.targetNodeId='wrong-node';
  if(mode==='edge')p.storedEdgeId='wrong-edge';
  if(mode==='future')p.slotObservationExecutionId=trace.events.at(-1).eventId;
  if(mode==='label-swap'){const st=s.states.findLast(st=>st.edges.length===2&&st.edges.every(e=>e.labels.length));const [a,b]=st.edges;[a.labels,b.labels]=[b.labels,a.labels];}
  assert.throws(()=>validateStructureTrace(plan,altered),mode);
 }
 assert.deepEqual(trace,snapshot);
});
