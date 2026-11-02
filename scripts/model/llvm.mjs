// Adapter for the bundled LLVM 8 textual format. C syntax is parsed by Clang.
export function splitTop(text, separator = ",") {
  const result=[];let start=0,depth=0,quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];if(c==='"'&&text[i-1]!=="\\") quoted=!quoted;
    if(quoted) continue;
    if("([{<".includes(c)) depth++;
    if(")]} >".replaceAll(" ","").includes(c)) depth--;
    if(c===separator&&!depth) {result.push(text.slice(start,i).trim());start=i+1;}
  }
  result.push(text.slice(start).trim());return result;
}

export function typed(text) {
  text=text.trim();let end;
  if("[{<".includes(text[0])) {
    const open=text[0],close={"[":"]","{":"}","<":">"}[open];let level=0;
    for(let i=0;i<text.length;i++) {if(text[i]===open)level++;if(text[i]===close&&!--level){end=i+1;break;}}
  } else end=/^(?:%"[^"]+"|%[-\w.$]+|i\d+|void|double|float|half|metadata|label|x86_fp80|fp128|token)/.exec(text)?.[0].length;
  if(!end) throw new Error(`지원하지 않는 LLVM 자료형: ${text.slice(0,100)}`);
  // Function pointer types contain an argument list before the pointer stars.
  let tail=text.slice(end),fn=/^\s*\(/.exec(tail);
  if(fn) {let level=0;for(let i=end;i<text.length;i++){if(text[i]==="(")level++;if(text[i]===")"&&!--level){end=i+1;break;}}}
  while(text[end]==="*")end++;
  return {type:text.slice(0,end).trim(),value:text.slice(end).trim()};
}

export function operand(text) {
  const p=typed(text);
  p.value=p.value.replace(/^(?:(?:nonnull|noalias|nocapture|readonly|readnone|writeonly|signext|zeroext|inreg|nest|returned|swiftself|swifterror)\s+|(?:align|dereferenceable|dereferenceable_or_null)\s*\(?\d+\)?\s+|(?:byval|sret)(?:\([^)]*\))?\s+)*/,"");
  return p;
}

export function metadata(ir) {
  const nodes=new Map();for(const line of ir.split("\n")) {const m=/^!(\d+) = (.*)/.exec(line);if(m)nodes.set(m[1],m[2]);}
  const field=(id,key)=>new RegExp(`(?:^|[, (])${key}: ("(?:[^"\\\\]|\\\\.)*"|![0-9]+|[^,)]+)`).exec(nodes.get(String(id))??"")?.[1];
  const clean=v=>v?.replace(/^!/,"").replace(/^"|"$/g,"");
  const locationCache=new Map();
  function location(id,seen=new Set()) {
    if(!id)return null;id=String(id);
    if(locationCache.has(id))return locationCache.get(id);
    if(seen.has(id))return null;seen.add(id);
    const n=nodes.get(id);if(!n)return null;
    const line=Number(field(id,"line")),column=Number(field(id,"column")??0);
    const fileId=clean(field(id,"file")),scope=clean(field(id,"scope"));
    if(n.includes("DIFile(")){
      const result={file:clean(field(id,"filename"))};locationCache.set(id,result);return result;
    }
    const parent=location(fileId??scope,seen);
    const result={...parent,...(line?{line,column}:{})};locationCache.set(id,result);return result;
  }
  const types=[...nodes].filter(([,n])=>/!DI(?:Basic|Derived|Composite|Subroutine)Type\(/.test(n)).map(([id,n])=>({
    id:`debug:${id}`,kind:/!DI(\w+)Type/.exec(n)[1],name:clean(field(id,"name")),tag:field(id,"tag"),
    sizeBits:Number(field(id,"size")??0),offsetBits:Number(field(id,"offset")??0),encoding:field(id,"encoding")??null,
    baseType:field(id,"baseType")?`debug:${clean(field(id,"baseType"))}`:null,
    elements:field(id,"elements")? [...(nodes.get(clean(field(id,"elements")))??"").matchAll(/!(\d+)/g)].map(m=>`debug:${m[1]}`):[],
    evidence:"compiler"}));
  const byId=new Map(types.map(t=>[t.id,t]));
  function decorate(t,seen=new Set()) {
    if(!t||seen.has(t.id))return;seen.add(t.id);
    const base=byId.get(t.baseType);if(base)decorate(base,seen);
    const inherits=t.kind==="Derived"&&["DW_TAG_typedef","DW_TAG_const_type","DW_TAG_volatile_type","DW_TAG_restrict_type"].includes(t.tag);
    if(inherits){t.encoding??=base?.encoding??null;t.sizeBits||=base?.sizeBits??0;}
    if(t.tag==='DW_TAG_array_type')t.dimensions=t.elements.map(id=>{
      const count=field(id.slice(6),'count');return /^\d+$/.test(count??'')?Number(count):null;
    });
    t.signedness=/^DW_ATE_signed(?:_char)?$/.test(t.encoding)?"signed":/^DW_ATE_unsigned(?:_char)?$/.test(t.encoding)?"unsigned":null;
    t.display={label:t.name?.replace(/^unsigned\s+/,"")??base?.display?.label??null,badges:t.signedness==="unsigned"?["u"]:[]};
    if(t.dimensions)t.display={label:base?.display?.label==null?null:base.display.label+t.dimensions.map(n=>`[${n??''}]`).join(''),badges:base?.display?.badges??[]};
    else if(inherits&&base)t.display={label:t.name??base.display.label,badges:base.display.badges};
  }
  for(const t of types)decorate(t);
  return {nodes,field,clean,location,types};
}

export function layouts(ir) {
  const definitions=new Map([...ir.matchAll(/^(%[^\n=]+) = type (.+)$/gm)].map(m=>[m[1].trim(),m[2]])),cache=new Map();
  function layout(type,seen=new Set()) {
    if(cache.has(type))return cache.get(type);
    let info;
    if(type.endsWith("*"))info={kind:"pointer",size:4,align:4,to:type.slice(0,-1)};
    else if(/^i\d+$/.test(type)){const bits=Number(type.slice(1));info={kind:"integer",bits,size:Math.ceil(bits/8),align:bits>32?8:Math.min(4,Math.ceil(bits/8))};}
    else if(type==="float"||type==="double"||type==="fp128")info={kind:"float",size:type==="float"?4:type==="double"?8:16,align:type==="float"?4:type==="double"?8:16};
    else if(type==="void")info={kind:"void",size:0,align:1};
    else if(/^\[/.test(type)) {const m=/^\[(\d+) x (.*)\]$/.exec(type);if(!m)throw new Error(`지원하지 않는 배열형: ${type}`);const element=layout(m[2],seen);info={kind:"array",count:Number(m[1]),elementType:m[2],size:Number(m[1])*element.size,align:element.align};}
    else {
      const body=definitions.get(type)??type;
      if(seen.has(type))throw new Error(`재귀 값 자료형: ${type}`);
      const packed=body.startsWith("<{"),s=packed?body.slice(2,-2):body.slice(1,-1);
      if(body==="opaque"){info={kind:"opaque",size:0,align:1};cache.set(type,info);return info;}
      if(!(body.startsWith("{")||packed))throw new Error(`지원하지 않는 LLVM 배치: ${type}`);
      const fields=[];let size=0,align=1;const next=new Set(seen).add(type);
      for(const field of splitTop(s).filter(Boolean)){const item=layout(field,next),a=packed?1:item.align;size=Math.ceil(size/a)*a;fields.push({type:field,offset:size});size+=item.size;align=Math.max(align,a);}
      info={kind:"record",fields,size:Math.ceil(size/align)*align,align};
    }
    cache.set(type,info);return info;
  }
  return {layout,definitions,cache};
}

export function parseCall(body) {
  const text=body.replace(/^(?:tail |musttail |notail )?call\s+/,"");
  let depth=0,quoted=false,open=-1;
  for(let i=0;i<text.length;i++) {const c=text[i];if(c==='"'&&text[i-1]!=="\\")quoted=!quoted;if(quoted)continue;
    if(c==="("&&!depth&&/[@%](?:[-\w.$]+|"[^"]+")$/.test(text.slice(0,i).trim())){open=i;break;}
    if("([{<".includes(c))depth++;if(")]} >".replaceAll(" ","").includes(c))depth--;
  }
  if(open<0)throw new Error(`지원하지 않는 호출 형식: ${body.slice(0,140)}`);
  const before=text.slice(0,open).trim(),callee=/([@%](?:[-\w.$]+|"[^"]+"))$/.exec(before)[1];
  let end=open,level=0;for(;end<text.length;end++){if(text[end]==="(")level++;if(text[end]===")"&&!--level)break;}
  const head=before.slice(0,-callee.length).trim().replace(/^(?:(?:fastcc|coldcc|ccc|zeroext|signext|noalias|nonnull)\s+)*/,"");
  return {callee,returnType:typed(head).type.replace(/\s*\(.*\)$/s,""),args:splitTop(text.slice(open+1,end)).filter(Boolean).map(text=>({...operand(text),sret:/\bsret\b/.test(text),byval:/\bbyval\b/.test(text)}))};
}
