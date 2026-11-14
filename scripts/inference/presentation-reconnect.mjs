// Reconnect user settings, never execution objects or automatic candidates.
import {relationTypes,defineStructureRelation} from './relation-binding.mjs';
import {defineStructureConditionRules} from './user-conditions.mjs';
import {structureRootRange} from './structure-storage.mjs';
import {inferredArrayAnchor,inferredRoleCatalog,inferredRoleReferences} from './inferred-role-anchors.mjs';
import {semanticCandidateAnchor} from './candidate-anchors.mjs';
const clone=x=>structuredClone(x), json=x=>JSON.stringify(x);
const complete=e=>e&&(!e.phase||e.phase==='complete');
const scope=t=>({programId:t.programId,runId:t.runId});
const same=(a,b)=>a?.programId===b?.programId&&a?.runId===b?.runId;
const key=(target,slot)=>json([slot,target]);
const fail=(code,details={})=>{throw Object.assign(new Error(code),{diagnostic:{code,...details}});};
const compilerLayout=plan=>json((plan.types??[]).map(t=>[t.kind,t.tag??null,t.name??null,t.sizeBits,t.offsetBits,t.encoding??null,t.source??null]).map(json).sort());
function visit(value,fn,path=[]){
  if(!value||typeof value!=='object')return;
  fn(value,path);for(const [k,v]of Object.entries(value))visit(v,fn,[...path,k]);
}
function position(trace,id){
  if(id===undefined)return trace.events.length-1;
  const at=trace.events.findIndex(e=>e.eventId===id);if(at<0)throw new RangeError('관측한 실행 식별자가 필요합니다.');return at;
}
function context(trace,plan,at){
  const objects=new Map(trace.objects.map(o=>[o.id,o])),events=new Map(trace.events.map(e=>[e.eventId,e])),
    positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),instructions=new Map((plan?.instructions??[]).map(i=>[i.id,i]));
  const occurred=id=>positions.has(id)&&positions.get(id)<=at;
  // copiedFrom alone also describes ordinary copies. Require an observed heap
  // replacement ending the OLD lifetime; numeric address equality is irrelevant.
  const successors=new Map(),predecessors=new Map();
  for(const e of trace.events){
    const old=objects.get(e.copiedFrom?.objectId),next=objects.get(e.objectId),end=events.get(old?.endedBy);
    if(!complete(e)||e.kind!=='SPACE'||e.action!=='object.begin'||!old||!next||old.storage!=='heap'||next.storage!=='heap'||
      !complete(end)||end.reason!=='realloc-replaced'||positions.get(end.eventId)>positions.get(e.eventId)||
      e.copiedFrom.offset!==0||e.copiedFrom.size!==Math.min(old.size,next.size))continue;
    // Public end/begin events originate from the same allocation site/activation.
    const a=instructions.get(end.instructionId),b=instructions.get(e.instructionId);
    const sameCall=end.callExecutionId&&end.callExecutionId===e.callExecutionId;
    const sameSite=a?.sourceNodeId&&a.sourceNodeId===b?.sourceNodeId&&end.activationId===e.activationId;
    const adjacent=positions.get(e.eventId)===positions.get(end.eventId)+1&&end.activationId===e.activationId;
    if(!sameCall&&!sameSite&&!adjacent)continue;
    const list=successors.get(old.id)??[];list.push({objectId:next.id,eventId:e.eventId,retainedBytes:e.copiedFrom.size});successors.set(old.id,list);
    predecessors.set(next.id,old.id);
  }
  function origin(id){const seen=new Set();while(predecessors.has(id)){if(seen.has(id))fail('reallocation-cycle');seen.add(id);id=predecessors.get(id);}return id;}
  function follow(id){
    id=origin(id);
    const evidence=[],seen=new Set();
    while(true){if(seen.has(id))fail('reallocation-cycle');seen.add(id);
      const next=(successors.get(id)??[]).filter(n=>occurred(n.eventId));
      if(next.length>1)fail('ambiguous-reallocation',{objectId:id,candidates:next.map(n=>n.objectId)});
      if(!next.length)break;evidence.push(next[0]);id=next[0].objectId;
    }
    const o=objects.get(id);if(!o)fail('missing-object',{objectId:id});
    // There may be an event boundary between object.end and object.begin. Do
    // not use the future replacement to fill that boundary.
    if(occurred(o.endedBy)&&events.get(o.endedBy)?.reason==='realloc-replaced')fail('replacement-not-observed',{objectId:id});
    return {id,evidence};
  }
  return {trace,plan,objects,events,positions,instructions,occurred,origin,follow,at};
}
function source(s,plan){
  if(!s||!Number.isInteger(s.start?.byte)||!Number.isInteger(s.end?.byte))return null;
  return {file:s.file===plan?.source?.file?'$source':s.file,start:s.start.byte,end:s.end.byte};
}
function compilerIndex(ctx){
  const {plan,trace}=ctx,types=new Map((plan?.types??[]).map(t=>[t.id,t])),declarations=new Map((plan?.declarations??[]).map(d=>[d.id,d])),
    functions=new Map((plan?.functions??[]).map(f=>[f.id,f])),frames=new Map((trace.frames??[]).map(f=>[f.id,f])),calls=new Map(),active=new Map(),memo=new Map();
  for(const e of trace.events){if(!complete(e))continue;
    if(e.action==='call'){const list=active.get(e.activationId)??[];list.push(e);active.set(e.activationId,list);}
    if(e.action==='frame.begin'){const f=frames.get(e.frameId);if(f?.parent)calls.set(f.id,active.get(f.parent)?.at(-1));}
    if(e.action==='resume'){const list=active.get(e.activationId)??[];const i=list.findIndex(c=>c.eventId===e.callExecutionId);if(i>=0)list.splice(i,1);}
  }
  function rawType(id,stack=[]){
    const t=types.get(id);if(!t)return null;if(stack.includes(id))return {cycle:stack.indexOf(id)};
    const next=[...stack,id];return {kind:t.kind,tag:t.tag??null,name:t.name??null,bits:t.sizeBits,offset:t.offsetBits,
      encoding:t.encoding??null,source:t.source??null,base:t.baseType?rawType(t.baseType,next):null,elements:(t.elements??[]).map(k=>rawType(k,next))};
  }
  function type(t,depth=0){
    if(!t)return null;if(depth>32)fail('type-depth-limit');
    return {kind:t.kind??null,name:t.name??null,bits:t.sizeBits,signedness:t.signedness??null,encoding:t.encoding??null,count:t.count??null,
      element:t.elementType?type(t.elementType,depth+1):null,pointee:t.pointee?type(t.pointee,depth+1):null,
      record:t.recordTypeId?rawType(t.recordTypeId):null};
  }
  function frame(id,seen=new Set()){
    if(!id)return [];if(memo.has(id))return memo.get(id);if(seen.has(id)||seen.size>=128)return null;
    const f=frames.get(id),fn=functions.get(f?.functionId),site=source(fn?.source,plan);if(!site)return null;
    let result=[{function:site}];
    if(f.parent){const parent=frame(f.parent,new Set([...seen,id])),call=calls.get(id),callSite=source(ctx.instructions.get(call?.instructionId)?.source,plan);
      if(!parent||!callSite)return null;result=[...parent,{function:site,call:callSite}];}
    memo.set(id,result);return result;
  }
  function object(id){
    const o=ctx.objects.get(ctx.origin(id));if(!o)return null;
    const e=ctx.events.get(o.createdBy),i=ctx.instructions.get(e?.instructionId),d=declarations.get(i?.declarationId),site=source(d?.source??i?.source,plan),stack=frame(o.frameId??e?.activationId);
    if(!site||stack===null||!d&&o.storage!=='heap')return null;
    return {storage:o.storage,site,frame:stack,declarationKind:d?.kind??null,layout:type(d?.cType??o.cType),allocation:o.storage==='heap'?i?.callee??null:null};
  }
  const fields=new Map();for(const blueprint of plan?.typeBlueprints??[])for(const f of blueprint.fields??[]){
    const owner=source(blueprint.source,plan),declaration=source(f.source,plan);
    if(owner&&declaration&&f.cType)fields.set(f.nodeId,{owner,declaration,recordKind:blueprint.recordKind??null,layout:type(f.cType)});
  }
  return {object,type,rawType,fields,functions:new Map([...functions].map(([id,f])=>[id,source(f.source,plan)]))};
}
function payload(setting){return Object.fromEntries(['target','roleIds','relationBinding','conditionRules','conditionBindings'].filter(k=>setting[k]).map(k=>[k,clone(setting[k])]));}
function indexDomain(s,trace){
  if(!s)return null;
  const ids=s.kind==='coindexed-record-candidate'?(s.arrays??[]).map(a=>a.arrayId):[s.containerId??s.arrayId],
    storage=ids.map(id=>inferredArrayAnchor(trace.structures.find(a=>a.id===id),trace));
  if(!storage.length||storage.some(a=>!a))return null;
  return {kind:s.kind,storage:storage.sort((a,b)=>json(a).localeCompare(json(b)))};
}
function candidateDescriptor(s,trace,plan,seen=new Set(),occurred=()=>true){
  // Candidate IDs are ephemeral too. Arrays and exact root storage can anchor
  // a candidate. Multiple candidates on that storage remain ambiguous.
  if(!s||seen.has(s.id)||s.discoveredAtExecutionId&&!occurred(s.discoveredAtExecutionId)||
    s.inferredAtExecutionId&&!occurred(s.inferredAtExecutionId))return null;seen=new Set([...seen,s.id]);
  if(s.kind==='array'){const storage=inferredArrayAnchor(s,trace);return storage?{kind:s.kind,storage}:null;}
  const root=structureRootRange(s,trace);if(root){
    const domain=s.relationStructureId?indexDomain(trace.structures.find(x=>x.id===s.relationStructureId),trace):null;
    if(s.relationStructureId&&!domain)return null;
    return {kind:s.kind,range:root,rootKind:s.root.kind??null,...domain?{domain}:{},...(s.comparisonPolicy?{comparator:s.comparisonPolicy}:{}),
      ...(s.root.recordTypeId?{recordTypeId:s.root.recordTypeId}:{}),...(s.roleIds?{roleIds:[...s.roleIds].sort()}:{})};
  }
  if(s.kind==='storage-reference-graph')return {kind:s.kind,scope:'all-observed-storage'};
  if(s.kind==='ordered-tree-candidate'){
    const base=candidateDescriptor(trace.structures.find(x=>x.id===s.sourceStructureId),trace,plan,seen,occurred);return base?{kind:s.kind,base}:null;
  }
  return semanticCandidateAnchor(s,trace,plan,child=>candidateDescriptor(child,trace,plan,seen,occurred));
}

export function captureStructurePresentationAnchor(plan,trace,setting,{afterExecutionId}={}){
  if(plan?.programId!==trace.programId||!plan?.source?.sha256)throw new TypeError('같은 프로그램의 컴파일 계획과 소스 해시가 필요합니다.');
  const ctx=context(trace,plan,position(trace,afterExecutionId)),index=compilerIndex(ctx),objects={},records={},fields={},functions={},candidates={},roles={},data=payload(setting),
    catalog=inferredRoleCatalog(trace,{at:ctx.at}),wantedRoles=new Set(inferredRoleReferences(setting));
  function collect(v){
    for(const k of ['structureId','arrayId'])if(v[k]&&!candidates[v[k]]){
      const s=trace.structures?.find(s=>s.id===v[k]),descriptor=candidateDescriptor(s,trace,plan,new Set(),ctx.occurred);candidates[v[k]]=descriptor;
      if(descriptor)visit(descriptor,r=>{collect(r);for(const id of r.roleIds??[])wantedRoles.add(id);});
    }
    if(v.objectId)objects[v.objectId]=null;
    if(v.recordTypeId)records[v.recordTypeId]=null;
    if(v.fieldNodeId)fields[v.fieldNodeId]=null;
    if(v.functionId)functions[v.functionId]=null;
  }
  visit(data,collect);
  for(const id of wantedRoles){const found=catalog.get(id)??[];
    roles[id]=found.length===1?{status:'anchored',descriptor:clone(found[0])}:{status:found.length?'ambiguous':'unobserved'};
    if(found.length===1)visit(found[0],collect);
  }
  const all=new Map();for(const o of trace.objects){const base=ctx.origin(o.id);if(!all.has(base))all.set(base,index.object(base));}
  for(const id of Object.keys(objects)){
    const anchor=index.object(id),matches=anchor?[...all].filter(([,a])=>json(a)===json(anchor)).map(([id])=>id):[];
    objects[id]={anchor,unique:matches.length===1,size:ctx.objects.get(id)?.size??null};
  }
  for(const id of Object.keys(records))records[id]=index.rawType(id);
  for(const id of Object.keys(fields))fields[id]=index.fields.get(id)??null;
  for(const id of Object.keys(functions))functions[id]=index.functions.get(id)??null;
  return {schemaVersion:1,kind:'structure-presentation-anchor',sourceHash:plan.source.sha256,compilerLayout:compilerLayout(plan),scope:scope(trace),objects,records,fields,functions,roles,candidates};
}

function remap(setting,ctx,{rerun=false,anchor=setting.reconnectAnchor}={}){
  const data=payload(setting),mapping=new Map(),recordMapping=new Map(),fieldMapping=new Map(),functionMapping=new Map(),roleMapping=new Map(),candidateMapping=new Map(),evidence=[],index=rerun?compilerIndex(ctx):null,
    catalog=inferredRoleCatalog(ctx.trace,{at:ctx.at});
  if(rerun){
    if(!anchor||anchor.schemaVersion!==1||!ctx.plan?.source?.sha256)fail('compiler-anchor-missing');
    if(anchor.sourceHash!==ctx.plan.source.sha256)fail('source-changed');
    if(ctx.plan.programId!==ctx.trace.programId)fail('compiler-scope-mismatch');
    if(anchor.compilerLayout!==compilerLayout(ctx.plan))fail('compiler-layout-changed');
  }
  function object(id){
    if(mapping.has(id))return mapping.get(id);
    let dest=id;
    if(rerun){
      const saved=anchor.objects[id];if(!saved?.anchor)fail('object-anchor-missing',{objectId:id});
      if(!saved.unique)fail('ambiguous-source-object',{objectId:id});
      const matches=[...new Set(ctx.trace.objects.map(o=>ctx.origin(o.id)))].filter(k=>json(index.object(k))===json(saved.anchor));
      if(matches.length!==1)fail(matches.length?'ambiguous-object':'object-not-observed',{objectId:id,candidates:matches});
      dest=matches[0];
    }
    const moved=ctx.follow(dest);mapping.set(id,moved.id);evidence.push(...moved.evidence);return moved.id;
  }
  function record(id){
    if(!rerun)return id;if(recordMapping.has(id))return recordMapping.get(id);
    const saved=anchor.records[id];if(!saved)fail('record-anchor-missing',{recordTypeId:id});
    const matches=[...relationTypes(ctx.trace).keys()].filter(k=>json(index.rawType(k))===json(saved));
    if(matches.length!==1)fail(matches.length?'ambiguous-record':'record-not-observed',{recordTypeId:id,candidates:matches});
    recordMapping.set(id,matches[0]);return matches[0];
  }
  function field(id){
    if(!rerun)return id;if(fieldMapping.has(id))return fieldMapping.get(id);
    const saved=anchor.fields?.[id];if(!saved)fail('field-anchor-missing',{fieldNodeId:id});
    const matches=[...index.fields].filter(([,f])=>json(f)===json(saved)).map(([id])=>id);
    if(matches.length!==1)fail(matches.length?'ambiguous-field':'field-not-observed',{fieldNodeId:id,candidates:matches});
    fieldMapping.set(id,matches[0]);return matches[0];
  }
  function physical(value,{roles=false}={}){
    const result=clone(value);visit(result,v=>{
      if(v.kind==='array-storage'&&v.wholeAllocation)v.range.size=ctx.objects.get(object(v.range.objectId)).size;
      if(v.objectId){v.objectId=object(v.objectId);if(v.offset<0||v.offset+v.size>ctx.objects.get(v.objectId).size)fail('mapped-range-out-of-bounds',{objectId:v.objectId});}
      if(v.recordTypeId)v.recordTypeId=record(v.recordTypeId);
      if(v.fieldNodeId)v.fieldNodeId=field(v.fieldNodeId);
      if(v.functionId){
        const id=v.functionId;if(rerun&&!functionMapping.has(id)){
          const saved=anchor.functions?.[id];if(!saved)fail('function-anchor-missing',{functionId:id});
          const matches=[...index.functions].filter(([,f])=>json(f)===json(saved)).map(([id])=>id);
          if(matches.length!==1)fail(matches.length?'ambiguous-function':'function-not-observed',{functionId:id});functionMapping.set(id,matches[0]);
        }
        if(rerun)v.functionId=functionMapping.get(id);
      }
      if(roles&&v.roleIds)v.roleIds=v.roleIds.map(role).sort();
    });visit(result,v=>{if(v.domain?.storage)v.domain.storage.sort((a,b)=>json(a).localeCompare(json(b)));});return result;
  }
  function role(id){
    if(roleMapping.has(id))return roleMapping.get(id);
    const saved=anchor?.roles?.[id];if(!rerun&&!saved)return id;
    if(!saved)fail('inferred-role-anchor-missing',{roleId:id});
    if(saved.status!=='anchored'){
      if(!rerun)return id;
      fail(saved.status==='ambiguous'?'ambiguous-source-role':'source-role-not-observed',{roleId:id});
    }
    const expected=physical(saved.descriptor),matches=[...catalog].filter(([,descriptors])=>descriptors.length===1&&json(descriptors[0])===json(expected)).map(([id])=>id);
    if(matches.length!==1)fail(matches.length?'ambiguous-role':'role-not-observed',{roleId:id,candidates:matches});
    roleMapping.set(id,matches[0]);return matches[0];
  }
  function candidate(id){
    if(candidateMapping.has(id))return candidateMapping.get(id);
    const old=rerun?anchor.candidates[id]:anchor?.candidates?.[id]??candidateDescriptor(ctx.trace.structures?.find(s=>s.id===id),ctx.trace,ctx.plan);
    if(!old){if(!rerun)return id;fail('candidate-anchor-missing',{candidateId:id});}
    const expected=physical(old,{roles:true});
    if(!rerun&&json(expected)===json(old)){
      const current=candidateDescriptor(ctx.trace.structures?.find(s=>s.id===id),ctx.trace,ctx.plan,new Set(),ctx.occurred);
      if(json(current)!==json(expected))fail('candidate-not-observed',{candidateId:id});return id;
    }
    const matches=(ctx.trace.structures??[]).filter(s=>(!s.discoveredAtExecutionId||ctx.occurred(s.discoveredAtExecutionId))&&
      (!s.inferredAtExecutionId||ctx.occurred(s.inferredAtExecutionId))&&json(candidateDescriptor(s,ctx.trace,ctx.plan,new Set(),ctx.occurred))===json(expected));
    if(matches.length!==1)fail(matches.length?'ambiguous-candidate':'candidate-not-observed',{candidateId:id,candidates:matches.map(s=>s.id)});
    candidateMapping.set(id,matches[0].id);return matches[0].id;
  }
  visit(data,(v,path)=>{
    for(const k of ['structureId','arrayId'])if(v[k])v[k]=candidate(v[k]);
    if(v.recordTypeId)v.recordTypeId=record(v.recordTypeId);
    if(!setting.relationBinding){
      for(const k of ['roleId','forwardRoleId','reverseRoleId'])if(typeof v[k]==='string')v[k]=role(v[k]);
      if(v.roleIds)v.roleIds=v.roleIds.map(role);
    }
    if(v.objectId){const original=v.objectId;v.objectId=object(original);const o=ctx.objects.get(v.objectId);
      if(path[0]==='target'&&(setting.wholeObjectTargets??[]).includes(original)){v.offset=0;v.size=o.size;}
      const end=v.count===0?v.offset:v.offset+(v.count===undefined?0:(v.count-1)*v.stride)+v.size;
      if(!Number.isSafeInteger(end)||v.offset<0||end>o.size)fail('mapped-range-out-of-bounds',{path,objectId:original,targetObjectId:o.id,requiredEnd:end,availableBytes:o.size});
    }
  });
  if(data.target?.ranges)data.target.ranges.sort((a,b)=>a.objectId<b.objectId?-1:a.objectId>b.objectId?1:a.offset-b.offset||b.size-a.size);
  if(data.relationBinding){const {nodes,links,roots}=data.relationBinding;data.relationBinding=defineStructureRelation(ctx.trace,{nodes,links,roots});}
  if(data.conditionRules)data.conditionRules=defineStructureConditionRules(ctx.trace,data.conditionRules);
  return {setting:{...clone(setting),...data,scope:scope(ctx.trace),key:key(data.target,setting.slot),
      ...(setting.wholeObjectTargets?{wholeObjectTargets:setting.wholeObjectTargets.map(object)}:{})},
    objectMappings:[...mapping].map(([from,to])=>({from,to})),recordMappings:[...recordMapping].map(([from,to])=>({from,to})),
    roleMappings:[...roleMapping].map(([from,to])=>({from,to})),fieldMappings:[...fieldMapping].map(([from,to])=>({from,to})),evidence};
}

export function reconnectStructureSetting(trace,setting,{plan,afterExecutionId,rerun=!same(setting.scope,scope(trace))}={}){
  const ctx=context(trace,plan,position(trace,afterExecutionId));
  try {if(plan&&plan.programId!==trace.programId)fail('compiler-scope-mismatch');if(!rerun&&!same(setting.scope,scope(trace)))fail('scope-mismatch');
    const result=remap(setting,ctx,{rerun});return {status:'connected',...result};}
  catch(error){if(!error.diagnostic)throw error;return {status:'reconnect-needed',setting:clone(setting),diagnostics:[error.diagnostic]};}
}

// Explicit rerun migration. Unresolved settings remain in `pending`, including
// their relations and conditions; they never become an arbitrary auto view.
export function reconnectStructurePresentation(preferences,{plan,trace,sourceScope,afterExecutionId}={}){
  if(preferences?.schemaVersion!==1||!Array.isArray(preferences.overrides))throw new TypeError('표현 설정이 필요합니다.');
  const run=scope(trace),source=preferences.overrides.filter(s=>sourceScope?same(s.scope,sourceScope):!same(s.scope,run));
  const next=clone(preferences),results=[],isSource=s=>source.some(x=>same(x.scope,s.scope)&&x.key===s.key);
  next.pending=(next.pending??[]).filter(p=>!same(p.scope,run)||!isSource(p.source));
  const proposed=[];
  for(const original of source){
    const r=reconnectStructureSetting(trace,original,{plan,afterExecutionId,rerun:true});
    if(r.status==='connected')proposed.push({original,r});else {next.pending.push({scope:run,source:clone(original),diagnostics:r.diagnostics});results.push(r);}
  }
  for(const {original,r}of proposed){
    const own=s=>same(s.reconnectedFrom?.scope,original.scope)&&s.reconnectedFrom?.key===original.key;
    const conflict=proposed.filter(x=>x.r.setting.key===r.setting.key).length>1||next.overrides.some(s=>same(s.scope,run)&&s.key===r.setting.key&&!own(s));
    if(conflict){const diagnostics=[{code:'conflicting-user-settings',key:r.setting.key}];next.pending.push({scope:run,source:clone(original),diagnostics});results.push({status:'reconnect-needed',setting:clone(original),diagnostics});continue;}
    // Re-run matching is captured at the base allocation. Later queries follow
    // only the replacements already observed at that query's event.
    r.setting.reconnectAnchor=captureStructurePresentationAnchor(plan,trace,r.setting,{afterExecutionId});
    r.setting.reconnectedFrom={scope:clone(original.scope),key:original.key};
    next.overrides=next.overrides.filter(s=>!(same(s.scope,run)&&own(s)));
    next.overrides.push(r.setting);results.push(r);
  }
  return {preferences:next,results,pending:clone(next.pending.filter(p=>same(p.scope,run)))};
}
