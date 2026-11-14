import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {traceModel} from '../scripts/model/index.mjs';
import {analyzeRecordingWork} from '../scripts/animation/work-analysis.mjs';
import {analyzeRecordingWorkAsync} from '../scripts/animation/work-analysis-client.mjs';
import {collectCompilerFacts} from '../scripts/animation/compiler-facts.mjs';
import {createV2Query} from '../scripts/execution-relations/v2/query.mjs';
import {sha256} from '../scripts/execution-relations/v2/sha256.mjs';
import {digest} from '../scripts/execution-relations/v2/common.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {currentWorkView} from '../src/animation/work-context.js';
import {loopNavigation} from '../scripts/animation/loop-navigation.mjs';

// Predictions frozen before running: no classifier uses these names/numbers.
const cases=[{id:'merge',stdout:'1 2 3 5 6 7 ',arrayCount:2,hasCopy:true},
  {id:'graph',stdout:'0 9 7\n',arrayCount:2,pointer:true},
  {id:'grid',stdout:'17 20\n',arrayCount:2,multi:true}];
test('portable snapshot hashing matches Node including Unicode and chunk boundaries',()=>{
  for(const s of ['', 'abc', '한글😀'.repeat(100), 'a'.repeat(65537)]){
    const h=sha256();for(const char of s)h.update(char);
    assert.equal(h.digest(),createHash('sha256').update(s).digest('hex'));
    const full=sha256();full.update(s);assert.equal(full.digest(),createHash('sha256').update(s).digest('hex'));
  }
  assert.equal(digest({z:'문자',a:[1,2]}),createHash('sha256').update('{"a":[1,2],"z":"문자"}').digest('hex'));
});
test('optional analysis deadline preserves canonical recording and reports its own failure',async()=>{
  const raw=JSON.parse(await readFile('public/animation-demo.json','utf8')),before=JSON.stringify(raw);
  const a=await analyzeRecordingWorkAsync(raw.plan,raw.trace,{timeoutMs:1});
  assert.equal(a.relations,null);assert.match(a.diagnostics[0].message,/시간 제한/);assert.equal(JSON.stringify(raw),before);
});
for(const c of cases)test(`current-work sidecar and timing: ${c.id}`,{timeout:60000},async()=>{
  const file=`examples/c/execution-relations/work-${c.id}.c`,source=await readFile(file,'utf8'),raw=await traceModel(source,{filename:file,includeObservations:true});
  assert.ok(raw.plan,JSON.stringify(raw.trace.diagnostics));assert.equal(raw.trace.status,'completed',JSON.stringify(raw.trace.diagnostics));assert.equal(raw.stdout,c.stdout);
  const before=digest({plan:raw.plan,trace:raw.trace}),start=performance.now(),analysis=analyzeRecordingWork(raw.plan,raw.trace,{ast:raw.ast,observations:raw.observations}),ms=performance.now()-start;
  assert.equal(digest({plan:raw.plan,trace:raw.trace}),before);assert.equal(analysis.relations.status,'completed',JSON.stringify(analysis.relations.diagnostics));
  assert.ok(analysis.compilerFacts.expressionOwners.length);assert.equal(analysis.compilerFacts.coverage.sourceSemanticScans,0);
  const q=createV2Query(raw.plan,raw.trace,analysis.relations,{compilerFacts:analysis.compilerFacts,structureInference:analysis.structureInference}),recording=createRecording(raw.plan,raw.trace),player=new Playback(recording);
  let writes=0,copies=0,multi=0,pointers=0,grids=0,bindings=0,maxArrays=0,graphs=0;
  const indices={};let earlierGraph;
  for(let i=0;i<raw.trace.events.length;i++){
    player.seek(i);const e=player.event,ctx={before:q.before(e.eventId),after:q.at(e.eventId)},initial=currentWorkView(player,ctx);
    player.progress=0.99;const final=currentWorkView(player,ctx,{analysis});if(final.graph){graphs++;if(!earlierGraph)earlierGraph={cursor:i,graph:structuredClone(final.graph)};}
    maxArrays=Math.max(maxArrays,final.cards.filter(c=>c.totalCells>1).length);
    for(const target of final.targets)assert.ok(target.offset>=0&&target.offset+target.size<=rObject(target.objectId).size);
    assert.deepEqual(player.recording.trace.events,raw.trace.events);assert.equal(player.cursor,i);
    for(const card of final.cards){assert.ok(raw.trace.objects.some(o=>o.id===card.id));if(card.structureBindings.length)bindings++;
      if(card.cells.some(cell=>/\[\d+\]\[\d+\]/.test(cell.path??'')))grids++;
      if(card.cells.some(cell=>cell.value?.reference?.targetObjectId))pointers++;
    }
    if(e.kind==='WRITE'&&e.target?.objectId&&e.value){writes++;assert.equal(initial.operation.result,null);assert.equal(final.operation.result,String(e.value.decimal??e.value.number??e.value.address??e.value.literal??e.value.signed??e.value.unsigned??'?'));const a=initial.cards.find(x=>x.id===e.target.objectId)?.cells.find(x=>x.offset===e.target.offset),b=final.cards.find(x=>x.id===e.target.objectId)?.cells.find(x=>x.offset===e.target.offset);
      if(b){assert.equal(b.text,String(e.value.decimal??e.value.number??e.value.address??e.value.literal??e.value.signed??e.value.unsigned??'?'));if(a?.text!==b.text)indices.write??=i;}
    }
    if(e.kind==='CALC'&&final.targets.filter(t=>t.role==='read').length>=3){multi++;indices.calc??=i;assert.equal(initial.operation.result,null);assert.notEqual(final.operation.result,null);}
    if(ctx.after.transfers.some(t=>t.kind==='storage-copy'&&new Set(t.participants.filter(p=>p.kind==='storage'&&raw.trace.objects.find(o=>o.id===p.objectId)?.cType?.kind==='array').map(p=>p.objectId)).size>=2)){copies++;indices.copy??=i;}
  }
  assert.ok(writes);assert.ok(maxArrays>=c.arrayCount);if(c.hasCopy)assert.ok(copies);if(c.pointer){assert.ok(pointers);assert.ok(graphs);}if(c.multi){assert.ok(multi);assert.ok(grids);}
  function rObject(id){return raw.trace.objects.find(o=>o.id===id);}
  if(earlierGraph){player.seek(earlierGraph.cursor);player.progress=0.99;const id=player.event.eventId;
    assert.deepEqual(currentWorkView(player,{before:q.before(id),after:q.at(id)},{analysis}).graph,earlierGraph.graph);}
  const directory=`test-results/execution-work-views/${c.id}`;await mkdir(directory,{recursive:true});
  await writeFile(`${directory}/recording.json`,JSON.stringify({plan:raw.plan,trace:raw.trace,navigation:loopNavigation(raw.plan,{ast:raw.ast,source}),workAnalysis:analysis}));
  await writeFile(`${directory}/verification.json`,JSON.stringify({prediction:c,actual:{stdout:raw.stdout,events:raw.trace.events.length,writes,copies,multi,pointers,grids,graphs,maxArrays,bindings,analysisMs:ms,compilerDomains:analysis.compilerFacts.domains.length,compilerRegions:analysis.compilerFacts.regions.length,indices},status:'passed'},null,2));
});

test('compiler adapter proves simple affine loops and rejects index mutation/conversion', {timeout:30000},async()=>{
  const source=`int traverse(int *p,int lo,int hi){for(int k=lo;k<hi;k++){p[k]=p[k]+1;}return p[0];}
int irregular(int *p,int lo,int hi){for(int k=lo;k<hi;k++){p[k]=p[k]+1;k++;}return 0;}
int narrowed(int *p,int lo,int hi){for(int k=lo;k<hi;k++){p[(unsigned char)k]=1;}return 0;}
int complex_bound(int *p,int lo,int hi){for(int k=lo;k<hi+1;k++){p[k]=1;}return 0;}
int aliased_index(int *p,int lo,int hi){for(int k=lo;k<hi;k++){int *q=&k;*q+=1;p[k]=1;}return 0;}
int main(void){int values[4]={1,2,3,4};return traverse(values,0,4);}`;
  const raw=await traceModel(source),facts=collectCompilerFacts(raw.plan,{ast:raw.ast}),fn=raw.plan.functions.find(f=>f.name==='traverse');
  assert.equal(facts.domains.length,2);assert.ok(facts.domains.every(d=>d.functionId===fn.id));assert.ok(facts.regions.some(r=>r.entryEdges?.length&&r.exitEdges?.length));
  const analysis=analyzeRecordingWork(raw.plan,raw.trace,{compilerFacts:facts}),q=createV2Query(raw.plan,raw.trace,analysis.relations,{compilerFacts:facts,structureInference:analysis.structureInference});
  assert.equal(analysis.relations.capabilities.bounds.status,'completed');assert.ok(analysis.relations.relations.some(r=>r.kind==='bounded-domain'));
  for(const e of raw.trace.events.filter(e=>e.action==='branch'&&e.condition?.unsigned==='0'))assert.equal(q.at(e.eventId).workScopes.filter(s=>s.kind==='iteration').length,0);
  assert.equal(collectCompilerFacts(raw.plan).regions.length,0);
});
