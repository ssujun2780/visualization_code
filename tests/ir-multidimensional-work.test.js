import assert from 'node:assert/strict';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';
import {arrayWorkStructures} from '../scripts/model/array-work.mjs';

const walk=n=>n?[n,...(n.children??[]).flatMap(walk)]:[];
const unwrap=n=>{while(n&&['ParenExpr','ImplicitCastExpr','CStyleCastExpr'].includes(n.kind))n=n.children?.[0];return n;};
async function inspect(source,exitCode){
  const r=await traceModel(source);assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.equal(r.trace.exitCode,exitCode);assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  assert.equal(r.trace.coverage.memorySnapshots.programReadEventsAdded,0);
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  const before=JSON.stringify({events:r.trace.events,objects:r.trace.objects}),[work]=arrayWorkStructures(r.plan,r.trace);
  assert.equal(JSON.stringify({events:r.trace.events,objects:r.trace.objects}),before);
  assert.deepEqual(work,r.trace.structures.find(s=>s.kind==='array-work'));
  const events=new Map(r.trace.events.map(e=>[e.eventId,e])),defs=new Map(r.plan.instructions.map(d=>[d.id,d]));
  const object=name=>r.trace.objects.find(o=>o.name===name),array=name=>work.arrays.find(a=>a.range.objectId===object(name)?.id);
  for(const access of work.accesses){
    const a=work.arrays.find(a=>a.arrayId===access.target.arrayId),g=a.geometry;
    if(access.target.accessKind!=='cell')continue;
    assert.equal(g.status,'resolved');assert.equal(access.target.coordinates.length,g.rank);
    assert.equal(access.target.coordinates.reduce((offset,coordinate,axis)=>offset+coordinate*g.byteStrides[axis],a.range.offset),access.target.offset);
    assert.equal(access.target.size,g.leafBytes);
    if(access.direction==='write'){
      const e=events.get(access.executionId),expression=unwrap(defs.get(e.instructionId)?.expression);
      if(expression?.operator==='='){
        const targetNodes=walk(expression.children[0]).filter(n=>n.kind==='ArraySubscriptExpr').map(n=>n.nodeId),
          sourceNodes=walk(expression.children[1]).filter(n=>n.kind==='ArraySubscriptExpr').map(n=>n.nodeId);
        assert.deepEqual([...access.sourceNodeIds].sort(),[...targetNodes].sort(),'write sites must belong only to the assignment target');
        assert.ok(access.sourceNodeIds.every(id=>!sourceNodes.includes(id)));
      }
    }
  }
  return {...r,work,events,defs,object,array,
    writes:name=>work.accesses.filter(a=>a.direction==='write'&&a.action==='write'&&a.target.objectId===object(name)?.id)};
}

test('rectangular grids retain different axis extents and offset read/write sites',async()=>{
  const r=await inspect(`int main(void){int wide[2][4]={{2,4,6,8},{0}};int tall[3][2]={{0}};
for(int row=1;row<2;row++)for(int column=1;column<4;column++)wide[row][column]=wide[row-1][column-1]+1;
for(int y=0;y<3;y++)for(int x=0;x<2;x++)tall[y][x]=y*10+x;
return wide[1][3]+tall[2][1];}`,28);
  assert.deepEqual(r.array('wide').geometry.dimensions,[2,4]);assert.deepEqual(r.array('wide').geometry.byteStrides,[16,4]);
  assert.deepEqual(r.array('tall').geometry.dimensions,[3,2]);assert.deepEqual(r.array('tall').geometry.byteStrides,[8,4]);
  assert.deepEqual(r.writes('wide').map(a=>a.target.coordinates),[[1,1],[1,2],[1,3]]);
  assert.deepEqual(r.writes('tall').map(a=>a.target.coordinates),[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]]);
  const ranges=r.work.activations.flatMap(a=>a.ranges);assert.ok(ranges.length);
  assert.ok(ranges.every(x=>x.status!=='contradicted'),JSON.stringify(ranges));
  for(const range of ranges){const array=r.work.arrays.find(a=>a.arrayId===range.arrayId);assert.equal(range.axisCapacity,array.geometry.dimensions[range.axis]);}
  const offsetReads=r.work.accesses.filter(a=>a.direction==='read'&&a.target.objectId===r.object('wide').id&&r.defs.get(r.events.get(a.executionId).instructionId)?.source?.line===2);
  assert.deepEqual(offsetReads.map(a=>a.target.coordinates),[[0,0],[0,1],[0,2]]);
});

test('three dimensional storage keeps all axis strides and exact leaf cell coordinates',async()=>{
  const r=await inspect(`int main(void){int volume[2][3][4]={0};
for(int z=1;z<2;z++)for(int y=1;y<3;y++)for(int x=1;x<4;x++)volume[z][y][x]=volume[z-1][y-1][x-1]+z+y+x;
return volume[1][2][3];}`,6);
  const array=r.array('volume');assert.deepEqual(array.geometry.dimensions,[2,3,4]);
  assert.deepEqual(array.geometry.byteStrides,[48,16,4]);assert.equal(array.geometry.cellCount,24);
  assert.deepEqual(r.writes('volume').map(a=>a.target.coordinates),[[1,1,1],[1,1,2],[1,1,3],[1,2,1],[1,2,2],[1,2,3]]);
  assert.ok(r.writes('volume').every(a=>a.axes.map(axis=>axis.axis).join(',')==='0,1,2'));
  const ranges=r.work.activations.flatMap(a=>a.ranges);assert.ok(ranges.length);
  assert.ok(ranges.every(range=>range.status!=='contradicted'),JSON.stringify(ranges));
  assert.deepEqual([...new Set(ranges.map(range=>range.axis))].sort(),[0,1,2]);
});

test('a pointer to a later row keeps absolute cell coordinates and relative callee bounds',async()=>{
  const r=await inspect(`void paint(int (*band)[4],int rows){
for(int r=0;r<rows;r++)for(int c=0;c<4;c++)band[r][c]=r*10+c;
}
int main(void){int canvas[3][4]={0};paint(canvas+1,2);return canvas[2][3];}`,13);
  assert.deepEqual(r.array('canvas').geometry.dimensions,[3,4]);
  assert.deepEqual(r.writes('canvas').map(a=>a.target.coordinates),[[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2],[2,3]]);
  const frame=r.trace.frames.find(f=>f.functionName==='paint'),activation=r.work.activations.find(a=>a.activationId===frame.id);
  assert.ok(activation.ranges.some(range=>range.axis===0&&range.start===1&&range.end===3&&range.status==='supported'));
  assert.ok(activation.ranges.some(range=>range.axis===1&&range.start===0&&range.end===4&&range.status==='supported'));
  assert.ok(activation.ranges.every(range=>range.status!=='contradicted'),JSON.stringify(activation.ranges));
});

test('flat storage and pointer collections do not acquire a matrix shape from two subscripts',async()=>{
  const r=await inspect(`int main(void){int flat[8]={0};for(int k=0;k<8;k++)flat[k]=k;
int *links[2]={flat,flat+4};return links[1][2];}`,6);
  assert.deepEqual(r.array('flat').geometry.dimensions,[8]);assert.equal(r.array('flat').geometry.rank,1);
  assert.deepEqual(r.array('links').geometry.dimensions,[2]);assert.equal(r.array('links').geometry.rank,1);
  assert.equal(r.array('links').geometry.leafType.kind,'pointer');
  const read=r.work.accesses.find(a=>a.direction==='read'&&a.target.objectId===r.object('flat').id&&a.target.offset===24);
  assert.ok(read);assert.deepEqual(read.target.coordinates,[6]);
  assert.ok(!r.work.arrays.some(a=>a.geometry.rank>1));
});

test('overlapping heap row and scalar views bind ranges to the same view as their writes',async()=>{
  const r=await inspect(`#include <stdlib.h>
int main(void){int (*matrix)[5]=malloc(sizeof(int[3][5]));if(!matrix)return 1;
int *row=matrix[1];for(int column=0;column<5;column++)row[column]=column+10;
int answer=row[4];free(matrix);return answer;}`,14);
  const defs=r.defs,bindings=r.plan.structureBindings.arrayWork,
    declaration=r.plan.declarations.find(d=>d.name==='row'),
    rowSites=bindings.accesses.filter(a=>a.baseDeclarationIds.includes(declaration.id)),
    siteIds=new Set(rowSites.map(a=>a.nodeId)),
    writes=r.work.accesses.filter(a=>a.direction==='write'&&a.action==='write'&&a.sourceNodeIds.some(id=>siteIds.has(id)));
  assert.equal(writes.length,5);
  const viewIds=[...new Set(writes.map(w=>w.target.arrayId))];assert.equal(viewIds.length,1);
  const ranges=r.work.activations.flatMap(a=>a.ranges).filter(range=>range.baseDeclarationId===declaration.id&&range.cursorDeclarationId);
  assert.ok(ranges.length,'the observed row loop must have a range candidate');
  const range=ranges.find(range=>range.arrayId===viewIds[0]);
  assert.ok(range,JSON.stringify({actualWriteView:viewIds[0],ranges}));
  const shape=r.work.arrays.find(a=>a.arrayId===range.arrayId).geometry;
  assert.equal(shape.byteStrides[range.axis],4);assert.equal(range.end-range.start,5);
  assert.equal(range.status,'supported');assert.deepEqual(range.contradictingExecutionIds,[]);
  assert.deepEqual(writes.map(w=>w.target.coordinates[range.axis]),[range.start,range.start+1,range.start+2,range.start+3,range.start+4]);
  assert.ok(writes.every(w=>range.observedAccessExecutionIds.includes(w.executionId)));
});
