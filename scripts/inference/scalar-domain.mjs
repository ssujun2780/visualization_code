// Payload comparisons are separate from bounded coordinates. JSON-safe exact
// integers remain strings; no address/index is coerced to a floating point key.
export function scalarPayload(value){
 if(!value)return null;
 const type=value.cType??{};
 if(type.kind==='pointer'||value.address!==undefined)return null;
 if(type.kind==='floating'||/float/.test(type.encoding??'')||['float','double'].includes(value.type)){
  const raw=value.number??value.decimal??value.value;if(raw===undefined)return null;
  const number=Number(raw);
  return {kind:'float',value:Number.isNaN(number)?'NaN':String(number),width:type.sizeBits??null};
 }
 try{const text=type.signedness==='unsigned'?value.unsigned??value.decimal:value.decimal??value.signed??value.unsigned;
  if(text===undefined)return null;
  return {kind:'integer',value:BigInt(text).toString(),signedness:type.signedness??null,width:type.sizeBits??null};
 }catch{return null;}
}
export const floatingType=type=>type?.kind==='floating'||/float/.test(type?.encoding??'')||['float','double'].includes(type?.name);
export const numericType=type=>Number.isInteger(type?.sizeBits)&&type.sizeBits>0&&
 (floatingType(type)?[32,64].includes(type.sizeBits):['signed','unsigned'].includes(type.signedness)&&type.sizeBits<=128);
// Identity may cross only conversions preserving the entire source domain.
export function preservesNumericOrder(from,to){
 if(!numericType(from)||!numericType(to))return false;
 if(floatingType(from))return floatingType(to)&&to.sizeBits>=from.sizeBits;
 if(floatingType(to))return from.sizeBits-(from.signedness==='signed'?1:0)<=(to.sizeBits===32?24:53);
 return from.signedness===to.signedness&&to.sizeBits>=from.sizeBits||from.signedness==='unsigned'&&to.signedness==='signed'&&to.sizeBits>from.sizeBits;
}
export function scalarFromBytes(bytes,type){
 if(!numericType(type)||bytes?.length!==type.sizeBits/8||bytes.some(b=>!Number.isInteger(b)||b<0||b>255))return null;
 if(floatingType(type)){const view=new DataView(Uint8Array.from(bytes).buffer),number=bytes.length===4?view.getFloat32(0,true):view.getFloat64(0,true);
  return {kind:'float',value:String(number),width:type.sizeBits};}
 let bits=0n;for(let i=bytes.length-1;i>=0;i--)bits=(bits<<8n)|BigInt(bytes[i]);
 return {kind:'integer',value:(type.signedness==='signed'?BigInt.asIntN(type.sizeBits,bits):bits).toString(),signedness:type.signedness,width:type.sizeBits};
}
export function keyPayload(value){
 if(value===null||value===undefined)return null;
 if(value&&typeof value==='object'&&['integer','float','bytes'].includes(value.kind))return value;
 if(typeof value==='number')return {kind:'float',value:String(value)};
 if(['NaN','Infinity','-Infinity'].includes(value))return {kind:'float',value};
 try{return {kind:'integer',value:BigInt(value).toString()};}catch{return null;}
}
export function comparePayload(a,b){
 if(a&&b&&a.kind!==b.kind&&[a.kind,b.kind].every(k=>['integer','float'].includes(k))){
  const x=a.kind==='integer'?BigInt(a.value):Number(a.value),y=b.kind==='integer'?BigInt(b.value):Number(b.value);
  // JS relational comparison preserves the integer's exact value here; never
  // round a wide integer through Number. Conversion admissibility is checked
  // separately against the recorded C conversion before deriving a key role.
  return Number.isNaN(x)||Number.isNaN(y)?{status:'unordered',sign:null}:{status:'ordered',sign:x<y?-1:x>y?1:0};
 }
 if(!a||!b||a.kind!==b.kind)return {status:'not-checkable',sign:null};
 if(a.kind==='integer'){const x=BigInt(a.value),y=BigInt(b.value);return {status:'ordered',sign:x<y?-1:x>y?1:0};}
 if(a.kind==='float'){const x=Number(a.value),y=Number(b.value);return Number.isNaN(x)||Number.isNaN(y)?{status:'unordered',sign:null}:{status:'ordered',sign:x<y?-1:x>y?1:0};}
 if(a.kind==='bytes'&&Array.isArray(a.value)&&Array.isArray(b.value)){
  for(let i=0;i<Math.min(a.value.length,b.value.length);i++)if(a.value[i]!==b.value[i])return {status:'ordered',sign:a.value[i]<b.value[i]?-1:1};
  return {status:'ordered',sign:Math.sign(a.value.length-b.value.length)};
 }
 return {status:'not-checkable',sign:null};
}
