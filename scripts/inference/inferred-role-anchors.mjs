// Physical role definitions from inference output. No classification or runtime
// mutation. IDs are lookup keys, never evidence that two roles mean the same thing.
const clone=x=>structuredClone(x),integer=n=>Number.isSafeInteger(n)&&n>=0;
export function inferredArrayAnchor(array,trace){
  const r=array?.range,o=trace.objects.find(o=>o.id===r?.objectId);
  if(array?.kind!=='array'||!o||!integer(r.offset)||!(r.size>0)||!(array.elementBytes>0))return null;
  return {kind:'array-storage',range:clone(r),elementBytes:array.elementBytes,
    wholeAllocation:r.offset===0&&r.size===o.size,
    rank:array.geometry?.rank??1,byteStrides:array.geometry?.byteStrides??[array.elementBytes]};
}
export function inferredRoleReferences(setting){
  if(setting.relationBinding)return [];
  const ids=new Set(setting.roleIds??[]);
  const visit=v=>{if(!v||typeof v!=='object')return;
    for(const k of ['roleId','forwardRoleId','reverseRoleId'])if(typeof v[k]==='string')ids.add(v[k]);
    for(const id of v.roleIds??[])ids.add(id);
    for(const x of Object.values(v))visit(x);
  };visit(setting.conditionRules);return [...ids];
}
export function inferredRoleCatalog(trace,{at=trace.events.length-1}={}){
  const structures=trace.structures??[],byId=new Map(structures.map(s=>[s.id,s])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    entries=new Map(),observed=id=>id==null||positions.has(id)&&positions.get(id)<=at;
  function add(id,descriptor,evidenceId){
    if(typeof id!=='string'||!descriptor||!observed(evidenceId))return;
    if(!entries.has(id))entries.set(id,new Map());entries.get(id).set(JSON.stringify(descriptor),descriptor);
  }
  const array=id=>inferredArrayAnchor(byId.get(id),trace);
  const field=f=>f?.fieldNodeId&&f.recordTypeId&&integer(f.offset)&&f.size>0?
    {fieldNodeId:f.fieldNodeId,recordTypeId:f.recordTypeId,offset:f.offset,size:f.size}:null;
  for(const s of structures){
    if(!observed(s.discoveredAtExecutionId))continue;
    if(s.kind==='linked-structure')for(const r of s.roles??[]){const f=field(r);if(f)add(r.fieldNodeId,{kind:'pointer-field',field:f},s.discoveredAtExecutionId);}
    if(s.kind==='record-index-graph-candidate'){
      const storage=array(s.containerId);if(storage)for(const r of s.relations??[]){const f=field(r.field);
        if(f&&r.evidence?.some(e=>e.targetAccessExecutionId&&observed(e.targetAccessExecutionId)))add(r.id,{kind:r.kind,storage,field:f},s.discoveredAtExecutionId);
      }
    }
    if(s.kind==='coindexed-record-candidate')for(const p of s.relationEvidence??[]){
      const storage=array(p.sourceArrayId);if(storage)add(p.sourceArrayId,{kind:'index-array',storage},p.targetAccessExecutionId);
    }
    if(s.kind==='value-index-graph-candidate'){
      const storage=array(s.arrayId);if(storage)add(s.arrayId,{kind:'index-array',storage},s.discoveredAtExecutionId);
    }
    if(s.kind==='rooted-index-structure')for(const id of s.roleIds??[]){
      // A rooted index candidate already proves this array's role. Never add
      // every array in the program just because its numbers happen to fit.
      const storage=array(id);if(storage)add(id,{kind:'index-array',storage},s.discoveredAtExecutionId);
    }
    if(s.kind==='table-row-graph-candidate'){
      const storage=array(s.containerId??s.arrayId);if(storage)for(const state of s.states??[]){if(!observed(state.afterExecutionId))continue;
        for(const e of state.edges??[])if(integer(e.column)&&state.roleIds?.includes(e.roleId))
          add(e.roleId,{kind:'index-column',storage,column:e.column},state.afterExecutionId);
      }
    }
    if(s.kind==='storage-reference-graph'){
      const nodes=new Map((s.nodes??[]).map(n=>[n.id,n]));
      for(const change of s.changes??[]){if(!observed(change.afterExecutionId))continue;
        for(const e of change.upsertEdges??[]){
          const n=nodes.get(e.from),r=e.source,member=e.rolePath?.findLast(p=>p.kind==='member'&&p.fieldNodeId);
          if(!observed(e.lastObservationExecutionId)||!member||!e.sourceTypeId||!n?.range||r?.objectId!==n.range.objectId)continue;
          const offset=r.offset-n.range.offset;if(!integer(offset)||r.size<=0||offset+r.size>n.range.size)continue;
          // Includes array-slot offset, so two members of children[] remain two
          // independently selectable roles. Access-site/index AST IDs are not anchors.
          add(e.roleId,{kind:'storage-pointer-field',field:{fieldNodeId:member.fieldNodeId,recordTypeId:e.sourceTypeId,offset,size:r.size}},e.lastObservationExecutionId);
        }
      }
    }
  }
  return new Map([...entries].map(([id,descriptors])=>[id,[...descriptors.values()]]));
}
