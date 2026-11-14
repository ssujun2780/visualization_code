import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRecording,Playback} from '../src/animation/playback.js';

const sample=JSON.parse(await readFile(new URL('../public/animation-demo.json',import.meta.url),'utf8'));
const recording=createRecording(sample.plan,sample.trace);

// Use the same wall-time budget as the UI. Dividing the remaining command
// time by a slider rate and multiplying it back can lose a floating-point ULP.
function replay(player,changeSpeed=false){
  let seed=37,frames=0;player.play();
  while(player.event&&frames++<1000000){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    if(changeSpeed&&frames%37===0)player.speed=(1+seed%40)/10;
    const elapsed=12+(seed%16000)/1000;
    const budget=(1-player.progress)*player.duration/player.speed;
    player.advance(Math.min(elapsed,budget));
    assert.ok(!player.event||player.progress<1,`stuck at command ${player.cursor}, speed ${player.speed}`);
  }
  assert.equal(player.event,null,'all instructions must complete with variable frame times');
  assert.equal(player.playing,false);
}

test('every slider rate completes commands with frame-sized boundary budgets',()=>{
  const expected=new Playback(recording);expected.seek(sample.trace.events.length);
  for(let rate=1;rate<=40;rate++){
    const player=new Playback(recording);player.speed=rate/4;replay(player);
    assert.deepEqual(player.state,expected.state,`recorded state at ${rate/4}x`);
  }
});

test('changing speed inside transfer incidents never leaves a completed command uncommitted',()=>{
  const player=new Playback(recording);replay(player,true);
  const expected=new Playback(recording);expected.seek(sample.trace.events.length);
  assert.deepEqual(player.state,expected.state);
});

test('an already completed boundary recovers with zero elapsed time exactly once',()=>{
  const write=sample.trace.events.findIndex(e=>e.kind==='WRITE');
  const player=new Playback(recording);player.seek(write);player.play();player.progress=1;
  player.advance(0);assert.equal(player.cursor,write+1);assert.equal(player.progress,0);
  const state=player.state;player.advance(0);
  assert.equal(player.cursor,write+1);assert.equal(player.state,state);
});

test('a paused boundary stays paused and real remaining animation time is retained',()=>{
  const player=new Playback(recording);player.seek(3);player.progress=1;
  const state=player.state;player.advance(0);assert.equal(player.cursor,3);assert.equal(player.state,state);
  player.seek(3);player.speed=1.3;player.play();
  player.advance((player.duration-0.001)/player.speed);
  assert.equal(player.cursor,3);assert.ok(player.progress<1);
  player.advance(0.001/player.speed);assert.equal(player.cursor,4);
});
