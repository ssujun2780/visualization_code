import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRecording,Playback} from '../src/animation/playback.js';
const sample=JSON.parse(await readFile(new URL('../public/animation-demo.json',import.meta.url),'utf8')),
  functions=JSON.parse(await readFile(new URL('../public/animation-functions.json',import.meta.url),'utf8')),
  named=(p,name)=>[...p.state.objects.values()].find(o=>o.name===name);
test('manual instruction commits the current command immediately and stays paused at any speed',()=>{
  for(const speed of [.25,1,10]){
    const p=new Playback(createRecording(sample.plan,sample.trace));p.seek(3);p.speed=speed;p.play();p.advance(p.duration*.4/speed);
    assert.equal(named(p,'a').value,null);p.stepInstruction();assert.equal(p.cursor,4);assert.equal(p.progress,0);assert.equal(p.playing,false);assert.equal(named(p,'a').value.decimal,'10');assert.equal(named(p,'b'),undefined);
    p.advance(1e6);assert.equal(p.cursor,4);p.stepInstruction();assert.equal(p.cursor,5);assert.equal(named(p,'b').value,null);
  }
});
test('manual line applies the whole compound expression once, preserving original recording',()=>{
  const original=JSON.stringify(sample),p=new Playback(createRecording(sample.plan,sample.trace));p.seek(6);p.play();p.stepLine();
  assert.equal(p.cursor,11);assert.equal(p.playing,false);assert.equal(named(p,'c').value.decimal,'30');assert.equal(p.state.frames.get('f1').alive,true);assert.equal(JSON.stringify(sample),original);
});
test('manual line stops at function activation boundaries and can continue through return delivery',()=>{
  const p=new Playback(createRecording(functions.plan,functions.trace));p.seek(6);p.stepLine();assert.equal(p.cursor,10);assert.equal(named(p,'c').value,null);
  p.stepLine();assert.equal(p.cursor,16);assert.equal(p.state.frames.get('f2').alive,true);
  p.stepLine();assert.equal(p.cursor,22);assert.equal(named(p,'c').value,null);
  p.stepLine();assert.equal(p.cursor,24);assert.equal(named(p,'c').value.decimal,'30');assert.equal(p.playing,false);
});
test('manual stepping cannot pass a fatal error or restart a completed/input-waiting recording',()=>{
  const fault={eventId:'fatal',instructionId:'fatal-instruction',kind:'ERROR',action:'fault',phase:'fault',activationId:'f1',diagnostic:{code:'test-fatal',message:'fatal'},source:{file:'main.c',line:5}},
    plan={...sample.plan,instructions:[...sample.plan.instructions,{id:fault.instructionId,kind:'ERROR',action:'fault',source:fault.source}]},
    trace={...sample.trace,status:'fault',events:[...sample.trace.events.slice(0,4),fault,...sample.trace.events.slice(4)]},p=new Playback(createRecording(plan,trace));
  p.seek(4);p.stepLine();assert.equal(p.faultEvent.eventId,'fatal');assert.equal(named(p,'b'),undefined);const at=p.cursor;p.stepInstruction();p.stepLine();assert.equal(p.cursor,at);
  const end=new Playback(createRecording(sample.plan,sample.trace));end.seek(sample.trace.events.length);end.stepInstruction();end.stepLine();assert.equal(end.cursor,14);assert.equal(end.playing,false);
  end.inputRequest={id:1};assert.equal(end.waitingForInput,true);end.stepLine();assert.equal(end.waitingForInput,true);assert.equal(end.cursor,14);
});
