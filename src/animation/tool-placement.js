import {calculationForEvent,dataFlowForEvent} from './transfers.js';
import {avoidMatOverlap,enclosingRectangle,rectangleCenter} from './world.js';
import {structurePort} from './structure-ink.js';

const toolId='tool:workbench';
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

// Layout from current, recorded operand identities. No algorithm detection,
// source evaluation or look-ahead to future write addresses is involved.
export class ToolFollower{
  constructor(layout){this.layout=layout;this.lastTask=null;layout.followingTools.add(toolId);}

  update(recording,event,state){
    let task=calculationForEvent(recording,event);
    if(task?.kind==='FLOW')task=(task.dataInputs??[]).map(id=>recording.events.get(id)).find(e=>e?.kind==='CALC')??task;
    if(!task||task.eventId===this.lastTask)return false;
    this.lastTask=task.eventId;
    const layout=this.layout;
    if(layout.pinned.has(toolId)||layout.draggingKey)return false;
    const geometry=layout.resolve(state),current=geometry.mats.get(toolId).rectangle,targets=[];
    for(const {from} of dataFlowForEvent(recording,task)){
      if(from.kind==='object'){
        const presented=structurePort(geometry,{objectId:from.id,offset:from.offset,size:from.size});
        if(presented){const owner=state.objects.get(presented.ownerObjectId),region=geometry.mats.get(owner?.frameId?`frame:${owner.frameId}`:`memory:${owner?.storage==='heap'?'heap':'static'}`);if(region?.alive)targets.push({rectangle:presented.rectangle,region});continue;}
        let object=state.objects.get(from.id);if(!object?.alive)continue;
        const ref=object.value?.reference??object.cells?.get(from.offset??0)?.value?.reference,backing=state.objects.get(ref?.targetObjectId);
        const throughStructure=backing?.alive&&layout.prepared?.tracks.has(backing.id);if(throughStructure)object=backing;
        const start=from.offset??0,end=start+(from.size??1);
        const cells=[...geometry.cells.values()].filter(cell=>cell.objectId===from.id&&cell.offset<end&&cell.offset+cell.size>start);
        const whole=geometry.objects.get(object.id),showWhole=layout.prepared?.tracks.has(object.id)&&whole?.width<=1000&&whole?.height<=600;
        const rectangle=throughStructure||showWhole?whole:cells.length?enclosingRectangle(cells):geometry.objects.get(from.id);
        const region=geometry.mats.get(object.frameId?`frame:${object.frameId}`:`memory:${object.storage==='heap'?'heap':'static'}`);
        if(rectangle&&region?.alive)targets.push({rectangle,region});
      }else if(from.kind==='return-port'){
        const region=geometry.mats.get(`frame:${from.id}`),point=layout.returnPoint(from.id,state);
        if(region?.alive&&point)targets.push({rectangle:{...point,width:1,height:1},region});
      }
    }
    if(!targets.length){
      const region=geometry.mats.get(`frame:${task.activationId??state.activeFrame}`);
      if(region?.alive)targets.push({rectangle:region.rectangle,region});
    }
    if(!targets.length)return false;
    const obstacles=[...geometry.mats.values()].filter(mat=>mat.alive&&mat.id!==toolId).map(mat=>mat.rectangle);
    const center=rectangleCenter(enclosingRectangle(targets.map(target=>target.rectangle))),gap=24,candidates=[current];
    for(const {rectangle:r} of new Map(targets.map(target=>[target.region.id,target.region])).values()){
      const y=Math.max(r.y,Math.min(center.y-current.height/2,r.y+Math.max(0,r.height-current.height)));
      const x=Math.max(r.x,Math.min(center.x-current.width/2,r.x+Math.max(0,r.width-current.width)));
      candidates.push({x:r.x-current.width-gap,y},{x:r.x+r.width+gap,y},
        {x,y:r.y-current.height-gap},{x,y:r.y+r.height+gap});
    }
    const score=box=>{const area=enclosingRectangle([...targets.map(t=>t.rectangle),box]),viewport=layout.viewport;
      return targets.reduce((sum,target)=>sum+distance(rectangleCenter(box),rectangleCenter(target.rectangle)),0)+distance(box,current)*0.12+
        (layout.prepared&&viewport?Math.max(area.width/viewport.width,area.height/viewport.height)*1400:0);};
    let best=current,bestScore=score(current);
    for(const candidate of candidates.slice(1)){
      const box=avoidMatOverlap({...current,...candidate},obstacles,gap),cost=score(box);
      if(cost<bestScore){best=box;bestScore=cost;}
    }
    // Avoid shuffling for a few pixels of improvement as array indices change.
    if(score(current)-bestScore<48)return false;
    return layout.placeTool(toolId,best);
  }
}
