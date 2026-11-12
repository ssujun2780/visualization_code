import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recommendStructureViews} from '../scripts/inference/index.mjs';
import {traceWithStructureView as traceModel} from './helpers/structure-runner.mjs';

// Small query-contract fixture: its relations represent existing observed
// coindex proofs, not a compiler or an alternative inference implementation.
function fixture(){
  const events=Array.from({length:6},(_,i)=>({eventId:`e${i}`}));
  const relation=(id,arrays,at)=>({id,kind:'coindexed-record-candidate',discoveredAtExecutionId:at,
    arrays:arrays.map(arrayId=>({arrayId,range:{objectId:arrayId,offset:0,size:80}})),
    evidence:[{arrayIds:arrays,accessExecutionIds:[at]}]});
  const rooted=(id,rel,roles,members,at,root='seed')=>({id,kind:'rooted-index-structure',relationStructureId:rel,
    discoveredAtExecutionId:at,root:{kind:'index-slot',objectId:root,offset:0,size:4},roleIds:roles,logicalNodes:[],
    states:[{afterExecutionId:at,rootAlive:true,storageAlive:true,rootIndex:3,memberIndices:members,
      topology:{status:'observed',nodeCount:members.length,edgeCount:members.length-1,roots:['n3'],
        reachableNodeIds:members.map(i=>`n${i}`),maxChildren:roles.length,cyclic:false,sharedChildren:[]}}]});
  return {programId:'P',runId:'R',events,objects:[{id:'seed',size:4},{id:'other-seed',size:4},
    ...['payload','a','b','c'].map(id=>({id,size:80}))],structures:[
    relation('payload-b',['payload','b'],'e1'),relation('a-b',['a','b'],'e2'),relation('payload-c',['payload','c'],'e1'),
    rooted('partial','payload-b',['b'],[3,4],'e1'),rooted('whole','a-b',['a','b'],[3,4,6,8],'e2'),
    rooted('unrelated','payload-c',['c'],[3,7,9,11,13,15],'e1'),
    rooted('other-root','a-b',['a','b'],[3,4,6,8,10,12,14],'e2','other-seed')]};
}
const choices=(t,at)=>recommendStructureViews(t,{target:{objectId:'seed'},afterExecutionId:at});
const candidate=(rs,id)=>rs.flatMap(r=>r.alternatives).find(r=>r.candidateId===id);
const frozen=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(frozen);Object.freeze(x);}return x;};

test('coverage crosses overlapping views by observed link roles, not payload or equal indices',()=>{
  const t=frozen(fixture()),before=JSON.stringify(t),r=choices(t,'e2'),part=candidate(r,'partial'),whole=candidate(r,'whole'),other=candidate(r,'unrelated');
  assert.equal(part.coverage.representedNodeCount,2);assert.equal(part.coverage.familyNodeCount,4);assert.equal(part.coverage.omittedNodeCount,2);
  assert.equal(whole.coverage.familyNodeCount,4);assert.equal(whole.coverage.omittedNodeCount,0);
  assert.equal(other.coverage.familyNodeCount,6);assert.equal(other.coverage.omittedNodeCount,0);
  assert.ok(!candidate(r,'other-root'));assert.equal(JSON.stringify(t),before);
  const reversed={...t,structures:[...t.structures].reverse()};assert.deepEqual(choices(reversed,'e2'),r);
});

test('future, ended and different current roots cannot enlarge a recommendation family',()=>{
  const t=fixture();assert.equal(candidate(choices(t,'e1'),'partial').coverage.familyNodeCount,2);
  const whole=t.structures.find(s=>s.id==='whole');
  whole.states.push({...whole.states[0],afterExecutionId:'e3',storageAlive:false});
  assert.equal(candidate(choices(t,'e3'),'partial').coverage.familyNodeCount,2);
  whole.states.push({...whole.states[0],afterExecutionId:'e4',rootIndex:6,memberIndices:[6,8],
    topology:{...whole.states[0].topology,nodeCount:2,edgeCount:1,roots:['n6'],reachableNodeIds:['n6','n8'],maxChildren:1}});
  assert.equal(candidate(choices(t,'e4'),'partial').coverage.familyNodeCount,2);
  const partial=t.structures.find(s=>s.id==='partial');partial.states.push({...partial.states[0],afterExecutionId:'e5',rootIndex:6,memberIndices:[6],
    topology:{...partial.states[0].topology,nodeCount:1,edgeCount:0,roots:['n6'],reachableNodeIds:['n6'],maxChildren:0}});
  const p=candidate(choices(t,'e5'),'partial');assert.equal(p.coverage.familyNodeCount,2);assert.equal(p.coverage.omittedNodeCount,1);
});

test('payload overlap cannot serve as a transitive bridge between independent link domains',()=>{
  const t=fixture();t.structures=t.structures.filter(s=>s.id!=='whole'&&s.id!=='a-b'&&s.id!=='other-root');
  const r=choices(t,'e2');assert.equal(candidate(r,'partial').coverage.familyNodeCount,2);
  assert.equal(candidate(r,'unrelated').coverage.familyNodeCount,6);
});

test('pointer selection follows current nodes while direct NULL slots, emptied roots and arrays remain selectable',async()=>{
  const r=await traceModel(`#include <stdio.h>
typedef struct Cell{struct Cell *west,*east;int v;}Cell;
int visit(Cell*p){return p?1+visit(p->west)+visit(p->east):0;}
int main(void){Cell cells[6]={0};
cells[0].west=cells+1;cells[0].east=cells+2;cells[3].west=cells+4;cells[3].east=cells+5;
Cell*focus=cells;Cell*saved=focus;
printf("A %d\\n",visit(focus)+visit(cells+3));
focus=cells+3;printf("B %d\\n",visit(focus));
focus=0;printf("C %d\\n",visit(focus));return saved==0;}`,{filename:'scope-variant.c'});
  assert.equal(r.trace.status,'completed');assert.equal(r.stdout,'A 6\nB 3\nC 0\n');
  assert.deepEqual(r.trace.coverage.irGaps,[]);
  const t=frozen(r.trace),before=JSON.stringify(t),positions=new Map(t.events.map((e,i)=>[e.eventId,i])),
    output=label=>t.events.find(e=>e.action==='output'&&e.text?.startsWith(label)).eventId,
    focus=t.objects.find(o=>o.name==='focus'),cells=t.objects.find(o=>o.name==='cells'),width=cells.cType.elementType.sizeBits/8;
  for(const [label,indices]of [['A',[0,1,2]],['B',[3,4,5]]]){
    const at=output(label),rs=recommendStructureViews(t,{target:{objectId:focus.id},afterExecutionId:at});
    assert.ok(!rs.flatMap(r=>r.alternatives).some(r=>r.representedNodeCount===0));
    assert.ok(rs.some(r=>r.view==='array'));
    const tree=rs.find(r=>r.view==='tree');assert.equal(tree.representedNodeCount,3);
    const s=t.structures.find(s=>s.id===tree.candidateId),st=s.states.findLast(st=>positions.get(st.afterExecutionId)<=positions.get(at)),ids=new Set(st.topology.reachableNodeIds);
    assert.deepEqual(s.logicalNodes.filter(n=>ids.has(n.id)).map(n=>n.offset/width).sort(),indices);
  }
  const field=cells.cType.elementType.members.find(f=>f.name==='west'),emptySlot={objectId:cells.id,offset:width+field.offsetBits/8,size:field.sizeBits/8};
  const direct=recommendStructureViews(t,{target:{ranges:[emptySlot]},afterExecutionId:output('A')});
  assert.ok(direct.some(r=>r.view==='linked-list'&&r.exactRoot&&r.representedNodeCount===0));
  const emptied=recommendStructureViews(t,{target:{objectId:focus.id},afterExecutionId:output('C')});
  assert.ok(emptied.some(r=>r.view==='linked-list'&&r.exactRoot&&r.representedNodeCount===0));
  assert.ok(!emptied.some(r=>r.representedNodeCount>0));assert.equal(JSON.stringify(t),before);
});
