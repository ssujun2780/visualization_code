import {recordedTruth} from './conditions.js';

const loopKinds=new Set(['ForStmt','WhileStmt','DoStmt']);
export const loopLabel=kind=>({ForStmt:'for',WhileStmt:'while',DoStmt:'do-while'}[kind]??'반복');
const contained=(source,range)=>{
  const a=source?.start?.byte,b=source?.end?.byte,c=range?.start?.byte,d=range?.end?.byte;
  return Number.isInteger(a)&&Number.isInteger(b)&&Number.isInteger(c)&&Number.isInteger(d)&&
    (!source.file||!range.file||source.file===range.file)&&a>=c&&b<=d;
};

// Navigation metadata only. All bounds are indexes into the unchanged trace.
export function indexLoops(recording,navigation) {
  const {plan,trace,instructions,frames,playbackLength:limit}=recording;
  const scopes=new Map((plan.scopes??[]).map(scope=>[scope.id,scope]));
  const definitions=new Map();
  if(navigation?.version===1&&navigation.programId===plan.programId)
    for(const loop of navigation.loops??[])if(loopKinds.has(loop.kind)&&loop.source)definitions.set(loop.nodeId,{...loop});
  for(const scope of scopes.values())if(loopKinds.has(scope.kind)){
    let loop=[...definitions.values()].find(l=>l.kind===scope.kind&&contained(l.source,scope.source)&&contained(scope.source,l.source));
    if(!loop){loop={...scope,nodeId:null,scopeId:scope.id};definitions.set(scope.id,loop);}else loop.scopeId=scope.id;
  }
  // Older saved records can still expose dynamic loops through their compiler
  // statement ranges. Eliminated loops require the AST navigation sidecar.
  for(const d of instructions.values())if(loopKinds.has(d.controlKind)&&d.sourceNodeId){
    let loop=definitions.get(d.sourceNodeId)??[...definitions.values()].find(l=>l.scopeId===d.scopeId&&l.kind===d.controlKind);
    if(!loop&&(d.statementSource||d.action==='loop.next')){
      loop={id:`loop:${d.sourceNodeId}`,nodeId:d.sourceNodeId,kind:d.controlKind,functionId:d.functionId,
        functionName:plan.functions.find(f=>f.id===d.functionId)?.name,source:d.statementSource??d.source};
      definitions.set(d.sourceNodeId,loop);
    }
    if(loop){loop.nodeId??=d.sourceNodeId;if(d.action==='branch')loop.gate=d;}
  }
  const paths=new Map();
  function instructionPath(d){
    if(!d?.source&&!d?.scopeId)return null;
    if(paths.has(d.id))return paths.get(d.id);
    const ancestry=new Set();
    for(let scope=scopes.get(d.scopeId);scope&&!ancestry.has(scope.id);scope=scopes.get(scope.parentId))ancestry.add(scope.id);
    const functionName=scopes.get(d.scopeId)?.functionName;
    const path=[...definitions.values()].filter(l=>l.scopeId&&ancestry.has(l.scopeId)||
      (l.functionId?l.functionId===d.functionId:l.functionName===functionName)&&contained(d.source,l.source))
      .sort((a,b)=>(b.source?.end.byte-b.source?.start.byte)-(a.source?.end.byte-a.source?.start.byte));
    paths.set(d.id,path);return path;
  }
  const open=new Map(),instances=[],iterations=[],occurrences=new Map();
  const state=frame=>{if(!open.has(frame))open.set(frame,[]);return open.get(frame);};
  const frameDepth=id=>{let depth=0,seen=new Set();while(id&&!seen.has(id)){seen.add(id);id=frames.get(id)?.parent;depth++;}return depth;};
  function finishIteration(loop,end,complete){
    if(!loop.current)return;
    loop.current.end=end;loop.current.complete=complete;loop.current=null;
  }
  function finish(loop,end,complete){finishIteration(loop,end,complete);loop.end=end;loop.complete=complete;}
  function startIteration(loop,start,{includesSetup=false}={}){
    const iteration={kind:'iteration',id:`${loop.id}:iteration:${loop.iterations.length+1}`,loop,
      number:loop.iterations.length+1,start,end:null,complete:false,includesSetup,rank:loop.rank+1,children:[]};
    loop.current=iteration;loop.iterations.push(iteration);iterations.push(iteration);loop.pending=null;
    return iteration;
  }
  for(let index=0;index<limit;index++){
    const event=trace.events[index],definition=instructions.get(event.instructionId),frame=event.activationId??event.frameId;
    const active=state(frame);
    if(event.kind==='ERROR')break;
    const desired=instructionPath(definition)??active.map(loop=>loop.scope);
    let common=0;while(common<active.length&&active[common].scope===desired[common])common++;
    while(active.length>common)finish(active.pop(),index,true);
    for(let depth=common;depth<desired.length;depth++){
      // Deferred object cleanup must not create a second loop invocation.
      if(event.action==='object.end'||event.action==='frame.end')break;
      const scope=desired[depth],scopeId=scope.id,key=`${frame}:${scopeId}`;
      const occurrence=(occurrences.get(key)??0)+1;occurrences.set(key,occurrence);
      const parentDepth=frames.get(frame)?.parent?frameDepth(frame):1;
      const loop={kind:'loop',id:`loop:${key}:${occurrence}`,scopeId,scope,frameId:frame,occurrence,
        start:index,end:null,complete:false,iterations:[],current:null,pending:null,boundary:index,
        gate:scope.gate,rank:(parentDepth+depth)*2,children:[]};
      instances.push(loop);active.push(loop);
    }
    for(const ancestor of active.slice(0,-1))if((ancestor.scope.kind==='DoStmt'||!ancestor.gate)&&!ancestor.current&&!ancestor.exited)startIteration(ancestor,index);
    const loop=active.at(-1);if(!loop)continue;
    const own=definition?.controlKind===loop.scope.kind&&definition.sourceNodeId===loop.scope.nodeId;
    const postTest=loop.scope.kind==='DoStmt';
    if(postTest&&!loop.current&&!loop.exited)startIteration(loop,index);
    if(!postTest&&contained(definition?.source,loop.gate?.conditionSource??loop.scope.conditionSource)){
      if(loop.current)finishIteration(loop,index,true);
      loop.pending??=index;
    }
    if(own&&event.action==='branch'){
      const truth=recordedTruth(event.condition??event.value);
      if(postTest){finishIteration(loop,index+1,true);loop.exited=truth===false;}
      else{
        if(loop.current)finishIteration(loop,loop.pending??index,true);
        if(truth===true)startIteration(loop,loop.pending??index);
      }
      loop.pending=null;
    } else if(!loop.gate&&!loop.current&&definition?.scopeId&&definition.scopeId!==loop.scope.scopeId){
      startIteration(loop,index);
    }
    if(own&&event.action==='loop.next'){
      // For conditionless/unbraced loops the back-edge proves an iteration.
      if(!loop.current)startIteration(loop,loop.boundary,{includesSetup:loop.scope.kind==='ForStmt'&&!loop.iterations.length});
      finishIteration(loop,index+1,true);loop.boundary=index+1;
    }
    if(!loop.gate&&!loop.current&&['break','return'].includes(event.action))
      startIteration(loop,loop.boundary,{includesSetup:loop.scope.kind==='ForStmt'&&!loop.iterations.length});
    if(!loop.gate&&loop.scope.kind!=='ForStmt'&&event.action==='continue')finishIteration(loop,index+1,true);
    if(event.action==='return'||event.action==='frame.end')while(active.length)finish(active.pop(),index+1,true);
  }
  for(const active of open.values())while(active.length)finish(active.pop(),limit,false);
  // Ranges include nested calls; their source scopes belong to other frames.
  // Build a laminar navigation tree without changing any event or frame.
  const root={kind:'root',id:'root',start:0,end:limit,children:[]};
  const groups=[...instances,...iterations].filter(group=>group.end>group.start)
    .sort((a,b)=>a.start-b.start||b.end-a.end||a.rank-b.rank);
  const stack=[root];
  for(const group of groups){
    while(stack.length>1&&(group.start>=stack.at(-1).end||group.end>stack.at(-1).end))stack.pop();
    group.parent=stack.at(-1);group.parent.children.push(group);stack.push(group);
  }
  const byIndex=new Array(limit),deepest=new Array(limit);
  for(const group of groups)for(let index=group.start;index<group.end;index++){
    byIndex[index]=group;if(group.kind==='iteration')deepest[index]=group;
  }
  return {root,instances,iterations,at:index=>deepest[index]??null,groupAt:index=>byIndex[index]??null};
}
