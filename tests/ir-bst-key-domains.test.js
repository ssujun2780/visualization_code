import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {observedKeyDomainCases} from './fixtures/bst-key-domains.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,queryBSTOrder,recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
import {validateBSTOverlays} from '../scripts/inference/bst-contract.mjs';
import {comparePayload,scalarPayload,scalarFromBytes,preservesNumericOrder} from '../scripts/inference/scalar-domain.mjs';
import {keyMemory} from '../scripts/inference/key-memory.mjs';
import {checkBSTOrder} from '../scripts/inference/structure-conditions.mjs';
const out=process.env.BST_DOMAIN_AUDIT_DIR;
for(const c of observedKeyDomainCases)test(`observed key domain: ${c.id}`,async()=>{
 if(out){await fs.mkdir(out,{recursive:true});await fs.writeFile(`${out}/${c.id}.c`,c.source);await fs.writeFile(`${out}/${c.id}.expected.json`,JSON.stringify({stdout:c.stdout,states:c.expected}));}
 const r=await traceModel(c.source,{filename:`${c.id}.c`});assert.equal(r.trace.status,'completed',r.stderr);assert.equal(r.stdout,c.stdout);
 const before=JSON.stringify({plan:r.plan,trace:r.trace}),inference=inferStructures(r.plan,r.trace),t={...r.trace,structures:inference.structures};
 if(out){await fs.writeFile(`${out}/${c.id}.execution.json`,JSON.stringify({plan:r.plan,trace:r.trace,stdout:r.stdout}));await fs.writeFile(`${out}/${c.id}.inference.json`,JSON.stringify(inference));}
 assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(JSON.stringify({plan:r.plan,trace:r.trace}),before);
 const target={objectId:t.objects.find(o=>o.name==='root').id},actual={};
 for(const [label,expected]of Object.entries(c.expected)){
  const afterExecutionId=t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId,q=queryBSTOrder(t,{target,afterExecutionId});
  actual[label]=q.assessment;assert.equal(q.assessment,expected,`${c.id} ${label}`);
  const recommendations=recommendStructureViews(t,{target,afterExecutionId});assert.ok(recommendations.length<=5);
  assert.equal(recommendations.some(r=>r.view==='bst'),expected==='satisfied-observed');
  const preferences=setStructurePresentation(null,t,{target,view:'bst'}),manual=resolveStructurePresentation(t,{target,preferences,afterExecutionId});
  assert.equal(manual.view,'bst');assert.equal(manual.mode,'manual');assert.equal(manual.expectationCheck.assessment,expected);
 }
 if(out)await fs.writeFile(`${out}/${c.id}.actual.json`,JSON.stringify({stdout:r.stdout,states:actual}));
 validateBSTOverlays(t,r.plan);
 const s=t.structures.find(s=>s.kind==='ordered-tree-candidate'&&s.states.some(s=>s.status==='satisfied-observed'));
 if(s){const corrupt=structuredClone(t),state=corrupt.structures.find(x=>x.id===s.id).states.find(x=>x.status==='satisfied-observed'),node=state.nodes[0],component=node.components?.[0]??node;
  component.payload.value='forged';assert.throws(()=>validateBSTOverlays(corrupt,r.plan),/typed key payload/);
  assert.notEqual(queryBSTOrder(t,{target,afterExecutionId:t.events[0].eventId}).assessment,'satisfied-observed');}
});

test('shared scalar domain keeps precision, unordered values and safe conversion boundaries',()=>{
 const i=value=>({kind:'integer',value}),f=value=>({kind:'float',value});
 assert.equal(comparePayload(i('9007199254740993'),f('9007199254740992')).sign,1);
 assert.equal(comparePayload(i('5'),f('5.5')).sign,-1);assert.equal(comparePayload(f('-0'),f('0')).sign,0);
 assert.equal(comparePayload(f('Infinity'),f('1')).sign,1);assert.equal(comparePayload(f('NaN'),f('1')).status,'unordered');
 assert.equal(scalarPayload({type:'double',number:'1.25',cType:{sizeBits:64,encoding:'DW_ATE_float'}}).value,'1.25');
 assert.equal(scalarPayload({type:'double'}),null);
 const int={sizeBits:32,signedness:'signed'},double={sizeBits:64,encoding:'DW_ATE_float'},float={sizeBits:32,encoding:'DW_ATE_float'};
 assert.ok(preservesNumericOrder(int,double));assert.ok(!preservesNumericOrder(int,float));assert.ok(!preservesNumericOrder(double,int));
 assert.ok(!preservesNumericOrder({...int,sizeBits:64},double));assert.ok(!preservesNumericOrder(double,float));
 assert.equal(scalarFromBytes([0,0,192,63],float).value,'1.5');assert.equal(scalarFromBytes([0,null,192,63],float),null);
});

test('string snapshots preserve byte identity, invalidate unknown writes and respect lifetime',()=>{
 const target={objectId:'o',offset:0,size:4},events=[
  {eventId:'a',kind:'SPACE',objectId:'o',memoryState:{byteLength:4,ranges:[{offset:0,length:4,initialization:'initialized',data:{encoding:'hex',bytesHex:'61620000'}}]}},
  {eventId:'b',kind:'WRITE',target:{...target,size:1},value:{bits:'0x78'}},
  {eventId:'c',kind:'WRITE',target:{...target,offset:1,size:1}},
  {eventId:'d',kind:'SPACE',action:'free',objectId:'o'}
 ],memory=keyMemory({events,objects:[{id:'o',size:4,createdBy:'a',endedBy:'d'}]});
 assert.equal(memory.string(target,0).value,'ab');assert.equal(memory.string(target,1).value,'xb');
 assert.equal(memory.string(target,2),null);assert.equal(memory.string(target,3),null);
 assert.equal(memory.string(target,0).value,'ab'); // historical query must replay
});

test('a lone unordered key cannot satisfy BST order',()=>{
 const r=checkBSTOrder({relation:{alive:true,complete:true,edges:[],topology:{rootNodeId:'n',status:'tree'}},nodes:[{id:'n',value:'NaN',payload:{kind:'float',value:'NaN'}}],contracts:[]});
 assert.equal(r.status,'incomplete');
});

test('unobserved reads and bounded unterminated snapshots never manufacture a string key',()=>{
 const range={objectId:'o',offset:0,size:1},events=[{eventId:'a',kind:'SPACE',objectId:'o'},
  {eventId:'b',kind:'READ',target:range,value:{bits:'0'},initializationEvidence:'unobserved'}],objects=[{id:'o',size:300,createdBy:'a'}],limits=[];
 assert.equal(keyMemory({events,objects}).string(range,1),null);
 events.push({eventId:'c',kind:'WRITE',target:{...range,size:300},memoryState:{byteLength:300,ranges:[{offset:0,length:299,initialization:'initialized',data:{encoding:'fill',byte:97}},{offset:299,length:1,initialization:'initialized',data:{encoding:'fill',byte:0}}]}});
 assert.equal(keyMemory({events,objects,inferenceBudget:{report:(...args)=>limits.push(args)}}).string({objectId:'o',offset:0},2),null);
 assert.equal(limits[0][0],'string-key-bytes');
});
