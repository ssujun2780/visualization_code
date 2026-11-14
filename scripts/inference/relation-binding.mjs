// Declarative, run-scoped storage mapping. This is not an executable rule or IR.
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const text=s=>typeof s==='string'&&s.length>0;
const fail=message=>{throw new TypeError(message);};
const decimal=x=>{if(typeof x==='number'&&!Number.isSafeInteger(x)||!['number','string'].includes(typeof x)||!/^[-+]?\d+$/.test(String(x)))fail('정확한 정수 또는 정수 문자열이 필요합니다.');return BigInt(x).toString();};
export function relationTypes(trace){
  const types=new Map(),seen=new Set();
  function visit(t){if(!t||typeof t!=='object'||seen.has(t))return;seen.add(t);
    if(t.kind==='record'&&text(t.recordTypeId)&&integer(t.sizeBits,1))types.set(t.recordTypeId,t);
    visit(t.elementType);visit(t.pointee);}
  for(const o of trace.objects)visit(o.cType);
  for(const e of trace.events){visit(e.cType);visit(e.value?.cType);}
  return types;
}
export function defineStructureRelation(trace,spec){
  if(!spec||typeof spec!=='object'||Array.isArray(spec))fail('관계 지정 객체가 필요합니다.');
  const scope={programId:trace.programId,runId:trace.runId};
  if(!text(scope.programId)||!text(scope.runId))fail('실행 범위 식별자가 필요합니다.');
  if(spec.schemaVersion!==undefined&&(spec.schemaVersion!==1||spec.kind!=='user-relation'||spec.scope?.programId!==scope.programId||spec.scope?.runId!==scope.runId))fail('다른 실행의 관계 지정입니다.');
  const objects=new Map(trace.objects.map(o=>[o.id,o]));
  function storage(s,array=false){
    const o=objects.get(s?.objectId);if(!o)fail('관측된 저장 객체가 필요합니다.');
    const type=o.cType?.kind==='array'?o.cType.elementType:null,
      offset=s.offset??0,size=s.size??(array?type?.sizeBits:o.cType?.sizeBits)/8,
      stride=s.stride??size,count=s.count??(integer(stride,1)?Math.max(0,Math.floor((o.size-offset-size)/stride)+1):null);
    if(!integer(offset)||!integer(size,1)||offset>o.size||(!array||count>0)&&offset+size>o.size||array&&(!integer(stride,size)||!integer(count)||count>0&&offset+(count-1)*stride+size>o.size))fail('저장 범위·간격·개수가 객체 범위를 벗어났습니다.');
    return {objectId:o.id,offset,size,...array?{stride,count}:{}};
  }
  const n=spec.nodes;let nodes;
  if(n?.kind==='array')nodes={kind:'array',...storage(n,true)};
  else if(n?.kind==='records'){
    const type=relationTypes(trace).get(n.recordTypeId);if(!type)fail('관측 타입에 있는 레코드 식별자가 필요합니다.');
    nodes={kind:'records',recordTypeId:n.recordTypeId,size:type.sizeBits/8};
  }else fail('노드 저장소는 array 또는 records입니다.');
  function source(s,nodeSize=nodes.size,root=false){
    if(s?.kind==='slot')return {kind:'slot',...storage(s)};
    if(!root&&s?.kind==='field'){
      if(!integer(s.offset)||!integer(s.size,1)||s.offset+s.size>nodeSize)fail('연결 필드가 노드 범위를 벗어났습니다.');
      return {kind:'field',offset:s.offset,size:s.size};
    }
    if(!root&&s?.kind==='array'&&nodes.kind==='array')return {kind:'array',...storage(s,true)};
    fail('관측 슬롯, 노드 필드 또는 분리 배열을 지정해야 합니다.');
  }
  function coordinate(c){
    if(typeof c==='number'){if(!integer(c))fail('구간 좌표는 음수가 아닌 안전 정수입니다.');return c;}
    const s=source(c);if(s.size>16||c.signed!==undefined&&typeof c.signed!=='boolean')fail('구간 좌표 슬롯 형식이 잘못되었습니다.');
    return {...s,signed:c.signed??true};
  }
  function encoding(item,root=false,nodeSize=nodes.size,allowCollection=true,targetKind=nodes.kind){
    if(!item||!['index','pointer'].includes(item.kind))fail('연결 값의 형식은 index 또는 pointer입니다.');
    if(item.kind==='index'&&targetKind!=='array')fail('인덱스 연결에는 배열 노드 저장소가 필요합니다.');
    if(item.signed!==undefined&&typeof item.signed!=='boolean')fail('signed는 불리언입니다.');
    if(item.nullValues!==undefined&&!Array.isArray(item.nullValues))fail('종료값은 정수 배열입니다.');
    const enc=item.kind==='index'?{signed:item.signed??true,indexBase:decimal(item.indexBase??0),nullValues:[...new Set((item.nullValues??[]).map(decimal))]}:{};
    if(root&&item.value!==undefined){if(item.kind!=='index'||item.source!==undefined)fail('직접 지정한 루트는 인덱스만 허용합니다.');return {kind:'index',...enc,value:decimal(item.value)};}
    const s=item.source;let normalized;
    if(!root&&allowCollection&&s?.kind==='span'){
      let backing;
      if(s.storage?.kind==='array')backing={kind:'array',...storage(s.storage,true)};
      else if(s.storage?.kind==='indirect'){
        const pointer=source(s.storage.pointer),size=s.storage.size,stride=s.storage.stride??size;
        if(pointer.size>16||!integer(size,1)||size>16||!integer(stride,size))fail('간접 인접 배열의 크기·간격이 잘못되었습니다.');
        backing={kind:'indirect',pointer,size,stride};
      }else fail('인접 배열 저장소가 필요합니다.');
      if(backing.size>16||(s.count===undefined)===(s.end===undefined))fail('인접 배열은 count 또는 end 하나가 필요합니다.');
      normalized={kind:'span',storage:backing,start:coordinate(s.start??0),...(s.count!==undefined?{count:coordinate(s.count)}:{end:coordinate(s.end)})};
    }else if(!root&&allowCollection&&s?.kind==='chain'){
      let entries;
      if(s.entries?.kind==='array')entries={kind:'array',...storage(s.entries,true)};
      else if(s.entries?.kind==='records'){
        const type=relationTypes(trace).get(s.entries.recordTypeId);if(!type)fail('인접 연결 항목의 레코드 타입이 필요합니다.');
        entries={kind:'records',recordTypeId:s.entries.recordTypeId,size:type.sizeBits/8};
      }else fail('인접 연결 항목의 저장소가 필요합니다.');
      const head=encoding(s.head,false,nodeSize,false,entries.kind),next=encoding(s.next,false,entries.size,false,entries.kind),itemSource=source(s.item,entries.size);
      if(next.source?.kind!=='field'||itemSource.kind!=='field'||itemSource.size>16)fail('인접 항목의 next와 item은 필드여야 합니다.');
      normalized={kind:'chain',entries,head,next,item:itemSource};
    }else normalized=source(s,nodeSize,root);
    if(normalized.size>16)fail('연결 슬롯 크기는 최대 16바이트입니다.');
    return {kind:item.kind,...enc,source:normalized};
  }
  if(!Array.isArray(spec.links)||!spec.links.length||spec.links.length>64)fail('1~64개 연결 역할이 필요합니다.');
  const ids=new Set(),links=spec.links.map(l=>{if(!text(l.id)||ids.has(l.id))fail('연결 역할 식별자는 비어 있지 않고 고유해야 합니다.');ids.add(l.id);return {id:l.id,...encoding(l)};});
  if(spec.roots!==undefined&&spec.roots!==null&&!Array.isArray(spec.roots))fail('루트는 배열로 지정합니다.');
  if(spec.roots?.length>64)fail('루트 지정은 최대 64개입니다.');
  const roots=spec.roots===undefined?null:spec.roots===null?null:spec.roots.map(r=>encoding(r,true));
  const definition={nodes,links,roots};
  // Full normalized identity avoids hash collisions and survives JSON persistence.
  return {schemaVersion:1,kind:'user-relation',scope,id:`user-relation:${JSON.stringify(definition)}`,...definition};
}
