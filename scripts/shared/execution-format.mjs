// Shared recording/storage format. No generator, inference or UI dependencies.
export const EXECUTION_ENCODING='execution-definitions-v2';
export const DEFINITION_ENCODING='execution-definition-table-v2';
export const isExecutionEncoding=value=>[EXECUTION_ENCODING,'execution-definitions-v1'].includes(value);
export const EXECUTION_ACCEPT='application/vnd.c-workbench.execution+json';
const ref='$d',literal='$l',scalar='$s',record='$r';
const fields=new Set(['cType','fromType','toType','returnType','calculationType','storageType','elementType','pointee',
  'source','conditionSource','statementSource','expression']);
const own=(o,k)=>Object.hasOwn(o,k);
const property=(o,k,v)=>Object.defineProperty(o,k,{value:v,enumerable:true,configurable:true,writable:true});
const isDefinition=(key,v)=>fields.has(key)||typeof v.nodeId==='string'&&typeof v.kind==='string'&&Array.isArray(v.children);

export function createExecutionEncoder(){
 const definitions={encoding:DEFINITION_ENCODING,id:globalThis.crypto.randomUUID(),entries:[]},interned=new Map();
 function intern(plain){const text=JSON.stringify(plain);let id=interned.get(text);
  if(id===undefined){id=definitions.entries.length;definitions.entries.push(plain);interned.set(text,id);}return id;}
 function pack(data){
  // Object memoization is local to this snapshot. A later input checkpoint may
  // reuse an object whose contents have changed; never cache that by identity.
  const seen=new WeakMap(),visiting=new WeakSet();
  function encode(v,key=''){
   if(v===undefined)return {[scalar]:'undefined'};
   if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))return {[scalar]:Object.is(v,-0)?'-0':String(v)};
   if(typeof v==='bigint'||typeof v==='function'||typeof v==='symbol')throw new TypeError('실행 기록에 JSON으로 저장할 수 없는 값이 있습니다.');
   if(!v||typeof v!=='object')return v;
   if(visiting.has(v))throw new TypeError('실행 기록 저장 객체에 순환 참조가 있습니다.');
   let row=seen.get(v);
   if(!row){
    visiting.add(v);let plain;
    if(Array.isArray(v))plain=Array.from({length:v.length},(_,i)=>own(v,i)?encode(v[i]):{[scalar]:'hole'});
    else if([ref,literal,scalar,record].some(k=>own(v,k)))plain={[literal]:Object.keys(v).map(k=>[k,encode(v[k],k)])};
    else{plain={};for(const k of Object.keys(v))property(plain,k,encode(v[k],k));}
    // Share repeated property-name layouts as well as static content. The row
    // still contains every value, in its original property order; equal values
    // in different runtime records are never collapsed into one event.
    if(!Array.isArray(plain)&&![ref,literal,scalar,record].some(k=>own(plain,k))){
     const keys=Object.keys(plain);
     if(keys.length>=3)plain={[record]:[intern(keys),...keys.map(k=>plain[k])]};
    }
    visiting.delete(v);row={plain};seen.set(v,row);
   }
   if(!isDefinition(key,v))return row.plain;
   if(row.reference)return row.reference;
   // Full content, including qualifiers, ranges and node IDs, determines reuse.
   // A debug/type/node ID alone is insufficient to identify a definition.
   return row.reference={[ref]:intern(row.plain)};
  }
  return {encoding:EXECUTION_ENCODING,definitionsId:definitions.id,data:encode(data)};
 }
 return {definitions,pack,
  checkpoint:()=>definitions.entries.length,
  rollback(length){
   if(!Number.isInteger(length)||length<0||length>definitions.entries.length)throw new RangeError('잘못된 공통 정의 체크포인트입니다.');
   for(const entry of definitions.entries.splice(length))interned.delete(JSON.stringify(entry));
  }};
}
export function encodeExecution(data){
 const encoder=createExecutionEncoder(),packed=encoder.pack(data);
 return {...packed,definitions:encoder.definitions};
}
export function createExecutionDecoder(definitions,{immutableDefinitions=false}={}){
 if(![DEFINITION_ENCODING,'execution-definition-table-v1'].includes(definitions?.encoding)||typeof definitions.id!=='string'||!Array.isArray(definitions.entries))
  throw new TypeError('올바른 definitions.json 공통 정의가 필요합니다.');
 const modern=definitions.encoding===DEFINITION_ENCODING,
  ref=modern?'$d':'$executionDefinition',literal=modern?'$l':'$executionLiteral',scalar=modern?'$s':'$executionScalar',record='$r';
 const resolved=[];
 function decode(v){
  if(!v||typeof v!=='object')return v;
  if(Array.isArray(v)){const a=new Array(v.length);for(let i=0;i<v.length;i++){
   if(v[i]&&typeof v[i]==='object'&&!Array.isArray(v[i])&&Object.keys(v[i]).length===1&&v[i][scalar]==='hole')continue;
   a[i]=decode(v[i]);
  }return a;}
  const keys=Object.keys(v);
  if(modern&&own(v,record)){
   const row=v[record],layout=Array.isArray(row)&&Number.isSafeInteger(row[0])&&row[0]>=0?resolved[row[0]]:null;
   if(keys.length!==1||!Array.isArray(layout)||row.length!==layout.length+1||layout.some(k=>typeof k!=='string')||new Set(layout).size!==layout.length)
    throw new TypeError('실행 사건의 필드 구성이 올바르지 않습니다.');
   const result={};for(let i=0;i<layout.length;i++)property(result,layout[i],decode(row[i+1]));return result;
  }
  if(own(v,ref)){
   if(keys.length!==1||!Number.isSafeInteger(v[ref])||v[ref]<0||v[ref]>=resolved.length)throw new RangeError('공통 정의 참조가 올바르지 않습니다.');
   return resolved[v[ref]];
  }
  if(own(v,scalar)){
   const values={'undefined':undefined,'NaN':NaN,'Infinity':Infinity,'-Infinity':-Infinity,'-0':-0};
   if(keys.length!==1||!own(values,v[scalar]))throw new TypeError('실행 기록의 특수 값이 올바르지 않습니다.');
   return values[v[scalar]];
  }
  let entries=Object.entries(v);
  if(own(v,literal)){
   if(keys.length!==1||!Array.isArray(v[literal]))throw new TypeError('실행 기록의 원본 객체가 올바르지 않습니다.');
   entries=v[literal];
  }
  const result={};for(const entry of entries){
   if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||own(result,entry[0]))throw new TypeError('실행 기록의 속성이 올바르지 않습니다.');
   property(result,entry[0],decode(entry[1]));
  }return result;
 }
 // Definition dependencies are emitted before their users; forward/cyclic
 // references are invalid. Runtime events remain distinct ordinary records.
 const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);Object.freeze(value);
 }return value;};
 const sync=()=>{while(resolved.length<definitions.entries.length){const value=decode(definitions.entries[resolved.length]);resolved.push(immutableDefinitions?freeze(value):value);}};
 sync();
 return packed=>{
  if(!isExecutionEncoding(packed?.encoding))return packed;
  if(packed.definitionsId!==definitions.id)throw new RangeError('실행 기록과 공통 정의의 식별자가 다릅니다.');
  if(!own(packed,'data'))throw new TypeError('실행 기록의 data가 없습니다.');
  sync();
  return decode(packed.data);
 };
}
export function decodeExecution(data,definitions=data?.definitions){
 if(!isExecutionEncoding(data?.encoding))return data;
 return createExecutionDecoder(definitions)(data);
}
export function decodeExecutionDocuments(documents){
 const isTable=doc=>[DEFINITION_ENCODING,'execution-definition-table-v1'].includes(doc?.encoding);
 const tables=new Map();for(const doc of documents)if(isTable(doc)){
  if(tables.has(doc.id))throw new RangeError('같은 식별자의 공통 정의가 중복 선택됐습니다.');tables.set(doc.id,createExecutionDecoder(doc));
 }
 return documents.filter(doc=>!isTable(doc)&&doc!=null).map(doc=>{
  if(!isExecutionEncoding(doc?.encoding))return doc;
  if(doc.definitions)return decodeExecution(doc);
  const decode=tables.get(doc.definitionsId);if(!decode)throw new TypeError('이 기록의 definitions.json도 함께 선택해 주세요.');return decode(doc);
 }).filter(doc=>doc!=null);
}
