// Presentation reads recorded evidence; it never evaluates C or invents a location.
export const isAttempt = event => event?.kind !== 'ERROR' && ['failed', 'incomplete'].includes(event?.phase);

export function eventSource(recording, event, visited = new Set()) {
  if (!event || visited.has(event.eventId)) return null;
  visited.add(event.eventId);
  const candidates = [event.source, event.diagnostic?.source,
    recording.instructions.get(event.failedInstructionId)?.source,
    eventSource(recording, recording.events.get(event.failedExecutionId), visited),
    recording.instructions.get(event.instructionId)?.source,
    ...(recording.trace.diagnostics ?? []).filter(d => d.eventId === event.eventId).map(d => d.source)];
  return candidates.find(source => source?.line || source?.editorRange?.startLineNumber) ?? null;
}

export function recordedFault(recording, event) {
  if (event?.kind !== 'ERROR') return null;
  const stage = event.diagnostic?.stage;
  const internal = recording.trace.status === 'engine-error' || ['ir-recording', 'ir-conversion', 'ir-finalization'].includes(stage)
    || ['stack-lifetime-binding','lifetime-binding','source-storage-binding','allocation-size'].includes(event.diagnostic?.code);
  const limited = recording.trace.status === 'limited' || ['trace-limit','trace-size-limit'].includes(event.diagnostic?.code);
  return {title: internal ? '중간언어 기록 오류' : limited ? '기록 한도 도달' : '런타임 오류',
    message: event.diagnostic?.message ?? '실행이 중단되었습니다.',
    code: event.diagnostic?.code ?? null, source: eventSource(recording, event)};
}
