import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frozenInferenceExecution} from './helpers/frozen-inference.mjs';
import {inferStructures,createInferenceView,recommendStructureViews,queryStructureRelations,queryBSTOrder} from '../scripts/inference/index.mjs';
import {createStructureQueryTrace,structureQueryContext} from '../scripts/inference/query-index.mjs';
import {selectedStorageRanges} from '../scripts/inference/structure-storage.mjs';
import {storageRelationStructures,queryStorageReferences} from '../scripts/inference/storage-relations.mjs';
import {validateBSTOverlays} from '../scripts/inference/bst-contract.mjs';

for(const name of ['pointer-policy-lifetime','persistent-tree','full-flag-ring'])test(`query session preserves ${name} at forward/backward times`,async()=>{
 const r=await frozenInferenceExecution(name),inf=inferStructures(r.plan,r.trace),{trace}=createInferenceView(r,inf),cached=createStructureQueryTrace(trace);
 const before=JSON.stringify(trace),points=[0,Math.floor(trace.events.length/2),trace.events.length-1,Math.floor(trace.events.length/4),0];
 const objects=trace.objects.filter(o=>['array','record','pointer'].includes(o.cType?.kind)).slice(0,8);
 for(const i of points)for(const o of objects){const args={target:{objectId:o.id},afterExecutionId:trace.events[i].eventId};
  for(const query of [recommendStructureViews,queryStructureRelations,queryBSTOrder])assert.deepEqual(query(cached,args),query(trace,args),`${query.name} ${o.id} at ${i}`);
 }
 for(const i of points)for(const graph of trace.structures.filter(s=>s.kind==='storage-reference-graph')){
  const args={afterExecutionId:trace.events[i].eventId,resolvePresentation:false};
  assert.deepEqual(queryStorageReferences(graph,cached,args),queryStorageReferences(graph,trace,args));
 }
 assert.equal(JSON.stringify(trace),before);
});

test('sessions isolate pointer rebinding, ended objects and recordings with reused IDs',()=>{
 const type={kind:'pointer',sizeBits:32,pointee:{kind:'integer',sizeBits:32}},objects=[{id:'p',size:4,cType:type},{id:'a',size:4,endedBy:'x4'},{id:'b',size:4}];
 const write=(eventId,id)=>({eventId,kind:'WRITE',target:{objectId:'p',offset:0,size:4},value:{cType:type,reference:{status:'in-bounds',targetObjectId:id,targetOffset:0}}});
 const trace={objects,events:[write('x1','a'),write('x2','b'),write('x3','a'),{eventId:'x4',kind:'SPACE',action:'object.end',objectId:'a'}]},target={ranges:[{objectId:'p',offset:0,size:4}]},cached=createStructureQueryTrace(trace);
 for(const [at,expected] of [['x1','a'],['x2','b'],['x3','a'],['x4',undefined],['x1','a']]){
  assert.equal(selectedStorageRanges(target,cached,structureQueryContext(cached,at))[1]?.objectId,expected);
 }
 const next=createStructureQueryTrace({...trace,events:[write('x1','b')]});
 assert.equal(selectedStorageRanges(target,next,structureQueryContext(next,'x1'))[1].objectId,'b');
});

test('byte writes resolve pointer slots while compiler-only objects are alive',()=>{
 const type={kind:'pointer',sizeBits:32,pointee:{kind:'integer',sizeBits:32}},range={objectId:'p',offset:0,size:4};
 const events=[{eventId:'x0',instructionId:'hidden',kind:'SPACE',action:'object.begin',objectId:'temp'},
  {eventId:'x1',kind:'SPACE',action:'object.begin',objectId:'a'},
  {eventId:'x2',kind:'SPACE',action:'object.begin',objectId:'p'},
  {eventId:'x3',kind:'WRITE',target:range,value:{cType:type,address:'100',reference:{status:'in-bounds',targetObjectId:'a',targetOffset:0}}},
  {eventId:'x4',kind:'WRITE',target:range,memoryState:{byteLength:4,ranges:[{offset:0,length:4,initialization:'initialized',data:{encoding:'hex',bytesHex:'64000000'}}]}}];
 const objects=[{id:'temp',createdBy:'x0',address:50,size:4},{id:'a',createdBy:'x1',address:100,size:4},{id:'p',createdBy:'x2',address:200,size:4,cType:type}];
 const result=storageRelationStructures({instructions:[{id:'hidden',visibility:'implementation'}]},{events,objects});
 const graph=result.find(s=>s.kind==='storage-reference-graph'),edge=graph.changes.find(c=>c.afterExecutionId==='x4').upsertEdges[0];
 assert.equal(edge.reference.status,'in-bounds');assert.equal(edge.reference.targetObjectId,'a');assert.ok(graph.nodes.every(n=>n.range.objectId!=='temp'));
});

test('BST validation separates verified terminal links from ordinary self links',()=>{
 const range={objectId:'o',offset:0,size:4},edge={from:'n',to:'n',fieldNodeId:'role',termination:'sentinel'},topology={reachableNodeIds:['n'],edges:[edge]};
 const source={id:'tree',kind:'linked-structure',states:[{afterExecutionId:'x1',topology}]};
 const semantic={id:'order',kind:'ordered-tree-candidate',sourceStructureId:'tree',root:range,nodes:[],edges:[],proofs:[],key:{},states:[{afterExecutionId:'x1',contracts:[],nodes:[{id:'n',range,keyRange:range,value:null}],edges:[],violations:[],evidenceExecutionIds:[],status:'incomplete'}]};
 const trace={objects:[{id:'o',size:4}],events:[{eventId:'x1'}],structures:[source,semantic]};
 assert.doesNotThrow(()=>validateBSTOverlays(trace));
 delete edge.termination;assert.throws(()=>validateBSTOverlays(trace),/semantic edges differ/);
 semantic.states[0].edges=[{from:'n',to:'n',roleId:'role'}];assert.doesNotThrow(()=>validateBSTOverlays(trace));
 edge.termination='sentinel';assert.throws(()=>validateBSTOverlays(trace),/semantic edges differ/);
});
