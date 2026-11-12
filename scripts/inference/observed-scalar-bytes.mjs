// Merge only recorded bytes for a bounded scalar slot. Unknown written bytes
// invalidate their prior values; bytes outside the observed range survive.
export function observeScalarBytes(previous,{size,signed=false,snapshot,start=0,offset=0,value}){
  if(!Number.isInteger(size)||size<=0||size>16)return null;
  const bytes=previous?.bytes?.slice()??Array(size).fill(null);let touched=false;
  if(value!==undefined&&value!==null){
    try{let bits=BigInt.asUintN(size*8,BigInt(value));for(let i=0;i<size;i++){bytes[i]=Number(bits&255n);bits>>=8n;}touched=true;}catch{}
  }
  if(snapshot)for(let i=0;i<size;i++){
    const position=offset+i-start;if(position<0||position>=snapshot.byteLength)continue;touched=true;
    const range=snapshot.ranges?.find(r=>position>=r.offset&&position<r.offset+r.length);
    const byte=range?.initialization!=='initialized'?NaN:range.data?.encoding==='fill'?range.data.byte:
      range.data?.encoding==='hex'?Number.parseInt(range.data.bytesHex?.slice((position-range.offset)*2,(position-range.offset+1)*2),16):NaN;
    bytes[i]=Number.isInteger(byte)&&byte>=0&&byte<=255?byte:null;
  }
  if(!touched)return null;
  let number=null,integer=null;
  if(bytes.every(byte=>byte!==null)){
    let bits=0n;for(let i=0;i<size;i++)bits|=BigInt(bytes[i])<<BigInt(i*8);
    if(signed)bits=BigInt.asIntN(size*8,bits);
    integer=bits.toString();
    const candidate=Number(bits);if(Number.isSafeInteger(candidate))number=candidate;
  }
  return {bytes,value:number,integer};
}
