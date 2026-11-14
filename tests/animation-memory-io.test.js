import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,emptyScene,applyEvent,displayScene,Playback} from '../src/animation/playback.js';
import {referenceEdges} from '../src/animation/memory.js';
import {dataFlowForEvent,transferPresentation,valueEffectForEvent} from '../src/animation/transfers.js';
import {effectForEvent,ioDisplayState,streamText} from '../src/animation/effects.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldLayout,WorldCamera} from '../src/animation/world.js';
import {hiddenStorageEndpoint} from '../src/animation/source-storage.js';

async function example(id,stdin='') {
  const file=`examples/c/animation/${id}.c`,source=await readFile(new URL(`../${file}`,import.meta.url),'utf8');
  const result=await traceModel(source,{filename:file,stdin,maxEvents:10000});
  assert.equal(result.trace.status,'completed');assert.equal(result.trace.exitCode,0);
  return {result,recording:createRecording(result.plan,result.trace)};
}

test('real heap allocation, zeroing, growing, shrinking and freeing retain recorded values and lifetimes',async()=>{
  const {result,recording}=await example('dynamic-memory'),immutable=JSON.stringify(result);
  const begins=result.trace.events.filter(e=>e.action==='object.begin'&&e.storage==='heap');
  assert.equal(begins.length,4);
  let state=emptyScene(),allocations=0,resizes=0,frees=0;
  for(const event of result.trace.events) {
    const before=state,snapshot=structuredClone(state);state=applyEvent(recording,state,event);
    const shown=displayScene(recording,state),effect=effectForEvent(recording,event);
    if(event.action==='object.begin'&&event.storage==='heap') {
      allocations++;assert.equal(before.objects.has(event.objectId),false);
      const object=shown.objects.get(event.objectId);
      if(event.copiedFrom) {
        resizes++;assert.equal(state.objects.get(event.copiedFrom.objectId).alive,false);
        assert.equal(effect.kind,'reallocate');assert.equal(effect.name,'realloc');
        const old=recording.objects.get(event.copiedFrom.objectId);
        assert.ok(effect.detail.includes(BigInt(old.address)===BigInt(event.address)?'주소 유지':'주소 변경'));
        assert.deepEqual(object.renderCells.slice(0,2).map(c=>c.value.decimal),['7','11']);
        assert.equal(object.renderCells.length,event.size/4);
        if(event.size===20)assert.ok(object.renderCells.slice(2).every(c=>c.value===null));
        assert.equal(dataFlowForEvent(recording,event)[0].from.size,event.copiedFrom.size);
      } else assert.equal(effect.kind,'allocate');
    }
    if(event.reason==='free') {
      frees++;assert.equal(state.objects.get(event.objectId).alive,false);
      assert.ok(referenceEdges(state).some(e=>e.targetObjectId===event.objectId&&e.status==='dangling'));
      assert.equal(effect.kind,'release');
    }
    const heap=[...shown.objects.values()].filter(o=>o.alive&&o.storage==='heap'&&o.renderCells);
    if(allocations===2&&resizes===0&&heap.length===2&&heap.every(o=>o.renderCells.length===3)) {
      const zero=heap.find(o=>o.initialized),raw=heap.find(o=>!o.initialized);
      assert.ok(zero.renderCells.every(c=>c.value?.decimal==='0'));
      if(!raw.observedOffsets.size)assert.ok(raw.renderCells.every(c=>c.value===null));
    }
    assert.deepEqual(before,snapshot,'event application and presentation preserve previous states');
  }
  assert.equal(resizes,2);assert.equal(frees,2);assert.equal(streamText(state,'stdout'),'7 11 11\n');
  assert.ok([...state.objects.values()].filter(o=>o.storage==='heap').every(o=>!o.alive));
  const player=new Playback(recording),resize=result.trace.events.findIndex(e=>e.copiedFrom);
  player.seek(resize);assert.equal(player.state.objects.has(result.trace.events[resize].objectId),false);
  player.seek(resize+1);assert.equal(player.state.objects.get(result.trace.events[resize].objectId).alive,true);
  player.seek(resize);assert.equal(player.state.objects.has(result.trace.events[resize].objectId),false);
  assert.equal(JSON.stringify(result),immutable);
});

test('real input, buffer effects and all output APIs use their observed ranges and channels',async()=>{
  const {result,recording}=await example('io-library','3 abc\nhello\n'),immutable=JSON.stringify(result);
  let state=emptyScene(),inputStores=0,formatted=false,overlap=false;
  const previewNames=new Set();
  for(const event of result.trace.events) {
    const old=state;state=applyEvent(recording,state,event);
    const shown=displayScene(recording,state),effect=effectForEvent(recording,event),edges=dataFlowForEvent(recording,event);
    if(effect?.name)previewNames.add(effect.name);
    if(effect?.kind==='input-store') {
      inputStores++;assert.equal(edges[0].from.id,'tool:input');
      if(event.target.size===4&&!shown.objects.get(event.target.objectId).renderCells) {
        assert.equal(shown.objects.get(event.target.objectId).initialized,true);
        assert.equal(shown.objects.get(event.target.objectId).value.decimal,'3');
      }
    }
    if(effect?.name==='snprintf'&&effect.kind==='buffer-store') {
      formatted=true;assert.equal(shown.objects.get(event.target.objectId).stringPreview,'"abc!:3"');
      assert.ok(edges.some(e=>e.from.kind==='object'&&e.from.size>0));
      assert.equal(valueEffectForEvent(event).target.size,event.target.size);
      assert.equal(old.output,state.output,'formatting to a buffer does not print');
    }
    if(effect?.name==='memmove'&&effect.kind==='copy') {
      overlap=true;assert.match(effect.detail,/겹치는/);assert.equal(edges.length,1);
      assert.equal(edges[0].from.id,edges[0].to.id);assert.equal(edges[0].from.offset,0);assert.equal(edges[0].to.offset,1);
      assert.equal(edges[0].from.size,4);assert.equal(edges[0].to.size,4);
    }
    if(event.action==='output')assert.equal(state.output,old.output+event.text);
  }
  assert.equal(inputStores,3);assert.ok(formatted&&overlap);
  for(const name of ['scanf','getchar','fgets','strcpy','strcat','memcpy','memmove','memset','snprintf','puts','fputs','putchar','fprintf'])assert.ok(previewNames.has(name),name);
  assert.equal(state.input,'3 abc\nhello\n');assert.equal(state.inputBytes,Buffer.from(state.input).toString('hex'));
  assert.equal(streamText(state,'stdout'),'abc!:3\n!!!\nhello\n');assert.equal(streamText(state,'stderr'),'len=6\n');
  assert.equal(recording.frames.size,1,'opaque library calls create no fictitious C frames');
  assert.equal(JSON.stringify(result),immutable);
});

test('existing renderer applies ranges, reallocation transfers, external results and output arrival without committing IR',async()=>{
  for(const id of ['dynamic-memory','io-library']) {
    const {result,recording}=await example(id,'3 abc\nhello\n'),player=new Playback(recording);
    const renderer=Object.create(SceneCanvas.prototype),labels=[],drawn=[];
    Object.assign(renderer,{recording,camera:new WorldCamera(),layout:new WorldLayout(),width:2400,height:2400,pixelRatio:1,
      context:new Proxy({globalAlpha:1},{get:(t,k)=>k in t?t[k]:()=>{}})});
    renderer.label=text=>labels.push(String(text));renderer.box=()=>{};renderer.routedConnection=path=>drawn.push(path);
    for(const [index,event] of result.trace.events.entries()) {
      player.seek(index);const snapshot=structuredClone(player.state);renderer.render(player);
      player.progress=0.75;labels.length=0;drawn.length=0;renderer.render(player);
      assert.deepEqual(player.state,snapshot);
      if(event.copiedFrom||['copy','write.range','input'].includes(event.action)&&event.kind==='WRITE') {
        assert.equal(renderer.transferMissing,0,event.eventId);
        const shown=displayScene(recording,player.after),edges=dataFlowForEvent(recording,event),visible=edges.filter(edge=>
          !hiddenStorageEndpoint(recording,shown,edge.from)&&!hiddenStorageEndpoint(recording,shown,edge.to));
        if(visible.length)assert.ok(drawn.length>0,event.eventId);
        else {
          assert.ok(edges.length>0&&edges.every(edge=>hiddenStorageEndpoint(recording,shown,edge.from)),event.eventId);
          assert.equal(drawn.length,0,'hidden backing storage creates no fictitious transport station');
          const written=shown.objects.get(event.target.objectId).renderCells.filter(cell=>
            cell.offset>=event.target.offset&&cell.offset<event.target.offset+event.target.size);
          assert.ok(written.length>0&&written.every(cell=>cell.value!==null),'literal copy still applies its observed write');
        }
      }
      if(event.action==='output') {
        const view=transferPresentation(recording,event,player.progress);
        player.progress=(player.timing.valueAt+100)/player.duration;
        const afterArrival=transferPresentation(recording,event,player.progress);
        assert.equal(streamText(ioDisplayState(player,afterArrival.valueReady,afterArrival.effectReady)),player.state.output+event.text);
        player.seek(index);assert.equal(ioDisplayState(player,false),player.state,'inspection does not show future output');
      }
    }
  }
});

test('different element widths, zero tails, truncated formatting and other stream writers use the same rules',async()=>{
  const result=await traceModel(`#include <stdio.h>
    #include <stdlib.h>
    #include <string.h>
    int main(void){unsigned short *q=calloc(2,sizeof *q);if(!q)return 1;q[0]=500;
      unsigned short *r=realloc(q,4*sizeof *q);if(!r){free(q);return 1;}q=r;q[1]=12;
      unsigned short a[2];memcpy(a,q,sizeof a);char b[5];
      int n=snprintf(b,sizeof b,"%u%u",(unsigned)a[0],(unsigned)a[1]);
      fwrite(b,1,4,stdout);fputc('!',stderr);free(q);return n==5?0:1;}`);
  assert.equal(result.trace.status,'completed');assert.equal(result.trace.exitCode,0);
  const recording=createRecording(result.plan,result.trace);let state=emptyScene(),resized=false,truncated=false;
  for(const e of result.trace.events){state=applyEvent(recording,state,e);const view=displayScene(recording,state),effect=effectForEvent(recording,e);
    if(e.copiedFrom){resized=true;const cells=view.objects.get(e.objectId).renderCells;
      assert.equal(cells[0].size,2);assert.deepEqual(cells.map(c=>c.value?.decimal??null),['500','0',null,null]);}
    if(effect?.kind==='buffer-store'&&effect.name==='snprintf'){truncated=true;assert.equal(view.objects.get(e.target.objectId).stringPreview,'"5001"');}
  }
  assert.ok(resized&&truncated);assert.equal(streamText(state,'stdout'),'5001');assert.equal(streamText(state,'stderr'),'!');
});

test('library range writes replace existing scalar values, including byte aliases, without changing their declared shape',async()=>{
  const result=await traceModel(`#include <stdio.h>
    #include <string.h>
    int main(void){int a=99,b=77;unsigned int c=0x11223344;unsigned char byte=0xaa;
      if(scanf("%d",&a)!=1)return 1;memset(&b,0,sizeof b);
      memcpy((unsigned char*)&c+1,&byte,1);printf("%d %d %u",a,b,c);return 0;}`,{stdin:'4'});
  assert.equal(result.trace.status,'completed');const recording=createRecording(result.plan,result.trace);
  let state=emptyScene(),checked=0;
  for(const e of result.trace.events){state=applyEvent(recording,state,e);
    if(e.kind!=='WRITE'||!['write.range','copy','fill'].includes(e.action))continue;
    const object=displayScene(recording,state).objects.get(e.target.objectId);
    const expected={a:'4',b:'0',c:String(0x1122aa44)}[object?.name];if(expected===undefined)continue;
    checked++;assert.equal(object.value?.decimal,expected);assert.equal(object.initialized,true);
    assert.equal(object.renderCells,undefined,'a byte alias does not turn a declared scalar into an array');
  }
  assert.equal(checked,3);assert.equal(state.output,`4 0 ${0x1122aa44}`);
});
