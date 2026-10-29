// Source-language facts come from Clang, never from identifier meanings.
import {operand,parseCall} from "./llvm.mjs";
import {foldedShortCircuits} from "./short-circuit.mjs";

export function cTypes(meta) {
  const byId=new Map(meta.types.map(t=>[t.id,t]));
  const describe=t=>t?{id:t.id,name:t.name??t.display?.label,sizeBits:t.sizeBits,signedness:t.signedness,
    encoding:t.encoding,display:t.display,evidence:"compiler"}:null;
  function spelling(name,canonical=name) {
    const normalize=s=>s.replace(/\b(?:const|volatile|restrict)\b/g,"").replace(/\s+/g," ").trim();
    name=normalize(name??"");canonical=normalize(canonical??name);
    const found=meta.types.find(t=>t.name===name&&t.signedness);if(found)return describe(found);
    const base=meta.types.find(t=>t.name===canonical&&t.signedness);if(base)return {...describe(base),name};
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
  return {byId,describe,spelling,debug:id=>describe(byId.get(id))};
}

export function astNodes(dump) {
  const nodes=[],stack=[];let current={file:null,line:1,column:1};
  for(const line of dump.split("\n")) {
    const m=/^([ |`-]*)([A-Za-z]\w*)\s+(0x[0-9a-f]+)\b(.*)$/.exec(line);if(!m)continue;
    const depth=m[1].length/2;if(!Number.isInteger(depth))continue;
    const details=m[4],header=details.split("'")[0],range=/<([^<>]+)>/.exec(header),points=[];
    for(const loc of header.matchAll(/(\/[^<>,]*?):(\d+):(\d+)|line:(\d+):(\d+)|col:(\d+)/g)) {
      current=loc[1]?{file:loc[1].trim(),line:Number(loc[2]),column:Number(loc[3])}:
        {file:current.file,line:loc[4]?Number(loc[4]):current.line,column:Number(loc[5]??loc[6])};
      if(range&&loc.index>=range.index&&loc.index<range.index+range[0].length)points.push({...current});
    }
    const parent=stack[depth-1],quotes=[...details.matchAll(/'([^']*)'/g)].map(q=>q[1]);
    const node={id:`ast${nodes.length+1}`,astId:m[3],kind:m[2],details,depth,parent,children:[],type:quotes[0],canonical:details.includes("':'")?quotes[1]:quotes[0],
      functionName:parent?.functionName,declarationPoint:{...current},source:points.length&&points.every(p=>p.file===points[0].file)?{file:points[0].file,start:points[0],end:points.at(-1)}:null};
    if(node.kind==="FunctionDecl")node.functionName=/\s([^\s']+)\s+'/.exec(details)?.[1];
    if(parent)parent.children.push(node);nodes.push(node);stack[depth]=node;stack.length=depth+1;
  }
  return nodes;
}

const inside=(where,range)=>where&&range&&where.file===range.file&&
  (where.line>range.start.line||where.line===range.start.line&&where.column>=range.start.column)&&
  (where.line<range.end.line||where.line===range.end.line&&where.column<=range.end.column);
const span=n=>(n.source.end.line-n.source.start.line)*100000+n.source.end.column-n.source.start.column;
const scalarLLVM=body=>{try{return operand(body.replace(/^\w+\s+(?:(?:nsw|nuw|exact|inbounds) )*/,"")).type;}catch{return null;}};
const binaryCodes={"+":["add","fadd"],"-":["sub","fsub"],"*":["mul","fmul"],"/":["sdiv","udiv","fdiv"],"%":["srem","urem","frem"],
  "<":["icmp","fcmp"],">":["icmp","fcmp"],"<=":["icmp","fcmp"],">=":["icmp","fcmp"],"==":["icmp","fcmp"],"!=":["icmp","fcmp"],"&":["and"],"|":["or"],"^":["xor"],"<<":["shl"],">>":["ashr","lshr"]};
const integral=n=>["ImplicitCastExpr","CStyleCastExpr"].includes(n.kind)&&n.details.includes("<IntegralCast>");
function producer(n,types) {
  while(n?.kind==="ParenExpr"||integral(n)&&(()=>{const a=types.spelling(n.children[0]?.type,n.children[0]?.canonical),b=types.spelling(n.type,n.canonical);return a&&b&&a.sizeBits===b.sizeBits;})())n=n.children[0];
  return n;
}
function matches(node,site) {
  if(!node||!inside(site.source,node.source))return false;
  if(node.kind==="ImplicitCastExpr"&&node.details.includes("<LValueToRValue>"))return site.opcode==="load";
  if(node.kind==="CallExpr")return site.opcode==="call";
  if(integral(node))return ["zext","sext","trunc"].includes(site.opcode);
  if(node.kind==="BinaryOperator") {
    const operator=/ '([^']+)'\s*$/.exec(node.details)?.[1];
    if(!(binaryCodes[operator]??[]).includes(site.opcode)&&!(site.opcode==="zext"&&site.inputType==="i1"&&["<",">","<=",">=","==","!="].includes(operator)))return false;
    // A parent arithmetic expression also contains all its children. Its operator
    // location must not select the computation of one of those children.
    return !node.children.some(c=>inside(site.source,c.source));
  }
  if(node.kind==="UnaryOperator")return /prefix '-'/.test(node.details)&&site.opcode==="sub"||/prefix '~'/.test(node.details)&&site.opcode==="xor";
  return false;
}

export function semanticModel(ast,ir,meta,source="",filename="main.c") {
  const types=cTypes(meta),parsedNodes=astNodes(ast),nodes=parsedNodes.filter(n=>n.source?.file==="/main.c"&&n.functionName),sites=[];
  const shortCircuits=foldedShortCircuits(nodes,source,filename,types);
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
  const noOps=conversions.filter(c=>c.sameWidth&&c.fromType.signedness!==c.toType.signedness);
  for(const cast of noOps) {
    const root=producer(cast.node.children[0],types);
    const candidates=sites.filter(s=>s.functionName===cast.node.functionName&&matches(root,s)&&s.type===`i${cast.fromType.sizeBits}`);
    cast.site=candidates.length===1?candidates[0]:null;
    cast.reason=candidates.length>1?"ambiguous backend position":"no distinct runtime producer (possibly folded)";
  }
  const converted=new Set();
  function annotate(operation,functionName,filename) {
    const site={...operation,functionName,inputType:operation.inputs?.[0]?.type,source:operation.source&&{...operation.source,file:operation.source.file===filename?"/main.c":operation.source.file}};
    const candidates=nodes.filter(n=>n.functionName===functionName&&matches(n,site));
    candidates.sort((a,b)=>span(a)-span(b)||b.depth-a.depth);
    const node=candidates[0];if(node)operation.cType=types.spelling(node.type,node.canonical)??operation.cType;
    if(node?.kind==="CallExpr"&&operation.args)for(const [index,arg]of operation.args.entries()){
      const expression=node.children[index+1];arg.cType=expression?types.spelling(expression.type,expression.canonical):null;
    }
    if(node&&integral(node)&&operation.action==="convert"){
      const c=conversions.find(c=>c.node===node);if(c){operation.conversion={fromType:c.fromType,toType:c.toType,explicit:c.explicit,sameWidth:c.sameWidth,bitsUnchanged:false,evidence:"compiler AST"};converted.add(c.id);}
    }
    if(operation.action==="calculate"&&operation.predicate)operation.cBoolean=true;
  }
  return {types,nodes:parsedNodes,annotate,noOps,conversions,converted,shortCircuits,
    after(result,functionName){return result?noOps.filter(c=>c.site&&c.site.result===result&&c.site.functionName===functionName).sort((a,b)=>b.node.depth-a.node.depth):[];},
    report(){return {source:"Clang AST + DWARF encoding",sameWidthSignednessCasts:noOps.length,
      inserted:noOps.filter(c=>converted.has(c.id)).length,
      unobserved:noOps.filter(c=>!converted.has(c.id)).map(c=>({source:c.source,fromType:c.fromType,toType:c.toType,reason:c.reason}))};}};
}
