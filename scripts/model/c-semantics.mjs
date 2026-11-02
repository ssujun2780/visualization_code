// Source-language facts come from Clang, never from identifier meanings.
import {operand,parseCall} from "./llvm.mjs";
import {foldedShortCircuits} from "./short-circuit.mjs";
import {createSourceMap} from './source-map.mjs';
import {astNodes} from './ast.mjs';
export {astNodes} from './ast.mjs';

export function cTypes(meta) {
  const byId=new Map(meta.types.map(t=>[t.id,t]));
  const descriptions=new Map(),spellings=new Map();
  const qualified=(base,qualifiers,fields={})=>{
    const name=base?.kind==='pointer'?`${base.name} ${qualifiers.join(' ')}`:`${qualifiers.join(' ')} ${base?.name??'?'}`;
    return {...base,name,qualifiers:[...new Set([...(base?.qualifiers??[]),...qualifiers])],
      display:{label:name,badges:base?.display?.badges??[]},...fields};
  };
  const pointer=(pointee,fields={})=>({id:`c:pointer:${pointee?.id??'void'}`,kind:'pointer',name:`${pointee?.name??'void'} *`,
    sizeBits:32,signedness:null,encoding:null,qualifiers:[],pointee,
    display:{label:`${pointee?.name??'void'} *`,badges:[]},evidence:'compiler AST and target ABI',...fields});
  const array=(elementType,count,fields={})=>({
    id:`c:array:${count??'?'}:${elementType?.id??'?'}`,kind:'array',
    name:elementType?.name==null?null:elementType.name.replace(/(?=\[)|$/,`[${count??''}]`),
    sizeBits:count!=null&&elementType?.sizeBits!=null?count*elementType.sizeBits:null,
    signedness:null,encoding:null,count,dimensions:[count,...(elementType?.dimensions??[])],elementType,
    display:{label:elementType?.display?.label==null?null:elementType.display.label.replace(/(?=\[)|$/,`[${count??''}]`),badges:elementType?.display?.badges??[]},
    evidence:'compiler',...fields});
  function describe(t){
    if(!t)return null;if(descriptions.has(t.id))return descriptions.get(t.id);
    const result={id:t.id,name:t.name??t.display?.label,sizeBits:t.sizeBits,signedness:t.signedness,
      encoding:t.encoding,display:t.display,evidence:'compiler'};
    descriptions.set(t.id,result);
    if(t.tag==='DW_TAG_array_type'){
      let element=describe(byId.get(t.baseType));
      for(const count of [...(t.dimensions??[])].reverse())element=array(element,count);
      if(element)Object.assign(result,element,{id:t.id,sizeBits:t.sizeBits||element.sizeBits});
    }else if(t.tag==='DW_TAG_pointer_type'){
      Object.assign(result,pointer(describe(byId.get(t.baseType))),{id:t.id,sizeBits:t.sizeBits,evidence:'compiler'});
    }else if(['DW_TAG_typedef','DW_TAG_const_type','DW_TAG_volatile_type','DW_TAG_restrict_type'].includes(t.tag)){
      const base=describe(byId.get(t.baseType));
      if(base){
        if(t.tag==='DW_TAG_typedef')Object.assign(result,base,{id:t.id,name:t.name??base.name,display:{label:t.name??base.display.label,badges:base.display.badges}});
        else Object.assign(result,qualified(base,[t.tag.slice(7,-5)],{id:t.id}));
      }
    }
    return result;
  }
  function resolve(name,canonical=name) {
    const normalize=s=>s.replace(/\s+/g," ").trim();
    name=normalize(name??"");canonical=normalize(canonical??name);
    const alias=meta.types.find(t=>t.name===name&&t.tag==='DW_TAG_typedef');if(alias)return describe(alias);
    const ptr=/^(.+?)\s*\*\s*((?:(?:const|volatile|restrict)\s*)*)$/.exec(canonical);
    if(ptr&&!/[()]/.test(ptr[1])){
      const target=spelling(ptr[1].trim());if(!target&&ptr[1].trim()!=='void')return null;
      const result=pointer(target),q=ptr[2].trim().split(/\s+/).filter(Boolean);return q.length?qualified(result,q):result;
    }
    // Parse Clang's type spelling, never the original source expression.
    const shape=/^([^()[\]]+?)\s*((?:\[\d*\]\s*)+)$/.exec(canonical);
    if(shape){
      let element=spelling(shape[1].trim());if(!element)return null;
      for(const m of [...shape[2].matchAll(/\[(\d*)\]/g)].reverse())element=array(element,m[1]===''?null:Number(m[1]));
      return {...element,name:name.includes('[')?element.name:name};
    }
    const qualifiers=[...canonical.matchAll(/\b(const|volatile|restrict)\b/g)].map(m=>m[1]);
    if(qualifiers.length){const base=spelling(canonical.replace(/\b(?:const|volatile|restrict)\b/g,'').trim());return base?qualified(base,qualifiers):null;}
    const known=t=>t.signedness||t.encoding==='DW_ATE_float'||describe(t)?.kind==='array';
    const found=meta.types.find(t=>t.name===name&&known(t));if(found)return describe(found);
    const base=meta.types.find(t=>t.name===canonical&&known(t));if(base)return {...describe(base),name};
    if(['float','double'].includes(canonical))return {id:`c:${canonical}`,name:name||canonical,sizeBits:canonical==='float'?32:64,
      signedness:null,encoding:'DW_ATE_float',display:{label:name||canonical,badges:[]},evidence:'compiler AST and target ABI'};
    // These are builtin type spellings from Clang for the pinned wasm32 ABI.
    const m=/^(unsigned |signed )?(char|short(?: int)?|int|long(?: int)?|long long(?: int)?)$/.exec(canonical);
    if(!m)return null;
    const width=m[2]==="char"?8:m[2].startsWith("short")?16:m[2].startsWith("long long")?64:32;
    const signedness=m[1]==="unsigned "?"unsigned":"signed";
    if(m[2]==="char"&&!m[1])return null; // Plain char requires the compiler's encoding.
    return {id:`c:${canonical.replaceAll(" ","-")}`,name:name||canonical,sizeBits:width,signedness,
      encoding:`DW_ATE_${signedness}${m[2]==="char"?"_char":""}`,
      display:{label:(name||canonical).replace(/^unsigned\s+/,""),badges:signedness==="unsigned"?["u"]:[]},evidence:"compiler AST and target ABI"};
  }
  function spelling(name,canonical=name){
    const key=JSON.stringify([name,canonical]);
    if(!spellings.has(key))spellings.set(key,resolve(name,canonical));
    return spellings.get(key);
  }
  return {byId,describe,spelling,debug:id=>describe(byId.get(id))};
}

const inside=(where,range)=>where&&range&&where.file===range.file&&
  (where.line>range.start.line||where.line===range.start.line&&where.column>=range.start.column)&&
  (where.line<range.end.line||where.line===range.end.line&&where.column<=range.end.column);
const span=n=>(n.source.end.line-n.source.start.line)*100000+n.source.end.column-n.source.start.column;
const scalarLLVM=body=>{try{return operand(body.replace(/^\w+\s+(?:(?:nsw|nuw|exact|inbounds) )*/,"")).type;}catch{return null;}};
const binaryCodes={"+":["add","fadd"],"-":["sub","fsub"],"*":["mul","fmul"],"/":["sdiv","udiv","fdiv"],"%":["srem","urem","frem"],
  "<":["icmp","fcmp"],">":["icmp","fcmp"],"<=":["icmp","fcmp"],">=":["icmp","fcmp"],"==":["icmp","fcmp"],"!=":["icmp","fcmp"],"&":["and"],"|":["or"],"^":["xor"],"<<":["shl"],">>":["ashr","lshr"]};
export function compoundTypes(node,types){
  if(node?.kind!=="CompoundAssignOperator")return null;
  return {storageType:types.spelling(node.type,node.canonical),
    leftType:types.spelling(/ComputeLHSTy='([^']+)'/.exec(node.details)?.[1]),
    calculationType:types.spelling(/ComputeResultTy='([^']+)'/.exec(node.details)?.[1])};
}
const integral=n=>["ImplicitCastExpr","CStyleCastExpr"].includes(n.kind)&&n.details.includes("<IntegralCast>");
function producer(n,types) {
  while(n?.kind==="ParenExpr"||integral(n)&&(()=>{const a=types.spelling(n.children[0]?.type,n.children[0]?.canonical),b=types.spelling(n.type,n.canonical);return a&&b&&a.sizeBits===b.sizeBits;})())n=n.children[0];
  return n;
}
function matches(node,site,allowTargetAccess=false) {
  if(!node||!inside(site.source,node.source))return false;
  if(node.kind==="ImplicitCastExpr"&&node.details.includes("<LValueToRValue>"))return site.opcode==="load";
  if(node.kind==="CallExpr")return site.opcode==="call";
  if(integral(node))return ["zext","sext","trunc"].includes(site.opcode);
  if(node.kind==="CompoundAssignOperator"){
    const operator=/ '([^']+)' ComputeLHSTy=/.exec(node.details)?.[1]?.slice(0,-1);
    // Clang locates both target accesses at the compound operator. Exclude
    // children so index/pointer/RHS accesses keep their own types and effects.
    return (allowTargetAccess&&['load','store'].includes(site.opcode)||(binaryCodes[operator]??[]).includes(site.opcode))&&
      !node.children.some(c=>inside(site.source,c.source));
  }
  if(node.kind==="BinaryOperator") {
    const operator=/ '([^']+)'\s*$/.exec(node.details)?.[1];
    if(operator==='='&&allowTargetAccess&&site.opcode==='store')return !node.children.some(c=>inside(site.source,c.source));
    if(site.opcode==='getelementptr'&&['+','-'].includes(operator)&&/\*/.test(node.type??''))return !node.children.some(c=>inside(site.source,c.source));
    if(!(binaryCodes[operator]??[]).includes(site.opcode)&&!(site.opcode==="zext"&&site.inputType==="i1"&&["<",">","<=",">=","==","!="].includes(operator)))return false;
    // A parent arithmetic expression also contains all its children. Its operator
    // location must not select the computation of one of those children.
    return !node.children.some(c=>inside(site.source,c.source));
  }
  if(node.kind==="UnaryOperator")return /prefix '-'/.test(node.details)&&site.opcode==="sub"||/prefix '~'/.test(node.details)&&site.opcode==="xor"||
    /(?:prefix|postfix) '(?:\+\+|--)'/.test(node.details)&&['add','sub','fadd','fsub','getelementptr'].includes(site.opcode)&&
      !node.children.some(c=>inside(site.source,c.source));
  return false;
}

export function semanticModel(ast,ir,meta,source="",filename="main.c") {
  const types=cTypes(meta),parsedNodes=astNodes(ast),nodes=parsedNodes.filter(n=>n.source?.file==="/main.c"&&n.functionName),sites=[];
  const sourceMap=createSourceMap({source,filename,nodes:parsedNodes,llvm:ir,metadata:meta});
  const shortCircuits=foldedShortCircuits(nodes,sourceMap,filename,types);
  let fn;
  for(const [lineIndex,line]of ir.split("\n").entries()) {
    if(line.startsWith("define "))fn=/@([^ (]+)\(/.exec(line)?.[1];
    const m=/^\s*(%[-\w.$]+) = (?:(?:tail|notail|musttail) )?(\w+) (.*)/.exec(line),dbg=/!dbg !(\d+)/.exec(line);
    if(m&&dbg){const inputType=m[2]==="call"?parseCall(`call ${m[3]}`).returnType:scalarLLVM(`${m[2]} ${m[3]}`),castType=/\bto (i\d+)\b/.exec(m[3])?.[1];sites.push({lineIndex,result:m[1],opcode:m[2],type:castType??inputType,inputType,source:meta.location(dbg[1]),functionName:fn});}
  }
  const conversions=[];
  for(const node of nodes.filter(integral)) {
    const fromType=types.spelling(node.children[0]?.type,node.children[0]?.canonical),toType=types.spelling(node.type,node.canonical);
    if(!fromType||!toType)continue;
    conversions.push({id:`cast${conversions.length+1}`,node,fromType,toType,sameWidth:fromType.sizeBits===toType.sizeBits,
      explicit:node.kind==="CStyleCastExpr",source:node.source});
  }
  for(const node of nodes.filter(n=>n.kind==='CompoundAssignOperator')){
    const t=compoundTypes(node,types);
    for(const [kind,fromType,toType]of [['compound-lhs',t.storageType,t.leftType],['compound-result',t.calculationType,t.storageType]]){
      if(!fromType?.signedness||!toType?.signedness||fromType.sizeBits!==toType.sizeBits||fromType.signedness===toType.signedness)continue;
      const candidates=sites.filter(s=>s.functionName===node.functionName&&s.type===`i${fromType.sizeBits}`&&
        (kind==='compound-result'?matches(node,s):s.opcode==='load'&&inside(s.source,node.source)&&!node.children.some(c=>inside(s.source,c.source))));
      conversions.push({id:`cast${conversions.length+1}`,node,kind,fromType,toType,sameWidth:true,explicit:false,source:node.source,
        site:candidates.length===1?candidates[0]:null,reason:candidates.length>1?'ambiguous compound assignment producer':'no distinct compound assignment producer'});
    }
  }
  const noOps=conversions.filter(c=>c.sameWidth&&c.fromType.signedness!==c.toType.signedness);
  for(const cast of noOps) {
    if(cast.kind)continue;
    const root=producer(cast.node.children[0],types);
    const candidates=sites.filter(s=>s.functionName===cast.node.functionName&&matches(root,s)&&s.type===`i${cast.fromType.sizeBits}`);
    cast.site=candidates.length===1?candidates[0]:null;
    cast.reason=candidates.length>1?"ambiguous backend position":"no distinct runtime producer (possibly folded)";
  }
  const converted=new Set();
  function annotate(operation,functionName,filename) {
    const site={...operation,functionName,inputType:operation.inputs?.[0]?.type,source:operation.source&&{...operation.source,file:operation.source.file===filename?"/main.c":operation.source.file}};
    const candidates=sourceMap.candidates(site.source,functionName).filter(n=>matches(n,site,true));
    candidates.sort((a,b)=>span(a)-span(b)||b.depth-a.depth);
    const node=candidates[0];
    if(node){
      operation.semanticNodeId=node.id;
      const access=['load','store'].includes(operation.opcode);
      const type=node.kind==='CompoundAssignOperator'?(access?
        types.spelling(node.children[0]?.type,node.children[0]?.canonical):compoundTypes(node,types).calculationType):types.spelling(node.type,node.canonical);
      // An access uses the stored type, not the promoted computation type.
      // Do not label a wider container load (e.g. a bit-field) as the target.
      const compatible=!access||!type||operation.type===(type.encoding==='DW_ATE_float'?(type.sizeBits===32?'float':type.sizeBits===64?'double':null):`i${type.sizeBits}`);
      if(compatible)operation.cType=type??operation.cType;
    }
    if(node?.kind==='UnaryOperator'&&/(?:prefix|postfix) '(?:\+\+|--)'/.test(node.details)&&
      operation.type==='i32'&&operation.cType?.sizeBits<32)operation.cType=types.spelling('int');
    // Compound assignment has implicit LHS promotion and storage conversion,
    // which Clang lists as Compute*Ty rather than separate AST cast children.
    if(!node&&operation.action==="convert"){
      const update=sourceMap.candidates(site.source,functionName).filter(n=>n.kind==="CompoundAssignOperator"&&inside(site.source,n.source)&&
        !n.children.some(c=>inside(site.source,c.source))).sort((a,b)=>span(a)-span(b))[0];
      const t=compoundTypes(update,types);
      const llvmType=t=>t.encoding==='DW_ATE_float'?t.name:`i${t.sizeBits}`;
      const pair=t&&[[t.storageType,t.leftType],[t.calculationType,t.storageType]].find(([from,to])=>
        from&&to&&from.name!==to.name&&operation.inputs?.[0]?.type===llvmType(from)&&operation.type===llvmType(to));
      if(pair){operation.cType=pair[1];operation.conversion={fromType:pair[0],toType:pair[1],explicit:false,sameWidth:pair[0].sizeBits===pair[1].sizeBits,bitsUnchanged:false,evidence:"compiler AST compound assignment"};}
    }
    if(node?.kind==="CallExpr"&&operation.args)for(const [index,arg]of operation.args.entries()){
      const expression=node.children[index+1];arg.cType=expression?types.spelling(expression.type,expression.canonical):null;
    }
    if(node&&integral(node)&&operation.action==="convert"){
      const c=conversions.find(c=>c.node===node);if(c){operation.conversion={fromType:c.fromType,toType:c.toType,explicit:c.explicit,sameWidth:c.sameWidth,bitsUnchanged:false,evidence:"compiler AST"};converted.add(c.id);}
    }
    if(operation.action==="calculate"&&operation.predicate)operation.cBoolean=true;
  }
  return {types,nodes:parsedNodes,sourceMap,annotate,noOps,conversions,converted,shortCircuits,
    after(result,functionName){return result?noOps.filter(c=>c.site&&c.site.result===result&&c.site.functionName===functionName).sort((a,b)=>b.node.depth-a.node.depth):[];},
    report(){return {source:"Clang AST + DWARF encoding",sameWidthSignednessCasts:noOps.length,
      inserted:noOps.filter(c=>converted.has(c.id)).length,
      unobserved:noOps.filter(c=>!converted.has(c.id)).map(c=>({source:c.source,fromType:c.fromType,toType:c.toType,reason:c.reason}))};}};
}
