import {loopLabel} from './loop-groups.js';

export class LoopEventList {
  constructor(element,recording,{describe,colors,onSeek,onSkip,expansion=new Map()}){
    Object.assign(this,{element,recording,describe,colors,onSeek,onSkip,expansion});
    this.rows=new Map();this.eventRows=new Map();this.cursor=0;
    element.replaceChildren();this.renderContents(recording.loopGroups.root,element);
  }

  expansionState(){return new Map([...this.rows].map(([id,{details}])=>[id,details.open]));}

  renderContents(group,list){
    let cursor=group.start;
    for(const child of group.children){
      while(cursor<child.start)this.renderEvent(cursor++,list);
      this.renderGroup(child,list);cursor=child.end;
    }
    while(cursor<group.end)this.renderEvent(cursor++,list);
  }

  renderEvent(index,list){
    const event=this.recording.trace.events[index],item=document.createElement('li'),button=document.createElement('button');
    item.dataset.eventIndex=index;button.type='button';button.style.setProperty('--event-color',this.colors[event.kind]);
    const badge=document.createElement('span'),text=document.createElement('span');
    badge.className='list-kind';badge.textContent=event.kind;text.textContent=`${event.eventId} · ${this.describe(event)}`;
    button.append(badge,text);button.addEventListener('click',()=>this.onSeek(index));item.append(button);list.append(item);
    this.eventRows.set(index,{item,button});
  }

  renderGroup(group,list){
    const item=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');
    item.className='loop-group';item.dataset.loopGroup=group.id;details.className='loop-details';summary.className='loop-summary';
    const label=document.createElement('span'),count=document.createElement('span');label.className='loop-label';count.className='loop-count';
    if(group.kind==='loop'){
      const frame=this.recording.frameNames.get(group.frameId)??group.scope.functionName??'';
      label.textContent=`${loopLabel(group.scope.kind)} · ${group.scope.source?.line??'?'}행 · ${frame}`;
      count.textContent=`${group.iterations.length}회${group.complete?'':' · 기록 중'}`;
    }else{
      label.textContent=`${group.number}번째 반복`;
      count.textContent=`${group.end-group.start}개 명령${group.complete?'':' · 기록 중'}`;
      if(group.includesSetup)label.textContent+=' · 초기 준비 포함';
    }
    summary.append(label,count);
    if(group.kind==='iteration'){
      const button=document.createElement('button');button.type='button';button.className='loop-skip';button.textContent='건너뛰기';
      button.setAttribute('aria-label',`${group.loop.scope.source?.line??'?'}행 ${loopLabel(group.loop.scope.kind)} ${group.number}번째 반복 건너뛰기`);
      button.title=group.complete?'이 반복 끝으로 이동':'관찰된 기록 끝까지 이동';
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.onSkip(group.end);});summary.append(button);
    }
    details.append(summary);item.append(details);list.append(item);
    let rendered=false;
    const expand=()=>{
      if(!details.open||rendered)return;
      rendered=true;const body=document.createElement('ol');body.className='loop-body';details.append(body);this.renderContents(group,body);
    };
    this.rows.set(group.id,{item,details,summary,group});
    details.addEventListener('toggle',()=>{expand();this.update(this.cursor,this.shownIndex??this.cursor);});
    details.open=this.expansion.get(group.id)??group.kind==='loop';expand();
  }

  update(cursor,shownIndex=cursor){
    this.cursor=cursor;this.shownIndex=shownIndex;
    const active=new Set();
    for(let group=this.recording.loopGroups.groupAt(shownIndex);group;group=group.parent)active.add(group.id);
    for(const {item,summary,group} of this.rows.values()){
      item.classList.toggle('loop-active',active.has(group.id));item.classList.toggle('loop-complete',cursor>=group.end);
      summary.setAttribute('aria-current',active.has(group.id)?'step':'false');
    }
    for(const [index,{item,button}] of this.eventRows){
      item.classList.toggle('event-current',index===shownIndex);item.classList.toggle('event-complete',index<cursor);
      button.setAttribute('aria-current',index===shownIndex?'step':'false');
    }
    let target=this.eventRows.get(shownIndex)?.button;
    if(!target)for(let group=this.recording.loopGroups.groupAt(shownIndex);group;group=group.parent){
      target=this.rows.get(group.id)?.summary;if(target)break;
    }
    // A collapsed iteration remains collapsed during playback; its summary
    // carries current-step highlighting instead of forcing the user to open it.
    for(let parent=target?.parentElement;parent&&parent!==this.element;parent=parent.parentElement)
      if(parent.tagName==='DETAILS'&&!parent.open)target=parent.firstElementChild;
    return target;
  }
}
