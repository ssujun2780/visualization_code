import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arrayCursorPathStructures,validateArrayCursorPaths} from '../scripts/model/array-cursor-paths.mjs';
const value=n=>({decimal:String(n)}),scalar={sizeBits:32,signedness:'signed'},row={kind:'array',count:4,sizeBits:128,elementType:scalar};
function fixture(){
  const events=[],instructions=[],objects=[{id:'a',size:48,createdBy:'a0',endedBy:'end'}];
  function add(id,kind,extra={}){const e={eventId:id,instructionId:id,activationId:'f',kind,...extra};events.push(e);instructions.push({id,...extra.definition});return e;}
  add('a0','SPACE',{action:'object.begin',objectId:'a'});
  for(const [id,decl]of [['u','du'],['v','dv']]){objects.push({id,size:4,cType:scalar,createdBy:id+'0',endedBy:'end'});
    add(id+'0','SPACE',{action:'object.begin',objectId:id});}
  const write=(id,obj,n)=>add(id,'WRITE',{action:'write',target:{objectId:obj,offset:0,size:4},value:value(n)}),
    read=(id,obj,n)=>add(id,'READ',{action:'read',target:{objectId:obj,offset:0,size:4},value:value(n)});
  write('u1','u',2);write('v1','v',3);
  read('ur','u',2);read('vr','v',3);
  add('guard','CALC',{dataInputs:['ur','vr'],value:value(1)});
  add('loop','FLOW',{action:'branch',dataInputs:['guard'],condition:value(1),definition:{controlKind:'WhileStmt',sourceNodeId:'loop-node'}});
  add('cell','READ',{action:'read',target:{objectId:'a',offset:28,size:4},value:value(7)});
  write('u2','u',1);write('v2','v',2);
  add('end','SPACE',{action:'frame.end'});
  const array={id:'array',kind:'array',objectId:'a',range:{objectId:'a',offset:0,size:48},capacity:3,elementBytes:16,elementType:row},
    axes=[{axis:0,indexDeclarationIds:['du'],index:{declarationId:'du',offset:-1}},
      {axis:1,indexDeclarationIds:['dv'],index:{declarationId:'dv',offset:0}}],
    access={executionId:'cell',activationId:'f',sourceNodeIds:['site'],accessSiteNodeId:'site',axes,
      target:{objectId:'a',arrayId:'array',coordinates:[1,3]},
      cursors:[{declarationId:'du',objectId:'u',executionId:'ur',value:2},{declarationId:'dv',objectId:'v',executionId:'vr',value:3}]},
    work={kind:'array-work',accesses:[access]},plan={instructions,structureBindings:{arrayWork:{accesses:[{nodeId:'site',axes}]}}};
  return {plan,events,objects,structures:[array,work],access,axes};
}

test('axis identities associate raw cursor states without collapsing sequential writes',()=>{
  const f=fixture(),before=JSON.stringify(f.events),[path]=arrayCursorPathStructures(f.plan,f);
  assert.ok(path);assert.equal(path.lifecycle,'ended');
  assert.deepEqual(path.states.filter(s=>s.reason==='cursor.write').map(s=>s.coordinates),[[2,null],[2,3],[1,3],[1,2]]);
  assert.deepEqual(path.loopBoundaries.map(s=>s.coordinates),[[2,3]]);
  assert.deepEqual(path.accessSnapshots[0].coordinates,[2,3]);
  assert.deepEqual(path.accessSnapshots[0].cellCoordinates,[1,3]);
  assert.equal(path.states[0].status,'partial');assert.equal(path.states.at(-1).status,'ended');
  assert.equal(path.sites[0].axes[0].index.offset,-1);
  assert.equal(JSON.stringify(f.events),before);
});

test('cursor values outside the array remain positions rather than memory-fault claims',()=>{
  const f=fixture();f.events.find(e=>e.eventId==='u2').value=value(8);
  const [path]=arrayCursorPathStructures(f.plan,f),state=path.states.find(s=>s.afterExecutionId==='u2');
  assert.equal(state.positionStatus,'outside');assert.equal(state.status,'observed');
  assert.deepEqual(state.coordinates,[8,3]);
});

test('ambiguous axis formulas do not invent cursor pair roles',()=>{
  const f=fixture();f.axes[0].indexDeclarationIds=['du','other'];
  assert.deepEqual(arrayCursorPathStructures(f.plan,f),[]);
});

test('different cursor storage lifetimes form separate paths despite matching declaration names',()=>{
  const f=fixture();
  f.objects.push({id:'v-next',size:4,cType:scalar,createdBy:'next0',endedBy:'end'});
  const index=f.events.findIndex(e=>e.eventId==='end');
  f.events.splice(index,0,{eventId:'next0',instructionId:'next0',activationId:'f',kind:'SPACE',action:'object.begin',objectId:'v-next'},
    {eventId:'next1',instructionId:'next1',activationId:'f',kind:'WRITE',action:'write',target:{objectId:'v-next',offset:0,size:4},value:value(1)},
    {eventId:'next-read',instructionId:'next-read',activationId:'f',kind:'READ',action:'read',target:{objectId:'v-next',offset:0,size:4},value:value(1)},
    {eventId:'cell-next',instructionId:'cell-next',activationId:'f',kind:'READ',action:'read'});
  f.structures[1].accesses.push({...f.access,executionId:'cell-next',cursors:[f.access.cursors[0],{declarationId:'dv',objectId:'v-next',executionId:'next-read',value:1}]});
  const paths=arrayCursorPathStructures(f.plan,f);assert.equal(paths.length,2);
  assert.notEqual(paths[0].id,paths[1].id);assert.equal(paths[1].cursors[1].objectId,'v-next');
});

test('array, pointer and partial-object index sources cannot masquerade as scalar cursors',()=>{
  for(const kind of ['array','record','pointer']){
    const f=fixture();f.objects.find(o=>o.id==='u').cType={...scalar,kind};
    assert.deepEqual(arrayCursorPathStructures(f.plan,f),[]);
  }
  const f=fixture();f.events.find(e=>e.eventId==='ur').target.size=2;
  assert.deepEqual(arrayCursorPathStructures(f.plan,f),[]);
});

test('missing creation metadata starts from observed scalar reads with a partial initial position',()=>{
  const f=fixture();for(const o of f.objects.filter(o=>['u','v'].includes(o.id)))delete o.createdBy;
  const paths=arrayCursorPathStructures(f.plan,f);f.structures.push(...paths);
  assert.equal(paths.length,1);assert.equal(paths[0].states[0].reason,'cursor.observed');
  assert.deepEqual(paths[0].states[0].coordinates,[2,null]);assert.equal(paths[0].states[0].status,'partial');
  assert.equal(validateArrayCursorPaths(f.plan,f),true);
});

test('cursor validation rejects fabricated positions, lifetimes and missing execution ids',()=>{
  const f=fixture();f.structures.push(...arrayCursorPathStructures(f.plan,f));
  assert.equal(validateArrayCursorPaths(f.plan,f),true);
  for(const change of [
    p=>{p.states.find(s=>s.reason==='cursor.write').coordinates[0]=99;},
    p=>{p.states.at(-1).afterExecutionId='cell';},
    p=>{p.confirmedAt='missing';},
    p=>{p.accessSnapshots[0].cellCoordinates=[2,2];},
    p=>{p.loopBoundaries[0].conditionTruth=false;}
  ]){const copy=structuredClone(f);change(copy.structures.at(-1));assert.throws(()=>validateArrayCursorPaths(copy.plan,copy),/array-cursor-path/);}
});
