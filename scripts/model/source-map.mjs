import {createHash} from 'node:crypto';
import {llvmFunction,llvmName} from './llvm.mjs';

const order=(a,b)=>a.line-b.line||a.column-b.column;
const encloses=(r,p)=>r&&p&&r.file===p.file&&order(r.start,p)<=0&&order(p,r.end)<=0;

// Compiler ranges end at the START of their final token in the text AST dump.
// This bounded lexer only supplies the missing end offset, never C semantics.
function tokenEnd(bytes,start){
  let i=start,quote=start;
  if(bytes[i]===117&&bytes[i+1]===56)quote=i+2;
  else if([117,85,76].includes(bytes[i]))quote=i+1;
  if([34,39].includes(bytes[quote])){
    const delimiter=bytes[quote];i=quote+1;
    while(i<bytes.length){
      if(bytes[i]===92){i+=bytes[i+1]===13&&bytes[i+2]===10?3:2;continue;}
      if(bytes[i]===delimiter)return i+1;
      if(bytes[i]===10||bytes[i]===13)return null;
      i++;
    }
    return null;
  }
  const digit=c=>c>=48&&c<=57;
  const alpha=c=>c>=65&&c<=90||c>=97&&c<=122||c===95||c>=128;
  if(alpha(bytes[i])){while(i<bytes.length&&(alpha(bytes[i])||digit(bytes[i])))i++;return i;}
  if(digit(bytes[i])||bytes[i]===46&&digit(bytes[i+1])){
    i++;while(i<bytes.length&&(alpha(bytes[i])||digit(bytes[i])||bytes[i]===46||
      [43,45].includes(bytes[i])&&[69,101,80,112].includes(bytes[i-1])))i++;
    return i;
  }
  const punct=bytes.subarray(i,i+4).toString('ascii');
  if(punct.startsWith('//')||punct.startsWith('/*')||!bytes[i]||bytes[i]<=32)return null;
  const op=['%:%:','<<=','>>=','...','++','--','->','&&','||','<=','>=','==','!=','+=','-=','*=','/=','%=','&=','|=','^=','<<','>>','##','<:',':>','<%','%>','%:'].find(x=>punct.startsWith(x));
  return i+(op?.length??1);
}

export function createSourceMap({source,filename,nodes,llvm,metadata,macroTokenPasses=0}){
  const bytes=Buffer.from(source,'utf8'),starts=[0];
  for(let i=0;i<bytes.length;i++)if(bytes[i]===10)starts.push(i+1);
  const snapshot={file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),text:source,byteLength:bytes.length};
  const gaps=new Map(),queries=new Map(),ranges=new Map(),ends=new Map(),points=new Map(),matches=new Map(),functions=new Map(),sites=[];
  const stats={compilerLocationQueries:0,compilerLocationCacheHits:0,rangeQueries:0,rangeCacheHits:0,tokenBoundaryScans:0,textExtractions:0,semanticSourceScans:0,macroRangeScans:0,
    compilerTokenMappings:nodes.filter(n=>n.expansionSource).length,compilerMacroTokenPasses:macroTokenPasses,macroInvocationScans:0};
  const internal=p=>p&&({...p,file:p.file===filename?'/main.c':p.file});
  const gap=(reason,data)=>gaps.set(JSON.stringify([reason,data]),{reason,...data});
  const query=(reason,start,end)=>{const key=`${reason}:${start}:${end}`;if(!queries.has(key))queries.set(key,{reason,startByte:start,endByte:end});};
  // Mixed macro spelling ranges have an AST start in the user's statement and
  // an end in the macro definition. Complete only that display boundary. This
  // bounded token walk supplies no expression values or language semantics.
  const macroEnds=new Map();
  for(const node of nodes)if(node.macroLocationGap)gap('compiler-macro-location-unresolved',{nodeId:node.id,detail:node.macroLocationGap});
  function invocationEnd(start){
    const key=`invocation:${start}`;if(macroEnds.has(key))return macroEnds.get(key);
    stats.macroInvocationScans++;const limit=Math.min(bytes.length,start+4096);let at=tokenEnd(bytes,start),last=start,depth=0,opened=false;
    while(at!==null&&at<limit){
      if(bytes[at]<=32){at++;continue;}
      if(bytes[at]===47&&bytes[at+1]===47){while(at<limit&&bytes[at]!==10)at++;continue;}
      if(bytes[at]===47&&bytes[at+1]===42){const end=bytes.indexOf('*/',at+2);if(end<0||end+2>limit)break;at=end+2;continue;}
      if(!opened&&bytes[at]!==40)break;
      if(bytes[at]===40){depth++;opened=true;}else if(bytes[at]===41&&--depth===0){last=at;break;}
      const end=tokenEnd(bytes,at);if(end===null||end>limit)break;at=end;
    }
    if(opened&&depth!==0){gap('macro-invocation-range-unresolved',{startByte:start});last=start;}
    query('macro-invocation-end-not-in-compiler-dump',start,Math.min(at??start,limit));macroEnds.set(key,last);return last;
  }
  for(const node of nodes)for(const r of [node.source,node.expansionSource])if(r?.macroInvocation){
    const start=offset(r.start);if(start!==null){const end=point(invocationEnd(start));r.end={file:'/main.c',line:end.line,column:end.column};}
  }
  function macroEnd(start,commaExpression){
    const cacheKey=`${start}:${commaExpression}`;if(macroEnds.has(cacheKey))return macroEnds.get(cacheKey);
    stats.macroRangeScans++;const stack=[],limit=Math.min(bytes.length,start+4096);let at=start,last=null,stopped=false;
    while(at<limit){
      if(bytes[at]<=32){at++;continue;}
      if(bytes[at]===47&&bytes[at+1]===47){while(at<limit&&bytes[at]!==10)at++;continue;}
      if(bytes[at]===47&&bytes[at+1]===42){const end=bytes.indexOf('*/',at+2);if(end<0||end+2>limit)break;at=end+2;continue;}
      const c=bytes[at];
      if(!stack.length&&(c===59||c===44&&!commaExpression||[41,93,125].includes(c))){stopped=true;break;}
      if([40,91,123].includes(c))stack.push(c);
      else if([41,93,125].includes(c)){if(stack.at(-1)!==({41:40,93:91,125:123})[c])break;stack.pop();}
      const end=tokenEnd(bytes,at);if(end===null||end>limit)break;last=at;at=end;
    }
    const result=stopped&&!stack.length?last:null;macroEnds.set(cacheKey,result);
    query('macro-range-not-in-compiler-dump',start,at);return result;
  }
  for(const node of nodes){
    const r=node.spellingRange;
    if(!node.functionName||!['BinaryOperator','CompoundAssignOperator','VarDecl','ReturnStmt'].includes(node.kind)||r?.start.file!=='/main.c'||
      r.end.file==='/main.c'&&order(r.start,r.end)<=0)continue;
    const start=offset(r.start),end=start===null?null:macroEnd(start,node.kind==='BinaryOperator'&&/ ','(?:\s|$)/.test(node.details));
    if(end===null){gap('macro-range-unresolved',{nodeId:node.id,start:r.start,end:r.end});continue;}
    const finish=point(end);node.source={file:'/main.c',start:r.start,end:{file:'/main.c',line:finish.line,column:finish.column},
      evidence:'compiler AST start with bounded macro display boundary'};
  }
  for(const node of nodes)if(node.source?.file==='/main.c'){
    const key=node.functionName??'';if(!functions.has(key))functions.set(key,[]);functions.get(key).push(node);
  }
  function candidates(where,functionName){
    if(!where)return [];stats.compilerLocationQueries++;
    const p=internal(where),key=`${functionName??''}:${p.file}:${p.line}:${p.column}`;
    if(matches.has(key)){stats.compilerLocationCacheHits++;return matches.get(key);}
    const found=(functions.get(functionName??'')??[]).filter(n=>!n.executionState&&(encloses(n.source,p)||encloses(n.expansionSource,p))).sort((a,b)=>b.depth-a.depth);
    matches.set(key,found);return found;
  }
  // Establish compiler-to-source links before asking for any original tokens.
  let fn=null;
  for(const [lineIndex,line]of llvm.split('\n').entries()){
    if(line.startsWith('define '))fn=llvmName(llvmFunction.exec(line)?.[1])??null;
    const dbg=/!dbg !(\d+)/.exec(line);
    if(fn&&dbg){const location=metadata.location(dbg[1]);sites.push({llvmLine:lineIndex+1,functionName:fn,location,astNodeIds:candidates(location,fn).map(n=>n.id)});}
    if(line==='}')fn=null;
  }
  function offset(point){
    if(!point||!Number.isInteger(point.line)||!Number.isInteger(point.column)||point.line<1||point.line>starts.length||point.column<1)return null;
    const at=starts[point.line-1]+point.column-1,limit=starts[point.line]??bytes.length+1;
    return at<limit&&at<=bytes.length?at:null;
  }
  function point(at){
    if(points.has(at))return points.get(at);
    let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]<=at)lo=mid;else hi=mid;}
    const p={line:lo+1,column:at-starts[lo]+1,byte:at,editorColumn:bytes.subarray(starts[lo],at).toString('utf8').length+1};points.set(at,p);return p;
  }
  function range(raw,{text=false}={}){
    if(!raw)return null;stats.rangeQueries++;
    const r={...raw,file:internal(raw).file};
    if(r.file!=='/main.c'){gap('external-or-macro-range',{file:r.file,start:r.start,end:r.end});return null;}
    const start=offset(r.start),last=offset(r.end??r.start);
    if(start===null||last===null||last<start||last>=bytes.length){gap('invalid-compiler-range',{start:r.start,end:r.end});return null;}
    const key=`${start}:${last}`;
    let base=ranges.get(key);
    if(base)stats.rangeCacheHits++;
    else{
      if(!ends.has(last)){
        stats.tokenBoundaryScans++;const end=tokenEnd(bytes,last);ends.set(last,end);
        query('token-end-not-in-compiler-dump',last,end??last);
      }
      const end=ends.get(last);if(end===null){gap('token-end-unresolved',{startByte:last});return null;}
      const a=point(start),b=point(end);
      base={file:filename,line:a.line,column:a.column,start:a,end:b,endExclusive:true,
        editorRange:{startLineNumber:a.line,startColumn:a.editorColumn,endLineNumber:b.line,endColumn:b.editorColumn},
        evidence:r.evidence??'compiler location with bounded token-end lookup'};ranges.set(key,base);
    }
    if(text&&base.expression===undefined){
      stats.textExtractions++;query('display-source-text',base.start.byte,base.end.byte);
      base.expression=bytes.subarray(base.start.byte,base.end.byte).toString('utf8');
    }
    if(text)return base;
    const {expression,...location}=base;return location;
  }
  const locate=(where,options)=>where?range({file:where.file,start:where,end:where},options):null;
  return {snapshot,candidates,range,locate,sites,
    report(){const macroExpansions=nodes.filter(n=>n.expansionSource).map(n=>({nodeId:n.id,astId:n.astId,
      spelling:n.spellingRange,expansion:range(n.expansionSource),tokenRange:n.macroTokenRange}));
      return {version:1,analysisOrder:['compiler-source-links','compiler-semantics','bounded-source-fallback'],macroExpansions,
      coordinateSystem:{compiler:'one-based UTF-8 byte columns',editor:'one-based UTF-16 columns',end:'exclusive'},snapshot,
      compilerSites:sites,sourceQueries:[...queries.values()],stats:{...stats},gaps:[...gaps.values()]};}};
}

// Values already represented by compiler AST nodes; no source expression evaluator.
export function compilerInteger(node){
  if(!node)return null;
  if(['ConstantExpr','ParenExpr'].includes(node.kind)&&node.children.length===1)return compilerInteger(node.children[0]);
  if(['IntegerLiteral','CharacterLiteral'].includes(node.kind))return / (-?\d+)\s*$/.exec(node.details)?.[1]??null;
  if(node.kind==='UnaryOperator'&&/prefix '[+-]'/.test(node.details)&&node.children.length===1){
    const v=compilerInteger(node.children[0]);return v===null?null:(/prefix '-'/.test(node.details)?-BigInt(v):BigInt(v)).toString();
  }
  return null;
}
