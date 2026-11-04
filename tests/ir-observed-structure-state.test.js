import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arrayStructures} from '../scripts/model/array-views.mjs';
import {embeddedArrayStructures} from '../scripts/model/embedded-array-views.mjs';
import {linkedStructures} from '../scripts/model/linked-views.mjs';

const integer={id:'i32',sizeBits:32,signedness:'signed'},record={kind:'record',recordTypeId:'record',sizeBits:96,members:[]},
  pointer={id:'ptr',kind:'pointer',sizeBits:32,pointee:integer};
const snapshot=(bytes,initialized=true)=>({byteLength:bytes.length,ranges:[{offset:0,length:bytes.length,
  initialization:initialized?'initialized':'uninitialized',...(initialized?{data:{encoding:'hex',bytesHex:bytes.map(n=>n.toString(16).padStart(2,'0')).join('')}}:{})}]});
const begin=(id,objectId,memoryState)=>({eventId:id,kind:'SPACE',action:'object.begin',objectId,...(memoryState?{memoryState}:{})});
const write=(id,objectId,offset,bytes,initialized=true)=>({eventId:id,kind:'WRITE',target:{objectId,offset,size:bytes.length},memoryState:snapshot(bytes,initialized)});

test('dynamic array count becomes unknown on unknown bytes and recovers after a partial byte write',()=>{
  const field=(id,offset,cType)=>({fieldNodeId:id,recordTypeId:'record',offset,size:4,cType}),
    data=field('data',0,pointer),index=field('length',4,integer),capacity=field('capacity',8,integer),
    plan={instructions:[{id:'indexed',sourceNodeId:'index'},{id:'nested-field',expression:{kind:'MemberExpr',fieldNodeId:'data',cType:pointer,
      targetPath:[{offsetBits:0,sizeBits:32}],children:[{cType:{kind:'pointer',pointee:record}}]}}],declarations:[],
      structureBindings:{arrayRoles:[{id:'role',recordTypeId:'record',data,index,capacity,stride:{bytes:4},accessNodeId:'index',evidence:[]}]}};
  const events=[begin('e1','heap'),begin('e2','owner',snapshot([64,0,0,0,1,0,0,0,8,0,0,0])),
    {eventId:'alias',instructionId:'nested-field',kind:'WRITE',target:{objectId:'local-pointer',offset:0,size:4},value:{address:64,cType:pointer,reference:{targetObjectId:'heap',targetOffset:0}}},
    {eventId:'e3',instructionId:'indexed',kind:'WRITE',target:{objectId:'heap',offset:0,size:4}},
    write('unknown','owner',4,[0],false),write('recover','owner',4,[2]),write('negative','owner',4,[255,255,255,255])];
  const objects=[{id:'heap',address:64,size:32,storage:'heap'},{id:'owner',address:8,size:12,cType:record},{id:'local-pointer',address:32,size:4,cType:pointer}];
  const candidates=arrayStructures(plan,{events,objects,views:[]}).filter(s=>s.kind==='dynamic-array'),result=candidates[0];
  assert.equal(candidates.length,1);assert.equal(result.ownerObjectId,'owner');
  assert.ok(result);const unknown=result.states.find(s=>s.afterExecutionId==='unknown'),recovered=result.states.find(s=>s.afterExecutionId==='recover');
  assert.equal(unknown.length,null);assert.ok(unknown.unknownFields.includes('length'));assert.equal(unknown.status,'intermediate-or-unavailable');
  assert.equal(recovered.length,2);assert.equal(recovered.status,'consistent');assert.equal(result.states.at(-1).length,-1);
});

test('embedded array metadata also invalidates unknown written bytes instead of retaining its prior count',()=>{
  const count={fieldNodeId:'count',recordTypeId:'record',offset:16,size:4,cType:integer},
    ownerType={...record,sizeBits:160},data={fieldNodeId:'items',recordTypeId:'record',offset:0,size:16,cType:{kind:'array',elementType:integer,count:4}},
    plan={instructions:[],structureBindings:{embeddedArrayRoles:[{id:'embedded',recordTypeId:'record',data,fields:[count],elementBytes:4,capacity:4,accesses:[],bounds:[],evidence:[]}]}};
  const events=[begin('e1','owner',snapshot([...Array(16).fill(0),1,0,0,0])),write('unknown','owner',16,[0],false),write('recover','owner',16,[3])],
    result=embeddedArrayStructures(plan,{events,objects:[{id:'owner',address:8,size:20,cType:ownerType}],views:[]}).find(s=>s.kind==='array-structure');
  assert.equal(result.states.find(s=>s.afterExecutionId==='unknown').fieldValues.count,undefined);
  assert.equal(result.states.find(s=>s.afterExecutionId==='recover').fieldValues.count,3);
});

test('root pointer byte copies and partially invalidated links update time-specific connectivity',()=>{
  const type={...record,sizeBits:64},ptr={...pointer,pointee:type},role={fieldNodeId:'link',recordTypeId:'record',offset:4,size:4,cType:ptr,recordType:type},
    ref=targetObjectId=>({targetObjectId,targetOffset:0,status:targetObjectId?'in-bounds':'null'}),
    pwrite=(id,objectId,offset,to,address,kind='WRITE')=>({eventId:id,kind,target:{objectId,offset,size:4},value:{cType:ptr,address,reference:ref(to)}}),
    plan={declarations:[{id:'root-decl',kind:'VarDecl',cType:ptr}],instructions:[{id:'root-begin',declarationId:'root-decl'}],
      structureBindings:{linkRoles:[role],linkRecurrences:[],linkAnchors:[],linkRootDeclarations:['root-decl']}};
  const events=[{...begin('e1','root'),instructionId:'root-begin'},begin('e2','node'),pwrite('e3','root',0,'node',64),
    pwrite('e4','node',4,null,0),pwrite('e5','node',4,null,0,'READ'),write('unknown','node',4,[0],false),
    write('recover','node',4,[0]),write('clear-root','root',0,[0,0,0,0])],
    objects=[{id:'root',address:8,size:4,cType:ptr,createdBy:'e1'},{id:'node',address:64,size:8,cType:type,createdBy:'e2'}],
    result=linkedStructures(plan,{events,objects,views:[]})[0];
  assert.ok(result);assert.equal(result.states.find(s=>s.afterExecutionId==='unknown').topology.status,'partial');
  assert.equal(result.states.find(s=>s.afterExecutionId==='recover').topology.status,'tree');
  const cleared=result.states.find(s=>s.afterExecutionId==='clear-root');assert.equal(cleared.topology.status,'empty');assert.equal(cleared.detachedMembers.length,1);
});
