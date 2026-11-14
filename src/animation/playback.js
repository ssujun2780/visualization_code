import {dataFlowForEvent,instructionTiming} from './transfers.js';
import {typeResolver, beginMemory, observeMemory, hydrateMemory, memoryPresentation, synchronizeAliases} from './memory.js';
import {storageRoot} from '../../scripts/shared/storage-alias.mjs';
import {isAttempt,eventSource} from './faults.js';
import {indexLoops} from './loop-groups.js';
import {internalConstantStorage,sourceVisibleObjects} from './source-storage.js';
import {conditionFlowActions} from './conditions.js';

const scalarActions = new Map([
  ['SPACE', new Set(['frame.begin', 'frame.end', 'object.begin', 'object.end'])],
  ['READ', new Set(['read', 'input'])],
  ['WRITE', new Set(['write', 'write.range', 'input', 'argument', 'return.value', 'output', 'copy', 'fill'])],
  ['CALC', new Set(['expression', 'calculate', 'convert'])],
  ['FLOW', new Set(['enter', 'call', 'resume', 'return', ...conditionFlowActions, 'case', 'jump', 'break', 'continue', 'goto', 'loop.next'])],
  ['ERROR', new Set(['fault'])],
]);

export function formatValue(value) {
  if (!value) return '—';
  return String(value.decimal ?? value.number ?? value.address ?? value.literal ?? value.signed ?? value.unsigned ?? '?');
}

export function createRecording(plan, trace, navigation) {
  if (plan?.schemaVersion !== 3 || trace?.schemaVersion !== 3 || !Array.isArray(trace.events)) {
    throw new Error('스키마 3의 plan.json과 trace.json이 필요합니다.');
  }
  const recording = {
    plan,
    trace,
    instructions: new Map(plan.instructions.map(instruction => [instruction.id, instruction])),
    objects: new Map(trace.objects.map(object => [object.id, object])),
    frames: new Map(trace.frames.map(frame => [frame.id, frame])),
    events: new Map(),
    calls: new Map(),
    frameNames: new Map(),
    eventOrder: new Map(),
    lastTokenUse: new Map(),
    parameters: new Map(),
    parameterObjects: new Map(),
    framePresentationUntil: new Map(),
    displayScenes: new WeakMap(),
    resolveType: typeResolver(plan),
    playbackLength: trace.events.findIndex(event => event.kind === 'ERROR') + 1 || trace.events.length,
  };
  for (const [index,event] of trace.events.entries()) {
    const instruction = recording.instructions.get(event.instructionId);
    if (!instruction || instruction.kind !== event.kind || instruction.action !== event.action) {
      throw new Error(`${event.eventId}의 명령 정의와 실행 기록이 일치하지 않습니다.`);
    }
    if (!scalarActions.get(event.kind)?.has(event.action) || event.phase !== 'complete' && event.kind !== 'ERROR' &&
        !(isAttempt(event) && index < recording.playbackLength - 1 && trace.events[recording.playbackLength - 1]?.kind === 'ERROR')) {
      throw new Error(`${event.eventId} ${event.kind}/${event.action}은 이 시제품의 지원 범위 밖입니다.`);
    }
    if (recording.events.has(event.eventId)) throw new Error('실행 사건 ID가 중복되었습니다.');
    for (const input of event.inputs ?? []) {
      if (input.executionId && !recording.events.has(input.executionId)) throw new Error('값 입력이 앞선 사건에 연결되지 않았습니다.');
    }
    if (event.action === 'object.begin') {
      const object = recording.objects.get(event.objectId);
      if (!object || !storageRoot(id=>recording.objects.get(id),object.id)) throw new Error('객체의 공유 저장소 연결이 유효하지 않습니다.');
    }
    if (!isAttempt(event) && event.target?.objectId && ['READ', 'WRITE'].includes(event.kind)) {
      const object = recording.objects.get(event.target.objectId);
      if (!object || event.target.offset < 0 || event.target.offset + event.target.size > object.size) throw new Error(`${event.eventId}의 메모리 접근 범위가 객체 밖입니다.`);
    }
    if (event.kind === 'CALC' && !isAttempt(event) && !event.value) throw new Error('CALC의 기록된 결과가 없습니다.');
    recording.events.set(event.eventId, event);
  }
  trace.events.forEach((event, index) => {
    recording.eventOrder.set(event.eventId, index);
    // return/resume inputs repeat provenance; they are not fresh reads of
    // the argument/calculation cards already placed in parameters/ports.
    const ids = event.kind === 'SPACE' || ['enter', 'return', 'resume'].includes(event.action) ? [] : (event.inputs ?? []).map(input => input.executionId);
    for (const id of [...ids, ...(event.addressInputs ?? []), ...(event.calleeInputs ?? [])]) {
      if (id) recording.lastTokenUse.set(id, index);
    }
  });
  // Relationships come from the recorded call/return identities, never names
  // or matching numeric values. These indexes do not create scene objects.
  for (const event of trace.events) {
    if (event.action === 'call') recording.calls.set(event.eventId, {event, frameId: null});
    if (event.callExecutionId && ['argument', 'return.value', 'return'].includes(event.action)) {
      const call = recording.calls.get(event.callExecutionId);
      if (call) call.frameId = event.activationId;
    }
  }
  // Keep a return's source field until its recorded consumer is displayed.
  // This is a presentation lease, not a change to runtime object lifetimes.
  const retainThrough = (frameId, index) => {
    if (frameId && Number.isInteger(index)) recording.framePresentationUntil.set(frameId,
      Math.max(recording.framePresentationUntil.get(frameId) ?? -1, index));
  };
  for (const event of trace.events) {
    if (event.action === 'resume' && event.returnDisposition !== 'discarded') {
      const call = recording.calls.get(event.callExecutionId);
      retainThrough(call?.frameId, recording.lastTokenUse.get(event.eventId));
    }
    // A CALC's inputs are also drawn during its destination WRITE. Nested
    // calls and argument writes must retain their actual source frames too.
    for (const edge of dataFlowForEvent(recording, event)) {
      if (edge.from.kind === 'return-port') retainThrough(edge.from.id, recording.eventOrder.get(event.eventId));
    }
  }
  const totals = new Map();
  const occurrences = new Map();
  const identity = frame => frame.functionId ?? frame.functionName;
  for (const frame of trace.frames) totals.set(identity(frame), (totals.get(identity(frame)) ?? 0) + 1);
  for (const frame of trace.frames) {
    const key = identity(frame);
    const count = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, count);
    recording.frameNames.set(frame.id, `${frame.functionName ?? frame.id}${totals.get(key) > 1 ? count : ''}`);
  }
  const declarations = new Map((plan.declarations ?? []).map(declaration => [declaration.id, declaration]));
  const functions = new Map((plan.functions ?? []).map(fn => [fn.id, fn]));
  const argumentsByFrame = new Map();
  for (const event of trace.events) if (event.action === 'argument' && Number.isInteger(event.parameterIndex)) {
    const arguments_ = argumentsByFrame.get(event.activationId) ?? new Map();
    arguments_.set(event.parameterIndex, event.target?.objectId);
    argumentsByFrame.set(event.activationId, arguments_);
  }
  for (const event of trace.events) if (event.action === 'frame.begin') {
    const frame = recording.frames.get(event.frameId);
    const parameters = (event.parameters ?? functions.get(frame?.functionId)?.parameters ?? []).map((id, parameterIndex) => {
      const declaration = declarations.get(id);
      const objectId = argumentsByFrame.get(event.frameId)?.get(parameterIndex);
      const stored = recording.objects.get(objectId);
      const parameter = {id: objectId ?? `parameter:${event.frameId}:${id}`, name: declaration?.name ?? stored?.name ?? `인자 ${parameterIndex + 1}`,
        cType: declaration?.cType ?? stored?.cType, size: stored?.size ?? (declaration?.cType?.sizeBits === undefined ? null : declaration.cType.sizeBits / 8),
        frameId: event.frameId, storage: 'automatic', parameter: true, parameterIndex, declarationId: id};
      if (objectId) recording.parameterObjects.set(objectId, parameter);
      return parameter;
    });
    recording.parameters.set(event.frameId, parameters);
  }
  recording.internalConstantStorage=internalConstantStorage(recording);
  recording.loopGroups=indexLoops(recording,navigation);
  return recording;
}

// Parameter slots belong to the function's presentation blueprint. They do
// not allocate runtime objects or read final values before their IR events.
export function displayScene(recording, state) {
  const cached = recording.displayScenes.get(state);
  if (cached) return cached;
  const objects = new Map(state.objects);
  const frames = new Map(state.frames);
  for (const pending of state.pendingFrameEnds?.values() ?? []) {
    frames.set(pending.frame.id, {...pending.frame, alive: true, returnPending: true});
    for (const object of pending.objects) objects.set(object.id, {...object, returnPending: true});
  }
  for (const frame of frames.values()) {
    for (const parameter of recording.parameters.get(frame.id) ?? []) {
      const actual = objects.get(parameter.id);
      if (actual) objects.set(parameter.id, {...actual, parameter: true, parameterIndex: parameter.parameterIndex});
      else if (frame.alive) objects.set(parameter.id, {...parameter, alive: true, initialized: false, value: null, awaitingStorage: true});
    }
  }
  // Reserve formal parameter slots before local declarations, consistently
  // across seeks and the placeholder -> observed-storage transition.
  const ordered = new Map();
  for (const frame of frames.values()) for (const parameter of recording.parameters.get(frame.id) ?? []) {
    if (objects.has(parameter.id)) ordered.set(parameter.id, objects.get(parameter.id));
  }
  for (const [id, object] of objects) if (!ordered.has(id)) ordered.set(id, object);
  const scene = {...state, frames, objects: memoryPresentation(recording, sourceVisibleObjects(recording,ordered))};
  recording.displayScenes.set(state, scene);
  recording.displayScenes.set(scene, scene);
  return scene;
}

export function emptyScene() {
  return {frames: new Map(), objects: new Map(), tokens: new Map(), returned: new Map(), calls: new Map(), pendingFrameEnds: new Map(), input: '', inputBytes: '', output: '', outputByChannel: new Map(), activeFrame: null, error: null};
}

function addToken(state, id, value, kind) {
  const occupied = new Set([...state.tokens.values()].map(token => token.slot));
  let slot = 0;
  while (occupied.has(slot)) slot++;
  state.tokens.set(id, {id, value, slot, kind});
}

export function applyEvent(recording, previous, event) {
  // A failed attempt has no completed memory/result effect. Keep the prefix.
  if (isAttempt(event)) return previous;
  // Types and old values are immutable. Copy mutable containers instead of
  // cloning every compiler type and byte range on every animation step.
  const state = {...previous,
    boundaryIndex:recording.eventOrder.get(event.eventId),
    objects: new Map([...previous.objects].map(([id, object]) => [id, {...object,
      cells: new Map(object.cells), observedOffsets: new Set(object.observedOffsets), exposedOffsets: new Set(object.exposedOffsets)}])),
    frames: new Map([...previous.frames].map(([id, frame]) => [id, {...frame}])),
    calls: new Map([...previous.calls].map(([id, call]) => [id, {...call}])),
    tokens: new Map(previous.tokens), returned: new Map(previous.returned), outputByChannel: new Map(previous.outputByChannel), pendingFrameEnds: new Map(previous.pendingFrameEnds)};
  if (event.activationId) state.activeFrame = event.activationId;
  if (event.action === 'frame.begin') {
    const frame = recording.frames.get(event.frameId);
    state.frames.set(event.frameId, {id: event.frameId, name: recording.frameNames.get(event.frameId) ?? frame?.functionName ?? event.frameId, slot: state.frames.size, alive: true});
  } else if (event.action === 'frame.end') {
    const frame = state.frames.get(event.frameId);
    const until = recording.framePresentationUntil.get(event.frameId);
    if (frame && until > recording.eventOrder.get(event.eventId)) {
      state.pendingFrameEnds.set(event.frameId, {until, frame: {...frame},
        objects: [...state.objects.values()].filter(object => object.alive && object.frameId === event.frameId).map(object => ({...object}))});
    }
    if (frame) frame.alive = false;
    for (const object of state.objects.values()) {
      if (object.frameId === event.frameId) object.alive = false;
    }
    state.activeFrame = recording.frames.get(event.frameId)?.parent ?? null;
  } else if (event.action === 'object.begin') {
    const source = recording.objects.get(event.objectId);
    // The final object ledger supplies identity and type only. Its final bytes,
    // lifetime and initialization ranges must never leak into an earlier scene.
    const siblings = [...state.objects.values()].filter(object => object.frameId === source.frameId);
    state.objects.set(source.id, {...beginMemory(source, event, state.objects.get(event.copiedFrom?.objectId)), slot: siblings.length});
  } else if (event.action === 'object.end') {
    const object = state.objects.get(event.objectId);
    if (object) object.alive = false;
  } else if (event.kind === 'WRITE' && event.target?.objectId) {
    const object = state.objects.get(event.target.objectId);
    if (!object?.alive) throw new Error(`${event.eventId}의 저장 대상이 아직 없거나 수명이 끝났습니다.`);
    observeMemory(recording, state, event);
  } else if (event.action === 'output') {
    state.output += event.text ?? '';
    const channel=event.channel??'stdout';
    state.outputByChannel.set(channel,(state.outputByChannel.get(channel)??'')+(event.text??''));
  } else if (event.kind === 'READ' && event.action === 'input' && event.bytesHex && event.inputStage !== 'buffer-read') {
    state.inputBytes += event.bytesHex;
    const bytes = Uint8Array.from(state.inputBytes.match(/../g), byte => parseInt(byte, 16));
    state.input = new TextDecoder().decode(bytes, {stream: true});
  } else if (event.action === 'return.value') {
    state.returned.set(event.activationId, event.value);
    const call = state.calls.get(event.callExecutionId);
    if (call) {
      call.returnValueId = event.eventId;
      call.value = event.value;
    }
  } else if (event.action === 'call') {
    state.calls.set(event.eventId, {id: event.eventId, callerId: event.activationId,
      frameId: recording.calls.get(event.eventId)?.frameId ?? null, status: 'calling', resultTokenId: null});
  } else if (event.action === 'return' && event.callExecutionId) {
    const call = state.calls.get(event.callExecutionId);
    if (call) {
      call.status = 'returning';
      const source = recording.calls.get(call.id)?.event;
      if (call.value && source?.returnDisposition !== 'discarded') {
        call.resultTokenId = call.returnValueId;
        addToken(state, call.resultTokenId, call.value, 'FLOW');
      }
    }
  } else if (event.action === 'resume') {
    const call = state.calls.get(event.callExecutionId);
    if (call) {
      call.status = 'resumed';
      const token = state.tokens.get(call.resultTokenId);
      if (token) {
        state.tokens.delete(token.id);
        state.tokens.set(event.eventId, {...token, id: event.eventId, value: event.value ?? token.value});
        call.resultTokenId = event.eventId;
      }
    }
  } else if (event.kind === 'ERROR') {
    state.error = event.diagnostic?.message ?? '실행 오류';
    state.errorEventId = event.eventId;
  }
  if (event.kind === 'READ' && event.target?.objectId) observeMemory(recording, state, event);
  if(event.action==='object.begin'||['READ','WRITE'].includes(event.kind)&&event.target?.objectId)synchronizeAliases(recording,state,event);
  if (event.action === 'object.begin' || event.kind === 'WRITE' && event.target?.objectId) hydrateMemory(recording, state, event);
  // A call reserves its inputs for the later argument WRITE events. FLOW
  // call itself is not a second copy or a reason to erase their value cards.
  const consumed = [...(event.addressInputs ?? []), ...(event.calleeInputs ?? [])];
  if (['CALC', 'WRITE', 'FLOW'].includes(event.kind) && event.action !== 'call') {
    consumed.push(...(event.inputs ?? []).map(input => input.executionId));
  }
  for (const id of consumed) {
    if ((recording.lastTokenUse.get(id) ?? -1) <= recording.eventOrder.get(event.eventId)) state.tokens.delete(id);
  }
  if ((['READ', 'CALC'].includes(event.kind) || event.action === 'resume' && event.returnDisposition !== 'discarded') && event.value && !state.tokens.has(event.eventId)) {
    addToken(state, event.eventId, event.value, event.kind);
  }
  for (const [frameId, pending] of state.pendingFrameEnds) {
    if (recording.eventOrder.get(event.eventId) >= pending.until) state.pendingFrameEnds.delete(frameId);
  }
  return state;
}

export class Playback {
  constructor(recording) {
    this.recording = recording;
    this.speed = 1;
    this.playing = false;
    this.inputRequest = null;
    this.checkpoints = new Map([[0, emptyScene()]]);
    this.seek(0);
  }

  get event() { return this.state?.errorEventId ? null : this.recording.trace.events[this.cursor] ?? null; }
  get faultEvent() { return this.recording.events.get(this.state?.errorEventId) ?? null; }
  get waitingForInput() { return !this.event && !this.faultEvent && this.inputRequest !== null; }
  get timing() {return instructionTiming(this.recording,this.event);}

  get duration() {
    return this.timing.duration;
  }

  get after() {
    if (!this.event) return this.state;
    this.preparedState ??= applyEvent(this.recording, this.state, this.event);
    return this.preparedState;
  }

  seek(count) {
    this.playing = false;
    this.presentationMode = 'inspect';
    this.cursor = Math.max(0, Math.min(this.recording.playbackLength, Math.trunc(count)));
    this.progress = 0;
    this.preparedState = null;
    const start = Math.max(...[...this.checkpoints.keys()].filter(index => index <= this.cursor));
    this.state = this.checkpoints.get(start);
    for (let index = start; index < this.cursor; index++) {
      this.state = applyEvent(this.recording, this.state, this.recording.trace.events[index]);
      if ((index + 1) % 128 === 0) this.checkpoints.set(index + 1, this.state);
    }
    while (this.checkpoints.size > 32) this.checkpoints.delete([...this.checkpoints.keys()].find(index => index !== 0 && index !== start));
  }

  stepInstruction(){
    if(!this.event){this.playing=false;return;}
    this.seek(this.cursor+1);
  }

  stepLine(){
    const event=this.event,source=eventSource(this.recording,event);
    if(!event||!source?.line){this.stepInstruction();return;}
    let end=this.cursor+1;
    while(end<this.recording.playbackLength){
      const next=this.recording.trace.events[end],location=eventSource(this.recording,next);
      if(next.activationId!==event.activationId||location?.file!==source.file||location?.line!==source.line)break;
      end++;
    }
    this.seek(end);
  }

  advance(milliseconds) {
    if (!this.playing || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    let remaining = milliseconds * this.speed;
    while (this.event && (remaining > 0 || this.progress >= 1 || this.event.kind === 'ERROR')) {
      const fault = this.event.kind === 'ERROR';
      const needed = fault ? 0 : Math.max(0, (1 - this.progress) * this.duration);
      // The UI divides this budget by speed; multiplying it back can round
      // just below needed while progress rounds to 1. Commit that boundary
      // within arithmetic precision, rather than leaving a zero-time stall.
      const roundoff = Number.EPSILON * Math.max(this.duration, remaining, 1) * 8;
      if (remaining + roundoff < needed) {
        this.progress += remaining / this.duration;
        return;
      }
      remaining = Math.max(0, remaining - needed);
      this.state = this.after;
      this.preparedState = null;
      this.cursor++;
      if (this.cursor % 128 === 0) this.checkpoints.set(this.cursor, this.state);
      while (this.checkpoints.size > 32) this.checkpoints.delete([...this.checkpoints.keys()].find(index => index !== 0));
      this.progress = 0;
      if (fault) { this.playing = false; return; }
    }
    if (!this.event) this.playing = false;
  }

  skipTo(count) {
    const wasPlaying=this.playing;
    this.seek(count);
    if(wasPlaying&&this.event&&!this.waitingForInput&&!this.faultEvent){
      this.presentationMode='playback';this.playing=true;
    }
  }

  play() {
    if (this.waitingForInput) { this.playing = false; return; }
    if (!this.event) this.seek(0);
    this.presentationMode = 'playback';
    this.playing = true;
  }
}
