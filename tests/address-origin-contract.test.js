import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {traceModel} from '../scripts/model/index.mjs';
import {validateIRTrace} from '../scripts/model/ir-schema.mjs';
import {inferExecutionRelations,createExecutionWorkQuery,validateExecutionRelations} from '../scripts/execution-relations/index.mjs';
import {createRecording,Playback} from '../src/animation/playback.js';
import {dataFlowForEvent,transferPresentation} from '../src/animation/transfers.js';
import {currentWorkView} from '../src/animation/work-context.js';
import {digest} from '../scripts/execution-relations/v2/common.mjs';

const analyze=(r,trace=r.trace)=>inferExecutionRelations(r.plan,trace,{outputSchemaVersion:2});
const rootWarnings=a=>a.provenance.nodes.filter(n=>n.id.startsWith('v:')&&n.unresolved.some(x=>/^unresolved-(value|callee)-operand$/.test(x)));

test('elided address operands cross model, provenance and arrows without new commands', {timeout:60000},async()=>{
  // Independent oracle: no dereference/copy is performed by passing addresses.
  // Mutations occur only inside bump/move, and discard's 17 is not its argument.
  const source=`#include <stdio.h>
  #include <stdlib.h>
  int global[4]={20,21,22,23};
  struct Bundle{int pad;int cells[4];};
  void bump(int *p,int v){*p+=v;}
  void move(int **slot){*slot+=1;}
  int *identity(int *p){return p;}
  int discard(int *p){return 17;}
  int main(void){
    int local[6]={3,6,1,8,0,0};struct Bundle box={-1,{5,7,9,11}};int j=2;int *cursor=local;
    bump(local,1);bump(&local[j],2);bump(&box.cells[1],3);bump(global,4);
    bump(cursor+1,5);move(&cursor);bump(identity(local+3),6);identity(local);
    bump(&identity(local)[5],12);
    void (*callback)(int*,int)=bump;callback(&local[4],9);
    int *routes[2]={local,box.cells};bump(routes[1]+2,10);
    int *heap=calloc(4,sizeof(int));if(!heap)return 1;bump(heap+1,7);
    int answer=discard(global);
    printf("%d %d %d %d %d %d %d %d %d %d %d\\n",local[0],local[1],local[2],local[3],local[4],box.cells[1],box.cells[2],global[0],heap[1],answer,local[5]);
    free(heap);return 0;
  }`;
  const r=await traceModel(source,{includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.stdout,'4 11 3 14 9 10 19 24 7 17 12\n');validateIRTrace(r.plan,r.trace);
  const fingerprint=digest(r.trace),a=analyze(r);assert.equal(a.status,'completed',JSON.stringify(a.diagnostics));assert.deepEqual(rootWarnings(a),[]);
  const recording=createRecording(r.plan,r.trace),player=new Playback(recording),query=createExecutionWorkQuery(r.plan,r.trace,a,{schemaVersion:2});
  const parameters=r.trace.events.filter(e=>e.action==='argument'&&e.value?.reference?.targetObjectId);
  assert.ok(parameters.length>=12);let folded=0,constant=0;
  for(const e of parameters){const input=e.inputs[0],edges=dataFlowForEvent(recording,e);assert.equal(edges.length,1,JSON.stringify(e));assert.equal(edges[0].to.id,e.target.objectId);
    if(recording.events.get(input.executionId)?.action==='object.begin')assert.equal(edges[0].addressSource,'address-of');
    if(input.addressOrigin){folded++;const origin=input.addressOrigin;assert.equal(input.executionId,null);assert.equal(edges[0].role,'address-origin');assert.ok(['address-of','pointer-base'].includes(edges[0].addressSource));
      assert.deepEqual(origin.controlInputs,[]);assert.deepEqual(origin.calleeInputs,[]);
      if(origin.observationKind==='call-argument')constant++;
      else assert.ok(!r.trace.events.some(x=>x.kind==='CALC'&&x.observationIds.includes(origin.observationId)),'no separate calculation for elided address');
      const p=a.provenance.nodes.find(n=>n.executionId===e.eventId&&n.transform==='address');assert.ok(p);assert.deepEqual(p.unresolved,[]);
      const history=query.origins(e.eventId,{atExecutionId:e.eventId,roles:['value','address']});assert.ok(history.nodes.some(n=>n.id===p.id));
      const index=r.trace.events.indexOf(e);player.seek(index);const before=currentWorkView(player);assert.ok(!before.targets.some(t=>t.objectId===input.value.reference.targetObjectId&&t.role==='read'),'address anchor is not an array READ');
      assert.equal(transferPresentation(recording,e,0).valueReady,false);assert.equal(transferPresentation(recording,e,.99).valueReady,true);
    }
  }
  assert.ok(folded>=4);assert.ok(constant>=2);
  const returnedBase=r.trace.events.find(e=>e.action==='argument'&&e.inputs[0]?.addressOrigin?.dataInputs.some(id=>recording.events.get(id)?.action==='resume'));
  assert.ok(returnedBase);const resume=recording.events.get(returnedBase.inputs[0].addressOrigin.dataInputs.find(id=>recording.events.get(id)?.action==='resume')),
    returned=recording.events.get(resume.returnExecutionId),end=r.trace.events.find(e=>e.action==='frame.end'&&e.frameId===returned.activationId);
  assert.ok(returned.delivery.receivers.some(receiver=>receiver.executionId===returnedBase.eventId));assert.ok(r.trace.events.indexOf(end)>r.trace.events.indexOf(returnedBase));
  const stored=r.trace.events.find(e=>e.kind==='WRITE'&&recording.objects.get(e.target?.objectId)?.name==='answer'),history=query.origins(stored.eventId,{atExecutionId:stored.eventId});
  assert.ok(history.nodes.some(n=>recording.events.get(n.executionId)?.action==='return.value'));assert.ok(!history.nodes.some(n=>recording.events.get(n.executionId)?.action==='argument'));
  assert.equal(digest(r.trace),fingerprint,'analysis and rendering do not mutate the recording');
  const broken=structuredClone(r.trace),operand=broken.events.find(e=>e.action==='argument'&&e.inputs[0]?.addressOrigin?.observationKind==='elided-calculation').inputs[0];
  delete operand.addressOrigin;assert.ok(rootWarnings(analyze(r,broken)).length,'unbound observations remain warnings without explicit evidence');
  const future=structuredClone(r.trace),bad=future.events.find(e=>e.action==='argument'&&e.inputs[0]?.addressOrigin).inputs[0];bad.addressOrigin.addressInputs=[future.events.at(-1).eventId];
  assert.throws(()=>validateIRTrace(r.plan,future),/주소 계산/);assert.equal(analyze(r,future).status,'failed');
  const forged=structuredClone(a);forged.provenance.nodes.find(n=>n.addressOriginRef).addressOriginRef.inputIndex=999;
  assert.throws(()=>validateExecutionRelations(r.plan,r.trace,forged),/주소 출처/);
});

test('matrix/struct offsets and one-past global identity survive constant and dynamic addresses', {timeout:60000},async()=>{
  const source=`#include <stdio.h>
  int first[3]={8,4,2};int adjacent[3]={9,5,1};
  void inspect(int *p){} void set(int*p){*p=31;}
  struct Item{int key;int data[3];};
  int main(void){int grid[2][3]={{1,2,3},{4,5,6}};struct Item node={7,{8,9,10}};
    for(int i=0;i<2;i++)set(&grid[i][2]);set(&node.data[1]);inspect(&first[3]);inspect(first);inspect(adjacent);
    printf("%d %d %d\\n",grid[0][2],grid[1][2],node.data[1]);return 0;}`;
  const r=await traceModel(source,{includeObservations:true});assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));assert.equal(r.stdout,'31 31 31\n');
  const recording=createRecording(r.plan,r.trace),a=analyze(r);assert.equal(a.status,'completed',JSON.stringify(a.diagnostics));assert.deepEqual(rootWarnings(a),[]);
  const args=r.trace.events.filter(e=>e.action==='argument'&&e.value?.reference?.targetObjectId);
  assert.equal(args.length,6);for(const e of args){const edge=dataFlowForEvent(recording,e)[0];assert.ok(edge);if(e.inputs[0].addressOrigin){assert.equal(edge.from.id,e.value.reference.targetObjectId);assert.equal(edge.from.offset??0,e.value.reference.targetOffset);}}
  const end=args.find(e=>e.value.reference.onePast);assert.ok(end);assert.equal(recording.objects.get(end.value.reference.targetObjectId).name,'first');assert.equal(end.value.reference.targetOffset,12);assert.equal(end.value.reference.dereferenceable,false);
});

test('recursive range-copy regression keeps 1166 public tasks and restores both argument routes', {timeout:60000},async()=>{
  const r=await traceModel(await readFile('examples/c/execution-relations/work-merge.c','utf8'),{includeObservations:true});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'1 2 3 5 6 7 ');assert.equal(r.trace.events.length,1166);
  const a=analyze(r);assert.equal(a.status,'completed',JSON.stringify(a.diagnostics));assert.deepEqual(rootWarnings(a),[]);
  const recording=createRecording(r.plan,r.trace),args=r.trace.events.filter(e=>e.action==='argument'&&e.inputs[0]?.addressOrigin);
  assert.ok(args.length>=2);for(const e of args)assert.equal(dataFlowForEvent(recording,e).length,1);
});
