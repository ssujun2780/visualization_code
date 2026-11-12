import {randomUUID} from "node:crypto";
import {MemorySnapshots,filledMemory,initializationOf} from "./memory-state.mjs";
import {RangeOrigins} from './ranges.mjs';
import {bitSegments,markBits} from './bitfields.mjs';
import {FunctionReferences,isFunctionPointer} from './function-references.mjs';

export class TraceStopped extends Error {}
const unsigned=(value,bits=64)=>BigInt.asUintN(bits,BigInt(value));
const hex=(value,width=8)=>`0x${unsigned(value).toString(16).padStart(width,"0")}`;

export class ModelRecorder {
  constructor(plan,abi,{maxEvents=100000,maxObservationBytes=16777216,onEvents}={}) {
    Object.assign(this,{plan,abi,maxEvents,maxObservationBytes,onEvents});this.observationBytes=0;this.runId=randomUUID();this.events=[];this.objects=[];this.frames=[];
    this.stack=[];this.references=new Map();this.views=[];this.diagnostics=[];this.pendingArguments=new Map();this.sequence=0;this.batch=[];
    this.coverageGaps=new Set();this.globalsBySymbol=new Map();this.captureErrors=true;
    this.memorySnapshots=new MemorySnapshots();this.streamOffsets={stdout:0,stderr:0};this.stdioOffsets={stdout:0,stderr:0};
    this.nativeOrigins=new RangeOrigins();
    this.bufferOrigins=new RangeOrigins();this.inputDerivedEvents=new Set();
    this.functionReferences=new FunctionReferences();
  }
  setMemory=memory=>{this.memory=memory;};
  setStaticDataEnd=end=>{
    // The linker includes zero-initialized static storage in __data_end even
    // when those bytes have no active data segment in the WASM file.
    const start=Math.max(this.linkedDataBase??end,...this.linkedDataRegions?.map(r=>r.address+r.size)??[]);
    if(Number.isSafeInteger(end)&&end>start&&end<=this.memory.buffer.byteLength)
      (this.linkedDataRegions??=[]).push({address:start,size:end-start,evidence:'linker __data_end zero-initialized static tail',objectBounds:'unknown'});
  };
  output=(channel,text)=>{
    const call=this.frame()?.activeCall,byteLength=Buffer.byteLength(text),streamOffset=this.streamOffsets[channel]??0;
    this.event("WRITE",call?.operation??null,{action:"output",channel,text,byteLength,streamOffset,callEventId:call?.event?.eventId??null,evidence:"observed stream output"});
    this.streamOffsets[channel]=streamOffset+byteLength;
  };
  outputBytes=(channel,bytes,regions=[])=>{
    const call=this.frame()?.activeCall,streamOffset=this.streamOffsets[channel]??0;
    const delivery=this.event('WRITE',call?.operation??null,{action:'output.delivery',channel,bytesHex:Buffer.from(bytes).toString('hex'),
      text:new TextDecoder().decode(bytes),byteLength:bytes.length,streamOffset,callEventId:call?.event?.eventId??null,
      evidence:'observed WASI delivery'});
    this.streamOffsets[channel]=streamOffset+bytes.length;
    // The WASI iovec identifies the bytes actually delivered. Recover their
    // producing calls from observed memory stores, never from text matching.
    let offset=0;
    for(const region of regions)for(const part of this.nativeOrigins.get(region.address,region.size)){
      const length=part.end-part.start,userStorage=this.lookup(part.start,length),owner=userStorage?call:(part.value??call),chunk=Buffer.from(bytes).subarray(offset,offset+length);
      this.event('WRITE',owner?.operation??null,{action:'output',channel,bytesHex:chunk.toString('hex'),text:chunk.toString('utf8'),byteLength:length,
        streamOffset:streamOffset+offset,callEventId:owner?.event?.eventId??null,activationId:owner?.event?.activationId??null,
        outputOrigin:'delivery-attributed',deliveryObservationId:delivery.eventId,deliveryOffset:offset,
        dataInputs:[...(owner?.event?.dataInputs??[]),...this.nativeReadInputs(owner)],
        readRegions:this.nativeReadRegions(owner),bufferWriterCallEventId:part.value?.event?.eventId??null,
        evidence:!userStorage&&part.value?'observed runtime-buffer writer and WASI delivery':'observed WASI delivery in active call'});
      offset+=length;
    }
  };
  nativeReadInputs(call){return [...new Set([...(call?.nativeReads?.values()??[])].flatMap(r=>[...r.inputs]))];}
  nativeReadRegions(call){return [...(call?.nativeReads?.values()??[])].flatMap(r=>r.ranges.ranges.map(p=>({objectId:r.object.id,address:hex(r.object.address+p.start),
    offset:p.start,size:p.end-p.start,dataInputs:[...r.inputs],evidence:'observed linked memory reads'})));}
  nativeMemory=(phase,address,size)=>{
    address>>>=0;size>>>=0;if(!size)return;
    const active=this.frame()?.activeCall,call=active&&(active.operation.external||active.operation.callee.startsWith('%'))?active:null;
    // Track every observed store range, independently of width, function names
    // or byte equality. Host arrivals and call-effect ancestry stay distinct.
    for(const part of this.bufferOrigins.get(address,size))if(part.value){
      if(phase===1&&call&&part.value.eventId!==call.event.eventId){
        call.bufferReads??=new Map();const origin=part.value;
        const key=`${origin.eventId}:${part.start}:${part.end}`;
        if(origin.inputRelated)call.inputBufferRead=true;
        call.bufferReads.set(key,{address:hex(part.start),size:part.end-part.start,inputRelated:origin.inputRelated,
          ...(origin.streamOffset!==undefined?{streamOffset:origin.streamOffset+part.start-origin.address}:{}),
          bytesHex:Buffer.from(this.memory.buffer,part.start,part.end-part.start).toString('hex'),
          dataInputs:[...new Set([origin.eventId,origin.callEventId].filter(Boolean))],origin:origin.kind,
          ...(origin.writeSize?{writerAccessSize:origin.writeSize}:{}),
          evidence:origin.kind==='stream-arrival'?'observed read at host input byte address':'observed read after library memory write; call-level provenance'});
      }
    }
    if(phase===2){
      let origin=null;
      if(call){
        const inputRelated=!!(call.inputEvents?.length||call.inputBufferRead||call.event.dataInputs?.some(id=>this.inputDerivedEvents.has(id)));
        call.writeOrigins??=new Map();const key=`${size}:${inputRelated}`;
        if(!call.writeOrigins.has(key))call.writeOrigins.set(key,{eventId:call.event.eventId,kind:'buffer-write',inputRelated,writeSize:size});
        origin=call.writeOrigins.get(key);
      }
      this.bufferOrigins.set(address,size,origin);
    }
    if(phase===2)this.nativeOrigins.set(address,size,call);
    if(!call)return;
    call.nativeReads??=new Map();call.nativeWrites??=new Map();
    for(const object of this.objects){
      if(object.lifecycle!=='alive'||address>=object.address+object.size||address+size<=object.address)continue;
      const start=Math.max(address,object.address)-object.address,end=Math.min(address+size,object.address+object.size)-object.address;
      const map=phase===1?call.nativeReads:call.nativeWrites;let entry=map.get(object.id);
      if(!entry){entry={object,ranges:new RangeOrigins(),inputs:new Set()};map.set(object.id,entry);}
      entry.ranges.set(start,end-start,true);
      if(phase===1)for(const r of this.segments(object,start,end-start))if(r.writer&&r.writer!=='unobserved')entry.inputs.add(r.writer);
    }
  };
  recordNativeWrites(op,call,returned){
    for(const entry of call.nativeWrites?.values()??[])for(const range of entry.ranges.ranges){
      const object=entry.object,address=object.address+range.start,size=range.end-range.start;
      const e=this.event('WRITE',op,{action:'write.range',target:{objectId:object.id,address:hex(address),offset:range.start,size},
        memoryState:this.captureMemory(address,size),dataInputs:[...this.nativeReadInputs(call),...(call.event.dataInputs??[]),...(call.inputEvents??[]),call.inputReadEventId,...(call.libraryReadInputs??[]),...(call.callbackReturnEventIds??[])].filter(Boolean),
        readRegions:this.nativeReadRegions(call),callEventId:call.event.eventId,returnEventId:returned?.eventId??null,evidence:'observed linked memory stores'});
      this.mark(object,address,size,e.eventId);this.refreshPointers(object,address,size,e);
    }
    call.nativeWrites?.clear();
  }
  stdioOutput=(descriptor,address,size)=>{
    const channel=descriptor===1?'stdout':'stderr',call=this.frame()?.activeCall,streamOffset=this.stdioOffsets[channel]??0;
    const bytes=new Uint8Array(this.memory.buffer,address>>>0,size>>>0);
    this.event('WRITE',call?.operation??null,{action:'output',channel,bytesHex:Buffer.from(bytes).toString('hex'),
      text:new TextDecoder().decode(bytes),byteLength:bytes.length,streamOffset,callEventId:call?.event?.eventId??null,
      outputOrigin:'stdio',dataInputs:call?.event?.dataInputs??[],evidence:'observed libc formatted bytes accepted by stream'});
    this.stdioOffsets[channel]=streamOffset+bytes.length;
  };
  input=(bytes,streamOffset,regions=[])=>{
    const call=this.frame()?.activeCall,event=this.event("READ",call?.operation??null,{action:"input",channel:"stdin",bytesHex:Buffer.from(bytes).toString("hex"),
      byteLength:bytes.length,streamOffset,inputStage:'arrival',callEventId:call?.event?.eventId??null,evidence:"observed stream input"});
    for(const region of regions)this.bufferOrigins.set(region.address,region.size,
      {eventId:event.eventId,kind:'stream-arrival',inputRelated:true,address:region.address,streamOffset:region.streamOffset});
    if(call)(call.inputEvents??=[]).push(event.eventId);
  };
  event(kind,op,fields={}) {
    if(this.events.length>=this.maxEvents&&kind!=="ERROR")this.fault("trace-limit","실행 기록 제한에 도달했습니다.",op,"limited");
    const event={schemaVersion:2,runId:this.runId,eventId:`e${++this.sequence}`,instructionId:op?.id??null,
      activationId:this.stack.at(-1)?.id??null,kind,source:op?.source??null,sceneId:op?.sceneId??null,evidence:"observed",...fields};
    if(kind==='READ'&&fields.action==='input'||fields.dataInputs?.some(id=>this.inputDerivedEvents.has(id)))this.inputDerivedEvents.add(event.eventId);
    const bytes=Buffer.byteLength(JSON.stringify(event));
    if(kind!=='ERROR'&&this.observationBytes+bytes>this.maxObservationBytes){this.sequence--;
      this.fault('trace-size-limit','관찰 기록의 바이트 한도에 도달했습니다.',op,'limited');}
    this.observationBytes+=bytes;this.events.push(event);this.batch.push(event);return event;
  }
  checkpoint(){return {programId:this.plan.programId,runId:this.runId,backend:this.plan.backend,
    objects:this.objects.map(({writes,bitWrites,...o})=>({...o,initializationRanges:writes,bitInitializationRanges:bitWrites})),
    frames:this.frames.map(({definitions,origins,allocations,selects,calls,activeCall,sourceDecisions,stackSaves,...f})=>f),
    views:this.views,references:[...this.references.values()],diagnostics:this.diagnostics,
    coverage:{gaps:[...this.coverageGaps],observationBytes:this.observationBytes,maxObservationBytes:this.maxObservationBytes}};}
  flush(){if(this.batch.length){this.onEvents?.(this.batch,this.checkpoint());this.batch=[];}}
  fault(code,message,op,status="fault",details={}) {
    if(!this.diagnostics.length){const e=this.event("ERROR",op,{phase:"fault",diagnostic:{code,message},...details});this.diagnostics.push({...e.diagnostic,eventId:e.eventId,source:e.source});}
    this.status=status;throw new TraceStopped(message);
  }
  frame(){return this.stack.at(-1);}
  scalar(type,bits) {
    bits=unsigned(bits);const width=/^i(\d+)$/.exec(type)?.[1];
    if(width){const n=Number(width),v=unsigned(bits,n);return {type,bits:hex(v,Math.ceil(n/4)),unsigned:v.toString(),signed:BigInt.asIntN(n,v).toString()};}
    if(isFunctionPointer(type)){const tableIndex=this.address(bits);return {type,bits:hex(bits),tableIndex,reference:this.functionReferences.target(tableIndex)};}
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
  linkedStorage(address,op){
    const existing=this.lookup(address,0);if(existing)return existing;
    const region=this.linkedDataRegions?.find(r=>address>=r.address&&address<r.address+r.size);if(!region)return null;
    // A linked data segment proves mapped static bytes, not a C allocation's
    // precise bounds. Keep that limitation explicit and exclude known objects.
    let start=region.address,end=start+region.size;
    for(const o of this.objects.filter(o=>o.lifecycle==='alive')){
      if(o.address+o.size<=address)start=Math.max(start,o.address+o.size);
      if(o.address>address)end=Math.min(end,o.address);
    }
    const object=this.create(start,end-start,op,{storage:'static',initialized:true});
    object.storageEvidence={...region,objectBounds:'unknown',source:'linked-data'};
    return object;
  }
  registerVarargs(op,call){
    const frame=this.frame(),parent=this.stack.at(-2),owner=parent?.activeCall;
    if(!frame.variadic||frame.varargStorage||!owner||frame.callbackOfCallEventId)return;
    const args=owner.operation.args.slice(frame.fixedParameterCount),start=new DataView(this.memory.buffer).getUint32(this.address(call.args[0]),true);
    let end=start;const ranges=[];
    for(const arg of args){const layout=this.abi.layout(arg.type),alignment=Math.max(4,layout.align);
      end=Math.ceil(end/alignment)*alignment;
      const producer=parent.definitions.get(arg.value);
      ranges.push({start:end-start,end:end-start+layout.size,writer:producer?.eventId??owner.event.eventId});
      end+=Math.ceil(layout.size/4)*4;
    }
    if(!args.length)return;
    const object=this.create(start,end-start,op,{storage:'automatic',initialRanges:ranges});
    object.storageEvidence={source:'wasm32 variadic ABI',callEventId:owner.event.eventId,argumentTypes:args.map(a=>a.type)};
    frame.varargStorage=object.id;
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
  mark(object,address,size,writer,bitfield=null,mirror=true) {
    if(!object||!size)return;const start=address-object.address,end=start+size,result=[];
    for(const r of object.writes){if(r.end<=start||r.start>=end)result.push(r);else {if(r.start<start)result.push({...r,end:start});if(r.end>end)result.push({...r,start:end});}}
    result.push({start,end,writer});object.writes=result.sort((a,b)=>a.start-b.start);
    object.bitWrites=markBits(object.bitWrites,start*8+(bitfield?.shift??0),bitfield?.width??size*8,writer);
    delete object.valueProducedBy;
    for(const [key,r]of this.references)if(r.objectId===object.id&&r.offset<end&&r.offset+4>start)this.references.delete(key);
    if(mirror){const root=object.storageAlias?.rootObjectId??object.id;
      for(const other of this.objects)if(other!==object&&other.lifecycle==='alive'&&(other.storageAlias?.rootObjectId??other.id)===root&&
        address>=other.address&&address+size<=other.address+other.size)this.mark(other,address,size,writer,bitfield,false);
    }
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
      frameId:frameId??(storage==="automatic"?this.frame()?.id:null),lifecycle:"alive",constant,writes:initialRanges?.map(r=>({...r}))??[],
      bitWrites:initialRanges?.map(r=>({...r,start:r.start*8,end:r.end*8}))??[],createdBy:null};
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
  pointerTarget(value,type,origin=null) {
    if(isFunctionPointer(type))return this.functionReferences.target(value);
    const destination=value?(origin??this.lookup(value,0)):null,offset=destination?value-destination.address:null;
    const onePast=!!destination&&offset===destination.size;let width=0;
    try{width=this.abi.layout(type.slice(0,-1)).size;}catch{}
    return {targetObjectId:destination?.id??null,targetOffset:offset,onePast,
      ...(destination?.storageEvidence?.objectBounds==='unknown'?{objectBounds:'unknown',boundsEvidence:'mapped linked-data bytes; C object bounds unknown'}:{}),
      status:!value?'null':!destination?'unknown':destination.lifecycle!=='alive'?'ended':onePast?'one-past':offset<0||offset>=destination.size?'out-of-bounds':'in-bounds',
      dereferenceable:!!destination&&destination.lifecycle==='alive'&&width>0&&offset>=0&&offset+width<=destination.size,
      evidence:origin?'observed pointer origin':'address lookup'};
  }
  pointerWrite(object,address,type,value,event,origin=null) {
    if(!object||!type.endsWith("*"))return;
    const target=this.pointerTarget(value,type,origin),destination=this.objects.find(o=>o.id===target.targetObjectId),base=type.slice(0,-1);
    if(destination)this.view(destination,value,base);
    this.references.set(`${object.id}:${address-object.address}`,{objectId:object.id,offset:address-object.address,...(isFunctionPointer(type)?{}:{address:value}),
      ...target,type,eventId:event.eventId});
    const root=object.storageAlias?.rootObjectId??object.id;
    for(const other of this.objects)if(other!==object&&other.lifecycle==='alive'&&(other.storageAlias?.rootObjectId??other.id)===root&&
      address>=other.address&&address+4<=other.address+other.size){
      this.references.set(`${other.id}:${address-other.address}`,{...this.references.get(`${object.id}:${address-object.address}`),objectId:other.id,offset:address-other.address});
    }
    if(event.value&&event.target?.objectId===object.id&&event.target.address===hex(address))event.value.reference=target;
  }
  copyPointerOrigins(objectId,offset,size,destination){
    const origins=new Map();
    for(const r of this.references.values())if(r.objectId===objectId&&r.offset>=offset&&r.offset+4<=offset+size)
      origins.set(destination+r.offset-offset,{address:r.address,targetObjectId:r.targetObjectId});
    return origins;
  }
  refreshPointers(object,address,size,event,origins=null) {
    if(!object)return;
    const contains=(type,seen=new Set())=>{if(seen.has(type))return false;seen.add(type);const l=this.abi.layout(type);return l.kind==="pointer"||l.kind==="array"&&contains(l.elementType,seen)||l.kind==="record"&&l.fields.some(f=>contains(f.type,new Set(seen)));};
    let count=0;
    const walk=(type,at)=>{
      if(count>4096){this.coverageGaps.add("pointer-view-truncated");return;}
      const l=this.abi.layout(type);if(!contains(type))return;
      if(l.kind==="pointer") {count++;if(at>=address&&at+4<=address+size&&!this.segments(object,at-object.address,4).some(s=>!s.writer||s.writer==="unobserved")){
        const value=new DataView(this.memory.buffer).getUint32(at,true),copied=origins?.get(at),origin=copied?.address===value?this.objects.find(o=>o.id===copied.targetObjectId):null;
        this.pointerWrite(object,at,type,value,event,origin);
      }}
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
    // Send only between hooks: the preceding hook's object and value changes
    // must be complete before its events and state are transferred together.
    if(this.batch.length>=256)this.flush();
    if(index===-1){this.nativeMemory(phase,address,size);return;}
    const op=this.plan.instructions[index-1];if(!op)throw new Error(`알 수 없는 명령 ${index}`);
    x=unsigned(x);y=unsigned(y);address>>>=0;size>>>=0;
    if(op.action==='function.address'){this.functionReferences.register(this.address(x),op);return;}
    if(op.action==="function.enter"){
      // A source callback can read changes made by an opaque caller before that
      // caller returns. Commit pending observations at the callback boundary.
      const pending=this.frame()?.activeCall;
      if(pending&&!pending.operation.external){
        pending.event.resolvedFunctionId=op.functionId;pending.event.resolvedFunctionName=op.functionName;
        pending.event.resolvedFunctionEvidence='observed function entry';
        if(pending.event.functionTarget)pending.event.functionTarget={...pending.event.functionTarget,status:'resolved',
          functionId:op.functionId,functionName:op.functionName,evidence:'observed function pointer and function entry'};
      }
      if(pending?.nativeWrites?.size)this.recordNativeWrites(pending.operation,pending,null);
      const parent=this.frame(),frame={id:`f${this.frames.length+1}`,functionId:op.functionId,functionName:op.functionName,parent:parent?.id??null,
        variadic:op.variadic,fixedParameterCount:op.fixedParameterCount,
        ended:false,definitions:new Map(),origins:new Map(),allocations:new Map(),selects:new Map(),calls:new Map(),sourceDecisions:new Map(),block:op.block??"entry"};
      if(pending?.operation.external)frame.callbackOfCallEventId=pending.event.eventId;
      this.frames.push(frame);this.stack.push(frame);this.event("SPACE",op,{action:"frame.begin",frameId:frame.id,callbackOfCallEventId:frame.callbackOfCallEventId});this.event("FLOW",op,{action:"enter",frameId:frame.id});return;
    }
    const frame=this.frame();
    if(op.action==='stack.save'){
      (frame.stackSaves??=[]).push({token:this.address(x),objectIndex:this.objects.length});return;
    }
    if(op.action==='stack.restore'){
      const saves=frame.stackSaves??[],at=saves.findLastIndex(s=>s.token===this.address(x));
      if(at<0)this.fault('stack-lifetime-binding','스택 복원의 수명 시작 관찰을 찾지 못했습니다.',op);
      const saved=saves[at];
      for(const o of this.objects.slice(saved.objectIndex))if(o.frameId===frame.id&&o.storage==='automatic'&&o.lifecycle==='alive')this.end(o,op,'stack-restore');
      saves.splice(at);return;
    }
    if(op.action==="short-circuit") {
      const e=this.event("FLOW",op,{action:"short-circuit",phase:"decision",operator:op.shortCircuit.operator,
        left:op.shortCircuit.left,right:op.shortCircuit.right,reason:op.shortCircuit.reason,
        anchorInstructionId:op.anchorInstructionId,observedConsumerValue:this.scalar(op.consumerType,x),
        evidence:"compiler source semantics at observed consumer",timing:"before-consumer"});
      const previous=frame.sourceDecisions.get(op.anchorInstructionId)??[];frame.sourceDecisions.set(op.anchorInstructionId,[...previous,e.eventId]);return;
    }
    if(op.action==="function.argument") {
      const p=op.parameter,parent=this.stack.at(-2),call=frame.callbackOfCallEventId?null:parent?.activeCall;
      const argument=call?.operation?.args[p.index],producer=argument&&parent?.definitions.get(argument.value);
      const e=this.event("WRITE",op,{action:"argument",parameterIndex:p.index,name:op.local?.name??null,value:this.semanticValue(this.scalar(p.type,x),op.cType),callEventId:call?.event?.eventId??null,dataInputs:[producer?.eventId].filter(Boolean)});
      frame.definitions.set(p.value,e);
      if(p.byval){const address=this.address(x),type=p.type.slice(0,-1),size=this.abi.layout(type).size,sourceAddress=call?this.address(call.args[p.index]):null,source=call&&this.lookup(sourceAddress,size),offset=source?sourceAddress-source.address:0;
        const initialRanges=source?this.segments(source,offset,size).map(r=>({...r,start:r.start-offset,end:r.end-offset})):[{start:0,end:size,writer:"unobserved"}];
        const origins=source?this.copyPointerOrigins(source.id,offset,size,address):null;
        const dataInputs=[...new Set(initialRanges.map(r=>r.writer).filter(id=>id&&id!=='unobserved'))];
        const object=this.create(address,size,op,{storage:"automatic",name:op.local?.name,type,cType:op.cType,debugTypeId:op.local?.debugTypeId,
          initialRanges,copiedFrom:source?{objectId:source.id,offset,size,dataInputs,valueObservationId:source.valueProducedBy??null}:null});
        e.dataInputs=[...dataInputs,...source?.valueProducedBy?[source.valueProducedBy]:[]];
        this.refreshPointers(object,address,size,e,origins);
        if(!source)this.coverageGaps.add("byval-initialization-source-unobserved");
        frame.origins.set(p.value,object);
      }else if(p.type.endsWith("*")){
        const origin=call&&(parent.origins.get(argument?.value)??this.globalsBySymbol.get(argument?.value));
        if(!isFunctionPointer(p.type))frame.origins.set(p.value,origin??this.lookup(this.address(x),0));
        e.value.reference=this.pointerTarget(this.address(x),p.type,origin);
      }
      return;
    }
    if(frame&&op.block&&frame.block!==op.block){frame.previousBlock=frame.block;frame.block=op.block;}
    if(op.action==="globals.ready") {for(const o of this.objects.filter(o=>o.storage==="static"))this.refreshPointers(o,o.address,o.size,{eventId:o.createdBy});return;}
    if(op.action==="global.begin") {const g=op.global;if(this.globalsBySymbol.has(g.symbol))return;const o=this.create(address,size,op,{storage:"static",name:g.name,type:g.type,cType:g.cType,debugTypeId:g.debugTypeId,initialized:true,constant:g.constant});this.globalsBySymbol.set(g.symbol,o);return;}
    if(op.action==="object.begin") {
      const storage={address,size:this.address(x),operation:op};frame.allocations.set(op.id,storage);
      if(op.lifetimeManaged)storage.reservationObservationId=this.event("SPACE",op,{action:"storage.reserve",address:hex(address),size:storage.size}).eventId;
      else{const o=this.create(address,storage.size,op,{storage:"automatic",name:op.local?.name,type:op.type,cType:op.cType,debugTypeId:op.local?.debugTypeId});frame.origins.set(op.result,o);}
      return;
    }
    if(op.action==="lifetime.start"||op.action==="lifetime.end") {
      const storage=frame.allocations.get(op.allocationObservationId),allocation=storage?.operation;
      if(!allocation||storage.address!==address)this.fault("lifetime-binding","객체의 수명 표식과 할당 주소를 연결하지 못했습니다.",op);
      if(op.action==="lifetime.start"){
        const prior=frame.origins.get(allocation.result);
        if(prior?.lifecycle==="alive")return; // A declaration reached again in the same lifetime is not a new object.
        const o=this.create(address,storage.size,op,{storage:"automatic",name:allocation.local?.name,type:allocation.type,cType:allocation.cType,debugTypeId:allocation.local?.debugTypeId});
        this.events.at(-1).reservationObservationId=storage.reservationObservationId;
        frame.origins.set(allocation.result,o);
      }else this.end(frame.origins.get(allocation.result),op,op.endReason??"scope-exit");
      return;
    }
    if(op.action==="source.declaration") {
      const object=frame.origins.get(op.pointer.value)??this.lookup(address,0);
      this.event("SPACE",op,{action:"declaration",objectId:object?.id??null,address:hex(address),
        evidence:"observed source declaration"});return;
    }
    if(op.action==='source.alias'){
      const backing=this.lookup(address,size);
      if(!backing)this.fault('source-storage-binding','지역 객체와 반환 저장소를 연결하지 못했습니다.',op);
      const object=this.create(address,size,op,{storage:'automatic',name:op.local.name,type:op.type,cType:op.cType,debugTypeId:op.local.debugTypeId});
      object.storageAlias={objectId:backing.id,rootObjectId:backing.storageAlias?.rootObjectId??backing.id,address:hex(address),size,
        offset:address-backing.address,
        evidence:'compiler dbg.declare on sret parameter; shared physical storage, distinct source lifetime'};
      this.events.at(-1).storageAlias=object.storageAlias;
      frame.origins.set(op.pointer.value,object);return;
    }
    if(op.action==="call"){this.call(op,phase,x);return;}
    if(op.action==="load"||op.action==="store") {
      const isStore=op.action==="store",origin=this.origin(op.pointer);
      const object=this.check(address,size,op,{write:isStore,initialized:!isStore&&!op.bitfield,origin});
      const bitWriters=op.bitfield&&object?bitSegments(object.bitWrites,(address-object.address)*8+op.bitfield.shift,op.bitfield.width):null;
      if(!isStore&&op.bitfield?.role==='read'&&bitWriters?.some(r=>!r.writer))
        this.fault('uninitialized-read','초기화되지 않은 비트필드를 읽었습니다.',op);
      if(phase===0){this.event(op.kind,op,{phase:"attempt",target:{objectId:object?.id??null,address:hex(address),size},controlInputs:frame.sourceDecisions.get(op.id)??[]});return;}
      const inputs=this.inputs(op),previous=object?this.segments(object,address-object.address,size).map(s=>s.writer).filter(Boolean):[];
      const e=this.event(op.kind,op,{phase:"commit",target:{objectId:object?.id??null,address:hex(address),offset:object?address-object.address:null,size},
        value:this.semanticValue(this.snapshot(address,size,op.type),op.cType??(object?.type===op.type?object.cType:null)),dataInputs:isStore?inputs:[...new Set(previous.filter(id=>id!=="unobserved"))],addressInputs:[this.inputEvent(op.pointer)?.eventId].filter(Boolean),
        ...(bitWriters?{bitfieldDataInputs:[...new Set(bitWriters.map(r=>r.writer).filter(id=>id&&id!=='unobserved'))]}:{}),
        initializationEvidence:object&&!previous.includes("unobserved")?"tracked":"unobserved",controlInputs:frame.sourceDecisions.get(op.id)??[]});
      frame.sourceDecisions.delete(op.id);
      if(isStore){this.mark(object,address,size,e.eventId,op.bitfield);if(op.type.endsWith("*"))this.pointerWrite(object,address,op.type,new DataView(this.memory.buffer).getUint32(address,true),e,this.origin(op.inputs[0]));else this.refreshPointers(object,address,size,e);}
      else if(op.result){frame.definitions.set(op.result,e);if(op.type.endsWith("*")){
        const n=new DataView(this.memory.buffer).getUint32(address,true),reference=object&&this.references.get(`${object.id}:${address-object.address}`);
        const target=reference?.address===n?this.objects.find(o=>o.id===reference.targetObjectId):null;
        if(!isFunctionPointer(op.type))frame.origins.set(op.result,target??this.lookup(n,0)??this.objects.findLast(o=>n>=o.address&&n<o.address+o.size));
        e.value.reference=this.pointerTarget(n,op.type,target);
      }}
      return;
    }
    if(op.action==="function.return") {
      let aggregate=null;
      if(op.aggregateReturn){
        const info=op.aggregateReturn,address=this.address(this.inputEvent({value:info.pointer})?.value?.address??0),size=this.abi.layout(info.type).size,object=this.lookup(address,size);
        if(object){const offset=address-object.address,segments=this.segments(object,offset,size),writers=[...new Set(segments.map(s=>s.writer).filter(id=>id&&id!=="unobserved"))];
          const previous=writers.length===1?this.events[Number(writers[0].slice(1))-1]:null;
          const memoryState=previous?.target?.address===hex(address)&&previous.target.size===size&&previous.memoryState||
            this.captureMemory(address,size,segments.map(s=>({...s,start:s.start-offset,end:s.end-offset})));
          aggregate={value:{kind:'aggregate',type:info.type,cType:info.cType,byteLength:size,evidence:'observed return storage'},memoryState,
            sourceObjectId:object.id,sourceAddress:hex(address),sourceOffset:offset,sourceSize:size,dataInputs:writers,
            ...(object.storageAlias?{returnStorage:object.storageAlias}:{})};
        }else this.coverageGaps.add('aggregate-return-storage-unobserved');
      }
      const returned=aggregate||op.type!=="void"?this.event("WRITE",op,{action:"return.value",
        value:this.semanticValue(this.scalar(op.type,x),op.cType??this.inputEvent(op.inputs?.[0])?.value?.cType),dataInputs:this.inputs(op),
        ...aggregate,controlInputs:frame.sourceDecisions.get(op.id)??[]}):null;
      if(returned&&op.type.endsWith('*'))returned.value.reference=this.pointerTarget(this.address(x),op.type,this.origin(op.inputs[0]));
      const parent=this.stack.at(-2);if(parent?.activeCall&&returned){
        if(frame.callbackOfCallEventId)(parent.activeCall.callbackReturnEventIds??=[]).push(returned.eventId);
        else {parent.activeCall.returnEventId=returned.eventId;if(op.type.endsWith('*'))parent.activeCall.returnOrigin=this.origin(op.inputs[0]);}
      }
      if(aggregate){const physical=this.objects.find(o=>o.id===(aggregate.returnStorage?.objectId??aggregate.sourceObjectId));
        if(physical)physical.valueProducedBy=returned.eventId;}
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
    if(op.action==='merge')e.selectedInput=op.incoming.find(i=>i.block===frame.previousBlock)??null;
    if(op.action==='select')e.selectedInput=op.inputs[frame.selects.get(op.id)?1:2];
    if(op.conversion){const input=this.inputEvent(op.inputs[0]),literal=/^-?\d+$/.test(op.inputs[0].value)?op.inputs[0].value:null,
      bits=op.conversion.bitsUnchanged?x:input?.value?.bits??literal;
      e.conversion={...op.conversion,fromValue:bits!==null&&bits!==undefined?this.semanticValue(this.scalar(op.inputs[0].type,BigInt(bits)),op.conversion.fromType):{cType:op.conversion.fromType,evidence:"unobserved"}};}
    if(op.result)frame.definitions.set(op.result,e);
    if(op.type?.endsWith("*")){
      const source=['merge','select'].includes(op.action)?e.selectedInput:op.pointer??op.inputs?.[0],
        n=this.address(x),origin=isFunctionPointer(op.type)?null:this.origin(source)??this.lookup(n,0);
      if(!isFunctionPointer(op.type))frame.origins.set(op.result,origin);
      e.value.reference=this.pointerTarget(n,op.type,origin);
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
    // Compiler-resolved source definitions are user functions even if their
    // spelling matches libc. Only unresolved external symbols use adapters.
    const name=op.external?op.callee.slice(1).replace(/^"|"$/g,""):"";
    if(phase===0) {
      call.operation=op;
      const indirect=op.callee[0]==='%',calleeInputs=indirect?[this.inputEvent({value:op.callee})?.eventId].filter(Boolean):[],
        functionTarget=indirect?this.functionReferences.target(this.address(x)):null;
      call.event=this.event("FLOW",op,{action:"call.begin",callee:op.callee,indirectAddress:op.callee[0]==="%"?hex(x):null,
        ...(indirect?{indirectTableIndex:this.address(x),functionTarget,calleeInputs,
          resolvedFunctionId:functionTarget.functionId,resolvedFunctionName:functionTarget.functionName}:{}),
        arguments:op.args.map((a,i)=>this.semanticValue(this.scalar(a.type,call.args[i]??0n),a.cType??this.inputEvent(a)?.value?.cType)),
        dataInputs:[...new Set([...this.inputs(op),...calleeInputs])],controlInputs:frame.sourceDecisions.get(op.id)??[],external:op.external});
      frame.sourceDecisions.delete(op.id);
      frame.activeCall=call;
      if(name==="realloc"&&call.args[0]){const old=this.lookup(this.address(call.args[0]),0);if(!old||old.storage!=="heap"||old.address!==this.address(call.args[0]))this.fault("invalid-realloc","할당 시작 주소가 아닌 곳을 재할당하려고 했습니다.",op);call.old=old;call.oldWrites=old.writes.map(r=>({...r}));}
      if(name==="free"&&call.args[0]){const address=this.address(call.args[0]),o=this.lookup(address,0);if(!o||o.storage!=="heap"||o.address!==address)this.fault("invalid-free","유효한 동적 할당의 시작 주소를 해제해야 합니다.",op);this.end(o,op,"free");}
      if(name.startsWith("llvm.memcpy")||name.startsWith("llvm.memmove")||["memcpy","memmove"].includes(name)) {
        const destination=this.address(call.args[0]),source=this.address(call.args[1]),size=this.address(call.args[2]);
        this.check(destination,size,op,{write:true,origin:this.origin(op.args[0])});const object=this.check(source,size,op,{origin:this.origin(op.args[1])});
        call.copy={destination,source,size,sourceObjectId:object?.id??null,sourceOffset:object?source-object.address:null,
          pointerOrigins:object?this.copyPointerOrigins(object.id,source-object.address,size,destination):null,
          segments:object?this.segments(object,source-object.address,size).map(r=>({...r,start:r.start+object.address-source,end:r.end+object.address-source})):null};
      }
      if(name.startsWith("llvm.memset")||name==="memset")this.check(this.address(call.args[0]),this.address(call.args[2]),op,{write:true,origin:this.origin(op.args[0])});
      if(op.external&&["strcpy","strncpy","strcat"].includes(name))call.stringEffect=this.prepareStringEffect(op,call,name);
      return;
    }
    const bufferReads=[...(call.bufferReads?.values()??[])],streamReads=bufferReads.filter(r=>r.origin==='stream-arrival'),
      libraryReads=bufferReads.filter(r=>r.origin!=='stream-arrival');
    call.libraryReadInputs=[...new Set(libraryReads.flatMap(r=>r.dataInputs))];
    const consumed=streamReads.length?this.event('READ',op,{action:'input',inputStage:'buffer-read',channel:'stdin',
      streamReadRegions:streamReads,dataInputs:[...new Set(streamReads.flatMap(r=>r.dataInputs))],callEventId:call.event.eventId,
      evidence:'observed stream-backed memory reads; not a guessed logical token length'}):null;
    call.inputReadEventId=consumed?.eventId;
    const e=this.event("FLOW",op,{action:"call.end",callee:op.callee,value:this.semanticValue(this.scalar(op.returnType,x),op.cType),callEventId:call.event.eventId,
      dataInputs:[call.returnEventId,...(call.callbackReturnEventIds??[]),...this.nativeReadInputs(call),...(call.inputEvents??[]),consumed?.eventId,...call.libraryReadInputs].filter(Boolean),
      readRegions:this.nativeReadRegions(call),...(libraryReads.length?{libraryReadRegions:libraryReads}:{})});
    // Later buffer reads depend on the completed writer's observed effects as
    // well as its arguments. A call-begin alone cannot link newly arrived data.
    for(const origin of call.writeOrigins?.values()??[]){origin.eventId=e.eventId;origin.callEventId=call.event.eventId;}
    if(op.result)frame.definitions.set(op.result,e);
    const a=i=>this.address(call.args[i]??0n),returned=this.address(x),allocates=["malloc","calloc","realloc"].includes(name);
    if(allocates) {
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
        callEventId:call.event.eventId,returnEventId:e.eventId,addressInputs:this.inputs(op),sourceSize:size,
        memoryState:this.captureMemory(destination,size,segments??[{start:0,end:size,writer:"unobserved"}]),
        dataInputs:[...new Set(segments?.map(s=>s.writer).filter(id=>id&&id!=="unobserved"))],evidence:"library API effect"});
      this.mark(object,destination,size,segments?null:"unobserved");for(const r of segments??[])this.mark(object,destination+r.start,r.end-r.start,r.writer==="unobserved"?"unobserved":r.writer?event.eventId:null);
      this.refreshPointers(object,destination,size,event,call.copy.pointerOrigins);
    } else if(name==="memset"||name.startsWith("llvm.memset")) {
      const object=this.lookup(a(0),a(2)),event=this.event("WRITE",op,{action:"fill",target:{objectId:object?.id??null,address:hex(a(0)),offset:object?a(0)-object.address:null,size:a(2)},
        byte:a(1)&255,memoryState:filledMemory(a(2),a(1)&255),evidence:"library API effect"});this.mark(object,a(0),a(2),event.eventId);
    } else if(name.startsWith("llvm.va_start")) {const object=this.lookup(a(0));if(object)this.mark(object,a(0),object.address+object.size-a(0),e.eventId);this.registerVarargs(op,call);}
    else if(["scanf","__isoc99_scanf","sscanf","fscanf"].includes(name)&&!this.nativeMemoryCoverage)this.scanf(op,call,x);
    else if(name==="fgets"&&returned) {
      const object=this.lookup(returned),s=this.cstring(returned,Math.min(a(1),object?object.address+object.size-returned:a(1))),size=s.length+(s.terminated?1:0);
      this.check(returned,size,op,{write:true});const written=this.event("WRITE",op,{action:"input",target:{objectId:object?.id??null,address:hex(returned),offset:object?returned-object.address:null,size},
        memoryState:this.captureMemory(returned,size),dataInputs:[...(call.inputEvents??[]),consumed?.eventId].filter(Boolean),callEventId:call.event.eventId,evidence:"library API effect"});this.mark(object,returned,size,written.eventId);
    }
    else if(this.nativeMemoryCoverage){
      this.recordNativeWrites(op,call,e);
      if(op.returnType.endsWith('*')&&!isFunctionPointer(op.returnType)&&returned&&!call.returnOrigin&&!this.lookup(returned,0)&&!this.linkedStorage(returned,op)){
        this.coverageGaps.add('external-return-storage-untracked');e.uncertainRegions=[{address:hex(returned),reason:'returned storage has no observed allocation contract'}];
      }
    }
    else if(op.external&&!name.startsWith("llvm.")&&!["free","strlen","strcmp","strncmp","memcmp","printf","fprintf","puts","fputs","putchar","fputc","fgetc","getchar","clock","ferror","fflush","vfprintf","exit","abort"].includes(name)){
      this.coverageGaps.add(`external-effects:${name}`);e.uncertainRegions=[];
      for(const [index,arg]of op.args.entries())if(arg.type.endsWith("*")){const address=a(index),object=this.lookup(address);if(object&&!object.constant){const size=object.address+object.size-address;this.mark(object,address,size,"unobserved");e.uncertainRegions.push({objectId:object.id,address:hex(address),size});}}
    }
    if(call.returnEventId){const value=this.events[Number(call.returnEventId.slice(1))-1];
      if(value?.value?.kind==='aggregate'){const physical=this.objects.find(o=>o.id===(value.returnStorage?.objectId??value.sourceObjectId));
        if(physical)physical.valueProducedBy=e.eventId;}
    }
    if(op.external){const slot=op.args.findIndex(a=>a.sret);
      if(slot>=0){const address=a(slot),type=op.args[slot].type.slice(0,-1),size=this.abi.layout(type).size,object=this.lookup(address,size);
        if(object){const offset=address-object.address,segments=this.segments(object,offset,size);
          e.backendValue=e.value;e.value={kind:'aggregate',type,cType:op.cType,byteLength:size,evidence:'observed external return storage'};
          Object.assign(e,{memoryState:this.captureMemory(address,size,segments.map(r=>({...r,start:r.start-offset,end:r.end-offset}))),
            sourceObjectId:object.id,sourceAddress:hex(address),sourceOffset:offset,sourceSize:size,
            dataInputs:[...new Set(segments.map(r=>r.writer).filter(id=>id&&id!=='unobserved'))]});
          object.valueProducedBy=e.eventId;
        }
      }
    }
    // A call-site SSA name is reused on each loop iteration. Its current
    // return must replace the prior invocation's origin, including null and
    // one-past pointers. Allocation contracts above already set a fresh origin.
    if(op.returnType.endsWith("*")&&!isFunctionPointer(op.returnType)&&(!allocates||!returned))
      frame.origins.set(op.result,call.returnOrigin??this.lookup(returned,0));
    if(op.returnType.endsWith('*'))e.value.reference=this.pointerTarget(returned,op.returnType,frame.origins.get(op.result));
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
    if(!this.status)try{while(this.stack.length){const frame=this.frame();
      for(const o of this.objects.filter(o=>o.frameId===frame.id))this.end(o,null,"process-exit");
      frame.ended=true;this.event("SPACE",null,{action:"frame.end",frameId:frame.id,reason:"process-exit"});this.stack.pop();
    }}catch(error){if(!(error instanceof TraceStopped))throw error;}
    const status=this.status??"completed";
    this.flush();
    const edges=[...this.references.values()];
    return {schemaVersion:2,programId:this.plan.programId,runId:this.runId,backend:this.plan.backend,status,exitCode:execution.exitCode,
      events:this.events,objects:this.objects.map(({writes,bitWrites,...o})=>({...o,initializationRanges:writes,bitInitializationRanges:bitWrites})),
      frames:this.frames.map(({definitions,origins,allocations,selects,calls,activeCall,sourceDecisions,stackSaves,...f})=>f),views:this.views,references:edges,structures:[],
      diagnostics:this.diagnostics,coverage:{...this.plan.coverage,
        ...(this.nativeMemoryCoverage?{linkedMemory:this.nativeMemoryCoverage,memory:'user LLVM accesses and linked WASM scalar accesses to tracked objects; allocation contracts remain explicit',libraryInternals:'linked scalar memory reads/stores observed; library arithmetic and source frames are not instrumented'}:{}),
        observationBytes:this.observationBytes,maxObservationBytes:this.maxObservationBytes,
        memorySnapshots:this.memorySnapshots.summary(),gaps:[...this.coverageGaps]}};
  }
}
