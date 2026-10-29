// Observer data is attached to existing events; it is never a program READ.
const format="memory-ranges-v1";
export const initializationOf=writer=>!writer?"uninitialized":writer==="unobserved"?"unobserved":"initialized";

export function filledMemory(byteLength,byte) {
  return {format,byteLength,evidence:"library API fill effect",complete:true,
    ranges:byteLength?[{offset:0,length:byteLength,initialization:"initialized",data:{encoding:"fill",byte}}]:[]};
}

export class MemorySnapshots {
  constructor(maxEncodedBytes=8*1024*1024) {
    this.maxEncodedBytes=maxEncodedBytes;this.usedEncodedBytes=0;this.captures=0;this.capturedBytes=0;this.omittedInitializedBytes=0;
  }
  capture(memory,address,byteLength,states=[{start:0,end:byteLength,initialization:"initialized"}]) {
    this.captures++;const ranges=[];
    const mergeable=(a,b)=>a&&a.offset+a.length===b.offset&&a.initialization===b.initialization&&a.reason===b.reason&&
      (!a.data&&!b.data||a.data?.encoding==="fill"&&b.data?.encoding==="fill"&&a.data.byte===b.data.byte);
    const append=(range,cost=0)=>{
      if(mergeable(ranges.at(-1),range)){ranges.at(-1).length+=range.length;return true;}
      if(this.usedEncodedBytes+cost>this.maxEncodedBytes)return false;
      this.usedEncodedBytes+=cost;ranges.push(range);return true;
    };
    let cursor=0;
    for(const state of states) {
      if(state.start!==cursor||state.end<state.start||state.end>byteLength)throw new Error("스냅샷 초기화 범위가 올바르지 않습니다.");
      cursor=state.end;if(state.end===state.start)continue;
      if(state.initialization!=="initialized"){
        append({offset:state.start,length:state.end-state.start,initialization:state.initialization});continue;
      }
      // A byte view is constructed only for ranges known to be initialized.
      const view=new Uint8Array(memory.buffer,address+state.start,state.end-state.start);
      for(let at=0;at<view.length;at+=4096){
        const chunk=view.subarray(at,Math.min(at+4096,view.length)),uniform=chunk.every(b=>b===chunk[0]);
        const data=uniform?{encoding:"fill",byte:chunk[0]}:{encoding:"hex",bytesHex:Buffer.from(chunk).toString("hex")};
        const range={offset:state.start+at,length:chunk.length,initialization:"initialized",data};
        if(append(range,uniform?32:32+chunk.length*2))this.capturedBytes+=chunk.length;
        else {this.omittedInitializedBytes+=chunk.length;append({offset:range.offset,length:range.length,initialization:"initialized",reason:"snapshot-budget"});}
      }
    }
    if(cursor!==byteLength)throw new Error("스냅샷 초기화 범위가 전체 영역을 포함하지 않습니다.");
    return {format,byteLength,evidence:"observer memory snapshot",complete:ranges.every(r=>r.initialization!=="unobserved"&&(r.initialization!=="initialized"||r.data)),ranges};
  }
  summary(){return {format,maxEncodedBytes:this.maxEncodedBytes,usedEncodedBytes:this.usedEncodedBytes,captures:this.captures,
    capturedBytes:this.capturedBytes,omittedInitializedBytes:this.omittedInitializedBytes,programReadEventsAdded:0};}
}

// Decode one recorded range without consulting live memory or later READs.
// Unknown/uninitialized bytes remain masked even though the backing buffer is 0.
export function materializeMemory(snapshot,{maxBytes=16*1024*1024}={}) {
  if(snapshot?.format!==format||!Number.isSafeInteger(snapshot.byteLength)||snapshot.byteLength<0||snapshot.byteLength>maxBytes)throw new Error("지원하지 않는 메모리 스냅샷입니다.");
  const bytes=new Uint8Array(snapshot.byteLength),initialization=new Uint8Array(snapshot.byteLength),known=new Uint8Array(snapshot.byteLength);let cursor=0;
  for(const r of snapshot.ranges){
    if(r.offset!==cursor||!Number.isSafeInteger(r.length)||r.length<0||r.offset+r.length>bytes.length)throw new Error("메모리 스냅샷 범위가 올바르지 않습니다.");
    cursor+=r.length;
    if(!["initialized","uninitialized","unobserved"].includes(r.initialization))throw new Error("알 수 없는 초기화 상태입니다.");
    initialization.fill(r.initialization==="initialized"?1:r.initialization==="unobserved"?2:0,r.offset,cursor);
    if(!r.data)continue;
    if(r.initialization!=="initialized")throw new Error("미초기화·미관측 영역에 값이 기록됐습니다.");
    if(r.data.encoding==="fill"){
      if(!Number.isInteger(r.data.byte)||r.data.byte<0||r.data.byte>255)throw new Error("잘못된 반복 바이트입니다.");
      bytes.fill(r.data.byte,r.offset,cursor);
    }else if(r.data.encoding==="hex"){
      if(typeof r.data.bytesHex!=="string"||r.data.bytesHex.length!==r.length*2||!/^[0-9a-f]*$/i.test(r.data.bytesHex))throw new Error("잘못된 바이트 기록입니다.");
      bytes.set(Buffer.from(r.data.bytesHex,"hex"),r.offset);
    }else throw new Error("지원하지 않는 스냅샷 압축 형식입니다.");
    known.fill(1,r.offset,cursor);
  }
  if(cursor!==bytes.length)throw new Error("메모리 스냅샷의 일부 범위가 누락됐습니다.");
  return {bytes,initialization,known};
}
