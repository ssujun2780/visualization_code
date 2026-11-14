import {displayScene} from './playback.js';
import {structureLabels} from './structure-kinds.js';
import {hydrateStructure,renderStructureShape} from './structure-shapes.js';
const el=(tag,className,text)=>{const n=document.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;};
const manual=['boxes','array','grid','tree','graph','linked-list','stack','queue','deque'];

export class StructureViews{
  constructor({onChange=()=>{},onLocate=()=>{}}={}){this.onChange=onChange;this.onLocate=onLocate;this.enabled=true;this.choices=new Map();this.geometry=new Map();this.cache=new Map();this.revision=0;this.limit=64;}
  load(recording,inference,{preserve=false}={}){
    this.worker?.terminate();clearTimeout(this.timer);
    const scope=`${recording.plan.programId}:${recording.trace.runId}`;
    if(!preserve||scope!==this.scope){this.choices.clear();this.geometry.clear();}this.scope=scope;
    this.recording=recording;this.inference=inference;this.worker=null;this.ready=false;this.pending=false;this.failed=false;this.cache.clear();this.revision++;this.status='자료구조 보기 준비';
  }
  start(){
    if(this.worker||!this.recording)return;
    this.status='자료구조 조회 준비 중… · 큰 기록은 최대 60초';this.worker=new Worker(new URL('./structure-view-worker.js',import.meta.url),{type:'module'});
    const fail=message=>{clearTimeout(this.timer);this.worker?.terminate();this.ready=false;this.pending=false;this.failed=true;this.status=`자료구조 보기 제한 · ${message}`;this.onChange();};
    this.worker.onmessage=({data})=>{
      if(data.type==='ready'){clearTimeout(this.timer);this.ready=true;this.status=`추론 ${data.count}개 항목${data.status!=='completed'?` · ${data.status}`:''}${data.fallback?' · 저장 기록에서 분석':''}`;this.diagnostics=data.diagnostics;this.onChange();}
      if(data.type==='views'){clearTimeout(this.timer);this.pending=false;this.cache.set(data.key,data.views);while(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);this.onChange();}
      if(data.type==='failure')fail(data.message);
      if(data.type==='chosen')this.onChange();
    };
    this.worker.onerror=()=>fail('조회 작업 실패 · 원본 상자를 유지합니다.');
    this.timer=setTimeout(()=>fail('준비 시간 제한 · 원본 재생은 유지됩니다.'),60000);
    this.worker.postMessage({type:'load',plan:this.recording.plan,trace:this.recording.trace,inference:this.inference,choices:[...this.choices.values()]});
  }
  update(player,view){
    if(!this.enabled)return new Map();this.start();if(!this.ready)return new Map();
    this.at=!player.event?this.recording.trace.events.at(-1)?.eventId??null:view.applied?player.event.eventId:this.recording.trace.events[player.cursor-1]?.eventId??null;
    const targets=view.cards.filter(c=>c.alive).slice(0,12).map(c=>({objectId:c.id})),key=JSON.stringify([this.at,targets,view.targets,this.revision,this.limit]);
    if(!this.cache.has(key)&&!this.pending){this.pending=true;this.worker.postMessage({type:'query',key,at:this.at,targets,focus:view.targets,limit:this.limit});
      this.timer=setTimeout(()=>{this.worker.terminate();this.ready=false;this.failed=true;this.status='자료구조 조회 시간 제한 · 원본 상자를 유지합니다.';this.onChange();},5000);}
    return new Map((this.cache.get(key)??[]).map(v=>[v.target.objectId,v]));
  }
  choose(target,choice){
    if(!this.ready)return;const key=JSON.stringify(target),setting={target,choice,at:this.at};
    choice.view==='auto'?this.choices.delete(key):this.choices.set(key,setting);this.cache.clear();this.revision++;
    this.worker.postMessage({type:'choose',...setting});this.onChange();
  }
  toolbar(){const bar=el('div','structure-toolbar'),label=el('label',''),toggle=el('input','');toggle.type='checkbox';toggle.checked=this.enabled;toggle.setAttribute('aria-label','자료구조 모양 표시');
    toggle.onchange=()=>{this.enabled=toggle.checked;this.onChange();};label.append(toggle,document.createTextNode('자료구조 모양'));
    const status=el('span','',this.status);status.title=(this.diagnostics??[]).map(d=>d.message??d.code).join('\n');bar.append(label,status);
    if(this.failed||this.diagnostics?.length){const details=el('details','structure-status'),summary=el('summary','','분석 안내');details.append(summary,el('p','',this.failed?this.status:status.title));bar.append(details);}
    return bar;
  }
  render(card,presentation,player,work,header,{showShape=true}={}){
    if(!this.enabled)return null;
    const choice=el('select','structure-choice');choice.setAttribute('aria-label',`${card.name} 자료구조 표현`);
    const options=[{value:'auto',text:'자동'},...(presentation?.recommendations??[]).map((r,i)=>({value:`rec:${i}`,text:`추천 ${r.rank} · ${r.label}${r.status==='partial'?' (일부)':''}`})),
      ...manual.map(view=>({value:`manual:${view}`,text:`지정 · ${structureLabels[view]}`}))];
    for(const o of options){const option=el('option','',o.text);option.value=o.value;choice.append(option);}
    choice.disabled=!this.ready;
    if(presentation?.locked){const i=presentation.recommendations.findIndex(r=>r.view===presentation.view&&JSON.stringify(r.roleIds??null)===JSON.stringify(this.choices.get(JSON.stringify(presentation.target))?.choice.roleIds??null));
      choice.value=i>=0?`rec:${i}`:`manual:${presentation.view}`;}
    choice.onchange=()=>{const option=choice.value,r=option.startsWith('rec:')?presentation.recommendations[Number(option.slice(4))]:null;
      this.choose({objectId:card.id},option==='auto'?{view:'auto'}:r?{view:r.view,roleIds:r.roleIds}:{view:option.slice(7)});};header.append(choice);
    if(!showShape||!presentation||presentation.view==='boxes'&&!presentation.warnings?.length)return null;
    const wrapper=el('div','structure-shape');wrapper.dataset.structure=presentation.candidateId??card.id;
    const summary=el('div','structure-caption',`${presentation.mode==='manual'?'사용자 지정':'추론 후보'} · ${presentation.label}`);summary.title='작성 의도의 확정이 아니라 현재 관측 관계의 표현입니다.';wrapper.append(summary);
    const d=presentation.descriptor;if(d?.range&&d.range.size<card.size)wrapper.append(el('p','structure-facts',`부분 저장소 · +${d.range.offset} B · ${d.range.size} B`));
    for(const warning of presentation.warnings??[])wrapper.append(el('p','structure-warning',warning));
    const shape=hydrateStructure(this.recording,displayScene(this.recording,work.applied?player.after:player.state),presentation,work.targets);
    if(!shape||!Object.hasOwn(structureLabels,presentation.view))return {element:wrapper,physical:true,grid:presentation.view==='grid'};
    const backing=new Map(shape.nodes.flatMap(n=>n.cells.filter(c=>c.objectId!==card.id).map(c=>[c.objectId,`${c.name} · ${c.owner}`])));
    if(backing.size){const names=[...backing.values()],facts=el('p','structure-facts',`구성 저장소 · ${names.slice(0,3).join(', ')}${names.length>3?` 외 ${names.length-3}개`:''}`);facts.title=names.join('\n');wrapper.append(facts);}
    if(presentation.view==='hash-table'&&shape.nodes.length&&shape.nodes.every(n=>n.bucket===undefined))wrapper.append(el('p','structure-warning','버킷 위치가 없어 관측된 키·값 항목을 표시합니다.'));
    const key=`${presentation.candidateId??card.id}:${presentation.view}`,rendered=renderStructureShape(shape,{positions:this.geometry.get(key),onLocate:this.onLocate});
    const positions=new Map([...this.geometry.get(key)??[],...rendered.positions]);while(positions.size>2048){const old=[...positions.keys()].find(id=>!rendered.positions.has(id));if(!old)break;positions.delete(old);}
    this.geometry.set(key,positions);while(this.geometry.size>32)this.geometry.delete(this.geometry.keys().next().value);
    const canvas=el('div','structure-canvas');canvas.dataset.object=card.id;canvas.append(rendered.svg);wrapper.append(canvas);
    const s=shape.relation.semantic;if(s){const facts=[s.front!==undefined?`front ${s.front}`:'',s.back!==undefined?`back ${s.back}`:'',s.capacity!==undefined?`용량 ${s.capacity}`:''].filter(Boolean);if(facts.length)wrapper.append(el('p','structure-facts',facts.join(' · ')));}
    if(shape.relation.omittedNodes||shape.relation.omittedEdges){const more=el('button','',`더 보기 · 노드 ${shape.relation.omittedNodes}개 / 연결 ${shape.relation.omittedEdges}개 생략`);more.type='button';more.disabled=this.limit>=256;
      more.onclick=()=>{this.limit=Math.min(256,this.limit+64);this.cache.clear();this.revision++;this.onChange();};wrapper.append(more);}
    return {element:wrapper,physical:false,preferredWidth:Math.min(460,Number(rendered.svg.getAttribute('width'))+20)};
  }
}
