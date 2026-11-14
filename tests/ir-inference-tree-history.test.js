import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,queryBSTOrder,queryStructureConditions,validateStructureTrace,recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {boundStructureHistory,structureStateAt,validateStateHistory} from '../scripts/inference/state-history.mjs';
import {retainHistoryEvidence} from '../scripts/inference/history-evidence.mjs';
import {createInferenceBudget} from '../scripts/inference/inference-limits.mjs';

const cases=[
 {name:'pointer records',stdout:'A 2\nB\nC\n',source:String.raw`
typedef struct N{int key;struct N*a,*b;}N;
int seek(N*p,int x){while(p){if(x==p->key)return 1;p=x<p->key?p->a:p->b;}return 0;}
int main(void){N n[3]={{8,0,0},{4,0,0},{12,0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",seek(root,4)+seek(root,12));n[1].key=9;puts("B");n[1].key=4;puts("C");return 0;}`},
 {name:'separate index arrays',stdout:'A 5\nB\nC\n',source:String.raw`
int key[3]={8,4,12},a[3]={1,-1,-1},b[3]={2,-1,-1};
int walk(int p){return p<0?0:1+walk(a[p])+walk(b[p]);}
int seek(int p,int x){while(p>=0){if(x==key[p])return 1;p=x<key[p]?a[p]:b[p];}return 0;}
int main(void){int root=0;printf("A %d\n",walk(root)+seek(root,4)+seek(root,12));key[1]=9;puts("B");key[1]=4;puts("C");return 0;}`}
];
for(const c of cases)test(`${c.name}: actual retention preserves uncertainty, lifetime and exact relation proofs`,async()=>{
 const r=await traceModel('#include <stdio.h>\n'+c.source,{filename:'tree-history.c'});
 assert.equal(r.trace.status,'completed');assert.equal(r.stdout,c.stdout);
 const before=JSON.stringify(r),normal=inferStructures(r.plan,r.trace),t={...r.trace,structures:normal.structures};
 assert.equal(normal.status,'completed',JSON.stringify(normal.diagnostics));
 const at=label=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId,target={objectId:t.objects.find(o=>o.name==='root').id},
  pos=new Map(t.events.map((e,i)=>[e.eventId,i])),selected=queryBSTOrder(t,{target,afterExecutionId:at('A')}).candidates[0],candidateId=selected.candidateId,
  full=t.structures.find(s=>s.id===candidateId),condition=(trace,id)=>queryStructureConditions(trace,{target,candidateId,expected:'avl',afterExecutionId:id});
 assert.equal(condition(t,at('A')).assessment,'satisfied-observed');assert.equal(condition(t,at('B')).assessment,'contradicted');assert.equal(condition(t,at('C')).assessment,'satisfied-observed');
 for(const maxStates of [1,2,3]){
  const inference=inferStructures(r.plan,r.trace,{limits:{maxStates}}),limited={...r.trace,structures:inference.structures};
  assert.equal(inference.status,'partial');assert.ok(inference.diagnostics.every(d=>d.code==='structure-inference-limit'),JSON.stringify(inference.diagnostics));
  validateStructureTrace(r.plan,limited);
  assert.equal(condition(limited,at('B')).assessment,'incomplete');assert.equal(queryBSTOrder(limited,{target,afterExecutionId:at('B')}).assessment,'incomplete');
  assert.ok(!recommendStructureViews(limited,{target,afterExecutionId:at('B')}).some(p=>p.view==='bst'));
  const preferences=setStructurePresentation(null,limited,{target,view:'avl'}),manual=resolveStructurePresentation(limited,{target,preferences,afterExecutionId:at('B')});
  assert.equal(manual.mode,'manual');assert.equal(manual.view,'avl');assert.equal(manual.expectationCheck.assessment,'incomplete');
  const ended=t.objects.find(o=>o.id===target.objectId).endedBy;assert.equal(condition(limited,ended).assessment,'ended');
  if(maxStates>1){const source=limited.structures.find(s=>s.id===full.sourceStructureId);assert.ok(source.proofStates?.length);
   const proof=source.proofStates[0],past=structureStateAt(source,pos,pos.get(proof.afterExecutionId),t.objects);
   assert.notEqual(past?.afterExecutionId,proof.afterExecutionId,'proofs must not become display snapshots');
   const corrupt=structuredClone(limited),bad=corrupt.structures.find(s=>s.id===source.id);
   bad.proofStates[0].afterExecutionId=t.events.at(-1).eventId;assert.throws(()=>validateStructureTrace(r.plan,corrupt));
   const missing=structuredClone(limited);delete missing.structures.find(s=>s.id===source.id).proofStates;
   assert.throws(()=>validateStructureTrace(r.plan,missing),/condition relation|source state/);
  }
 }
 // Keep a new complete snapshot before shutdown: a gap does not taint it.
 const prefix={...full,states:full.states.filter(s=>pos.get(s.afterExecutionId)<=pos.get(at('C')))},bounded=boundStructureHistory(prefix,2),fresh={...t,structures:t.structures.map(s=>s.id===candidateId?bounded:s)};
 validateStructureTrace(r.plan,fresh);assert.equal(condition(fresh,at('B')).assessment,'incomplete');assert.equal(condition(fresh,at('C')).assessment,'satisfied-observed');
 // Invalid new coverage and valid legacy coverage are different contracts.
 const malformed=structuredClone(t),bad=malformed.structures.find(s=>s.id===candidateId);bad.states=bad.states.filter(s=>pos.get(s.afterExecutionId)<=pos.get(at('A')));bad.coverage.omittedStates=1;
 assert.throws(()=>validateStateHistory(bad,pos),/생략 구간/);assert.equal(condition(malformed,at('B')).assessment,'incomplete');
 delete bad.coverage.historyGapFromExecutionId;validateStructureTrace(r.plan,malformed);assert.equal(condition(malformed,at('B')).assessment,'incomplete');
 // Proof-budget exhaustion removes the dependent claim, not its source graph.
 const budget=createInferenceBudget({maxDependencyNodes:1}),kept=retainHistoryEvidence(t.structures,t.structures.map(s=>boundStructureHistory(s,2)),t,budget);
 assert.ok(kept.some(s=>s.id===full.sourceStructureId));assert.ok(!kept.some(s=>s.id===candidateId));assert.ok(budget.diagnostics().some(d=>d.resource==='history-relation-proof'));
 assert.equal(JSON.stringify(r),before);
});
