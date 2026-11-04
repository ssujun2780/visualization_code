import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arrayGeometry,arrayLocation} from '../scripts/model/array-geometry.mjs';
const scalar={kind:'integer',name:'opaque',sizeBits:16},
  nested=(count,elementType)=>({kind:'array',count,elementType,sizeBits:count*elementType.sizeBits});
const view=(type,offset=0)=>({id:'array',objectId:'memory',range:{objectId:'memory',offset,size:type.sizeBits/8},
  capacity:type.count,elementBytes:type.elementType.sizeBits/8,elementType:type.elementType});

test('rectangular arbitrary-rank arrays preserve rows and expose leaf coordinates',()=>{
  const type=nested(2,nested(3,nested(4,scalar))),array=view(type),object={id:'memory',size:48,cType:type};
  const geometry=arrayGeometry(array,object);assert.equal(geometry.status,'resolved');
  assert.deepEqual(geometry.dimensions,[2,3,4]);assert.deepEqual(geometry.byteStrides,[24,8,2]);
  const cell=arrayLocation({objectId:'memory',offset:46,size:2},array,object);
  assert.deepEqual(cell.coordinates,[1,2,3]);assert.equal(cell.leafIndex,23);assert.equal(cell.accessKind,'cell');
  assert.equal(cell.index,1);assert.equal(cell.elementOffset,22);assert.equal(cell.elementBytes,24);
});

test('aggregate, partial-cell and empty accesses retain distinct extent semantics',()=>{
  const type=nested(2,nested(3,nested(4,scalar))),array=view(type),object={id:'memory',size:48,cType:type};
  const locate=(offset,size)=>arrayLocation({objectId:'memory',offset,size},array,object);
  const row=locate(40,8);assert.equal(row.accessKind,'cell-range');assert.equal(row.cellCount,4);
  assert.deepEqual(row.coordinates,[1,2,0]);assert.deepEqual(row.endCoordinates,[1,2,3]);
  assert.equal(locate(47,1).accessKind,'partial-cell');assert.equal(locate(41,5).accessKind,'partial-range');
  assert.equal(locate(48,1).accessKind,'out-of-range');assert.equal(locate(48,0).accessKind,'empty-range');
  assert.equal(locate(48,0).coordinates,null);
});

test('a typed heap row view is distinguished from a declared array and pointer cells stay leaves',()=>{
  const type=nested(3,nested(2,{...scalar,sizeBits:32})),array=view(type,8),object={id:'memory',size:40,storage:'heap'};
  const geometry=arrayGeometry(array,object);assert.deepEqual(geometry.dimensions,[3,2]);
  assert.equal(geometry.extentKind,'typed-storage-view');
  assert.deepEqual(arrayLocation({objectId:'memory',offset:28,size:4},array,object).coordinates,[2,1]);
  const pointer={kind:'pointer',sizeBits:32,pointee:nested(9,scalar)},pointerType=nested(3,pointer),p=view(pointerType);
  assert.deepEqual(arrayGeometry(p,{id:'memory',size:12,cType:pointerType}).dimensions,[3]);
});

test('incomplete and inconsistent dimensions never manufacture a grid',()=>{
  const type=nested(2,nested(3,scalar)),array=view(type),object={id:'memory',size:12};
  assert.equal(arrayGeometry({...array,capacity:3},object).status,'unresolved');
  assert.equal(arrayGeometry({...array,elementType:{kind:'array',count:null,sizeBits:48}},object).status,'unresolved');
  assert.equal(arrayGeometry(array,{...object,size:8}).status,'unresolved');
});
