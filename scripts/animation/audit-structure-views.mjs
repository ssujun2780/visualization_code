import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {traceModel} from '../model/index.mjs';
import {inferStructures} from '../inference/structure-inference.mjs';
import {digest} from '../execution-relations/v2/common.mjs';
import {frozenInferenceExecution} from '../../tests/helpers/frozen-inference.mjs';
import {createRecording,Playback,displayScene} from '../../src/animation/playback.js';
import {createStructureViewQuery} from '../../src/animation/structure-query.js';
import {hydrateStructure,layoutStructure} from '../../src/animation/structure-shapes.js';

// Saved compiler recordings and fresh compilation are reported separately.
// Fixtures carry source hashes and independently frozen stdout expectations.
const manifest=JSON.parse(await readFile(new URL('../../tests/fixtures/inference-records/manifest.json',import.meta.url),'utf8'));
const fresh=[['tree','1 3 6 8 10 12 14 \n'],['indexed-graph','0 1 2 3 4 \n'],['stack-queue','2 5\n6 8\n9 7\n'],['grid','17 20\n'],['pointer-graph','10\n'],['pointer-network','3339\n']];
const only=process.argv.find(v=>v.startsWith('--only='))?.slice(7).split(','),cases=[...Object.keys(manifest).map(id=>({id,mode:'saved-recording'})),...fresh.map(([id,stdout])=>({id,stdout,mode:'fresh-compile'}))].filter(c=>!only||only.includes(c.id));
const report={createdAt:new Date().toISOString(),cases:[],failures:[],limits:['12 evenly spaced prefixes plus output checkpoints; at most 12 live objects per prefix','No classifier changes; no source-name selection or expected-value substitutions']};
const dir=new URL('../../test-results/structure-visualization/',import.meta.url);await mkdir(dir,{recursive:true});
for(const c of cases){
  const result={id:c.id,mode:c.mode,queries:0,shapes:0,views:{},maxNodes:0,maxEdges:0,warnings:{},checkpoints:[]},started=performance.now();
  try{
    const file=c.id==='grid'?'../../examples/c/execution-relations/work-grid.c':c.id==='pointer-network'?'../../examples/c/animation/pointer-network.c':`../../examples/c/structure-views/${c.id}.c`;
    const r=c.mode==='saved-recording'?await frozenInferenceExecution(c.id):await traceModel(await readFile(new URL(file,import.meta.url),'utf8'),{filename:`${c.id}.c`,includeObservations:true});
    if(c.mode==='fresh-compile'){assert.equal(r.trace.status,'completed');assert.equal(r.stdout,c.stdout);}
    const original=digest({plan:r.plan,trace:r.trace}),t=performance.now(),a=inferStructures(r.plan,r.trace,{observationPlan:r.observations?.plan,observedTrace:r.observations?.trace});
    result.inferenceMs=+(performance.now()-t).toFixed(1);result.inferenceStatus=a.status;result.events=r.trace.events.length;
    const unchanged=digest(a),q=createStructureViewQuery(r.plan,r.trace,a),recording=createRecording(r.plan,r.trace),player=new Playback(recording);
    const indices=[...new Set([...Array.from({length:12},(_,i)=>Math.floor(i*(r.trace.events.length-1)/11)),...r.trace.events.flatMap((e,i)=>e.action==='output'?[i]:[])])].sort((a,b)=>a-b);
    let worst=0;
    for(const i of indices){player.seek(i+1);const scene=displayScene(recording,player.state),event=r.trace.events[i],entry={cursor:i+1,eventId:event.eventId,action:event.action,shapes:[]};
      for(const object of [...scene.objects.values()].filter(o=>o.alive).sort((a,b)=>b.size-a.size).slice(0,12)){
        const t=performance.now(),p=q.project({objectId:object.id},event.eventId),shape=hydrateStructure(recording,scene,p);worst=Math.max(worst,performance.now()-t);result.queries++;
        assert.ok(p.recommendations.length<=5);
        for(const warning of p.warnings)result.warnings[warning]=(result.warnings[warning]??0)+1;
        if(!shape)continue;result.shapes++;result.views[p.view]=(result.views[p.view]??0)+1;result.maxNodes=Math.max(result.maxNodes,shape.nodes.length);result.maxEdges=Math.max(result.maxEdges,shape.edges.length);
        const layout=layoutStructure(shape);assert.equal(layout.positions.size,shape.nodes.length);assert.ok(Number.isFinite(layout.width)&&Number.isFinite(layout.height));
        const ids=new Set(shape.nodes.map(n=>n.id));for(const e of shape.edges){assert.ok(ids.has(e.from));assert.ok(ids.has(e.to));}
        for(const n of shape.nodes){const pos=layout.positions.get(n.id);assert.ok(pos.x>=0&&pos.y>=0);
          for(const f of n.fields){const o=scene.objects.get(f.objectId);assert.ok(o?.alive,'field is in live canonical storage');assert.ok(f.offset>=0&&f.offset+f.size<=o.size,'field lies in actual allocation');}
        }
        entry.shapes.push({objectId:object.id,view:p.view,nodes:shape.nodes.length,edges:shape.edges.length,omitted:shape.omitted??0,fields:shape.nodes.flatMap(n=>n.fields.map(f=>f.text)).slice(0,12)});
      }
      result.checkpoints.push(entry);
    }
    if(['pointer-graph','pointer-network'].includes(c.id)){
      const index=r.trace.events.findLastIndex(e=>e.action==='output'),at=r.trace.events[index].eventId;player.seek(index+1);const scene=displayScene(recording,player.state);result.manualProbes=[];
      for(const o of [...scene.objects.values()].filter(o=>o.alive).sort((a,b)=>b.size-a.size).slice(0,3)){
        const target={objectId:o.id};q.set(target,{view:'graph'},at);const start=performance.now(),shape=hydrateStructure(recording,scene,q.project(target,at));
        result.manualProbes.push({objectId:o.id,view:'graph',nodes:shape?.nodes.length??0,edges:shape?.edges.length??0,omitted:shape?.omitted??0,queryMs:+(performance.now()-start).toFixed(1)});
        for(const n of shape?.nodes??[])for(const f of n.fields){const object=scene.objects.get(f.objectId);assert.ok(object?.alive&&f.offset>=0&&f.offset+f.size<=object.size);}
        q.set(target,{view:'auto'},at);
      }
    }
    assert.equal(digest({plan:r.plan,trace:r.trace}),original,'canonical record immutable');assert.equal(digest(a),unchanged,'inference immutable');result.maxQueryMs=+worst.toFixed(1);
    result.status='passed';
  }catch(error){result.status='failed';result.error=error.message;report.failures.push({id:c.id,message:error.message});}
  result.elapsedMs=+(performance.now()-started).toFixed(1);report.cases.push(result);console.log(`${c.mode} ${c.id}: ${result.status} ${result.shapes} shapes ${JSON.stringify(result.views)}`);
}
report.summary={cases:report.cases.length,passed:report.cases.filter(c=>c.status==='passed').length,queries:report.cases.reduce((n,c)=>n+c.queries,0),shapes:report.cases.reduce((n,c)=>n+c.shapes,0),views:[...new Set(report.cases.flatMap(c=>Object.keys(c.views)))],maxQueryMs:Math.max(...report.cases.map(c=>c.maxQueryMs??0))};
await writeFile(new URL(only?'audit-focused.json':'audit.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
