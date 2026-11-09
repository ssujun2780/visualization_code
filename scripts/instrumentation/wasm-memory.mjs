// Observe linked wasm32 memory operations through the existing cvtrace.emit
// import. No function indices, original operations or evaluation order change.
// Encoding reference: https://webassembly.github.io/spec/core/binary/instructions.html
const u=n=>{const out=[];do{let b=n%128;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);return out;};
const s=n=>{const out=[];let more;do{const b=n&127;n>>=7;more=!((n===0&&!(b&64))||(n===-1&&(b&64)));out.push(b|(more?128:0));}while(more);return out;};
class Reader{
  constructor(bytes){this.b=bytes;this.p=0;}
  byte(){if(this.p>=this.b.length)throw new Error('Truncated WASM');return this.b[this.p++];}
  leb(){let n=0,m=1,b;do{b=this.byte();n+=(b&127)*m;m*=128;if(m>2**56)throw new Error('WASM LEB exceeds observer range');}while(b&128);return n;}
  skipLEB(){let count=0;while(this.byte()&128)if(++count>10)throw new Error('Invalid WASM LEB');}
  string(){const size=this.leb(),start=this.p;this.p+=size;return this.b.subarray(start,this.p).toString('utf8');}
  take(n){const start=this.p;this.p+=n;if(this.p>this.b.length)throw new Error('Truncated WASM');return this.b.subarray(start,this.p);}
}
const limit=r=>{const flags=r.leb();r.leb();if(flags&1)r.leb();if(flags&~3)throw new Error('Unsupported WASM memory limits');};
export function observeWasmMemory(binary){
  const bytes=Buffer.from(binary),r=new Reader(bytes);if(r.take(8).toString('hex')!=='0061736d01000000')throw new Error('Expected WASM v1');
  const sections=[];while(r.p<bytes.length){const id=r.byte(),size=r.leb();sections.push({id,data:r.take(size)});}
  const types=[],functions=[],dataRegions=[];let emit=null,imports=0;
  for(const section of sections){const a=new Reader(section.data);
    if(section.id===1){for(let n=a.leb();n--;){if(a.byte()!==0x60)throw new Error('Unsupported WASM type');const params=a.leb();a.take(params);const returns=a.leb();a.take(returns);types.push(params);}}
    if(section.id===2)for(let n=a.leb();n--;){const module=a.string(),name=a.string(),kind=a.byte();
      if(kind===0){a.leb();if(module==='cvtrace'&&name==='emit')emit=imports;imports++;}
      else if(kind===1){a.byte();limit(a);}else if(kind===2)limit(a);else if(kind===3){a.byte();a.byte();}else throw new Error('Unsupported WASM import');
    }
    if(section.id===3)for(let n=a.leb();n--;)functions.push(a.leb());
    if(section.id===11)for(let n=a.leb();n--;){
      const flags=a.leb();if(flags===1){a.take(a.leb());continue;}
      if(flags===2&&a.leb()!==0)throw new Error('Unsupported data memory');
      if(flags!==0&&flags!==2)throw new Error('Unsupported data segment');
      if(a.byte()!==0x41)throw new Error('Nonconstant linked data offset');
      const address=a.leb();if(a.byte()!==0x0b)throw new Error('Invalid linked data offset');
      const size=a.leb();a.take(size);dataRegions.push({address,size,evidence:'linked active WASM data segment',objectBounds:'unknown'});
    }
  }
  if(emit===null)throw new Error('Linked memory observer requires cvtrace.emit');
  let loads=0,stores=0;
  const code=sections.find(x=>x.id===10);if(!code)throw new Error('Missing WASM code');
  const a=new Reader(code.data),count=a.leb(),bodies=[];
  if(count!==functions.length)throw new Error('WASM function/code mismatch');
  for(let f=0;f<count;f++){
    const body=new Reader(a.take(a.leb())),groups=body.leb(),declStart=body.p;let locals=types[functions[f]];
    for(let n=0;n<groups;n++){locals+=body.leb();body.byte();}
    const decl=body.b.subarray(declStart,body.p),address=locals,value=new Map([[0x7f,locals+1],[0x7e,locals+2],[0x7d,locals+3],[0x7c,locals+4]]);
    const out=[...u(groups+5),...decl,1,0x7f,1,0x7f,1,0x7e,1,0x7d,1,0x7c];
    const hook=(phase,offset,size)=>[0x41,...s(-1),0x41,...s(phase),0x20,...u(address),0x41,...s(offset|0),0x6a,0x41,...s(size),0x42,0,0x42,0,0x10,...u(emit)];
    while(body.p<body.b.length){const start=body.p,op=body.byte();
      if(op>=0x28&&op<=0x3e){body.leb();const offset=body.leb(),original=body.b.subarray(start,body.p);
        const sizes=[4,8,4,8,1,1,2,2,1,1,2,2,4,4,4,8,4,8,1,2,1,2,4],size=sizes[op-0x28];
        if(op<0x36){out.push(0x22,...u(address),...original,...hook(1,offset,size));loads++;}
        else{const type=op===0x37||op>=0x3c?0x7e:op===0x38?0x7d:op===0x39?0x7c:0x7f,local=value.get(type);
          out.push(0x21,...u(local),0x22,...u(address),0x20,...u(local),...original,...hook(2,offset,size));stores++;}
        continue;
      }
      if([0x02,0x03,0x04].includes(op))body.skipLEB();
      else if([0x0c,0x0d,0x10,0x20,0x21,0x22,0x23,0x24,0x25,0x26,0xd2].includes(op))body.leb();
      else if(op===0x0e){for(let n=body.leb()+1;n--;)body.leb();}
      else if(op===0x11){body.leb();body.leb();}
      else if(op===0x1c){body.take(body.leb());}
      else if(op===0x3f||op===0x40)body.leb();
      else if(op===0x41||op===0x42||op===0xd0)body.skipLEB();
      else if(op===0x43)body.take(4);else if(op===0x44)body.take(8);
      else if(op===0xfc){const sub=body.leb();if(sub>7)throw new Error(`Linked WASM memory observer does not support prefixed opcode ${sub}`);}
      else if(![0x00,0x01,0x05,0x0b,0x0f,0x1a,0x1b,0xd1].includes(op)&&!(op>=0x45&&op<=0xc4))throw new Error(`Linked WASM memory observer does not support opcode 0x${op.toString(16)}`);
      out.push(...body.b.subarray(start,body.p));
    }
    const result=Buffer.from(out);bodies.push(Buffer.from(u(result.length)),result);
  }
  code.data=Buffer.concat([Buffer.from(u(count)),...bodies]);
  return {bytes:Buffer.concat([bytes.subarray(0,8),...sections.flatMap(x=>[Buffer.from([x.id,...u(x.data.length)]),x.data])]),
    dataRegions,coverage:{method:'linked wasm32 scalar memory operations',functions:count,loads,stores,source:'observed memory access; no function-name classifier'}};
}
