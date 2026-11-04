import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindArrayStructures,arrayStructures} from '../scripts/model/array-views.mjs';
import {compilerTypeIdentity} from '../scripts/model/compiler-type-identity.mjs';

const scalar={id:'debug:int',name:'int',sizeBits:32,signedness:'signed',encoding:'DW_ATE_signed'},
  record={id:'debug:r',recordTypeId:'debug:r',kind:'record',sizeBits:96,members:[{typeId:'debug:int',offsetBits:0,sizeBits:32},{typeId:'debug:ptr',offsetBits:32,sizeBits:32}]},
  ptr={id:'debug:ptr',name:'R *',kind:'pointer',sizeBits:32,pointee:record},
  rawTypes=[{id:'debug:int',name:'int',sizeBits:32,encoding:'DW_ATE_signed'},
    {id:'debug:r',tag:'DW_TAG_structure_type',sizeBits:96},
    {id:'debug:ptr',tag:'DW_TAG_pointer_type',sizeBits:32,baseType:'debug:r'},
    {id:'debug:alias',tag:'DW_TAG_typedef',baseType:'debug:int'}];
let sequence=0;
const node=(kind,children=[],extra={})=>({nodeId:`n${++sequence}`,kind,children,...extra}),
  field=(id,offset,cType=scalar)=>node('MemberExpr',[{cType:{kind:'pointer',pointee:record}}],{fieldNodeId:id,cType,memberPath:[id],targetPath:[{offsetBits:offset*8,sizeBits:cType.sizeBits}]}),
  binary=(operator,a,b)=>node('BinaryOperator',[a,b],{operator}),
  update=a=>node('UnaryOperator',[a],{operator:'++'}),
  access=(data,index)=>node('ArraySubscriptExpr',[data,index],{cType:data.cType.pointee}),
  planOf=expressions=>({instructions:expressions.map((expression,i)=>({id:`i${i}`,expression,sourceNodeId:expression.nodeId})),declarations:[],types:rawTypes,coverage:{}}),
  bind=expressions=>{const p=planOf(expressions);bindArrayStructures(p);return p.structureBindings;};

test('remainder divisor is a bound; a separately updated comparison field remains cardinality, never prefix length',()=>{
  for(const reverse of [false,true]){
    const a=field('a',8,{...ptr,pointee:ptr}),b=field('b',0),c=field('c',4),
      comparison=binary('==',...(reverse?[c,b]:[b,c])),
      s=bind([access(a,binary('%',node('DeclRefExpr',[],{declarationId:'key'}),b)),comparison,update(c)]);
    assert.equal(s.arrayRoles.length,0);assert.equal(s.indexedStorageRoles.length,1);
    const role=s.indexedStorageRoles[0];assert.equal(role.capacity.fieldNodeId,'b');
    assert.deepEqual(role.cardinalityCandidates.map(f=>f.fieldNodeId),['c']);assert.equal(role.accesses[0].role,'modulo-index');
    assert.ok(!('length' in role));assert.equal(role.elementBytes,4);
  }
});

test('ambiguous bounds and compound index operands cannot silently acquire length roles',()=>{
  const a=field('a',0,{...ptr,pointee:scalar}),b=field('b',4),c=field('c',8),d=field('d',12);
  let s=bind([access(a,b),binary('==',b,c),binary('<',b,d)]);
  assert.equal(s.arrayRoles.length,0);assert.equal(s.unresolvedArrayRoles.length,1);
  for(const op of ['%','/','*','+']){
    s=bind([access(a,binary(op,node('DeclRefExpr'),b)),binary('==',b,c)]);
    assert.equal(s.arrayRoles.length,0);
    if(op==='%')assert.deepEqual(s.indexedStorageRoles[0].cardinalityCandidates,[]);
  }
});

test('copy offsets separate an explicit multiplicative stride from the direct index',()=>{
  const a=field('a',0,{...ptr,pointee:scalar}),b=field('b',4),c=field('c',8),d=field('d',12),p=planOf([binary('==',b,c)]);
  p.instructions.push({id:'copy',sourceNodeId:'copy-node',action:'call',arguments:[binary('+',a,binary('*',d,b)),node('DeclRefExpr'),d]});
  bindArrayStructures(p);assert.equal(p.structureBindings.arrayRoles.length,1);
  assert.equal(p.structureBindings.arrayRoles[0].index.fieldNodeId,'b');assert.equal(p.structureBindings.arrayRoles[0].stride.field.fieldNodeId,'d');
  p.instructions.at(-1).arguments[0]=binary('+',a,binary('/',b,d));bindArrayStructures(p);
  assert.equal(p.structureBindings.arrayRoles.length,0);
});

const pointerEvent=(id,objectId,type,offset=0)=>({eventId:id,value:{cType:{kind:'pointer',pointee:type},reference:{targetObjectId:objectId,targetOffset:offset}}});
function arrays(objects,events=[],instructions=[]){return arrayStructures({instructions,types:rawTypes}, {objects,events,views:[]}).filter(s=>s.kind==='array');}

test('equivalent compiler pointer types share one storage range while qualified and reinterpretation views survive',()=>{
  const alternate={...ptr,id:'c:pointer:r'},qualified={...ptr,qualifiers:['const']},other={...ptr,pointee:{...record,id:'r2',recordTypeId:'r2'}},
    objects=[{id:'heap',storage:'heap',size:20}],
    result=arrays(objects,[pointerEvent('p1','heap',ptr),pointerEvent('p2','heap',alternate),pointerEvent('p3','heap',qualified),pointerEvent('p4','heap',other)]);
  assert.equal(result.length,3);assert.equal(new Set(result.map(a=>a.storageIdentity)).size,1);
  assert.deepEqual(result.find(a=>a.elementType.id===ptr.id&&!a.elementType.qualifiers).elementTypeViews.map(t=>t.id),['debug:ptr','c:pointer:r']);
  assert.ok(result.every(a=>a.capacity===5));
});

test('scalar typedef identity is compiler-backed, preserving equal-width int and long and nested const',()=>{
  const identity=compilerTypeIdentity(rawTypes),alias={...scalar,id:'debug:alias',name:'Opaque'},long={...scalar,id:'c:long',name:'long'},
    c={...scalar,qualifiers:['const']};
  assert.equal(identity.key(alias),identity.key(scalar));assert.notEqual(identity.key(long),identity.key(scalar));
  assert.notEqual(identity.key({...ptr,pointee:c}),identity.key({...ptr,pointee:scalar}));
});

test('single records and scalar subobjects do not gain arrays from address taking, but actual arrays of one survive',()=>{
  const objects=[{id:'single',storage:'heap',size:12},{id:'indexed',storage:'heap',size:12},
    {id:'declared',size:12,cType:{kind:'array',elementType:record,count:1}},
    {id:'scalar-array',size:4,cType:{kind:'array',elementType:scalar,count:1}}],
    subscript=access(node('DeclRefExpr',[],{cType:ptr}),node('IntegerLiteral',[],{literal:'0'})),
    events=[pointerEvent('record','single',record),pointerEvent('field','single',ptr,4),pointerEvent('one','indexed',record),
      {eventId:'read',instructionId:'indexed-access',kind:'READ',target:{objectId:'indexed',offset:0,size:12}}],
    result=arrays(objects,events,[{id:'indexed-access',expression:subscript}]);
  assert.deepEqual(result.map(a=>a.objectId).sort(),['declared','indexed','scalar-array']);assert.ok(result.every(a=>a.capacity===1));
});

test('single-element declared record array fields preserve their actual array extent',()=>{
  const element={...scalar},r={...record,members:[{typeId:'debug:one-array',offsetBits:32,sizeBits:32}]},
    p={instructions:[],types:[...rawTypes,{id:'debug:one-array',tag:'DW_TAG_array_type',baseType:scalar.id,dimensions:[1]}]},
    result=arrayStructures(p,{objects:[{id:'object',storage:'heap',size:12}],views:[],events:[pointerEvent('r','object',r),pointerEvent('field','object',element,4)]});
  assert.equal(result.length,1);assert.equal(result[0].capacity,1);assert.equal(result[0].range.offset,4);
});
