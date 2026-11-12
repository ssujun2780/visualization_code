import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateStructureConditions,queryStructureRelations,queryStructureConditions,queryBSTOrder,
  recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';
import {topology} from '../scripts/shared/topology.mjs';
import {validateBSTOverlays} from '../scripts/inference/bst-contract.mjs';

// Expectations below are from topology/algorithm contracts, not the inferred
// candidate names or a copied engine result. Identity and direction matter.
function relation(ids,links,{root=ids[0],complete=true,...options}={}){
  const nodes=ids.map(id=>({id})),edges=links.map(([from,to,roleId='child'])=>({from,to,roleId})),t=topology(nodes,edges);
  return {id:'r',sourceStructureId:'storage',roleIds:['lo','hi'],nodes,edges,rootNodeIds:root?[root]:[],alive:true,complete,
    terminalNodeIds:[],topology:{...t,rootNodeId:root,status:complete?'tree':'partial',sharedChildren:[]},...options};
}
const full=()=>relation(['root','left','right'],[['root','left','lo'],['root','right','hi']]);
const colors=values=>({color:{redValue:'11',blackValue:'7',values:Object.entries(values).map(([nodeId,value])=>({nodeId,value}))}});
const check=(r,expected,extra={})=>evaluateStructureConditions(r,{expected,...extra});
function order(values){return {nodes:Object.entries(values).map(([id,value])=>({id,value,keyRange:{objectId:id,offset:0,size:4}})),
  contracts:[{roleId:'lo',direction:'less',duplicates:'excluded-by-insertion-rule'},{roleId:'hi',direction:'greater',duplicates:'excluded-by-insertion-rule'}]};}

test('conditions compose; matching shape alone does not establish key or colour roles',()=>{
  const r=full();assert.equal(check(r,'binary-tree').assessment,'satisfied-observed');
  assert.equal(check(r,'avl-balance').assessment,'satisfied-observed');
  assert.equal(check(r,'avl').assessment,'not-checkable');
  assert.equal(check(r,'red-black').assessment,'not-checkable');
  const got=check(r,'red-black',{order:order({root:'20',left:'10',right:'30'}),properties:colors({root:'7',left:'11',right:'11'})});
  assert.equal(got.assessment,'satisfied-observed');
  assert.deepEqual(got.checks.map(c=>c.conditionId),['forest','tree','binary-tree','bst-order','red-black-rules','red-black']);
  assert.equal(got.intent,'unconfirmed');
});

test('known shape violations survive, partial and absent history cannot pass',()=>{
  assert.equal(check(relation(['a','b'],[['a','b'],['b','a']]),'tree').assessment,'contradicted');
  assert.equal(check(relation(['a','b','c','d'],[['a','b'],['a','c'],['b','d'],['c','d']]),'tree').assessment,'contradicted');
  const dag=relation(['a','b','c','d'],[['a','b'],['a','c'],['b','d'],['c','d']]);
  assert.equal(check(dag,'dag').assessment,'satisfied-observed');
  assert.equal(check(relation(['a','b'],[]),'forest').assessment,'satisfied-observed');
  assert.equal(check(relation(['a','b'],[]),'tree').assessment,'contradicted');
  assert.equal(check({...full(),complete:false},'red-black').assessment,'incomplete');
  assert.equal(check({...full(),historyGap:true},'tree').assessment,'incomplete');
  assert.equal(check(relation(['a','b'],[],{complete:false}),'tree').assessment,'incomplete');
  assert.equal(check({...dag,roleComplete:false},'tree').assessment,'incomplete');
  assert.equal(check({...full(),alive:false},'tree').assessment,'ended');
  assert.equal(check(full(),'invented-condition').assessment,'not-checkable');
});

test('AVL shape and stale optional height cache are separate checks',()=>{
  const skew=relation(['a','b','c'],[['a','b'],['b','c']]);
  const a=check(skew,'avl-balance');assert.equal(a.assessment,'contradicted');assert.equal(a.warnings[0].nodeId,'a');
  const b=check(full(),'avl-balance',{properties:{height:{values:[{nodeId:'root',value:'2'},{nodeId:'left',value:'3'},{nodeId:'right',value:'1'}]}}});
  assert.equal(b.assessment,'satisfied-observed');assert.equal(b.checks.at(-1).storedHeightCheck.status,'violated');
  assert.deepEqual(b.checks.at(-1).storedHeightCheck.violations.map(v=>v.nodeId),['left']);
  const edgeHeights={height:{leafHeight:0,values:[{nodeId:'root',value:'1'},{nodeId:'left',value:'0'},{nodeId:'right',value:'0'}]}};
  assert.equal(check(full(),'avl-balance',{properties:edgeHeights}).checks.at(-1).storedHeightCheck.status,'satisfied-observed');
});

test('red-black checks detect each invariant and do not require AVL balance',()=>{
  for(const [values,code]of [
    [{root:'11',left:'7',right:'7'},'red-black-root-color'],
    [{root:'7',left:'7',right:'11'},'red-black-black-height'],
    [{root:'7',left:'19',right:'11'},'red-black-invalid-color'],
  ])assert.ok(check(full(),'red-black-rules',{properties:colors(values)}).warnings.some(w=>w.code===code));
  const r=relation(['a','b','c','d'],[['a','b'],['a','d'],['b','c']]);
  assert.ok(check(r,'red-black-rules',{properties:colors({a:'7',b:'11',c:'11',d:'11'})}).warnings.some(w=>w.code==='red-black-red-child'));
  const missing=check(full(),'red-black-rules',{properties:colors({root:'7',left:'11',right:null})});assert.equal(missing.assessment,'incomplete');
  // Valid RB tree: left branch height 1, right branch height 3. It is not AVL.
  const rb=relation(['a','b','c','d','e','f','g'],[['a','b'],['a','c'],['c','d'],['c','e'],['d','f'],['e','g']]);
  assert.equal(check(rb,'avl-balance').assessment,'contradicted');
  assert.equal(check(rb,'red-black-rules',{properties:colors({a:'7',b:'7',c:'11',d:'7',e:'7',f:'11',g:'11'})}).assessment,'satisfied-observed');
});

test('physical terminal colour is checked without making it a data node',()=>{
  const r={...full(),terminalNodeIds:['nil']};
  assert.equal(check(r,'red-black-rules',{properties:colors({root:'7',left:'11',right:'11'})}).assessment,'incomplete');
  assert.equal(check(r,'red-black-rules',{properties:colors({root:'7',left:'11',right:'11',nil:'7'})}).assessment,'satisfied-observed');
  assert.ok(check(r,'red-black-rules',{properties:colors({root:'7',left:'11',right:'11',nil:'11'})}).warnings.some(w=>w.code==='red-black-terminal-color'));
  assert.equal(r.nodes.length,3);
});

async function run(source,stdout){
  const r=await traceModel('#include <stdio.h>\n'+source,{filename:'relation-composition.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,stdout);
  assert.equal(r.inference.status,'completed',JSON.stringify(r.inference.diagnostics));return r;
}
const at=(t,tag)=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(tag)).eventId;
const slot=(t,name)=>({objectId:t.objects.find(o=>o.name===name).id});
const pointerSource=`typedef struct R{unsigned tone;int k;struct R*p,*q;}R;
int walk(R*r){return r?1+walk(r->p)+walk(r->q):0;}
int seek(R*r,int x){while(r){if(x==r->k)return 1;r=x<r->k?r->p:r->q;}return 0;}
int main(void){R a[3]={{16,20,0,0},{33,10,0,0},{49,30,0,0}};a[0].p=a+1;a[0].q=a+2;R*seed=a;
printf("A %d\\n",walk(seed)+seek(seed,10)+seek(seed,30));
a[0].tone|=1;printf("B %d\\n",walk(seed));
a[0].tone&=~1U;a[1].tone&=~1U;printf("C %d\\n",walk(seed));
a[2].tone&=~1U;printf("D %d\\n",walk(seed));
a[1].k=25;printf("E %d\\n",walk(seed));return 0;}`;

test('record storage: masks, changing colours, key violations, scoped recommendations, manual intent and immutable IR',async()=>{
  const r=await run(pointerSource,'A 5\nB 3\nC 3\nD 3\nE 3\n'),t=r.trace,before=JSON.stringify(r),target=slot(t,'seed'),
    A=at(t,'A'),candidate=queryBSTOrder(t,{target,afterExecutionId:A}).candidates[0].candidateId,
    binding={color:{kind:'record',offset:0,size:4,mask:'1',redValue:'1',blackValue:'0'}},
    query=(tag,expected='red-black',bindings=binding)=>queryStructureConditions(t,{target,candidateId:candidate,afterExecutionId:at(t,tag),expected,bindings});
  const rel=queryStructureRelations(t,{target,candidateId:candidate,afterExecutionId:A}).relations;
  assert.equal(rel.length,1);assert.equal(rel[0].nodes.length,3);assert.equal(rel[0].edges.length,2);
  assert.equal(query('A').assessment,'satisfied-observed');
  assert.ok(query('B').warnings.some(w=>w.code==='red-black-root-color'));
  assert.ok(query('C').warnings.some(w=>w.code==='red-black-black-height'));
  assert.equal(query('D').assessment,'satisfied-observed');
  assert.equal(query('E').assessment,'contradicted');assert.ok(query('E').warnings.some(w=>w.code==='bst-ancestor-order'));
  assert.equal(query('E','red-black-rules').assessment,'satisfied-observed');
  assert.equal(query('A','red-black',null).assessment,'not-checkable');
  assert.equal(query('A','custom-unknown').assessment,'not-checkable');
  const prefs=setStructurePresentation(null,t,{target,view:'red-black',roleIds:rel[0].roleIds,conditionBindings:binding}),
    shown=resolveStructurePresentation(t,{target,afterExecutionId:at(t,'B'),preferences:JSON.parse(JSON.stringify(prefs))});
  assert.equal(shown.mode,'manual');assert.equal(shown.view,'red-black');assert.equal(shown.expectationCheck.assessment,'contradicted');
  const auto=resolveStructurePresentation(t,{target,afterExecutionId:A});assert.equal(auto.view,'bst');
  assert.ok(auto.expectationCheck.candidates.every(c=>c.candidateId===auto.inferredCandidateId));
  assert.ok(!recommendStructureViews(t,{target,afterExecutionId:A}).some(c=>['avl','red-black'].includes(c.view)));
  assert.equal(queryStructureConditions(t,{target,candidateId:candidate,afterExecutionId:t.events[0].eventId,expected:'red-black',bindings:binding}).assessment,'not-checkable');
  assert.equal(queryStructureConditions(t,{target:{structureId:'unrelated'},candidateId:candidate,afterExecutionId:A,expected:'bst-order'}).assessment,'not-checkable');
  // Output objects cannot modify the recorded source nodes either.
  rel[0].nodes[0].range.offset=999;assert.equal(JSON.stringify(r),before);
  const corrupt=structuredClone(t),semantic=corrupt.structures.find(s=>s.id===candidate);
  semantic.states[0].relation.afterExecutionId=t.events.at(-1).eventId;
  assert.throws(()=>validateBSTOverlays(corrupt),/condition relation/);
  const omitted=structuredClone(t),limited=omitted.structures.find(s=>s.id===candidate);
  limited.coverage.omittedStates=1;limited.states=limited.states.filter(s=>t.events.findIndex(e=>e.eventId===s.afterExecutionId)<=t.events.findIndex(e=>e.eventId===A));
  assert.equal(queryStructureConditions(omitted,{target,candidateId:candidate,afterExecutionId:at(t,'E'),expected:'avl'}).assessment,'incomplete');
  assert.throws(()=>queryStructureConditions(t,{target,expected:'red-black',bindings:{color:{kind:'record',offset:0,size:4,redValue:1,blackValue:1}}}),/서로 다른/);
});

test('separate arrays use the same BST and RB conditions with explicit non-boolean encoding',async()=>{
  const r=await run(`int keys[3]={20,10,30},a[3]={1,-9,-9},b[3]={2,-9,-9};unsigned flags[3]={17,29,29};
int walk(int p){if(p<0)return 0;return 1+walk(a[p])+walk(b[p]);}
int seek(int p,int k){while(p>=0){if(k==keys[p])return 1;p=k<keys[p]?a[p]:b[p];}return 0;}
int main(void){int seed=0;printf("A %d\\n",walk(seed)+seek(seed,10)+seek(seed,30));return 0;}`,'A 5\n');
  const t=r.trace,target=slot(t,'seed'),A=at(t,'A'),q=queryBSTOrder(t,{target,afterExecutionId:A});
  assert.equal(q.assessment,'satisfied-observed');
  const array=t.structures.find(s=>s.kind==='array'&&s.objectId===slot(t,'flags').objectId);
  const got=queryStructureConditions(t,{target,candidateId:q.candidates[0].candidateId,afterExecutionId:A,expected:'red-black',
    bindings:{color:{kind:'array',arrayId:array.id,redValue:'29',blackValue:'17'}}});
  assert.equal(got.assessment,'satisfied-observed');assert.equal(got.candidates[0].relation.nodes.length,3);
  assert.deepEqual(got.candidates[0].properties.color.values.map(v=>v.value).sort(),['17','29','29']);
});
