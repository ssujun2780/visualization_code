// Renderer QA input, using actual compiler/runtime observations and explicit
// supplied role bindings. This is NOT an inference accuracy test or classifier.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {traceModel} from '../model/index.mjs';
import {createRecording,emptyScene,applyEvent,displayScene} from '../../src/animation/playback.js';
import {referenceEdges} from '../../src/animation/memory.js';
import {prepareAppearance} from '../../src/animation/prepared-appearance.js';

const source=await readFile('tests/fixtures/structure-transition-view.c','utf8'),r=await traceModel(source),recording=createRecording(r.plan,r.trace),
  pool=r.trace.objects.find(o=>o.name==='nodes'),rootObject=r.trace.objects.find(o=>o.name==='root'),seenObject=r.trace.objects.find(o=>o.name==='seen'),
  type=recording.resolveType(pool.cType.elementType),stride=type.sizeBits/8,field=name=>(type.members??type.fields).find(f=>f.name===name),
  offset=name=>(field(name).offsetBits??field(name).bitOffset??field(name).offset)/8,entries=[],all=new Map();
if(r.trace.status!=='completed')throw new Error('Fixture must complete normally.');
let state=emptyScene();
for(const [index,event]of r.trace.events.entries()){
  state=applyEvent(recording,state,event);const object=state.objects.get(pool.id);if(!object?.alive)continue;
  const rows=[],edges=[],references=referenceEdges(state),visible=displayScene(recording,state).objects.get(pool.id),read=(i,name)=>visible.renderCells?.find(c=>c.offset===i*stride+offset(name))?.value?.decimal;
  for(let i=0;i<3;i++){
    const id='node:'+i,shade=read(i,'shade'),visited=state.objects.get(seenObject.id)?.cells.get(i*4)?.value?.decimal,
      n={id,index:i,label:read(i,'key')??String(i),ranges:[{objectId:pool.id,offset:i*stride,size:stride}],color:shade==='4'?'black':shade==='9'?'red':undefined,
        colorRange:{objectId:pool.id,offset:i*stride+offset('shade'),size:4},visited:visited===undefined?undefined:visited!=='0',visitedRange:{objectId:seenObject.id,offset:i*4,size:4}};
    rows.push(n);all.set(id,n);
    for(const name of ['lo','hi']){const at=i*stride+offset(name),edge=references.find(e=>e.sourceObjectId===pool.id&&e.sourceOffset===at&&e.targetObjectId===pool.id);
      if(edge)edges.push({id:`${id}:${name}`,from:id,to:'node:'+Math.floor(edge.targetOffset/stride),storedEdgeIds:[edge.id],roleId:name});}
  }
  const root=state.objects.get(rootObject.id)?.cells.get(0)?.value?.reference,rootNode=root?.targetObjectId===pool.id?'node:'+Math.floor(root.targetOffset/stride):null;
  entries.push({index,presentation:{view:'red-black',label:'자료구조 변화 확인',descriptor:{objectId:pool.id},afterExecutionId:event.eventId,diagramOwnerObjectId:pool.id,
    relation:{id:'renderer-check',nodes:rows,edges,rootNodeIds:rootNode?[rootNode]:[]}}});
}
const variant={view:'red-black',label:'자료구조 변화 확인',layoutNodes:[...all.values()],entries};variant.appearance=prepareAppearance(variant);variant.positions=variant.appearance.positions;
const output={plan:r.plan,trace:r.trace,preparedScene:{schemaVersion:1,programId:r.plan.programId,runId:r.trace.runId,eventCount:r.trace.events.length,tracks:[{objectId:pool.id,variants:{auto:variant}}],placements:[]}};
await mkdir('test-results/structure-transitions',{recursive:true});await writeFile('test-results/structure-transitions/view-recording.json',JSON.stringify(output));
console.log(JSON.stringify({events:r.trace.events.length,pool:pool.id,stride,type,offsets:['key','shade','lo','hi'].map(n=>[n,offset(n)]),interesting:r.trace.events.map((e,i)=>({i,kind:e.kind,target:e.target,source:e.source})).filter(e=>e.kind==='WRITE'&&[pool.id,rootObject.id,seenObject.id].includes(e.target?.objectId)).map(e=>({i:e.i,target:e.target,line:e.source?.line}))},null,2));
