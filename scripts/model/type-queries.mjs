import {compilerInteger} from './source-map.mjs';

// Record alignment comes from Clang's layout report. Scalar/pointer alignment
// uses the same pinned target ABI adapter as LLVM memory observation.
export function annotateAlignments(nodes,types,abi,dump=''){
  const layouts=new Map(),unresolved=[];
  const normalize=s=>(s??'').replace(/^(?:struct|union)\s+/,'').trim();
  for(const block of (dump??'').split('*** Dumping AST Record Layout')){
    const name=/^\s*0 \| ([^\n]+)$/m.exec(block)?.[1]?.trim(),shape=/\[sizeof=(\d+), align=(\d+)\]/.exec(block);
    if(!name||!shape)continue;const k=normalize(name);if(!layouts.has(k))layouts.set(k,[]);
    layouts.get(k).push({size:+shape[1],align:+shape[2],compilerType:name});
  }
  const aliasName=n=>/\s([^\s']+)\s+'/.exec(n.details)?.[1];
  const aliases=nodes.filter(n=>n.kind==='TypedefDecl');
  const scalar=t=>{
    if(!t||!abi)return null;if(t.kind==='array')return scalar(t.elementType);
    if(t.kind==='pointer')return abi.layout('i8*').align;
    if(t.encoding==='DW_ATE_float')return abi.layout(t.sizeBits===32?'float':t.sizeBits===64?'double':'fp128').align;
    return t.signedness?abi.layout(`i${t.sizeBits}`).align:null;
  };
  const scope=n=>{for(let p=n.parent;p;p=p.parent)if(['CompoundStmt','FunctionDecl','TranslationUnitDecl'].includes(p.kind))return p;return null;};
  for(const node of nodes.filter(n=>n.kind==='UnaryExprOrTypeTraitExpr'&&/\balignof\b/.test(n.details))){
    const written=/\balignof\s+'([^']+)'(?::'([^']+)')?/.exec(node.details),operand=node.children[0],name=written?.[1]??operand?.type,
      canonical=written?.[2]??operand?.canonical??name;
    const info={kind:'alignof',queriedType:name??null,canonicalType:canonical??null,operandEvaluation:'unevaluated'};
    // GNU expression alignment may include declaration-specific attributes;
    // its type alone is not sufficient evidence for the queried value.
    if(!written){node.alignofInfo={...info,evidence:'unresolved compiler expression alignment'};
      unresolved.push({nodeId:node.id,type:name,source:node.source,reason:'expression alignment requires declaration evidence'});continue;}
    const ancestors=new Set();for(let p=node;p;p=p.parent)ancestors.add(p);
    const alias=aliases.filter(n=>{
      if(aliasName(n)!==name||!ancestors.has(scope(n)))return false;
      const a=n.declarationPoint??n.source?.start,b=node.source?.start;
      return !a||!b||a.file!==b.file||a.line<b.line||a.line===b.line&&a.column<=b.column;
    }).sort((a,b)=>(scope(b)?.depth??0)-(scope(a)?.depth??0))[0];
    const attrs=alias?.children.filter(n=>n.kind==='AlignedAttr')??[];
    let value=null,evidence=null;
    if(attrs.length){const values=attrs.map(a=>compilerInteger(a.children[0]));
      if(values.every(v=>v!==null)){value=Math.max(...values.map(Number));evidence='compiler typedef alignment attribute';}
    }else{
      const key=normalize((canonical??'').replace(/\b(?:const|volatile|restrict)\b/g,'').trim()),records=layouts.get(key)??layouts.get(normalize(name));
      if(records?.length&&new Set(records.map(r=>r.align)).size===1){value=records[0].align;evidence='compiler record layout';}
      if(value===null){const array=/^(.*?)\s*(?:\[\d*\]\s*)+$/.exec(canonical??''),base=array?.[1],elementRecords=base&&layouts.get(normalize(base));
        if(elementRecords?.length&&new Set(elementRecords.map(r=>r.align)).size===1){value=elementRecords[0].align;evidence='compiler element record layout';}
        else {const type=types.spelling(canonical)??types.spelling(name,canonical)??(base?types.spelling(base):null);
          value=scalar(type);if(value!==null)evidence='compiler C type and LLVM target ABI';
          else if(['char','signed char','unsigned char','_Bool'].includes(canonical)){value=abi?.layout('i8').align??null;evidence='compiler builtin type and LLVM target ABI';}
          else if(canonical==='long double'){value=abi?.layout('fp128').align??null;evidence='compiler builtin type and LLVM target ABI';}
        }
      }
    }
    if(value!==null&&value>0)node.alignofInfo={...info,byteAlignment:value,operandType:types.spelling(name,canonical)??{name,compilerType:canonical,evidence:'compiler AST'},evidence};
    else {node.alignofInfo={...info,evidence:'unresolved compiler alignment'};unresolved.push({nodeId:node.id,type:name,source:node.source});}
  }
  return {source:'compiler record layout + target ABI',unresolved};
}
