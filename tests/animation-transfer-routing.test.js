import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTransfers, transferSegmentsMeet, transferBadges, transferSegmentHitsRectangle} from '../src/animation/transfer-routing.js';
import {containsPoint} from '../src/animation/world.js';

function validate(connections, plan) {
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.paths.length,connections.length);
  const lines=[];
  for(const route of plan.paths) {
    const edge=connections.find(c=>c.index===route.index), path=route.points;
    assert.ok(path.length>=2); assert.ok(containsPoint(edge.from,path[0]));assert.ok(containsPoint(edge.to,path.at(-1)));
    for(let i=1;i<path.length;i++) {
      assert.ok(Number.isFinite(path[i].x)&&Number.isFinite(path[i].y));
      for(const[a,b]of lines)assert.equal(transferSegmentsMeet(path[i-1],path[i],a,b),false,'distinct transfer lines never cross or overlap');
    }
    for(let i=1;i<path.length;i++)lines.push([path[i-1],path[i]]);
  }
}
test('a common target uses distinct straight ports for simultaneous input arrows',()=>{
  const to={x:700,y:0,width:200,height:160};
  const edges=[0,1,2,3].map(index=>({index,id:`e${index}`,from:{x:0,y:index*100,width:120,height:70},to}));
  const original=structuredClone(edges), plan=routeTransfers(edges);validate(edges,plan);
  assert.ok(plan.paths.every(p=>p.points.length===2));assert.deepEqual(edges,original);
  assert.deepEqual(routeTransfers(edges),plan);
});
test('repeated reads and folded aliases sharing one visible box retain separate arrows',()=>{
  const from={x:-200,y:-100,width:150,height:104},to={x:700,y:200,width:404,height:155};
  for(const count of [2,8,16]) {
    const edges=Array.from({length:count},(_,index)=>({id:`read-${index}`,index,from,to}));
    validate(edges,routeTransfers(edges));
  }
});
test('crossed connection pairs use line detours without depending on box obstacles',()=>{
  const box=(x,y)=>({x,y,width:80,height:60});
  const edges=[{index:0,from:box(0,0),to:box(600,300)},{index:1,from:box(0,300),to:box(600,0)},
    {index:2,from:box(220,-200),to:box(220,600)}];
  const plan=routeTransfers(edges);validate(edges,plan);assert.ok(plan.paths.some(p=>p.points.length>2));
  // Arbitrary foreign boxes are not an input: crossing a box is permitted.
  const simple=[{index:0,from:box(-500,0),to:box(500,0)}];
  assert.equal(routeTransfers(simple).paths[0].points.length,2);
});
test('seeded fans at different scales and orientations preserve occurrence order',()=>{
  let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(const count of [3,8,16]) {
    const to={x:-100,y:-80,width:220,height:160};
    const edges=Array.from({length:count},(_,index)=>{
      const angle=index/count*Math.PI*2+random()*0.08,radius=500+random()*200;
      return{index,from:{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,width:100,height:70},to};
    });
    const plan=routeTransfers(edges);validate(edges,plan);assert.deepEqual(plan.paths.map(p=>p.index),edges.map(e=>e.index));
  }
});
test('sequence badges avoid values and keep their positions when draw emphasis changes',()=>{
  const paths=[{index:0,points:[{x:0,y:0},{x:500,y:0}]},{index:1,points:[{x:0,y:70},{x:500,y:70}]}];
  const box={x:100,y:-20,width:100,height:40}, badges=transferBadges(paths,[box],9);
  assert.equal(badges.size,2);
  assert.ok(badges.get(0).x>209||badges.get(0).x<91);
  assert.deepEqual(transferBadges([...paths].reverse(),[box],9),badges);
});

test('rows of value boxes keep readable contents clear, visibly separate lanes and explicit exits at different zooms',()=>{
  for(const vertical of [false,true])for(const scale of [0.34,0.68,1.25]) {
    const transform=r=>vertical?{x:r.y-500,y:r.x,width:r.height,height:r.width}:r;
    const boxes=[0,160,320].map(x=>transform({x,y:80,width:120,height:90}));
    const to=transform({x:600,y:0,width:240,height:240});
    const obstacles=boxes.map(r=>({x:r.x+4,y:r.y+4,width:r.width-8,height:r.height-8}));
    const edges=boxes.slice(0,2).map((from,index)=>({index,from,to}));
    const plan=routeTransfers(edges,{obstacles,scale});validate(edges,plan);
    assert.ok(plan.minimumSeparation*scale>=16-1e-5,'ordinary rows retain a visible screen-space gap');
    for(const route of plan.paths) {
      const [p,q]=route.points,r=edges[route.index].from;
      assert.ok(Math.abs(p.x-r.x)<1e-6?q.x<p.x:Math.abs(p.x-r.x-r.width)<1e-6?q.x>p.x:Math.abs(p.y-r.y)<1e-6?q.y<p.y:q.y>p.y,
        'a source visibly exits its face instead of running along a box border');
      for(let i=1;i<route.points.length;i++)for(const box of obstacles)
        assert.equal(transferSegmentHitsRectangle(route.points[i-1],route.points[i],box),false,'no line covers a value or name');
    }
  }
});
