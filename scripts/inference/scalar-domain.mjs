// Payload comparisons are separate from bounded coordinates. JSON-safe exact
// integers remain strings; no address/index is coerced to a floating point key.
export function scalarPayload(value){
 if(!value)return null;
 const type=value.cType??{};
 if(type.kind==='pointer'||value.address!==undefined)return null;
 if(type.kind==='floating'||/float/.test(type.encoding??'')||['float','double'].includes(value.type)){
  const number=Number(value.decimal??value.value);
  return {kind:'float',value:Number.isNaN(number)?'NaN':String(number),width:type.sizeBits??null};
 }
 try{const text=type.signedness==='unsigned'?value.unsigned??value.decimal:value.decimal??value.signed??value.unsigned;
  if(text===undefined)return null;
  return {kind:'integer',value:BigInt(text).toString(),signedness:type.signedness??null,width:type.sizeBits??null};
 }catch{return null;}
}
export function comparePayload(a,b){
 if(!a||!b||a.kind!==b.kind)return {status:'not-checkable',sign:null};
 if(a.kind==='integer'){const x=BigInt(a.value),y=BigInt(b.value);return {status:'ordered',sign:x<y?-1:x>y?1:0};}
 if(a.kind==='float'){const x=Number(a.value),y=Number(b.value);return Number.isNaN(x)||Number.isNaN(y)?{status:'unordered',sign:null}:{status:'ordered',sign:x<y?-1:x>y?1:0};}
 if(a.kind==='bytes'&&Array.isArray(a.value)&&Array.isArray(b.value)){
  for(let i=0;i<Math.min(a.value.length,b.value.length);i++)if(a.value[i]!==b.value[i])return {status:'ordered',sign:a.value[i]<b.value[i]?-1:1};
  return {status:'ordered',sign:Math.sign(a.value.length-b.value.length)};
 }
 return {status:'not-checkable',sign:null};
}
