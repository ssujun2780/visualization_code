// Geometry comes from compiler array types and observed storage extents.
// Pointer targets are never recursively flattened as if they were arrays.
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>Number.isSafeInteger(x)&&x>0;

export function arrayGeometry(array,object){
  const range=array?.range,dimensions=[],evidence=['compiler element type','observed typed storage extent'];
  const unknown=reason=>({status:'unresolved',range,dimensions:[],byteStrides:[],leafBytes:null,rank:null,evidence,reason});
  if(!range||!integer(range.offset)||!positive(range.size)||!positive(array.capacity)||!positive(array.elementBytes))
    return unknown('incomplete array extent');
  if(object&&(object.id!==range.objectId||!integer(object.size)||range.offset+range.size>object.size))
    return unknown('array range exceeds its storage object');
  dimensions.push(array.capacity);
  let type=array.elementType,bytes=array.elementBytes;
  const seen=new Set();
  while(type?.kind==='array'){
    if(seen.has(type))return unknown('recursive array type');seen.add(type);
    const count=type.count??type.dimensions?.[0],next=type.elementType;
    if(!positive(count)||!next||!positive(next.sizeBits/8)||bytes!==count*(next.sizeBits/8))
      return unknown('incomplete or inconsistent nested array type');
    dimensions.push(count);type=next;bytes=next.sizeBits/8;
  }
  if(!type||!positive(bytes)||type.sizeBits/8!==bytes)return unknown('unknown leaf element size');
  const byteStrides=Array(dimensions.length);let extent=bytes;
  for(let axis=dimensions.length-1;axis>=0;axis--){byteStrides[axis]=extent;extent*=dimensions[axis];
    if(!Number.isSafeInteger(extent))return unknown('array extent exceeds exact coordinate range');}
  if(extent!==range.size)return unknown('typed shape does not cover the observed range');
  const declaredDimensions=[];let declaredLeaf=object?.cType;
  while(declaredLeaf?.kind==='array'){
    declaredDimensions.push(declaredLeaf.count??declaredLeaf.dimensions?.[0]);declaredLeaf=declaredLeaf.elementType;
  }
  const declared=range.offset===0&&range.size===object?.size&&declaredLeaf?.sizeBits/8===bytes&&
    declaredDimensions.length===dimensions.length&&declaredDimensions.every((count,axis)=>count===dimensions[axis]);
  return {status:'resolved',dimensions,byteStrides,leafBytes:bytes,leafType:type,rank:dimensions.length,
    cellCount:extent/bytes,range,extentKind:declared?'declared-array':'typed-storage-view',evidence};
}

export function arrayLocation(target,array,object){
  const base={objectId:target?.objectId,offset:target?.offset,size:target?.size,arrayId:array?.id,
    index:null,elementOffset:null,elementBytes:array?.elementBytes};
  const relative=target?.offset-array?.range?.offset,geometry=arrayGeometry(array,object);
  if(integer(relative)&&positive(array?.elementBytes)){
    base.index=Math.floor(relative/array.elementBytes);base.elementOffset=relative%array.elementBytes;
  }
  if(geometry.status!=='resolved')return {...base,geometryStatus:geometry.status,accessKind:'unresolved',coordinates:null,
    leafIndex:null,reason:geometry.reason};
  if(target?.objectId!==array.range.objectId||!integer(relative)||!integer(target?.size)||relative+target.size>array.range.size)
    return {...base,geometryStatus:'resolved',accessKind:'out-of-range',coordinates:null,leafIndex:null};
  const coordinates=offset=>geometry.byteStrides.map((stride,axis)=>Math.floor(offset/stride)%geometry.dimensions[axis]);
  if(target.size===0)return {...base,geometryStatus:'resolved',accessKind:'empty-range',coordinates:null,
    leafIndex:relative/geometry.leafBytes,cellCount:0};
  const leafIndex=Math.floor(relative/geometry.leafBytes),leafOffset=relative%geometry.leafBytes,
    whole=leafOffset===0&&target.size%geometry.leafBytes===0,
    cellCount=Math.ceil((leafOffset+target.size)/geometry.leafBytes);
  return {...base,geometryStatus:'resolved',coordinates:coordinates(relative),leafIndex,leafBytes:geometry.leafBytes,
    leafOffset,cellCount,endCoordinates:coordinates(relative+target.size-1),
    accessKind:whole?(cellCount===1?'cell':'cell-range'):(cellCount===1?'partial-cell':'partial-range')};
}
