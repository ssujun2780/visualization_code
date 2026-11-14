const center=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const pair=e=>[String(e.fromNodeId),String(e.toNodeId)].sort().join('|');
export function structurePort(geometry,range){
  if(!range?.objectId)return null;const size=range.size??[...geometry.cells.values()].find(c=>c.objectId===range.objectId&&c.offset===(range.offset??0))?.size;
  return geometry.structurePorts?.find(p=>p.range.objectId===range.objectId&&p.range.offset===(range.offset??0)&&p.range.size===size)??null;
}
function attachment(box,toward){const c=center(box),dx=toward.x-c.x,dy=toward.y-c.y,d=Math.hypot(dx,dy)||1,
  t=box.shape==='circle'||box.diagramOnly?Math.min(box.width,box.height)/2/d:Math.min(Math.abs(box.width/2/(dx||1e-9)),Math.abs(box.height/2/(dy||1e-9)));
  return {x:c.x+dx*t,y:c.y+dy*t};}
export function structureEdgePaths(edges,{readRange=()=>null}={}){
  const rows=[];
  for(const edge of edges){const value=edge.weightRange?readRange(edge.weightRange):edge.weight,
    text=value!=null?String(value):edge.weightRange?'?':(edge.labels??[]).map(l=>typeof l==='object'?l.text??l.symbol??l.label??'':l).join(', '),key=pair(edge);
    // Only an explicitly undirected view pairs reciprocal storage entries.
    const reverse=edge.directed===false&&rows.find(r=>!r.paired&&r.edge.directed===false&&r.key===key&&r.text===text&&r.edge.fromNodeId===edge.toNodeId&&r.edge.toNodeId===edge.fromNodeId);
    if(reverse){reverse.paired=true;reverse.ids.push(edge.id);continue;}rows.push({edge,text,key,ids:[edge.id]});
  }
  const groups=new Map();for(const r of rows){const list=groups.get(r.key)??[];list.push(r);groups.set(r.key,list);}
  return rows.map(r=>{const {edge}=r,a=center(edge.from),b=center(edge.to),group=groups.get(r.key),offset=(group.indexOf(r)-(group.length-1)/2)*36;
    if(edge.fromNodeId===edge.toNodeId){const radius=40+group.indexOf(r)*20,start={x:a.x+edge.from.width*.3,y:edge.from.y+8},end={x:a.x-edge.from.width*.3,y:edge.from.y+8},
      c1={x:a.x+radius*1.7,y:edge.from.y-radius*1.6},c2={x:a.x-radius*1.7,y:edge.from.y-radius*1.6},points=[];
      for(let i=0;i<=20;i++){const t=i/20,u=1-t;points.push({x:u*u*u*start.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*end.x,y:u*u*u*start.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*end.y});}
      return {...r,points,loop:true,c1,c2,label:{x:a.x,y:edge.from.y-radius*1.25}};
    }
    const d=Math.hypot(b.x-a.x,b.y-a.y)||1,sign=String(edge.fromNodeId)<=String(edge.toNodeId)?1:-1,control={x:(a.x+b.x)/2-(b.y-a.y)/d*offset*sign,y:(a.y+b.y)/2+(b.x-a.x)/d*offset*sign},start=attachment(edge.from,control),end=attachment(edge.to,control),points=[];
    for(let i=0;i<=16;i++){const t=i/16,u=1-t;points.push({x:u*u*start.x+2*u*t*control.x+t*t*end.x,y:u*u*start.y+2*u*t*control.y+t*t*end.y});}
    return {...r,points,control,label:points[8]};
  });
}
export function strokeStructureEdge(context,path,{color='#80c7cc',active=false,scale=1,hierarchical=false,label=()=>{}}={}){
  const p=path.points,c=context,zoom=Math.max(hierarchical ? .05 : .2,scale),width=(hierarchical?(active?3.6:2.6):(active?2.8:1.6))/zoom,
    line=()=>{c.beginPath();c.moveTo(p[0].x,p[0].y);if(path.loop)c.bezierCurveTo(path.c1.x,path.c1.y,path.c2.x,path.c2.y,p.at(-1).x,p.at(-1).y);else c.quadraticCurveTo(path.control.x,path.control.y,p.at(-1).x,p.at(-1).y);c.stroke();};
  c.save();if(hierarchical){c.globalAlpha=1;c.lineCap='round';c.lineJoin='round';c.strokeStyle='#101a20';c.lineWidth=width+2.8/zoom;line();}
  c.strokeStyle=color;c.lineWidth=width;line();
  if(path.edge.directed!==false){const b=p.at(-1),a=p.at(-2),angle=Math.atan2(b.y-a.y,b.x-a.x),size=(hierarchical?(active?11:9):7)/Math.max(hierarchical ? .05 : .45,scale);c.beginPath();c.moveTo(b.x-size*Math.cos(angle-.48),b.y-size*Math.sin(angle-.48));c.lineTo(b.x,b.y);c.lineTo(b.x-size*Math.cos(angle+.48),b.y-size*Math.sin(angle+.48));if(hierarchical){c.closePath();c.fillStyle=color;c.fill();}else c.stroke();}
  if(path.text){const radius=10/Math.max(.5,scale);c.fillStyle='#101a20';c.fillRect(path.label.x-path.text.length*radius*.38-4,path.label.y-radius,path.text.length*radius*.76+8,radius*1.6);label(path.text,path.label.x,path.label.y+3,{align:'center',size:13/Math.max(.65,scale),color:active?'#e0f5ff':'#e1d0a6',maxWidth:140});}c.restore();
}
