import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedStructures} from '../scripts/inference/linked-views.mjs';
import {linkedRootCollections} from '../scripts/inference/linked-root-collections.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';

function fixture(){
  const integer={id:'int',kind:'integer',sizeBits:32,signedness:'unsigned'},record={id:'node-alias',kind:'record',recordTypeId:'record-N',sizeBits:64,members:[]},
    pointer={id:'node-pointer',kind:'pointer',pointee:record,sizeBits:32},dataType={id:'pointer-pointer',kind:'pointer',pointee:pointer,sizeBits:32},
    ownerType={id:'owner',kind:'record',recordTypeId:'record-O',sizeBits:96,members:[]};
  const field=(id,offset,cType)=>({fieldNodeId:id,recordTypeId:'record-O',offset,size:4,cType}),
    data=field('data',8,dataType),capacity=field('capacity',4,integer),count=field('count',0,integer),
    member=f=>({nodeId:f.fieldNodeId,kind:'MemberExpr',fieldNodeId:f.fieldNodeId,cType:f.cType,targetPath:[{offsetBits:f.offset*8,sizeBits:32}],children:[{cType:ownerType}]}),
    role={id:'owner-role',recordTypeId:'record-O',data,capacity,cardinalityCandidates:[count],nodeRecordTypeId:'record-N',evidence:[]},
    instructions=[{id:'index',cType:pointer,expression:{nodeId:'index',kind:'ArraySubscriptExpr',cType:pointer,children:[]}},
      ...[data,capacity,count].map(f=>({id:f.fieldNodeId,cType:f.cType,expression:member(f)})),{id:'link',cType:pointer}],
    plan={instructions,declarations:[],structureBindings:{linkRoles:[{recordTypeId:'record-N',fieldNodeId:'next',offset:4,size:4,recordType:record,cType:pointer}],
      linkRootFields:[role],indexedStorageRoles:[role]}},
    objects=[{id:'owner',address:500,size:12,cType:ownerType},{id:'old',address:100,size:8,cType:null},{id:'new',address:200,size:16,cType:null},
      {id:'n1',address:300,size:8,cType:record},{id:'n2',address:400,size:8,cType:record},{id:'reuse',address:100,size:8,cType:record}].map(o=>({...o,storage:'heap'})),
    arrays=['old','new'].map(id=>{const o=objects.find(o=>o.id===id);return {id:`array-${id}`,kind:'array',objectId:id,range:{objectId:id,offset:0,size:o.size},elementType:pointer,elementBytes:4};}),events=[];
  function event(e){const row={eventId:`x${events.length+1}`,...e};events.push(row);return row.eventId;}
  const begin=id=>event({kind:'SPACE',action:'object.begin',objectId:id}),
    ptr=(id,offset,to,instructionId='index',kind='WRITE')=>event({kind,instructionId,target:{objectId:id,offset,size:4},value:{cType:instructionId==='data'?dataType:pointer,
      address:to?objects.find(o=>o.id===to).address:0,reference:{status:to?'in-bounds':'null',targetObjectId:to,targetOffset:0}}}),
    scalar=(f,value)=>event({kind:'WRITE',instructionId:f.fieldNodeId,target:{objectId:'owner',offset:f.offset,size:4},value:{cType:integer,unsigned:String(value)}});
  for(const id of ['owner','old','n1','n2'])begin(id);
  ptr('n1',4,null,'link');ptr('n2',4,null,'link');ptr('n1',4,null,'link','READ');
  ptr('old',0,null);ptr('old',4,'n1');ptr('owner',8,'old','data');scalar(capacity,2);scalar(count,1);
  begin('new');for(let offset=0;offset<16;offset+=4)ptr('new',offset,null);
  ptr('n2',4,'n1','link');const sharing=ptr('new',12,'n2');
  const freed=event({kind:'SPACE',action:'object.end',objectId:'old'}),reused=begin('reuse');
  const switched=ptr('owner',8,'new','data');scalar(capacity,4);const counted=scalar(count,2);
  const pending=event({kind:'WRITE',target:{objectId:'owner',offset:9,size:1},memoryState:{byteLength:1,ranges:[{offset:0,length:1,initialization:'pending'}]}});
  ptr('owner',8,'new','data');
  const unknownSlot=event({kind:'WRITE',target:{objectId:'new',offset:12,size:1},memoryState:{byteLength:1,ranges:[{offset:0,length:1,initialization:'unknown'}]}});
  return {plan,events,objects,views:[],arrays,markers:{sharing,freed,reused,switched,counted,pending,unknownSlot}};
}
const at=(states,id,events)=>states.findLast(s=>events.findIndex(e=>e.eventId===s.afterExecutionId)<=events.findIndex(e=>e.eventId===id));

test('heap roots retain null slots, simultaneous sharing, ended pointer origins and unknown recorded bytes',()=>{
  const f=fixture(),linked=linkedStructures(f.plan,f),collections=linkedRootCollections(f.plan,{...f,linked}),
    old=collections.find(c=>c.objectId==='old'),next=collections.find(c=>c.objectId==='new'),owner=collections.find(c=>c.scope==='owner-field');
  assert.deepEqual(linked.filter(c=>c.root.objectId==='old').map(c=>c.root.offset).sort(),[0,4]);
  assert.deepEqual(linked.filter(c=>c.root.objectId==='new').map(c=>c.root.offset).sort((a,b)=>a-b),[0,4,8,12]);
  assert.equal(old.capacity,2);assert.equal(next.capacity,4);
  assert.equal(at(old.states,f.markers.sharing,f.events).sharedMembers[0].nodeIds.length,1);
  assert.equal(at(next.states,f.markers.sharing,f.events).sharedMembers[0].nodeIds.length,1);
  for(const marker of [f.markers.freed,f.markers.reused]){
    const state=at(owner.states,marker,f.events);assert.equal(state.pointerStatus,'ended-target');
    assert.equal(state.pointerReference.targetObjectId,'old');assert.equal(state.storageAlive,false);assert.deepEqual(state.reachableMembers,[]);
  }
  const state=at(owner.states,f.markers.counted,f.events);assert.equal(state.capacity,4);assert.equal(state.reachableNodeCount,2);
  assert.equal(state.cardinalityCandidates[0].value,2);assert.equal(state.cardinalityCandidates[0].activePrefix,false);
  assert.equal(at(owner.states,f.markers.pending,f.events).pointerStatus,'unknown');
  assert.equal(at(next.states,f.markers.unknownSlot,f.events).status,'partial');
  assert.equal(at(next.states,f.markers.unknownSlot,f.events).unknownSlotCount,1);
  assert.equal(owner.backingHistory.length,2);
});

test('unindexed or out-of-range pointer observations do not manufacture heap root collections',()=>{
  const f=fixture();f.plan.instructions.find(d=>d.id==='index').expression={nodeId:'plain',kind:'DeclRefExpr',cType:f.arrays[0].elementType};
  const linked=linkedStructures(f.plan,f);assert.deepEqual(linkedRootCollections(f.plan,{...f,linked}),[]);
  const g=fixture();for(const e of g.events)if(e.instructionId==='index')e.target.offset=1000;
  assert.deepEqual(linkedRootCollections(g.plan,{...g,linked:linkedStructures(g.plan,g)}),[]);
});

test('observed empty roots survive without traversal while untouched capacity stays unknown',()=>{
  const f=fixture();f.events=f.events.filter(e=>e.action==='object.begin'||e.target?.objectId==='new'&&e.target.offset===0&&e.value?.reference?.status==='null');
  const linked=linkedStructures(f.plan,f),collections=linkedRootCollections(f.plan,{...f,linked}),range=collections.find(c=>c.objectId==='new');
  assert.ok(range);assert.equal(range.rootStructureIds.length,1);
  assert.equal(range.states.at(-1).observedSlotCount,1);assert.equal(range.states.at(-1).unknownSlotCount,3);
  assert.equal(range.states.at(-1).roots[0].status,'null');assert.equal(range.states.at(-1).status,'partial');
  assert.equal(linked.find(c=>c.root.objectId==='new').roles.length,0);
  const empty=linked.find(c=>c.root.objectId==='new');
  assert.deepEqual(empty.candidateRoles.map(r=>r.fieldNodeId),['next']);
  assert.deepEqual(empty.traversalRoles,[]);
});

test('renamed aliases and reordered owner fields bind malloc roots through observed modulo indexing',async()=>{
  const source=`#include <stdlib.h>
#include <stdio.h>
typedef struct X {struct X *z;unsigned k;} X;
typedef X *Entry;
typedef struct {unsigned used;Entry *storage;unsigned limit;} O;
int total(O *o,unsigned key){int result=0;for(X *p=o->storage[key%o->limit];p;p=p->z)result+=(int)p->k;return result;}
int main(void){O o={0};o.limit=4;o.storage=malloc(o.limit*sizeof *o.storage);if(!o.storage)return 1;
for(unsigned j=0;j<o.limit;j++)o.storage[j]=0;
X a={0,3},b={&a,7};o.storage[3]=&b;o.used++;o.used++;
if(o.used==o.limit)o.used--;printf("%d\\n",total(&o,7));free(o.storage);o.storage=0;return 0;}`;
  const r=await traceModel(source);assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'10\n');
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  const ranges=r.trace.structures.filter(s=>s.kind==='linked-root-collection'&&s.scope==='backing-range'),
    owner=r.trace.structures.find(s=>s.kind==='linked-root-collection'&&s.scope==='owner-field');
  assert.equal(ranges.length,1);assert.equal(ranges[0].rootStructureIds.length,4);assert.ok(owner);
  assert.equal(owner.role.data.offset,4);assert.equal(owner.role.capacity.offset,8);
  assert.ok(owner.states.some(s=>s.capacity===4&&s.reachableNodeCount===2&&s.cardinalityCandidates.some(c=>c.value===2&&c.activePrefix===false)));
  assert.ok(ranges[0].states.some(s=>s.roots.some(r=>r.index===3&&r.reachableMembers.length===2)));
  assert.equal(r.trace.structures.filter(s=>s.kind==='indexed-graph').length,0);
});
