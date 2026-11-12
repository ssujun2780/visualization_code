import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateRecordIndexStructures} from '../scripts/inference/record-index-contract.mjs';

// Hand-authored observation records keep the validator independent of inference.
function fixture(){
  const slot=offset=>({objectId:'storage',offset,size:4});
  const event=(eventId,kind,offset,value)=>({eventId,kind,target:slot(offset),value:{bits:String(value)}});
  const nodes=[0,1].map(index=>({id:`n${index}`,index,storage:slot(index*4),record:slot(index*4),status:'observed',membershipExecutionId:'e1'}));
  return {objects:[{id:'storage',address:100,size:16}],events:[event('e1','WRITE',0,1),event('e2','READ',0,1),event('e3','READ',4,0),event('e4','WRITE',0,0)],structures:[
    {id:'container',kind:'array',objectId:'storage',range:{offset:0,size:16},elementBytes:4,capacity:4},
    {id:'graph',kind:'record-index-graph-candidate',containerId:'container',recordTypeId:'record',recordSize:4,storageKind:'record-array',
      isPointerStructure:false,temporalScope:'observed-states',discoveredAtExecutionId:'e3',displayPolicy:{mergeRelations:false},
      relations:[{id:'relation',kind:'record-field',field:{recordTypeId:'record',offset:0,size:4,cType:{signedness:'unsigned'}},
        evidence:[{sourceExecutionId:'e2',source:slot(0),sourceIndex:0,targetAccessExecutionId:'e3',indexExecutionId:'e2',targetIndex:1}]}],
      states:[{afterExecutionId:'e3',length:2,capacity:4,elementBytes:4,byteOffset:0,backingObjectId:'storage',nodes,
        edges:[{id:'edge',from:'n0',to:'n1',fromIndex:0,toIndex:1,value:1,source:slot(0),relationId:'relation',
          lastWriteExecutionId:'e1',lastObservationExecutionId:'e2',evidenceExecutionIds:['e3']}]}]}
  ]};
}

test('index overlay contract accepts measured storage and rejects invented membership or values',()=>{
  assert.doesNotThrow(()=>validateRecordIndexStructures(fixture()));
  const corrupt=[
    g=>{g.containerId='another-container';},
    g=>{g.states[0].nodes[1].index=2;},
    g=>{g.states[0].nodes[1].record.offset=8;},
    g=>{g.states[0].edges[0].value=0;},
    g=>{g.states[0].edges[0].lastObservationExecutionId='e4';},
    g=>{g.displayPolicy.mergeRelations=true;},
  ];
  for(const change of corrupt){const trace=fixture();change(trace.structures[1]);assert.throws(()=>validateRecordIndexStructures(trace),/레코드 인덱스 후보/);}
});

test('index overlay contract preserves unresolved program relations without inventing targets',()=>{
  const trace=fixture(),edge=trace.structures[1].states[0].edges[0];
  trace.events[0].value.bits='99';trace.events[1].value.bits='99';
  Object.assign(edge,{to:null,toIndex:null,value:99,status:'terminal-or-unresolved'});
  assert.doesNotThrow(()=>validateRecordIndexStructures(trace));
});
