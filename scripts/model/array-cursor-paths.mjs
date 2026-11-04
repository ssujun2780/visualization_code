// Cursor positions are scalar observations associated through compiler index
// roles. They are not invented cell reads, algorithm identities, or atomic moves.
import {arrayGeometry} from './array-geometry.mjs';
const unique=xs=>[...new Set(xs)];
const number=value=>{
  const raw=value?.decimal??(value?.cType?.signedness==='unsigned'?value.unsigned:value?.signed);
  if(raw===null||raw===undefined)return null;
  const n=Number(raw);return Number.isSafeInteger(n)?n:null;
};
const integerObject=o=>o&&['signed','unsigned'].includes(o.cType?.signedness)&&
  !['array','record','pointer'].includes(o.cType.kind)&&Number.isSafeInteger(o.size)&&o.size>0;

export function arrayCursorPathStructures(plan,{events,objects,structures=[]}){
  const work=structures.find(s=>s.kind==='array-work');if(!work)return [];
  const arrays=new Map(structures.filter(s=>s.kind==='array').map(s=>[s.id,s])),byObject=new Map(objects.map(o=>[o.id,o])),
    byEvent=new Map(events.map(e=>[e.eventId,e])),positions=new Map(events.map((e,i)=>[e.eventId,i])),
    definitions=new Map(plan.instructions.map(d=>[d.id,d])),sites=new Map((plan.structureBindings?.arrayWork?.accesses??[]).map(a=>[a.nodeId,a])),
    candidates=new Map();
  for(const access of work.accesses??[]){
    const array=arrays.get(access.target?.arrayId),geometry=array&&arrayGeometry(array,byObject.get(array.objectId));
    if(geometry?.status!=='resolved'||geometry.rank<2||!access.target.coordinates)continue;
    const matching=(access.axes?[{axes:access.axes,nodeId:access.accessSiteNodeId}]:
      (access.sourceNodeIds??[]).map(id=>sites.get(id)).filter(Boolean)).filter(site=>site.axes?.length===geometry.rank);
    for(const site of matching){
      const roles=site.axes.slice().sort((a,b)=>a.axis-b.axis),cursors=[];
      for(let axis=0;axis<roles.length;axis++){
        const role=roles[axis],ids=unique(role.indexDeclarationIds??[]);
        if(role.axis!==axis||ids.length!==1)break;
        const found=(access.cursors??[]).filter(c=>c.declarationId===ids[0]),objectIds=unique(found.map(c=>c.objectId));
        if(objectIds.length!==1)break;
        const object=byObject.get(objectIds[0]);
        if(!integerObject(object)||!found.some(c=>{
          const read=byEvent.get(c.executionId);return read?.kind==='READ'&&read.target?.objectId===object.id&&
            read.target.offset===0&&read.target.size===object.size;
        }))break;
        cursors.push({axis,declarationId:ids[0],objectId:objectIds[0]});
      }
      if(cursors.length!==geometry.rank)continue;
      const key=`${access.activationId}:${array.id}:${cursors.map(c=>c.objectId).join(':')}`;
      let candidate=candidates.get(key);
      if(!candidate)candidates.set(key,candidate={id:`cursor-path:${key}`,array,geometry,activationId:access.activationId,cursors,
        accessIds:new Set(),readIds:new Set(),sites:new Map(),confirmedAt:access.executionId});
      candidate.accessIds.add(access.executionId);
      for(const cursor of access.cursors??[])if(cursors.some(c=>c.objectId===cursor.objectId))candidate.readIds.add(cursor.executionId);
      if(site.nodeId)candidate.sites.set(site.nodeId,{nodeId:site.nodeId,axes:roles.map(r=>({axis:r.axis,
        indexDeclarationIds:r.indexDeclarationIds,index:r.index??null}))});
    }
  }
  const readObjects=(id,seen=new Set())=>{
    if(!id||seen.has(id))return [];seen.add(id);const e=byEvent.get(id);if(!e)return [];
    if(e.kind==='READ')return e.target?.objectId?[e.target.objectId]:[];
    return unique([...(e.dataInputs??[]),...(e.inputs??[]).map(i=>i.executionId)].flatMap(next=>readObjects(next,seen)));
  };
  const results=[];
  for(const candidate of candidates.values()){
    const {array,geometry,activationId,cursors}=candidate,ids=new Set(cursors.map(c=>c.objectId)),
      tracked=cursors.map(c=>byObject.get(c.objectId)),arrayObject=byObject.get(array.objectId),
      starts=[...tracked.map(o=>positions.get(o?.createdBy)),...[...candidate.readIds].map(id=>positions.get(id))].filter(Number.isInteger),
      start=starts.length?Math.min(...starts):positions.get(candidate.confirmedAt),
      known=new Map(),alive=new Set(),states=[],loopBoundaries=[],accessSnapshots=[];
    let ended=false;
    const snapshot=(e,reason)=>{
      const coordinates=cursors.map(c=>alive.has(c.objectId)?known.get(c.objectId)??null:null),complete=coordinates.every(v=>v!==null),
        inside=complete&&coordinates.every((v,axis)=>v>=0&&v<geometry.dimensions[axis]);
      return {afterExecutionId:e.eventId,coordinates,coordinateKind:'cursor-values',
        status:ended?'ended':complete?'observed':'partial',positionStatus:complete?(inside?'inside':'outside'):'unknown',reason};
    };
    for(let at=start;at<events.length;at++){
      const e=events[at];
      const ending=e.eventId===arrayObject?.endedBy||tracked.some(o=>e.eventId===o?.endedBy)||
        e.action==='frame.end'&&e.activationId===activationId;
      if(e.action==='object.begin'&&ids.has(e.objectId)){alive.add(e.objectId);states.push(snapshot(e,'cursor.begin'));}
      if(e.kind==='WRITE'&&ids.has(e.target?.objectId)){
        const object=byObject.get(e.target.objectId);
        if(e.target.offset===0&&e.target.size===object?.size){known.set(object.id,number(e.value));alive.add(object.id);}
        else known.delete(e.target.objectId);
        states.push(snapshot(e,'cursor.write'));
      }
      // A read supplies a parameter/global cursor even if its creation or
      // initialization was outside this recorded activation. It adds no work.
      if(e.kind==='READ'&&ids.has(e.target?.objectId)&&!known.has(e.target.objectId)){
        const object=byObject.get(e.target.objectId);
        if(e.target.offset===0&&e.target.size===object?.size){known.set(object.id,number(e.value));alive.add(object.id);
          states.push(snapshot(e,'cursor.observed'));}
      }
      if(e.activationId===activationId){
        const d=definitions.get(e.instructionId);
        if(e.kind==='FLOW'&&e.action==='branch'&&['ForStmt','WhileStmt','DoStmt'].includes(d?.controlKind)&&
          readObjects(e.eventId).some(id=>ids.has(id)))
          loopBoundaries.push({...snapshot(e,'loop.condition'),loopNodeId:d.sourceNodeId,conditionTruth:number(e.condition)===null?null:number(e.condition)!==0});
        if(candidate.accessIds.has(e.eventId)){
          const access=work.accesses.find(a=>a.executionId===e.eventId&&a.target.arrayId===array.id);
          accessSnapshots.push({...snapshot(e,'array.access'),accessExecutionId:e.eventId,
            cellCoordinates:access.target.coordinates.slice(),sourceNodeIds:access.sourceNodeIds});
        }
      }
      if(ending){ended=true;states.push(snapshot(e,'lifetime.end'));break;}
    }
    results.push({id:candidate.id,kind:'array-cursor-path',arrayId:array.id,objectId:array.objectId,activationId,
      nodes:array.nodes??[],edges:[],dimensions:geometry.dimensions,cursors,sites:[...candidate.sites.values()],
      confirmedAt:candidate.confirmedAt,states,loopBoundaries,accessSnapshots,lifecycle:ended?'ended':'active-or-incomplete',
      evidence:['compiler per-axis index declaration roles','observed cursor objects and scalar writes','observed array access coordinates'],
      limitations:['cursor coordinates are raw scalar values, not evaluated index expressions',
        'positions outside the array are cursor states, not evidence of an invalid memory access',
        'association is confirmed at an observed access; earlier states retain their actual write times',
        'multiple index declarations per axis remain unclassified','no algorithm or traversal intent is asserted']});
  }
  return results;
}

export function validateArrayCursorPaths(plan,trace){
  const events=new Map(trace.events.map(e=>[e.eventId,e])),positions=new Map(trace.events.map((e,i)=>[e.eventId,i])),
    objects=new Map(trace.objects.map(o=>[o.id,o])),structures=new Map(trace.structures.map(s=>[s.id,s])),
    definitions=new Map(plan.instructions.map(d=>[d.id,d])),work=trace.structures.find(s=>s.kind==='array-work');
  const require=(ok,message)=>{if(!ok)throw new Error(`array-cursor-path overlay: ${message}`);};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const path of trace.structures.filter(s=>s.kind==='array-cursor-path')){
    const array=structures.get(path.arrayId),object=objects.get(path.objectId),geometry=array&&arrayGeometry(array,object),
      confirmed=events.get(path.confirmedAt),ids=new Set(path.cursors?.map(c=>c.objectId));
    require(array?.kind==='array'&&array.objectId===path.objectId&&geometry?.status==='resolved','invalid array storage');
    require(same(path.dimensions,geometry.dimensions)&&path.cursors?.length===geometry.rank&&geometry.rank>=2,'invalid axes');
    require(path.edges?.length===0&&confirmed?.activationId===path.activationId,'invalid confirmation or synthetic edges');
    for(const [axis,cursor]of path.cursors.entries())require(cursor.axis===axis&&integerObject(objects.get(cursor.objectId)), 'invalid scalar cursor');
    const access=work?.accesses?.find(a=>a.executionId===path.confirmedAt&&a.target.arrayId===path.arrayId);
    require(access&&path.cursors.every(c=>(access.cursors??[]).some(a=>a.objectId===c.objectId&&a.declarationId===c.declarationId)), 'missing observed cursor association');
    const roles=access.axes??plan.structureBindings?.arrayWork?.accesses?.find(s=>(access.sourceNodeIds??[]).includes(s.nodeId)&&s.axes?.length===geometry.rank)?.axes;
    require(roles?.length===geometry.rank&&path.cursors.every(c=>roles.some(r=>r.axis===c.axis&&
      r.indexDeclarationIds?.length===1&&r.indexDeclarationIds[0]===c.declarationId)),'cursor axes differ from compiler roles');
    for(const cursor of path.cursors){
      require(access.cursors.some(c=>{
        const e=events.get(c.executionId),o=objects.get(cursor.objectId);
        return c.objectId===o.id&&c.declarationId===cursor.declarationId&&e?.kind==='READ'&&e.target?.objectId===o.id&&
          e.target.offset===0&&e.target.size===o.size&&positions.get(e.eventId)<positions.get(path.confirmedAt);
      }),'invalid cursor source read');
    }
    const tracked=path.cursors.map(c=>objects.get(c.objectId)),endIds=unique([object?.endedBy,...tracked.map(o=>o.endedBy),
      ...trace.events.filter(e=>e.action==='frame.end'&&e.activationId===path.activationId).map(e=>e.eventId)].filter(id=>positions.has(id))),
      end=endIds.sort((a,b)=>positions.get(a)-positions.get(b))[0],known=new Map(),alive=new Set();
    let previous=-1,ended=false;
    for(const state of path.states??[]){
      const e=events.get(state.afterExecutionId),at=positions.get(state.afterExecutionId);
      require(e&&at>previous&&!ended,'invalid state execution order');previous=at;
      require(state.coordinateKind==='cursor-values','cursor coordinates must remain raw values');
      if(state.reason==='cursor.begin'){
        require(e.action==='object.begin'&&ids.has(e.objectId),'invalid cursor creation');alive.add(e.objectId);
      }else if(['cursor.write','cursor.observed'].includes(state.reason)){
        require(e.kind===(state.reason==='cursor.write'?'WRITE':'READ')&&ids.has(e.target?.objectId),'invalid cursor observation');
        const o=objects.get(e.target.objectId);
        if(e.target.offset===0&&e.target.size===o.size){known.set(o.id,number(e.value));alive.add(o.id);}else known.delete(o.id);
      }else if(state.reason==='lifetime.end'){
        require(e.eventId===end,'invented lifetime end');ended=true;
      }else require(false,'unknown state reason');
      const coordinates=path.cursors.map(c=>alive.has(c.objectId)?known.get(c.objectId)??null:null),complete=coordinates.every(v=>v!==null),
        inside=complete&&coordinates.every((v,axis)=>v>=0&&v<geometry.dimensions[axis]);
      require(same(state.coordinates,coordinates),'cursor position differs from observed scalar values');
      require(state.status===(ended?'ended':complete?'observed':'partial'),'invalid state validity');
      require(state.positionStatus===(complete?(inside?'inside':'outside'):'unknown'),'invalid cursor bounds label');
    }
    require(path.lifecycle===(ended?'ended':'active-or-incomplete')&&(!end||ended),'missing lifetime state');
    const stateIds=new Set(path.states.map(s=>s.afterExecutionId)),start=positions.get(path.states[0]?.afterExecutionId);
    for(const e of trace.events)if(e.kind==='WRITE'&&ids.has(e.target?.objectId)&&positions.get(e.eventId)>=start&&
      (!end||positions.get(e.eventId)<positions.get(end)))require(stateIds.has(e.eventId),'missing intermediate cursor write');
    for(const [list,kind]of [[path.loopBoundaries,'loop.condition'],[path.accessSnapshots,'array.access']]){
      let previous=-1;
      for(const snapshot of list??[]){
        const e=events.get(snapshot.afterExecutionId),at=positions.get(snapshot.afterExecutionId);
        require(e&&e.activationId===path.activationId&&at>previous&&(!end||at<positions.get(end)),'invalid snapshot execution');previous=at;
        const state=path.states.findLast(s=>positions.get(s.afterExecutionId)<=at);
        require(state&&same(snapshot.coordinates,state.coordinates)&&snapshot.reason===kind,'unobserved snapshot position');
        if(kind==='loop.condition'){
          const d=definitions.get(e.instructionId);
          require(e.kind==='FLOW'&&e.action==='branch'&&['WhileStmt','ForStmt','DoStmt'].includes(d?.controlKind)&&
            snapshot.loopNodeId===d.sourceNodeId,'invalid loop boundary');
          require(snapshot.conditionTruth===(number(e.condition)===null?null:number(e.condition)!==0),'incorrect loop truth');
        }else{
          const a=work.accesses.find(a=>a.executionId===e.eventId&&a.target.arrayId===path.arrayId);
          require(a&&snapshot.accessExecutionId===e.eventId&&same(snapshot.cellCoordinates,a.target.coordinates),'invalid cell access snapshot');
        }
      }
    }
  }
  return true;
}
