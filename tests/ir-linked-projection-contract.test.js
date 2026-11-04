import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateLinkedProjections} from '../scripts/model/linked-projection-contract.mjs';

function fixture(){
  const nodes=['a','b','nil'].map((id,index)=>({id,objectId:'pool',offset:index*16,size:16,recordTypeId:'T'})),
    boundary={nodeId:'nil',objectId:'pool',offset:32,size:16,recordTypeId:'T',sourceNodeIds:['comparison'],evidenceExecutionIds:['e1']},
    topology={rootNodeId:'a',rootStatus:'in-bounds',reachableNodeIds:['a','b'],endedTargetNodeIds:[],terminalNodeIds:['nil'],
      status:'graph',cyclic:true,sharedChildren:[{nodeId:'b'}],unknownRelations:[{from:'b',fieldNodeId:'left',status:'unobserved-slot'}],
      edges:[{from:'a',to:'b',fieldNodeId:'left',source:{objectId:'pool',offset:0,size:4},lastWrite:'e1'},
        {from:'a',to:'nil',fieldNodeId:'right',source:{objectId:'pool',offset:4,size:4},lastWrite:'e1',termination:'sentinel',reference:{targetObjectId:'pool',targetOffset:32}}]},
    issue={kind:'reciprocal-mismatch',from:'a',to:'b',fieldNodeId:'left',oppositeFieldNodeIds:['parent'],episodeId:'warning1',evidenceExecutionIds:['e1'],
      actualTargets:[{fieldNodeId:'parent',to:null,status:'null',lastWrite:'e1'}]},
    state={afterExecutionId:'e2',boundaries:[boundary],roleTopologies:[{roleGroupId:'children',fieldNodeIds:['left','right'],auxiliaryFieldNodeIds:['parent'],topology}],
      selectedRoleGroupId:'children',topology,inconsistencies:[issue]};
  return {events:[{eventId:'e1',kind:'WRITE'},{eventId:'e2',kind:'WRITE'},{eventId:'e3',kind:'FLOW',action:'resume'},{eventId:'e4',kind:'WRITE'}],
    objects:[{id:'pool',size:48}],structures:[{id:'candidate',kind:'linked-structure',root:{objectId:'pool',offset:0,recordTypeId:'T'},logicalNodes:nodes,storageNodes:nodes,
      roleGroups:[{id:'children',recordTypeId:'T',fieldNodeIds:['left','right'],auxiliaryFieldNodeIds:['parent']}],states:[state],
      warningEpisodes:[{id:'warning1',kind:'reciprocal-mismatch',from:'a',to:'b',fieldNodeId:'left',oppositeFieldNodeIds:['parent'],
        firstExecutionId:'e2',lastExecutionId:'e2',closedAtExecutionId:'e4',resolvedAtExecutionId:'e4',status:'transient-resolved',evidenceExecutionIds:['e1'],observedAtBoundaryExecutionIds:['e3']}]}]};
}
const reject=mutate=>{const t=structuredClone(fixture());mutate(t.structures[0],t);assert.throws(()=>validateLinkedProjections(t),/연결 투영/);};

test('projection roles are checked without rejecting cycles, sharing, unknown relations or legacy traces',()=>{
  const t=fixture(),before=JSON.stringify(t);assert.equal(validateLinkedProjections(t),t);assert.equal(JSON.stringify(t),before);
  assert.doesNotThrow(()=>validateLinkedProjections({events:[],objects:[],structures:[{kind:'linked-structure',states:[{inconsistencies:[{kind:'reciprocal-mismatch'}]}]}]}));
  reject(s=>s.roleGroups.push({...s.roleGroups[0]}));
  reject(s=>s.states[0].roleTopologies[0].fieldNodeIds=['left','parent']);
  reject(s=>s.roleGroups[0].auxiliaryFieldNodeIds=['left']);
  reject(s=>s.states[0].selectedRoleGroupId='absent');
});

test('sentinel identity, bounds and evidence time must agree with actual subobject storage',()=>{
  reject(s=>s.states[0].boundaries[0].offset=31);
  reject(s=>s.states[0].boundaries[0].size=20);
  reject(s=>s.states[0].boundaries[0].evidenceExecutionIds=['e4']);
  reject(s=>s.states[0].topology.edges[1].reference.targetOffset=16);
  reject(s=>s.states[0].topology.edges[0].lastWrite='missing');
});

test('warning episodes preserve reference identity and chronological evidence',()=>{
  reject(s=>s.states[0].inconsistencies[0].episodeId='missing');
  reject(s=>s.warningEpisodes[0].firstExecutionId='e3');
  reject(s=>s.warningEpisodes[0].resolvedAtExecutionId='e1');
  reject(s=>s.warningEpisodes[0].evidenceExecutionIds=['e4']);
  reject(s=>s.warningEpisodes[0].observedAtBoundaryExecutionIds=['e1']);
  const t=fixture(),episode=t.structures[0].warningEpisodes[0];episode.status='unresolved-at-end';delete episode.resolvedAtExecutionId;
  assert.doesNotThrow(()=>validateLinkedProjections(t));
});
