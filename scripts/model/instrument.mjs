import {createHash} from "node:crypto";
import {splitTop,typed,operand,metadata,layouts,parseCall} from "./llvm.mjs";
import {semanticModel} from "./c-semantics.mjs";
import {buildIRPlan} from "./ir-plan.mjs";

const symbol="(?:[-\\w.$]+|\"[^\"]+\")";
export class UnsupportedC extends Error { constructor(message,source){super(message);this.name="UnsupportedC";this.source=source;} }

export function instrumentLLVM(ir,source,{filename="main.c",ast="",parsedNodes,macroTokens,recordLayouts}={}) {
  if(/@__cvm_emit\b/.test(ir))throw new UnsupportedC("__cvm_emit 이름은 계측용으로 예약돼 있습니다.");
  const hash=createHash("sha256").update(source).digest("hex"),meta=metadata(ir),abi=layouts(ir);
  const semantics=semanticModel(ast,ir,meta,source,filename,{parsedNodes,macroTokens,recordLayouts,abi});
  const plan={schemaVersion:2,programId:hash,source:{file:filename,sha256:hash},
    backend:{compiler:"bundled Clang 8.0.1",target:"wasm32-unknown-wasi",pointerBits:32,byteOrder:"little",method:"automatic LLVM observation"},
    instructions:[],functions:[],globals:[],types:meta.types,llvmTypes:{},coverage:{
      memory:"user translation-unit scalar/aggregate loads and stores; library effects through explicit adapters",
      lifetime:"observed Clang lifetime and stack restore intrinsics for automatic objects; remaining unmarked storage falls back to function return",
      calculations:"compiled operations; source expressions may be lowered or constant-folded by Clang",
      unsupported:["atomic/volatile accesses","inline assembly","vector and extended floating-point values"],
      libraryInternals:"unobserved",pointerProvenance:"best effort from observed pointer operations; not a complete C provenance model"}};
  const allLines=ir.split("\n"),lines=[];
  // LLVM switch tables span lines. Keep them as a single grammar unit.
  for(let i=0;i<allLines.length;i++){let line=allLines[i];if(/^\s*switch\b/.test(line)&&!line.includes("]")){while(i+1<allLines.length&&!line.includes("]"))line+="\n"+allLines[++i];}lines.push(line);}
  const functions=[];
  for(let i=0;i<lines.length;i++)if(lines[i].startsWith("define ")){
    const m=new RegExp(`@(${symbol})\\(`).exec(lines[i]);if(!m)throw new UnsupportedC("LLVM 함수 정의를 해석하지 못했습니다.");
    const fn={id:`fn${functions.length+1}`,name:m[1].replace(/^"|"$/g,""),symbol:`@${m[1]}`,start:i,locals:new Map(),allocations:new Map(),pointerAliases:new Map(),lifetimeRoots:new Set()};
    const open=m.index+m[0].length;let end=open,level=1;for(;end<lines[i].length;end++){if(lines[i][end]==="(")level++;if(lines[i][end]===")"&&!--level)break;}
    fn.parameters=splitTop(lines[i].slice(open,end)).filter(p=>p&&p!=="...").map((p,index)=>({...operand(p),index,byval:/\bbyval\b/.test(p),sret:/\bsret\b/.test(p)}));
    const header=lines[i].slice(0,m.index).trim();let returnType;
    for(const start of [0,...[...header.matchAll(/\s+/g)].map(m=>m.index+m[0].length)]){
      try{const p=typed(header.slice(start));if(!p.value){returnType=p.type;break;}}catch{}
    }
    if(!returnType)throw new UnsupportedC("LLVM 함수 반환형을 해석하지 못했습니다.");
    fn.pointerType=`${returnType} (${[...fn.parameters.map(p=>p.type),...(splitTop(lines[i].slice(open,end)).includes('...')?['...']:[])].join(', ')})*`;
    while(++i<lines.length&&lines[i]!=="}") {
      const d=/@llvm\.dbg\.declare\(metadata (.*?), metadata !(\d+),/.exec(lines[i]);
      if(d){const p=operand(d[1]),argument=Number(meta.field(d[2],"arg")??0);fn.locals.set(p.value,{name:meta.clean(meta.field(d[2],"name")),debugTypeId:`debug:${meta.clean(meta.field(d[2],"type"))}`,scopeId:meta.clean(meta.field(d[2],"scope")),source:meta.location(d[2]),sourceParameterIndex:argument?argument-1:null,
        compilerGenerated:/\bDIFlagArtificial\b/.test(meta.nodes.get(d[2])??'')});}
      const cast=/^\s*(%[-\w.$]+) = bitcast .*? (%[-\w.$]+) to /.exec(lines[i]);
      if(cast)fn.pointerAliases.set(cast[1],fn.pointerAliases.get(cast[2])??cast[2]);
      const lifetime=/@llvm\.lifetime\.start[^\s(]*\(i64 [^,]+, i8\* (%[-\w.$]+)/.exec(lines[i]);
      if(lifetime)fn.lifetimeRoots.add(fn.pointerAliases.get(lifetime[1])??lifetime[1]);
    }
    fn.end=i;functions.push(fn);plan.functions.push({id:fn.id,name:fn.name,symbol:fn.symbol});
  }
  if(!functions.some(f=>f.name==="main"))throw new UnsupportedC("main 함수 정의가 필요합니다.");
  const add=(kind,fields={})=>{const op={id:`m${plan.instructions.length+1}`,index:plan.instructions.length+1,kind,...fields};plan.instructions.push(op);return op;};
  for(const line of lines) {
    const m=new RegExp(`^(@${symbol}) = (.*?)(?:global|constant) (.*)`).exec(line);
    if(!m)continue;
    const p=typed(m[3]),layout=abi.layout(p.type),d=/!dbg !(\d+)/.exec(line),expression=d&&meta.nodes.get(d[1]);
    const id=expression&&/var: !(\d+)/.exec(expression)?.[1];
    plan.globals.push({symbol:m[1],name:id?meta.clean(meta.field(id,"name")):m[1].slice(1),type:p.type,size:layout.size,
      debugTypeId:id?`debug:${meta.clean(meta.field(id,"type"))}`:null,
      cType:id?semantics.types.debug(`debug:${meta.clean(meta.field(id,"type"))}`):null,
      external:/\bexternal\b/.test(m[2]),constant:/\bconstant\b/.test(line),source:id?meta.location(id):null});
  }
  const out=[],reserved=`cvm_${hash.slice(0,8)}_`;let serial=0;
  const temp=()=>`%${reserved}${++serial}`;
  function pack(type,value,code) {
    if(type==="void"||!value)return "0";
    if(type.endsWith("*")){const r=temp();code.push(`  ${r} = ptrtoint ${type} ${value} to i64`);return r;}
    if(/^i\d+$/.test(type)){const bits=Number(type.slice(1));if(bits>64)throw new UnsupportedC(`64비트 초과 정수는 아직 지원하지 않습니다: ${type}`);if(bits===64)return value;const r=temp();code.push(`  ${r} = zext ${type} ${value} to i64`);return r;}
    if(type==="float"||type==="double"){const bits=type==="float"?32:64,r=temp();code.push(`  ${r} = bitcast ${type} ${value} to i${bits}`);return pack(`i${bits}`,r,code);}
    // Aggregate values are observed through memory, not invented as scalar values.
    if(type.startsWith("%")||type.startsWith("[")||type.startsWith("{"))return "0";
    throw new UnsupportedC(`지원하지 않는 계산 자료형: ${type}`);
  }
  function emit(op,phase,{pointer,size=0,x="0",y="0"}={},code=[]) {
    let address="0";
    if(pointer){address=temp();code.push(`  ${address} = ptrtoint ${pointer.type} ${pointer.value} to i32`);}
    code.push(`  call void @__cvm_emit(i32 ${op.index}, i32 ${phase}, i32 ${address}, i32 ${size}, i64 ${x}, i64 ${y})`);
    return code;
  }
  const definitions=new Map(functions.map(f=>[f.start,f]));let fn=null,block="entry",entry=false;
  const prologue=[];let phi=[];
  function flushPhi(){if(phi.length){for(const item of phi)out.push(...item);phi=[];}}
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    if(definitions.has(i)) {fn=definitions.get(i);block="entry";entry=true;out.push(line);continue;}
    if(!fn){out.push(line);continue;}
    if(line==="}"){flushPhi();out.push(line);fn=null;continue;}
    const label=/^([-\w.$]+):/.exec(line);
    if(label){flushPhi();block=label[1];out.push(line);continue;}
    const trimmed=line.trim();if(!trimmed||trimmed.startsWith(";")){out.push(line);continue;}
    if(entry) {
      if(fn.name==="main") {
        // Read compiler-resolved table indices before observing global pointer
        // initializers. These bookkeeping markers emit no source executions.
        for(const target of functions){const code=[],op=add("FLOW",{action:"function.address",functionId:target.id,functionName:target.name});
          emit(op,1,{x:pack(target.pointerType,target.symbol,code)},code);out.push(...code);}
        for(const global of plan.globals){const op=add("SPACE",{action:"global.begin",global});out.push(...emit(op,1,{pointer:{type:`${global.type}*`,value:global.symbol},size:global.size}));}
        out.push(...emit(add("SPACE",{action:"globals.ready"}),1));
      }
      const enter=add("FLOW",{action:"function.enter",functionId:fn.id,functionName:fn.name});
      out.push(...emit(enter,1));entry=false;
      for(const parameter of fn.parameters){let local=fn.locals.get(parameter.value);
        if(!local)for(const candidate of lines.slice(fn.start+1,fn.end)){
          const store=/^\s*store (.*)/.exec(candidate);if(!store||/\b(?:volatile|atomic)\b/.test(store[1]))continue;const fields=splitTop(store[1]);
          if(operand(fields[0]).value===parameter.value){const target=fn.locals.get(operand(fields[1]).value);if(target?.sourceParameterIndex!==null&&target?.sourceParameterIndex!==undefined){local=target;break;}}
        }
        const op=add("WRITE",{action:"function.argument",functionId:fn.id,parameter,local,cType:semantics.types.debug(local?.debugTypeId)}),code=[];
        emit(op,1,{x:pack(parameter.type,parameter.value,code)},code);out.push(...code);}
    }
    const m=/^(%[-\w.$]+) = (.*)$/.exec(trimmed),result=m?.[1],body=m?.[2]??trimmed;
    const opcode=/^(?:(?:tail|musttail|notail) )?(\w+)/.exec(body)?.[1];
    if(/\b(?:volatile|atomic|asm)\b/.test(body)||["atomicrmw","cmpxchg","fence","invoke","landingpad","indirectbr","callbr"].includes(opcode))
      throw new UnsupportedC(`기본 모델의 미지원 연산입니다: ${opcode}`,meta.location(/!dbg !(\d+)/.exec(line)?.[1]));
    const dbg=/!dbg !(\d+)/.exec(line),where=meta.location(dbg?.[1]);
    const common={functionId:fn.id,block,result,opcode,source:where?{...where,file:where.file==="/main.c"?filename:where.file}:null,
      sceneId:`${fn.id}:${where?.file??"generated"}:${where?.line??0}:${where?.column??0}`,backendInstruction:trimmed};
    const op=(kind,fields={})=>add(kind,{...common,...fields});
    const clean=body.replace(/, ![\s\S]*$/,"");
    const pre=[],post=[];let operation;
    if(opcode!=="phi")flushPhi();
    if(opcode==="alloca") {
      const parts=splitTop(clean.slice(7)),p=typed(parts[0]),layout=abi.layout(p.type),count=parts[1]&&!parts[1].startsWith("align")?operand(parts[1]):{type:"i32",value:"1"};
      operation=op("SPACE",{action:"object.begin",type:p.type,size:layout.size,local:fn.locals.get(result),count});
      operation.lifetimeManaged=fn.lifetimeRoots.has(result);
      fn.allocations.set(result,operation);
      operation.cType=semantics.types.debug(operation.local?.debugTypeId);
      const end=temp(),bytes=temp();post.push(`  ${end} = getelementptr ${p.type}, ${p.type}* null, ${count.type} ${count.value}`,`  ${bytes} = ptrtoint ${p.type}* ${end} to i64`);
      emit(operation,1,{pointer:{type:`${p.type}*`,value:result},x:bytes},post);
    } else if(opcode==="load"||opcode==="store") {
      const parts=splitTop(clean.slice(opcode.length).trim()),p=operand(parts[0]),pointer=operand(parts[1]),layout=abi.layout(p.type);
      operation=op(opcode==="load"?"READ":"WRITE",{action:opcode,type:p.type,pointer,inputs:opcode==="store"?[p]:[],size:layout.size});
      operation.cType=semantics.types.debug(fn.locals.get(pointer.value)?.debugTypeId)??plan.globals.find(g=>g.symbol===pointer.value)?.cType??null;
      emit(operation,0,{pointer,size:layout.size},pre);
      emit(operation,1,{pointer,size:layout.size},post);
    } else if(opcode==="call") {
      // Debug declarations occur at the source declaration, whereas fixed-size
      // allocas are commonly hoisted to function entry. Observe both boundaries;
      // the public IR uses the former to introduce a programmer-visible box.
      const declaration=/@llvm\.dbg\.declare\(metadata (.*?), metadata !(\d+),/.exec(line);
      if(declaration){
        const pointer=operand(declaration[1]),allocation=fn.allocations.get(pointer.value),local=fn.locals.get(pointer.value);
        if(allocation&&local?.sourceParameterIndex===null&&!local.compilerGenerated){
          const marker=op("SPACE",{action:"source.declaration",result:undefined,pointer,local,type:allocation.type,
            cType:allocation.cType,allocationObservationId:allocation.id});
          allocation.declarationObservationId=marker.id;
          out.push(...emit(marker,1,{pointer}),line);continue;
        }
      }
      const call=parseCall(clean);
      if(call.callee.startsWith("@llvm.dbg.")){out.push(line);continue;}
      if(/^@llvm\.(stacksave|stackrestore)(?:\.|$)/.test(call.callee)){
        const save=call.callee.startsWith('@llvm.stacksave'),pointer=save?{type:call.returnType,value:result}:call.args[0];
        operation=op('SPACE',{action:save?'stack.save':'stack.restore',pointer,inputs:save?[]:[pointer]});
        emit(operation,1,{x:pack(pointer.type,pointer.value,save?post:pre)},save?post:pre);
        out.push(...pre,line,...post);continue;
      }
      const lifetime=/^@llvm\.lifetime\.(start|end)\./.exec(call.callee);
      if(lifetime){
        const pointer=call.args[1],root=fn.pointerAliases.get(pointer.value)??pointer.value,allocation=fn.allocations.get(root);
        if(!allocation)throw new UnsupportedC("수명 표식의 할당 대상을 연결하지 못했습니다.",common.source);
        operation=op("SPACE",{action:`lifetime.${lifetime[1]}`,result:lifetime[1]==='start'?allocation.result:undefined,pointer,
          allocationObservationId:allocation.id,local:allocation.local,type:allocation.type,cType:allocation.cType});
        emit(operation,1,{pointer},pre);
        out.push(...pre,line);continue;
      }
      operation=op("FLOW",{action:"call",...call,type:call.returnType,inputs:call.args});
      for(const [index,arg] of call.args.entries())emit(operation,10+index,{x:pack(arg.type,arg.value,pre)},pre);
      const calleeName=call.callee.slice(1).replace(/^"|"$/g,"");operation.external=call.callee[0]==="@"&&!functions.some(f=>f.name===calleeName);
      emit(operation,0,{x:call.callee.startsWith("%")?pack(`${call.returnType} (${call.args.map(a=>a.type).join(", ")})*`,call.callee,pre):"0"},pre);
      if(call.returnType!=="void"&&result)emit(operation,1,{x:pack(call.returnType,result,post)},post);else emit(operation,1,{},post);
    } else if(opcode==="ret") {
      const p=operand(clean.slice(4));operation=op("FLOW",{action:"function.return",type:p.type,inputs:p.type==="void"?[]:[p]});
      emit(operation,1,{x:pack(p.type,p.value,pre)},pre);
    } else if(opcode==="br") {
      const parts=splitTop(clean.slice(3));const conditional=parts.length===3,p=conditional?operand(parts[0]):null;
      operation=op("FLOW",{action:"branch",inputs:p?[p]:[],destinations:parts.slice(conditional?1:0).map(x=>x.replace(/^label %/,""))});
      emit(operation,1,{x:p?pack(p.type,p.value,pre):"0"},pre);
    } else if(opcode==="switch") {
      const p=operand(clean.slice(7)),first=p.value.indexOf(","),value=p.value.slice(0,first),rest=p.value.slice(first+1);
      operation=op("FLOW",{action:"switch",inputs:[{type:p.type,value}],destinations:[...rest.matchAll(/label %([-\w.$]+)/g)].map(m=>m[1]),
        cases:[...rest.matchAll(/i\d+ (-?\d+), label %([-\w.$]+)/g)].map(m=>({value:m[1],destination:m[2]}))});
      emit(operation,1,{x:pack(p.type,value,pre)},pre);
    } else if(opcode==="unreachable") {operation=op("FLOW",{action:"unreachable"});emit(operation,1,{},pre);}
    else if(opcode==="getelementptr") {
      const parts=splitTop(clean.replace(/^getelementptr (?:inbounds )?/,"")),type=parts[0],pointer=operand(parts[1]);
      operation=op("CALC",{action:"address",type:`${type}*`,baseType:type,pointer,inputs:[pointer,...parts.slice(2).map(operand)]});
      // The result pointer type depends on record/array indices, so cast via a zero-length GEP-free ptrtoint expression below.
      let current=type;
      for(const index of parts.slice(3).map(operand)){const l=abi.layout(current);current=l.kind==="record"?l.fields[Number(index.value)]?.type:l.kind==="array"?l.elementType:current;if(!current)throw new UnsupportedC("구조체 필드 인덱스를 해석하지 못했습니다.");}
      operation.type=`${current}*`;emit(operation,1,{x:pack(operation.type,result,post)},post);
    } else if(["add","sub","mul","udiv","sdiv","urem","srem","shl","lshr","ashr","and","or","xor","fadd","fsub","fmul","fdiv","frem","icmp","fcmp"].includes(opcode)) {
      let rest=clean.slice(opcode.length).trim(),predicate;
      if(opcode==="icmp"||opcode==="fcmp"){const point=rest.indexOf(" ");predicate=rest.slice(0,point);rest=rest.slice(point+1);}
      rest=rest.replace(/^(?:(?:nsw|nuw|exact|fast|nnan|ninf|nsz|arcp|contract|afn|reassoc) )*/,"");
      const p=typed(rest),values=splitTop(p.value),inputs=values.map(value=>({type:p.type,value}));
      operation=op("CALC",{action:"calculate",type:predicate?"i1":p.type,inputType:p.type,predicate,flags:{nsw:/\bnsw\b/.test(clean),nuw:/\bnuw\b/.test(clean)},inputs});
      if(!p.type.startsWith("<"))emit(operation,0,{x:pack(p.type,values[0],pre),y:pack(p.type,values[1],pre)},pre);
      emit(operation,1,{x:pack(operation.type,result,post)},post);
    } else if(["trunc","zext","sext","fptrunc","fpext","fptoui","fptosi","uitofp","sitofp","ptrtoint","inttoptr","bitcast","addrspacecast"].includes(opcode)) {
      const p=typed(clean.slice(opcode.length)),at=p.value.lastIndexOf(" to "),input={type:p.type,value:p.value.slice(0,at)},type=p.value.slice(at+4);
      operation=op("CALC",{action:"convert",type,inputs:[input]});emit(operation,1,{x:pack(type,result,post)},post);
    } else if(opcode==="phi") {
      const p=typed(clean.slice(4)),incoming=[...p.value.matchAll(/\[\s*(.*?), %([-\w.$]+)\s*\]/g)].map(m=>({value:m[1],block:m[2],type:p.type}));
      operation=op("CALC",{action:"merge",type:p.type,incoming,inputs:incoming});emit(operation,1,{x:pack(p.type,result,post)},post);
    } else if(opcode==="select") {
      const inputs=splitTop(clean.slice(7)).map(operand);operation=op("CALC",{action:"select",type:inputs[1].type,inputs});
      emit(operation,0,{x:pack(inputs[0].type,inputs[0].value,pre)},pre);emit(operation,1,{x:pack(operation.type,result,post)},post);
    } else if(opcode==="extractvalue"||opcode==="insertvalue") {
      // Usually aggregate ABI plumbing. Preserve it and explicitly mark the value unobserved.
      operation=op("CALC",{action:"aggregate",valueEvidence:"unobserved"});emit(operation,1,{},post);
    } else throw new UnsupportedC(`기본 모델에서 지원하지 않는 LLVM 연산입니다: ${opcode}`,common.source);
    semantics.annotate(operation,fn.name,filename);
    const sourceFlow=[];
    for(const {item,input} of semantics.shortCircuits.before(operation,fn.name)) {
      const marker=add("FLOW",{...common,opcode:"c.short-circuit",action:"short-circuit",result:undefined,
        source:item.source,anchorInstructionId:operation.id,consumerType:input.type,
        shortCircuit:semantics.shortCircuits.describe(item),backendInstruction:null,
        observation:"compiler source decision at an observed consumer; skipped operand is not evaluated"});
      emit(marker,1,{x:pack(input.type,input.value,sourceFlow)},sourceFlow);
    }
    for(const cast of semantics.after(result,fn.name)) {
      // A nested member/index access shares its start location with base reads.
      // Preserve the compiler cast identity instead of resolving that point again.
      const conversion=add("CALC",{...common,opcode:"c.integral-cast",action:"convert",type:`i${cast.toType.sizeBits}`,result,
        semanticNodeId:cast.node.id,
        source:{file:filename,line:cast.source.start.line,column:cast.source.start.column,range:cast.source},
        inputs:[{type:`i${cast.fromType.sizeBits}`,value:result}],cType:cast.toType,
        conversion:{fromType:cast.fromType,toType:cast.toType,explicit:cast.explicit,sameWidth:true,bitsUnchanged:true,evidence:"compiler AST"},
        backendInstruction:null,observation:"actual SSA value; source conversion has no LLVM instruction"});
      emit(conversion,1,{x:pack(conversion.type,result,post)},post);semantics.converted.add(cast.id);
    }
    out.push(...sourceFlow,...pre,line);
    if(opcode==="phi")phi.push(post);else out.push(...post);
  }
  for(const [name,body]of abi.definitions)plan.llvmTypes[name]={body,...abi.layout(name)};
  plan.coverage.cConversions=semantics.report();
  plan.coverage.shortCircuits=semantics.shortCircuits.report();
  plan.coverage.automaticLifetimes={source:'Clang lifetime and stack save/restore intrinsics; LLVM optimization passes disabled',
    stackRestores:plan.instructions.filter(o=>o.action==='stack.restore').length,
    managedAllocations:plan.instructions.filter(o=>o.action==='object.begin'&&o.lifetimeManaged).length,
    unmarkedLocals:plan.instructions.filter(o=>o.action==='object.begin'&&o.local?.sourceParameterIndex===null&&!o.local.compilerGenerated&&!o.lifetimeManaged)
      .map(o=>({observationId:o.id,name:o.local.name,source:o.local.source,reason:'no individual lifetime marker; observed stack restoration or function-return fallback'}))};
  const declaration='declare void @__cvm_emit(i32, i32, i32, i32, i64, i64) "wasm-import-module"="cvtrace" "wasm-import-name"="emit"';
  const publicPlan=buildIRPlan(plan,semantics,source,filename,abi);
  return {plan:publicPlan,observationPlan:plan,llvm:out.join("\n")+"\n"+declaration+"\n",abi};
}
