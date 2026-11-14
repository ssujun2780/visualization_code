// Presentation of observed storage. Never resolve a pointer by comparing its
// numeric address with the final object ledger: identity comes from the trace.
import {storageRoot} from '../../scripts/shared/storage-alias.mjs';
const aliasIndexes=new WeakMap();

// Copy the current observed overlap, not the final ledger. Source-language
// lifetimes remain independent; old checkpoint containers are never mutated.
export function synchronizeAliases(recording,state,event){
  const id=event.target?.objectId??event.objectId,source=state.objects.get(id);
  if(!source)return;
  const get=id=>recording.objects.get(id);
  let index=aliasIndexes.get(recording);
  if(!index){
    const roots=new Map(),groups=new Map();
    for(const object of recording.objects.values()){
      const root=storageRoot(get,object.id);if(!root)continue;roots.set(object.id,root);
      const list=groups.get(root.object.id)??[];list.push(object.id);groups.set(root.object.id,list);
    }
    index={roots,groups};aliasIndexes.set(recording,index);
  }
  const root=index.roots.get(id),members=root&&index.groups.get(root.object.id);if(!root||members.length<2)return;
  if(event.action==='object.begin'&&get(id)?.storageAlias){
    const parent=state.objects.get(get(id).storageAlias.objectId);
    if(parent)copy(parent,source,get(id).storageAlias.offset,0,source.size,true);
    return;
  }
  const start=event.target?.offset??0,size=event.target?.size??source.size;
  for(const member of members){
    const target=state.objects.get(member);if(!target||target===source||!target.alive)continue;
    const other=index.roots.get(target.id);
    if(!other||other.object.id!==root.object.id)continue;
    const lo=Math.max(root.offset+start,other.offset),hi=Math.min(root.offset+start+size,other.offset+target.size);
    if(lo<hi)copy(source,target,lo-root.offset,lo-other.offset,hi-lo,event.kind==='WRITE');
  }
  function copy(from,to,start,dest,size,overwrite){
    const end=start+size;
    if(overwrite){
      for(const [key,c]of to.cells)if(c.offset<dest+size&&c.offset+c.size>dest)to.cells.delete(key);
      to.value=null;to.initialized=false;
      const ranges=[];
      for(const r of from.regions??[]){
        const lo=Math.max(start,r.offset),hi=Math.min(end,r.offset+r.length);if(lo>=hi)continue;
        ranges.push({...r,offset:dest+lo-start,length:hi-lo,
          ...(r.data?{data:r.data.bytesHex?{...r.data,bytesHex:r.data.bytesHex.slice((lo-r.offset)*2,(hi-r.offset)*2)}:{...r.data}}:{})});
      }
      to.regions=[...(to.regions??[]),...ranges];
    }
    for(const c of from.cells.values())if(c.offset>=start&&c.offset+c.size<=end){
      const offset=dest+c.offset-start;to.cells.set(offset,{...c,offset});to.observedOffsets.add(offset);
      if(offset===0&&c.size===to.size){to.value=c.value;to.initialized=true;}
    }
  }
}
export const cellId = (objectId, offset = 0) => `${objectId}@${offset}`;
export const aggregate = object => {
  const type=object.cType??object.viewType;
  return type?['array','record'].includes(type.kind):object.cells?.size>1||[...(object.cells?.values()??[])].some(c=>c.offset!==0||c.size!==object.size);
};
const bytes = type => Math.max(1, Math.ceil((type?.sizeBits ?? 8) / 8));

export function typeResolver(plan) {
  const index = new Map((plan.types ?? []).map(t => [t.id, t]));
  const cache = new Map();
  const resolve = id => {
    if (typeof id === 'object') return id;
    if (cache.has(id)) return cache.get(id);
    const t = index.get(id);
    if (!t) return null;
    const result = {...t}; cache.set(id, result);
    if (t.tag === 'DW_TAG_pointer_type') Object.assign(result, {kind: 'pointer', name: 'pointer', pointee: resolve(t.baseType)});
    else if (t.tag === 'DW_TAG_structure_type' || t.tag === 'DW_TAG_union_type') Object.assign(result, {kind: 'record', members: (t.elements ?? []).map(key => index.get(key)).filter(Boolean).map(m => ({name: m.name, typeId: m.baseType, offsetBits: m.offsetBits, sizeBits: m.sizeBits}))});
    else if (t.tag === 'DW_TAG_array_type') {
      const dimensions=t.dimensions?.length?t.dimensions:(t.elements??[]).map(key=>index.get(key)?.count).filter(Number.isFinite);
      let element=resolve(t.baseType);
      for(const count of [...dimensions].reverse())if(Number.isFinite(count))element={kind:'array',elementType:element,count,sizeBits:bytes(element)*8*count};
      Object.assign(result,dimensions.length?element:{kind:'array',elementType:element,count:1});
    } else if (t.baseType) Object.assign(result, resolve(t.baseType), {id: t.id, name: t.name ?? resolve(t.baseType)?.name});
    return result;
  };
  return resolve;
}

function describe(type, offset, resolve, path = '', base = 0, depth = 0, ancestors = []) {
  if (!type || depth > 12) return {offset, size: 1, path: path || `+${offset}`, cType: null};
  if (type.kind === 'array' && type.elementType) {
    const stride = bytes(type.elementType), i = Math.floor((offset - base) / stride);
    return describe(type.elementType, offset, resolve, `${path}[${i}]`, base + i * stride, depth + 1,
      [...ancestors, {path, offset: base, size: bytes(type), cType: type}]);
  }
  if (type.kind === 'record') {
    const member = type.members?.find(m => offset >= base + m.offsetBits / 8 && offset < base + (m.offsetBits + m.sizeBits) / 8);
    if (member) return describe(resolve(member.typeId), offset, resolve, `${path}.${member.name}`, base + member.offsetBits / 8, depth + 1,
      [...ancestors, {path, offset: base, size: bytes(type), cType: type}]);
    const next = Math.min(base + bytes(type), ...(type.members ?? []).map(m => base + m.offsetBits / 8).filter(start => start > offset));
    return {offset, size: Math.max(1, next - offset), path: `${path}.+${offset - base}`, cType: {kind: 'padding'},
      ancestors: [...ancestors, {path, offset: base, size: bytes(type), cType: type}]};
  }
  return {offset: base, size: bytes(type), path, cType: type, ancestors};
}

function decode(object, spec) {
  const data = new Uint8Array(spec.size), known = new Uint8Array(spec.size);
  for (const region of object.regions ?? []) for (let i = Math.max(spec.offset, region.offset); i < Math.min(spec.offset + spec.size, region.offset + region.length); i++) {
    const at = i - spec.offset, local = i - region.offset;
    known[at] = region.initialization === 'initialized' && (region.data?.encoding === 'fill' || typeof region.data?.bytesHex === 'string' && local * 2 + 2 <= region.data.bytesHex.length) ? 1 : 0;
    if (known[at]) data[at] = region.data.encoding === 'fill' ? region.data.byte : parseInt(region.data.bytesHex.slice(local * 2, local * 2 + 2), 16);
  }
  if (!known.every(Boolean)) return null;
  const hex = Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
  const bitValue = BigInt(`0x${Array.from(data).reverse().map(byte => byte.toString(16).padStart(2, '0')).join('') || '0'}`);
  const value = {bytesHex: hex, cType: spec.cType};
  if (spec.cType?.kind === 'pointer') return {...value, address: `0x${bitValue.toString(16).padStart(spec.size * 2, '0')}`, ...(bitValue === 0n ? {reference: {status: 'null', targetObjectId: null}} : {})};
  if (spec.cType?.encoding === 'DW_ATE_float' && [4, 8].includes(spec.size)) value.number = String(new DataView(data.buffer)[spec.size === 4 ? 'getFloat32' : 'getFloat64'](0, true));
  else value.decimal = String(spec.cType?.signedness === 'unsigned' || /unsigned/.test(spec.cType?.encoding ?? '') ? bitValue : BigInt.asIntN(spec.size * 8, bitValue));
  return value;
}

function addRegions(object, snapshot, offset = 0) {
  for (const range of snapshot?.ranges ?? []) object.regions.push({...range, offset: offset + range.offset});
}

export function beginMemory(source, event, previous) {
  const object = {id: source.id, name: source.name ?? source.id, cType: source.cType, size: source.size, frameId: source.frameId, storage: source.storage,
    address: event.address, alive: true, value: null, initialized: event.initialized === true, cells: new Map(), regions: [], observedOffsets: new Set(), exposedOffsets: new Set()};
  addRegions(object, event.memoryState);
  if(previous&&event.copiedFrom) {
    const retained=event.copiedFrom.size,offset=event.copiedFrom.offset??0;
    const type=previous.cType??previous.viewType;
    if(!object.cType&&type) {
      const element=type.kind==='array'?type.elementType:type,stride=bytes(element),count=Math.floor(object.size/stride);
      object.viewType=count>1?{kind:'array',name:`${element.name}[${count}]`,elementType:element,count,sizeBits:object.size*8}:element;
    }
    for(const cell of previous.cells?.values()??[])if(cell.offset>=offset&&cell.offset+cell.size<=offset+retained) {
      const at=cell.offset-offset;object.cells.set(at,{...cell,offset:at});object.observedOffsets.add(at);
    }
  }
  return object;
}

export function hydrateMemory(recording, state, event) {
  const object = state.objects.get(event.objectId ?? event.target?.objectId);
  if (object) {
    const type = object.cType ?? object.viewType, offsets = new Set();
    if (type?.kind === 'pointer') offsets.add(0);
    // Inspect only recorded nonzero bytes, not millions of untouched zeroed
    // array slots. Compiler types distinguish pointer bytes from integer data.
    const ranges = event.memoryState?.ranges ?? [];
    for (const range of ranges) if (range.data?.bytesHex) {
      for (let byte = 0; byte < range.data.bytesHex.length / 2; byte++) if (range.data.bytesHex.slice(byte * 2, byte * 2 + 2) !== '00') {
        const spec = describe(type, (event.target?.offset ?? 0) + range.offset + byte, recording.resolveType);
        if (spec.cType?.kind === 'pointer') offsets.add(spec.offset);
      }
    }
    for (const offset of offsets) if (!object.cells.has(offset)) {
      const spec = describe(type, offset, recording.resolveType), value = decode(object, spec);
      if (value) { object.cells.set(offset, {...spec, value}); object.observedOffsets.add(offset); }
    }
    if (!aggregate(object) && !object.value && type) {
      object.value = decode(object, {offset: 0, size: object.size, cType: type});
      if(object.value)object.initialized=true;
    }
  }
  // Resolve typed pointer bytes against allocation addresses observed SO FAR.
  // Never consult final bytes or final references. An established identity is
  // retained when its address is later reused by a different allocation.
  const known = [...state.objects.values()].filter(o => o.alive && o.address).map(o => ({object: o, address: BigInt(o.address)}));
  for (const source of state.objects.values()) if (source.alive) for (const cell of source.cells.values()) {
    const value = cell.value;
    if (cell.cType?.kind !== 'pointer' || !value?.address || value.reference?.targetObjectId || value.reference?.status === 'null') continue;
    const address = BigInt(value.address);
    if (address === 0n) {
      const resolved = {...value, reference: {status: 'null', targetObjectId: null}};
      source.cells.set(cell.offset, {...cell, value: resolved});
      if (cell.offset === 0 && cell.size === source.size) source.value = resolved;
      continue;
    }
    const destination = known.find(k => address >= k.address && address < k.address + BigInt(k.object.size))
      ?? known.find(k => address === k.address + BigInt(k.object.size));
    if (destination) {
      const reference = {targetObjectId: destination.object.id, targetOffset: Number(address - destination.address),
        onePast: address === destination.address + BigInt(destination.object.size), status: address === destination.address + BigInt(destination.object.size) ? 'one-past' : 'in-bounds', evidence: 'typed snapshot and observed allocation address'};
      const resolved = {...value, reference}; source.cells.set(cell.offset, {...cell, value: resolved});
      if (cell.offset === 0 && cell.size === source.size) source.value = resolved;
      if (!reference.onePast) destination.object.exposedOffsets.add(reference.targetOffset);
    }
  }
}

export function observeMemory(recording, state, event) {
  const target = event.target, object = state.objects.get(target?.objectId);
  if (!object) return;
  object.regions = [...object.regions];
  const start = target.offset ?? 0, size = target.size ?? object.size;
  const sourceOffset = event.sourceOffset ?? 0;
  const copied = event.kind === 'WRITE' && event.sourceObjectId ? [...(state.objects.get(event.sourceObjectId)?.cells?.values() ?? [])]
    .filter(c => c.offset >= sourceOffset && c.offset + c.size <= sourceOffset + size)
    .map(c => ({...c, offset: start + c.offset - sourceOffset})) : [];
  if (event.kind === 'WRITE') {
    // A byte/range effect can overwrite a previously displayed scalar. Its
    // old cached value is no longer valid, even if the IR has no scalar value.
    if(size>0&&!aggregate(object)){object.value=null;object.initialized=false;}
    // Any overlapping byte write invalidates the prior pointer identity, even
    // when the new bytes happen to equal the old pointer representation.
    for (const [key, cell] of object.cells) if (cell.offset < start + size && cell.offset + cell.size > start) object.cells.delete(key);
    addRegions(object, event.memoryState, start);
    if (event.value?.bytesHex) object.regions.push({offset: start, length: size, initialization: 'initialized', data: {encoding: 'hex', bytesHex: event.value.bytesHex}});
    else if (!event.memoryState) object.regions.push({offset: start, length: size, initialization: 'unobserved'});
    for (const cell of copied) { object.cells.set(cell.offset, cell); object.observedOffsets.add(cell.offset); }
  }
  if (event.value && !['array', 'record'].includes(event.value.cType?.kind) && (event.kind === 'WRITE' || !object.cells.has(start))) {
    object.cells.set(start, {offset: start, size, value: event.value, cType: event.value.cType, observedAt: event.eventId});
    object.observedOffsets.add(start);
  }
  if (start === 0 && size === object.size && event.value) {
    object.value = event.value;
    object.initialized = true;
  }
  // A recorded typed pointer may provide a view of previously untyped malloc
  // storage. This is a view, not a new allocation or structure inference.
  for (const cell of object.cells.values()) {
    const ref = cell.value?.reference, pointee = cell.cType?.pointee;
    const destination = state.objects.get(ref?.targetObjectId);
    if (destination && ref.targetOffset >= 0 && ref.targetOffset < destination.size) destination.exposedOffsets.add(ref.targetOffset);
    if (destination && !destination.cType && !destination.viewType && ref.targetOffset === 0 && pointee?.sizeBits > 0) {
      const stride = bytes(pointee), count = Math.floor(destination.size / stride);
      destination.viewType = count > 1 ? {kind: 'array', name: `${pointee.name}[${count}]`, count, sizeBits: destination.size * 8, elementType: pointee} : pointee;
    }
  }
}

export function memoryPresentation(recording, objects, {previewWindows=[]}={}) {
  const exposed = new Map();
  for (const object of objects.values()) if (object.alive) for (const cell of object.cells?.values() ?? []) {
    const ref = cell.value?.reference;
    if (ref?.targetObjectId && ref.targetOffset >= 0 && !ref.onePast) {
      if (!exposed.has(ref.targetObjectId)) exposed.set(ref.targetObjectId, new Set());
      exposed.get(ref.targetObjectId).add(ref.targetOffset);
    }
  }
  const view = new Map();
  for (const object of objects.values()) {
    if (!aggregate(object)) { view.set(object.id, object); continue; }
    const type = object.cType ?? object.viewType, specs = new Map();
    const add = offset => {
      if (offset < 0 || offset >= object.size) return;
      const spec = describe(type, offset, recording.resolveType);
      const observed = object.cells?.get(offset);
      if (spec.cType?.kind === 'padding' && !observed) return;
      const actual = observed ? {...spec, ...observed, path: spec.path || `+${offset}`} : spec;
      // Accesses to raw heap storage may have a finer type than its current view.
      specs.set(actual.offset, actual);
    };
    // A compact preview, plus EVERY observed/referenced cell. Large untouched
    // arrays are never expanded just because their declared count is large.
    for (let offset = 0, count = 0; offset < object.size && count < 12; count++) {
      const spec = describe(type, offset, recording.resolveType); add(offset); offset = Math.max(offset + 1, spec.offset + spec.size);
    }
    // A viewer-owned drawer can request more CURRENT cells. Decode only the
    // bytes already recorded at this boundary; never read the final ledger.
    let remaining=2048;
    for(const window of previewWindows)if(window.objectId===object.id){
      const end=window.root?object.size:Math.min(object.size,window.offset+window.size),limit=Math.min(remaining,window.capacity);
      for(let offset=window.offset,count=0;offset<end&&count<limit;count++,remaining--){
        const spec=describe(type,offset,recording.resolveType);add(offset);offset=Math.max(offset+1,spec.offset+spec.size);
      }
    }
    for (const offset of object.observedOffsets ?? []) add(offset);
    for (const offset of object.exposedOffsets ?? []) add(offset);
    for (const offset of exposed.get(object.id) ?? []) add(offset);
    const renderCells = [...specs.values()].map((spec, slot) => ({...spec, slot,
      id: cellId(object.id, spec.offset), objectId: object.id, value: spec.value ?? decode(object, spec)}));
    let stringPreview;
    if(type?.kind==='array'&&bytes(type.elementType)===1&&/char/.test(type.elementType?.encoding??'')) {
      const chars=[];
      for(let offset=0;offset<Math.min(object.size,128);offset++) {
        const value=decode(object,{offset,size:1,cType:type.elementType});if(!value)break;
        const byte=Number(BigInt(value.decimal)&255n);
        if(byte===0){stringPreview=JSON.stringify(new TextDecoder().decode(Uint8Array.from(chars)));break;}
        chars.push(byte);
      }
    }
    view.set(object.id, {...object, renderCells, ...(stringPreview===undefined?{}:{stringPreview})});
  }
  return view;
}

export function referenceEdges(state) {
  const edges = [];
  for (const object of state.objects.values()) if (object.alive) {
    for (const cell of object.cells?.values() ?? (object.value ? [{offset: 0, size: object.size, value: object.value}] : [])) {
      const ref = cell.value?.reference;
      if (!ref?.targetObjectId) continue;
      const destination = state.objects.get(ref.targetObjectId);
      edges.push({id: cellId(object.id, cell.offset), sourceObjectId: object.id, sourceOffset: cell.offset,
        targetObjectId: ref.targetObjectId, targetOffset: ref.targetOffset, status: !destination?.alive ? 'dangling' : ref.status,
        targetKind: cell.cType?.pointee?.kind, targetSize: cell.cType?.pointee?.sizeBits / 8,
        onePast: ref.onePast === true});
    }
  }
  return edges;
}
