// Equivalence is based on compiler type structure, never byte width alone.
// Keep qualifiers at every indirection level and record/enum identities.
const qualifierTags=new Map([['DW_TAG_const_type','const'],['DW_TAG_volatile_type','volatile'],['DW_TAG_restrict_type','restrict']]);
function builtin(name){
  const words=(name??'').replace(/\b(?:const|volatile|restrict)\b/g,'').trim().split(/\s+/);
  if(!words.length||!words.every(w=>['signed','unsigned','char','short','int','long','float','double','_Bool','void'].includes(w)))return null;
  if(words.includes('char'))return `${words.includes('unsigned')?'unsigned ':words.includes('signed')?'signed ':''}char`;
  if(words.includes('float')||words.includes('double'))return words.sort().join(' ');
  if(words.includes('_Bool')||words.includes('void'))return words.join(' ');
  return `${words.includes('unsigned')?'unsigned':'signed'}:${words.includes('short')?'short':words.filter(w=>w==='long').length?words.filter(w=>w==='long').join(' '):'int'}`;
}
export function compilerTypeIdentity(types=[]){
  const byId=new Map(types.map(t=>[t.id,t]));
  function raw(id,seen=new Set()){
    if(!id)return 'q[]:void';if(seen.has(id))return `recursive:${id}`;
    const t=byId.get(id);if(!t)return `id:${id}`;
    const next=new Set(seen).add(id),q=qualifierTags.get(t.tag);
    if(t.tag==='DW_TAG_typedef')return raw(t.baseType,next);
    if(q)return qualified(raw(t.baseType,next),[q]);
    if(t.tag==='DW_TAG_pointer_type')return qualified(`pointer:${t.sizeBits}:${raw(t.baseType,next)}`,[]);
    if(t.tag==='DW_TAG_array_type')return (t.dimensions??[]).reduceRight((element,count)=>qualified(`array:${count}:${element}`,[]),raw(t.baseType,next));
    if(['DW_TAG_structure_type','DW_TAG_union_type'].includes(t.tag))return qualified(`record:${id}`,[]);
    if(t.tag==='DW_TAG_enumeration_type')return qualified(`enum:${id}`,[]);
    return qualified(`scalar:${builtin(t.name)??`id:${id}`}:${t.sizeBits}:${t.encoding??''}`,[]);
  }
  function qualified(key,qualifiers){
    const match=/^q\[([^\]]*)\]:(.*)$/s.exec(key),all=[...new Set([...(match?.[1]?match[1].split(','):[]),...qualifiers])].sort();
    return `q[${all.join(',')}]:${match?.[2]??key}`;
  }
  function key(t){
    if(!t)return 'void';let base;
    if(t.kind==='pointer')base=`pointer:${t.sizeBits}:${key(t.pointee)}`;
    else if(t.kind==='array')base=`array:${t.count??'?'}:${key(t.elementType)}`;
    else if(t.kind==='record')base=`record:${t.recordTypeId??t.id}`;
    else if(t.kind==='enum')base=`enum:${t.enumTypeId??t.id}`;
    else if(byId.has(t.id))base=raw(t.id);
    else if(t.kind==='void')base='void';
    else base=`scalar:${builtin(t.name)??`id:${t.id}`}:${t.sizeBits}:${t.encoding??''}`;
    return qualified(base,t.qualifiers??[]);
  }
  function isArray(id,seen=new Set()){
    if(seen.has(id))return false;seen.add(id);const t=byId.get(id);
    return t?.tag==='DW_TAG_array_type'||(t?.tag==='DW_TAG_typedef'||qualifierTags.has(t?.tag))&&isArray(t.baseType,seen);
  }
  return {key,raw,isArray};
}
