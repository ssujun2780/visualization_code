// Source-language facts come from Clang, never from identifier meanings.
import {operand,parseCall,llvmLocal,llvmFunction,llvmName} from "./llvm.mjs";
import {foldedShortCircuits} from "./short-circuit.mjs";
import {createSourceMap} from './source-map.mjs';
import {astNodes} from './ast.mjs';
import {applyMacroLocations} from './macro-locations.mjs';
import {macroExpressionBindings} from './macro-expression-bindings.mjs';
import {annotateAlignments} from './type-queries.mjs';
import {readAccessBindings} from './read-access.mjs';
import {callBindings} from './call-bindings.mjs';
export {astNodes} from './ast.mjs';

export function cTypes(meta,nodes=[]) {
  const byId=new Map(meta.types.map(t=>[t.id,t]));
  const descriptions=new Map(),spellings=new Map();
  const voidType={id:'c:void',kind:'void',name:'void',sizeBits:0,signedness:null,encoding:null,
    qualifiers:[],display:{label:'void',badges:[]},evidence:'compiler C void type'};
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
    if(['DW_TAG_structure_type','DW_TAG_union_type'].includes(t.tag)){
      // Keep member types as IDs: embedding recursive record/pointer types
      // here would make the serializable type graph cyclic.
      Object.assign(result,{kind:'record',recordTypeId:t.id,recordKind:t.tag==='DW_TAG_union_type'?'union':'struct',
        members:t.elements.map(id=>byId.get(id)).filter(m=>m?.tag==='DW_TAG_member').map(m=>({
          name:m.name??null,typeId:m.baseType,offsetBits:m.offsetBits,sizeBits:m.sizeBits,
          ...(m.bitField?{bitField:true,storageOffsetBits:m.storageOffsetBits}:{})}))});
      if(!t.sizeBits&&!nodes.some(n=>n.kind==='RecordDecl'&&/\bdefinition\b/.test(n.details)&&
        /\b(?:struct|union) (\S+)/.exec(n.details)?.[1]===t.name))Object.assign(result,{incomplete:true,sizeBits:null});
    }else if(t.tag==='DW_TAG_enumeration_type'){
      Object.assign(result,{kind:'enum',enumTypeId:t.id,underlyingType:describe(byId.get(t.baseType)),enumerators:t.enumerators??[]});
    }else if(t.tag==='DW_TAG_array_type'){
      let element=describe(byId.get(t.baseType));
      for(const count of [...(t.dimensions??[])].reverse())element=array(element,count);
      if(element)Object.assign(result,element,{id:t.id,sizeBits:t.sizeBits||element.sizeBits});
    }else if(t.tag==='DW_TAG_pointer_type'){
      Object.assign(result,pointer(describe(byId.get(t.baseType))),{id:t.id,sizeBits:t.sizeBits,evidence:'compiler'});
    }else if(['DW_TAG_typedef','DW_TAG_const_type','DW_TAG_volatile_type','DW_TAG_restrict_type'].includes(t.tag)){
      const base=describe(byId.get(t.baseType))??(t.tag!=='DW_TAG_typedef'&&!t.baseType?voidType:null);
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
    // Clang's AST may print bool while DWARF names the same C type _Bool.
    if(canonical==='bool')canonical='_Bool';
    if(canonical==='void')return voidType;
    const alias=meta.types.find(t=>t.name===name&&t.tag==='DW_TAG_typedef');if(alias)return describe(alias);
    const rowPointer=/^(.+?)\s*\(\s*((?:\*\s*(?:(?:const|volatile|restrict)\s*)*)+)\)\s*((?:\[[^\]]*\]\s*)+)$/.exec(canonical);
    if(rowPointer){
      let result=spelling(`${rowPointer[1].trim()}${rowPointer[3].trim()}`);if(!result)return null;
      for(const part of rowPointer[2].matchAll(/\*\s*((?:(?:const|volatile|restrict)\s*)*)/g)){
        result=pointer(result);const q=part[1].trim().split(/\s+/).filter(Boolean);if(q.length)result=qualified(result,q);
      }
      return result;
    }
    const ptr=/^(.+?)\s*\*\s*((?:(?:const|volatile|restrict)\s*)*)$/.exec(canonical);
    if(ptr&&(!/[()]/.test(ptr[1])||/^(?:(?:const|volatile|restrict) )*(?:struct|union) .*\((?:anonymous|unnamed)/.test(ptr[1]))){
      const target=spelling(ptr[1].trim());if(!target&&ptr[1].trim()!=='void')return null;
      const result=pointer(target),q=ptr[2].trim().split(/\s+/).filter(Boolean);return q.length?qualified(result,q):result;
    }
    // Parse Clang's type spelling, never the original source expression.
    const shape=/^([^()[\]]+?)\s*((?:\[[^\]]*\]\s*)+)$/.exec(canonical);
    if(shape){
      let element=spelling(shape[1].trim());if(!element)return null;
      for(const m of [...shape[2].matchAll(/\[([^\]]*)\]/g)].reverse()){
        const bound=m[1].trim(),constant=/^\d+$/.test(bound);
        element={...array(element,constant?Number(bound):null),...(!constant&&bound?{variableLength:true,boundSpelling:bound}: {})};
      }
      return {...element,name:name.includes('[')?element.name:name};
    }
    const qualifiers=[...canonical.matchAll(/\b(const|volatile|restrict)\b/g)].map(m=>m[1]);
    if(qualifiers.length){const base=spelling(canonical.replace(/\b(?:const|volatile|restrict)\b/g,'').trim());return base?qualified(base,qualifiers):null;}
    const record=meta.types.find(t=>['DW_TAG_structure_type','DW_TAG_union_type'].includes(t.tag)&&t.name===canonical.replace(/^(?:struct|union)\s+/,''));
    if(record)return {...describe(record),name:name||canonical};
    // Anonymous records still have declaration locations and field identities.
    // Match the compiler spelling to its RecordDecl, then to the debug record;
    // a display name is not a prerequisite for a structural type.
    const anonymous=/^(struct|union) (?:[^()]+::)?\((?:anonymous|unnamed)(?: (?:struct|union))? at (.+):(\d+):(\d+)\)$/.exec(canonical);
    if(anonymous){
      const [,kind,file,line,column]=anonymous,decl=nodes.filter(n=>n.kind==='RecordDecl'&&n.source?.file===file&&
        n.source.start.line===Number(line)&&n.source.start.column===Number(column));
      const fields=decl.length===1?decl[0].children.filter(n=>n.kind==='FieldDecl').map(n=>/\s([^\s']+)\s+'/.exec(n.details)?.[1]??null):null;
      const matches=fields?meta.types.filter(t=>t.tag===`DW_TAG_${kind==='struct'?'structure':'union'}_type`&&!t.name&&
        t.source?.file===file&&t.source?.line===Number(line)&&JSON.stringify(describe(t).members.map(m=>m.name))===JSON.stringify(fields)):[];
      if(matches.length===1)return {...describe(matches[0]),name:kind,display:{label:kind,badges:[]},declarationNodeId:decl[0].id};
    }
    // Incomplete records (including library handles) need a type, not an
    // invented memory layout. Only accept a tag actually declared by Clang.
    const tag=/^(struct|union) (\S+)$/.exec(canonical);
    const tagDeclarations=tag?nodes.filter(n=>n.kind==='RecordDecl'&&
      /\b(struct|union) (\S+)/.exec(n.details)?.slice(1).join(' ')===canonical):[];
    if(tagDeclarations.length)
      return {id:`c:opaque:${canonical}`,kind:'record',recordKind:tag[1],name:name||canonical,sizeBits:null,
        incomplete:!tagDeclarations.some(n=>/\bdefinition\b/.test(n.details)),layoutKnown:false,members:[],signedness:null,encoding:null,
        display:{label:name||canonical,badges:[]},evidence:'compiler record declaration; layout unavailable'};
    const aliases=nodes.filter(n=>n.kind==='TypedefDecl'&&/\s([^\s']+)\s+'/.exec(n.details)?.[1]===canonical);
    if(aliases.length===1&&aliases[0].canonical!==canonical){const base=spelling(aliases[0].type,aliases[0].canonical);
      if(base)return {...base,name:name||canonical,display:{label:name||canonical,badges:base.display?.badges??[]}};}
    const enumerations=meta.types.filter(t=>t.tag==='DW_TAG_enumeration_type'&&t.name===canonical.replace(/^enum\s+/,''));
    if(enumerations.length===1)return {...describe(enumerations[0]),name:name||canonical};
    if(enumerations.length>1)return null; // A spelling alone cannot resolve a shadowed enum tag.
    const known=t=>t.signedness||['DW_ATE_float','DW_ATE_boolean'].includes(t.encoding)||['array','record'].includes(describe(t)?.kind);
    const found=meta.types.find(t=>t.name===name&&known(t));if(found)return describe(found);
    const base=meta.types.find(t=>t.name===canonical&&known(t));if(base)return {...describe(base),name};
    if(canonical==='_Bool')return {id:'c:_Bool',name:name||canonical,sizeBits:8,signedness:null,
      encoding:'DW_ATE_boolean',display:{label:name||canonical,badges:[]},evidence:'compiler AST and target ABI'};
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
  const enumConstants=new WeakMap();
  function enumConstant(declaration){
    if(!declaration||declaration.kind!=='EnumConstantDecl')return null;
    if(enumConstants.has(declaration))return enumConstants.get(declaration);
    const declaredName=n=>/\s([^\s']+)\s+'/.exec(n.details)?.[1],parent=declaration.parent,
      names=parent.children.filter(n=>n.kind==='EnumConstantDecl').map(declaredName),constant=declaredName(declaration);
    let candidates=meta.types.filter(t=>t.tag==='DW_TAG_enumeration_type'&&t.enumerators?.length===names.length&&
      names.every(name=>t.enumerators.some(e=>e.name===name)));
    if(candidates.length>1)candidates=candidates.filter(t=>t.source?.file===parent.source?.file&&t.source?.line===parent.source?.start.line);
    const type=candidates.length===1?candidates[0]:null,entry=type?.enumerators.find(e=>e.name===constant),
      result=entry?{...entry,enumTypeId:type.id,evidence:'compiler EnumConstantDecl and DIEnumerator'}:null;
    enumConstants.set(declaration,result);return result;
  }
  const recordDeclarations=new Map();
  function recordDeclaration(type){
    const id=type?.recordTypeId;if(!id)return null;if(recordDeclarations.has(id))return recordDeclarations.get(id);
    const debug=byId.get(id),members=describe(debug)?.members??[],matches=nodes.filter(n=>n.kind==='RecordDecl'&&
      n.source?.file===debug?.source?.file&&n.source?.start.line===debug?.source?.line&&
      JSON.stringify(n.children.filter(c=>c.kind==='FieldDecl').map(c=>/\s([^\s']+)\s+'/.exec(c.details)?.[1]??null))===JSON.stringify(members.map(m=>m.name)));
    const result=matches.length===1?matches[0]:null;recordDeclarations.set(id,result);return result;
  }
  return {byId,describe,spelling,debug:id=>describe(byId.get(id)),enumConstant,recordDeclaration};
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
const toBoolean=n=>/<(?:IntegralToBoolean|FloatingToBoolean|PointerToBoolean)>/.test(n?.details??'');
const numericCast=n=>["ImplicitCastExpr","CStyleCastExpr"].includes(n.kind)&&(/<(?:IntegralCast|FloatingToIntegral|IntegralToFloating|FloatingCast)>/.test(n.details)||toBoolean(n));
function producer(n,types) {
  while(n?.kind==="ParenExpr"||integral(n)&&(()=>{const a=types.spelling(n.children[0]?.type,n.children[0]?.canonical),b=types.spelling(n.type,n.canonical);return a&&b&&a.sizeBits===b.sizeBits;})())n=n.children[0];
  return n;
}
// Shared by normal source positions and collapsed macro expansion positions.
function matchesNumericCast(node,site){
  if(!node||!numericCast(node))return false;
  if(integral(node)&&site.opcode==='trunc'&&site.type==='i1'&&
    /^(?:const |volatile )*(?:_Bool|bool)$/.test(node.children[0]?.canonical??node.children[0]?.type??''))return false;
  if(toBoolean(node))return (node.details.includes('<FloatingToBoolean>')?site.opcode==='fcmp':site.opcode==='icmp')&&
    (!site.predicate||['ne','une'].includes(site.predicate));
  return (node.details.includes('<IntegralCast>')?['zext','sext','trunc']:
    node.details.includes('<FloatingToIntegral>')?['fptosi','fptoui']:node.details.includes('<IntegralToFloating>')?['sitofp','uitofp']:['fpext','fptrunc']).includes(site.opcode);
}
function matches(node,site,allowTargetAccess=false) {
  if(!node||!inside(site.source,node.source))return false;
  if(node.kind==="ImplicitCastExpr"&&node.details.includes("<LValueToRValue>"))return site.opcode==="load";
  if(node.kind==="CallExpr")return site.opcode==="call";
  if(numericCast(node))return matchesNumericCast(node,site);
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
    /(?:prefix|postfix) '(?:\+\+|--)'/.test(node.details)&&
      (allowTargetAccess&&['load','store'].includes(site.opcode)||['add','sub','fadd','fsub','getelementptr'].includes(site.opcode))&&
      !node.children.some(c=>inside(site.source,c.source));
  return false;
}

export function semanticModel(ast,ir,meta,source="",filename="main.c",options={}) {
  const parsedNodes=options.parsedNodes??astNodes(ast),types=cTypes(meta,parsedNodes),sites=[];
  applyMacroLocations(parsedNodes,options.macroTokens);
  const declarations=new Map(parsedNodes.map(n=>[n.astId,n]));
  for(const n of parsedNodes.filter(n=>n.kind==='CallExpr')){
    let target=n.children[0];while(target?.children.length===1)target=target.children[0];
    const id=/\bFunction (0x[0-9a-f]+)/.exec(target?.details??'')?.[1],decl=declarations.get(id);
    if(target?.type==='<builtin fn type>'&&decl?.children.some(c=>['ConstAttr','PureAttr'].includes(c.kind)))
      n.builtin={name:/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target.details)?.[1],pure:true,evidence:'compiler builtin declaration attributes'};
    if(decl?.children.some(c=>['ConstAttr','PureAttr'].includes(c.kind)))
      n.pureCall={name:/\bFunction 0x[0-9a-f]+ '([^']+)'/.exec(target.details)?.[1],evidence:'compiler function purity attribute'};
  }
  const sourceMap=createSourceMap({source,filename,nodes:parsedNodes,llvm:ir,metadata:meta,macroTokenPasses:options.macroTokens===null||options.macroTokens===undefined?0:1});
  const typeQueries=annotateAlignments(parsedNodes,types,options.abi,options.recordLayouts);
  const nodes=parsedNodes.filter(n=>n.source?.file==="/main.c"&&n.functionName);
  for(const node of nodes.filter(n=>n.kind==='UnaryExprOrTypeTraitExpr'&&/\bsizeof\b/.test(n.details))){
    const operand=node.children[0],written=/\bsizeof\s+'([^']+)'(?::'([^']+)')?/.exec(node.details);
    const type=operand?types.spelling(operand.type,operand.canonical):written?types.spelling(written[1],written[2]??written[1]):null;
    if(type?.sizeBits>0&&Number.isInteger(type.sizeBits/8))node.sizeofInfo={byteSize:type.sizeBits/8,operandType:type,evidence:'compiler type size'};
  }
  const shortCircuits=foldedShortCircuits(nodes,sourceMap,filename,types);
  let fn;
  for(const [lineIndex,line]of ir.split("\n").entries()) {
    if(line.startsWith("define "))fn=llvmName(llvmFunction.exec(line)?.[1]);
    const m=new RegExp(`^\\s*(${llvmLocal}) = (?:(?:tail|notail|musttail) )?(\\w+) (.*)`).exec(line),dbg=/!dbg !(\d+)/.exec(line);
    if(m&&dbg){const inputType=m[2]==="call"?parseCall(`call ${m[3]}`).returnType:scalarLLVM(`${m[2]} ${m[3]}`),castType=/\bto (i\d+)\b/.exec(m[3])?.[1];sites.push({lineIndex,result:m[1],opcode:m[2],type:castType??inputType,inputType,source:meta.location(dbg[1]),functionName:fn});}
  }
  const conversions=[];
  for(const node of nodes.filter(numericCast)) {
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
  const noOps=conversions.filter(c=>c.sameWidth&&c.fromType.signedness&&c.toType.signedness&&c.fromType.signedness!==c.toType.signedness);
  for(const cast of noOps) {
    if(cast.kind)continue;
    const root=producer(cast.node.children[0],types);
    const candidates=sites.filter(s=>s.functionName===cast.node.functionName&&matches(root,s)&&s.type===`i${cast.fromType.sizeBits}`);
    cast.site=candidates.length===1?candidates[0]:null;
    cast.reason=candidates.length>1?"ambiguous backend position":"no distinct runtime producer (possibly folded)";
  }
  const converted=new Set(),macroBindings=macroExpressionBindings({types,matchesCast:matchesNumericCast}),calls=callBindings(parsedNodes),
    readAccess=readAccessBindings({ir,meta,nodes:parsedNodes,types,sourceMap,abi:options.abi});
  function annotate(operation,functionName,filename) {
    const site={...operation,functionName,inputType:operation.inputs?.[0]?.type,source:operation.source&&{...operation.source,file:operation.source.file===filename?"/main.c":operation.source.file}};
    const access=['load','store'].includes(operation.opcode);
    const accessType=n=>types.spelling((n.kind==='CompoundAssignOperator'||n.kind==='BinaryOperator'&&/ '='\s*$/.test(n.details))?n.children[0]?.type:n.type,
      (n.kind==='CompoundAssignOperator'||n.kind==='BinaryOperator'&&/ '='\s*$/.test(n.details))?n.children[0]?.canonical:n.canonical);
    const llvmType=t=>!t?null:t.kind==='pointer'?`${llvmType(t.pointee)??'?'}*`:t.kind==='array'?`[${t.count} x ${llvmType(t.elementType)??'?'}]`:
      t.encoding==='DW_ATE_float'?(t.sizeBits===32?'float':t.sizeBits===64?'double':null):t.signedness||t.encoding==='DW_ATE_boolean'?`i${t.sizeBits}`:null;
    const compatible=n=>{const type=accessType(n),expected=llvmType(type);
      if(expected&&!expected.includes('?'))return operation.type===expected;
      if(/\*/.test(n.canonical??n.type??''))return operation.type.endsWith('*');
      return true;
    };
    const locationCandidates=sourceMap.candidates(site.source,functionName);
    const candidates=locationCandidates.filter(n=>matches(n,site,true)&&(!access||compatible(n)));
    candidates.sort((a,b)=>span(a)-span(b)||b.depth-a.depth);
    // Resolve actual storage first, then select the distinct macro occurrence
    // within those candidates. Both passes must agree on the same READ node.
    const storage=readAccess.resolve(operation,functionName,locationCandidates,null),
      macroNode=macroBindings.resolve(operation,storage?.candidates??locationCandidates,{storageMatched:!!storage}),
      storageRead=readAccess.resolve(operation,functionName,locationCandidates,macroNode),
      address=readAccess.resolveAddress(operation,functionName,locationCandidates);
    const node=calls.resolve(operation,functionName,locationCandidates,macroNode)??address?.node??storageRead?.node??macroNode??candidates[0]??(operation.kind==='CALC'?locationCandidates.find(n=>n.builtin?.pure):null);
    if(address)operation.addressBinding=address.binding;
    if(node&&operation.result)for(const cast of noOps){
      // Bind any proven source producer, in macros or ordinary expressions.
      // Require its C value width: an i1 comparison is not its later i32 value.
      if(!cast.kind&&operation.type===`i${cast.fromType.sizeBits}`&&producer(cast.node.children[0],types)===node){cast.site=site;cast.reason=null;}
    }
    if(node){
      operation.semanticNodeId=node.id;
      const type=node.kind==='CompoundAssignOperator'?(access?
        types.spelling(node.children[0]?.type,node.children[0]?.canonical):compoundTypes(node,types).calculationType):types.spelling(node.type,node.canonical);
      // An access uses the stored type, not the promoted computation type.
      // Do not label a wider container load (e.g. a bit-field) as the target.
      if(!access||compatible(node))operation.cType=address?(address.cType??operation.cType):storageRead?.cType??type??operation.cType;
    }
    if(!access&&node?.kind==='UnaryOperator'&&/(?:prefix|postfix) '(?:\+\+|--)'/.test(node.details)&&
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
    if(node?.kind==="CallExpr"&&operation.args){let index=1;for(const arg of operation.args){
        if(arg.sret){arg.cType=types.spelling(node.type,node.canonical);continue;}
        const expression=node.children[index++];arg.cType=expression?types.spelling(expression.type,expression.canonical):null;
      }
    }
    if(node&&numericCast(node)&&(operation.action==="convert"||toBoolean(node)&&['icmp','fcmp'].includes(operation.opcode))){
      const c=conversions.find(c=>c.node===node);if(c){operation.conversion={fromType:c.fromType,toType:c.toType,explicit:c.explicit,sameWidth:c.sameWidth,bitsUnchanged:false,evidence:"compiler AST"};converted.add(c.id);}
    }
    if(operation.action==="calculate"&&operation.predicate)operation.cBoolean=true;
    macroBindings.record(operation,node);
    readAccess.record(operation,functionName);
    calls.record(operation,functionName);
  }
  return {types,nodes:parsedNodes,sourceMap,annotate,noOps,conversions,converted,shortCircuits,typeQueries,
    after(result,functionName){return result?noOps.filter(c=>c.site&&c.site.result===result&&c.site.functionName===functionName).sort((a,b)=>b.node.depth-a.node.depth):[];},
    report(){return {source:"Clang AST + DWARF encoding",sameWidthSignednessCasts:noOps.length,
      inserted:noOps.filter(c=>converted.has(c.id)).length,
      unobserved:noOps.filter(c=>!converted.has(c.id)).map(c=>({nodeId:c.node.id,source:c.source,fromType:c.fromType,toType:c.toType,reason:c.reason}))};}};
}
