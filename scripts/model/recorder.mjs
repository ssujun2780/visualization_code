import {randomUUID} from "node:crypto";
import {topology} from "./structure.mjs";
import {MemorySnapshots,filledMemory,initializationOf} from "./memory-state.mjs";

export class TraceStopped extends Error {}
const unsigned=(value,bits=64)=>BigInt.asUintN(bits,BigInt(value));
const hex=(value,width=8)=>`0x${unsigned(value).toString(16).padStart(width,"0")}`;

export class ModelRecorder {
  constructor(plan,abi,{maxEvents=100000,onEvents}={}) {
    Object.assign(this,{plan,abi,maxEvents,onEvents});this.runId=randomUUID();this.events=[];this.objects=[];this.frames=[];
    this.stack=[];this.references=new Map();this.views=[];this.diagnostics=[];this.pendingArguments=new Map();this.sequence=0;this.batch=[];
    this.coverageGaps=new Set();this.globalsBySymbol=new Map();this.captureErrors=true;
    this.memorySnapshots=new MemorySnapshots();this.streamOffsets={stdout:0,stderr:0};
  }
  setMemory=memory=>{this.memory=memory;};
  output=(channel,text)=>{
    const call=this.frame()?.activeCall,byteLength=Buffer.byteLength(text),streamOffset=this.streamOffsets[channel]??0;
    this.event("WRITE",call?.operation??null,{action:"output",channel,text,byteLength,streamOffset,callEventId:call?.event?.eventId??null,evidence:"observed stream output"});
    this.streamOffsets[channel]=streamOffset+byteLength;
  };
  input=(bytes,streamOffset)=>{
    const call=this.frame()?.activeCall,event=this.event("READ",call?.operation??null,{action:"input",channel:"stdin",bytesHex:Buffer.from(bytes).toString("hex"),
      byteLength:bytes.length,streamOffset,callEventId:call?.event?.eventId??null,evidence:"observed stream input"});
    if(call)(call.inputEvents??=[]).push(event.eventId);
  };
  event(kind,op,fields={}) {
    if(this.events.length>=this.maxEvents&&kind!=="ERROR")this.fault("trace-limit","실행 기록 제한에 도달했습니다.",op,"limited");
    const event={schemaVersion:2,runId:this.runId,eventId:`e${++this.sequence}`,instructionId:op?.id??null,
      activationId:this.stack.at(-1)?.id??null,kind,source:op?.source??null,sceneId:op?.sceneId??null,evidence:"observed",...fields};
    this.events.push(event);this.batch.push(event);if(this.batch.length>=256)this.flush();return event;
  }
  flush(){if(this.batch.length){this.onEvents?.(this.batch);this.batch=[];}}
  fault(code,message,op,status="fault",details={}) {
    if(!this.diagnostics.length){const e=this.event("ERROR",op,{phase:"fault",diagnostic:{code,message},...details});this.diagnostics.push({...e.diagnostic,eventId:e.eventId,source:e.source});}
    this.status=status;throw new TraceStopped(message);
  }
  frame(){return this.stack.at(-1);}
  scalar(type,bits) {
    bits=unsigned(bits);const width=/^i(\d+)$/.exec(type)?.[1];
    if(width){const n=Number(width),v=unsigned(bits,n);return {type,bits:hex(v,Math.ceil(n/4)),unsigned:v.toString(),signed:BigInt.asIntN(n,v).toString()};}
    if(type?.endsWith("*"))return {type,address:hex(unsigned(bits,32)),bits:hex(unsigned(bits,32))};
    if(type==="float"||type==="double"){const b=new ArrayBuffer(8),d=new DataView(b);d.setBigUint64(0,bits,true);const n=type==="float"?d.getFloat32(0,true):d.getFloat64(0,true);return {type,bits:hex(bits,type==="float"?8:16),number:Number.isFinite(n)?(Object.is(n,-0)?"-0":String(n)):String(n)};}
    return {type:type??null,evidence:"unobserved"};
  }
  semanticValue(value,cType,boolean=false) {
    if(!cType)return value;
    return {...value,cType,decimal:boolean?value.unsigned:cType.signedness==="unsigned"?value.unsigned:cType.signedness==="signed"?value.signed:undefined};
  }
  address(value){return Number(unsigned(value,32));}
  lookup(address,size=1) {
    return this.objects.findLast(o=>o.lifecycle==="alive"&&address>=o.address&&
      (address<o.address+o.size||!o.size&&address===o.address)&&address+size<=o.address+o.size);
  }
  inputEvent(input) {if(!input)return null;if(input.value?.startsWith("%"))return this.frame()?.definitions.get(input.value);return null;}
  origin(input) {if(!input)return null;return this.frame()?.origins.get(input.value)??this.globalsBySymbol.get(input.value);}
  inputs(op) {let inputs=op.inputs??[];if(op.action==="merge")inputs=op.incoming.filter(i=>i.block===this.frame()?.previousBlock);
    if(op.action==="select"){const chosen=this.frame()?.selects.get(op.id);inputs=[inputs[0],inputs[chosen?1:2]];}
    return inputs.map(i=>this.inputEvent(i)?.eventId).filter(Boolean);
  }
  check(address,size,op,{write=false,initialized=false,origin}={}) {
    const fail=(code,message)=>this.fault(code,message,op,"fault",{target:{objectId:origin?.id??this.lookup(address,0)?.id??null,address:hex(address),size},dataInputs:this.inputs(op)});
    if(!Number.isSafeInteger(size)||size<0||size>134217728)fail("invalid-size","접근 크기가 지원 범위를 벗어났습니다.");
    if(!size)return this.lookup(address,0);
    if(!address)fail("null-access","NULL 주소에 접근했습니다.");
    if(address+size>this.memory.buffer.byteLength)fail("memory-bounds","실행 메모리 범위를 벗어났습니다.");
    if(origin&&(origin.lifecycle!=="alive"||address<origin.address||address+size>origin.address+origin.size))
      fail(origin.lifecycle==="alive"?"object-bounds":"use-after-lifetime","객체의 유효한 범위를 벗어났습니다.");
    const object=this.lookup(address,size);
    if(!object){
      const ended=this.objects.findLast(o=>o.lifecycle!=="alive"&&address>=o.address&&address<o.address+o.size);
      if(ended)fail("use-after-lifetime","수명이 끝난 객체에 접근했습니다.");
      this.coverageGaps.add("untracked-memory");return null;
    }
    if(write&&object.constant)fail("constant-write","상수 저장 영역에 쓰려고 했습니다.");
    if(initialized&&this.segments(object,address-object.address,size).some(s=>!s.writer))fail("uninitialized-read","초기화가 확인되지 않은 값을 읽으려고 했습니다.");
    return object;
  }
  segments(object,start,size) {
    const end=start+size,result=[];let at=start;
    for(const r of object.writes){if(r.end<=at)continue;if(r.start>=end)break;if(r.start>at)result.push({start:at,end:Math.min(r.start,end),writer:null});const a=Math.max(at,r.start),b=Math.min(end,r.end);if(b>a)result.push({start:a,end:b,writer:r.writer});at=Math.max(at,b);if(at>=end)break;}
    if(at<end)result.push({start:at,end,writer:null});return result;
  }
  mark(object,address,size,writer) {
    if(!object||!size)return;const start=address-object.address,end=start+size,result=[];
    for(const r of object.writes){if(r.end<=start||r.start>=end)result.push(r);else {if(r.start<start)result.push({...r,end:start});if(r.end>end)result.push({...r,start:end});}}
    result.push({start,end,writer});object.writes=result.sort((a,b)=>a.start-b.start);
    for(const [key,r]of this.references)if(r.objectId===object.id&&r.offset<end&&r.offset+4>start)this.references.delete(key);
  }
  bytes(address,size){return [...new Uint8Array(this.memory.buffer,address,Math.min(size,64))].map(b=>b.toString(16).padStart(2,"0")).join("");}
  snapshot(address,size,type) {
    const result={type,bytesHex:this.bytes(address,size),byteLength:size,truncated:size>64};
    if((/^i\d+$/.test(type)||type?.endsWith("*")||["float","double"].includes(type))&&size<=8){const b=new Uint8Array(8);b.set(new Uint8Array(this.memory.buffer,address,size));Object.assign(result,this.scalar(type,new DataView(b.buffer).getBigUint64(0,true)));}
    return result;
  }
  captureMemory(address,size,segments=null) {
    const states=segments?.map(r=>({start:r.start,end:r.end,initialization:initializationOf(r.writer)}));
    const result=this.memorySnapshots.capture(this.memory,address,size,states);
    if(result.ranges.some(r=>r.reason==="snapshot-budget"))this.coverageGaps.add("memory-snapshot-budget");
    return result;
  }
  create(address,size,op,{storage="heap",name,type,cType,debugTypeId,initialized=false,constant=false,frameId,writer,initialRanges=null,initialByte=null,copiedFrom=null}={}) {
    if(!address&&storage==="heap")return null;
    if(size<0||size>134217728||address+size>this.memory.buffer.byteLength)this.fault("allocation-size","할당 범위를 기록할 수 없습니다.",op);
    const object={id:`o${this.objects.length+1}`,address,size,storage,name:name??null,type:type??null,cType:cType??null,debugTypeId:debugTypeId??null,
      frameId:frameId??(storage==="automatic"?this.frame()?.id:null),lifecycle:"alive",constant,writes:initialRanges?.map(r=>({...r}))??[],createdBy:null};
    const memoryState=initialized?(initialByte!==null?filledMemory(size,initialByte):this.captureMemory(address,size)):
      initialRanges?this.captureMemory(address,size,this.segments(object,0,size)):null;
    this.objects.push(object);const e=this.event("SPACE",op,{action:"object.begin",objectId:object.id,address:hex(address),size,storage,
      initialized:initialized||!!memoryState&&memoryState.ranges.every(r=>r.initialization==="initialized"),
      ...(memoryState?{memoryState}:{}),...(copiedFrom?{copiedFrom}:{})});object.createdBy=e.eventId;
    if(initialized&&size)this.mark(object,address,size,writer??e.eventId);
    if(type)this.view(object,address,type);return object;
  }
  view(object,address,type) {
    let layout;try{layout=this.abi.layout(type);}catch{return null;}
    if(!object||!layout.size||address<object.address||address+layout.size>object.address+object.size)return null;
    let view=this.views.find(v=>v.objectId===object.id&&v.address===address&&v.type===type);
    if(!view){view={id:`v${this.views.length+1}`,objectId:object.id,address,offset:address-object.address,type,kind:layout.kind,size:layout.size,
      ...(layout.kind==="array"?{count:layout.count,elementType:layout.elementType}:{}),evidence:"observed typed address"};this.views.push(view);}return view;
  }
  end(object,op,reason) {
    if(!object||object.lifecycle!=="alive")return;
    object.lifecycle="ended";const e=this.event("SPACE",op,{action:"object.end",objectId:object.id,reason});object.endedBy=e.eventId;
  }
  pointerWrite(object,address,type,value,event) {
    if(!object||!type.endsWith("*"))return;
    const destination=this.lookup(value,0),base=type.slice(0,-1);if(destination)this.view(destination,value,base);
    this.references.set(`${object.id}:${address-object.address}`,{objectId:object.id,offset:address-object.address,address:value,
      targetObjectId:destination?.id??null,targetOffset:destination?value-destination.address:null,type,eventId:event.eventId});
  }
  refreshPointers(object,address,size,event) {
    if(!object)return;
    const contains=(type,seen=new Set())=>{if(seen.has(type))return false;seen.add(type);const l=this.abi.layout(type);return l.kind==="pointer"||l.kind==="array"&&contains(l.elementType,seen)||l.kind==="record"&&l.fields.some(f=>contains(f.type,new Set(seen)));};
    let count=0;
    const walk=(type,at)=>{
      if(count>4096){this.coverageGaps.add("pointer-view-truncated");return;}
      const l=this.abi.layout(type);if(!contains(type))return;
      if(l.kind==="pointer") {count++;if(at>=address&&at+4<=address+size&&!this.segments(object,at-object.address,4).some(s=>!s.writer||s.writer==="unobserved"))this.pointerWrite(object,at,type,new DataView(this.memory.buffer).getUint32(at,true),event);}
      else if(l.kind==="array") {const stride=this.abi.layout(l.elementType).size;for(let i=0;i<l.count&&count<=4096;i++)walk(l.elementType,at+i*stride);}
      else if(l.kind==="record")for(const f of l.fields)walk(f.type,at+f.offset);
    };
    // Copying a record can create reference fields without a scalar pointer store.
    for(const view of [...this.views].filter(v=>v.objectId===object.id&&v.address<address+size&&v.address+v.size>address))walk(view.type,view.address);
  }
  guard(op,a,b) {
    if(!/^i\d+$/.test(op.inputType))return;
    const bits=Number(op.inputType.slice(1)),ua=unsigned(a,bits),ub=unsigned(b,bits),sa=BigInt.asIntN(bits,a),sb=BigInt.asIntN(bits,b),opcode=op.opcode;
    if(["sdiv","udiv","srem","urem"].includes(opcode)&&!ub)this.fault("division-by-zero","정수 나눗셈의 제수가 0입니다.",op);
    if(["sdiv","srem"].includes(opcode)&&sa===-(1n<<BigInt(bits-1))&&sb===-1n)this.fault("signed-overflow","정수 몫을 표현할 수 없습니다.",op);
    if(["shl","lshr","ashr"].includes(opcode)&&ub>=BigInt(bits))this.fault("invalid-shift","시프트 횟수가 자료형의 비트 수를 벗어났습니다.",op);
    const calculate=(x,y)=>opcode==="add"?x+y:opcode==="sub"?x-y:opcode==="mul"?x*y:opcode==="shl"?x<<y:null;
    if(op.flags?.nsw){const n=calculate(sa,sb);if(n!==null&&(n<-(1n<<BigInt(bits-1))||n>=(1n<<BigInt(bits-1))))this.fault("signed-overflow","부호 있는 정수 연산 범위를 벗어났습니다.",op);}
    if(op.flags?.nuw){const n=calculate(ua,ub);if(n!==null&&(n<0||n>=(1n<<BigInt(bits))))this.fault("unsigned-poison","컴파일러의 정수 연산 전제 조건을 위반했습니다.",op);}
  }
  emit=(index,phase,address,size,x,y)=>{
    const op=this.plan.instructions[index-1];if(!op)throw new Error(`알 수 없는 명령 ${index}`);
    x=unsigned(x);y=unsigned(y);address>>>=0;size>>>=0;
    if(op.action==="function.enter"){
      const parent=this.frame(),frame={id:`f${this.frames.length+1}`,functionId:op.functionId,functionName:op.functionName,parent:parent?.id??null,
        ended:false,definitions:new Map(),origins:new Map(),selects:new Map(),calls:new Map(),sourceDecisions:new Map(),block:op.block??"entry"};
      this.frames.push(frame);this.stack.push(frame);this.event("SPACE",op,{action:"frame.begin",frameId:frame.id});this.event("FLOW",op,{action:"enter",frameId:frame.id});return;
    }
    const frame=this.frame();
    if(op.action==="short-circuit") {
      const e=this.event("FLOW",op,{action:"short-circuit",phase:"decision",operator:op.shortCircuit.operator,
        left:op.shortCircuit.left,right:op.shortCircuit.right,reason:op.shortCircuit.reason,
        anchorInstructionId:op.anchorInstructionId,observedConsumerValue:this.scalar(op.consumerType,x),
        evidence:"compiler source semantics at observed consumer",timing:"before-consumer"});
      const previous=frame.sourceDecisions.get(op.anchorInstructionId)??[];frame.sourceDecisions.set(op.anchorInstructionId,[...previous,e.eventId]);return;
    }
    if(op.action==="function.argument") {
      const p=op.parameter,parent=this.stack.at(-2),call=parent?.activeCall;
      const argument=call?.operation?.args[p.index],producer=argument&&parent?.definitions.get(argument.value);
      const e=this.event("WRITE",op,{action:"argument",parameterIndex:p.index,name:op.local?.name??null,value:this.semanticValue(this.scalar(p.type,x),op.cType),callEventId:call?.event?.eventId??null,dataInputs:[producer?.eventId].filter(Boolean)});
      frame.definitions.set(p.value,e);
      if(p.byval){const address=this.address(x),type=p.type.slice(0,-1),size=this.abi.layout(type).size,sourceAddress=call?this.address(call.args[p.index]):null,source=call&&this.lookup(sourceAddress,size),offset=source?sourceAddress-source.address:0;
        const initialRanges=source?this.segments(source,offset,size).map(r=>({...r,start:r.start-offset,end:r.end-offset})):[{start:0,end:size,writer:"unobserved"}];
        const object=this.create(address,size,op,{storage:"automatic",name:op.local?.name,type,initialRanges,copiedFrom:source?{objectId:source.id,offset,size}:null});
        if(!source)this.coverageGaps.add("byval-initialization-source-unobserved");
        frame.origins.set(p.value,object);
      }else if(p.type.endsWith("*"))frame.origins.set(p.value,this.lookup(this.address(x),0));
      return;
    }
    if(frame&&op.block&&frame.block!==op.block){frame.previousBlock=frame.block;frame.block=op.block;}
    if(op.action==="globals.ready") {for(const o of this.objects.filter(o=>o.storage==="static"))this.refreshPointers(o,o.address,o.size,{eventId:o.createdBy});return;}
    if(op.action==="global.begin") {const g=op.global;if(this.globalsBySymbol.has(g.symbol))return;const o=this.create(address,size,op,{storage:"static",name:g.name,type:g.type,cType:g.cType,debugTypeId:g.debugTypeId,initialized:true,constant:g.constant});this.globalsBySymbol.set(g.symbol,o);return;}
    if(op.action==="object.begin") {const o=this.create(address,this.address(x),op,{storage:"automatic",name:op.local?.name,type:op.type,cType:op.cType,debugTypeId:op.local?.debugTypeId});frame.origins.set(op.result,o);return;}
    if(op.action==="call"){this.call(op,phase,x);return;}
    if(op.action==="load"||op.action==="store") {
      const isStore=op.action==="store",origin=this.origin(op.pointer);
      const object=this.check(address,size,op,{write:isStore,initialized:!isStore,origin});
      if(phase===0){this.event(op.kind,op,{phase:"attempt",target:{objectId:object?.id??null,address:hex(address),size},controlInputs:frame.sourceDecisions.get(op.id)??[]});return;}
      const inputs=this.inputs(op),previous=object?this.segments(object,address-object.address,size).map(s=>s.writer).filter(Boolean):[];
      const e=this.event(op.kind,op,{phase:"commit",target:{objectId:object?.id??null,address:hex(address),offset:object?address-object.address:null,size},
        value:this.semanticValue(this.snapshot(address,size,op.type),op.cType??(object?.type===op.type?object.cType:null)),dataInputs:isStore?inputs:[...new Set(previous.filter(id=>id!=="unobserved"))],addressInputs:[this.inputEvent(op.pointer)?.eventId].filter(Boolean),
        initializationEvidence:object&&!previous.includes("unobserved")?"tracked":"unobserved",controlInputs:frame.sourceDecisions.get(op.id)??[]});
      frame.sourceDecisions.delete(op.id);
      if(isStore){this.mark(object,address,size,e.eventId);if(op.type.endsWith("*"))this.pointerWrite(object,address,op.type,new DataView(this.memory.buffer).getUint32(address,true),e);else this.refreshPointers(object,address,size,e);}
      else if(op.result){frame.definitions.set(op.result,e);if(op.type.endsWith("*")){const n=new DataView(this.memory.buffer).getUint32(address,true);frame.origins.set(op.result,this.lookup(n,0)??this.objects.findLast(o=>n>=o.address&&n<o.address+o.size));}}
      return;
    }
    if(op.action==="function.return") {
      const returned=op.type==="void"?null:this.event("WRITE",op,{action:"return.value",value:this.semanticValue(this.scalar(op.type,x),op.cType??this.inputEvent(op.inputs?.[0])?.value?.cType),dataInputs:this.inputs(op),controlInputs:frame.sourceDecisions.get(op.id)??[]});
      const parent=this.stack.at(-2);if(parent?.activeCall&&returned)parent.activeCall.returnEventId=returned.eventId;
      this.event("FLOW",op,{action:"return",frameId:frame.id});for(const o of this.objects.filter(o=>o.frameId===frame.id))this.end(o,op,"function-return");
      this.event("SPACE",op,{action:"frame.end",frameId:frame.id});frame.ended=true;this.stack.pop();return;
    }
    if(op.action==="branch"||op.action==="switch") {
      const destination=op.action==="branch"?op.destinations[op.inputs.length?(x?0:1):0]:(op.cases.find(c=>unsigned(c.value,Number(op.inputs[0].type.slice(1)))===x)?.destination??op.destinations[0]);
      this.event("FLOW",op,{action:op.action,selected:destination,condition:op.inputs?.length?this.scalar(op.inputs[0].type,x):null,dataInputs:this.inputs(op)});return;
    }
    if(op.action==="unreachable"){this.fault("unreachable","실행할 수 없는 코드 위치에 도달했습니다.",op);}
    if(phase===0){if(op.action==="calculate")this.guard(op,x,y);if(op.action==="select")frame.selects.set(op.id,!!x);return;}
    const e=this.event("CALC",op,{action:op.action,operator:op.opcode,predicate:op.predicate,value:op.valueEvidence?{evidence:op.valueEvidence}:this.semanticValue(this.scalar(op.type,x),op.cType,op.cBoolean),dataInputs:this.inputs(op)});
    if(op.conversion){const input=this.inputEvent(op.inputs[0]),literal=/^-?\d+$/.test(op.inputs[0].value)?op.inputs[0].value:null,
      bits=op.conversion.bitsUnchanged?x:input?.value?.bits??literal;
      e.conversion={...op.conversion,fromValue:bits!==null&&bits!==undefined?this.semanticValue(this.scalar(op.inputs[0].type,BigInt(bits)),op.conversion.fromType):{cType:op.conversion.fromType,evidence:"unobserved"}};}
    if(op.result)frame.definitions.set(op.result,e);
    if(op.type?.endsWith("*")){
      const n=this.address(x),origin=this.origin(op.pointer??op.inputs?.[0])??this.lookup(n,0);frame.origins.set(op.result,origin);
      if(origin)this.view(origin,n,op.type.slice(0,-1));
    }
  };
  cstring(address,maximum=1048576){const mem=new Uint8Array(this.memory.buffer);let end=address;while(end<mem.length&&end-address<maximum&&mem[end])end++;return {length:end-address,terminated:end<mem.length&&!mem[end],text:new TextDecoder().decode(mem.subarray(address,end))};}
  // Observe the API's string extent, never fabricate libc's internal load order.
  stringSpan(address,op,{maximum=null,origin}={}) {
    if(maximum===0)return {object:this.lookup(address,0),address,size:0,length:0,terminated:false,segments:[]};
    const object=this.check(address,1,op,{origin});if(!object)return null;
    const offset=address-object.address,available=object.size-offset,limit=Math.min(maximum??available,available);
    let length=0,terminated=false;
    for(const range of this.segments(object,offset,limit)){
      if(!range.writer)this.fault("uninitialized-read","문자열에서 초기화되지 않은 값을 읽으려고 했습니다.",op);
      if(range.writer==="unobserved")return null;
      const bytes=new Uint8Array(this.memory.buffer,object.address+range.start,range.end-range.start),nul=bytes.indexOf(0);
      if(nul!==-1){length=range.start-offset+nul;terminated=true;break;}
      length=range.end-offset;
    }
    if(!terminated&&(maximum===null||length<maximum))this.fault("string-bounds","문자열의 종결 문자를 객체 안에서 확인할 수 없습니다.",op);
    const size=length+(terminated?1:0),segments=this.segments(object,offset,size).map(r=>({...r,start:r.start-offset,end:r.end-offset}));
    return {object,address,size,length,terminated,segments};
  }
  prepareStringEffect(op,call,name) {
    const base=this.address(call.args[0]),source=this.address(call.args[1]),maximum=name==="strncpy"?this.address(call.args[2]):null;
    const target=this.check(base,maximum??1,op,{write:true,origin:this.origin(op.args[0])});if(!target)return null;
    const input=this.stringSpan(source,op,{maximum,origin:this.origin(op.args[1])});if(!input)return null;
    const prefix=name==="strcat"?this.stringSpan(base,op,{origin:target}):null;if(name==="strcat"&&!prefix)return null;
    const destination=base+(prefix?.length??0),size=maximum??input.size;
    this.check(destination,size,op,{write:true,origin:target});
    if(size&&input.size&&destination<source+input.size&&source<destination+size)
      this.fault("overlapping-string-copy","문자열 복사의 원본과 목적지 범위가 겹칩니다.",op);
    const readRegions=[{role:"source",span:input},...(prefix?[{role:"destination-scan",span:prefix}]:[])].map(({role,span})=>({
      role,objectId:span.object?.id??null,address:hex(span.address),offset:span.object?span.address-span.object.address:null,size:span.size,
      includesNullTerminator:span.terminated,dataInputs:[...new Set(span.segments.map(s=>s.writer))]}));
    return {name,destination,size,source,sourceObjectId:input.object?.id??null,sourceOffset:input.object?source-input.object.address:null,
      sourceSize:input.size,includesNullTerminator:input.terminated,terminatorOffset:input.terminated?input.length:null,paddingSize:size-input.size,readRegions,
      previousMemoryState:this.captureMemory(destination,size,this.segments(target,destination-target.address,size).map(r=>({...r,start:r.start+target.address-destination,end:r.end+target.address-destination})))};
  }
  recordStringEffect(op,call,returned) {
    const effect=call.stringEffect,{destination,size}=effect,object=this.lookup(destination,size);
    const event=this.event("WRITE",op,{action:"copy",libraryFunction:effect.name,
      target:{objectId:object?.id??null,address:hex(destination),offset:object?destination-object.address:null,size},
      sourceAddress:hex(effect.source),sourceObjectId:effect.sourceObjectId,sourceOffset:effect.sourceOffset,sourceSize:effect.sourceSize,
      includesNullTerminator:effect.includesNullTerminator,terminatorOffset:effect.terminatorOffset,paddingSize:effect.paddingSize,
      readRegions:effect.readRegions,previousMemoryState:effect.previousMemoryState,memoryState:this.captureMemory(destination,size),
      dataInputs:[...new Set(effect.readRegions.flatMap(r=>r.dataInputs))],addressInputs:op.args.slice(0,2).map(a=>this.inputEvent(a)?.eventId).filter(Boolean),
      callEventId:call.event.eventId,returnEventId:returned.eventId,evidence:"library API effect"});
    this.mark(object,destination,size,event.eventId);this.refreshPointers(object,destination,size,event);
  }
  call(op,phase,x) {
    const frame=this.frame();let call=frame.calls.get(op.id);
    if(phase>=10){if(!call){call={args:[]};frame.calls.set(op.id,call);}call.args[phase-10]=x;return;}
    if(!call){call={args:[]};frame.calls.set(op.id,call);}
    const name=op.callee.slice(1).replace(/^"|"$/g,"");
    if(phase===0) {
      call.operation=op;
      call.event=this.event("FLOW",op,{action:"call.begin",callee:op.callee,indirectAddress:op.callee[0]==="%"?hex(x):null,
        arguments:op.args.map((a,i)=>this.semanticValue(this.scalar(a.type,call.args[i]??0n),a.cType??this.inputEvent(a)?.value?.cType)),dataInputs:this.inputs(op),controlInputs:frame.sourceDecisions.get(op.id)??[],external:op.external});
      frame.sourceDecisions.delete(op.id);
      frame.activeCall=call;
      if(name==="realloc"&&call.args[0]){const old=this.lookup(this.address(call.args[0]),0);if(!old||old.storage!=="heap"||old.address!==this.address(call.args[0]))this.fault("invalid-realloc","할당 시작 주소가 아닌 곳을 재할당하려고 했습니다.",op);call.old=old;call.oldWrites=old.writes.map(r=>({...r}));}
      if(name==="free"&&call.args[0]){const address=this.address(call.args[0]),o=this.lookup(address,0);if(!o||o.storage!=="heap"||o.address!==address)this.fault("invalid-free","유효한 동적 할당의 시작 주소를 해제해야 합니다.",op);this.end(o,op,"free");}
      if(name.startsWith("llvm.memcpy")||name.startsWith("llvm.memmove")||["memcpy","memmove"].includes(name)) {
        const destination=this.address(call.args[0]),source=this.address(call.args[1]),size=this.address(call.args[2]);
        this.check(destination,size,op,{write:true,origin:this.origin(op.args[0])});const object=this.check(source,size,op,{origin:this.origin(op.args[1])});
        call.copy={destination,source,size,sourceObjectId:object?.id??null,sourceOffset:object?source-object.address:null,segments:object?this.segments(object,source-object.address,size).map(r=>({...r,start:r.start+object.address-source,end:r.end+object.address-source})):null};
      }
      if(name.startsWith("llvm.memset")||name==="memset")this.check(this.address(call.args[0]),this.address(call.args[2]),op,{write:true,origin:this.origin(op.args[0])});
      if(op.external&&["strcpy","strncpy","strcat"].includes(name))call.stringEffect=this.prepareStringEffect(op,call,name);
      return;
    }
    const e=this.event("FLOW",op,{action:"call.end",callee:op.callee,value:this.semanticValue(this.scalar(op.returnType,x),op.cType),callEventId:call.event.eventId,dataInputs:[call.returnEventId].filter(Boolean)});
    if(op.result)frame.definitions.set(op.result,e);
    const a=i=>this.address(call.args[i]??0n),returned=this.address(x);
    if(name==="malloc"||name==="calloc"||name==="realloc") {
      const amount=name==="calloc"?a(0)*a(1):name==="realloc"?a(1):a(0);
      if(returned){if(call.old)this.end(call.old,op,"realloc-replaced");const n=call.old?Math.min(amount,call.old.size):0,
        initialRanges=call.oldWrites?.filter(r=>r.start<n).map(r=>({...r,end:Math.min(r.end,n)}))??null;
        const object=this.create(returned,amount,op,{initialized:name==="calloc",initialByte:name==="calloc"?0:null,initialRanges,
          copiedFrom:call.old?{objectId:call.old.id,offset:0,size:n}:null});
        frame.origins.set(op.result,object);
      }else if(name==="realloc"&&amount===0)this.coverageGaps.add("realloc-zero-size-implementation-dependent");
    } else if(call.stringEffect) {
      this.recordStringEffect(op,call,e);
    } else if(call.copy) {
      const {destination,size,segments}=call.copy,object=this.lookup(destination,size);const event=this.event("WRITE",op,{action:"copy",target:{objectId:object?.id??null,address:hex(destination),offset:object?destination-object.address:null,size},
        sourceAddress:hex(call.copy.source),sourceObjectId:call.copy.sourceObjectId,sourceOffset:call.copy.sourceOffset,
        memoryState:this.captureMemory(destination,size,segments??[{start:0,end:size,writer:"unobserved"}]),
        dataInputs:[...new Set(segments?.map(s=>s.writer).filter(id=>id&&id!=="unobserved"))],evidence:"library API effect"});
      this.mark(object,destination,size,segments?null:"unobserved");for(const r of segments??[])this.mark(object,destination+r.start,r.end-r.start,r.writer==="unobserved"?"unobserved":r.writer?event.eventId:null);
      this.refreshPointers(object,destination,size,event);
    } else if(name==="memset"||name.startsWith("llvm.memset")) {
      const object=this.lookup(a(0),a(2)),event=this.event("WRITE",op,{action:"fill",target:{objectId:object?.id??null,address:hex(a(0)),offset:object?a(0)-object.address:null,size:a(2)},
        byte:a(1)&255,memoryState:filledMemory(a(2),a(1)&255),evidence:"library API effect"});this.mark(object,a(0),a(2),event.eventId);
    } else if(name.startsWith("llvm.va_start")) {const object=this.lookup(a(0));if(object)this.mark(object,a(0),object.address+object.size-a(0),e.eventId);}
    else if(["scanf","__isoc99_scanf","sscanf","fscanf"].includes(name))this.scanf(op,call,x);
    else if(name==="fgets"&&returned) {
      const object=this.lookup(returned),s=this.cstring(returned,Math.min(a(1),object?object.address+object.size-returned:a(1))),size=s.length+(s.terminated?1:0);
      this.check(returned,size,op,{write:true});const written=this.event("WRITE",op,{action:"input",target:{objectId:object?.id??null,address:hex(returned),offset:object?returned-object.address:null,size},
        memoryState:this.captureMemory(returned,size),dataInputs:call.inputEvents??[],callEventId:call.event.eventId,evidence:"library API effect"});this.mark(object,returned,size,written.eventId);
    }
    else if(op.external&&!name.startsWith("llvm.")&&!["free","strlen","strcmp","strncmp","memcmp","printf","fprintf","puts","fputs","putchar","fputc","fgetc","getchar","clock","ferror","fflush","vfprintf","exit","abort"].includes(name)){
      this.coverageGaps.add(`external-effects:${name}`);e.uncertainRegions=[];
      for(const [index,arg]of op.args.entries())if(arg.type.endsWith("*")){const address=a(index),object=this.lookup(address);if(object&&!object.constant){const size=object.address+object.size-address;this.mark(object,address,size,"unobserved");e.uncertainRegions.push({objectId:object.id,address:hex(address),size});}}
    }
    if(op.returnType.endsWith("*")&&!frame.origins.has(op.result))frame.origins.set(op.result,this.lookup(returned,0));
    frame.calls.delete(op.id);if(frame.activeCall===call)frame.activeCall=null;
  }
  scanf(op,call,result) {
    const name=op.callee.slice(1),formatIndex=name==="sscanf"||name==="fscanf"?1:0,format=this.cstring(this.address(call.args[formatIndex])).text;
    let index=formatIndex+1,assigned=0;const count=Number(BigInt.asIntN(32,result));
    for(const match of format.matchAll(/%(?:%|(\*)?(\d+)?(hh|ll|h|l|L|j|z|t)?([diuoxXfFeEgGaAcspn\[]))/g)) {
      if(match[0]==="%%"||match[1])continue;const conversion=match[4];if(conversion==="n"||conversion==="["){this.coverageGaps.add("scanf-format-effects");return;}if(assigned++>=count)break;
      const address=this.address(call.args[index++]),object=this.lookup(address);let size;
      if(conversion==="s"){const s=this.cstring(address,object?object.address+object.size-address:1048576);if(!s.terminated)this.fault("string-bounds","입력 문자열의 종결 문자를 객체 안에서 확인할 수 없습니다.",op);size=s.length+1;}
      else if(conversion==="c")size=Number(match[2]??1);
      else if(/[fFeEgGaA]/.test(conversion))size=match[3]==="l"?8:4;
      else size=match[3]==="hh"?1:match[3]==="h"?2:match[3]==="ll"||match[3]==="j"?8:4;
      this.check(address,size,op,{write:true});const e=this.event("WRITE",op,{action:"input",target:{objectId:object?.id??null,address:hex(address),offset:object?address-object.address:null,size},value:{bytesHex:this.bytes(address,size),byteLength:size,truncated:size>64},
        memoryState:this.captureMemory(address,size),dataInputs:call.inputEvents??[],callEventId:call.event.eventId,evidence:"library API effect"});this.mark(object,address,size,e.eventId);
    }
  }
  finish(execution) {
    if(execution.runtimeError&&!this.diagnostics.length){try{this.fault("runtime-trap",execution.runtimeError.message,null);}catch{}}
    if(!this.status)try{for(const frame of [...this.stack].reverse()){for(const o of this.objects.filter(o=>o.frameId===frame.id))this.end(o,null,"process-exit");frame.ended=true;this.event("SPACE",null,{action:"frame.end",frameId:frame.id,reason:"process-exit"});}}catch(error){if(!(error instanceof TraceStopped))throw error;}
    const status=this.status??"completed";
    this.flush();
    const edges=[...this.references.values()],groups=[];
    for(const type of new Set(this.views.filter(v=>v.kind==="record").map(v=>v.type))){const nodes=this.views.filter(v=>v.type===type),links=[];
      for(const edge of edges){const from=nodes.find(v=>v.objectId===edge.objectId&&edge.offset>=v.offset&&edge.offset+4<=v.offset+v.size),to=nodes.find(v=>v.objectId===edge.targetObjectId&&v.address===edge.address);if(from&&to)links.push({from:from.id,to:to.id,offset:edge.offset});}
      groups.push({type,nodes:nodes.map(v=>v.id),edges:links,...topology(nodes,links),snapshot:"last observed references, including ended objects"});}
    return {schemaVersion:2,programId:this.plan.programId,runId:this.runId,backend:this.plan.backend,status,exitCode:execution.exitCode,
      events:this.events,objects:this.objects.map(({writes,...o})=>({...o,initializationRanges:writes})),
      frames:this.frames.map(({definitions,origins,selects,calls,activeCall,sourceDecisions,...f})=>f),views:this.views,references:edges,structures:groups,
      diagnostics:this.diagnostics,coverage:{...this.plan.coverage,memorySnapshots:this.memorySnapshots.summary(),gaps:[...this.coverageGaps]}};
  }
}
