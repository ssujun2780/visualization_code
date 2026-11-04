// Adapter for the pinned wasm32 wasi-libc bundle. Formatting and buffering
// remain in libc; only its formatted-byte write boundary is observed.
export const stdioObserverSource=`#include <stdio.h>
#include <stddef.h>
extern size_t __cvm_raw(const unsigned char *, size_t, FILE *);
__attribute__((import_module("cvtrace"), import_name("stdio_output")))
extern void observe_stdio_output(int, const unsigned char *, size_t);
size_t __fwritex(const unsigned char *data, size_t length, FILE *stream) {
    size_t written = __cvm_raw(data, length, stream);
    if (written && (stream == stdout || stream == stderr))
        observe_stdio_output(stream == stdout ? 1 : 2, data, written);
    return written;
}
`;

export function stdioRuntimeObject(archive){
  const bytes=Buffer.from(archive),fail=()=>{throw new Error('번들 libc의 출력 관찰 경계를 확인할 수 없습니다.');};
  if(bytes.subarray(0,8).toString()!=='!<arch>\n'||bytes.subarray(8,24).toString().trim()!=='/')fail();
  const tableSize=Number(bytes.subarray(56,66).toString().trim()),tableEnd=68+tableSize,count=bytes.readUInt32BE(68);
  if(!Number.isSafeInteger(tableSize)||tableEnd>bytes.length||72+count*4>tableEnd)fail();
  let nameAt=72+count*4,offset=null;
  for(let index=0;index<count;index++){
    const end=bytes.indexOf(0,nameAt);if(end<nameAt||end>=tableEnd)fail();
    if(bytes.subarray(nameAt,end).toString()==='__fwritex'){offset=bytes.readUInt32BE(72+index*4);break;}
    nameAt=end+1;
  }
  if(offset===null||offset+60>bytes.length)fail();
  const size=Number(bytes.subarray(offset+48,offset+58).toString().trim());
  if(!Number.isSafeInteger(size)||size<8||offset+60+size>bytes.length)fail();
  const object=Buffer.from(bytes.subarray(offset+60,offset+60+size));
  if(object.subarray(0,8).toString('hex')!=='0061736d01000000')fail();
  const readLEB=at=>{
    let value=0,shift=0,start=at;
    do{if(at>=object.length||at-start>=5)fail();const byte=object[at++];value+=(byte&127)*2**shift;
      if(!(byte&128))return {value,end:at};shift+=7;}while(true);
  };
  let replaced=0;
  for(let at=8;at<object.length;){
    const kind=object[at++],section=readLEB(at),end=section.end+section.value;if(end>object.length)fail();
    if(kind===0){
      const name=readLEB(section.end),nameEnd=name.end+name.value;if(nameEnd>end)fail();
      if(object.subarray(name.end,nameEnd).toString()==='linking'){
        // Equal-length symbol renaming changes linking metadata only. Function
        // instructions, relocations and ABI layout stay byte-for-byte intact.
        const needle=Buffer.from('\x09__fwritex');
        for(let pos=object.indexOf(needle,nameEnd);pos>=nameEnd&&pos+needle.length<=end;pos=object.indexOf(needle,pos+needle.length)){
          object.write('__cvm_raw',pos+1,'ascii');replaced++;
        }
      }
    }
    at=end;
  }
  if(replaced!==1)fail();
  return object;
}
