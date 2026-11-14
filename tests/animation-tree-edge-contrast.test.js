import {test} from 'node:test';
import assert from 'node:assert/strict';
import {structureEdgePaths,strokeStructureEdge} from '../src/animation/structure-ink.js';
import {SceneCanvas} from '../src/animation/canvas.js';

const edge={id:'relation',view:'bst',fromNodeId:'parent',toNodeId:'child',directed:true,from:{x:100,y:0,width:84,height:84},to:{x:0,y:180,width:84,height:84}},path=structureEdgePaths([edge])[0];
function ink(){const strokes=[],fills=[],c={save(){},restore(){},beginPath(){},moveTo(){},quadraticCurveTo(){},bezierCurveTo(){},lineTo(){},closePath(){},stroke(){strokes.push({width:this.lineWidth,color:this.strokeStyle,alpha:this.globalAlpha});},fill(){fills.push(this.fillStyle);}};return {c,strokes,fills};}
test('idle tree relations remain opaque and legible without hover at ordinary and overview zoom',()=>{
  for(const scale of [1,.12]){const {c,strokes,fills}=ink();strokeStructureEdge(c,path,{hierarchical:true,color:'#9debd3',scale});assert.equal(strokes.length,2);assert.equal(strokes[1].color,'#9debd3');assert.equal(strokes[1].alpha,1);assert.ok(Math.abs(strokes[1].width*scale-2.6)<1e-6);assert.ok(strokes[0].width>strokes[1].width);assert.deepEqual(fills,['#9debd3']);}
});
test('active tree relation is stronger while ordinary graph ink retains its existing style',()=>{
  const idle=ink(),active=ink(),ordinary=ink();strokeStructureEdge(idle.c,path,{hierarchical:true});strokeStructureEdge(active.c,path,{hierarchical:true,active:true});strokeStructureEdge(ordinary.c,path);
  assert.ok(active.strokes[1].width>idle.strokes[1].width);assert.equal(ordinary.strokes[0].width,1.6);assert.equal(ordinary.strokes[0].color,'#80c7cc');assert.equal(ordinary.fills.length,0);
});
test('common renderer applies the tree style only to hierarchical relations and keeps actual endpoints',()=>{
  const i=ink(),renderer=Object.create(SceneCanvas.prototype);Object.assign(renderer,{context:i.c,camera:{scale:1},visibleWires:[{id:'ordinary-pointer'}],label(){}});
  renderer.drawStructures({structureEdges:[edge,{...edge,id:'graph',view:'graph',fromNodeId:'u',toNodeId:'v'}]});
  assert.equal(i.strokes[1].color,'#9debd3');assert.equal(i.strokes[2].color,'#80c7cc');assert.deepEqual(renderer.visibleStructureWires.map(w=>w.id),['relation','graph']);
  assert.deepEqual(renderer.visibleStructureWires[0].points,path.points);
  assert.deepEqual(renderer.visibleWires.map(w=>w.id),['ordinary-pointer','relation','graph']);
});
