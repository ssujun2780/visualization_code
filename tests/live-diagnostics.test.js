import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLiveDiagnostics} from '../src/live-diagnostics.js';

function setup(){
  let now=0,serial=0;const timers=new Map(),workers=[],results=[],states=[];
  const advance=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now&&timers.delete(id))t.fn();};
  const controller=createLiveDiagnostics({delay:10,timeout:100,
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id;},clearTimer:id=>timers.delete(id),
    createWorker:()=>{const w={sent:[],postMessage(m){this.sent.push(m);},terminate(){this.stopped=true;}};workers.push(w);return w;},
    publish:items=>results.push(items),status:(...args)=>states.push(args)});
  const reply=(worker,job,items)=>worker.onmessage({data:{id:job.id,type:'result',items}});
  return {controller,advance,workers,results,states,reply};
}
test('typing coalesces into one analysis and late results cannot restore old warnings',()=>{
  const s=setup();s.controller.update('a');s.controller.update('ab');s.advance(10);
  const w=s.workers[0];assert.deepEqual(w.sent.map(j=>j.code),['ab']);
  s.controller.update('new');s.advance(10);assert.equal(w.sent.length,1);
  s.reply(w,w.sent[0],[{message:'stale'}]);assert.deepEqual(s.results.at(-1),[]);
  assert.deepEqual(w.sent.map(j=>j.code),['ab','new']);
  s.reply(w,w.sent[1],[{message:'current'}]);assert.deepEqual(s.results.at(-1),[{message:'current'}]);
});
test('empty code and disposal clear or cancel pending checks',()=>{
  const s=setup();s.controller.update('code');s.advance(10);s.controller.update('');
  s.reply(s.workers[0],s.workers[0].sent[0],[{message:'stale'}]);s.advance(20);
  assert.deepEqual(s.results.at(-1),[]);assert.equal(s.states.at(-1)[0],'idle');
  s.controller.update('next');s.controller.dispose();s.advance(20);
  assert.equal(s.workers[0].sent.length,1);assert.ok(s.workers[0].stopped);
});
test('timed out analysis is replaced and old worker errors do not stop its replacement',()=>{
  const s=setup();s.controller.update('slow');s.advance(10);s.controller.update('latest');s.advance(10);s.advance(90);
  assert.ok(s.workers[0].stopped);assert.equal(s.workers[1].sent[0].code,'latest');
  s.workers[0].onerror({message:'late error'});assert.ok(!s.workers[1].stopped);
  s.reply(s.workers[1],s.workers[1].sent[0],[]);assert.equal(s.states.at(-1)[0],'done');
});
