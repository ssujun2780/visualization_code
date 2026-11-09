// Match compiler field identity and lowered storage work. No source evaluation.
const opOf=n=>/ '(\+\+|--|[+*/%&|^<>=!-]+)'(?:\s|$)/.exec(n?.details??'')?.[1];
const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr'].includes(n.kind))n=n.children[0];return n;};
const field=n=>n?.kind==='MemberExpr'&&/\bbitfield\b/.test(n.details);
const mutation=n=>n.kind==='CompoundAssignOperator'||n.kind==='BinaryOperator'&&opOf(n)==='='||n.kind==='UnaryOperator'&&['++','--'].includes(opOf(n));
const codes={'+':['add','fadd'],'-':['sub','fsub'],'*':['mul','fmul'],'/':['sdiv','udiv'],'%':['srem','urem'],
  '&':['and'],'|':['or'],'^':['xor'],'<<':['shl'],'>>':['ashr','lshr'],'++':['add'],'--':['sub']};
export function bitfieldBindings(observations,{nearest,source,types,abi,paths=new Map()}){
  const accesses=new Map(),hidden=new Set(),gaps=[],producers=new Map(),preserving=new Set(),actual=new Set(),extractions=new Map();
  const key=(o,v)=>`${o.functionId}:${v}`;
  for(const o of observations.instructions)if(o.result)producers.set(key(o,o.result),o);
  const initializerAccesses=new Map();
  function storage(o,value,seen=new Set()){
    if(seen.has(value))return null;seen.add(value);
    const known=paths.get(key(o,value));if(known?.cType?.kind==='record')return {base:known,offset:0};
    const p=producers.get(key(o,value));if(p?.opcode==='bitcast')return storage(o,p.inputs[0].value,seen);
    if(p?.action!=='address'||!abi)return null;
    const parent=storage(o,p.pointer.value,seen);if(!parent)return null;
    let backend=p.baseType,offset=parent.offset;
    for(const [i,input]of p.inputs.slice(1).entries()){
      if(!/^-?\d+$/.test(input.value))return null;const index=Number(input.value),layout=abi.layout(backend);
      if(i===0)offset+=index*layout.size;
      else if(layout.fields){const f=layout.fields[index];if(!f)return null;offset+=f.offset;backend=f.type;}
      else if(layout.elementType){backend=layout.elementType;offset+=index*abi.layout(backend).size;}
      else return null;
    }
    return {...parent,offset};
  }
  // Aggregate initialization has no MemberExpr. The preserved-bit mask and
  // actual destination path identify the compiler field, even with padding,
  // nested records or several fields sharing a debug location.
  for(const store of observations.instructions.filter(o=>o.action==='store')){
    const storagePath=storage(store,store.pointer.value),base=storagePath?.base,init=base&&nearest(store,n=>n.kind==='InitListExpr'&&
      types.spelling(n.type,n.canonical)?.recordTypeId===base.cType?.recordTypeId);
    if(!init||base.cType?.kind!=='record')continue;
    const bits=Number(/^i(\d+)$/.exec(store.type)?.[1]);if(!(bits>0&&bits<=64))continue;
    const pending=[store.inputs[0]],visited=new Set(),matches=[];
    while(pending.length){const input=pending.pop();if(!input||visited.has(input.value))continue;visited.add(input.value);
      const p=producers.get(key(store,input.value));if(!p)continue;
      if(p.opcode==='and')for(let index=0;index<2;index++){
        const load=producers.get(key(store,p.inputs[index]?.value)),constant=p.inputs[1-index]?.value;
        if(load?.action!=='load'||load.pointer.value!==store.pointer.value||! /^-?\d+$/.test(constant??''))continue;
        const changed=BigInt.asUintN(bits,~BigInt(constant));
        for(const [memberIndex,m]of base.cType.members.entries())if(m.bitField&&m.sizeBits>0&&m.sizeBits<=bits){
          const shift=m.offsetBits-m.storageOffsetBits;
          if(m.storageOffsetBits!==storagePath.offset*8||shift<0||shift+m.sizeBits>bits||changed!==((1n<<BigInt(m.sizeBits))-1n)<<BigInt(shift))continue;
          matches.push({load,mask:p,m,memberIndex,shift});
        }
      }
      if(['and','or','shl','trunc','zext','sext'].includes(p.opcode))pending.push(...p.inputs);
    }
    if(matches.length!==1)continue;
    const {load,mask,m,memberIndex,shift}=matches[0],child=init.children[memberIndex],part={kind:'member',name:m.name,index:memberIndex,
      offsetBits:m.offsetBits,sizeBits:m.sizeBits,typeId:m.typeId,bitField:true,storageOffsetBits:m.storageOffsetBits},path=[...base.path,part],
      info={node:child?.source?child:init,initializer:child?.source?child:init,owner:null,direct:false,
        memberPath:path.filter(p=>p.kind==='member').map(p=>p.name),targetPath:path,cType:types.debug(m.typeId),
        width:m.sizeBits,offsetBits:m.offsetBits,storageOffsetBits:m.storageOffsetBits,shift,evidence:'compiler initializer destination and preserved-bit mask'};
    if(!info.cType)continue;
    for(const o of [store,load,mask])initializerAccesses.set(o.id,info);
    const childNodes=new Set(),visit=n=>{if(n){childNodes.add(n.id);for(const c of n.children??[])visit(c);}};visit(child);
    const chain=[store.inputs[0]],seen=new Set();while(chain.length){const v=chain.pop();if(!v||seen.has(v.value))continue;seen.add(v.value);
      const p=producers.get(key(store,v.value));if(!p||p===load||!['or','and','shl','trunc','zext','sext'].includes(p.opcode))continue;
      // Stop at the user's RHS operator. Only compiler packing operations
      // outside that expression belong to the field WRITE.
      if(nearest(p,n=>childNodes.has(n.id)&&(codes[opOf(n)]??[]).includes(p.opcode)))continue;
      initializerAccesses.set(p.id,info);chain.push(...p.inputs);}
  }
  function locate(o){
    if(initializerAccesses.has(o.id))return initializerAccesses.get(o.id);
    const direct=nearest(o,field),owner=nearest(o,n=>mutation(n)&&field(unwrap(n.children[0]))),node=direct??unwrap(owner?.children[0]);
    if(!node)return null;
    const rhs=owner?.children[1]?.source,p=o.source,order=(a,b)=>a.line-b.line||a.column-b.column;
    if(!direct&&o.kind==='CALC'&&rhs&&p&&order(rhs.start,p)<=0&&order(p,rhs.end)<=0)return null;
    const path=source.access(node),part=path?.path.at(-1);if(!part?.bitField)return null;
    return {node,owner,direct,memberPath:path.path.filter(p=>p.kind==='member').map(p=>p.name),targetPath:path.path,
      cType:part.cType,width:part.sizeBits,offsetBits:part.offsetBits,storageOffsetBits:part.storageOffsetBits,
      shift:part.offsetBits-part.storageOffsetBits,evidence:'compiler FieldDecl + DWARF bit-field layout'};
  }
  for(const o of observations.instructions.filter(o=>['load','store'].includes(o.action))){
    const info=locate(o);if(!info)continue;
    const bits=Number(/^i(\d+)$/.exec(o.type)?.[1]);
    if(!(bits>0&&bits<=64&&info.width>0&&info.shift>=0&&info.shift+info.width<=bits)){
      gaps.push({observationId:o.id,nodeId:info.node.id,reason:'bit-field storage layout not matched'});continue;
    }
    const role=o.action==='store'?'write':info.direct?'read':'preserve',spec={...info,storageBits:bits,role};
    accesses.set(o.id,spec);o.bitfield={width:info.width,shift:info.shift,role};
    if(role==='preserve'){hidden.add(o.id);preserving.add(o.result&&key(o,o.result));}
  }
  const dependsOnPreserve=(o,input,seen=new Set())=>{
    if(!input||seen.has(input.value))return false;seen.add(input.value);
    if(preserving.has(key(o,input.value)))return true;
    const p=producers.get(key(o,input.value));return p&&p.inputs?.some(i=>dependsOnPreserve(o,i,seen));
  };
  for(const o of observations.instructions.filter(o=>o.kind==='CALC')){
    const info=locate(o);if(!info)continue;
    if(o.opcode==='bitcast'&&o.type.endsWith('*')){hidden.add(o.id);continue;}
    if(o.conversion)continue; // Keep actual C value conversions.
    if(info.initializer){hidden.add(o.id);continue;}
    if(info.direct&&['and','shl','ashr','lshr','trunc','zext','sext'].includes(o.opcode)){
      const p=producers.get(key(o,o.inputs?.[0]?.value)),load=accesses.get(p?.id);
      if(load?.role==='read'&&load.node.id===info.node.id||extractions.get(p?.id)===info.node.id){hidden.add(o.id);extractions.set(o.id,info.node.id);}
      continue;
    }
    if(!info.owner)continue;
    const root=opOf(info.owner),code=root?.endsWith('=')?root.slice(0,-1):root;
    const identity=`${o.functionId}:${info.owner.id}`;
    // The first real source operator is retained. Later masking/merging of
    // its value into a storage unit is implementation work of the WRITE.
    if(root!=='='&&(codes[code]??[]).includes(o.opcode)&&!dependsOnPreserve(o,o.inputs?.[0])&&!actual.has(identity)){
      actual.add(identity);continue;
    }
    if(['and','or','shl','lshr','ashr','trunc','zext','sext'].includes(o.opcode))hidden.add(o.id);
  }
  for(const [id,info]of accesses){
    if(info.role!=='write')continue;
    const o=observations.instructions.find(o=>o.id===id);let input=o.inputs[0];const seen=new Set();
    while(input&&!seen.has(input.value)){
      seen.add(input.value);const p=producers.get(key(o,input.value));if(!p||!hidden.has(p.id))break;
      if(p.opcode==='or'){
        const pure=p.inputs.filter(i=>!dependsOnPreserve(o,i));if(pure.length!==1)break;input=pure[0];
      }else if(p.opcode==='and'&&dependsOnPreserve(o,p.inputs[0])){
        input={type:`i${info.cType.sizeBits}`,value:'0'};break;
      }else input=p.inputs?.[0];
    }
    const rhs=info.initializer??(info.owner?.kind==='BinaryOperator'&&opOf(info.owner)==='='?info.owner.children[1]:null),literal=unwrap(rhs),
      text=literal?.kind==='IntegerLiteral'?/ (-?\d+)\s*$/.exec(literal.details)?.[1]:null;
    // Clang may fold field insertion into a shifted literal. A compiler AST
    // literal retains the source input before that storage encoding/truncation.
    info.valueOperand=text!==null&&text!==undefined&&types.spelling(rhs.type,rhs.canonical)?.signedness?{type:`i${types.spelling(rhs.type,rhs.canonical)?.sizeBits??32}`,
      value:text,cType:types.spelling(rhs.type,rhs.canonical),nodeId:rhs.id}:input??null;
  }
  return {accesses,hidden,gaps};
}

// Sparse bit intervals: storage-size independent, and distinct from byte writes.
export function bitSegments(ranges,start,size){
  const end=start+size,result=[];let at=start;
  for(const r of ranges??[]){if(r.end<=start||r.start>=end)continue;
    if(at<r.start)result.push({start:at,end:Math.min(r.start,end),writer:null});
    result.push({start:Math.max(start,r.start),end:Math.min(end,r.end),writer:r.writer});at=Math.min(end,r.end);
  }
  if(at<end)result.push({start:at,end,writer:null});return result;
}
export function markBits(ranges,start,size,writer){
  const end=start+size,result=[];
  for(const r of ranges??[]){if(r.end<=start||r.start>=end)result.push(r);else{
    if(r.start<start)result.push({...r,end:start});if(r.end>end)result.push({...r,start:end});}}
  if(size)result.push({start,end,writer});return result.sort((a,b)=>a.start-b.start);
}
export function bitfieldValue(value,spec){
  if(!value?.bits)return value;
  const raw=(BigInt(value.bits)>>BigInt(spec.shift))&((1n<<BigInt(spec.width))-1n),
    mathematical=spec.cType.signedness==='signed'?BigInt.asIntN(spec.width,raw):raw,
    bits=BigInt.asUintN(spec.cType.sizeBits,mathematical);
  return {type:`i${spec.cType.sizeBits}`,bits:`0x${bits.toString(16).padStart(Math.ceil(spec.cType.sizeBits/4),'0')}`,
    unsigned:bits.toString(),signed:BigInt.asIntN(spec.cType.sizeBits,bits).toString(),decimal:mathematical.toString(),
    cType:spec.cType,evidence:'observed storage bits decoded with compiler field layout'};
}
