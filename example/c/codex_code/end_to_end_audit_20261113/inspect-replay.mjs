import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {decodeExecution} from '../../../../scripts/shared/execution-format.mjs';
import {createRecording,Playback,displayScene,emptyScene,applyEvent} from '../../../../src/animation/playback.js';
import {PreparedStructures} from '../../../../src/animation/prepared-structures.js';
import {WorldLayout,WorldCamera} from '../../../../src/animation/world.js';
import {SceneCanvas} from '../../../../src/animation/canvas.js';
import {dataFlowForEvent} from '../../../../src/animation/transfers.js';
import {hiddenStorageEndpoint} from '../../../../src/animation/source-storage.js';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const base=path.join(root,'test-results/codex_code-results/end_to_end_audit_20261113');
const id=process.argv[2],dir=path.join(base,id);
const r=decodeExecution(JSON.parse(gunzipSync(await fs.readFile(path.join(dir,'execution.json.gz')))));
const prepared=JSON.parse(gunzipSync(await fs.readFile(path.join(dir,'prepared.json.gz'))));
const recording=createRecording(r.plan,r.trace),player=new Playback(recording),layout=new WorldLayout();
layout.resolveType=recording.resolveType;layout.setPrepared(new PreparedStructures(prepared));
const renderer=Object.create(SceneCanvas.prototype);
Object.assign(renderer,{recording,layout,camera:new WorldCamera(),width:1600,height:1000,pixelRatio:1,
 context:new Proxy({globalAlpha:1},{get:(t,k)=>k in t?t[k]:()=>{}})});
renderer.label=()=>{};renderer.box=()=>{};renderer.routedConnection=()=>{};renderer.drawObject=()=>{};
const issues=[],sampled=[],times=[];
let state=emptyScene(),compared=0;
for(const e of r.trace.events){
 if(e.kind==='READ'&&e.target?.objectId&&e.value?.bits){
  const o=state.objects.get(e.target.objectId),c=o?.cells.get(e.target.offset??0);
  if(!o?.alive)issues.push({kind:'read-lifetime',eventId:e.eventId,target:e.target});
  if(c?.value?.bits&&c.size===e.target.size){
   compared++;
   if(c.value.bits.toLowerCase()!==e.value.bits.toLowerCase())issues.push({kind:'read-differs-from-playback-memory',eventId:e.eventId,target:e.target,previous:c.value,observed:e.value,previousEvent:c.observedAt});
  }
 }
 state=applyEvent(recording,state,e);
}
const byAction=new Map();
for(const [i,e]of r.trace.events.entries()){
 if(!dataFlowForEvent(recording,e).length)continue;
 const key=e.kind+'/'+e.action,indices=byAction.get(key)??[];indices.push(i);byAction.set(key,indices);
}
const indices=new Set();
for(const list of byAction.values())for(const n of [0,1,Math.floor(list.length/3),Math.floor(list.length*2/3),list.length-2,list.length-1])if(list[n]!==undefined)indices.add(list[n]);
for(const i of [...indices].sort((a,b)=>a-b)){
 player.seek(i);const e=player.event,before=displayScene(recording,player.state),after=displayScene(recording,player.after);
 const edges=dataFlowForEvent(recording,e).filter(edge=>!hiddenStorageEndpoint(recording,after,edge.from)&&!hiddenStorageEndpoint(recording,after,edge.to));
 const start=performance.now();
 try{
  renderer.drawDataFlow(player,before,after);renderer.drawFlow(player);
  if(renderer.transferMissing)issues.push({kind:'missing-transfer-route',eventId:e.eventId,action:e.kind+'/'+e.action,missing:renderer.transferMissing,edges});
 }catch(error){issues.push({kind:'drawing-exception',eventId:e.eventId,error:error.stack});}
 times.push({eventId:e.eventId,ms:performance.now()-start,edges:edges.length});
 sampled.push({eventId:e.eventId,action:e.kind+'/'+e.action,edges:edges.length});
}
const report={id,comparedReads:compared,sampledEvents:sampled.length,issues,sampled,slowest:times.sort((a,b)=>b.ms-a.ms).slice(0,6)};
await fs.writeFile(path.join(dir,'replay-inspection.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({id,compared,sampled:sampled.length,issues:issues.map(e=>[e.kind,e.eventId]),slowest:report.slowest[0]}));
