// Playback only reads prepared presentation history. Classifiers and relation
// queries stay in the preparation worker, outside the animation frame loop.
import {structureLabels} from './structure-kinds.js';
import {prepareAppearance} from './prepared-appearance.js';
import {decodePreparedStructures} from './prepared-format.js';
export class PreparedStructures{
  constructor(data){data=decodePreparedStructures(data);this.data=data;this.tracks=new Map(data.tracks.map(t=>[t.objectId,t]));this.choices=new Map();this.options=new Map();this.layouts=new Map();this.revision=0;this.projected=new WeakMap();this.appearances=new WeakMap();this.placements=new Map(data.placements??[]);
    // Older saved recordings also get one whole-record appearance. Do not
    // mutate the archive or rerun inference when opening it.
    this.customAppearances=new Map();
    for(const t of this.tracks.values())for(const v of Object.values(t.variants))this.appearances.set(v,v.appearance?.schemaVersion===3?v.appearance:prepareAppearance(v));
  }
  setView(objectId,view){if(!this.tracks.has(objectId))return;this.choices.set(objectId,view);this.revision++;}
  setOptions(objectId,options){const value={...this.options.get(objectId),...options};for(const k of Object.keys(value))if(value[k]===undefined)delete value[k];this.options.set(objectId,value);this.revision++;}
  placementsAt(index){
    if(this.placementCache?.index===index&&this.placementCache.revision===this.revision)return this.placementCache.value;
    const value=new Map();
    for(const t of this.tracks.values()){
      const p=this.at(t.objectId,index);if(p?.layoutBoundary==null)continue;const positions=new Map(p.positions);
      for(const n of p.relation?.nodes??[])for(const r of n.ranges??[]){const point=positions.get(n.id);
        if(point&&r.offset===0&&!value.has(r.objectId))value.set(r.objectId,{x:35+point.x*3,y:70+point.y*2.5,size:r.size,boundary:p.layoutBoundary});}
    }
    this.placementCache={index,revision:this.revision,value};return value;
  }
  rangesAt(objectId,index){
    if(this.rangeCache?.index!==index||this.rangeCache?.revision!==this.revision){const ranges=new Map();
      for(const t of this.tracks.values()){const p=this.at(t.objectId,index);for(const r of [...(p?.relation?.edges??[]).map(e=>e.weightRange),...(p?.relation?.nodes??[]).flatMap(n=>[n.colorRange,n.heightRange])].filter(Boolean)){const list=ranges.get(r.objectId)??[];if(!list.some(v=>v.offset===r.offset&&v.size===r.size))list.push({...r,capacity:1});ranges.set(r.objectId,list);}}
      this.rangeCache={index,revision:this.revision,ranges};
    }return this.rangeCache.ranges.get(objectId)??null;
  }
  at(objectId,index){
    const track=this.tracks.get(objectId),choice=this.choices.get(objectId)??'auto';if(!track||choice==='boxes')return null;
    const variant=track.variants[choice]??track.variants.auto,entries=variant.entries;let lo=0,hi=entries.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(entries[mid].index<=index)lo=mid+1;else hi=mid;}
    if(!lo)return null;const entry=entries[lo-1],cached=this.projected.get(entry);if(cached?.revision===this.revision)return cached.value;
    const alias={'circular-queue':['queue','circular'],'circular-list':['linked-list','circular']},view=choice==='auto'?variant.view:alias[choice]?.[0]??choice;
    let fixed=this.appearances.get(variant);
    if(choice!=='auto'&&choice!==variant.view){const customKey=`${objectId}:${choice}`;if(!this.customAppearances.has(customKey))this.customAppearances.set(customKey,prepareAppearance({...variant,view}));fixed=this.customAppearances.get(customKey);}
    const sameShape=choice==='auto'||choice===variant.view,variantName=alias[choice]?.[1]??(sameShape?fixed.variant:undefined),circular=sameShape?fixed.circular:alias[choice]?.[1]==='circular';
    const history=fixed.history?.entries?.[lo-1],positions=history?.positions??fixed.positions??variant.positions;
    const slots=choice!=='auto'&&choice!==variant.view?undefined:fixed.slots;
    const value={...entry.presentation,view,variant:variantName,circular,directed:fixed.directed,descriptor:fixed.descriptor,label:choice==='auto'?fixed.label:structureLabels[choice]??structureLabels[view]??fixed.label,positions,slots,layoutNodes:variant.layoutNodes,
      layoutBoundary:fixed.history?.movable?history?.layoutBoundary:null,changes:history?.changes??[],...this.options.get(objectId)};
    this.projected.set(entry,{revision:this.revision,value});return value;
  }
}
