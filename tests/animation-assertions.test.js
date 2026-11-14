import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {conditionForEvent} from '../src/animation/conditions.js';
import {calculationForEvent,dataFlowForEvent,instructionTiming} from '../src/animation/transfers.js';
import {toolsForEvent} from '../src/animation/tools.js';
import {SceneCanvas} from '../src/animation/canvas.js';

function verifyChecks(r,expected){
 const before=JSON.stringify({plan:r.plan,trace:r.trace}),recording=createRecording(r.plan,r.trace),player=new Playback(recording),checks=r.trace.events.filter(e=>e.action==='assert.check');
 assert.deepEqual(checks.map(e=>e.assertion.result),expected.map(v=>v?'passed':'failed'));
 for(const [i,e]of checks.entries()){
  const view=conditionForEvent(recording,e);assert.equal(view.truth,expected[i]);assert.equal(view.selected,expected[i]?'검증 통과':'검증 실패');
  assert.equal(calculationForEvent(recording,e),e);assert.deepEqual(toolsForEvent(e,recording),['alu']);
  assert.ok((e.dataInputs??[]).some(id=>recording.events.get(id)?.kind==='CALC'));
  assert.deepEqual(dataFlowForEvent(recording,e),[],'the completed condition is not read or calculated again');
  assert.ok(!instructionTiming(recording,e).phases.some(p=>p.kind==='calculate'));
  player.seek(recording.eventOrder.get(e.eventId));
  const renderer=Object.create(SceneCanvas.prototype),labels=[];renderer.frameRectangle=()=>({x:0,y:0,width:400});renderer.label=text=>labels.push(text);
  renderer.drawFlow(player);assert.ok(labels.includes(view.selected));
  player.stepInstruction();assert.equal(player.cursor,recording.eventOrder.get(e.eventId)+1);
 }
 player.seek(r.trace.events.length);assert.equal(player.state.outputByChannel.get('stdout')??'',r.stdout);assert.equal(player.state.outputByChannel.get('stderr')??'',r.stderr);
 assert.equal(JSON.stringify({plan:r.plan,trace:r.trace}),before);
 return {recording,player,checks};
}

test('assert playback preserves successful checks, one-time effects and short circuit',async()=>{
 const r=await traceModel('#include <assert.h>\n#include <stdio.h>\nint main(void){int count=0,unused=0;assert(++count);assert(count || ++unused);printf("%d %d\\n",count,unused);return 0;}');
 assert.equal(r.stdout,'1 0\n');assert.equal(r.trace.exitCode,0);const {recording,checks}=verifyChecks(r,[true,true]);
 assert.ok(conditionForEvent(recording,checks[1]).parts.some(p=>p.operands.some(o=>o.skipped&&o.truth===null)));
});

test('failed assert shows the recorded result and then preserves failure output and termination',async()=>{
 const r=await traceModel('#include <assert.h>\n#include <stdio.h>\nvoid check(int value){assert(!value);}int main(void){check(0);check(1);puts("unreachable");return 0;}');
 assert.notEqual(r.trace.exitCode,0);assert.ok(r.stderr.includes('Assertion failed'));assert.equal(r.stdout,'');
 const {recording,checks}=verifyChecks(r,[true,false]),failed=checks[1];
 const failure=r.trace.events.find(e=>recording.instructions.get(e.instructionId)?.assertion?.role==='failure');
 assert.ok(failure);assert.ok(recording.eventOrder.get(failure.eventId)>recording.eventOrder.get(failed.eventId));
 // Supporting this action must not turn validation into accept-any-FLOW.
 const bad=structuredClone({plan:r.plan,trace:r.trace}),e=bad.trace.events.find(e=>e.action==='assert.check');
 e.action='unknown.flow';bad.plan.instructions.find(d=>d.id===e.instructionId).action=e.action;
 assert.throws(()=>createRecording(bad.plan,bad.trace),/지원 범위 밖/);
});
