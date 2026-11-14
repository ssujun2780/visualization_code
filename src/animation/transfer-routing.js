// Value-transfer geometry is independent of persistent pointer wiring. Objects
// may be crossed, but their readable contents are protected. Previously
// allocated transfer lines may not be overlapped.
const EPS = 1e-6;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const center = r => ({x:r.x+r.width/2,y:r.y+r.height/2});
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const on = (a,b,p) => Math.abs(cross(a,b,p)) < EPS && p.x >= Math.min(a.x,b.x)-EPS && p.x <= Math.max(a.x,b.x)+EPS && p.y >= Math.min(a.y,b.y)-EPS && p.y <= Math.max(a.y,b.y)+EPS;
export function transferSegmentsMeet(a,b,c,d) {
  const ac=cross(a,b,c), ad=cross(a,b,d), ca=cross(c,d,a), cb=cross(c,d,b);
  return ac*ad < -EPS && ca*cb < -EPS || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
}
const segments = path => path.slice(1).map((b,i)=>[path[i],b]);
const length = path => segments(path).reduce((sum,[a,b])=>sum+distance(a,b),0);
const compact = path => path.filter((p,i)=>!i || distance(p,path[i-1])>EPS);
function pointSegmentDistance(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return distance(p,{x:a.x+t*dx,y:a.y+t*dy});
}
function separation(a,b,c,d) {
  return transferSegmentsMeet(a,b,c,d) ? 0 : Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
export function transferSegmentHitsRectangle(a,b,r) {
  // Clip against the open interior, including diagonal segments.
  let low=0, high=1;
  for(const [p,d,min,max] of [[a.x,b.x-a.x,r.x+EPS,r.x+r.width-EPS],[a.y,b.y-a.y,r.y+EPS,r.y+r.height-EPS]]) {
    if(Math.abs(d)<EPS){if(p<=min||p>=max)return false;continue;}
    const t1=(min-p)/d,t2=(max-p)/d;low=Math.max(low,Math.min(t1,t2));high=Math.min(high,Math.max(t1,t2));
    if(low>=high)return false;
  }
  return high>0&&low<1;
}
function clear(path, occupied, clearance = 8, obstacles = []) {
  return segments(path).every(([a,b])=>!obstacles.some(r=>transferSegmentHitsRectangle(a,b,r))&&occupied.every(([c,d])=>!transferSegmentsMeet(a,b,c,d) &&
    separation(a,b,c,d)>=clearance-EPS));
}
function endPort(rect, opposite) {
  const p=center(rect), q=center(opposite), dx=q.x-p.x,dy=q.y-p.y;
  const vertical=Math.abs(dy)/Math.max(1,rect.height)>Math.abs(dx)/Math.max(1,rect.width);
  return {rect, opposite:q, side:vertical?(dy>=0?'bottom':'top'):(dx>=0?'right':'left')};
}
function portPoint(port, fraction) {
  const r=port.rect, f=Math.max(0.04,Math.min(0.96,fraction));
  return ['left','right'].includes(port.side) ? {x:r.x+(port.side==='right'?r.width:0),y:r.y+f*r.height}
    : {x:r.x+f*r.width,y:r.y+(port.side==='bottom'?r.height:0)};
}
function allocatePorts(items) {
  const buckets=new Map(), allocations=new Map();
  for(const item of items) for(const name of ['start','end']) {
    const port=item[name], r=port.rect, rectangleKey=JSON.stringify([r.x,r.y,r.width,r.height]);
    if(!allocations.has(rectangleKey))allocations.set(rectangleKey,{left:0,right:0,top:0,bottom:0});
    const load=allocations.get(rectangleKey), preferred=port.side;
    const capacity=side=>Math.max(1,Math.floor((['left','right'].includes(side)?r.height:r.width)*0.8/12));
    const choices=[preferred,...['left','right','top','bottom'].filter(side=>side!==preferred)];
    port.side=choices.find(side=>load[side]<capacity(side)) ?? choices.sort((a,b)=>load[a]/capacity(a)-load[b]/capacity(b))[0];
    load[port.side]++;
    const key=JSON.stringify([r.x,r.y,r.width,r.height,port.side]);
    if(!buckets.has(key))buckets.set(key,[]); buckets.get(key).push({port,index:item.index,name});
  }
  for(const bucket of buckets.values()) {
    const projection = ({port}) => {
      const p=center(port.rect), q=port.opposite;
      return ['left','right'].includes(port.side) ? (q.y-p.y)/(Math.abs(q.x-p.x)||1) : (q.x-p.x)/(Math.abs(q.y-p.y)||1);
    };
    bucket.sort((a,b)=>projection(a)-projection(b)||a.index-b.index||a.name.localeCompare(b.name));
    bucket.forEach(({port},i)=>{port.fraction=0.1+0.8*(i+1)/(bucket.length+1);port.point=portPoint(port,port.fraction);});
  }
}
function shifted(port, amount) {
  const span=['left','right'].includes(port.side)?port.rect.height:port.rect.width;
  return portPoint(port,port.fraction+amount/Math.max(1,span));
}
function cheapRoute(from,to,occupied,clearance,obstacles=[]) {
  const accepts=path=>clear(path,occupied,clearance,obstacles);
  if(accepts([from,to]))return[from,to];
  // Clear, straight lanes around readable contents take precedence over tiny
  // diagonal offsets that technically miss a line but remain hard to follow.
  const pad=Math.max(10,clearance);
  const xs=[from.x,to.x,...obstacles.flatMap(r=>[r.x-pad,r.x+r.width+pad])];
  const ys=[from.y,to.y,...obstacles.flatMap(r=>[r.y-pad,r.y+r.height+pad])];
  const candidates=[compact([from,{x:from.x,y:to.y},to]),compact([from,{x:to.x,y:from.y},to]),
    ...ys.map(y=>compact([from,{x:from.x,y},{x:to.x,y},to])),
    ...xs.map(x=>compact([from,{x,y:from.y},{x,y:to.y},to]))];
  candidates.sort((a,b)=>length(a)+a.length*pad-length(b)-b.length*pad);
  for(const path of candidates)if(accepts(path))return path;
  const dx=to.x-from.x,dy=to.y-from.y, span=Math.max(24,distance(from,to)), nx=-dy/span,ny=dx/span;
  // Prefer one small bend to a rectangular detour around unrelated objects.
  for(const delta of [12,24,48,96,192,384,768,1536,3072]) for(const sign of [1,-1]) for(const t of [0.5,0.25,0.75]) {
    const mid={x:from.x+dx*t+nx*delta*sign,y:from.y+dy*t+ny*delta*sign};
    const path=compact([from,mid,to]); if(accepts(path))return path;
  }
  xs.push(...occupied.flatMap(s=>s.map(p=>p.x)));ys.push(...occupied.flatMap(s=>s.map(p=>p.y)));
  for(const pad of [16,40,100]) {
    for(const x of [Math.min(...xs)-pad,Math.max(...xs)+pad]) {
      const path=compact([from,{x,y:from.y},{x,y:to.y},to]);if(accepts(path))return path;
    }
    for(const y of [Math.min(...ys)-pad,Math.max(...ys)+pad]) {
      const path=compact([from,{x:from.x,y},{x:to.x,y},to]);if(accepts(path))return path;
    }
  }
  return null;
}
function visibilityRoute(from,to,occupied,clearance,obstacles=[]) {
  return visibilitySearch([from],[to],occupied,clearance,obstacles)?.points??null;
}
function visibilitySearch(starts,ends,occupied,clearance,obstacles) {
  if(!starts.length||!ends.length)return null;
  const points=[...starts,...ends], used=new Set(points.map(p=>JSON.stringify(p)));
  const add=q=>{const key=JSON.stringify(q);if(!used.has(key)&&clear([q,q],occupied,clearance,obstacles)){used.add(key);points.push(q);}};
  for(const r of obstacles)for(const x of [r.x-clearance,r.x+r.width+clearance])for(const y of [r.y-clearance,r.y+r.height+clearance])add({x,y});
  for(const segment of occupied) for(const p of segment) for(const [dx,dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    add({x:p.x+dx*(clearance+2),y:p.y+dy*(clearance+2)});
  }
  const startIds=starts.map((_,i)=>i),costs=new Map(startIds.map(i=>[i,0])),parents=new Map(),origins=new Map(startIds.map(i=>[i,i])),open=new Set(startIds),closed=new Set();
  const heuristics=points.map(p=>Math.min(...ends.map(to=>distance(p,to))));
  const clearCache=new Map();
  while(open.size) {
    let best=-1, priority=Infinity;
    for(const id of open){const score=costs.get(id)+heuristics[id];if(score<priority){best=id;priority=score;}}
    if(best>=starts.length&&best<starts.length+ends.length){const path=[];for(let at=best;at!==undefined;at=parents.get(at))path.push(points[at]);return{points:path.reverse(),start:origins.get(best),end:best-starts.length};}
    open.delete(best);closed.add(best);
    for(let next=0;next<points.length;next++) {
      if(closed.has(next))continue;
      const value=costs.get(best)+distance(points[best],points[next]);if(value>=(costs.get(next)??Infinity))continue;
      const key=best<next?`${best}:${next}`:`${next}:${best}`;
      if(!clearCache.has(key))clearCache.set(key,clear([points[best],points[next]],occupied,clearance,obstacles));
      if(!clearCache.get(key))continue;
      costs.set(next,value);parents.set(next,best);origins.set(next,origins.get(best));open.add(next);
    }
  }
  return null;
}

export function routeTransfers(connections,{obstacles=[],scale=1}={}) {
  const gap=16/Math.max(0.1,scale);
  // Endpoint interiors prevent routes from entering a box through its far
  // face. Aggregate envelopes must not obstruct their own visible children.
  const endpoints=connections.flatMap(c=>[c.from,c.to]);
  const cores=endpoints.filter(r=>![...obstacles,...endpoints].some(other=>other!==r&&other.width<r.width&&other.height<r.height&&
    other.x>=r.x&&other.y>=r.y&&other.x+other.width<=r.x+r.width&&other.y+other.height<=r.y+r.height))
    .map(r=>({x:r.x+4,y:r.y+4,width:Math.max(0,r.width-8),height:Math.max(0,r.height-8)}));
  const protectedAreas=[...new Map([...obstacles,...cores].map(r=>[JSON.stringify([r.x,r.y,r.width,r.height]),r])).values()];
  const items=connections.map((c,index)=>({...c,index:c.index??index,start:endPort(c.from,c.to),end:endPort(c.to,c.from)}));
  allocatePorts(items);
  const paths=[], missing=[], occupied=[]; let minimumSeparation=Infinity;
  for(const item of items) {
    const escape=(p,r)=>{
      const lead=10/Math.max(0.1,scale);
      if(Math.abs(p.x-r.x)<EPS)return{x:p.x-lead,y:p.y};
      if(Math.abs(p.x-r.x-r.width)<EPS)return{x:p.x+lead,y:p.y};
      return{x:p.x,y:p.y+(Math.abs(p.y-r.y)<EPS?-lead:lead)};
    };
    const outward=(p,q,r)=>{const out=escape(p,r);return (q.x-p.x)*(out.x-p.x)+(q.y-p.y)*(out.y-p.y)>EPS;};
    const direct=(a,b,clearance)=>distance(a,b)>EPS&&outward(a,b,item.from)&&outward(b,a,item.to)&&clear([a,b],occupied,clearance,protectedAreas);
    const detour=(a,b,clearance,router)=>{
      const start=escape(a,item.from),end=escape(b,item.to);
      if(!clear([a,start],occupied,clearance,protectedAreas)||!clear([end,b],occupied,clearance,protectedAreas))return null;
      const middle=router(start,end,occupied,clearance,protectedAreas);
      const path=middle&&compact([a,...middle,b]);return path&&clear(path,occupied,clearance,protectedAreas)?path:null;
    };
    const variants=[[0,0],[8,0],[-8,0],[0,8],[0,-8],[16,0],[-16,0],[0,16],[0,-16],[8,8],[-8,-8]];
    let path=null;
    // Try other distinct ports before adding bends; instruction order is never
    // reordered to improve the drawing.
    for(const clearance of [gap,gap/2,4]) {
      for(const [a,b]of variants){const p=shifted(item.start,a),q=shifted(item.end,b);if(direct(p,q,clearance)){path=[p,q];break;}}
      if(!path) {
        const ports=p=>[p.point,...['top','bottom','left','right'].filter(side=>side!==p.side).map(side=>portPoint({...p,side},0.5))];
        const alternatives=ports(item.start).flatMap(a=>ports(item.end).map(b=>({a,b}))).sort((a,b)=>distance(a.a,a.b)-distance(b.a,b.b));
        let bestCost=Infinity;
        for(const{a,b}of alternatives){const candidate=detour(a,b,clearance,cheapRoute);if(candidate){const cost=length(candidate)+candidate.length*clearance;if(cost<bestCost){bestCost=cost;path=candidate;}}}
      }
      if(!path)for(const[a,b]of variants){path=detour(shifted(item.start,a),shifted(item.end,b),clearance,visibilityRoute);if(path)break;}
      if(path)break;
    }
    if(!path) {
      // Dense aliases can exhaust one face of a folded box. Search its other
      // faces rather than dropping an occurrence or crossing an older line.
      const freePorts = rect => ['left','right','top','bottom'].flatMap(side=>{
        const span=['left','right'].includes(side)?rect.height:rect.width,count=Math.max(3,Math.ceil(span/5));
        return Array.from({length:count},(_,i)=>portPoint({rect,side},0.04+0.92*(i+0.5)/count));
      })
        .filter(p=>occupied.every(([a,b])=>pointSegmentDistance(p,a,b)>=4-EPS));
      const pairs=freePorts(item.from).flatMap(a=>freePorts(item.to).map(b=>({a,b,cost:distance(a,b)}))).sort((a,b)=>a.cost-b.cost);
      for(const{a,b}of pairs)if(direct(a,b,4)){path=[a,b];break;}
      if(!path)for(const{a,b}of pairs.slice(0,32)){path=detour(a,b,4,cheapRoute);if(path)break;}
      if(!path)for(const{a,b}of pairs.slice(0,8)){path=detour(a,b,4,visibilityRoute);if(path)break;}
      if(!path) {
        // Searching all faces together avoids repeatedly trying only the
        // nearest (but enclosed) ports when earlier routes divide the space.
        const terminals=r=>['left','right','top','bottom'].flatMap(side=>[0.1,0.3,0.5,0.7,0.9].map(f=>{
          const port=portPoint({rect:r,side},f);return{port,out:escape(port,r)};
        })).filter(t=>clear([t.port,t.out],occupied,4,protectedAreas));
        const starts=terminals(item.from),ends=terminals(item.to);
        const found=visibilitySearch(starts.map(t=>t.out),ends.map(t=>t.out),occupied,4,protectedAreas);
        if(found)path=compact([starts[found.start].port,...found.points,ends[found.end].port]);
      }
    }
    if(!path){missing.push(item.index);continue;}
    for(const[a,b]of segments(path))for(const[c,d]of occupied)minimumSeparation=Math.min(minimumSeparation,separation(a,b,c,d));
    occupied.push(...segments(path)); paths.push({id:item.id,index:item.index,points:path,length:length(path)});
  }
  return {paths,missing,minimumSeparation};
}

export function pointAlong(path,fraction) {
  let remaining=length(path)*Math.max(0,Math.min(1,fraction));
  for(const[a,b]of segments(path)){const size=distance(a,b);if(remaining<=size)return{x:a.x+(b.x-a.x)*remaining/(size||1),y:a.y+(b.y-a.y)*remaining/(size||1)};remaining-=size;}
  return path.at(-1);
}

export function transferBadges(paths, obstacles, radius) {
  const badges=new Map();
  const candidates=paths.map(route=>({index:route.index,points:[radius*2.5/Math.max(1,length(route.points)),0.08,0.15,0.2,0.28,0.35,0.45,0.55,0.65,0.78,0.9,0.95].map(fraction=>pointAlong(route.points,fraction)).filter(point=>
    !obstacles.some(r=>point.x>=r.x-radius&&point.x<=r.x+r.width+radius&&point.y>=r.y-radius&&point.y<=r.y+r.height+radius)&&
    !paths.some(other=>other.index!==route.index&&segments(other.points).some(([a,b])=>pointSegmentDistance(point,a,b)<radius+1)))}));
  // Give short, constrained routes their label space before longer routes.
  candidates.sort((a,b)=>a.points.length-b.points.length||a.index-b.index);
  for(const route of candidates)for(const point of route.points) {
    if([...badges.values()].some(p=>distance(point,p)<radius*2.2))continue;
    badges.set(route.index,point);break;
  }
  return badges;
}
