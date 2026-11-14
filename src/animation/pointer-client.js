import {graphKey} from './pointer-graph.js';
import {PresentationJournal,routeSnapshot} from './presentation-journal.js';

// Geometry-only cache: numeric writes, camera motion and animation ticks do
// not enter the worker. The player waits for both boundary states of its event.
export class PointerClient {
  constructor() {
    this.worker = new Worker(new URL('./pointer-worker.js', import.meta.url), {type: 'module'});
    this.cache = new Map(); this.pending = new Set(); this.queue = new Map(); this.busy = false; this.error = null;
    this.frameEpoch=0;this.frameJournal=new PresentationJournal();this.frameCache=new Map();this.framePending=new Set();
    this.worker.onmessage = ({data}) => {
      if(data.type==='frame-progress'){if(data.epoch===this.frameEpoch&&data.edit===this.frameEdit&&data.cursor===this.frameWanted)this.frameProgress={done:data.done,total:data.total};return;}
      if(data.type==='frame'){
        if(data.epoch!==this.frameEpoch)return;
        this.framePending.delete(JSON.stringify([data.edit,data.cursor]));
        if(data.error){if(data.edit===this.frameEdit)this.error=data.error;return;}
        if(data.from>this.frameJournal.length){this.error='표시 이력 전달 순서가 일치하지 않습니다.';return;}
        for(let i=this.frameJournal.length-data.from;i<data.changes.length;i++)this.frameJournal.accept(data.changes[i]);
        if(data.edit===this.frameEdit&&data.overlay){
          this.frameCache.set(data.cursor,{epoch:data.epoch,...data.overlay});
          while(this.frameCache.size>8)this.frameCache.delete(this.frameCache.keys().next().value);
        }
        this.frameProgress=null;return;
      }
      this.pending.delete(data.key);
      this.busy = false;
      if (data.error) { this.error = data.error; return; }
      this.cache.set(data.key, data.result);
      while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
      this.flush();
    };
    this.worker.onerror = event => { this.error = event.message || '배선 작업자를 시작하지 못했습니다.'; };
  }
  requestFrame(player,layout){
    const recording=player.recording,prepared=layout.prepared,viewport={width:Math.max(1,Math.round(layout.viewport?.width??1)),height:Math.max(1,Math.round(layout.viewport?.height??1))},
      key=JSON.stringify([prepared?.revision??0,viewport.width,viewport.height,[...layout.collapsed].sort(),[...layout.windows].sort(([a],[b])=>a.localeCompare(b))]),
      preferences={positions:[...layout.userPositions].sort(([a],[b])=>a.localeCompare(b)),pinned:[...layout.pinned].sort()},edit=JSON.stringify(preferences),edited=preferences.positions.length>0;
    let setup;
    if(this.frameRecording!==recording||this.framePrepared!==prepared?.data||this.frameSettings!==key){
      setup={preferences:{collapsed:[...layout.collapsed],windows:[...layout.windows]},viewport,
        choices:[...prepared?.choices??[]],options:[...prepared?.options??[]]};
      this.frameEpoch++;this.frameJournal=new PresentationJournal();this.frameCache.clear();this.framePending.clear();this.frameProgress=null;
      this.frameSettings=key;
    }
    if(this.frameEdit!==edit){this.frameEdit=edit;this.frameCache.clear();this.framePending.clear();this.frameProgress=null;this.error=null;}
    const payload={type:'frame',epoch:this.frameEpoch,edit,preferences:edited?preferences:null,cursor:player.cursor,known:this.frameJournal.length};
    if(setup){payload.setup=setup;if(this.frameRecording!==recording)payload.recording={plan:recording.plan,trace:recording.trace};
      if(this.framePrepared!==prepared?.data)payload.preparedData=prepared?.data??null;
      this.frameRecording=recording;this.framePrepared=prepared?.data;
    }
    if(this.frameWanted!==player.cursor)this.framePending.clear();
    this.frameWanted=player.cursor;
    const start=2*player.cursor+1,end=start+1;
    if(!setup&&end<=this.frameJournal.length&&(!edited||this.frameCache.has(player.cursor))){
      if(!this.frameCache.has(player.cursor)){
        const before=this.frameJournal.at(start),after=this.frameJournal.at(end);
        this.frameCache.set(player.cursor,{epoch:this.frameEpoch,cursor:player.cursor,before,after,routes:[routeSnapshot(before),routeSnapshot(after)]});
        while(this.frameCache.size>8)this.frameCache.delete(this.frameCache.keys().next().value);
      }return this.frameCache.get(player.cursor);
    }
    const pendingKey=JSON.stringify([edit,player.cursor]);
    if(!this.framePending.has(pendingKey)&&!this.error){this.framePending.add(pendingKey);this.worker.postMessage(payload);}
    return null;
  }
  request(graph) {
    if (!graph.edges.length) return {paths: [], missing: [], quality: {nodeCrossings: 0, overlaps: 0}, stats: {milliseconds: 0, changed: 0, edges: 0}};
    const key = graphKey(graph);
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.pending.has(key) && !this.error) {
      this.pending.add(key); this.queue.set(key, graph);
      while (this.queue.size > 2) { const old = this.queue.keys().next().value; this.queue.delete(old); this.pending.delete(old); }
      this.flush();
    }
    return null;
  }
  flush() {
    if (this.busy || !this.queue.size || this.error) return;
    const [key, graph] = this.queue.entries().next().value;
    this.queue.delete(key); this.busy = true; this.worker.postMessage({key, graph});
  }
  reset() { this.worker.terminate(); }
}
