import {WorldLayout} from './world.js';
import {ToolFollower} from './tool-placement.js';
import {pointerGraph} from './pointer-graph.js';
import {layoutSnapshot,restoreLayout,routeSnapshot} from './presentation-journal.js';

// Manual coordinates are an overlay on an immutable chronological frame.
// Every lookup starts from that SAME frame, never the last visited frame.
export function revisePresentation(recording,cursor,states,snapshots,options,wiringFactory){
  const {prepared,viewport,collapsed,windows,preferences}=options,layout=new WorldLayout();
  layout.resolveType=recording.resolveType;layout.viewport=viewport;layout.setPrepared(prepared);
  layout.collapsed=new Set(collapsed);layout.windows=new Map(windows);
  const positions=[...preferences.positions??[]].sort(([a],[b])=>a.localeCompare(b)),pinned=new Set(preferences.pinned??[]),frames=[],routes=[];
  for(let i=0;i<2;i++){
    const state=states[i],baseline=snapshots[i];restoreLayout(layout,baseline);
    layout.pinned=new Set();
    const oldGeometry=layout.resolve(state),oldGraph=pointerGraph(state,oldGeometry),oldRoutes=routeSnapshot(baseline);
    restoreLayout(layout,baseline);layout.pinned=new Set(pinned);
    for(const [key,point]of positions)layout.positions.set(key,{...point});
    layout.recentMove=null;
    // Existing collision rules preserve unaffected boxes; the auto tool yields
    // locally when operands have moved, while manually pinned tools stay put.
    new ToolFollower(layout).update(recording,recording.trace.events[cursor],states[0]);
    let result;
    for(let attempt=0;attempt<=2;attempt++){
      const geometry=layout.resolve(state),graph=pointerGraph(state,geometry,layout.pinned),wiring=wiringFactory();
      try{result=wiring.revise(oldGraph,graph,baseline,oldRoutes.paths);}finally{wiring.dispose();}
      const newlyMissing=result.missing.filter(id=>!oldRoutes.missing.includes(id));
      if(!newlyMissing.length||attempt===2)break;
      const affected=graph.edges.filter(e=>newlyMissing.includes(e.id)).flatMap(e=>[e.sourceObjectId,e.targetObjectId]);
      if(!layout.openCorridor(state,affected,18))break;
    }
    frames.push(layoutSnapshot(layout));routes.push(result);
  }
  return {cursor,before:frames[0],after:frames[1],routes};
}
