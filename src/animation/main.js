import './style.css';
import './work-context.css';
import {createRecording, Playback, formatValue} from './playback.js';
import {SceneCanvas, colors} from './canvas.js';
import {TOOL_DEVICES, toolsForEvent, spaceEffect} from './tools.js';
import {conditionForEvent} from './conditions.js';
import {transferPresentation,dataFlowForEvent} from './transfers.js';
import {effectForEvent,streamText,ioDisplayState} from './effects.js';
import {examples} from '../../scripts/animation/examples.mjs';
import {positionInputField} from './input-field.js';
import {updateOutputField} from './output-field.js';
import {eventSource,recordedFault,isAttempt} from './faults.js';
import {readAnimationSource,storeAnimationSource,customSourceId,defaultAnimationSource} from './source-input.js';
import {inputSubmission} from './terminal-input.js';
import {LoopEventList} from './event-list.js';
import {loopLabel} from './loop-groups.js';
import {loopSkipContext,loopSkipDestination} from './loop-skip.js';
import {WorkspaceLayout} from './workspace-layout.js';
import {preparePlayback} from './prepare-playback.js';
import {PreparedStructures} from './prepared-state.js';
import {decodePreparedStructures} from './prepared-format.js';
import {decodeExecution,decodeExecutionDocuments,EXECUTION_ACCEPT} from '../../scripts/shared/execution-format.mjs';

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const loopSkipButtons=[...document.querySelectorAll('[data-loop-skip]')];
const workspaceLayout=new WorkspaceLayout(elements);
const renderer = new SceneCanvas(elements.scene,{transferCanvas:elements['transfer-scene']});
renderer.inputEditor=true;
renderer.outputViewer=true;
let preparedStructures;
const names = {
  'frame.begin': '함수 공간 생성', 'frame.end': '함수 공간 정리',
  'object.begin': '상자 생성', 'object.end': '상자 정리',
  read: '값 읽기', write: '값 저장', 'write.range':'범위에 값 저장', fill:'범위 채우기', copy:'범위 복사', argument: '매개변수 전달',
  expression: '알루 계산', calculate: '알루 계산', convert: '자료형 변환', 'return.value': '반환값 준비',
  enter: '함수 진입', call: '함수 호출', resume: '호출 위치로 복귀',
  return: '반환', branch: '조건 분기', switch: '분기 선택', case: 'case 진입', 'assert.check': '조건 검증',
  conditional: '삼항 선택', jump: '실행 위치 이동', output: '출력', fault: '실행 오류',
  break: '반복·분기에서 나가기', continue: '다음 반복으로 이동',
  goto: '지정된 위치로 이동', 'loop.next': '반복 조건으로 돌아가기',
  input: '입력 읽기',
};
let player;
let eventList;
let lastTime;
let lastCursor = -1;
let loadVersion = 0;
let demoAbort;
let lastConditionKey = '';
let modelChanged = false;
let liveSession = null;
let inputBusy = false;
let focusedInputRequest = null;
let sourceEditor,sourceEditorModule,sourceEditorLoading;
elements['work-context'].addEventListener('work-view-layout',()=>{lastCursor=-1;});

function playbackReady(ready) {
  for (const id of ['play', 'restart', 'previous-event', 'next-event', 'next-line', 'skip-iteration', 'seek']) elements[id].disabled = !ready;
  if(!ready){for(const button of loopSkipButtons)button.disabled=true;elements['loop-skip-context'].textContent='반복문 안에서 사용할 수 있습니다.';}
}

function eventDescription(event) {
  if(event.kind==='ERROR')return recordedFault(player.recording,event).message;
  if(isAttempt(event))return `${eventSource(player.recording,event)?.expression??names[event.action]??event.action} · 완료되지 않음 · 결과 없음`;
  const effect=effectForEvent(player.recording,event);
  if(effect)return `${effect.name?effect.name+' · ':''}${effect.detail}`;
  const object = player.recording.objects.get(event.objectId ?? event.target?.objectId);
  const objectName=object?.name??(object?`저장소 ${object.id}`:'대상');
  const targetName=`${objectName}${event.target?.offset?` +${event.target.offset} B`:''}`;
  const definition = player.recording.instructions.get(event.instructionId);
  if (event.action === 'object.begin') return `${object.name} · ${player.recording.parameterObjects.has(object.id) ? '매개변수 저장소 연결' : `${object.cType?.name ?? object.type} · ${object.size} B`}`;
  if (event.action === 'input') return event.inputStage === 'buffer-read' ? '도착한 입력의 버퍼 읽기' : `입력 도착 · ${event.byteLength ?? 0} 바이트`;
  if (event.kind === 'READ') return `${targetName}에서 ${formatValue(event.value)} 읽기`;
  if (event.kind === 'CALC') return `${definition.source?.expression ?? event.operator} → ${formatValue(event.value)}`;
  const condition = conditionForEvent(player.recording, event);
  if (event.kind === 'FLOW' && condition) return `${condition.expression} → ${condition.selected ?? '판정 미확정'}`;
  if (event.action === 'argument') return `${player.recording.frameNames.get(event.activationId)}.${object?.name ?? event.name} ← ${formatValue(event.value)}`;
  if (event.kind === 'WRITE' && object) return `${targetName} ← ${formatValue(event.value)}`;
  if (event.action === 'return.value') return `반환구 ← ${formatValue(event.value)}`;
  if (event.action === 'frame.begin') return player.recording.frameNames.get(event.frameId);
  if (event.action === 'frame.end') return player.recording.framePresentationUntil.get(event.frameId) > player.recording.eventOrder.get(event.eventId)
    ? `${player.recording.frameNames.get(event.frameId)} · 실행 종료, 반환값 전달 후 공간 정리`
    : `${player.recording.frameNames.get(event.frameId)} · ${(event.endedObjects ?? []).map(id => player.recording.objects.get(id)?.name ?? id).join(', ') || '지역 공간'} 정리`;
  if (event.action === 'resume') return `${player.recording.calls.get(event.callExecutionId)?.event.resolvedFunctionName ?? '함수'} → ${player.recording.frameNames.get(event.activationId)}${event.value ? ` · ${formatValue(event.value)}` : ''}`;
  if (event.action === 'loop.next') return names[event.action];
  return definition.source?.expression ?? player.recording.frames.get(event.activationId)?.functionName ?? event.action;
}

async function loadRecording(plan, trace, {cursor=0,preserveLayout=false,inputRequest=null,navigation,workAnalysis,preparedScene,signal}={}) {
  preparedScene=decodePreparedStructures(preparedScene);
  modelChanged = false;
  const version=loadVersion;
  playbackReady(false);elements['demo-status'].hidden=false;elements['demo-status'].textContent='실행 기록 분석 · 자료구조와 재생 장면을 미리 준비하고 있습니다.';
  if(preparedScene&&(preparedScene.programId!==plan.programId||preparedScene.runId!==trace.runId||preparedScene.eventCount!==trace.events.length))throw new Error('재생 준비 정보가 현재 실행 기록과 다릅니다.');
  const prepared=preparedScene?new PreparedStructures(preparedScene):await preparePlayback(plan,trace,workAnalysis?.structureInference,{signal,onProgress:p=>{if(version===loadVersion)elements['demo-status'].textContent=`재생 준비 · 저장소 ${p.done}/${p.total}`;}});
  if(version!==loadVersion)return;
  preparedStructures=prepared;
  const recording = createRecording(plan, trace,navigation);
  player = new Playback(recording);
  player.inputRequest = inputRequest;
  if(cursor)player.seek(cursor);
  renderer.recording = recording;
  workspaceLayout.apply();
  player.speed = Number(elements.speed.value);
  lastTime = undefined;
  lastCursor = -1;
  lastConditionKey = '';
  elements.seek.max = recording.playbackLength;
  elements['trace-status'].textContent = `${trace.events.length}개 명령어`;
  showSource(plan.sourceMap?.snapshot);
  elements['error-panel'].hidden=true;
  const expansion=preserveLayout?eventList?.expansionState():undefined;
  eventList=new LoopEventList(elements['event-list'],recording,{describe:eventDescription,colors,onSeek:seek,onSkip:skip,expansion});
  // Do not reveal the terminal runtime diagnostic before its recorded event.
  elements['recording-message'].textContent = trace.status==='running'?'실제 실행 세션 · 입력 대기까지 관찰된 과정':'실제 중간언어 실행 기록 · 재생할 위치를 선택해 주세요.';
  elements['recording-message'].classList.remove('failed');
  elements['demo-status'].hidden = true;
  playbackReady(true);
  if(!preserveLayout){renderer.reset();renderer.fit(player.state);}
  renderer.layout.setPrepared(preparedStructures);renderer.autoFocusKey=null;
  refresh();
}


function showSource(snapshot) {
  const sourceFile=snapshot?.file??'실행한 코드';
  elements['source-name'].textContent = sourceFile.split(/[\\/]/).at(-1);
  elements['source-name'].title=sourceFile;
  const source = snapshot?.text;
  elements['source-code'].replaceChildren();
  if (typeof source === 'string') {
    source.split('\n').forEach((text, index) => {
      const row = document.createElement('span');
      row.className = 'source-line';
      row.dataset.line = index + 1;
      const number = document.createElement('span');
      number.className = 'line-number';
      number.textContent = index + 1;
      const content = document.createElement('span');
      content.className = 'line-content';
      content.textContent = text || ' ';
      content.dataset.text = text;
      row.append(number, content);
      elements['source-code'].append(row);
    });
  } else elements['source-code'].textContent = '기록에 원본 코드가 없습니다.';
}

function highlightSource(event, {source=player&&eventSource(player.recording,event),failed=false}={}) {
  const range = source?.editorRange;
  let firstActive;
  for (const row of elements['source-code'].children) {
    const line = Number(row.dataset.line);
    const active = source && line >= (range?.startLineNumber ?? source.line) && line <= (range?.endLineNumber ?? source.line);
    row.classList.toggle('source-active', Boolean(active));
    row.classList.toggle('source-error', Boolean(active&&failed));
    if (active && !firstActive) firstActive = row;
    const content = row.querySelector('.line-content');
    const text = content.dataset.text;
    content.textContent = text || ' ';
    if (active && range) {
      const start = line === range.startLineNumber ? range.startColumn - 1 : 0;
      const end = line === range.endLineNumber ? range.endColumn - 1 : text.length;
      const mark = document.createElement('mark');
      mark.textContent = text.slice(start, end);
      content.replaceChildren(document.createTextNode(text.slice(0, start)), mark, document.createTextNode(text.slice(end)));
    }
  }
  revealInPanel(elements['source-code'], firstActive);
}

function showFault(fault) {
  elements['error-panel'].hidden=!fault;
  if(!fault)return;
  elements['error-title'].textContent=fault.title;
  elements['error-message'].textContent=fault.message;
  const source=fault.source,line=source?.editorRange?.startLineNumber??source?.line;
  const column=source?.editorRange?.startColumn??source?.column;
  elements['error-location'].textContent=line?`${source.file??elements['source-name'].textContent}:${line}${column?':'+column:''}`:'정확한 코드 위치가 기록되지 않았습니다.';
  elements['error-details'].textContent=fault.details??fault.code??'';
  elements['error-details'].hidden=!elements['error-details'].textContent;
}

function showBuildFailure(result) {
  closeLiveSession();player=null;playbackReady(false);
  elements['work-context'].hidden=true;
  elements['work-context'].closest('.scene-panel').classList.remove('has-work-context');renderer.workTargets=undefined;
  workspaceLayout.apply();
  const fault=result.failure??{title:'실행 준비 오류',message:result.error};
  if(sourceEditor&&sourceEditor.getValue()===result.snapshot?.text){
    sourceEditorModule.setCompilerDiagnostics(sourceEditor,fault.diagnostics??[]);
    if(fault.source?.line)sourceEditor.revealLineInCenter(fault.source.line);
    elements['source-editor-status'].textContent=`${fault.title} · ${fault.message}`;
  }
  showSource(result.snapshot);showFault(fault);
  highlightSource(null,{source:fault.source,failed:true});
  elements['condition-panel'].hidden=true;
  eventList=null;
  elements['event-list'].replaceChildren();elements['trace-status'].textContent='실행 시작 전 중단';
  elements['event-kind'].textContent='오류';elements['event-title'].textContent=fault.title;
  elements['event-description'].textContent=fault.message;elements['event-count'].textContent='0 / 0';
  updateOutputField(elements['scene-output'],'실행되지 않았습니다.');
  elements['demo-status'].textContent=`${fault.title} · 실행되지 않았습니다.`;
  elements['demo-status'].hidden=false;
  elements['recording-message'].textContent=fault.message;
  elements['recording-message'].classList.add('failed');
}

function revealInPanel(panel, item) {
  if (!item) return;
  const viewport = panel.getBoundingClientRect();
  const rectangle = item.getBoundingClientRect();
  const top=viewport.top+panel.clientTop+5,bottom=viewport.top+panel.clientTop+panel.clientHeight-5;
  if (rectangle.top < top) panel.scrollTop += rectangle.top - top;
  else if (rectangle.bottom > bottom) panel.scrollTop += rectangle.bottom - bottom;
}

new ResizeObserver(()=>revealInPanel(elements['source-code'],elements['source-code'].querySelector('.source-active'))).observe(elements['source-code']);

function refresh() {
  if (!player) return;
  const event = player.event;
  const shownEvent=event??player.faultEvent;
  const fault=recordedFault(player.recording,shownEvent);
  showFault(fault);
  elements['recording-message'].classList.toggle('failed',Boolean(fault));
  elements['recording-message'].textContent=fault?`${fault.title} · ${fault.message}`:!event&&!player.waitingForInput?`실행 종료 · 종료 코드 ${player.recording.trace.exitCode??'—'}`:'실제 중간언어 실행 기록 · 앞선 과정부터 순서대로 재생합니다.';
  const waiting=player.waitingForInput;
  elements.play.disabled=waiting||inputBusy;
  elements.play.textContent = waiting ? '입력 대기' : player.playing ? '일시정지' : player.event ? '재생' : '다시 재생';
  elements['input-field'].classList.toggle('input-waiting',waiting);
  elements['input-label'].textContent=waiting?`입력 대기${player.inputRequest.name?' · '+player.inputRequest.name:''}`:'실행 중 전달할 입력';
  elements['apply-input'].textContent=inputBusy?'입력 처리 중…':waiting?'입력 전송하고 계속':'입력 단계에서 전송';
  elements['apply-input'].disabled=!waiting||inputBusy;
  elements['input-eof'].disabled=!waiting||inputBusy;
  elements['input-line-mode'].disabled=!waiting||inputBusy||elements['input-eof'].checked;
  if(waiting&&focusedInputRequest!==player.inputRequest){
    focusedInputRequest=player.inputRequest;
    const mat=renderer.layout.toolRectangle('tool:input');
    if(!renderer.camera.visible(mat,renderer.width,renderer.height)){
      renderer.camera.fit({...mat,x:mat.x-80,y:mat.y-80,width:mat.width+160,height:mat.height+160},renderer.width,renderer.height);
      renderer.onCameraChange(renderer.camera.scale);
    }
    elements['demo-input'].focus({preventScroll:true});
  }
  elements.seek.value = player.cursor;
  elements.seek.setAttribute('aria-valuetext', `${player.cursor} / ${player.recording.trace.events.length}개 완료`);
  elements['previous-event'].disabled = player.cursor === 0 && player.progress === 0;
  elements['next-event'].disabled = !event;
  elements['next-line'].disabled = !event;
  const loopContext=loopSkipContext(player.recording.loopGroups,player.cursor),loop=loopContext?.loop;
  elements['loop-skip-context'].textContent=loop?`${loopLabel(loop.scope.kind)} · ${loop.scope.source?.line??'?'}행 · ${loopContext.remaining?'남은 '+loopContext.remaining+'회':'종료 판정'}${loop.complete?'':' · 기록된 부분'}`:'반복문 안에서 사용할 수 있습니다.';
  for(const button of loopSkipButtons){
    button.disabled=!loopContext||inputBusy||!event;
    const count=button.dataset.loopSkip==='all'?'all':Number(button.dataset.loopSkip),destination=loopContext&&loopSkipDestination(player.recording.loopGroups,player.cursor,count);
    button.title=destination?`${loopLabel(loop.scope.kind)} · ${loop.scope.source?.line??'?'}행: ${destination.skipped}회 반영 후 ${destination.target!==loop.end?'다음 반복으로':loop.complete?'반복문 밖으로':'현재 기록 끝으로'} 이동`:'현재 명령이 반복 안에 있을 때 사용할 수 있습니다.';
  }
  const presentation = transferPresentation(player.recording, event, player.progress, {inspection: player.presentationMode === 'inspect'});
  refreshCondition(presentation.resultReady);
  const requiredTools = toolsForEvent(event, player.recording).map(id => TOOL_DEVICES.find(device => device.id === id).name);
  const onsite = spaceEffect(event);
  const endpointName = endpoint => endpoint.kind === 'device' ? '알루' : endpoint.kind === 'object' ? player.recording.objects.get(endpoint.id)?.name ?? '상자' : endpoint.kind==='mat'?({'tool:input':'입력','tool:output':'출력','tool:workbench':'외부 호출 결과'}[endpoint.id]??'영역') : '반환구';
  const active = presentation.active?.edge;
  const phases={prepare:'작업 준비',emphasis:'전달선 강조',move:'값 이동',arrival:'도착 확인',gather:'모인 값 확인',calculate:'계산 중',apply:'목적지에 반영',hold:'결과 확인',fade:'전달선 정리'};
  const status = presentation.inspection && presentation.total ? `전달 경로 미리보기 · ${presentation.total}개 · 번호 순서로 전달`
    : active ? `${endpointName(active.from)} → ${endpointName(active.to)} · 사건 ${presentation.active.index + 1}/${presentation.total} · ${phases[presentation.phase]??''}`
    : requiredTools.length ? `이번 작업 도구 · ${requiredTools.join(' + ')}${presentation.total ? ` · ${presentation.arrived}/${presentation.total} 도착` : ''}`
      : onsite ? `현장 ${onsite === 'assemble' ? '생성' : '정리'} 효과` : event?.kind === 'READ' ? '대상에서 바로 읽기' : event?.kind === 'WRITE' ? '대상에 바로 대입' : '';
  const effect=effectForEvent(player.recording,event);
  const toolStatus = status + (!presentation.inspection&&!active&&phases[presentation.phase]?` · ${phases[presentation.phase]}`:'') + (effect?` · ${effect.name?effect.name+' · ':''}${effect.detail}`:'') + (renderer.transferMissing ? ` · 전달선 배치 미완료 ${renderer.transferMissing}개` : '');
  const displayedStatus=waiting?'입력 대기 · 입력 돗자리에서 내용을 전송해 주세요.':toolStatus;
  if (elements['tool-status'].textContent !== displayedStatus) elements['tool-status'].textContent = displayedStatus;
  const io=ioDisplayState(player,presentation.valueReady,presentation.effectReady);
  updateOutputField(elements['scene-output'],streamText(io,elements['output-channel'].value) || '아직 출력이 없습니다.');
  const observed=io.input||'아직 도착한 입력이 없습니다.';
  elements['input-observed'].classList.toggle('input-empty',!io.input);
  if(elements['input-observed'].textContent!==observed)elements['input-observed'].textContent=observed;
  if (lastCursor === player.cursor) return;
  lastCursor = player.cursor;
  elements['event-kind'].textContent = shownEvent?.kind ?? (waiting?'입력 대기':'완료');
  elements['event-kind'].style.color = colors[shownEvent?.kind] ?? colors.SPACE;
  elements['event-title'].textContent = fault?.title??(event ? event.action === 'object.begin' && player.recording.parameterObjects.has(event.objectId) ? '매개변수 저장소 연결' : names[event.action] : waiting?'입력을 기다리고 있습니다.':'실행 종료');
  elements['event-description'].textContent = shownEvent ? eventDescription(shownEvent) : waiting?'입력을 전송하면 같은 실행이 이어집니다.':`종료 코드 ${player.recording.trace.exitCode ?? '—'}`;
  elements['event-count'].textContent = `${player.cursor} / ${player.recording.trace.events.length}`;
  highlightSource(shownEvent??(waiting?player.recording.trace.events.findLast(e=>e.action==='call'):null),{failed:Boolean(fault)});
  const shownIndex=player.faultEvent?player.cursor-1:player.cursor;
  revealInPanel(elements['event-list'],eventList?.update(player.cursor,shownIndex));
}

function refreshCondition(ready) {
  const event = player.event;
  const condition = conditionForEvent(player.recording, event);
  const key = `${event?.eventId}:${ready}`;
  if (lastConditionKey === key) return;
  lastConditionKey = key;
  elements['condition-panel'].hidden = !condition;
  delete elements['source-code'].dataset.truth;
  elements['source-code'].title = '';
  if (!condition) return;
  const state = !ready ? 'pending' : condition.truth === true ? 'true' : condition.truth === false ? 'false' : 'unknown';
  const summary = condition.mode === 'selection' ? `값 선택 · ${condition.selected}` : !ready ? '판정 중' : condition.mode === 'parts' ? '계산 안의 부분 판정' : condition.truth === true ? '참 · True' : condition.truth === false ? '거짓 · False' : '판정 미확정';
  elements['condition-summary'].textContent = summary;
  elements['condition-summary'].className = `truth-${state}`;
  elements['condition-expression'].textContent = condition.expression;
  if (ready && typeof condition.truth === 'boolean') elements['source-code'].dataset.truth = String(condition.truth);
  elements['condition-parts'].replaceChildren();
  const status = truth => !ready ? '판정 중' : truth === true ? '참' : truth === false ? '거짓' : '미확정';
  for (const part of condition.parts) {
    const row = document.createElement('div');
    row.className = 'condition-part';
    const title = document.createElement('span');
    title.textContent = `${part.expression} → ${status(part.truth)}`;
    title.className = `truth-${!ready ? 'pending' : part.truth === true ? 'true' : part.truth === false ? 'false' : 'unknown'}`;
    row.append(title);
    for (const operand of part.operands) {
      const item = document.createElement('span');
      item.className = `condition-operand truth-${operand.skipped ? 'skipped' : !ready ? 'pending' : operand.truth === true ? 'true' : operand.truth === false ? 'false' : 'unknown'}`;
      item.textContent = `${operand.expression} · ${operand.skipped ? '평가 생략' : status(operand.truth)}`;
      if (operand.skipped) {
        item.title = '앞 피연산자만으로 결과가 결정되어 실행되지 않았습니다. 부작용도 발생하지 않습니다.';
        elements['source-code'].title = item.title;
      }
      row.append(item);
    }
    elements['condition-parts'].append(row);
  }
  if (condition.selected && condition.mode !== 'selection') {
    const selected = document.createElement('p');
    selected.textContent = condition.selected;
    elements['condition-parts'].append(selected);
  }
}

function seek(index) {
  if (!player) return;
  player.seek(index);
  refreshNavigation();
}

function refreshNavigation(){
  const ready=renderer.prepareWiring(player);
  elements.scene.setAttribute('aria-busy',String(!ready));refresh();
}

function skip(index){
  if(!player)return;
  player.skipTo(index);refreshNavigation();
}

for(const button of loopSkipButtons)button.addEventListener('click',()=>{
  if(!player||inputBusy||!player.event)return;
  const count=button.dataset.loopSkip==='all'?'all':Number(button.dataset.loopSkip),destination=loopSkipDestination(player.recording.loopGroups,player.cursor,count);
  if(destination)skip(destination.target);
});

function togglePlayback(){
  if (!player||elements.play.disabled) return;
  if (player.playing) player.playing = false;
  else player.play();
  refresh();
}
elements.play.addEventListener('click',togglePlayback);
window.addEventListener('keydown',event=>{
  if((event.code!=='Space'&&event.key!==' ')||event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
  if(event.target?.closest?.('textarea,input:not([type="range"]),select,[contenteditable],[role="textbox"],.monaco-editor'))return;
  if(!player)return;
  event.preventDefault();
  if(!event.repeat)togglePlayback();
});
elements.restart.addEventListener('click', () => seek(0));
elements['previous-event'].addEventListener('click', () => {
  if (player) seek(player.progress > 0 ? player.cursor : player.cursor - 1);
});
elements['next-event'].addEventListener('click', () => {
  if (!player?.event) return;
  player.stepInstruction();
  refreshNavigation();
});
elements['next-line'].addEventListener('click', () => {
  if (!player?.event) return;
  player.stepLine();
  refreshNavigation();
});
elements.seek.addEventListener('input', () => seek(Number(elements.seek.value)));
elements.speed.addEventListener('input', () => {
  const speed=Number(elements.speed.value),text=`${Number(speed.toFixed(2))}×`;
  if(player)player.speed=speed;
  elements['speed-value'].textContent=text;
  elements.speed.setAttribute('aria-valuetext',text);
});
for(const id of ['input-field','output-field'])elements[id].addEventListener('wheel',event=>{
  if(!event.ctrlKey&&!event.metaKey)return;
  event.preventDefault();
  const unit=event.deltaMode===1?18:event.deltaMode===2?renderer.height:1,point=renderer.canvasPoint(event);
  renderer.zoom(Math.exp(-event.deltaY*unit*0.002),point.x,point.y);
},{passive:false});
elements['output-channel'].addEventListener('change',()=>{renderer.outputChannel=elements['output-channel'].value;refresh();});
renderer.onCameraChange = scale => { elements['zoom-label'].textContent = `${scale >= 0.01 ? Math.round(scale * 100) : (scale * 100).toPrecision(2)}%`; };
function selectionMessage(){
  const selection=renderer.selection;if(!selection)return '';
  const geometry=renderer.layout.resolve(renderer.sceneState),drawer=geometry.containers.get(selection.logicalId);
  const count=drawer?[...geometry.cells.values()].filter(cell=>cell.objectId===drawer.objectId&&!cell.hidden&&cell.offset>=drawer.offset&&cell.offset<drawer.offset+drawer.size).length:0;
  return `${selection.name} 선택${drawer?` · ${Math.round(drawer.width)}×${Math.round(drawer.height)} · ${count}칸 표시`:''}${renderer.wireFocus?.edges.size?` · 연결 ${renderer.wireFocus.edges.size}개 강조`:''}`;
}
renderer.onSelectionChange = selection => {
  elements['selection-status'].textContent = selectionMessage();
  const button = elements['toggle-selected']; button.hidden = selection?.kind !== 'aggregate';
  if (!button.hidden) {
    button.textContent = renderer.layout.collapsed.has(selection.logicalId) ? '펼치기' : '접기';
    button.setAttribute('aria-label', `${selection.name} ${button.textContent}`);
  }
  const selector=elements['structure-view'],track=preparedStructures?.tracks.get(selection?.objectId??selection?.id);selector.hidden=!track;
  if(track)selector.value=preparedStructures.choices.get(track.objectId)??'auto';
  refreshStructureControls();
};
elements['structure-view'].addEventListener('change',()=>{const id=renderer.selection?.objectId??renderer.selection?.id;preparedStructures?.setView(id,elements['structure-view'].value);renderer.layout.setPrepared(preparedStructures);refreshStructureControls();});
function refreshStructureControls(){const id=renderer.selection?.objectId??renderer.selection?.id,p=preparedStructures?.at(id,player?.cursor??-1),control=document.getElementById('graph-direction');control.hidden=p?.view!=='graph';control.value=preparedStructures?.options.get(id)?.directed===undefined?'recorded':preparedStructures.options.get(id).directed?'directed':'undirected';}
document.getElementById('graph-direction').addEventListener('change',event=>{const id=renderer.selection?.objectId??renderer.selection?.id;preparedStructures?.setOptions(id,{directed:event.target.value==='recorded'?undefined:event.target.value==='directed'});renderer.layout.setPrepared(preparedStructures);});
elements['follow-work'].addEventListener('change',()=>{renderer.autoFocusKey=null;});
for(const name of ['pointerdown','wheel'])elements.scene.addEventListener(name,()=>{elements['follow-work'].checked=false;});
elements.scene.addEventListener('keydown',event=>{if(event.code!=='Space'&&event.key!==' ')elements['follow-work'].checked=false;});
for(const id of ['zoom-in','zoom-out','fit-view','focus-event'])elements[id].addEventListener('click',()=>{elements['follow-work'].checked=false;});
elements['toggle-selected'].addEventListener('click', () => renderer.toggleSelected());
elements['zoom-in'].addEventListener('click', () => renderer.zoom(1.25));
elements['zoom-out'].addEventListener('click', () => renderer.zoom(0.8));
elements['fit-view'].addEventListener('click', () => renderer.fit(player?.after));
elements['focus-event'].addEventListener('click', () => { if (player) renderer.focusEvent(player); });
elements['reset-layout'].addEventListener('click', () => { renderer.reset();renderer.layout.setPrepared(preparedStructures);renderer.fit(player?.state); });
elements['load-recording'].addEventListener('click', () => elements['recording-files'].click());
elements['recording-files'].addEventListener('change', async () => {
  const files = [...elements['recording-files'].files];
  if (!files.length) return;
  const version = ++loadVersion;
  demoAbort?.abort();
  closeLiveSession();
  elements['run-demo'].disabled = false;
  elements['run-source'].disabled=!sourceEditor;
  if (player) player.playing = false;
  try {
    const documents = decodeExecutionDocuments(await Promise.all(files.map(async file => JSON.parse(await file.text()))));
    if (version !== loadVersion) return;
    const combined = documents.find(document => document.plan && document.trace);
    const plan = combined?.plan ?? documents.find(document => document.instructions && document.bindings);
    const trace = combined?.trace ?? documents.find(document => document.events && document.objects);
    await loadRecording(plan, trace,{navigation:combined?.navigation,workAnalysis:combined?.workAnalysis,preparedScene:combined?.preparedScene});
  } catch (error) {
    elements['recording-message'].textContent = error.message;
    elements['recording-message'].classList.add('failed');
  }
  elements['recording-files'].value = '';
});

function tick(now) {
  if (player) {
    const cursor = player.cursor;
    const elapsed = lastTime === undefined ? 0 : Math.min(now - lastTime, 100);
    let ready = renderer.prepareWiring(player);
    if (ready) player.advance(Math.min(elapsed, (1 - player.progress) * player.duration / player.speed));
    if (cursor !== player.cursor) ready=renderer.prepareWiring(player);
    refresh();
    renderer.workTargets=[...(player.event?.target?[{...player.event.target,role:player.event.kind==='WRITE'?'write':'read'}]:[]),...dataFlowForEvent(player.recording,player.event).flatMap(e=>[e.from,e.to].filter(p=>p.kind==='object').map(p=>({objectId:p.id,offset:p.offset??0,size:p.size??1,role:'read'})))];
    if(elements['follow-work'].checked)renderer.followWork(player);
    renderer.render(player);
    const preparing=renderer.wiring.frameProgress;
    const wireStatus = renderer.wiring.error ? `배선 오류: ${renderer.wiring.error}` : !ready ? preparing?`장면 복원 중 · ${Math.min(preparing.done,preparing.total)}/${preparing.total}`:'객체 배치·포인터 배선 준비 중…' : '';
    elements.scene.setAttribute('aria-busy', String(!ready));
    if (wireStatus) elements['selection-status'].textContent = wireStatus;
    else if (renderer.selection) elements['selection-status'].textContent = selectionMessage();
    else {
      const result = renderer.wireBoundaries?.[1];
      elements['selection-status'].textContent = result?.stats.edges ? `포인터 ${result.stats.edges}개 · ${result.stats.milliseconds.toFixed(1)} ms${result.missing.length ? ` · 미배선 ${result.missing.length}개` : ''}${result.quality.overlaps ? ` · 겹침 ${result.quality.overlaps}구간` : ''}` : '';
    }
  }
  for(const [id,mat] of [['input-field','tool:input'],['output-field','tool:output']]){
    if(player)positionInputField(elements[id],renderer,mat);
    else elements[id].hidden=true;
  }
  lastTime = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const demos = Object.fromEntries(Object.entries(examples).map(([id,example])=>[id,example.name]));
let customSource=null;
try {customSource=readAnimationSource(sessionStorage);} catch { /* Examples remain available without storage. */ }
demos[customSourceId]='직접 작성한 C 코드';
for(const [id,name] of Object.entries(demos))if(![...elements.demo.options].some(option=>option.value===id))elements.demo.add(new Option(name,id));
function configureInput(){elements['execution-stdin'].value=examples[elements.demo.value]?.stdin??elements['execution-stdin'].value;elements['demo-input'].value=examples[elements.demo.value]?.stdin??'';elements['input-eof'].checked=false;elements['run-demo'].textContent=elements.demo.value===customSourceId?'코드 다시 실행':'예제 다시 실행';}
const requestedDemo = new URLSearchParams(location.search).get('demo');
if (Object.hasOwn(demos, requestedDemo)) elements.demo.value = requestedDemo;
const fromEditor=new URLSearchParams(location.search).get('source')==='editor';
const directEntry=new URLSearchParams(location.search).get('source')==='direct';
if(fromEditor&&customSource!==null)elements.demo.value=customSourceId;
if(directEntry)elements.demo.value=customSourceId;
configureInput();
elements.demo.addEventListener('change', () => { configureInput();void runSelectedSource(); });
elements['run-demo'].addEventListener('click', () => { void runSelectedSource(); });
elements['run-source'].addEventListener('click',()=>{void runCustomSource();});
elements['source-editor-panel'].addEventListener('toggle',()=>{
  if(elements['source-editor-panel'].open)void prepareSourceEditor();
});

async function prepareSourceEditor(){
  if(sourceEditor){sourceEditor.layout();return sourceEditor;}
  if(!sourceEditorLoading)sourceEditorLoading=(async()=>{
    elements['source-editor-status'].textContent='코드 편집기를 준비하고 있습니다.';
    sourceEditorModule=await import('../code-editor.js');
    sourceEditor=sourceEditorModule.createCodeEditor(elements['source-editor'],customSource??defaultAnimationSource,()=>{void runCustomSource();});
    sourceEditor.onDidChangeModelContent(()=>{
      sourceEditorModule.setCompilerDiagnostics(sourceEditor,[]);
      elements['source-editor-status'].textContent='수정한 내용은 다시 실행하면 적용됩니다.';
      try {storeAnimationSource(sessionStorage,sourceEditor.getValue());} catch { /* Running does not require storage. */ }
    });
    elements['run-source'].disabled=elements['run-demo'].disabled;
    elements['source-editor-status'].textContent='코드를 작성하거나 붙여넣은 뒤 컴파일·시각화를 눌러 주세요.';
    return sourceEditor;
  })();
  try{return await sourceEditorLoading;}
  catch(error){sourceEditorLoading=null;elements['source-editor-status'].textContent=`편집기를 준비하지 못했습니다. ${error.message}`;return null;}
}

async function runCustomSource(){
  if(elements['run-demo'].disabled)return;
  const editor=await prepareSourceEditor();if(!editor)return;
  customSource=editor.getValue();
  try {storeAnimationSource(sessionStorage,customSource);} catch { /* Keep the in-memory source usable. */ }
  sourceEditorModule.setCompilerDiagnostics(editor,[]);
  elements.demo.value=customSourceId;configureInput();
  elements['source-editor-status'].textContent='입력한 코드로 실행 기록을 만들고 있습니다.';
  await loadDemo();
}

function runSelectedSource(){
  if(elements.demo.value!==customSourceId)return loadDemo();
  if(!sourceEditor&&customSource!==null)return loadDemo();
  elements['source-editor-panel'].open=true;
  return runCustomSource();
}
elements['apply-input'].addEventListener('click',()=>{void submitInput();});
elements['input-eof'].addEventListener('change',()=>refresh());
elements['demo-input'].addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;
  event.preventDefault();
  if(!event.repeat&&player?.waitingForInput&&!inputBusy)void submitInput();
});
window.addEventListener('pagehide',closeLiveSession);
if (import.meta.hot) {
  let modelRefresh;
  import.meta.hot.on('animation:model-changed', () => {
    clearTimeout(modelRefresh);
    if(directEntry&&!player)return;
    if (player?.cursor > 0 || player?.playing) {
      if (!modelChanged) elements['recording-message'].textContent += ' · 모델 변경됨: 예제 다시 실행으로 갱신';
      modelChanged = true; return;
    }
    modelRefresh = setTimeout(() => { void loadDemo(); }, 200);
  });
}

async function loadDemo() {
  const version = ++loadVersion;
  closeLiveSession();
  if (player) player.playing = false;
  player = null;
  demoAbort?.abort();
  const controller = new AbortController();
  demoAbort = controller;
  playbackReady(false);
  elements['condition-panel'].hidden = true;
  elements['run-demo'].disabled = true;
  elements['run-source'].disabled=true;
  elements['apply-input'].disabled=true;
  elements['demo-status'].hidden = false;
  elements['demo-status'].textContent = `${demos[elements.demo.value]}\n현재 중간언어 모델로 컴파일·실행하고 있습니다.`;
  elements['recording-message'].textContent = '현재 모델로 새 실행 기록을 생성하고 있습니다.';
  elements['recording-message'].classList.remove('failed');
  elements['error-panel'].hidden=true;
  try {
    const program=elements.demo.value===customSourceId?{source:customSource}:{example:elements.demo.value};
    const batch=elements['execution-input-mode'].value==='batch';
    const input={method:'POST',headers:{'Content-Type':'application/json',Accept:EXECUTION_ACCEPT},body:JSON.stringify({...program,...batch?{inputMode:'batch',stdin:elements['execution-stdin'].value}:{}})};
    const response = await fetch('/api/animation/sessions', {...input,cache: 'no-store', signal: controller.signal});
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('중간언어 모델 서버에 연결하지 못했습니다. 로컬 개발 서버에서 실행해 주세요.');
    const result = decodeExecution(await response.json());
    if(version!==loadVersion){if(result.type==='input')void fetch(`/api/animation/sessions/${result.sessionId}`,{method:'DELETE'});return;}
    if (!response.ok) {if(result.failure){showBuildFailure(result);return;}throw new Error(result.error ?? '예제를 생성하지 못했습니다.');}
    const {plan, trace} = result;
    liveSession=result.type==='input'?result.sessionId:null;
    await loadRecording(plan, trace,{inputRequest:result.request??null,navigation:result.navigation,workAnalysis:result.workAnalysis,signal:controller.signal});
    if(program.source!==undefined)elements['source-editor-status'].textContent='실행 기록을 준비했습니다. 아래 재생 버튼으로 과정을 확인하세요. 편집은 현재 기록에 영향을 주지 않습니다.';
  } catch (error) {
    if (version !== loadVersion || error.name === 'AbortError') return;
    elements['demo-status'].textContent = `${error.message}\n‘예제 다시 실행’으로 재시도할 수 있습니다.`;
    elements['recording-message'].textContent = error.message;
    elements['recording-message'].classList.add('failed');
  } finally {
    if (version === loadVersion) {elements['run-demo'].disabled = false;elements['run-source'].disabled=!sourceEditor;refresh();}
  }
}

function closeLiveSession(){
  if(liveSession)void fetch(`/api/animation/sessions/${liveSession}`,{method:'DELETE',keepalive:true}).catch(()=>{});
  liveSession=null;inputBusy=false;focusedInputRequest=null;
}

async function submitInput(){
  if(!liveSession||!player?.waitingForInput||inputBusy)return;
  const version=loadVersion,cursor=player.cursor,session=liveSession;
  const {stdin,eof}=inputSubmission(elements['demo-input'].value,{eof:elements['input-eof'].checked,lineMode:elements['input-line-mode'].checked});
  inputBusy=true;player.playing=false;refresh();
  try {
    const response=await fetch(`/api/animation/sessions/${session}/input`,{
      method:'POST',headers:{'Content-Type':'application/json',Accept:EXECUTION_ACCEPT},signal:demoAbort?.signal,
      body:JSON.stringify({stdin,eof,requestId:player.inputRequest.id})});
    const result=decodeExecution(await response.json());
    if(version!==loadVersion)return;
    if(!response.ok)throw new Error(result.error??'입력을 전달하지 못했습니다.');
    liveSession=result.type==='input'?result.sessionId:null;
    elements['demo-input'].value='';elements['input-eof'].checked=false;
    await loadRecording(result.plan,result.trace,{cursor,preserveLayout:true,inputRequest:result.request??null,navigation:result.navigation,workAnalysis:result.workAnalysis,signal:demoAbort?.signal});
    player.play();
  }catch(error){
    if(version!==loadVersion||error.name==='AbortError')return;
    elements['recording-message'].textContent=error.message;
    elements['recording-message'].classList.add('failed');
  }finally{if(version===loadVersion){inputBusy=false;refresh();}}
}
if(directEntry){
  playbackReady(false);elements['source-editor-panel'].open=true;
  elements['demo-status'].textContent='위에서 C 코드를 작성한 뒤 ‘컴파일·시각화’를 눌러 주세요.';
}else if(fromEditor&&customSource===null){
  playbackReady(false);elements['demo-status'].textContent='전달된 코드가 없습니다. C 작업실에서 코드를 작성한 뒤 ‘현재 코드 시각화’를 눌러 주세요.';
  elements['recording-message'].textContent='상단 C 작업실에서 코드를 작성할 수 있습니다.';
}else void loadDemo();
