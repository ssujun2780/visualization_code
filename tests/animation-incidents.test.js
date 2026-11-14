import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRecording,Playback,displayScene} from '../src/animation/playback.js';
import {instructionTiming,transferPresentation} from '../src/animation/transfers.js';
import {SceneCanvas} from '../src/animation/canvas.js';
import {WorldLayout,WorldCamera} from '../src/animation/world.js';

const sample=JSON.parse(await readFile(new URL('../public/animation-demo.json',import.meta.url),'utf8'));
const recording=createRecording(sample.plan,sample.trace),calc=sample.trace.events.find(e=>e.kind==='CALC');
const at=(event,time)=>transferPresentation(recording,event,time/instructionTiming(recording,event).duration);

test('each transfer retains its emphasis, movement and arrival time as command size grows',()=>{
  const snapshot=JSON.stringify(sample);let previous;
  for(const count of [1,2,8,16,32]) {
    const event={...calc,eventId:`timing-${count}`,inputs:Array.from({length:count},(_,i)=>calc.inputs[i%calc.inputs.length])};
    const timing=instructionTiming(recording,event);assert.equal(timing.transfers.length,count);
    if(previous)assert.equal(timing.duration-previous.duration,(count-previous.count)*1800);
    previous={duration:timing.duration,count};
    for(const [index,t]of timing.transfers.entries()) {
      assert.equal(t.moveStart-t.start,350);assert.equal(t.arrival-t.moveStart,900);assert.equal(t.end-t.arrival,550);
      const focus=at(event,t.start+100),moving=at(event,t.moveStart+450),arrival=at(event,t.arrival+200);
      assert.equal(focus.active.index,index);assert.equal(focus.active.phase,'emphasis');assert.equal(focus.active.progress,0);
      assert.equal(moving.active.phase,'move');assert.ok(Math.abs(moving.active.progress-0.5)<1e-8);
      assert.equal(moving.inputs[index].arrived,false);assert.equal(arrival.inputs[index].arrived,true);
      assert.equal(arrival.active.index,index);assert.equal(arrival.active.phase,'arrival');
      assert.equal(arrival.arrived,index+1);assert.equal(arrival.resultReady,false);
    }
  }
  assert.equal(JSON.stringify(sample),snapshot);
});

test('all operands settle before calculation and the recorded result has its own hold before a common fade',()=>{
  const timing=instructionTiming(recording,calc),gather=timing.phases.find(p=>p.kind==='gather'),compute=timing.phases.find(p=>p.kind==='calculate');
  assert.equal(gather.end-gather.start,650);assert.equal(compute.end-compute.start,650);
  for(const time of [gather.start+100,compute.start+100]) {
    const view=at(calc,time);assert.equal(view.active,null);assert.ok(view.inputs.every(i=>i.arrived));
    assert.equal(view.resultReady,false);assert.equal(view.groupOpacity,1);
  }
  const ready=at(calc,compute.end+100);assert.equal(ready.resultReady,true);assert.equal(ready.phase,'hold');
  assert.equal(timing.fade.start-compute.end,900);assert.equal(at(calc,timing.fade.start).groupOpacity,1);
  assert.ok(Math.abs(at(calc,timing.fade.start+175).groupOpacity-0.5)<1e-8);
  assert.equal(at(calc,timing.duration).groupOpacity,0);
});

test('destination numbers wait for arrival and assignment, then remain visible without committing the IR early',()=>{
  const write=sample.trace.events.find(e=>e.kind==='WRITE'&&e.inputs?.some(i=>i.executionId===calc.eventId));
  const player=new Playback(recording);player.seek(recording.eventOrder.get(write.eventId));player.play();
  const renderer=Object.create(SceneCanvas.prototype),drawn=new Map();
  Object.assign(renderer,{recording,camera:new WorldCamera(),layout:new WorldLayout(),width:2200,height:2200,pixelRatio:1,
    context:new Proxy({globalAlpha:1},{get:(t,k)=>k in t?t[k]:()=>{}})});
  renderer.label=()=>{};renderer.box=()=>{};renderer.drawObject=o=>drawn.set(o.id,o);
  const immutable=structuredClone(player.state),timing=player.timing;
  for(const time of [timing.transfers[0].moveStart+450,timing.transfers[0].arrival+100,timing.valueAt-1,timing.valueAt+100]) {
    player.progress=time/timing.duration;drawn.clear();renderer.render(player);
    assert.equal(drawn.get(write.target.objectId).value?.decimal??null,time<timing.valueAt?null:'30');
    assert.deepEqual(player.state,immutable);
  }
  assert.equal(timing.fade.start-timing.valueAt,900);
  const visible=displayScene(recording,player.state);assert.equal(visible.objects.get(write.target.objectId).value,null);
});

test('pause and speed changes preserve the current incident without skipping its remaining time',()=>{
  const player=new Playback(recording);player.seek(recording.eventOrder.get(calc.eventId));player.play();player.advance(800);
  const before=at(calc,player.progress*player.duration);assert.equal(before.active.phase,'move');
  player.playing=false;const progress=player.progress;player.advance(100000);assert.equal(player.progress,progress);
  player.speed=4;player.play();player.advance(100);
  const after=transferPresentation(recording,player.event,player.progress);
  assert.equal(after.active.index,0);assert.equal(after.active.phase,'move');assert.equal(after.inputs[0].arrived,false);
  assert.ok(Math.abs(after.elapsed-1200)<1e-8);
});
