import {displayScene,formatValue} from './playback.js';
import {memoryPresentation} from './memory.js';
import {dataFlowForEvent,transferPresentation,calculationForEvent} from './transfers.js';
import {workGraph} from './work-graph.js';
import {conditionForEvent} from './conditions.js';
import {workEvidence} from './work-evidence.js';
import {hiddenStorageEndpoint} from './source-storage.js';
import {StructureViews} from './structure-views.js';

const overlap=(a,b)=>a.offset<b.offset+b.size&&b.offset<a.offset+a.size;
const complete=e=>e?.phase==='complete';

// A projection of the SAME live storage, not reconstructed C or virtual arrays.
// Current operands stop at reads. Older production chains stay in the analyzer.
export function currentWorkView(player,context,{pinned=new Set(),retained=6,analysis}={}){
  const {recording:r,event:e}=player,p=transferPresentation(r,e,player.progress),
    applied=e?.kind==='WRITE'?p.valueReady:p.effectReady,state=applied&&player.progress>0?player.after:player.state,
    scene=displayScene(r,state),boundary=!e||applied&&player.progress>0?'after':'before',current=context?.[boundary],callerContext=context?.callers?.[boundary],targets=[],add=(target,role)=>{
      if(!target?.objectId||!Number.isFinite(target.offset)||!Number.isFinite(target.size)||target.size<=0)return;
      if(!targets.some(t=>t.objectId===target.objectId&&t.offset===target.offset&&t.size===target.size&&t.role===role))targets.push({...target,role});
    };
  if(e?.target&&complete(e)&&['READ','WRITE'].includes(e.kind))add(e.target,e.kind==='READ'?'read':'write');
  const flow=dataFlowForEvent(r,e);
  for(const edge of flow)if(edge.from.kind==='object'&&edge.role!=='address-origin'){
    const source=r.events.get(edge.producerId)?.target,size=edge.from.size??(source?.objectId===edge.from.id?source.size:undefined);
    // Transport anchors may omit width; that is not evidence of reading the
    // entire allocation. Use the recorded access or leave width unresolved.
    if(size!==undefined)add({objectId:edge.from.id,offset:edge.from.offset??0,size},'read');
  }
  for(const region of e?.readRegions??[])add(region,'read');
  const queue=[...e?.dataInputs??[],...(e?.inputs??[]).map(i=>i.executionId)].map(id=>({id,role:'read'})),seen=new Set();
  queue.push(...(e?.addressInputs??[]).map(id=>({id,role:'address'})));
  while(queue.length&&seen.size<128){const {id,role}=queue.pop(),key=`${id}:${role}`;if(seen.has(key))continue;seen.add(key);const input=r.events.get(id);
    if(!input||r.eventOrder.get(id)>=player.cursor)continue;
    if(input.kind==='READ'&&input.target){add(input.target,role);queue.push(...(input.addressInputs??[]).map(id=>({id,role:'address'})));}
    else if(input.kind==='CALC')queue.push(...[...input.dataInputs??[],...(input.inputs??[]).map(i=>i.executionId)].map(id=>({id,role})));
  }
  for(const ref of current?.references??[])if(ref.slotObjectId&&targets.some(t=>t.objectId===ref.objectId)){
    const slot=r.events.get(ref.observationExecutionId)?.target;
    if(slot?.objectId===ref.slotObjectId)add(slot,'address');
  }
  const ids=new Set([...pinned,...targets.map(t=>t.objectId)]),regions=current?.regions?.storage??[],related=new Map();
  // A live recorded reference is enough to preview its original backing store;
  // it is NOT evidence that this invocation has read the whole allocation.
  const relate=(id,entry)=>{if(!scene.objects.get(id)?.alive)return;const list=related.get(id)??[];list.push(entry);related.set(id,list);};
  for(const ref of current?.references??[])if(ref.objectId&&!ref.onePast&&ref.targetLifetime==='live')
    relate(ref.objectId,{kind:'reference',offset:ref.offset??0,slotObjectId:ref.slotObjectId});
  // Query may still be pending. Only use canonical pointer identity already in
  // the CURRENT scene, never numeric address matching or a future argument.
  for(const object of scene.objects.values())if(object.alive&&object.frameId===(e?.activationId??state.activeFrame))
    for(const cell of object.renderCells??[...object.cells?.values()??[],{value:object.value}]){const ref=cell.value?.reference;if(ref?.targetObjectId&&!ref.onePast)
      relate(ref.targetObjectId,{kind:'reference',offset:ref.targetOffset??0,slotObjectId:object.id});}
  for(const caller of [...callerContext?.storage??[]].reverse())for(const region of caller.storage)
    relate(region.objectId,{kind:'caller',activationId:caller.activationId,throughExecutionId:caller.throughExecutionId,region});
  // Keep recently used payload nearby across intervening index/control commands.
  // No whole-object connected-component promotion in this automatic work view.
  let kept=0;for(const id of [...related.keys(),...[...regions].reverse().map(s=>s.objectId)]){
    const o=scene.objects.get(id);if(!o?.alive||!(o.renderCells?.length>1)||ids.has(o.id))continue;
    if(kept++<retained)ids.add(o.id);
  }
  const windows=[];for(const t of targets)windows.push({...t,capacity:20,offset:Math.max(0,t.offset-16),size:t.size+48});
  for(const [objectId,entries]of related)if(ids.has(objectId)&&!targets.some(t=>t.objectId===objectId)){
    const ref=entries.find(x=>x.kind==='reference');if(ref)windows.push({objectId,offset:Math.max(0,ref.offset-16),size:64,capacity:20});
  }
  const projected=memoryPresentation(r,new Map([...scene.objects].filter(([id])=>ids.has(id))),{previewWindows:windows});
  const cards=[];
  for(const id of ids){const o=projected.get(id);if(!o)continue;const active=targets.filter(t=>t.objectId===id),region=regions.find(x=>x.objectId===id),cells=o.renderCells?.length?o.renderCells:[{offset:0,size:o.size,path:'',value:o.value,id:`${id}@0`,cType:o.cType}],
      focus=active.filter(t=>t.role!=='address'),selected=focus.length?cells.filter(c=>focus.some(t=>c.offset>=t.offset-16&&c.offset<t.offset+t.size+32)):cells;
    const smallGrid=cells.length<=24&&cells.some(c=>/\[\d+\]\[\d+\]/.test(c.path??''));
    const chosen=(smallGrid?cells:selected).slice(0,24),rows=chosen.map(c=>({...c,roles:active.filter(t=>overlap(t,c)).map(t=>t.role),
      accessed:{read:region?.readRanges?.some(t=>overlap(t,c))??false,write:region?.writeRanges?.some(t=>overlap(t,c))??false},text:formatValue(c.value)}));
    const frame=o.frameId?r.frameNames.get(o.frameId):null,storage=['automatic','stack'].includes(o.storage)?'STACK':o.storage==='heap'?'HEAP':'전역·정적';
    cards.push({id,name:o.name??id,createdBy:o.createdBy,alive:o.alive,owner:frame?`${storage} · ${frame}`:storage,size:o.size,active,pinned:pinned.has(id),
      cells:rows,totalCells:cells.length,omitted:Math.max(0,cells.length-rows.length),region,contexts:related.get(id)??[],structureBindings:current?.structureBindings?.filter(b=>b.participants.some(t=>t.objectId===id))??[]});
  }
  const calculation=calculationForEvent(r,e),values=e?.kind==='WRITE'?[]:p.inputs.map(i=>({text:i.arrived?formatValue(i.value):'…',arrived:i.arrived})),evidenceEvent=r.events.get(current?.operation?.executionId),
    evidenceOperation=current?.operation?{...current.operation,description:evidenceEvent?.action==='argument'?`매개변수 ${r.objects.get(evidenceEvent.target?.objectId)?.name??''}로 값 전달`:undefined}:undefined;
  return {eventId:e?.eventId??null,operation:{kind:e?.kind??'완료',expression:r.instructions.get(e?.instructionId)?.source?.expression??e?.action??'실행 종료',
    frame:r.frameNames.get(e?.activationId)??'',line:r.instructions.get(e?.instructionId)?.source?.line,phase:p.phase,inputs:values,
    result:e?.kind==='WRITE'?(e.value&&p.valueReady?formatValue(e.value):null):calculation&&p.resultReady?(e?.kind==='FLOW'?conditionForEvent(r,e)?.selected??formatValue(e.condition):formatValue(calculation.value)):null},cards,targets,applied:applied&&player.progress>0,
    scopes:current?.workScopes??[],status:current?.analysisStatus??'loading',unresolved:current?.unresolved??[],evidenceOperation,callerOmitted:callerContext?.omitted??0,calls:current?.calls?.stack??[],
    transfers:current?.transfers??[],boundedDomains:current?.regions?.boundedDomains??[],
    graph:workGraph(r,cards,analysis,!e?recordingEnd(r):applied&&player.progress>0?e.eventId:r.trace.events[player.cursor-1]?.eventId??null)};
}
const recordingEnd=r=>r.trace.events.at(-1)?.eventId??null;

const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
// A phase update may replace a button between pointer down and click. Commit
// controls on pointer down; keyboard-generated clicks still work once.
const activate=(button,action)=>{button.onpointerdown=e=>{if(e.button===0){e.preventDefault();action();}};button.onclick=e=>{if(e.detail===0)action();};};
export class WorkContextPanel{
  constructor(root,{onLocate=()=>{},onTargets=()=>{}}={}){this.root=root;this.onLocate=onLocate;this.onTargets=onTargets;this.pinned=new Set();this.cache=new Map();this.details=new Set();this.status='';
    this.structures=new StructureViews({onChange:()=>{this.signature='';},onLocate});
    root.addEventListener('work-view-layout',()=>{this.signature='';this.lastFocusedEvent=null;this.lastFlowKey=null;});}
  load(recording,analysis,{preserve=false}={}){
    this.worker?.terminate();clearTimeout(this.workerTimer);this.recording=recording;this.analysis=analysis;this.cache.clear();this.pending=false;this.ready=false;this.queryFailed=false;if(!preserve)this.pinned.clear();this.signature='';this.root.hidden=false;
    this.structures.load(recording,analysis?.structureInference,{preserve});
    if(!analysis?.relations){this.status=analysis?.diagnostics?.[0]?.message??'저장 기록에 분석 정보가 없습니다. 현재 접근을 표시합니다.';return;}
    this.status='작업 관계 준비 중…';
    this.worker=new Worker(new URL('./work-query-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(this.workerTimer);this.ready=true;this.status='';}
      if(data.type==='context'){this.pending=false;this.cache.set(data.id,data);while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);}
      if(data.type==='failure'){clearTimeout(this.workerTimer);this.status=`관계 조회 실패 · ${data.message}`;this.ready=false;this.queryFailed=true;}};
    this.worker.onerror=()=>{clearTimeout(this.workerTimer);this.status='관계 조회를 사용할 수 없습니다. 원본 재생은 유지됩니다.';this.ready=false;this.queryFailed=true;};
    this.workerTimer=setTimeout(()=>{this.worker.terminate();this.ready=false;this.queryFailed=true;this.status='관계 조회 준비 시간 제한 · 원본 재생은 유지됩니다.';},10000);
    this.worker.postMessage({type:'load',plan:recording.plan,trace:recording.trace,analysis});
  }
  update(player){
    const id=player.event?.eventId??player.recording.trace.events.at(-1)?.eventId;
    // Coalesce slider scrubbing; at most one query runs, then the newest cursor.
    if(this.ready&&id&&!this.pending&&!this.cache.has(id)){this.pending=true;this.worker.postMessage({type:'query',id});}
    const context=this.cache.get(id),view=currentWorkView(player,context,{pinned:this.pinned,analysis:this.ready?this.analysis:undefined});this.onTargets(view.targets);
    this.view=view;if(this.root.hidden){this.signature='';return;}
    const structureViews=this.structures.update(player,view),signature=JSON.stringify([view,this.status,[...structureViews],this.structures.status,this.structures.enabled]);if(signature===this.signature){this.drawFlow(player);return;}this.signature=signature;
    const scroll=this.root.querySelector('.work-cards')?.scrollLeft??0,old=new Map([...this.root.querySelectorAll('.work-cells')].map(e=>[e.dataset.object,{top:e.scrollTop,left:e.scrollLeft}]));
    const shapeScroll=new Map([...this.root.querySelectorAll('.structure-canvas')].map(e=>[e.dataset.object,{left:e.scrollLeft,top:e.scrollTop}]));
    this.root.replaceChildren();
    const heading=node('div','work-heading'),title=node('strong','',`현재 작업 · ${view.operation.frame||'실행 공간'}`);
    const location=node('span','work-location',`${view.operation.line?`${view.operation.line}행 · `:''}연결 보기${view.status==='partial'||view.unresolved.length?' · 일부 근거':''}`);
    location.title='원본 저장소의 현재 값과 연결 · 부족한 분석 정보는 아래 분석 안내에서 확인';
    title.title=title.textContent;heading.append(title,location);this.root.append(heading);
    this.root.append(this.structures.toolbar());
    const evidence=workEvidence(view,{status:this.status,available:!!this.analysis?.relations&&!this.queryFailed});
    if(evidence){const info=node('details',`work-evidence ${evidence.state}`);info.open=!!this.evidenceOpen;
      info.append(node('summary','',evidence.summary+' · 상세'));
      const op=evidence.operation;if(op)info.append(node('p','work-evidence-source',`근거 사건 ${op.executionId}${op.source?.line?` · ${op.source.line}행`:''} · ${op.description??op.source?.expression??`${op.kind} ${op.action}`}`));
      if(evidence.details.length){const list=node('ul');for(const d of evidence.details){const item=node('li','',d.message);item.append(node('code','',d.code));list.append(item);}info.append(list);}
      else info.append(node('p','',evidence.state==='loading'?'현재 접근은 원본 기록으로 표시합니다. 조회가 끝나면 연결 정보를 덧붙입니다.':'작업 관계 조회를 사용할 수 없어 원본 기록의 현재 접근만 표시합니다.'));
      info.ontoggle=()=>{this.evidenceOpen=info.open;};this.root.append(info);}
    const operation=node('div','work-operation'),expression=node('code','work-expression',view.operation.expression);expression.title=view.operation.expression;operation.append(node('span','work-kind',view.operation.kind),expression);
    const inputs=node('span','work-operands');for(const [i,value]of view.operation.inputs.entries())inputs.append(node('b',value.arrived?'arrived':'',`${i?' · ':''}${value.text}`));operation.append(inputs);
    if(view.operation.result!==null)operation.append(node('strong','work-result',`→ ${view.operation.result}`));
    const iteration=view.scopes.filter(s=>s.kind==='iteration').at(-1);if(iteration)operation.append(node('span','work-iteration',`${iteration.iteration}번째 반복`));this.root.append(operation);
    const lane=node('div','work-flow-lane');lane.setAttribute('aria-label','현재 명령의 값 전달 경로');this.root.append(lane);
    const cards=node('div','work-cards'),locals=node('div','work-locals'),shownShapes=new Set();
    for(const card of view.cards){const box=node('section',`work-card${card.alive?'':' ended'}`);box.dataset.object=card.id;
      const header=node('div','work-card-header'),name=node('strong','',card.name),locate=node('button','', '원본'),pin=node('button',card.pinned?'pinned':'','고정');
      locate.type=pin.type='button';locate.setAttribute('aria-label',`${card.name} 원본 위치`);activate(locate,()=>this.onLocate(card.id));
      pin.setAttribute('aria-label',`${card.name} 연결 보기 고정`);pin.setAttribute('aria-pressed',String(card.pinned));activate(pin,()=>{this.pinned.has(card.id)?this.pinned.delete(card.id):this.pinned.add(card.id);this.signature='';});
      const owner=node('span','work-owner',`${card.owner} · ${card.size} B${card.alive?'':' · 수명 종료'}`);owner.title=owner.textContent;
      header.append(name,owner,locate,pin);box.append(header);
      const presentation=structureViews.get(card.id),shapeKey=presentation?.candidateId?`${presentation.candidateId}:${presentation.view}:${JSON.stringify(presentation.roleIds??null)}`:null,
        shape=this.structures.render(card,presentation,player,view,header,{showShape:!shapeKey||!shownShapes.has(shapeKey)});
      if(shape){box.append(shape.element);if(shape.preferredWidth)box.style.width=`${shape.preferredWidth}px`;if(!shape.physical&&shapeKey)shownShapes.add(shapeKey);}
      if(card.contexts.length&&!card.active.length){const ref=card.contexts.some(c=>c.kind==='reference');
        box.append(node('div','work-context-label',ref?'현재 참조로 연결된 원본 · 방문 범위와 별개':`호출자 ${this.recording.frameNames.get(card.contexts[0].activationId)??''}의 저장소 · 현재 값`));}
      box.title=`${card.owner} · ${card.name} · ${card.id}`;
      const cells=node('div','work-cells');cells.dataset.object=card.id;
      // A two-dimensional compiler path stays a grid; records preserve fields.
      const grid=shape?.grid||card.cells.some(c=>/\[\d+\]\[\d+\]/.test(c.path??''));if(grid){cells.classList.add('work-grid');box.classList.add('grid-card');}
      let priorRow;for(const cell of card.cells){const row=grid?/^\[(\d+)\]/.exec(cell.path)?.[1]:null;if(grid&&priorRow!==undefined&&row!==priorRow)cells.append(node('span','grid-break'));priorRow=row;
        const el=node('div',`work-cell ${cell.roles.join(' ')}${cell.accessed.write?' visited-write':cell.accessed.read?' visited-read':''}`);
        el.dataset.offset=cell.offset;el.title=`${card.name}${cell.path??''} · +${cell.offset} B · ${cell.size} B`;
        const value=node('b','',cell.text);value.title=cell.text;el.append(node('span','work-cell-path',cell.path||card.name),value);
        const ref=cell.value?.reference;if(ref||cell.cType?.kind==='pointer')el.classList.add('pointer-cell');
        if(ref?.targetObjectId){const target=this.recording.objects.get(ref.targetObjectId);const link=node('button','work-reference',`→ ${target?.name??ref.targetObjectId} +${ref.targetOffset??0} B`);link.title=`${target?.name??ref.targetObjectId} · ${ref.targetObjectId} · +${ref.targetOffset??0} B`;
          activate(link,()=>{this.pinned.add(ref.targetObjectId);this.signature='';});el.append(link);}
        cells.append(el);
      }
      if(shape&&!shape.physical){const backing=node('details','structure-backing');backing.open=this.details.has(`backing:${card.id}`);backing.append(node('summary','','원소·멤버 보기'),cells);
        backing.ontoggle=()=>{backing.open?this.details.add(`backing:${card.id}`):this.details.delete(`backing:${card.id}`);};box.append(backing);
      }else box.append(cells);
      const info=node('details','work-details'),more=node('button','work-details-toggle','⋯');more.type='button';more.title=card.omitted?`접근 범위·상세 · 현재 목록에서 ${card.omitted}칸 생략`:'접근 범위·상세';more.setAttribute('aria-label',`${card.name} 접근 범위·상세`);
      info.open=this.details.has(card.id);more.setAttribute('aria-expanded',String(info.open));activate(more,()=>{info.open=!info.open;this.details.has(card.id)?this.details.delete(card.id):this.details.add(card.id);more.setAttribute('aria-expanded',String(info.open));});
      info.append(node('summary','','접근 범위·상세'));info.ontoggle=()=>{info.open?this.details.add(card.id):this.details.delete(card.id);};header.append(more);
      if(card.omitted)info.append(node('p','work-more',`${card.omitted}칸 생략 · 현재 접근 주변 표시`));
      const ranges=card.region,rangeText=items=>(items??[]).slice(0,4).map(r=>`${r.offset}…${r.offset+r.size-1}`).join(', ');
      if(ranges)info.append(node('div','work-ranges',`호출 누적 · 읽기 [${rangeText(ranges.readRanges)}] 쓰기 [${rangeText(ranges.writeRanges)}] B`));
      if(!ranges){const caller=card.contexts.find(c=>c.kind==='caller');if(caller)info.append(node('div','work-ranges',`호출자 ${this.recording.frameNames.get(caller.activationId)??caller.activationId}의 ${caller.throughExecutionId}까지 관측 · 읽기 [${rangeText(caller.region.readRanges)}] 쓰기 [${rangeText(caller.region.writeRanges)}] B · 현재 함수 방문 아님`));}
      const possible=view.boundedDomains.flatMap(d=>d.participants.filter(p=>p.objectId===card.id));
      if(possible.length)info.append(node('div','work-domain',`접근 가능 경계 [${rangeText(possible.flatMap(p=>p.ranges??[]))}] B · 방문 보장 아님`));
      const labels=new Set(card.structureBindings.flatMap(b=>b.participants.filter(p=>p.kind==='structure-element').map(p=>p.structureId)));
      if(labels.size){const kinds=[...labels].map(id=>this.analysis?.structureInference?.structures.find(s=>s.id===id)?.kind??'저장소 대응');
        info.append(node('div','work-structure',`구조 대응 · ${[...new Set(kinds)].join(', ')}`));}box.append(info);
      if((!shape||shape.physical)&&card.cells.length===1&&card.cells[0].size===card.size){box.classList.add('local-card');locate.textContent='↗';pin.textContent='⌖';locate.title=`${card.name} 원본 위치`;pin.title=`${card.name} 연결 보기 고정`;locals.append(box);}else cards.append(box);
    }
    // Scalar-only operations still need visible contents, not an empty body
    // with all available boxes squeezed into the heading.
    if(!cards.children.length&&locals.children.length)for(const box of [...locals.children]){box.classList.remove('local-card');cards.append(box);}
    if(!cards.children.length)cards.append(node('p','work-empty',player.event?.action==='enter'||player.event?.action==='frame.begin'?'함수 진입 · 아직 전달되거나 접근한 저장소가 없습니다. 매개변수 전달을 기다립니다.':'이 명령에는 표시할 저장소가 없습니다. 읽기·쓰기 또는 실제 참조가 확인되면 원본 값을 표시합니다.'));
    if(locals.children.length)heading.insertBefore(locals,heading.lastChild);this.root.append(cards);cards.scrollLeft=scroll;
    for(const canvas of cards.querySelectorAll('.structure-canvas')){const before=shapeScroll.get(canvas.dataset.object);canvas.scrollLeft=before?.left??0;canvas.scrollTop=before?.top??0;
      if(this.lastFocusedEvent!==view.eventId){const active=canvas.querySelector('[data-node] rect[stroke="#ffce85"]')??canvas.querySelector('[data-node] rect[stroke="#83baff"]');if(active){const a=active.getBoundingClientRect(),b=canvas.getBoundingClientRect();if(a.left<b.left)canvas.scrollLeft+=a.left-b.left;else if(a.right>b.right)canvas.scrollLeft+=a.right-b.right;if(a.top<b.top)canvas.scrollTop+=a.top-b.top;else if(a.bottom>b.bottom)canvas.scrollTop+=a.bottom-b.bottom;}}}
    for(const rail of cards.querySelectorAll('.work-cells')){
      const previous=old.get(rail.dataset.object);rail.scrollTop=previous?.top??0;rail.scrollLeft=previous?.left??0;
      if(this.lastFocusedEvent!==view.eventId){const current=rail.querySelector('.work-cell.write')??rail.querySelector('.work-cell.read');
        if(current){const a=current.getBoundingClientRect(),b=rail.getBoundingClientRect();if(a.left<b.left)rail.scrollLeft+=a.left-b.left;else if(a.right>b.right)rail.scrollLeft+=a.right-b.right;}}
    }
    this.lastFocusedEvent=view.eventId;
    if(view.callerOmitted)this.root.append(node('p','work-notice',`호출 문맥 ${view.callerOmitted}개 생략 · 가까운 호출자 32개 표시`));
    this.drawFlow(player);
  }

  drawFlow(player){
    const lane=this.root.querySelector('.work-flow-lane');if(!lane)return;
    const scroll=lane.scrollLeft;lane.replaceChildren();
    const p=transferPresentation(player.recording,player.event,player.progress);if(p.groupOpacity<=0)return;
    const scene=displayScene(player.recording,this.view?.applied?player.after:player.state);
    lane.style.opacity=String(p.groupOpacity);
    const label=endpoint=>{
      if(endpoint.kind==='device')return '알루';
      if(endpoint.kind==='mat')return ({'tool:input':'입력','tool:output':'출력','tool:workbench':'호출 결과'})[endpoint.id]??'도구';
      if(endpoint.kind==='return-port')return (this.recording.frameNames.get(endpoint.id)??'함수')+' 반환구';
      const object=scene.objects.get(endpoint.id)??this.recording.objects.get(endpoint.id),cell=this.view?.cards.find(c=>c.id===endpoint.id)?.cells.find(c=>c.offset===(endpoint.offset??0));
      return (object?.name??endpoint.id)+(cell?.path??((endpoint.offset??0)?' +'+endpoint.offset+' B':''));
    };
    const ns='http://www.w3.org/2000/svg';
    for(const [i,edge]of p.edges.entries()){
      if(hiddenStorageEndpoint(this.recording,scene,edge.from)||hiddenStorageEndpoint(this.recording,scene,edge.to))continue;
      const active=p.active?.index===i,part=node('div','work-transfer'+(active?' active':'')),sourceLabel=label(edge.from),
        from=node('span','work-endpoint',edge.addressSource==='address-of'?`&${sourceLabel}`:edge.addressSource==='pointer-base'?`${sourceLabel} 기반 주소`:sourceLabel),to=node('span','work-endpoint',label(edge.to));
      from.title=from.textContent;to.title=to.textContent;
      const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 34 12');svg.setAttribute('aria-hidden','true');
      const path=document.createElementNS(ns,'path');path.setAttribute('d','M 1 6 H 31 M 26 2 L 31 6 L 26 10');path.setAttribute('fill','none');path.setAttribute('stroke',active?'#ffe0a0':'#ed9b43');path.setAttribute('stroke-width',active?'2.5':'1.2');svg.append(path);
      if(active&&p.active.phase==='move'){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',String(2+29*p.active.progress));dot.setAttribute('cy','6');dot.setAttribute('r','3');dot.setAttribute('fill','#ffe0a0');svg.append(dot);}
      part.append(node('span','work-transfer-index',String(i+1)),from,svg,to);lane.append(part);
    }
    lane.scrollLeft=scroll;
    const key=player.event?.eventId+':'+p.active?.index;
    if(p.active&&key!==this.lastFlowKey){const active=lane.querySelector('.active'),a=active?.getBoundingClientRect(),b=lane.getBoundingClientRect();
      if(a){if(a.left<b.left)lane.scrollLeft+=a.left-b.left;else if(a.right>b.right)lane.scrollLeft+=a.right-b.right;}}
    this.lastFlowKey=key;
  }
}
