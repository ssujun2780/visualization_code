// Sparse immutable viewer history. Values are presentation metadata only.
// Bounded checkpoints make old seeks possible without retaining full maps per
// instruction; route points and positions are retained only when they change.
export class PresentationJournal{
  constructor({interval=128,maxCheckpoints=16}={}){
    this.interval=interval;this.maxCheckpoints=maxCheckpoints;this.changes=[];this.latest=new Map();this.checkpoints=new Map([[0,new Map()]]);this.cached=null;
  }
  get length(){return this.changes.length;}
  append(next){
    const same=(a,b)=>a===b||!!a&&!!b&&typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b),set=[],remove=[];
    for(const [key,value]of next)if(!this.latest.has(key)||!same(this.latest.get(key),value))set.push([key,value]);
    for(const key of this.latest.keys())if(!next.has(key))remove.push(key);
    this.accept({set,remove});return this.length;
  }
  accept(change){
    for(const key of change.remove)this.latest.delete(key);for(const [key,value]of change.set)this.latest.set(key,value);
    this.changes.push(change);this.cached=null;
    if(this.length%this.interval===0){this.checkpoints.set(this.length,new Map(this.latest));while(this.checkpoints.size>this.maxCheckpoints)this.checkpoints.delete([...this.checkpoints.keys()].find(k=>k!==0));}
  }
  at(version){
    if(!Number.isInteger(version)||version<0||version>this.length)throw new RangeError('표시 이력 범위를 벗어났습니다.');
    if(version===this.length)return new Map(this.latest);if(this.cached?.version===version)return new Map(this.cached.value);
    const start=Math.max(...[...this.checkpoints.keys()].filter(k=>k<=version)),value=new Map(this.checkpoints.get(start));
    for(let i=start;i<version;i++){for(const key of this.changes[i].remove)value.delete(key);for(const [key,item]of this.changes[i].set)value.set(key,item);}
    this.cached={version,value};return new Map(value);
  }
}

export function layoutSnapshot(layout){
  return new Map([...layout.positions].map(([id,p])=>['p:'+id,p]).concat([...layout.previousMats].map(([id,r])=>['m:'+id,r]),[...layout.structurePlacements??[]].map(([id,b])=>['l:'+id,b]),[['move',layout.recentMove??null]]));
}
export function restoreLayout(layout,snapshot){
  layout.positions=new Map();layout.previousMats=new Map();layout.structurePlacements=new Map();layout.motionGeometry=null;
  for(const [key,value]of snapshot){if(key.startsWith('p:'))layout.positions.set(key.slice(2),value);else if(key.startsWith('m:'))layout.previousMats.set(key.slice(2),value);else if(key.startsWith('l:'))layout.structurePlacements.set(key.slice(2),value);}
  layout.recentMove=snapshot.get('move');layout.cache=new WeakMap();layout.presentedGeometry=null;layout.revision++;
}
export function routeSnapshot(snapshot){return {paths:[...snapshot].filter(([key])=>key.startsWith('w:')).map(([,path])=>path),...(snapshot.get('routing')??{missing:[],quality:{},stats:{edges:0,milliseconds:0}})};}
