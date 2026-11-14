// Immutable structural sharing, scoped to one inference run. Identity is never
// inferred from payload equality: objectId/range/event IDs remain in the value.
export function createSharedValues(){
 const values=new Map(),shapes=new Map(),ids=new WeakMap(),seen=new WeakMap(),atoms=new Map(),negativeZero=Symbol('negative zero');let next=1;
 const token=v=>{if(v&&typeof v==='object')return ids.get(v);const key=Object.is(v,-0)?negativeZero:v;let id=atoms.get(key);if(id===undefined){id=next++;atoms.set(key,id);}return id;};
 const mix=(h,id)=>Math.imul(h^id,16777619)>>>0;
 function intern(value){
  if(!value||typeof value!=='object')return value;
  if(ids.has(value))return value;if(Object.isFrozen(value)&&seen.has(value))return seen.get(value);
  const array=Array.isArray(value),inputKeys=Object.keys(value),frozen=Object.isFrozen(value);let shapeHash=mix(array?1:0,inputKeys.length);
  for(const k of inputKeys)shapeHash=mix(shapeHash,token(k));
  const firstShape=shapes.get(shapeHash);let shape=firstShape;
  while(shape&&(shape.array!==array||shape.keys.length!==inputKeys.length||!inputKeys.every((k,i)=>shape.keys[i]===k)))shape=shape.next;
  if(!shape){shape={id:next++,array,keys:inputKeys,next:firstShape};shapes.set(shapeHash,shape);}
  // Most metadata records have the same few schemas. Retain each key vector
  // once, rather than once per historical value in the interning table.
  const keys=shape.keys,children=new Array(keys.length);let unchanged=true,h=mix(shape.id,array?value.length:0);
  for(let i=0;i<keys.length;i++){const k=keys[i],child=intern(value[k]);children[i]=child;unchanged&&=Object.is(child,value[k]);h=mix(h,token(child));}
  const bucket=values.get(h);let result;
  // Hashes only locate candidates. Exact keys, array extent and child values
  // decide equality, including NaN, signed zero and sparse array holes.
  for(let row=bucket;row;row=row.next){const old=row.value;
   if(row.shape===shape&&(!array||old.length===value.length)&&keys.every((k,i)=>Object.is(old[k],children[i]))){result=old;break;}
  }
  if(!result){
   if(frozen&&unchanged)result=value;
   else{result=array?new Array(value.length):{};const descriptor={value:null,enumerable:true,writable:true,configurable:true};for(let i=0;i<keys.length;i++){const k=keys[i];if(array&&k!=='__proto__')result[k]=children[i];else{descriptor.value=children[i];Object.defineProperty(result,k,descriptor);}}Object.freeze(result);}
   ids.set(result,next++);values.set(h,{value:result,shape,next:bucket});
  }
  if(frozen)seen.set(value,result);return result;
 }
 return {intern};
}

// Explicit wire format. APIs expose ordinary objects; JSON and Worker transport
// retain shared versions instead of expanding every reference into a snapshot.
export function encodeInference(inference){
 if(inference?.encoding==='inference-shared-v1')return inference;
 const ids=new WeakMap(),visiting=new WeakSet(),values=[];
 function encode(v){
  if(v===undefined)return {undefined:true};
  if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))return {number:Object.is(v,-0)?'-0':String(v)};
  if(!v||typeof v!=='object')return v;
  if(ids.has(v))return [ids.get(v)];if(visiting.has(v))throw new TypeError('순환하는 추론 저장 객체는 지원하지 않습니다.');visiting.add(v);
  const row=Array.isArray(v)?['a',...Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)?encode(v[i]):{hole:true})]:['o',...Object.keys(v).map(k=>[k,encode(v[k])])];
  visiting.delete(v);const id=values.length;values.push(row);ids.set(v,id);return [id];
 }
 const root=encode(inference);return {encoding:'inference-shared-v1',root,values};
}
export function decodeInference(encoded){
 if(encoded?.encoding!=='inference-shared-v1')return encoded;
 if(!Array.isArray(encoded.values))throw new TypeError('추론 공유 값 목록이 없습니다.');
 const values=[];
 function read(v){
  if(Array.isArray(v)){if(v.length!==1||!Number.isSafeInteger(v[0])||v[0]<0||v[0]>=values.length)throw new TypeError('추론 공유 참조가 올바르지 않습니다.');return values[v[0]];}
  if(v&&typeof v==='object'){if(v.undefined===true&&Object.keys(v).length===1)return undefined;if(['NaN','Infinity','-Infinity','-0'].includes(v.number)&&Object.keys(v).length===1)return Number(v.number);throw new TypeError('추론 공유 값이 올바르지 않습니다.');}
  return v;
 }
 for(const row of encoded.values){
  if(!Array.isArray(row)||!['a','o'].includes(row[0]))throw new TypeError('추론 공유 레코드가 올바르지 않습니다.');
  const value=row[0]==='a'?new Array(row.length-1):{};
  if(row[0]==='a')for(let i=1;i<row.length;i++){const token=row[i];if(token?.hole===true&&Object.keys(token).length===1)continue;value[i-1]=read(token);}
  if(row[0]==='o')for(const entry of row.slice(1)){
   if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||Object.hasOwn(value,entry[0]))throw new TypeError('추론 공유 속성이 올바르지 않습니다.');
   Object.defineProperty(value,entry[0],{value:read(entry[1]),enumerable:true,writable:true,configurable:true});
  }values.push(Object.freeze(value));
 }
 return read(encoded.root);
}
