// Presentation preferences only; playback and canonical execution are untouched.
const preferenceKey='c-visualization-views.v2';
export class WorkspaceLayout {
  constructor(elements){
    this.e=elements;this.views={world:true,work:false,source:true};this.requested=null;
    try{const saved=JSON.parse(localStorage.getItem(preferenceKey));for(const key of Object.keys(this.views))if(typeof saved?.[key]==='boolean')this.views[key]=saved[key];
      if(Number.isFinite(saved?.workWidth)&&saved.workWidth>=280)this.requested=saved.workWidth;
    }catch{}
    for(const [id,key]of [['view-world','world'],['work-toggle','work'],['view-source','source']])elements[id].addEventListener('change',()=>{this.views[key]=elements[id].checked;this.save();this.apply();});
    const divider=elements['work-divider'];
    divider.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();this.drag={id:e.pointerId,x:e.clientX,width:this.size};divider.setPointerCapture(e.pointerId);});
    divider.addEventListener('pointermove',e=>{if(this.drag?.id!==e.pointerId)return;this.requested=this.drag.width+this.drag.x-e.clientX;this.apply();});
    const finish=()=>{if(this.drag){this.drag=null;this.save();}};
    divider.addEventListener('pointerup',finish);divider.addEventListener('pointercancel',finish);
    divider.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();this.requested=e.key==='Home'?null:this.size+(e.key==='ArrowLeft'?20:-20);this.save();this.apply();});
    this.observer=new ResizeObserver(()=>this.apply());
    for(const el of [document.querySelector('.animation-header'),elements['source-editor-panel'],elements['execution-input-panel'],document.querySelector('.playback-panel'),document.querySelector('.scene-panel')])if(el)this.observer.observe(el);
    window.addEventListener('resize',()=>this.apply());elements['source-editor-panel'].addEventListener('toggle',()=>this.apply());this.apply();
    elements['execution-input-panel']?.addEventListener('toggle',()=>this.apply());
  }
  save(){try{localStorage.setItem(preferenceKey,JSON.stringify({...this.views,workWidth:this.requested}));}catch{}}
  showWorld(){if(!this.views.world){this.views.world=true;this.save();this.apply();}}
  apply(){
    this.views.work=false;
    const {e}=this,workspace=document.querySelector('.animation-workspace'),scene=document.querySelector('.scene-panel'),loaded=scene.classList.contains('has-work-context'),
      world=this.views.world,work=this.views.work&&loaded,source=this.views.source;
    for(const [id,key]of [['view-world','world'],['work-toggle','work'],['view-source','source']])e[id].checked=this.views[key];
    e['world-panel'].hidden=!world;e['work-context'].hidden=!work;e['source-panel'].hidden=!source;scene.hidden=!world&&!work;e['work-divider'].hidden=!world||!work;
    scene.dataset.world=String(world);scene.dataset.work=String(work);workspace.dataset.source=String(source);workspace.dataset.main=String(world||work);
    e['view-empty'].hidden=world||work||source;e['view-empty'].textContent=this.views.work&&!loaded?'실행 기록을 준비하면 작업 보기가 표시됩니다.':'위의 보기 항목에서 표시할 화면을 선택해 주세요.';
    const top=workspace.getBoundingClientRect().top+window.scrollY,footer=document.querySelector('.playback-panel').getBoundingClientRect().height,
      available=window.innerHeight-top-footer-50,height=e['source-editor-panel'].open?Math.max(480,window.innerHeight*.70):Math.max(420,available);
    workspace.style.setProperty('--workspace-height',Math.round(height)+'px');
    const width=scene.getBoundingClientRect().width||workspace.getBoundingClientRect().width,maximum=Math.max(280,width-288);
    this.size=Math.max(280,Math.min(this.requested??Math.max(360,Math.min(480,width*.38)),maximum));
    scene.style.setProperty('--work-size',Math.round(this.size)+'px');
    e['work-divider'].setAttribute('aria-valuenow',String(Math.round(this.size/Math.max(1,width)*100)));
    e['work-divider'].setAttribute('aria-valuetext','작업 보기 너비 '+Math.round(this.size)+'픽셀 · 좌우 방향키로 조절, Home으로 초기화');
    e['work-context'].dispatchEvent(new Event('work-view-layout'));
  }
}
