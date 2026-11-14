import {emptyScene,applyEvent,displayScene,Playback} from './playback.js';
import {WorldLayout} from './world.js';
import {ToolFollower} from './tool-placement.js';
import {pointerGraph} from './pointer-graph.js';
import {PresentationJournal,layoutSnapshot} from './presentation-journal.js';
import {revisePresentation} from './presentation-overlay.js';

// One chronological construction for playback, jumps and rewind alike. This
// consumer never executes C or calls an inference API. Rewind reads its journal
// and does not rewind/reseed the native incremental router.
export class PresentationHistory{
  constructor(recording,{prepared=null,preferences={},viewport}={},wiring){
    this.recording=recording;this.wiring=wiring;this.layout=new WorldLayout();
    this.layout.resolveType=recording.resolveType;this.layout.viewport=viewport;this.layout.setPrepared(prepared);
    this.layout.pinned=new Set(preferences.pinned??[]);this.layout.collapsed=new Set(preferences.collapsed??[]);this.layout.windows=new Map(preferences.windows??[]);
    for(const [key,point]of preferences.positions??[])this.layout.positions.set(key,point);
    this.follower=new ToolFollower(this.layout);this.state=emptyScene();this.next=0;this.journal=new PresentationJournal();
    this.query=new Playback(recording);this.boundaries=new Map();
  }
  prepare(cursor,{timeMs=8,maxSteps=32}={}){
    const target=Math.max(0,Math.min(this.recording.playbackLength,Math.trunc(cursor))),started=performance.now();let steps=0;
    while(this.next<=target){
      this.build();
      if(++steps>=maxSteps||performance.now()-started>=timeMs)return this.next>target;
    }return true;
  }
  build(){
    const event=this.next<this.recording.playbackLength?this.recording.trace.events[this.next]:null,before=displayScene(this.recording,this.state),nextState=event?applyEvent(this.recording,this.state,event):this.state,after=displayScene(this.recording,nextState);
    this.follower.update(this.recording,event,before);
    let start,results,seeds;
    for(let attempt=0;attempt<=2;attempt++){
      start=layoutSnapshot(this.layout);
      const geometries=[this.layout.resolve(before),this.layout.resolve(after)],graphs=geometries.map((g,i)=>pointerGraph(i?after:before,g,this.layout.pinned));
      seeds=[];results=graphs.map(graph=>{const result=this.wiring.update(graph);seeds.push(this.wiring.snapshot());return result;});
      const missing=results[1].missing;
      if(!missing.length||attempt===2)break;
      const affected=graphs[1].edges.filter(e=>missing.includes(e.id)).flatMap(e=>[e.sourceObjectId,e.targetObjectId]);
      if(!this.layout.openCorridor(after,affected,18))break;
    }
    const snapshots=[start,layoutSnapshot(this.layout)];
    for(let i=0;i<2;i++){
      for(const [key,value]of seeds[i])snapshots[i].set(key,value);
      for(const path of results[i].paths)snapshots[i].set('w:'+path.id,path);
      const {paths,...metadata}=results[i];snapshots[i].set('routing',metadata);this.journal.append(snapshots[i]);
    }
    this.boundaries.set(this.next,[before,after]);while(this.boundaries.size>8)this.boundaries.delete(this.boundaries.keys().next().value);
    this.state=nextState;this.next++;
    if(this.next%128===0){this.query.checkpoints.set(this.next,this.state);while(this.query.checkpoints.size>32)this.query.checkpoints.delete([...this.query.checkpoints.keys()].find(k=>k!==0));}
  }
  result(cursor,known=0){
    const start=2*cursor+1,end=start+1;
    if(end>this.journal.length)throw new RangeError('아직 준비되지 않은 표시 시점입니다.');
    return {cursor,start,end,from:known,changes:this.journal.changes.slice(known)};
  }
  revise(cursor,preferences,wiringFactory){
    let states=this.boundaries.get(cursor);
    if(!states){this.query.seek(cursor);states=[displayScene(this.recording,this.query.state),displayScene(this.recording,this.query.after)];}
    return revisePresentation(this.recording,cursor,states,[this.journal.at(2*cursor+1),this.journal.at(2*cursor+2)],
      {prepared:this.layout.prepared,viewport:this.layout.viewport,collapsed:this.layout.collapsed,windows:this.layout.windows,preferences},wiringFactory);
  }
  dispose(){this.wiring.dispose();}
}
