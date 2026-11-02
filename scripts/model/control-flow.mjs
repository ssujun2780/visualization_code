// Source labels plus observed CFG edges. No source expression is re-evaluated.
const order=(a,b)=>a.line-b.line||a.column-b.column;
const encloses=(range,p)=>range&&p&&range.file===p.file&&order(range.start,p)<=0&&order(p,range.end)<=0;
const closestSwitch=node=>{for(let p=node.parent;p;p=p.parent)if(p.kind==='SwitchStmt')return p;return null;};
const unique=items=>[...new Set(items.filter(Boolean))];

function joins(blocks){
  const exit='@exit',ids=[...blocks.keys(),exit],reverse=new Map(ids.map(id=>[id,[]]));
  for(const b of blocks.values())for(const to of b.next.length?b.next:[exit])reverse.get(to)?.push(b.id);
  const terminating=new Set(),queue=[exit];
  while(queue.length){const id=queue.pop();if(terminating.has(id))continue;terminating.add(id);queue.push(...(reverse.get(id)??[]));}
  const successors=new Map([...blocks.values()].map(b=>[b.id,b.next.length?(terminating.has(b.id)?b.next:[...b.next,exit]):[exit]]));
  const post=new Map(ids.map(id=>[id,new Set(id===exit?[exit]:ids)]));
  let changed=true;
  while(changed){changed=false;for(const id of [...blocks.keys()].reverse()){
    const next=successors.get(id),intersection=new Set(post.get(next[0])??[exit]);
    for(const target of next.slice(1))for(const value of intersection)if(!post.get(target)?.has(value))intersection.delete(value);
    intersection.add(id);const previous=post.get(id);
    if(previous.size!==intersection.size||[...intersection].some(value=>!previous.has(value))){post.set(id,intersection);changed=true;}
  }}
  return new Map([...blocks.keys()].map(id=>[id,[...post.get(id)].filter(p=>p!==id).sort((a,b)=>post.get(b).size-post.get(a).size)[0]??exit]));
}

export function buildControlFlow(plan,observations,{nodes,nearest,readSource,filename}){
  const flow={labels:[],edges:[],functions:[],gaps:[]},definitions=new Map(plan.instructions.map(i=>[i.id,i]));
  const localPoint=op=>op.source&&{...op.source,file:op.source.file===filename?'/main.c':op.source.file};
  for(const fn of observations.functions){
    const ops=observations.instructions.filter(o=>o.functionId===fn.id&&o.block),blocks=new Map();
    for(const op of ops){
      if(!blocks.has(op.block))blocks.set(op.block,{id:op.block,next:[],ops:[]});
      const b=blocks.get(op.block);b.ops.push(op);if(['branch','switch'].includes(op.action)){b.next=unique(op.destinations);b.terminator=op;}
    }
    if(blocks.size>2048){flow.gaps.push({functionId:fn.id,reason:'control-flow-block-limit'});continue;}
    const merge=joins(blocks);
    flow.functions.push({functionId:fn.id,blocks:[...blocks.values()].map(b=>({id:b.id,successors:b.next,mergeBlock:merge.get(b.id)}))});
    for(const b of blocks.values()){
      const op=b.terminator,binding=op&&plan.bindings[op.id];
      if(!op||binding?.administrative&&binding.evaluation?.role!=='decision'||!(op.action==='switch'||op.inputs?.length&&b.next.length>1))continue;
      const join=merge.get(b.id),regions={};
      for(const target of b.next){
        const visited=new Set(),queue=[target];
        while(queue.length){const id=queue.pop();if(id===join||visited.has(id)||!blocks.has(id))continue;visited.add(id);queue.push(...blocks.get(id).next);}
        regions[target]=[...visited];
      }
      binding.controlDecision={block:b.id,mergeBlock:join,regions};
    }
    for(const dispatch of ops.filter(o=>o.action==='switch')){
      const owner=nearest(dispatch,n=>n.kind==='SwitchStmt');if(!owner)continue;
      const switchId=plan.bindings[dispatch.id]?.roles.FLOW,definition=definitions.get(switchId);if(!definition)continue;
      const labels=nodes.filter(n=>['CaseStmt','DefaultStmt'].includes(n.kind)&&closestSwitch(n)===owner&&n.source?.file==='/main.c')
        .sort((a,b)=>order(a.source.start,b.source.start));
      const entries=labels.map(node=>{
        const value=node.kind==='CaseStmt'?compilerInteger(node.children[0]):null;
        const label={id:`label${flow.labels.length+1}`,switchInstructionId:switchId,kind:node.kind==='DefaultStmt'?'default':'case',
          sourceNodeId:node.id,source:readSource({...node.source,end:node.source.start}),value};
        flow.labels.push(label);return {node,label};
      });
      const labelAt=point=>encloses(owner.source,point)?entries.filter(e=>order(e.node.source.start,point)<=0).at(-1):null;
      const targets=new Map();
      for(const target of unique(dispatch.destinations)){
        const first=blocks.get(target)?.ops.find(o=>encloses(owner.source,localPoint(o))),entry=first&&labelAt(localPoint(first));
        if(!entry)continue;
        // Consecutive case labels can share one backend block.
        const group=[entry];let parent=entry.node.parent;
        while(parent&&['CaseStmt','DefaultStmt'].includes(parent.kind)){
          const previous=entries.find(e=>e.node===parent);if(previous)group.unshift(previous);parent=parent.parent;
        }
        targets.set(target,group);
      }
      definition.cases=dispatch.cases.map(c=>{
        const group=targets.get(c.destination)??[],match=group.find(e=>e.label.value===c.value)??(group.length===1?group[0]:null);
        if(match)match.label.value=c.value;
        else flow.gaps.push({functionId:fn.id,reason:'case-label-not-resolved',observationId:dispatch.id,value:c.value});
        return {...c,labelId:match?.label.id??null,labelIds:group.map(e=>e.label.id),source:match?.label.source??null};
      });
      const defaultEntry=(targets.get(dispatch.destinations[0])??[]).find(e=>e.label.kind==='default');
      definition.defaultTarget={destination:dispatch.destinations[0],labelId:defaultEntry?.label.id??null,source:defaultEntry?.label.source??null};
      plan.bindings[dispatch.id].switchTargets={cases:definition.cases,defaultTarget:definition.defaultTarget};
      for(const op of ops.filter(o=>o.action==='branch')){
        const origin=labelAt(localPoint(op));if(!origin)continue;
        if(nearest(op,n=>['BreakStmt','ContinueStmt','GotoStmt','IndirectGotoStmt'].includes(n.kind)))continue;
        for(const target of op.destinations){
          const destination=targets.get(target)?.[0];
          if(!destination||destination===origin||order(origin.node.source.start,destination.node.source.start)>=0)continue;
          const edge={id:`edge${flow.edges.length+1}`,kind:'fall-through',functionId:fn.id,switchInstructionId:switchId,
            fromLabelId:origin.label.id,toLabelId:destination.label.id,fromBlock:op.block,toBlock:target};
          flow.edges.push(edge);(plan.bindings[op.id].flowEdges??={})[target]=edge.id;
        }
      }
    }
  }
  plan.controlFlow=flow;
}

export function createControlTracker(plan,ops){
  const frames=new Map(),transitions=[],edges=new Map((plan.controlFlow?.edges??[]).map(e=>[e.id,e])),regions=new Map();
  for(const [id,b]of Object.entries(plan.bindings))if(b.controlDecision)regions.set(id,new Map(Object.entries(b.controlDecision.regions).map(([target,blocks])=>[target,new Set(blocks)])));
  return {transitions,
    decorate(event){
      const op=ops.get(event.instructionId);if(!event.activationId||!op?.block)return event;
      let frame=frames.get(event.activationId);if(!frame)frames.set(event.activationId,frame={block:null,active:[],pending:[],enter:false});
      if(frame.block!==op.block||frame.enter){
        frame.active=frame.active.filter(d=>d.block!==op.block&&d.region.has(op.block));frame.block=op.block;frame.enter=false;
      }
      const e={...event,controlInputs:unique([...(event.controlInputs??[]),...frame.active.map(d=>d.eventId)]),incomingFlow:frame.pending.slice()};
      if(event.kind==='FLOW'&&['branch','switch'].includes(event.action)){
        const binding=plan.bindings[op.id],targets=binding?.switchTargets;
        if(targets){const value=event.condition,selected=targets.cases.find(c=>c.destination===event.selected&&[value?.signed,value?.unsigned].includes(c.value));
          e.selection=selected?{kind:'case',value:selected.value,labelId:selected.labelId,labelIds:selected.labelIds,source:selected.source}:
            {kind:targets.defaultTarget.labelId?'default':'switch-exit',labelId:targets.defaultTarget.labelId,source:targets.defaultTarget.source};}
        const edge=edges.get(binding?.flowEdges?.[event.selected]);
        if(edge){const transition={id:`t${transitions.length+1}`,edgeId:edge.id,activationId:event.activationId,
          observationIds:[event.eventId],controlInputs:e.controlInputs.slice(),beforeExecutionId:null};
          transitions.push(transition);frame.pending.push(transition.id);}
        const region=regions.get(op.id)?.get(event.selected);
        if(region){frame.active=frame.active.filter(d=>d.observationId!==op.id);
          frame.active.push({observationId:op.id,eventId:event.eventId,block:op.block,region});}
        frame.enter=true;
      }
      if(event.action==='frame.end')frames.delete(event.activationId);
      return e;
    },
    claim(command,event){
      for(const id of event.incomingFlow??[]){const transition=transitions[Number(id.slice(1))-1];
        if(!transition||transition.beforeExecutionId)continue;
        transition.beforeExecutionId=command.eventId;(command.incomingTransitions??=[]).push(id);
        const frame=frames.get(event.activationId);if(frame)frame.pending=frame.pending.filter(t=>t!==id);
      }
    }
  };
}
import {compilerInteger} from './source-map.mjs';
